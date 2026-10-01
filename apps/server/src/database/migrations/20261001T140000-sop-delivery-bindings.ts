import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE sop_version_spaces (
    workspace_id uuid NOT NULL, space_id uuid NOT NULL,
    org_name text NOT NULL, repo_name text NOT NULL,
    repo_id bigint, head_sha text,
    lease_id uuid, lease_until timestamptz,
    PRIMARY KEY (workspace_id, space_id), UNIQUE (org_name, repo_name),
    CHECK (head_sha IS NULL OR head_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
    CHECK ((lease_id IS NULL) = (lease_until IS NULL))
  )`.execute(db);
  await sql`CREATE TABLE sop_version_identities (
    workspace_id uuid NOT NULL, user_id uuid NOT NULL,
    git_email text NOT NULL UNIQUE,
    PRIMARY KEY (workspace_id, user_id)
  )`.execute(db);
  await sql`CREATE FUNCTION sop_protect_synced_delivery() RETURNS trigger AS $$
    BEGIN
      IF OLD.status = 'synced' AND
        (NEW.status IS DISTINCT FROM OLD.status OR NEW.commit_sha IS DISTINCT FROM OLD.commit_sha
         OR NEW.synced_at IS DISTINCT FROM OLD.synced_at) THEN
        RAISE EXCEPTION 'A synced delivery receipt is immutable';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql`.execute(db);
  await sql`CREATE TRIGGER sop_synced_delivery_immutable
    BEFORE UPDATE ON sop_page_versions FOR EACH ROW
    EXECUTE FUNCTION sop_protect_synced_delivery()`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  const drop = async (trx: Kysely<any>) => {
    await sql`LOCK TABLE sop_page_versions, sop_version_spaces, sop_version_identities IN ACCESS EXCLUSIVE MODE`.execute(
      trx,
    );
    const result = await sql<{ count: string }>`SELECT
      ((SELECT count(*) FROM sop_version_spaces) +
       (SELECT count(*) FROM sop_version_identities))::text AS count`.execute(
      trx,
    );
    if (result.rows[0].count !== '0')
      throw new Error('Refusing to remove existing version bindings');
    await sql`DROP TRIGGER sop_synced_delivery_immutable ON sop_page_versions`.execute(
      trx,
    );
    await sql`DROP FUNCTION sop_protect_synced_delivery()`.execute(trx);
    await sql`DROP TABLE sop_version_spaces, sop_version_identities`.execute(
      trx,
    );
  };
  if (db.isTransaction) await drop(db);
  else await db.transaction().execute(drop);
}
