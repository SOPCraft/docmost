import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PiWorkbenchService } from './pi-workbench.service';

function fixture(){
  const user={id:randomUUID(),workspaceId:randomUUID(),role:'owner'},owner={actorId:user.id,workspaceId:user.workspaceId};
  const source={pageId:randomUUID(),versionId:randomUUID(),title:'合成私有资料'},page={id:source.pageId,spaceId:randomUUID(),workspaceId:user.workspaceId};
  const meta={id:randomUUID(),owner,sources:[source],title:'私有对话'},calls:{operation:string;owner:unknown;parameters:any}[]=[];
  let allowed=true,active=true,present=true,afterRead:()=>void=()=>{};
  const users={findById:jest.fn(async()=>active?user:{...user,deactivatedAt:new Date()})};
  const history={displayAccess:jest.fn(async()=>{if(!allowed)throw new ForbiddenException();return page;}),list:jest.fn(async()=>({items:[{id:source.versionId,status:'synced'}]})),displaySource:jest.fn(async()=>({...source,content:{type:'doc',content:[]}}))};
  const service=new PiWorkbenchService(users as any,history as any,{} as any);
  jest.spyOn(service as any,'configuration').mockReturnValue({origin:'http://127.0.0.1:3040',token:'a'.repeat(64)});
  jest.spyOn(service as any,'versionPresent').mockImplementation(async()=>present);
  jest.spyOn(service as any,'call').mockImplementation(async(...args:unknown[])=>{
    const operation=String(args[0]),claimedOwner=args[1],parameters=args[2]||{};
    calls.push({operation,owner:claimedOwner,parameters});
    if(operation==='metadata')return structuredClone(meta);
    if(operation==='list'||operation==='active')return [structuredClone(meta)];
    if(operation==='create'||operation==='attach')return structuredClone(meta);
    if(operation==='view'||operation==='artifact'||operation==='command'){afterRead();return {synthetic:'sensitive-result'};}
    return {valid:true};
  });
  return {service,user,owner,meta,source,page,calls,users,history,revoke:()=>allowed=false,deactivate:()=>active=false,removeVersion:()=>present=false,after:(fn:()=>void)=>afterRead=fn};
}
describe('native workbench authentication and source lineage',()=>{
  it('returns a private view only after validating every source and the current actor',async()=>{const f=fixture();expect(await f.service.view({sessionId:f.meta.id,after:0},f.user as any)).toEqual({synthetic:'sensitive-result'});expect(f.history.displayAccess).toHaveBeenCalledTimes(2);expect(f.calls.filter(call=>call.operation==='metadata')).toHaveLength(2);expect(f.calls.find(call=>call.operation==='renew')?.owner).toEqual(f.owner);});
  it('blocks a deactivated account before asking for private conversation metadata',async()=>{const f=fixture();f.deactivate();await expect(f.service.view({sessionId:f.meta.id,after:0},f.user as any)).rejects.toThrow(ForbiddenException);expect(f.calls).toHaveLength(0);});
  it('blocks a forged owner even when the identifier of a conversation is known',async()=>{const f=fixture();f.meta.owner.actorId=randomUUID();await expect(f.service.view({sessionId:f.meta.id,after:0},f.user as any)).rejects.toThrow(ForbiddenException);expect(f.calls.some(call=>call.operation==='view')).toBe(false);});
  it('does not cross workspace boundaries',async()=>{const f=fixture();f.meta.owner.workspaceId=randomUUID();await expect(f.service.view({sessionId:f.meta.id,after:0},f.user as any)).rejects.toThrow(ForbiddenException);expect(f.calls.some(call=>call.operation==='renew')).toBe(false);});
  it('revocation stops execution before private messages are requested',async()=>{const f=fixture();f.revoke();await expect(f.service.view({sessionId:f.meta.id,after:0},f.user as any)).rejects.toThrow();expect(f.calls.some(call=>call.operation==='revoke')).toBe(true);expect(f.calls.some(call=>call.operation==='view')).toBe(false);});
  it('historical version removal denies the conversation even when the current page is visible',async()=>{const f=fixture();f.removeVersion();await expect(f.service.view({sessionId:f.meta.id,after:0},f.user as any)).rejects.toThrow('PI_SOURCE_VERSION_UNAVAILABLE');expect(f.calls.some(call=>call.operation==='view')).toBe(false);});
  it('revocation while messages are read suppresses the late response',async()=>{const f=fixture();f.after(f.revoke);await expect(f.service.view({sessionId:f.meta.id,after:0},f.user as any)).rejects.toThrow();expect(f.calls.some(call=>call.operation==='revoke')).toBe(true);});
  it('artifact download has the same before-and-after restrictions as messages',async()=>{const f=fixture();f.after(f.revoke);await expect(f.service.artifact({sessionId:f.meta.id,name:'draft.json'},f.user as any)).rejects.toThrow();expect(f.calls.find(call=>call.operation==='artifact')?.owner).toEqual(f.owner);});
  it('a native history command cannot bypass source restrictions',async()=>{const f=fixture();f.revoke();await expect(f.service.command({sessionId:f.meta.id,command:{type:'get_tree',id:randomUUID()}},f.user as any)).rejects.toThrow();expect(f.calls.some(call=>call.operation==='command')).toBe(false);});
  it('hides both title and existence in the conversation list after source access fails',async()=>{const f=fixture();f.revoke();expect(await f.service.list(f.user as any)).toEqual({items:[]});expect(f.calls.some(call=>call.operation==='revoke')).toBe(true);});
  it('new conversations receive repository-verified fixed sources rather than browser content',async()=>{const f=fixture();await f.service.create({sessionId:f.meta.id,pageIds:[f.source.pageId]},f.user as any);expect(f.history.displaySource).toHaveBeenCalledWith(f.source.pageId,f.source.versionId,f.user);expect(f.calls.find(call=>call.operation==='create')?.owner).toEqual(f.owner);});
  it('rejects more than ten sources before reading any source',async()=>{const f=fixture();await expect(f.service.create({sessionId:f.meta.id,pageIds:Array.from({length:11},()=>randomUUID())},f.user as any)).rejects.toThrow('PI_SOURCE_SELECTION_INVALID');expect(f.history.displaySource).not.toHaveBeenCalled();});
  it('rejects duplicate source selections',async()=>{const f=fixture();await expect(f.service.create({sessionId:f.meta.id,pageIds:[f.source.pageId,f.source.pageId]},f.user as any)).rejects.toThrow('PI_SOURCE_SELECTION_INVALID');expect(f.history.displaySource).not.toHaveBeenCalled();});
  it('background permission checks keep running even without an open browser panel',async()=>{const f=fixture();await f.service.checkActive();expect(f.calls.some(call=>call.operation==='renew')).toBe(true);});
  it('background permission checks suspend revoked sources without deleting native history',async()=>{const f=fixture();f.revoke();await f.service.checkActive();expect(f.calls.some(call=>call.operation==='revoke')).toBe(true);expect(f.calls.some(call=>call.operation==='renew')).toBe(false);expect(f.calls.some(call=>call.operation==='delete')).toBe(false);});
  it('an unavailable fixed version cannot be replaced by latest content during view',async()=>{const f=fixture();f.removeVersion();await expect(f.service.view({sessionId:f.meta.id,after:0},f.user as any)).rejects.toThrow();expect(f.history.displaySource).not.toHaveBeenCalled();});
  it('accepts SOP generation only after a matching successful Pi tool call exists in the owned conversation',async()=>{const f=fixture(),toolCallId='sop-call-1',key='fixed-source-key';(f.meta.sources[0] as any).key=key;const mock=(f.service as any).call as jest.Mock;mock.mockImplementation(async(...args:unknown[])=>{const operation=String(args[0]);if(operation==='metadata')return structuredClone(f.meta);if(operation==='renew')return {valid:true};if(operation==='view')return {messages:[{role:'assistant',content:[{type:'toolCall',id:toolCallId,name:'generate_sop',arguments:{sourceKey:key,autoUpdate:true}}]},{role:'toolResult',toolCallId,isError:false,content:[{type:'text',text:'accepted'}]}]};return {valid:true};});const result=await f.service.verifiedSopRequest({sessionId:f.meta.id,toolCallId},f.user as any);expect(result.source).toMatchObject({pageId:f.source.pageId,versionId:f.source.versionId,key});expect(result.autoUpdate).toBe(true);expect(f.history.displaySource).toHaveBeenCalledWith(f.source.pageId,f.source.versionId,f.user);});
  it('rejects a browser request that has no matching successful generate_sop tool call',async()=>{const f=fixture(),toolCallId='forged-call';(f.meta.sources[0] as any).key='fixed-source-key';const mock=(f.service as any).call as jest.Mock;mock.mockImplementation(async(...args:unknown[])=>{const operation=String(args[0]);if(operation==='metadata')return structuredClone(f.meta);if(operation==='renew')return {valid:true};if(operation==='view')return {messages:[{role:'assistant',content:[{type:'toolCall',id:'other-call',name:'read_document',arguments:{key:'fixed-source-key'}}]}]};return {valid:true};});await expect(f.service.verifiedSopRequest({sessionId:f.meta.id,toolCallId},f.user as any)).rejects.toThrow('PI_TOOL_REQUEST_INVALID');});
});
