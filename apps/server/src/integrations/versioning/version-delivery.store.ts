import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';
import { KyselyDB } from '../../database/types/kysely.types';
import {
  ClaimedVersion,
  SpaceBinding,
  VersionTask,
  GitIdentity,
} from './version-delivery.types';
import {
  assertUuid,
  snapshotBytes,
  gitActorName,
} from './version-delivery.validation';

@Injectable()
export class VersionDeliveryStore {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async candidates(): Promise<Array<{ workspaceId: string; spaceId: string }>> {
    return (
      await sql<{ workspaceId: string; spaceId: string }>`
      SELECT v.workspace_id, v.space_id FROM sop_page_versions v
      WHERE v.status IN ('pending','processing','failed') AND v.next_attempt_at <= now()
        AND NOT EXISTS (SELECT 1 FROM sop_page_versions earlier WHERE earlier.workspace_id=v.workspace_id
          AND earlier.space_id=v.space_id AND earlier.status <> 'synced' AND earlier.outbox_order < v.outbox_order)
        AND NOT EXISTS (SELECT 1 FROM sop_version_spaces busy WHERE busy.workspace_id=v.workspace_id
          AND busy.space_id=v.space_id AND busy.lease_until > now())
      ORDER BY v.outbox_order LIMIT 50`.execute(this.db)
    ).rows;
  }
  async claim(
    workspaceId: string,
    spaceId: string,
  ): Promise<ClaimedVersion | null> {
    assertUuid(workspaceId);
    assertUuid(spaceId);
    return this.db.transaction().execute(async (trx) => {
      // Barrier against uncommitted, earlier sequence allocations in this space.
      await sql`SELECT pg_advisory_xact_lock(hashtext('sop-capture-order'), hashtext(${spaceId}))`.execute(
        trx,
      );
      await sql`INSERT INTO sop_version_spaces (workspace_id, space_id, org_name, repo_name)
        VALUES (${workspaceId}::uuid, ${spaceId}::uuid, ${'w-' + workspaceId.replace(/-/g, '')}, ${'s-' + spaceId.replace(/-/g, '')})
        ON CONFLICT (workspace_id, space_id) DO NOTHING`.execute(trx);
      const binding = (
        await sql<SpaceBinding>`SELECT * FROM sop_version_spaces
        WHERE workspace_id = ${workspaceId}::uuid AND space_id = ${spaceId}::uuid
        AND (lease_until IS NULL OR lease_until < now()) FOR UPDATE SKIP LOCKED`.execute(
          trx,
        )
      ).rows[0];
      if (!binding) return null;
      const task = (
        await sql<VersionTask>`SELECT * FROM sop_page_versions
        WHERE workspace_id = ${workspaceId}::uuid AND space_id = ${spaceId}::uuid AND status <> 'synced'
        ORDER BY outbox_order LIMIT 1 FOR UPDATE`.execute(trx)
      ).rows[0];
      if (
        !task ||
        task.status === 'blocked' ||
        new Date(task.nextAttemptAt).getTime() > Date.now()
      )
        return null;
      const leaseId = randomUUID();
      await sql`UPDATE sop_version_spaces SET lease_id = ${leaseId}::uuid, lease_until = now() + interval '120 seconds'
        WHERE workspace_id = ${workspaceId}::uuid AND space_id = ${spaceId}::uuid`.execute(
        trx,
      );
      await sql`UPDATE sop_page_versions SET status = 'processing', attempts = attempts + 1
        WHERE id = ${task.id}::uuid`.execute(trx);
      return {
        task: { ...task, attempts: task.attempts + 1 },
        binding,
        leaseId,
      };
    });
  }

  async identities(task: VersionTask): Promise<GitIdentity[]> {
    snapshotBytes(task);
    return this.db.transaction().execute(async (trx) => {
      const result: GitIdentity[] = [];
      for (const actor of task.snapshot.actors) {
        const email =
          createHash('sha256')
            .update(`${task.workspaceId}/${actor.id}`)
            .digest('hex')
            .slice(0, 40) + '@authors.sop.invalid';
        await sql`INSERT INTO sop_version_identities (workspace_id, user_id, git_email)
          VALUES (${task.workspaceId}::uuid, ${actor.id}::uuid, ${email}) ON CONFLICT DO NOTHING`.execute(
          trx,
        );
        const row = (
          await sql<{
            gitEmail: string;
          }>`SELECT git_email FROM sop_version_identities
          WHERE workspace_id = ${task.workspaceId}::uuid AND user_id = ${actor.id}::uuid`.execute(
            trx,
          )
        ).rows[0];
        result.push({
          id: actor.id,
          name: gitActorName(actor.name),
          email: row.gitEmail,
        });
      }
      return result;
    });
  }
  async bindRepository(
    claim: ClaimedVersion,
    repoId: string,
    headSha: string,
  ): Promise<boolean> {
    const rows =
      await sql`UPDATE sop_version_spaces SET repo_id = ${repoId}::bigint, head_sha = ${headSha}
      WHERE workspace_id = ${claim.task.workspaceId}::uuid AND space_id = ${claim.task.spaceId}::uuid
      AND lease_id = ${claim.leaseId}::uuid AND repo_id IS NULL RETURNING space_id`.execute(
        this.db,
      );
    return rows.rows.length === 1;
  }

  async finish(claim: ClaimedVersion, commitSha: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const current = (
        await sql<SpaceBinding>`SELECT * FROM sop_version_spaces
        WHERE workspace_id = ${claim.task.workspaceId}::uuid AND space_id = ${claim.task.spaceId}::uuid
        AND lease_id = ${claim.leaseId}::uuid FOR UPDATE`.execute(trx)
      ).rows[0];
      if (!current) return false;
      await sql`UPDATE sop_page_versions SET status = 'synced', commit_sha = ${commitSha},
        synced_at = now(), last_error_code = NULL WHERE id = ${claim.task.id}::uuid AND status <> 'synced'`.execute(
        trx,
      );
      await sql`UPDATE sop_version_spaces SET head_sha = ${commitSha}, lease_id = NULL, lease_until = NULL
        WHERE workspace_id = ${claim.task.workspaceId}::uuid AND space_id = ${claim.task.spaceId}::uuid`.execute(
        trx,
      );
      return true;
    });
  }

  async fail(
    claim: ClaimedVersion,
    code: string,
    blocked: boolean,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const current = (
        await sql`SELECT space_id FROM sop_version_spaces
        WHERE workspace_id = ${claim.task.workspaceId}::uuid AND space_id = ${claim.task.spaceId}::uuid
        AND lease_id = ${claim.leaseId}::uuid FOR UPDATE`.execute(trx)
      ).rows[0];
      if (!current) return;
      const delaySeconds = Math.min(60, 2 ** Math.min(claim.task.attempts, 6));
      await sql`UPDATE sop_page_versions SET status = ${blocked ? 'blocked' : 'failed'},
        last_error_code = ${code}, next_attempt_at = now() + ${delaySeconds} * interval '1 second'
        WHERE id = ${claim.task.id}::uuid AND status <> 'synced'`.execute(trx);
      await sql`UPDATE sop_version_spaces SET lease_id = NULL, lease_until = NULL
        WHERE workspace_id = ${claim.task.workspaceId}::uuid AND space_id = ${claim.task.spaceId}::uuid`.execute(
        trx,
      );
    });
  }
}
