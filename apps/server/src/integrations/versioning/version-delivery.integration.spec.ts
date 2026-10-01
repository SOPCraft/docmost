import { PageService } from '../../core/page/services/page.service';
import { VersionedTrashService } from '../../core/page/services/versioned-trash.service';
import { PageRepo } from '../../database/repos/page/page.repo';
import { VersionHistoryService } from '../../core/page/services/version-history.service';
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
import { MemoryGitea } from './gitea-delivery.fixture';

const testUrl = process.env.SOP_CAPTURE_TEST_DATABASE_URL;
(testUrl ? describe : describe.skip)(
  'delivery: real PostgreSQL with simulated Gitea contract',
  () => {
    let db: KyselyDB,
      capture: VersionCaptureService,
      store: VersionDeliveryStore,
      client: MemoryGitea,
      worker: VersionDeliveryWorker;
    const schema = `delivery_${randomUUID().replace(/-/g, '')}`;
    const workspaceId = randomUUID(),
      spaceId = randomUUID(),
      actorA = randomUUID(),
      actorB = randomUUID();
    const oldEnv = { ...process.env };
    beforeAll(async () => {
      if (new URL(testUrl).pathname !== '/sop_capture_test')
        throw new Error('Isolated database required');
      Object.assign(process.env, {
        SOP_VERSION_CAPTURE_ENABLED: 'true',
        SOP_GITEA_SYNC_ENABLED: 'true',
        SOP_GITEA_URL: 'http://127.0.0.1:39999',
        SOP_GITEA_ALLOW_HTTP: 'true',
        SOP_GITEA_TOKEN: 'simulated-test-token',
        SOP_GITEA_INSTANCE_ID: randomUUID(),
      });
      db = new Kysely({
        dialect: new PostgresJSDialect({
          postgres: postgres(testUrl, {
            max: 5,
            onnotice: () => {},
            connection: { search_path: schema },
          }),
        }),
        plugins: [new CamelCasePlugin()],
      }) as KyselyDB;
      await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
    });
    beforeEach(async () => {
      await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(db);
      await sql`CREATE SCHEMA ${sql.id(schema)}`.execute(db);
      await sql`CREATE TABLE pages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid,space_id uuid,slug_id text,title text,icon text,
      cover_photo text,parent_page_id uuid,position text,content jsonb,ydoc bytea,deleted_at timestamptz,
      creator_id uuid,last_updated_by_id uuid,deleted_by_id uuid,is_locked boolean DEFAULT false,is_base boolean DEFAULT false,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),contributor_ids uuid[] DEFAULT '{}')`.execute(
        db,
      );
      await sql`CREATE TABLE users(id uuid PRIMARY KEY,workspace_id uuid,name text,avatar_url text)`.execute(
        db,
      );
      await sql`INSERT INTO users(id,workspace_id,name) VALUES(${actorA}::uuid,${workspaceId}::uuid,'同事甲'),(${actorB}::uuid,${workspaceId}::uuid,'同事乙')`.execute(
        db,
      );
      await sql`CREATE TABLE spaces(id uuid PRIMARY KEY,workspace_id uuid,name text,slug text)`.execute(
        db,
      );
      await sql`INSERT INTO spaces VALUES(${spaceId}::uuid,${workspaceId}::uuid,'测试空间','test')`.execute(
        db,
      );
      await sql`CREATE TABLE shares(page_id uuid)`.execute(db);
      await captureMigration(db);
      await deliveryMigration(db);
      capture = new VersionCaptureService();
      store = new VersionDeliveryStore(db);
      client = new MemoryGitea();
      worker = makeWorker();
    });
    afterAll(async () => {
      for (const key of Object.keys(process.env))
        if (key.startsWith('SOP_') && !(key in oldEnv)) delete process.env[key];
      Object.assign(process.env, oldEnv);
      await sql`DROP SCHEMA ${sql.id(schema)} CASCADE`.execute(db);
      await db.destroy();
    });
    const makeWorker = () =>
      new VersionDeliveryWorker(
        client,
        store,
        new GiteaProvisionService(client, store),
        new GiteaCommitService(client),
      );
    const page = async () => {
      const id = randomUUID();
      await sql`INSERT INTO pages(id,workspace_id,space_id,slug_id,title,position,content,ydoc)
      VALUES(${id}::uuid,${workspaceId}::uuid,${spaceId}::uuid,'fixture','测试文档','a0','{"type":"doc"}'::jsonb,${Buffer.from([1, 2])})`.execute(
        db,
      );
      return id;
    };
    const save = (id: string, actors = [actorA], deleted = false) =>
      db.transaction().execute(async (trx) => {
        if (deleted)
          await trx
            .updateTable('pages')
            .set({ deletedAt: new Date() })
            .where('id', '=', id)
            .execute();
        return capture.capture(trx, {
          pageId: id,
          workspaceId,
          actorIds: actors,
          allowDeleted: deleted,
        });
      });
    const rows = async () =>
      (
        await sql<any>`SELECT * FROM sop_page_versions ORDER BY outbox_order`.execute(
          db,
        )
      ).rows;
    const ready = () =>
      sql`UPDATE sop_page_versions SET next_attempt_at=now() WHERE status='failed'`.execute(
        db,
      );
    const repo = () => [...client.repos.values()][0];
    const tree = () => repo().commits.get(repo().branches.get('main')).tree;
    it('creates one private repository and keeps both authenticated authors', async () => {
      await save(await page(), [actorA, actorB]);
      await worker.tick();
      expect(client.repos.size).toBe(1);
      expect(repo().private).toBe(true);
      expect((await rows())[0].status).toBe('synced');
      const written = client.requests.find(
        (r) => r.method === 'POST' && r.path.endsWith('/contents'),
      );
      expect(written.body.message).toContain('同事甲');
      expect(written.body.message).toContain('同事乙');
      expect(
        (await sql`SELECT * FROM sop_version_identities`.execute(db)).rows,
      ).toHaveLength(2);
    });
    it('serializes two documents in one space without replacing the other document', async () => {
      const a = await page(),
        b = await page();
      await save(a);
      await save(b, [actorB]);
      await worker.tick();
      await worker.tick();
      expect(client.repos.size).toBe(1);
      expect(client.writes).toBe(2);
      expect(tree().has(`pages/${a}/document.json`)).toBe(true);
      expect(tree().has(`pages/${b}/document.json`)).toBe(true);
    });
    it('two worker instances do not deliver the same task twice', async () => {
      await save(await page());
      await Promise.all([worker.tick(), makeWorker().tick()]);
      expect(client.writes).toBe(1);
      expect((await rows())[0].attempts).toBe(1);
    });
    it.each(['after-main', 'after-stage'] as const)(
      'recovers %s response loss without duplicate versions',
      async (fault) => {
        await save(await page());
        client.fault = fault;
        await worker.tick();
        expect((await rows())[0].status).toBe('failed');
        await ready();
        await makeWorker().tick();
        expect((await rows())[0].status).toBe('synced');
        expect(client.writes).toBe(1);
        expect(repo().commits.size).toBe(2);
      },
    );
    it('does not skip a failed predecessor', async () => {
      const a = await page();
      await save(a);
      await save(a, [actorB]);
      client.fault = 'before-stage';
      await worker.tick();
      await worker.tick();
      expect((await rows()).map((r) => r.status)).toEqual([
        'failed',
        'pending',
      ]);
      await ready();
      await worker.tick();
      await worker.tick();
      expect((await rows()).every((r) => r.status === 'synced')).toBe(true);
    });
    it('recovers a crashed worker lease using the same fixed task', async () => {
      await save(await page());
      const claim = await store.claim(workspaceId, spaceId);
      expect(claim).not.toBeNull();
      await sql`UPDATE sop_version_spaces SET lease_until=now()-interval '1 second'`.execute(
        db,
      );
      await makeWorker().tick();
      expect((await rows())[0].status).toBe('synced');
      expect(client.writes).toBe(1);
    });
    it('blocks an external main-branch edit rather than silently adopting it', async () => {
      const id = await page();
      await save(id);
      await worker.tick();
      const external = client.externalChange([...client.repos.keys()][0]);
      await save(id, [actorB]);
      await worker.tick();
      expect((await rows())[1].status).toBe('blocked');
      expect(repo().branches.get('main')).toBe(external);
      expect(client.writes).toBe(1);
    });
    it('atomically rejects a main-branch race after staging', async () => {
      await save(await page());
      client.fault = 'race-main';
      await worker.tick();
      expect((await rows())[0].status).toBe('blocked');
      expect(tree().has('unexpected.txt')).toBe(true);
      expect(client.writes).toBe(0);
      const update = client.requests.find((r) => r.method === 'PUT');
      expect(update.body.force).toBe(false);
      expect(update.body.old_commit_id).toBeTruthy();
    });
    it('rejects a repository that has become public', async () => {
      const id = await page();
      await save(id);
      await worker.tick();
      repo().private = false;
      await save(id);
      await worker.tick();
      expect((await rows())[1].lastErrorCode).toBe(
        'REPOSITORY_BINDING_CONFLICT',
      );
      expect(client.writes).toBe(1);
    });
    it('never recreates a missing previously-bound repository', async () => {
      const id = await page();
      await save(id);
      await worker.tick();
      client.repos.clear();
      await save(id);
      await worker.tick();
      expect((await rows())[1].lastErrorCode).toBe('REPOSITORY_MISSING');
      expect(client.repos.size).toBe(0);
    });
    it('does not permit mutation of a synced receipt', async () => {
      await save(await page());
      await worker.tick();
      await expect(
        sql`UPDATE sop_page_versions SET status='pending'`.execute(db),
      ).rejects.toThrow('immutable');
    });
    it('keeps identity stable when a contributor changes their profile name', async () => {
      const id = await page();
      await save(id);
      await worker.tick();
      const first = (
        await sql<any>`SELECT git_email FROM sop_version_identities`.execute(db)
      ).rows[0].gitEmail;
      await db
        .updateTable('users')
        .set({ name: '新的显示名' })
        .where('id', '=', actorA)
        .execute();
      await save(id);
      await worker.tick();
      expect(
        (
          await sql<any>`SELECT git_email FROM sop_version_identities`.execute(
            db,
          )
        ).rows[0].gitEmail,
      ).toBe(first);
      expect((await rows())[0].snapshot.actors[0].name).toBe('同事甲');
      expect((await rows())[1].snapshot.actors[0].name).toBe('新的显示名');
    });
    it('records deletion without erasing earlier snapshots and permits a later restore event', async () => {
      const id = await page();
      await save(id);
      await worker.tick();
      const first = repo().branches.get('main');
      await save(id, [actorA], true);
      await worker.tick();
      expect(tree().has(`pages/${id}/document.json`)).toBe(false);
      expect(
        repo().commits.get(first).tree.has(`pages/${id}/document.json`),
      ).toBe(true);
      await db
        .updateTable('pages')
        .set({ deletedAt: null })
        .where('id', '=', id)
        .execute();
      await save(id);
      await worker.tick();
      expect(tree().has(`pages/${id}/document.json`)).toBe(true);
      expect((await rows()).map((r) => r.revision)).toEqual([1, 2, 3]);
    });
    it('never fetches mutable current page content while delivering a fixed snapshot', async () => {
      const id = await page();
      await save(id);
      await db
        .updateTable('pages')
        .set({ title: '不属于这个版本' })
        .where('id', '=', id)
        .execute();
      await worker.tick();
      expect(JSON.parse(tree().get(`pages/${id}/document.json`)).title).toBe(
        '测试文档',
      );
    });
    it('blocks cross-space transfer of a versioned page until transfer protocol exists', async () => {
      const id = await page();
      await save(id);
      await db
        .updateTable('pages')
        .set({ spaceId: randomUUID() })
        .where('id', '=', id)
        .execute();
      await expect(save(id)).rejects.toThrow('Cross-space');
      expect(await rows()).toHaveLength(1);
    });
    const historyFor = (permission = jest.fn(async () => {})) => {
      const pages = {
        findById: async (id: string) =>
          db
            .selectFrom('pages')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst(),
      };
      return {
        service: new VersionHistoryService(
          db,
          pages as any,
          { validateCanView: permission } as any,
          client,
          {
            getUserRolesForSpaces: async () => [{ spaceId, role: 'writer' }],
          } as any,
          { canUserEditPage: async () => ({ canAccess: true }) } as any,
        ),
        permission,
      };
    };
    const viewer = () => ({ id: actorA, workspaceId }) as any;
    it('lists fixed revisions and reads the requested repository snapshot', async () => {
      const id = await page();
      const first = await save(id);
      await worker.tick();
      await db
        .updateTable('pages')
        .set({ title: '新版本标题' })
        .where('id', '=', id)
        .execute();
      await save(id);
      await worker.tick();
      const { service } = historyFor();
      const list = await service.list(id, viewer());
      expect(list.items.map((x) => x.revision)).toEqual([2, 1]);
      const old = await service.read(id, first.id, viewer());
      expect(old.title).toBe('测试文档');
      expect(old.revision).toBe(1);
      expect(
        (await service.list(id, viewer(), 2)).items.map((x) => x.revision),
      ).toEqual([1]);
    });
    it('refuses history access across workspaces before any repository request', async () => {
      const id = await page();
      const saved = await save(id);
      await worker.tick();
      client.requests = [];
      await expect(
        historyFor().service.read(id, saved.id, {
          id: actorB,
          workspaceId: randomUUID(),
        } as any),
      ).rejects.toThrow('Page not found');
      expect(client.requests).toHaveLength(0);
    });
    it('rechecks permissions after the remote snapshot has been fetched', async () => {
      const id = await page();
      const saved = await save(id);
      await worker.tick();
      const permission = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('revoked'));
      await expect(
        historyFor(permission).service.read(id, saved.id, viewer()),
      ).rejects.toThrow('revoked');
      expect(permission).toHaveBeenCalledTimes(2);
    });
    it('does not read an unsubmitted database snapshot as a repository version', async () => {
      const id = await page();
      const saved = await save(id);
      client.requests = [];
      await expect(
        historyFor().service.read(id, saved.id, viewer()),
      ).rejects.toThrow('not reached');
      expect(client.requests).toHaveLength(0);
    });
    it('rejects a version belonging to another document', async () => {
      const a = await page(),
        b = await page();
      const saved = await save(a);
      await worker.tick();
      await expect(
        historyFor().service.read(b, saved.id, viewer()),
      ).rejects.toThrow('Version not found');
    });
    it('rejects missing historical bytes instead of falling back to current content', async () => {
      const id = await page();
      const saved = await save(id);
      await worker.tick();
      tree().delete(`.sop/versions/${saved.id}.json`);
      await expect(
        historyFor().service.read(id, saved.id, viewer()),
      ).rejects.toThrow('unavailable or invalid');
    });
    it('rejects historical bytes whose digest does not match the saved task', async () => {
      const id = await page();
      const saved = await save(id);
      await worker.tick();
      const path = `.sop/versions/${saved.id}.json`;
      const bad = JSON.parse(tree().get(path));
      bad.snapshot.page.title = '被篡改';
      tree().set(path, JSON.stringify(bad));
      await expect(
        historyFor().service.read(id, saved.id, viewer()),
      ).rejects.toThrow('unavailable or invalid');
    });
    it('does not expose history after a repository visibility change', async () => {
      const id = await page();
      const saved = await save(id);
      await worker.tick();
      repo().private = false;
      await expect(
        historyFor().service.read(id, saved.id, viewer()),
      ).rejects.toThrow('unavailable or invalid');
    });
    it('does not render current media or transclusion content in old versions', async () => {
      const id = await page();
      const content = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '保留正文' }] },
          {
            type: 'image',
            attrs: { src: 'http://private.invalid/current.png' },
          },
          {
            type: 'transclusionReference',
            attrs: { sourcePageId: randomUUID() },
          },
        ],
      };
      await sql`UPDATE pages SET content=${JSON.stringify(content)}::text::jsonb WHERE id=${id}::uuid`.execute(
        db,
      );
      const saved = await save(id);
      await worker.tick();
      const result = await historyFor().service.read(id, saved.id, viewer());
      const rendered = JSON.stringify(result.content);
      expect(rendered).toContain('保留正文');
      expect(rendered).not.toContain('private.invalid');
      expect(rendered).not.toContain('transclusionReference');
      expect(rendered).toContain('未纳入');
    });

    const nativeServices = () => {
      const events = { emit: jest.fn() };
      const pages = new PageRepo(db, {} as any, events as any);
      const permissions = {
        canUserEditPage: jest.fn(async () => ({
          hasAnyRestriction: false,
          canAccess: true,
          canEdit: true,
        })),
      };
      const trash = new VersionedTrashService(
        db,
        pages,
        permissions as any,
        capture,
        events as any,
      );
      const queue = { add: jest.fn(async () => {}) };
      const watchers = { addPageWatchers: jest.fn(async () => {}) };
      const service = new PageService(
        pages,
        permissions as any,
        {} as any,
        db,
        {} as any,
        queue as any,
        queue as any,
        queue as any,
        events as any,
        {} as any,
        watchers as any,
        {} as any,
        capture,
        trash,
      );
      return { service, pages, events, permissions };
    };
    it('native page creation stores its first snapshot in the same transaction', async () => {
      const { service, events } = nativeServices();
      const created = await service.create(actorA, workspaceId, {
        spaceId,
        title: '原生创建',
      } as any);
      const versions = await rows();
      expect(versions).toHaveLength(1);
      expect(versions[0].pageId).toBe(created.id);
      expect(versions[0].snapshot.page.title).toBe('原生创建');
      expect(events.emit).toHaveBeenCalledTimes(1);
    });
    it('native creation rolls back page and suppresses events when capture fails', async () => {
      const { service, events } = nativeServices();
      jest
        .spyOn(capture, 'capture')
        .mockRejectedValueOnce(new Error('injected capture failure'));
      await expect(
        service.create(actorA, workspaceId, {
          spaceId,
          title: '不能保存',
        } as any),
      ).rejects.toThrow('injected');
      expect(await db.selectFrom('pages').select('id').execute()).toHaveLength(
        0,
      );
      expect(await rows()).toHaveLength(0);
      expect(events.emit).not.toHaveBeenCalled();
    });
    it('native metadata update identifies its author and creates no version for an unchanged title', async () => {
      const { service } = nativeServices();
      const created = await service.create(actorA, workspaceId, {
        spaceId,
        title: '初稿',
      } as any);
      const updated = await service.update(
        created,
        { pageId: created.id, title: '同事乙修订' } as any,
        { id: actorB, workspaceId } as any,
      );
      await service.update(
        updated,
        { pageId: created.id, title: '同事乙修订' } as any,
        { id: actorB, workspaceId } as any,
      );
      const versions = await rows();
      expect(versions).toHaveLength(2);
      expect(versions[1].snapshot.actors.map((a) => a.id)).toEqual([actorB]);
      expect(versions[1].snapshot.page.title).toBe('同事乙修订');
    });
    it('native metadata failure rolls back the title and produces no success event', async () => {
      const { service, events, pages } = nativeServices();
      const created = await service.create(actorA, workspaceId, {
        spaceId,
        title: '保留原文',
      } as any);
      events.emit.mockClear();
      jest
        .spyOn(capture, 'capture')
        .mockRejectedValueOnce(new Error('injected capture failure'));
      await expect(
        service.update(
          created,
          { pageId: created.id, title: '未批准内容' } as any,
          { id: actorB, workspaceId } as any,
        ),
      ).rejects.toThrow('injected');
      expect((await pages.findById(created.id)).title).toBe('保留原文');
      expect(await rows()).toHaveLength(1);
      expect(events.emit).not.toHaveBeenCalled();
    });
    it('native subtree trash and restoration capture every changed page', async () => {
      const { service } = nativeServices();
      const root = await service.create(actorA, workspaceId, {
        spaceId,
        title: '父文档',
      } as any);
      const child = await service.create(actorA, workspaceId, {
        spaceId,
        title: '子文档',
        parentPageId: root.id,
      } as any);
      await service.removePage(root.id, actorB, workspaceId);
      let versions = await rows();
      expect(versions).toHaveLength(4);
      expect(versions.slice(2).every((v) => v.snapshot.page.deletedAt)).toBe(
        true,
      );
      await service.restoreTrashedPage(root.id, workspaceId, actorB);
      versions = await rows();
      expect(versions).toHaveLength(6);
      expect(
        versions.slice(4).every((v) => v.snapshot.page.deletedAt === null),
      ).toBe(true);
      expect(new Set(versions.slice(4).map((v) => v.pageId))).toEqual(
        new Set([root.id, child.id]),
      );
    });
    it('native subtree trash does not remove restricted descendants', async () => {
      const { service, permissions } = nativeServices();
      const root = await service.create(actorA, workspaceId, {
        spaceId,
        title: '父文档',
      } as any);
      await service.create(actorA, workspaceId, {
        spaceId,
        title: '受限子文档',
        parentPageId: root.id,
      } as any);
      permissions.canUserEditPage.mockResolvedValue({
        hasAnyRestriction: true,
        canAccess: false,
        canEdit: false,
      });
      await expect(
        service.removePage(root.id, actorB, workspaceId),
      ).rejects.toThrow('restricted');
      expect(await rows()).toHaveLength(2);
      expect(
        (await db.selectFrom('pages').select('deletedAt').execute()).every(
          (p) => p.deletedAt === null,
        ),
      ).toBe(true);
    });
    it('native permanent deletion and cross-space moves are explicitly gated', async () => {
      const { service } = nativeServices();
      const root = await service.create(actorA, workspaceId, {
        spaceId,
        title: '保留历史',
      } as any);
      await expect(service.forceDelete(root.id, workspaceId)).rejects.toThrow(
        'retention',
      );
      await expect(
        service.movePageToSpace(root, randomUUID(), actorA),
      ).rejects.toThrow('transfer');
      expect(await rows()).toHaveLength(1);
    });
  },
);
