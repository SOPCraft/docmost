import { Kysely, sql } from 'kysely';

/** No foreign-key cascade: deleting a live page must not erase its history. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE sop_page_versions (
      id uuid PRIMARY KEY,
      outbox_order bigserial NOT NULL UNIQUE,
      workspace_id uuid NOT NULL,
      space_id uuid NOT NULL,
      page_id uuid NOT NULL,
      revision integer NOT NULL CHECK (revision > 0),
      snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
      snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
      status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'synced', 'failed', 'blocked')),
      attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      commit_sha text CHECK (commit_sha IS NULL OR commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      synced_at timestamptz,
      UNIQUE (workspace_id, page_id, revision),
      CHECK (status <> 'synced' OR (commit_sha IS NOT NULL AND synced_at IS NOT NULL))
    )
  `.execute(db);
  await sql`
    CREATE INDEX sop_page_versions_pending_idx
      ON sop_page_versions (workspace_id, space_id, outbox_order)
      WHERE status <> 'synced'
  `.execute(db);
  await sql`
    CREATE FUNCTION sop_protect_version_snapshot() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Version snapshots are append-only';
      END IF;
      IF (to_jsonb(NEW) - ARRAY['status','attempts','commit_sha','next_attempt_at','last_error_code','synced_at'])
        IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','attempts','commit_sha','next_attempt_at','last_error_code','synced_at']) THEN
        RAISE EXCEPTION 'Version snapshot content is immutable';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `.execute(db);
  await sql`
    CREATE TRIGGER sop_page_versions_immutable
      BEFORE UPDATE OR DELETE ON sop_page_versions
      FOR EACH ROW EXECUTE FUNCTION sop_protect_version_snapshot()
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  if (db.isTransaction) return dropEmptyVersionTable(db);
  await db.transaction().execute(dropEmptyVersionTable);
}

async function dropEmptyVersionTable(db: Kysely<any>): Promise<void> {
  // Retain the lock until commit so a capture cannot race the empty-table check.
  await sql`LOCK TABLE sop_page_versions IN ACCESS EXCLUSIVE MODE`.execute(db);
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count FROM sop_page_versions
  `.execute(db);
  if (result.rows[0].count !== '0') {
    throw new Error('Refusing to drop saved versions; disable capture instead');
  }
  await sql`DROP TABLE sop_page_versions`.execute(db);
  await sql`DROP FUNCTION sop_protect_version_snapshot()`.execute(db);
}
