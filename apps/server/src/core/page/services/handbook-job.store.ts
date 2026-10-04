import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson } from '../../../integrations/versioning/version-snapshot';
export const handbookTargetToken=(target:any)=>target?createHash('sha256').update(canonicalJson({generation:target.generation,bindingHash:target.bindingHash,actorId:target.actorId,spaceId:target.spaceId,autoUpdate:target.autoUpdate})).digest('hex'):null;
import { KyselyDB } from '../../../database/types/kysely.types';

export interface HandbookTarget {
  workspaceId:string; pageId:string; spaceId:string; actorId:string; binding:any; bindingHash:string;
  generation:number; autoUpdate:boolean; desiredJobId:string|null; currentJobId:string|null; lastErrorCode:string|null;
}
export interface HandbookJob {
  id:string; workspaceId:string; pageId:string; spaceId:string; actorId:string; generation:number;
  versionId:string; revision:number; binding:any; bindingHash:string; rendererHash:string; assetStamp:string;
  state:'queued'|'running'|'succeeded'|'failed'|'superseded'; attempts:number;
  leaseToken:string|null; leaseUntil:Date|null; manifest:any; storagePrefix:string|null; lastErrorCode:string|null;
}
@Injectable()
export class HandbookJobStore {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}
  async target(workspaceId:string,pageId:string):Promise<HandbookTarget|undefined> {
    return (await sql<HandbookTarget>`SELECT * FROM sop_handbook_targets WHERE workspace_id=${workspaceId}::uuid AND page_id=${pageId}::uuid`.execute(this.db)).rows[0];
  }
  async job(workspaceId:string,pageId:string,id:string):Promise<HandbookJob|undefined> {
    return (await sql<HandbookJob>`SELECT * FROM sop_handbook_jobs WHERE workspace_id=${workspaceId}::uuid AND page_id=${pageId}::uuid AND id=${id}::uuid`.execute(this.db)).rows[0];
  }
  async configure(value:{workspaceId:string;pageId:string;spaceId:string;actorId:string;binding:any;bindingHash:string;autoUpdate:boolean}, guard?:{targetToken:string|null;versionId:string}) {
    return this.db.transaction().execute(async tx=>{
      const inserted=await sql`INSERT INTO sop_handbook_targets(workspace_id,page_id,space_id,actor_id,binding,binding_hash,auto_update)
        VALUES(${value.workspaceId}::uuid,${value.pageId}::uuid,${value.spaceId}::uuid,${value.actorId}::uuid,${JSON.stringify(value.binding)}::text::jsonb,${value.bindingHash},${value.autoUpdate})
        ON CONFLICT(workspace_id,page_id) DO NOTHING RETURNING page_id`.execute(tx);
      const old=(await sql<HandbookTarget>`SELECT * FROM sop_handbook_targets WHERE workspace_id=${value.workspaceId}::uuid AND page_id=${value.pageId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      if(guard){
        if(inserted.rows.length?guard.targetToken!==null:handbookTargetToken(old)!==guard.targetToken)throw new Error('LAYOUT_TARGET_CHANGED');
        const fixed=(await sql`SELECT v.id FROM sop_page_versions v JOIN pages p ON p.id=v.page_id AND p.workspace_id=v.workspace_id AND p.space_id=v.space_id
          WHERE v.id=${guard.versionId}::uuid AND v.page_id=${value.pageId}::uuid AND v.workspace_id=${value.workspaceId}::uuid AND v.space_id=${value.spaceId}::uuid
          AND v.status='synced' AND p.deleted_at IS NULL AND p.title=v.snapshot->'page'->>'title' AND p.content::jsonb=v.snapshot->'page'->'content'
          AND NOT EXISTS(SELECT 1 FROM sop_page_versions newer WHERE newer.workspace_id=v.workspace_id AND newer.page_id=v.page_id AND newer.revision>v.revision) FOR SHARE OF p`.execute(tx)).rows.length;
        if(fixed!==1)throw new Error('LAYOUT_SOURCE_CHANGED');
      }
      const changed=old.bindingHash.trim()!==value.bindingHash||old.actorId!==value.actorId||old.spaceId!==value.spaceId;
      if(changed) await sql`UPDATE sop_handbook_jobs SET state='superseded',completed_at=now() WHERE workspace_id=${value.workspaceId}::uuid AND page_id=${value.pageId}::uuid AND state IN('queued','running')`.execute(tx);
      return (await sql<HandbookTarget>`UPDATE sop_handbook_targets SET binding=${JSON.stringify(value.binding)}::text::jsonb,binding_hash=${value.bindingHash},actor_id=${value.actorId}::uuid,
        space_id=${value.spaceId}::uuid,auto_update=${value.autoUpdate},updated_at=now(),last_error_code=NULL,
        generation=generation+${changed?1:0},desired_job_id=CASE WHEN ${changed} THEN NULL ELSE desired_job_id END
        WHERE workspace_id=${value.workspaceId}::uuid AND page_id=${value.pageId}::uuid RETURNING *`.execute(tx)).rows[0];
    });
  }
  async request(workspaceId:string,pageId:string,version:{id:string;revision:number},rendererHash:string,retry=false,assetStamp='0'.repeat(64)) {
    return this.db.transaction().execute(async tx=>{
      const target=(await sql<HandbookTarget>`SELECT * FROM sop_handbook_targets WHERE workspace_id=${workspaceId}::uuid AND page_id=${pageId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      if(!target) throw new Error('HANDBOOK_NOT_CONFIGURED');
      const previous=target.desiredJobId?(await sql<HandbookJob>`SELECT * FROM sop_handbook_jobs WHERE id=${target.desiredJobId}::uuid`.execute(tx)).rows[0]:null;
      if(previous&&previous.versionId===version.id&&previous.bindingHash===target.bindingHash&&previous.rendererHash===rendererHash&&previous.assetStamp===assetStamp&&
        (['queued','running'].includes(previous.state)||(!retry&&['succeeded','failed'].includes(previous.state))))return previous;
      if(previous&&version.revision<previous.revision)throw new Error('OLDER_REQUEST_REJECTED');
      const id=randomUUID(),generation=target.generation+1;
      await sql`UPDATE sop_handbook_jobs SET state='superseded',completed_at=now() WHERE workspace_id=${workspaceId}::uuid AND page_id=${pageId}::uuid AND state IN('queued','running')`.execute(tx);
      const job=(await sql<HandbookJob>`INSERT INTO sop_handbook_jobs(id,workspace_id,page_id,space_id,actor_id,generation,version_id,revision,binding,binding_hash,renderer_hash,asset_stamp)
        VALUES(${id}::uuid,${workspaceId}::uuid,${pageId}::uuid,${target.spaceId}::uuid,${target.actorId}::uuid,${generation},${version.id}::uuid,${version.revision},${JSON.stringify(target.binding)}::text::jsonb,${target.bindingHash},${rendererHash},${assetStamp}) RETURNING *`.execute(tx)).rows[0];
      await sql`UPDATE sop_handbook_targets SET desired_job_id=${id}::uuid,generation=${generation},last_error_code=NULL,updated_at=now() WHERE workspace_id=${workspaceId}::uuid AND page_id=${pageId}::uuid`.execute(tx);
      return job;
    });
  }
  async candidates() {
    return (await sql<HandbookTarget>`WITH due AS (SELECT workspace_id,page_id FROM sop_handbook_targets WHERE auto_update=true ORDER BY last_polled_at,page_id FOR UPDATE SKIP LOCKED LIMIT 50)
      UPDATE sop_handbook_targets t SET last_polled_at=now() FROM due d WHERE t.workspace_id=d.workspace_id AND t.page_id=d.page_id RETURNING t.*`.execute(this.db)).rows;
  }
  async stopAutomatic(workspaceId:string,pageId:string,code:string) {
    await sql`UPDATE sop_handbook_targets SET auto_update=false,last_error_code=${code},updated_at=now() WHERE workspace_id=${workspaceId}::uuid AND page_id=${pageId}::uuid`.execute(this.db);
  }
  async claim():Promise<HandbookJob|undefined> {
    await sql`UPDATE sop_handbook_jobs SET state='failed',last_error_code='LEASE_EXHAUSTED',completed_at=now()
      WHERE state='running' AND lease_until<now() AND attempts>=3`.execute(this.db);
    const token=randomUUID();
    return (await sql<HandbookJob>`WITH candidate AS (
      SELECT j.id FROM sop_handbook_jobs j JOIN sop_handbook_targets t ON t.workspace_id=j.workspace_id AND t.page_id=j.page_id AND t.desired_job_id=j.id
      WHERE (j.state='queued' AND j.next_attempt_at<=now() OR j.state='running' AND j.lease_until<now()) AND j.attempts<3
      ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1
    ) UPDATE sop_handbook_jobs j SET state='running',attempts=attempts+1,lease_token=${token}::uuid,lease_until=now()+interval '120 seconds'
      FROM candidate c WHERE j.id=c.id RETURNING j.*`.execute(this.db)).rows[0];
  }
  async heartbeat(job:HandbookJob) {
    return (await sql`UPDATE sop_handbook_jobs SET lease_until=now()+interval '120 seconds' WHERE id=${job.id}::uuid AND state='running' AND lease_token=${job.leaseToken}::uuid AND lease_until>now() RETURNING id`.execute(this.db)).rows.length===1;
  }
  async finish(job:HandbookJob,manifest:any,prefix:string):Promise<boolean> {
    return this.db.transaction().execute(async tx=>{
      const target=(await sql<HandbookTarget>`SELECT * FROM sop_handbook_targets WHERE workspace_id=${job.workspaceId}::uuid AND page_id=${job.pageId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      const eligible=target?.desiredJobId===job.id&&target.generation===job.generation&&target.bindingHash===job.bindingHash;
      // Atomic source freshness check also rejects edits not captured as a version yet.
      const source=(await sql`SELECT v.id FROM sop_page_versions v JOIN pages p ON p.id=v.page_id AND p.workspace_id=v.workspace_id AND p.space_id=v.space_id
        WHERE v.id=${job.versionId}::uuid AND v.workspace_id=${job.workspaceId}::uuid AND v.page_id=${job.pageId}::uuid AND v.status='synced' AND p.deleted_at IS NULL
        AND p.title=v.snapshot->'page'->>'title' AND p.content::jsonb=v.snapshot->'page'->'content'
        AND NOT EXISTS(SELECT 1 FROM sop_page_versions newer WHERE newer.workspace_id=v.workspace_id AND newer.page_id=v.page_id AND newer.revision>v.revision) FOR SHARE OF p`.execute(tx)).rows.length===1;
      if(!eligible||!source){await sql`UPDATE sop_handbook_jobs SET state='superseded',completed_at=now() WHERE id=${job.id}::uuid AND state='running' AND lease_token=${job.leaseToken}::uuid`.execute(tx);return false;}
      const done=(await sql`UPDATE sop_handbook_jobs SET state='succeeded',manifest=${JSON.stringify(manifest)}::text::jsonb,storage_prefix=${prefix},completed_at=now(),last_error_code=NULL
        WHERE id=${job.id}::uuid AND state='running' AND lease_token=${job.leaseToken}::uuid AND lease_until>now() RETURNING id`.execute(tx)).rows.length;
      if(!done)return false;
      await sql`UPDATE sop_handbook_targets SET current_job_id=${job.id}::uuid,last_error_code=NULL,updated_at=now() WHERE workspace_id=${job.workspaceId}::uuid AND page_id=${job.pageId}::uuid`.execute(tx);
      return true;
    });
  }
  async fail(job:HandbookJob,code:string,retryable:boolean) {
    const retry=retryable&&job.attempts<3;
    const rows=(await sql`UPDATE sop_handbook_jobs SET state=${retry?'queued':'failed'},last_error_code=${code},lease_until=NULL,
      next_attempt_at=now()+(${Math.min(60,5*2**job.attempts)} * interval '1 second'),completed_at=CASE WHEN ${retry} THEN NULL ELSE now() END
      WHERE id=${job.id}::uuid AND state='running' AND lease_token=${job.leaseToken}::uuid AND lease_until>now() RETURNING id`.execute(this.db)).rows;
    if(rows.length)await sql`UPDATE sop_handbook_targets SET last_error_code=${code},updated_at=now() WHERE workspace_id=${job.workspaceId}::uuid AND page_id=${job.pageId}::uuid AND desired_job_id=${job.id}::uuid`.execute(this.db);
  }
}
