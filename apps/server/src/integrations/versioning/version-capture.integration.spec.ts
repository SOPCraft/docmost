import { randomUUID, createHash } from 'node:crypto';
import { Kysely, CamelCasePlugin, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { KyselyDB } from '../../database/types/kysely.types';
import { VersionCaptureService } from './version-capture.service';
import {
  up,
  down,
} from '../../database/migrations/20261001T120000-sop-page-versions';
import { canonicalJson } from './version-snapshot';

const testUrl = process.env.SOP_CAPTURE_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
suite('version capture against an isolated PostgreSQL database', () => {
  let db: KyselyDB;
  let capture: VersionCaptureService;
  let pageId: string;
  const workspaceId = randomUUID();
  const spaceId = randomUUID();
  const actorA = randomUUID();
  const actorB = randomUUID();
  const foreignActor = randomUUID();
  const schema = `capture_${randomUUID().replace(/-/g, '')}`;
  const previousFlag = process.env.SOP_VERSION_CAPTURE_ENABLED;

  beforeAll(async () => {
    if (new URL(testUrl).pathname !== '/sop_capture_test')
      throw new Error('Test database name must be sop_capture_test');
    process.env.SOP_VERSION_CAPTURE_ENABLED = 'true';
    capture = new VersionCaptureService();
    db = new Kysely({
      dialect: new PostgresJSDialect({
        postgres: postgres(testUrl, {
          max: 3,
          onnotice: () => {},
          connection: { search_path: schema },
        }),
      }),
      plugins: [new CamelCasePlugin()],
    }) as KyselyDB;
    await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
    await sql`CREATE TABLE pages (
      id uuid PRIMARY KEY, workspace_id uuid, space_id uuid, slug_id text,
      title text, icon text, cover_photo text, parent_page_id uuid,
      position text, content jsonb, ydoc bytea, deleted_at timestamptz
    )`.execute(db);
    await sql`CREATE TABLE users (id uuid PRIMARY KEY, workspace_id uuid, name text)`.execute(
      db,
    );
    await sql`INSERT INTO users VALUES (${actorA}::uuid, ${workspaceId}::uuid, '同事甲'),
      (${actorB}::uuid, ${workspaceId}::uuid, '同事乙'),
      (${foreignActor}::uuid, ${randomUUID()}::uuid, '其他空间用户')`.execute(
      db,
    );
    await up(db);
  });
  beforeEach(async () => {
    pageId = randomUUID();
    await sql`INSERT INTO pages (id, workspace_id, space_id, slug_id, title, position, content, ydoc)
      VALUES (${pageId}::uuid, ${workspaceId}::uuid, ${spaceId}::uuid, 'test', '旧标题', 'a0',
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"检查人名与数字"}]}]}'::jsonb,
      ${Buffer.from([1, 2, 3])})`.execute(db);
  });
  afterAll(async () => {
    if (previousFlag === undefined)
      delete process.env.SOP_VERSION_CAPTURE_ENABLED;
    else process.env.SOP_VERSION_CAPTURE_ENABLED = previousFlag;
    if (db) {
      await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(db);
      await db.destroy();
    }
  });
  const request = (actorIds = [actorA]) => ({ pageId, workspaceId, actorIds });
  const versions = () =>
    sql<{ payload: string; digest: string; status: string; revision: number }>`
    SELECT snapshot::text AS payload, snapshot_sha256 AS digest, status, revision
    FROM sop_page_versions WHERE page_id = ${pageId}::uuid ORDER BY revision
  `.execute(db);

  it('commits the page and fixed snapshot together', async () => {
    const saved = await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('pages')
        .set({ title: '已保存标题' })
        .where('id', '=', pageId)
        .execute();
      return capture.capture(trx, request([actorA, actorB]));
    });
    const result = (await versions()).rows[0];
    expect(saved.revision).toBe(1);
    expect(JSON.parse(result.payload).page.title).toBe('已保存标题');
    expect(
      JSON.parse(result.payload)
        .actors.map((a: any) => a.id)
        .sort(),
    ).toEqual([actorA, actorB].sort());
    expect(result.status).toBe('pending');
    expect(
      createHash('sha256')
        .update(canonicalJson(JSON.parse(result.payload)))
        .digest('hex'),
    ).toBe(result.digest.trim());
  });
  it('rolls back both page and snapshot when the transaction fails', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await trx
          .updateTable('pages')
          .set({ title: '不能落库' })
          .where('id', '=', pageId)
          .execute();
        await capture.capture(trx, request());
        throw new Error('injected rollback');
      }),
    ).rejects.toThrow('injected rollback');
    expect(
      (
        await db
          .selectFrom('pages')
          .select('title')
          .where('id', '=', pageId)
          .executeTakeFirst()
      ).title,
    ).toBe('旧标题');
    expect((await versions()).rows).toHaveLength(0);
  });
  it('never rereads current content for an already captured version', async () => {
    await db.transaction().execute((trx) => capture.capture(trx, request()));
    await db
      .updateTable('pages')
      .set({ title: '后来的修改' })
      .where('id', '=', pageId)
      .execute();
    expect(JSON.parse((await versions()).rows[0].payload).page.title).toBe(
      '旧标题',
    );
  });
  it('serializes concurrent revision allocation for the same page', async () => {
    await Promise.all(
      Array.from({ length: 6 }, () =>
        db.transaction().execute((trx) => capture.capture(trx, request())),
      ),
    );
    expect((await versions()).rows.map((row) => row.revision)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
  it('rejects capture outside a transaction', async () => {
    await expect(capture.capture(db as any, request())).rejects.toThrow(
      'requires a transaction',
    );
  });
  it('rejects contributors from another workspace and rolls back the page', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await trx
          .updateTable('pages')
          .set({ title: '越权结果' })
          .where('id', '=', pageId)
          .execute();
        await capture.capture(trx, request([foreignActor]));
      }),
    ).rejects.toThrow('do not belong');
    expect((await versions()).rows).toHaveLength(0);
    expect(
      (
        await db
          .selectFrom('pages')
          .select('title')
          .where('id', '=', pageId)
          .executeTakeFirst()
      ).title,
    ).toBe('旧标题');
  });
  it('rejects missing actors instead of assigning the previous editor', async () => {
    await expect(
      db.transaction().execute((trx) => capture.capture(trx, request([]))),
    ).rejects.toThrow('no authenticated');
  });
  it('rejects a different requested workspace', async () => {
    await expect(
      db
        .transaction()
        .execute((trx) =>
          capture.capture(trx, { ...request(), workspaceId: randomUUID() }),
        ),
    ).rejects.toThrow('unavailable');
  });
  it('protects saved content while allowing delivery-attempt updates', async () => {
    const saved = await db
      .transaction()
      .execute((trx) => capture.capture(trx, request()));
    await sql`UPDATE sop_page_versions SET attempts = 1 WHERE id = ${saved.id}::uuid`.execute(
      db,
    );
    await expect(
      sql`UPDATE sop_page_versions SET snapshot = '{}'::jsonb WHERE id = ${saved.id}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow('immutable');
    expect(JSON.parse((await versions()).rows[0].payload).page.title).toBe(
      '旧标题',
    );
  });
  it('does not cascade-delete snapshots when the live page is deleted', async () => {
    await db.transaction().execute((trx) => capture.capture(trx, request()));
    await db.deleteFrom('pages').where('id', '=', pageId).execute();
    expect((await versions()).rows).toHaveLength(1);
    await expect(
      sql`DELETE FROM sop_page_versions WHERE page_id = ${pageId}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow('append-only');
  });
  it('refuses rollback that would erase existing versions', async () => {
    await db.transaction().execute((trx) => capture.capture(trx, request()));
    await expect(down(db)).rejects.toThrow('Refusing to drop');
  });
  it('does no database work when capture is disabled', async () => {
    process.env.SOP_VERSION_CAPTURE_ENABLED = 'false';
    try {
      expect(
        await new VersionCaptureService().capture(null, request()),
      ).toBeNull();
    } finally {
      process.env.SOP_VERSION_CAPTURE_ENABLED = 'true';
    }
  });
  it('cannot label a pending task as synced without a commit and timestamp', async () => {
    const saved = await db
      .transaction()
      .execute((trx) => capture.capture(trx, request()));
    await expect(
      sql`UPDATE sop_page_versions SET status = 'synced' WHERE id = ${saved.id}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow();
    expect((await versions()).rows[0].status).toBe('pending');
  });
  it('does not accept an invalid commit identifier', async () => {
    const saved = await db
      .transaction()
      .execute((trx) => capture.capture(trx, request()));
    await expect(
      sql`UPDATE sop_page_versions SET commit_sha = 'not-a-commit' WHERE id = ${saved.id}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow();
  });
  it('keeps captured actor names even if the live profile changes later', async () => {
    await db.transaction().execute((trx) => capture.capture(trx, request()));
    const previous = JSON.parse((await versions()).rows[0].payload).actors[0]
      .name;
    await db
      .updateTable('users')
      .set({ name: '改名后的同事' })
      .where('id', '=', actorA)
      .execute();
    expect(JSON.parse((await versions()).rows[0].payload).actors[0].name).toBe(
      previous,
    );
  });
});
