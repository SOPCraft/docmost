import { randomUUID } from 'node:crypto';
import { Kysely, CamelCasePlugin, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { KyselyDB } from '../../database/types/kysely.types';
import { up as captureMigration } from '../../database/migrations/20261001T120000-sop-page-versions';
import { up as deliveryMigration } from '../../database/migrations/20261001T140000-sop-delivery-bindings';
import { VersionCaptureService } from './version-capture.service';
import { VersionDeliveryStore } from './version-delivery.store';
import { VersionDeliveryWorker } from './version-delivery.worker';
import { GiteaProvisionService } from './gitea-provision.service';
import { GiteaCommitService } from './gitea-commit.service';
import { GiteaClient } from './gitea.client';
import { DeliveryError } from './gitea.config';
import { VersionHistoryService } from '../../core/page/services/version-history.service';

const enabled = process.env.SOP_REAL_GITEA_TEST === '1';
(enabled ? describe : describe.skip)(
  'real authenticated Gitea and PostgreSQL delivery',
  () => {
    let db: KyselyDB,
      client: GiteaClient,
      store: VersionDeliveryStore,
      capture: VersionCaptureService;
    let workspaceId: string, spaceId: string, actorA: string, actorB: string;
    const schema = `real_delivery_${randomUUID().replace(/-/g, '')}`;
    const worker = () =>
      new VersionDeliveryWorker(
        client,
        store,
        new GiteaProvisionService(client, store),
        new GiteaCommitService(client),
      );
    beforeAll(async () => {
      const databaseUrl = new URL(
        process.env.SOP_CAPTURE_TEST_DATABASE_URL || '',
      );
      const giteaUrl = new URL(process.env.SOP_GITEA_URL || '');
      if (
        databaseUrl.pathname !== '/sop_capture_test' ||
        databaseUrl.hostname !== 'sop-p1-capture-db-20261001' ||
        giteaUrl.origin !== 'http://sop-p1-gitea-test-20261001:3000'
      )
        throw new Error('Dedicated isolated services required');
      db = new Kysely({
        dialect: new PostgresJSDialect({
          postgres: postgres(databaseUrl.toString(), {
            max: 5,
            onnotice: () => {},
            connection: { search_path: schema },
          }),
        }),
        plugins: [new CamelCasePlugin()],
      }) as KyselyDB;
      await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
      await sql`CREATE TABLE pages(id uuid PRIMARY KEY,workspace_id uuid,space_id uuid,slug_id text,title text,icon text,
      cover_photo text,parent_page_id uuid,position text,content jsonb,ydoc bytea,deleted_at timestamptz)`.execute(
        db,
      );
      await sql`CREATE TABLE users(id uuid PRIMARY KEY,workspace_id uuid,name text)`.execute(
        db,
      );
      await captureMigration(db);
      await deliveryMigration(db);
      client = new GiteaClient();
      store = new VersionDeliveryStore(db);
      capture = new VersionCaptureService();
    }, 30000);
    beforeEach(async () => {
      workspaceId = randomUUID();
      spaceId = randomUUID();
      actorA = randomUUID();
      actorB = randomUUID();
      await sql`INSERT INTO users VALUES(${actorA}::uuid,${workspaceId}::uuid,'测试同事甲'),
      (${actorB}::uuid,${workspaceId}::uuid,'测试同事乙')`.execute(db);
    });
    afterEach(() => jest.restoreAllMocks());
    afterAll(async () => {
      if (db) await db.destroy();
    }); // Keep synthetic evidence; never touch production data.
    const page = async () => {
      const id = randomUUID();
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '原始检查要求' }],
          },
        ],
      };
      await sql`INSERT INTO pages(id,workspace_id,space_id,slug_id,title,position,content,ydoc)
      VALUES(${id}::uuid,${workspaceId}::uuid,${spaceId}::uuid,'test','初稿','a0',
      ${JSON.stringify(content)}::text::jsonb,${Buffer.from([0, 0])})`.execute(
        db,
      );
      return id;
    };
    const save = (id: string, actors = [actorA], allowDeleted = false) =>
      db
        .transaction()
        .execute((trx) =>
          capture.capture(trx, {
            pageId: id,
            workspaceId,
            actorIds: actors,
            allowDeleted,
          }),
        );
    const rows = async () =>
      (
        await sql<any>`SELECT * FROM sop_page_versions
    WHERE workspace_id=${workspaceId}::uuid ORDER BY outbox_order`.execute(db)
      ).rows;
    const root = async () => {
      const b = (
        await sql<any>`SELECT * FROM sop_version_spaces WHERE workspace_id=${workspaceId}::uuid
      AND space_id=${spaceId}::uuid`.execute(db)
      ).rows[0];
      if (!b?.repoId) throw new Error('Repository was not bound');
      return client.repoPath(b.orgName, b.repoName);
    };
    const sync = async () => {
      await worker().tick();
      const state = await rows();
      expect(
        state
          .filter((r) => r.status !== 'synced')
          .map((r) => ({ status: r.status, error: r.lastErrorCode })),
      ).toEqual([]);
    };
    const history = () =>
      new VersionHistoryService(
        db,
        {
          findById: async (id: string) =>
            db
              .selectFrom('pages')
              .selectAll()
              .where('id', '=', id)
              .executeTakeFirst(),
        } as any,
        { validateCanView: async () => {} } as any,
        client,
        {
          getUserRolesForSpaces: async () => [{ spaceId, role: 'writer' }],
        } as any,
        { canUserEditPage: async () => ({ canAccess: true }) } as any,
      );
    it('authenticates a scoped non-administrator service account', async () => {
      const user = await client.request<{ login: string; is_admin: boolean }>(
        '/user',
      );
      expect(user.login).toBe('sop-sync-test');
      expect(user.is_admin).toBe(false);
    });
    it('creates a real private repository and commits both contributors', async () => {
      const id = await page();
      await save(id, [actorA, actorB]);
      await sync();
      const repo = await client.request<{ private: boolean }>(await root());
      expect(repo.private).toBe(true);
      const versions = await rows();
      const data = await client.file(
        await root(),
        `.sop/versions/${versions[0].id}.json`,
        versions[0].commitSha,
      );
      expect(
        JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'))
          .snapshot.actors.map((a) => a.id)
          .sort(),
      ).toEqual([actorA, actorB].sort());
    }, 30000);
    it('keeps the old revision readable after saving a new title', async () => {
      const id = await page();
      const first = await save(id);
      await sync();
      await db
        .updateTable('pages')
        .set({ title: '第二次修改' })
        .where('id', '=', id)
        .execute();
      const second = await save(id, [actorB]);
      await sync();
      const reader = history(),
        user = { id: actorA, workspaceId } as any;
      expect((await reader.read(id, first.id, user)).title).toBe('初稿');
      expect((await reader.read(id, second.id, user)).title).toBe('第二次修改');
    }, 30000);
    it('retains two documents in the same actual repository', async () => {
      const a = await page(),
        b = await page();
      await save(a);
      await save(b, [actorB]);
      await worker().tick();
      await sync();
      const versions = await rows();
      const head = versions[versions.length - 1].commitSha;
      expect(
        await client.file(await root(), `pages/${a}/document.json`, head),
      ).not.toBeNull();
      expect(
        await client.file(await root(), `pages/${b}/document.json`, head),
      ).not.toBeNull();
      const bindings =
        await sql`SELECT * FROM sop_version_spaces WHERE workspace_id=${workspaceId}::uuid`.execute(
          db,
        );
      expect(bindings.rows).toHaveLength(1);
    }, 30000);
    it('recovers a lost real branch-update response without a duplicate commit', async () => {
      const id = await page();
      await save(id);
      const request = client.request.bind(client);
      let lost = false;
      jest
        .spyOn(client, 'request')
        .mockImplementation(async (path, method, body) => {
          const result = await request(path, method, body);
          if (!lost && method === 'PUT' && path.endsWith('/branches/main')) {
            lost = true;
            throw new DeliveryError('GITEA_UNREACHABLE');
          }
          return result;
        });
      await worker().tick();
      expect(lost).toBe(true);
      expect((await rows())[0].status).toBe('failed');
      const remote = await client.head(await root(), 'main');
      await sql`UPDATE sop_page_versions SET next_attempt_at=now() WHERE workspace_id=${workspaceId}::uuid AND status='failed'`.execute(
        db,
      );
      await sync();
      expect((await rows())[0].commitSha).toBe(remote);
      expect(await client.head(await root(), 'main')).toBe(remote);
      const commits = await client.request<Array<{ sha: string }>>(
        `${await root()}/commits?sha=main&limit=20`,
      );
      expect(commits).toHaveLength(2);
    }, 30000);
    it('recovers an expired worker lease with a real backend', async () => {
      const id = await page();
      await save(id);
      expect(await store.claim(workspaceId, spaceId)).not.toBeNull();
      await sql`UPDATE sop_version_spaces SET lease_until=now()-interval '1 second'
      WHERE workspace_id=${workspaceId}::uuid`.execute(db);
      await sync();
      expect((await rows())[0].attempts).toBe(2);
    }, 30000);
    it('records deletion while the earlier version remains available', async () => {
      const id = await page();
      const first = await save(id);
      await sync();
      await db
        .updateTable('pages')
        .set({ deletedAt: new Date() })
        .where('id', '=', id)
        .execute();
      await save(id, [actorB], true);
      await sync();
      const versions = await rows();
      expect(
        await client.file(
          await root(),
          `pages/${id}/document.json`,
          versions[1].commitSha,
        ),
      ).toBeNull();
      const old = await history().read(id, first.id, {
        id: actorA,
        workspaceId,
      } as any);
      expect(old.title).toBe('初稿');
    }, 30000);
  },
);
