import { randomUUID } from 'node:crypto';
import { Kysely, CamelCasePlugin, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { KyselyDB } from '../../database/types/kysely.types';
import { PagePermissionRepo } from '../../database/repos/page/page-permission.repo';
const url = process.env.SOP_CAPTURE_TEST_DATABASE_URL;
(url ? describe : describe.skip)(
  'version permission checks on a single database connection',
  () => {
    let db: KyselyDB, repo: PagePermissionRepo;
    const schema = `permissions_${randomUUID().replace(/-/g, '')}`,
      pageId = randomUUID(),
      userId = randomUUID(),
      accessId = randomUUID();
    const cache = {
      get: jest.fn(async () => ({
        v: { hasAnyRestriction: true, canAccess: true, canEdit: true },
      })),
      set: jest.fn(async () => {}),
    };
    beforeAll(async () => {
      if (new URL(url).pathname !== '/sop_capture_test')
        throw new Error('Isolated database required');
      db = new Kysely({
        dialect: new PostgresJSDialect({
          postgres: postgres(url, {
            max: 1,
            onnotice: () => {},
            connection: { search_path: schema },
          }),
        }),
        plugins: [new CamelCasePlugin()],
      }) as KyselyDB;
      await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
      await sql`CREATE TABLE pages(id uuid PRIMARY KEY,parent_page_id uuid)`.execute(
        db,
      );
      await sql`CREATE TABLE page_access(id uuid PRIMARY KEY,page_id uuid)`.execute(
        db,
      );
      await sql`CREATE TABLE page_permissions(id uuid,page_access_id uuid,user_id uuid,group_id uuid,role text)`.execute(
        db,
      );
      await sql`CREATE TABLE group_users(user_id uuid,group_id uuid)`.execute(
        db,
      );
      await sql`INSERT INTO pages VALUES(${pageId}::uuid,NULL)`.execute(db);
      await sql`INSERT INTO page_access VALUES(${accessId}::uuid,${pageId}::uuid)`.execute(
        db,
      );
      repo = new PagePermissionRepo(db, {} as any, cache as any);
    });
    afterAll(async () => {
      await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(db);
      await db.destroy();
    });
    beforeEach(() => cache.get.mockClear());
    it('retains legacy cached behavior for existing callers', async () => {
      expect((await repo.canUserEditPage(userId, pageId)).canAccess).toBe(true);
      expect(cache.get).toHaveBeenCalled();
    });
    it('a fresh history check rejects revoked permission despite a cached grant', async () => {
      expect(
        (await repo.canUserEditPage(userId, pageId, { fresh: true })).canAccess,
      ).toBe(false);
      expect(cache.get).not.toHaveBeenCalled();
    });
    it('transactional checks never wait for a second connection from the pool', async () => {
      const result = await db
        .transaction()
        .execute((trx) => repo.canUserEditPage(userId, pageId, { trx }));
      expect(result.canAccess).toBe(false);
      expect(cache.get).not.toHaveBeenCalled();
    });
  },
);
