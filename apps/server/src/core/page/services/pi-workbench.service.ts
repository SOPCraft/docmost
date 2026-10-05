import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '../../../database/types/kysely.types';
import { User } from '../../../database/types/entity.types';
import { UserRepo } from '../../../database/repos/user/user.repo';
import { VersionHistoryService } from './version-history.service';

type Owner = { actorId:string; workspaceId:string };
type Source = { pageId:string; versionId:string; title:string; revision?:number };
type Conversation = { id:string; owner:Owner; sources:Source[]; title:string; [key:string]:any };
const isId = (id:unknown):id is string => typeof id==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);

@Injectable()
export class PiWorkbenchService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer:ReturnType<typeof setInterval>;
  private checking=false;
  constructor(private readonly users:UserRepo,private readonly history:VersionHistoryService,@InjectKysely() private readonly db:KyselyDB) {}

  private configuration() {
    const base=process.env.SOP_PI_WORKBENCH_URL,token=process.env.SOP_PI_WORKBENCH_TOKEN;
    if (!base || !token) return null;
    try {
      const url=new URL(base);
      if (url.username || url.password || url.pathname!=='/' || url.search || url.hash || !/^[a-f0-9]{64,128}$/.test(token)) throw new Error();
      if (url.protocol!=='https:' && !(url.protocol==='http:' && ['127.0.0.1','host.docker.internal','[::1]'].includes(url.hostname))) throw new Error();
      return { origin:url.origin,token };
    } catch { throw new ServiceUnavailableException('PI_WORKBENCH_CONFIGURATION_INVALID'); }
  }
  private async actor(user:User|Owner):Promise<User> {
    const id='actorId' in user?user.actorId:user.id;
    if (!isId(id) || !isId(user.workspaceId)) throw new ForbiddenException('PI_ACCOUNT_UNAVAILABLE');
    const current=await this.users.findById(id,user.workspaceId);
    if (!current || current.id!==id || current.workspaceId!==user.workspaceId || current.deletedAt || current.deactivatedAt) throw new ForbiddenException('PI_ACCOUNT_UNAVAILABLE');
    return current;
  }
  private owner(user:User):Owner { return { actorId:user.id,workspaceId:user.workspaceId }; }
  private async call(operation:string,owner?:Owner,parameters:Record<string,unknown>={}) {
    const config=this.configuration();if(!config)throw new ServiceUnavailableException('PI_WORKBENCH_NOT_CONFIGURED');
    let response:Response;
    try { response=await fetch(config.origin+'/control',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${config.token}`},body:JSON.stringify({ ...parameters,operation,owner }),signal:AbortSignal.timeout(45000),redirect:'error'}); }
    catch { throw new ServiceUnavailableException('PI_WORKBENCH_UNREACHABLE'); }
    let body:any;try{body=await response.json();}catch{throw new ServiceUnavailableException('PI_WORKBENCH_RESPONSE_INVALID');}
    if(!response.ok){
      const safe=new Set(['PI_SESSION_NOT_FOUND','PI_COMMAND_OUTCOME_UNKNOWN','PI_CAPACITY_BUSY','PI_DIALOG_EXPIRED','PI_COMMAND_INVALID','PI_COMMAND_FIELDS_INVALID','PI_MODEL_NOT_CONFIGURED','PI_ARTIFACT_NOT_FOUND','PI_REQUEST_ID_REUSED']);
      if(body.error==='PI_SESSION_NOT_FOUND')throw new NotFoundException('PI_SESSION_NOT_FOUND');
      throw new ServiceUnavailableException(safe.has(body.error)?body.error:'PI_WORKBENCH_OPERATION_FAILED');
    }
    return body.data;
  }
  private async verifySources(meta:Conversation,user:User) {
    if(!meta || !isId(meta.id) || meta.owner?.actorId!==user.id || meta.owner?.workspaceId!==user.workspaceId || !Array.isArray(meta.sources) || meta.sources.length>100)throw new ForbiddenException('PI_CONVERSATION_UNAVAILABLE');
    const pages=new Map<string,any>();
    for(const source of meta.sources){
      if(!isId(source.pageId)||!isId(source.versionId))throw new ForbiddenException('PI_CONVERSATION_UNAVAILABLE');
      let page=pages.get(source.pageId);if(!page){page=await this.history.displayAccess(source.pageId,user);pages.set(source.pageId,page);}
      const present=(await sql`SELECT id FROM sop_page_versions WHERE id=${source.versionId}::uuid AND workspace_id=${user.workspaceId}::uuid AND page_id=${source.pageId}::uuid AND space_id=${page.spaceId}::uuid AND status='synced'`.execute(this.db)).rows.length;
      if(present!==1)throw new ForbiddenException('PI_SOURCE_VERSION_UNAVAILABLE');
    }
    await this.actor(user);
  }
  private async access(sessionId:string,user:User) {
    if(!isId(sessionId))throw new BadRequestException('PI_SESSION_INVALID');
    const current=await this.actor(user),owner=this.owner(current);
    const meta:Conversation=await this.call('metadata',owner,{sessionId});
    try { await this.verifySources(meta,current); }
    catch(error){await this.call('revoke',owner,{sessionId}).catch(()=>{});throw error;}
    await this.call('renew',owner,{sessionId});return {current,owner,meta};
  }
  async status(pageId:string,user:User) {
    const current=await this.actor(user);await this.history.displayAccess(pageId,current);
    if(!this.configuration())return {enabled:false,reason:'PI_WORKBENCH_NOT_CONFIGURED'};
    return this.call('status',this.owner(current));
  }
  async list(user:User) {
    const current=await this.actor(user);const list:Conversation[]=await this.call('list',this.owner(current)),items=[];
    if(!Array.isArray(list))throw new ServiceUnavailableException('PI_WORKBENCH_RESPONSE_INVALID');
    for(const meta of list){try{await this.verifySources(meta,current);items.push(meta);}catch{await this.call('revoke',this.owner(current),{sessionId:meta.id}).catch(()=>{});}}
    return {items};
  }
  private async sources(pageIds:string[],user:User) {
    if(!Array.isArray(pageIds)||pageIds.length>10||new Set(pageIds).size!==pageIds.length||pageIds.some(id=>!isId(id)))throw new BadRequestException('PI_SOURCE_SELECTION_INVALID');
    const sources=[];
    for(const pageId of pageIds){
      await this.history.displayAccess(pageId,user);const versions=await this.history.list(pageId,user,undefined,{summaries:false}),latest=versions.items[0];
      if(!latest || latest.status!=='synced')throw new BadRequestException('PI_SOURCE_VERSION_PENDING');
      sources.push(await this.history.displaySource(pageId,latest.id,user));
    }
    return sources;
  }
  async create(body:{sessionId:string;pageIds:string[]},user:User) {
    if(!isId(body.sessionId))throw new BadRequestException('PI_SESSION_INVALID');
    const current=await this.actor(user),owner=this.owner(current),sources=await this.sources(body.pageIds,current);
    const meta:Conversation=await this.call('create',owner,{sessionId:body.sessionId,sources});
    await this.verifySources(meta,current);return meta;
  }
  async attach(body:{sessionId:string;pageIds:string[]},user:User) {
    const {current,owner}=await this.access(body.sessionId,user),sources=await this.sources(body.pageIds,current);
    const meta:Conversation=await this.call('attach',owner,{sessionId:body.sessionId,sources});await this.verifySources(meta,current);return meta;
  }
  private async protectedCall(operation:string,body:any,user:User) {
    const {current,owner}=await this.access(body.sessionId,user);
    const result=await this.call(operation,owner,body);
    // Every return path rechecks the complete transitive source set, including
    // files, history, branches, model replies and tool results.
    const latest:Conversation=await this.call('metadata',owner,{sessionId:body.sessionId});
    try{await this.verifySources(latest,current);}catch(error){await this.call('revoke',owner,{sessionId:body.sessionId}).catch(()=>{});throw error;}
    return result;
  }
  view(body:{sessionId:string;after:number},user:User){return this.protectedCall('view',body,user);}
  command(body:{sessionId:string;command:object},user:User){return this.protectedCall('command',body,user);}
  respond(body:{sessionId:string;response:object},user:User){return this.protectedCall('respond',body,user);}
  artifacts(body:{sessionId:string},user:User){return this.protectedCall('artifacts',body,user);}
  artifact(body:{sessionId:string;name:string},user:User){return this.protectedCall('artifact',body,user);}
  async checkActive() {
    if(this.checking || !this.configuration())return;this.checking=true;
    try{
      const active:Conversation[]=await this.call('active');if(!Array.isArray(active))return;
      for(const meta of active){
        try{const current=await this.actor(meta.owner);await this.verifySources(meta,current);await this.call('renew',this.owner(current),{sessionId:meta.id});}
        catch{await this.call('revoke',meta.owner,{sessionId:meta.id}).catch(()=>{});}
      }
    }finally{this.checking=false;}
  }
  onApplicationBootstrap(){this.timer=setInterval(()=>{void this.checkActive().catch(()=>{});},5000);this.timer.unref();}
  onApplicationShutdown(){clearInterval(this.timer);}
}
