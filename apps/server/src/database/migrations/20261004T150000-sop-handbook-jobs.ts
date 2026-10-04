import { Kysely, sql } from 'kysely';

/** Display requests/results reference existing source versions, never a second content history. */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE sop_handbook_targets (
    workspace_id uuid NOT NULL, page_id uuid NOT NULL, space_id uuid NOT NULL,
    actor_id uuid NOT NULL, binding jsonb NOT NULL, binding_hash char(64) NOT NULL,
    auto_update boolean NOT NULL DEFAULT false, generation integer NOT NULL DEFAULT 0,
    desired_job_id uuid, current_job_id uuid, last_error_code text,
    last_polled_at timestamptz NOT NULL DEFAULT to_timestamp(0), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(workspace_id,page_id), CHECK (generation >= 0)
  )`.execute(db);
  await sql`CREATE TABLE sop_handbook_jobs (
    id uuid PRIMARY KEY, workspace_id uuid NOT NULL, page_id uuid NOT NULL,
    space_id uuid NOT NULL, actor_id uuid NOT NULL, generation integer NOT NULL,
    version_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
    binding jsonb NOT NULL, binding_hash char(64) NOT NULL, renderer_hash char(64) NOT NULL, asset_stamp char(64) NOT NULL,
    state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','succeeded','failed','superseded')),
    attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error_code text,
    manifest jsonb, storage_prefix text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    UNIQUE(workspace_id,page_id,generation),
    CHECK(state <> 'succeeded' OR (manifest IS NOT NULL AND storage_prefix IS NOT NULL))
  )`.execute(db);
  await sql`CREATE INDEX sop_handbook_job_claim ON sop_handbook_jobs(next_attempt_at,created_at)
    WHERE state IN('queued','running')`.execute(db);
}
export async function down(db: Kysely<any>): Promise<void> {
  const drop = async (tx: Kysely<any>) => {
    await sql`LOCK TABLE sop_handbook_targets,sop_handbook_jobs IN ACCESS EXCLUSIVE MODE`.execute(tx);
    const row = (await sql<{n:string}>`SELECT count(*)::text AS n FROM sop_handbook_jobs`.execute(tx)).rows[0];
    if(row.n !== '0') throw new Error('Retain generated history; disable the display runtime instead');
    await sql`DROP TABLE sop_handbook_jobs,sop_handbook_targets`.execute(tx);
  };
  if(db.isTransaction) await drop(db); else await db.transaction().execute(drop);
}
