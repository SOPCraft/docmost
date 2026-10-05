import { Injectable, BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
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
      const safe=new Set(['PI_SESSION_NOT_FOUND','PI_COMMAND_OUTCOME_UNKNOWN','PI_CAPACITY_BUSY','PI_DIALOG_EXPIRED','PI_COMMAND_INVALID','PI_COMMAND_FIELDS_INVALID','PI_MODEL_NOT_CONFIGURED','PI_ARTIFACT_NOT_FOUND','PI_REQUEST_ID_REUSED','PI_MODEL_ADMIN_REQUIRED','PI_MODEL_SETTINGS_BUSY','PI_MODEL_SETTINGS_CHANGED','PI_MODEL_CONFIG_INVALID','PI_MODEL_KEY_REQUIRED','PI_PROVIDER_NOT_CONFIGURED','PI_PROVIDER_UNSUPPORTED','PI_PROVIDER_CHANGE_INVALID','PI_PROVIDER_PRESET_INVALID','PI_PROVIDER_ID_INVALID','PI_PROVIDER_REENTER_KEY','PI_PROVIDER_CLEAR_KEY_REQUIRED','PI_PROVIDER_ADDRESS_INVALID','PI_PROVIDER_ADDRESS_DENIED','PI_PROVIDER_DNS_FAILED','PI_PROVIDER_NETWORK_FAILED','PI_PROVIDER_AUTH_FAILED','PI_PROVIDER_ENDPOINT_NOT_FOUND','PI_PROVIDER_RATE_LIMITED','PI_PROVIDER_REDIRECT_DENIED','PI_PROVIDER_TIMEOUT','PI_PROVIDER_RESPONSE_INVALID','PI_PROVIDER_RESPONSE_TOO_LARGE','PI_PROVIDER_UPSTREAM_FAILED','PI_PROVIDER_DISCOVERY_UNSUPPORTED','PI_PROVIDER_DIAGNOSTIC_BUSY','PI_DISCOVERY_INCOMPLETE','PI_DISCOVERY_TOO_LARGE']);
      if(body.error==='PI_SESSION_NOT_FOUND')throw new NotFoundException('PI_SESSION_NOT_FOUND');
      throw new ServiceUnavailableException(safe.has(body.error)?body.error:'PI_WORKBENCH_OPERATION_FAILED');
    }
    return body.data;
  }
  private async versionPresent(source:Source,spaceId:string,user:User) {
    const rows=(await sql`SELECT id FROM sop_page_versions WHERE id=${source.versionId}::uuid AND workspace_id=${user.workspaceId}::uuid AND page_id=${source.pageId}::uuid AND space_id=${spaceId}::uuid AND status='synced'`.execute(this.db)).rows;
    return rows.length===1;
  }
  private async verifySources(meta:Conversation,user:User) {
    if(!meta || !isId(meta.id) || meta.owner?.actorId!==user.id || meta.owner?.workspaceId!==user.workspaceId || !Array.isArray(meta.sources) || meta.sources.length>100)throw new ForbiddenException('PI_CONVERSATION_UNAVAILABLE');
    const pages=new Map<string,any>();
    for(const source of meta.sources){
      if(!isId(source.pageId)||!isId(source.versionId))throw new ForbiddenException('PI_CONVERSATION_UNAVAILABLE');
      let page=pages.get(source.pageId);if(!page){page=await this.history.displayAccess(source.pageId,user);pages.set(source.pageId,page);}
      if(!await this.versionPresent(source,page.spaceId,user))throw new ForbiddenException('PI_SOURCE_VERSION_UNAVAILABLE');
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
    return { ...await this.call('status',this.owner(current)), canManageModels:['owner','admin'].includes(current.role) };
  }
  async modelSettings(user:User) {
    const current=await this.actor(user);if(!['owner','admin'].includes(current.role))throw new ForbiddenException('PI_MODEL_ADMIN_REQUIRED');
    return this.call('model-settings',this.owner(current));
  }
  async saveModel(body:{model:object;revision:string;remove?:boolean},user:User) {
    const current=await this.actor(user);if(!['owner','admin'].includes(current.role))throw new ForbiddenException('PI_MODEL_ADMIN_REQUIRED');
    return this.call('save-model',this.owner(current),{model:body.model,revision:body.revision,remove:body.remove===true});
  }
  private async providerAdmin(operation:string,parameters:Record<string,unknown>,user:User){
    const current=await this.actor(user);if(!['owner','admin'].includes(current.role))throw new ForbiddenException('PI_MODEL_ADMIN_REQUIRED');
    const result=await this.call(operation,this.owner(current),parameters);
    const after=await this.actor(user);if(!['owner','admin'].includes(after.role))throw new ForbiddenException('PI_MODEL_ADMIN_REQUIRED');
    return result;
  }
  providerSettings(user:User){return this.providerAdmin('provider-settings',{},user);}
  changeProvider(body:{change:object;revision:string},user:User){return this.providerAdmin('provider-change',{change:body.change,revision:body.revision},user);}
  testProvider(body:{request:object},user:User){return this.providerAdmin('provider-test',{request:body.request},user);}
  discoverProvider(body:{request:object},user:User){return this.providerAdmin('provider-discover',{request:body.request},user);}
  async planLayout(body:{pageId:string;versionId:string;templates:{id:string;version:string;name:string;description:string}[];preferred?:{templateId?:string;templateVersion?:string;density?:string}},user:User){
    if(!isId(body.pageId)||!isId(body.versionId)||!Array.isArray(body.templates)||!body.templates.length||body.templates.length>50)throw new BadRequestException('PI_LAYOUT_REQUEST_INVALID');
    const templates=body.templates.map(item=>({id:String(item.id),version:String(item.version),name:String(item.name||item.id),description:String(item.description||'')}));for(const item of templates)if(!/^[a-z][a-z0-9-]{0,63}$/.test(item.id)||!/^\d+\.\d+\.\d+$/.test(item.version)||item.name.length>160||item.description.length>1000)throw new BadRequestException('PI_LAYOUT_REQUEST_INVALID');
    const current=await this.actor(user);await this.history.displayAccess(body.pageId,current);const source=await this.history.displaySource(body.pageId,body.versionId,current),owner=this.owner(current);
    const status=await this.call('status',owner);const model=Array.isArray(status?.models)?status.models[0]:null;if(!model?.provider||!model?.id)throw new ServiceUnavailableException('PI_MODEL_NOT_CONFIGURED');
    const sessionId=randomUUID(),command=async(type:string,fields:Record<string,unknown>={})=>{const result=await this.call('command',owner,{sessionId,command:{type,id:randomUUID(),...fields}});if(result?.success!==true)throw new ServiceUnavailableException('PI_LAYOUT_GENERATION_FAILED');return result.data;};
    try{
      await this.call('create',owner,{sessionId,sources:[source]});await this.call('renew',owner,{sessionId});await command('set_model',{provider:model.provider,modelId:model.id});
      const preference=body.preferred||{},message=['/layout-designer','请为本会话唯一固定原稿完成排版判断。','允许版式（只能选择其一）：',JSON.stringify(templates),'允许阅读密度：comfortable、compact。',preference.templateId?('用户当前版式偏好：'+preference.templateId+'@'+String(preference.templateVersion||'')):'用户未指定版式偏好，由你根据全文判断。',preference.density?('用户当前阅读密度偏好：'+preference.density):'用户未指定阅读密度偏好。','必须读取完整原稿，并通过 propose_layout 工具提交；禁止在方案中复制或改写正文。'].join('\n');
      await command('prompt',{message});
      const deadline=Date.now()+70000;let artifact:any=null;
      while(Date.now()<deadline){await this.call('renew',owner,{sessionId});const view=await this.call('view',owner,{sessionId,after:0});try{artifact=await this.call('artifact',owner,{sessionId,name:'layout-decision.json'});}catch{}if(artifact&&!view?.busy&&!view?.state?.isStreaming)break;await new Promise(resolve=>setTimeout(resolve,350));}
      if(!artifact?.data)throw new ServiceUnavailableException('PI_LAYOUT_GENERATION_FAILED');
      let decision:any;try{decision=JSON.parse(Buffer.from(artifact.data,'base64').toString('utf8'));}catch{throw new ServiceUnavailableException('PI_LAYOUT_RESULT_INVALID');}
      const allowed=templates.some(item=>item.id===decision?.template?.id&&item.version===decision?.template?.version),blocks=source?.content?.content;
      if(decision?.schema!=='sop.layout-decision/1'||decision?.source?.pageId!==body.pageId.toLowerCase()||decision?.source?.versionId!==body.versionId.toLowerCase()||!allowed||!['comfortable','compact'].includes(decision.density)||decision.modelAuthoredContent!==false||!Array.isArray(decision.groups)||!Array.isArray(blocks))throw new ServiceUnavailableException('PI_LAYOUT_RESULT_INVALID');
      let expected=0;for(const group of decision.groups){if(!group||!Array.isArray(group.body))throw new ServiceUnavailableException('PI_LAYOUT_RESULT_INVALID');if(group.heading!==null){if(!Number.isInteger(group.heading)||group.heading!==expected||blocks[group.heading]?.type!=='heading')throw new ServiceUnavailableException('PI_LAYOUT_RESULT_INVALID');expected++;}for(const index of group.body){if(!Number.isInteger(index)||index!==expected||!blocks[index])throw new ServiceUnavailableException('PI_LAYOUT_RESULT_INVALID');expected++;}}if(expected!==blocks.length)throw new ServiceUnavailableException('PI_LAYOUT_RESULT_INVALID');
      await this.actor(user);await this.history.displaySource(body.pageId,body.versionId,current);
      return {...decision,planner:'pi-layout-designer/1',model:{provider:model.provider,id:model.id,label:model.label||model.id}};
    }finally{await this.call('destroy',owner,{sessionId}).catch(async()=>{await this.call('revoke',owner,{sessionId}).catch(()=>{});});}
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
