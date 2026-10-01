import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { KyselyTransaction } from '../../database/types/kysely.types';
import { readVersioningConfig } from './versioning.config';
import { buildPageSnapshot } from './version-snapshot';

export interface CaptureRequest {
  pageId: string;
  workspaceId: string;
  actorIds: string[];
}

@Injectable()
export class VersionCaptureService {
  readonly config = readVersioningConfig();

  /** Must share the page-write transaction; no network calls belong here. */
  async capture(trx: KyselyTransaction, request: CaptureRequest) {
    if (!this.config.enabled) return null;
    if (!trx.isTransaction)
      throw new Error('Version capture requires a transaction');
    const ids = [...new Set(request.actorIds.filter(Boolean))].sort();
    if (!ids.length)
      throw new Error('Version capture has no authenticated contributor');
    const page = await trx
      .selectFrom('pages')
      .select([
        'id',
        'workspaceId',
        'spaceId',
        'slugId',
        'title',
        'icon',
        'coverPhoto',
        'parentPageId',
        'position',
        'content',
        'ydoc',
        'deletedAt',
      ])
      .where('id', '=', request.pageId)
      .where('workspaceId', '=', request.workspaceId)
      .forUpdate()
      .executeTakeFirst();
    if (!page || page.deletedAt) throw new Error('Version page is unavailable');
    const actors = await trx
      .selectFrom('users')
      .select(['id', 'name'])
      .where('workspaceId', '=', request.workspaceId)
      .where('id', 'in', ids)
      .execute();
    if (actors.length !== ids.length) {
      throw new Error('Version contributors do not belong to the workspace');
    }
    const snapshot = buildPageSnapshot(page, actors);
    const id = randomUUID();
    // The page row lock serializes this page's revision allocation and capture.
    const result = await sql<{ revision: number }>`
      INSERT INTO sop_page_versions
        (id, workspace_id, space_id, page_id, revision, snapshot, snapshot_sha256)
      SELECT ${id}::uuid, ${page.workspaceId}::uuid, ${page.spaceId}::uuid,
        ${page.id}::uuid, COALESCE(MAX(revision), 0) + 1,
        ${snapshot.json}::text::jsonb, ${snapshot.sha256}
      FROM sop_page_versions
      WHERE workspace_id = ${page.workspaceId}::uuid AND page_id = ${page.id}::uuid
      RETURNING revision
    `.execute(trx);
    return { id, revision: result.rows[0].revision, sha256: snapshot.sha256 };
  }
}
