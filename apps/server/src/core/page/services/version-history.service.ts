import {
  Injectable,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '../../../database/types/kysely.types';
import { PageRepo } from '../../../database/repos/page/page.repo';
import { PageAccessService } from '../page-access/page-access.service';
import { User } from '../../../database/types/entity.types';
import { GiteaClient } from '../../../integrations/versioning/gitea.client';
import { readVersioningConfig } from '../../../integrations/versioning/versioning.config';
import {
  VersionTask,
  SpaceBinding,
} from '../../../integrations/versioning/version-delivery.types';
import { canonicalJson } from '../../../integrations/versioning/version-snapshot';
import { snapshotBytes } from '../../../integrations/versioning/version-delivery.validation';
import { safeHistoryContent } from '../../../integrations/versioning/history-safe-content';
import { SpaceMemberRepo } from '../../../database/repos/space/space-member.repo';
import { PagePermissionRepo } from '../../../database/repos/page/page-permission.repo';
import { ForbiddenException } from '@nestjs/common';

@Injectable()
export class VersionHistoryService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pages: PageRepo,
    private readonly access: PageAccessService,
    private readonly client: GiteaClient,
    private readonly members: SpaceMemberRepo,
    private readonly pagePermissions: PagePermissionRepo,
  ) {}
  private async authorize(pageId: string, user: User) {
    const page = await this.pages.findById(pageId);
    if (!page || page.workspaceId !== user.workspaceId)
      throw new NotFoundException('Page not found');
    await this.access.validateCanView(page, user);
    const roles = await this.members.getUserRolesForSpaces(user.id, [
      page.spaceId,
    ]);
    const permissions = await this.pagePermissions.canUserEditPage(
      user.id,
      page.id,
      { fresh: true },
    );
    if (
      !roles.some((role) =>
        ['admin', 'writer', 'reader'].includes(role.role),
      ) ||
      !permissions.canAccess
    ) {
      throw new ForbiddenException('History access has been revoked');
    }
    return page;
  }
  async list(pageId: string, user: User, before?: number) {
    const page = await this.authorize(pageId, user);
    if (!readVersioningConfig().enabled)
      return { enabled: false, items: [], hasMore: false };
    const rows = (
      await sql<any>`SELECT id, revision, status, attempts, commit_sha, created_at, synced_at,
      last_error_code, snapshot->'actors' AS actors, snapshot->>'scope' AS scope,
      snapshot->'exclusions' AS exclusions FROM sop_page_versions
      WHERE workspace_id=${user.workspaceId}::uuid AND space_id=${page.spaceId}::uuid AND page_id=${page.id}::uuid
        ${before ? sql`AND revision < ${before}` : sql``}
      ORDER BY revision DESC LIMIT 31`.execute(this.db)
    ).rows;
    const checked = await this.authorize(page.id, user);
    if (checked.spaceId !== page.spaceId)
      throw new ConflictException('Page location changed');
    return {
      enabled: true,
      items: rows.slice(0, 30),
      hasMore: rows.length > 30,
    };
  }
  async read(pageId: string, versionId: string, user: User) {
    const page = await this.authorize(pageId, user);
    if (!readVersioningConfig().enabled)
      throw new ConflictException('Version history is disabled');
    const task = (
      await sql<VersionTask>`SELECT * FROM sop_page_versions
      WHERE id=${versionId}::uuid AND workspace_id=${user.workspaceId}::uuid
        AND space_id=${page.spaceId}::uuid AND page_id=${page.id}::uuid`.execute(
        this.db,
      )
    ).rows[0];
    if (!task) throw new NotFoundException('Version not found');
    if (task.status !== 'synced' || !task.commitSha)
      throw new ConflictException('Version has not reached the repository');
    const binding = (
      await sql<SpaceBinding>`SELECT * FROM sop_version_spaces WHERE workspace_id=${user.workspaceId}::uuid
      AND space_id=${page.spaceId}::uuid`.execute(this.db)
    ).rows[0];
    if (!binding?.repoId)
      throw new ConflictException('Version repository binding is unavailable');
    const root = this.client.repoPath(binding.orgName, binding.repoName);
    let envelope: any;
    try {
      snapshotBytes(task);
      const repo = await this.client.request<{
        id: number;
        private: boolean;
        description: string;
      }>(root);
      const marker = `sop-space/1:${this.client.config.instanceId}:${user.workspaceId}:${page.spaceId}`;
      if (
        String(repo.id) !== String(binding.repoId) ||
        repo.private !== true ||
        repo.description !== marker
      )
        throw new Error('Repository changed');
      const file = await this.client.file(
        root,
        `.sop/versions/${task.id}.json`,
        task.commitSha,
      );
      if (!file) throw new Error('Snapshot missing');
      envelope = JSON.parse(
        Buffer.from(file.content, 'base64').toString('utf8'),
      );
      if (
        envelope.schema !== 'sop.delivery/1' ||
        envelope.taskId !== task.id ||
        envelope.revision !== task.revision ||
        envelope.snapshotSha256 !== task.snapshotSha256.trim() ||
        canonicalJson(envelope.snapshot) !== snapshotBytes(task)
      )
        throw new Error('Snapshot mismatch');
    } catch {
      throw new ServiceUnavailableException(
        'Historical snapshot is unavailable or invalid; current content was not substituted',
      );
    }
    const authorized = await this.authorize(page.id, user);
    if (authorized.spaceId !== page.spaceId)
      throw new ConflictException('Page location changed');
    return {
      id: task.id,
      revision: task.revision,
      commitSha: task.commitSha,
      createdAt: task.createdAt,
      actors: envelope.snapshot.actors,
      scope: envelope.snapshot.scope,
      exclusions: envelope.snapshot.exclusions,
      title: envelope.snapshot.page.title,
      content: safeHistoryContent(envelope.snapshot.page.content),
      deletedAt: envelope.snapshot.page.deletedAt,
    };
  }
}
