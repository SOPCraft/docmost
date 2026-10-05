import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, OnApplicationBootstrap, OnApplicationShutdown, Logger, HttpException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '../../../database/types/kysely.types';
import { User } from '../../../database/types/entity.types';
import { UserRepo } from '../../../database/repos/user/user.repo';
import { PageRepo } from '../../../database/repos/page/page.repo';
import { AttachmentRepo } from '../../../database/repos/attachment/attachment.repo';
import { SpaceMemberRepo } from '../../../database/repos/space/space-member.repo';
import { PagePermissionRepo } from '../../../database/repos/page/page-permission.repo';
import { StorageService } from '../../../integrations/storage/storage.service';
import { VersionHistoryService } from './version-history.service';
import { PiWorkbenchService } from './pi-workbench.service';
import { HandbookJobStore, HandbookJob, handbookTargetToken } from './handbook-job.store';
import { canonicalJson } from '../../../integrations/versioning/version-snapshot';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute=promisify(execFile);
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const contentHash=(v:any)=>hash(canonicalJson({title:v.title,content:v.content}));
const idPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const filePattern=/^(index\.html|source\.html|handbook\.css|editorial\.css|reader\.js|flow-reader\.(css|js)|vendor\/(basecoat|typeset)\.css|assets\/[a-f0-9]{64}\.(png|jpg|webp|mp4))$/;
export const handbookFilePattern=filePattern;
@Injectable()
export class HandbookService implements OnApplicationBootstrap,OnApplicationShutdown {
  private readonly logger=new Logger(HandbookService.name);
  private timer:ReturnType<typeof setTimeout>;private running:Promise<void>|null=null;private stopped=false;
  private readonly layoutProposals=new Map<string,{expiresAt:number;workspaceId:string;actorId:string;pageId:string;spaceId:string;versionId:string;sourceHash:string;assetStamp:string;rendererHash:string;targetToken:string;binding:any;bindingHash:string;summary:any}>();
  private readonly runtime=path.resolve(process.cwd(),'.sop-display-runtime');
  constructor(@InjectKysely() private readonly db:KyselyDB,private readonly store:HandbookJobStore,
    private readonly history:VersionHistoryService,private readonly users:UserRepo,private readonly pages:PageRepo,
    private readonly attachments:AttachmentRepo,private readonly storage:StorageService,
    private readonly members:SpaceMemberRepo,private readonly permissions:PagePermissionRepo,private readonly workbench:PiWorkbenchService){}
  async configuration() {
    try{
      const config=JSON.parse(await fs.readFile(path.join(this.runtime,'config.json'),'utf8'));
      if(config.enabled!==true||config.origin!=='http://127.0.0.1:3026')return null;
      const lock=JSON.parse(await fs.readFile(path.join(this.runtime,'renderer-lock.json'),'utf8'));
      if(!Array.isArray(lock.files)||!lock.files.length)throw new Error();
      for(const item of lock.files){if(!/^[a-z0-9./_-]+$/i.test(item.path)||item.path.includes('..')||path.isAbsolute(item.path))throw new Error();
        const f=path.join(this.runtime,'renderer',item.path);if(await fs.realpath(f)!==f||hash(await fs.readFile(f))!==item.sha256)throw new Error();}
      if(!lock.files.some(x=>x.path==='backend-runner.mjs'))throw new Error();
      return {origin:config.origin,rendererHash:hash(canonicalJson(lock.files)),runner:path.join(this.runtime,'renderer/backend-runner.mjs')};
    }catch(e){if(e instanceof Error&&'code' in e&&e.code==='ENOENT')return null;throw new ServiceUnavailableException('HANDBOOK_RUNTIME_INVALID');}
  }
  private async access(pageId:string,user:User,edit=false){
    if(!idPattern.test(pageId))throw new NotFoundException();
    const active=await this.users.findById(user.id,user.workspaceId);
    if(!active||active.deletedAt||active.deactivatedAt)throw new ForbiddenException('ACCOUNT_UNAVAILABLE');
    const page=await this.history.displayAccess(pageId,active);
    if(edit){const roles=await this.members.getUserRolesForSpaces(active.id,[page.spaceId]);const p=await this.permissions.canUserEditPage(active.id,page.id,{fresh:true});
      if(!roles.some(r=>['admin','writer'].includes(r.role))||!p.canAccess||(p.hasAnyRestriction&&!p.canEdit))throw new ForbiddenException('EDIT_PERMISSION_REQUIRED');}
    return {user:active,page};
  }
  private async latest(pageId:string,user:User){
    const list=await this.history.list(pageId,user,undefined,{summaries:false});
    const row=list.items[0];if(!row||row.status!=='synced')throw new ConflictException('SOURCE_VERSION_PENDING');return row;
  }
  private async layoutRunner(c:{runner:string},payload:any){
    const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'sop-handbook-'));
    try{await fs.writeFile(path.join(scratch,'input.json'),JSON.stringify(payload));const result=await execute(process.execPath,[c.runner,scratch],{timeout:20000,maxBuffer:4*1024*1024});return JSON.parse(result.stdout);}
    catch(e){const detail=String(e instanceof Error&&'stderr' in e?e.stderr:'');const code=detail.match(/LAYOUT_INPUT:([a-zA-Z0-9_-]+)/)?.[1];throw new BadRequestException(code?'LAYOUT_INPUT:'+code:'LAYOUT_REQUIRED');}
    finally{await fs.rm(scratch,{recursive:true,force:true});}
  }
  async layoutOptions(pageId:string,user:User){const c=await this.configuration();if(!c)throw new ServiceUnavailableException('HANDBOOK_DISABLED');await this.access(pageId,user);return this.layoutRunner(c,{mode:'catalog'});}
  private async prepareLayout(pageId:string,selection:{id:string;version:string;density:string},user:User){
    const c=await this.configuration();if(!c)throw new ServiceUnavailableException('HANDBOOK_DISABLED');
    const access=await this.access(pageId,user,true),targetState=await this.store.target(user.workspaceId,pageId);
    if(targetState&&targetState.spaceId!==access.page.spaceId)throw new ConflictException('SOURCE_MOVED');
    const version=await this.latest(pageId,access.user),source=await this.history.displaySource(pageId,version.id,access.user),catalog=await this.layoutRunner(c,{mode:'catalog'});
    if(!Array.isArray(catalog)||!catalog.length)throw new ServiceUnavailableException('LAYOUT_CATALOG_UNAVAILABLE');
    const decision=await this.workbench.planLayout({pageId,versionId:version.id,templates:catalog,preferred:{templateId:selection.id,templateVersion:selection.version,density:selection.density}},access.user);
    const assetStamp=await this.mediaStamp(source.content,access.user,c.origin),target={pageId,versionId:version.id,url:c.origin+'/s/general/p/'+access.page.slugId};
    const chosen={id:decision.template.id,version:decision.template.version,density:decision.density,groups:decision.groups,planner:decision.planner,model:decision.model,notes:decision.notes};
    const plan=await this.layoutRunner(c,{mode:'plan',source,target,selection:chosen});
    if(!plan.binding||plan.summary?.modelUsed!==true||Buffer.byteLength(JSON.stringify(plan.binding))>256*1024)throw new BadRequestException('LAYOUT_MODEL_REQUIRED');
    const token=handbookTargetToken(targetState),bindingHash=hash(canonicalJson(plan.binding));
    const proposalHash=hash(canonicalJson({workspaceId:user.workspaceId,actorId:user.id,pageId,sourceVersion:version.id,snapshot:source.snapshotSha256,bindingHash,rendererHash:c.rendererHash,assetStamp,targetToken:token,planner:decision.planner,model:decision.model}));
    if(canonicalJson(await this.history.displaySource(pageId,version.id,access.user))!==canonicalJson(source))throw new ConflictException('LAYOUT_SOURCE_CHANGED');
    await this.access(pageId,access.user,true);
    return {access,plan,token,bindingHash,version,proposalHash,sourceHash:hash(canonicalJson(source)),assetStamp,rendererHash:c.rendererHash,decision};
  }
  async previewLayout(pageId:string,selection:{id:string;version:string;density:string},user:User){
    const p=await this.prepareLayout(pageId,selection,user),now=Date.now();
    for(const [key,value] of this.layoutProposals)if(value.expiresAt<=now||(value.workspaceId===user.workspaceId&&value.actorId===user.id&&value.pageId===pageId))this.layoutProposals.delete(key);
    while(this.layoutProposals.size>=100){const oldest=this.layoutProposals.keys().next().value;if(!oldest)break;this.layoutProposals.delete(oldest);}
    this.layoutProposals.set(p.proposalHash,{expiresAt:now+10*60*1000,workspaceId:user.workspaceId,actorId:user.id,pageId,spaceId:p.access.page.spaceId,versionId:p.version.id,sourceHash:p.sourceHash,assetStamp:p.assetStamp,rendererHash:p.rendererHash,targetToken:p.token,binding:p.plan.binding,bindingHash:p.bindingHash,summary:p.plan.summary});
    return {proposalHash:p.proposalHash,versionId:p.version.id,revision:p.version.revision,summary:p.plan.summary,recommendation:{templateId:p.decision.template.id,templateVersion:p.decision.template.version,density:p.decision.density}};
  }
  async applyLayout(pageId:string,_selection:{id:string;version:string;density:string},proposalHash:string,autoUpdate:boolean,user:User){
    const p=this.layoutProposals.get(proposalHash);if(!p||p.expiresAt<=Date.now()){this.layoutProposals.delete(proposalHash);throw new ConflictException('LAYOUT_PREVIEW_CHANGED');}
    if(p.workspaceId!==user.workspaceId||p.actorId!==user.id||p.pageId!==pageId)throw new ConflictException('LAYOUT_PREVIEW_CHANGED');
    const c=await this.configuration();if(!c||c.rendererHash!==p.rendererHash)throw new ConflictException('LAYOUT_PREVIEW_CHANGED');
    const access=await this.access(pageId,user,true);if(access.page.spaceId!==p.spaceId)throw new ConflictException('SOURCE_MOVED');
    const targetState=await this.store.target(user.workspaceId,pageId);if(handbookTargetToken(targetState)!==p.targetToken)throw new ConflictException('LAYOUT_TARGET_CHANGED');
    const latest=await this.latest(pageId,access.user);if(latest.id!==p.versionId)throw new ConflictException('LAYOUT_SOURCE_CHANGED');
    const source=await this.history.displaySource(pageId,p.versionId,access.user);if(hash(canonicalJson(source))!==p.sourceHash||await this.mediaStamp(source.content,access.user,c.origin)!==p.assetStamp)throw new ConflictException('LAYOUT_SOURCE_CHANGED');
    try{await this.store.configure({workspaceId:user.workspaceId,pageId,spaceId:p.spaceId,actorId:user.id,binding:p.binding,bindingHash:p.bindingHash,autoUpdate},{targetToken:p.targetToken,versionId:p.versionId});}
    catch(e){if(e instanceof Error&&['LAYOUT_TARGET_CHANGED','LAYOUT_SOURCE_CHANGED'].includes(e.message))throw new ConflictException(e.message);throw e;}
    this.layoutProposals.delete(proposalHash);
    // Configuration is durable even if a new source edit postpones the subsequent job.
    return this.refresh(pageId,user);
  }
  async configure(pageId:string,binding:any,autoUpdate:boolean,user:User){
    const c=await this.configuration();if(!c)throw new ServiceUnavailableException('HANDBOOK_DISABLED');
    const access=await this.access(pageId,user,true);const latest=await this.latest(pageId,access.user);
    if(!binding||Buffer.byteLength(JSON.stringify(binding))>256*1024)throw new BadRequestException('INVALID_LAYOUT');
    const source=await this.history.displaySource(pageId,latest.id,access.user);
    const target={pageId,versionId:latest.id,url:c.origin+'/s/general/p/'+access.page.slugId};
    const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'sop-handbook-'));
    try{await fs.writeFile(path.join(scratch,'input.json'),JSON.stringify({mode:'validate',source,target,binding}));await execute(process.execPath,[c.runner,scratch],{timeout:20000,maxBuffer:1048576});}
    catch{throw new BadRequestException('LAYOUT_REQUIRED');}finally{await fs.rm(scratch,{recursive:true,force:true});}
    await this.access(pageId,access.user,true);
    await this.store.configure({workspaceId:user.workspaceId,pageId,spaceId:access.page.spaceId,actorId:user.id,binding,bindingHash:hash(canonicalJson(binding)),autoUpdate});
    return this.status(pageId,user);
  }
  async refresh(pageId:string,user:User){
    const c=await this.configuration();if(!c)throw new ServiceUnavailableException('HANDBOOK_DISABLED');
    const access=await this.access(pageId,user,true),target=await this.store.target(user.workspaceId,pageId);
    if(!target)throw new ConflictException('LAYOUT_NOT_CONFIGURED');
    if(target.spaceId!==access.page.spaceId)throw new ConflictException('SOURCE_MOVED');
    if(target.actorId!==user.id)await this.store.configure({...target,actorId:user.id});
    const latest=await this.latest(pageId,access.user);
    const actual=await this.pages.findById(pageId,{includeContent:true});
    await this.store.request(user.workspaceId,pageId,latest,c.rendererHash,true,await this.mediaStamp(actual.content,access.user,c.origin));
    return this.status(pageId,user);
  }
  async automatic(pageId:string,enabled:boolean,user:User){
    const {page}=await this.access(pageId,user,true),target=await this.store.target(user.workspaceId,pageId);
    if(!target)throw new ConflictException('LAYOUT_NOT_CONFIGURED');if(target.spaceId!==page.spaceId)throw new ConflictException('SOURCE_MOVED');
    await this.store.configure({...target,actorId:user.id,autoUpdate:enabled});return this.status(pageId,user);
  }
  private async asset(url:string,user:User,origin:string){
    let u:URL;try{u=new URL(url);}catch{throw new NotFoundException('MEDIA_UNAVAILABLE');}
    if(u.origin!==origin||u.search||u.hash||u.username||u.password||!/^\/api\/files\/[a-f0-9-]{36}\/[^/]+$/i.test(u.pathname))throw new NotFoundException('MEDIA_UNAVAILABLE');
    const id=u.pathname.split('/')[3],a=await this.attachments.findById(id);
    if(!a||a.workspaceId!==user.workspaceId||a.deletedAt||a.aiChatId||!a.pageId||!a.spaceId||Number(a.fileSize)>128*1024*1024)throw new NotFoundException('MEDIA_UNAVAILABLE');
    const {page}=await this.access(a.pageId,user);if(page.spaceId!==a.spaceId)throw new NotFoundException('MEDIA_UNAVAILABLE');
    if(!await this.storage.exists(a.filePath))throw new NotFoundException('MEDIA_UNAVAILABLE');return a;
  }
  private async mediaStamp(content:any,user:User,origin:string){const items=[];for(const url of this.refs(content,origin)){const a=await this.asset(url,user,origin);items.push({url,id:a.id,updatedAt:a.updatedAt instanceof Date?a.updatedAt.toISOString():String(a.updatedAt),size:Number(a.fileSize)});}return hash(canonicalJson(items));}
  private refs(content:any,origin:string){const map=new Map<string,string>();
    const walk=(n:any)=>{if(['image','video'].includes(n.type)){const u=new URL(n.attrs.src);if(u.origin!==origin||u.pathname.split('/')[3]!==n.attrs.attachmentId)throw new BadRequestException('INVALID_MEDIA_REFERENCE');map.set(u.href,n.type);}for(const c of n.content||[])walk(c);};walk(content);return [...map.keys()];
  }
  private async verifyAssets(manifest:any,user:User,origin:string){for(const a of manifest.assets||[])await this.asset(a.url,user,origin);}
  async status(pageId:string,user:User,viewingJobId?:string){
    const c=await this.configuration();if(!c)return {enabled:false,configured:false};
    const access=await this.access(pageId,user),target=await this.store.target(user.workspaceId,pageId);
    if(!target)return {enabled:true,configured:false};if(target.spaceId!==access.page.spaceId)throw new ForbiddenException('SOURCE_MOVED');
    const current=target.currentJobId?await this.store.job(user.workspaceId,pageId,target.currentJobId):null;
    const desired=target.desiredJobId?await this.store.job(user.workspaceId,pageId,target.desiredJobId):null;
    const actual=await this.pages.findById(pageId,{includeContent:true});
    const latest=(await sql<{id:string}>`SELECT id FROM sop_page_versions WHERE workspace_id=${user.workspaceId}::uuid AND page_id=${pageId}::uuid ORDER BY revision DESC LIMIT 1`.execute(this.db)).rows[0];
    let assetsAccessible=true;if(current)try{await this.verifyAssets(current.manifest,access.user,c.origin);}catch{assetsAccessible=false;}
    if(viewingJobId){const viewed=await this.store.job(user.workspaceId,pageId,viewingJobId);if(!viewed||viewed.state!=='succeeded'||viewed.spaceId!==access.page.spaceId)throw new NotFoundException();
      try{await this.verifyAssets(viewed.manifest,access.user,c.origin);}catch{assetsAccessible=false;}}
    let assetStamp='';try{assetStamp=await this.mediaStamp(actual.content,access.user,c.origin);}catch{}
    const outdated=!!current&&(contentHash(actual)!==current.manifest.freshness||latest?.id!==current.versionId||target.bindingHash!==current.bindingHash||c.rendererHash!==current.rendererHash||assetStamp!==current.assetStamp);
    return {enabled:true,configured:true,autoUpdate:target.autoUpdate,template:target.binding.template,desiredJobId:desired?.id||null,
      state:desired?.state||'idle',attempts:desired?.attempts||0,errorCode:desired?.lastErrorCode||target.lastErrorCode||null,outdated,
      current:current&&assetsAccessible?{jobId:current.id,pageId:current.manifest.pageId,revision:current.revision,versionId:current.versionId,
      url:'/api/pages/handbook/view/'+pageId+'/'+current.id+'/index.html'}:null,assetsAccessible};
  }
  async file(pageId:string,jobId:string,file:string,user:User){
    const c=await this.configuration();if(!c)throw new ServiceUnavailableException('HANDBOOK_DISABLED');
    if(!idPattern.test(jobId)||!filePattern.test(file))throw new NotFoundException();
    const access=await this.access(pageId,user),job=await this.store.job(user.workspaceId,pageId,jobId);
    if(!job||job.state!=='succeeded'||job.spaceId!==access.page.spaceId)throw new NotFoundException();
    const entry=[...job.manifest.renderFiles,...job.manifest.assets.map(a=>({path:a.output,sha256:a.sha256}))].find(f=>f.path===file);
    if(!entry)throw new NotFoundException();await this.verifyAssets(job.manifest,access.user,c.origin);
    const bytes=await this.storage.read(job.storagePrefix+'/'+file);if(hash(bytes)!==entry.sha256)throw new ServiceUnavailableException('RESULT_INTEGRITY_FAILED');
    await this.verifyAssets(job.manifest,access.user,c.origin);await this.access(pageId,access.user);return {bytes,job};
  }
  onApplicationBootstrap(){const next=()=>{this.timer=setTimeout(async()=>{try{await this.tick();}catch{this.logger.warn('Handbook update deferred; persistent requests retained');}if(!this.stopped)next();},5000);this.timer.unref();};next();}
  async onApplicationShutdown(){this.stopped=true;clearTimeout(this.timer);await this.running;}
  async tick(){if(this.running)return this.running;if(this.stopped)return;this.running=this.run();try{await this.running;}finally{this.running=null;}}
  private async run(){
    const c=await this.configuration();if(!c)return;
    for(const target of await this.store.candidates()){
      try{const actor=await this.users.findById(target.actorId,target.workspaceId);if(!actor)throw new ForbiddenException();const {page}=await this.access(target.pageId,actor,true);
        if(page.spaceId!==target.spaceId)throw new ForbiddenException();const latest=await this.latest(page.id,actor);const actual=await this.pages.findById(page.id,{includeContent:true});await this.store.request(target.workspaceId,page.id,latest,c.rendererHash,false,await this.mediaStamp(actual.content,actor,c.origin));}
      catch(e){if([403,404].includes((e instanceof HttpException?e.getStatus():undefined)))await this.store.stopAutomatic(target.workspaceId,target.pageId,'SOURCE_ACCESS_REVOKED');}
    }
    const job=await this.store.claim();if(!job)return;
    let scratch:string;const heartbeat=setInterval(()=>{void this.store.heartbeat(job).catch(()=>{});},20000);heartbeat.unref();
    try{
      const actor=await this.users.findById(job.actorId,job.workspaceId);if(!actor)throw new ForbiddenException();const {page,user}=await this.access(job.pageId,actor,true);
      if(page.spaceId!==job.spaceId)throw new ForbiddenException('SOURCE_MOVED');if(job.rendererHash!==c.rendererHash)throw new ConflictException('RUNTIME_CHANGED');
      const source=await this.history.displaySource(job.pageId,job.versionId,user),target={pageId:page.id,versionId:job.versionId,url:c.origin+'/s/general/p/'+page.slugId};
      if(await this.mediaStamp(source.content,user,c.origin)!==job.assetStamp)throw new ConflictException('MEDIA_CHANGED');
      scratch=await fs.mkdtemp(path.join(os.tmpdir(),'sop-handbook-'));const media=[];let total=0;
      for(const url of this.refs(source.content,c.origin)){const a=await this.asset(url,user,c.origin),bytes=await this.storage.read(a.filePath);total+=bytes.length;if(bytes.length>128*1024*1024||total>256*1024*1024)throw new BadRequestException('MEDIA_SIZE_LIMIT');const key=hash(bytes);await fs.writeFile(path.join(scratch,key),bytes);media.push({url,key});}
      if(canonicalJson(await this.history.displaySource(job.pageId,job.versionId,user))!==canonicalJson(source))throw new ConflictException('SOURCE_CHANGED');
      for(const m of media){const a=await this.asset(m.url,user,c.origin);if(hash(await this.storage.read(a.filePath))!==m.key)throw new ConflictException('MEDIA_CHANGED');}
      await fs.writeFile(path.join(scratch,'input.json'),JSON.stringify({source,target,binding:job.binding,media}));
      try{await execute(process.execPath,[c.runner,scratch],{timeout:60000,maxBuffer:1048576});}catch(e){throw new BadRequestException(String(e instanceof Error&&'stderr' in e?e.stderr:'').includes('LAYOUT_REQUIRED')?'LAYOUT_REQUIRED':'RENDER_FAILED');}
      const manifest=JSON.parse(await fs.readFile(path.join(scratch,'output/manifest.json'),'utf8'));
      if(manifest.source.versionId!==job.versionId||manifest.source.pageId!==job.pageId||manifest.presentation.bindingHash!==job.bindingHash)throw new ConflictException('RESULT_SOURCE_MISMATCH');
      manifest.freshness=contentHash(source);const prefix='sop-handbooks/'+job.workspaceId+'/'+job.pageId+'/'+job.id+'/'+job.leaseToken;
      for(const file of [...manifest.renderFiles,...manifest.assets.map(a=>({path:a.output,sha256:a.sha256}))]){
        if(!filePattern.test(file.path))throw new BadRequestException('UNAPPROVED_RESULT_FILE');const bytes=await fs.readFile(path.join(scratch,'output',file.path));if(hash(bytes)!==file.sha256)throw new ConflictException('RESULT_INTEGRITY_FAILED');await this.storage.upload(prefix+'/'+file.path,bytes);
      }
      await this.storage.upload(prefix+'/private-source-package.json',await fs.readFile(path.join(scratch,'source/package.json')));
      await this.verifyAssets(manifest,user,c.origin);
      if(canonicalJson(await this.history.displaySource(job.pageId,job.versionId,user))!==canonicalJson(source))throw new ConflictException('SOURCE_CHANGED');
      for(const m of media){const a=await this.asset(m.url,user,c.origin);if(hash(await this.storage.read(a.filePath))!==m.key)throw new ConflictException('MEDIA_CHANGED');}
      await this.access(job.pageId,user,true);await this.store.finish(job,manifest,prefix);
    }catch(e){const status=(e instanceof HttpException?e.getStatus():undefined);const code=[403,404].includes(status)?'SOURCE_ACCESS_REVOKED':status===409?'SOURCE_CHANGED':status===400?(e instanceof Error&&e.message==='LAYOUT_REQUIRED'?'LAYOUT_REQUIRED':'RENDER_FAILED'):'SOURCE_TEMPORARILY_UNAVAILABLE';
      await this.store.fail(job,code,![400,403,404,409].includes(status));if([403,404].includes(status))await this.store.stopAutomatic(job.workspaceId,job.pageId,code);
    }finally{clearInterval(heartbeat);if(scratch)await fs.rm(scratch,{recursive:true,force:true});}
  }
}
