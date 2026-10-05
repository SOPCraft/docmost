import {ForbiddenException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {PiWorkbenchService} from './pi-workbench.service';
function fixture(){
 const user={id:randomUUID(),workspaceId:randomUUID(),role:'admin',deletedAt:null,deactivatedAt:null};
 const users={findById:jest.fn(async()=>user)},service=new PiWorkbenchService(users as any,{} as any,{} as any);
 const call=jest.spyOn(service as any,'call').mockImplementation(async(...args:unknown[])=>({operation:args[0],owner:args[1],parameters:args[2]}));
 return {user,users,service,call};
}
describe('catalog model settings use fresh workspace administrator identity',()=>{
 it('reads the catalog and masked provider connections for the authenticated workspace',async()=>{const f=fixture(),result=await f.service.providerSettings(f.user as any);expect(result).toEqual({operation:'provider-settings',owner:{actorId:f.user.id,workspaceId:f.user.workspaceId},parameters:{}});expect(f.users.findById).toHaveBeenCalledTimes(2);});
 it('cannot use ordinary membership to read model settings',async()=>{const f=fixture();f.user.role='member';await expect(f.service.providerSettings(f.user as any)).rejects.toThrow(ForbiddenException);expect(f.call).not.toHaveBeenCalled();});
 it('cannot use a deactivated administrator account',async()=>{const f=fixture();f.users.findById.mockResolvedValueOnce({...f.user,deactivatedAt:new Date()} as any);await expect(f.service.providerSettings(f.user as any)).rejects.toThrow(ForbiddenException);expect(f.call).not.toHaveBeenCalled();});
 it('derives owner from authenticated identity instead of a browser-provided owner object',async()=>{const f=fixture(),revision=randomUUID(),change={kind:'save-connection',provider:'kimi',apiKey:'synthetic'};const result=await f.service.changeProvider({change,revision,owner:{workspaceId:randomUUID()}} as any,f.user as any);expect(result.owner).toEqual({actorId:f.user.id,workspaceId:f.user.workspaceId});expect(result.parameters).toEqual({change,revision});});
 it('rechecks the administrator role before returning a slow catalog request',async()=>{const f=fixture();f.users.findById.mockResolvedValueOnce(f.user).mockResolvedValueOnce({...f.user,role:'member'});await expect(f.service.providerSettings(f.user as any)).rejects.toThrow(ForbiddenException);});
 it('connection testing uses the saved-provider request contract',async()=>{const f=fixture(),request={provider:'qwen',modelId:'fixture',revision:randomUUID()};expect((await f.service.testProvider({request},f.user as any)).parameters).toEqual({request});});
 it('model discovery is unavailable to a non-admin even for their own conversation',async()=>{const f=fixture();f.user.role='member';await expect(f.service.discoverProvider({request:{provider:'qwen'}},f.user as any)).rejects.toThrow(ForbiddenException);expect(f.call).not.toHaveBeenCalled();});
 it('deactivation while discovery completes prevents the result being returned',async()=>{const f=fixture();f.users.findById.mockResolvedValueOnce(f.user).mockResolvedValueOnce({...f.user,deactivatedAt:new Date()} as any);await expect(f.service.discoverProvider({request:{provider:'qwen'}},f.user as any)).rejects.toThrow(ForbiddenException);});
});

describe('model-guided layout planning',()=>{
 function layoutFixture(groups=[{heading:null,body:[0]},{heading:1,body:[2]}]){
  const user={id:randomUUID(),workspaceId:randomUUID(),role:'admin',deletedAt:null,deactivatedAt:null},pageId=randomUUID(),versionId=randomUUID();
  const source={pageId,versionId,revision:4,title:'固定原稿',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'导语'}]},{type:'heading',attrs:{level:2},content:[{type:'text',text:'步骤'}]},{type:'paragraph',content:[{type:'text',text:'正文'}]}]}};
  const users={findById:jest.fn(async()=>user)},history={displayAccess:jest.fn(async()=>({id:pageId})),displaySource:jest.fn(async()=>structuredClone(source))},service=new PiWorkbenchService(users as any,history as any,{} as any);
  const decision={schema:'sop.layout-decision/1',source:{pageId,versionId},template:{id:'chapter-reader',version:'1.0.0'},density:'comfortable',groups,notes:['根据标题层级选择章节阅读。'],modelAuthoredContent:false};
  const call=jest.spyOn(service as any,'call').mockImplementation(async(...args:unknown[])=>{const operation=String(args[0]);if(operation==='status')return {models:[{provider:'deepseek',id:'deepseek-v4-pro',label:'DeepSeek V4 Pro'}]};if(operation==='command')return {success:true,data:{accepted:true}};if(operation==='view')return {busy:false,state:{isStreaming:false}};if(operation==='artifact')return {name:'layout-decision.json',data:Buffer.from(JSON.stringify(decision)).toString('base64')};if(operation==='destroy')return {destroyed:true};return {};});
  return{user,pageId,versionId,source,service,call,history};
 }
 it('uses the configured workspace model and returns only a validated fixed-source layout decision',async()=>{const f=layoutFixture();const result=await f.service.planLayout({pageId:f.pageId,versionId:f.versionId,templates:[{id:'chapter-reader',version:'1.0.0',name:'章节工作本',description:'按章节阅读'}],preferred:{density:'comfortable'}},f.user as any);expect(result.planner).toBe('pi-layout-designer/1');expect(result.model).toEqual({provider:'deepseek',id:'deepseek-v4-pro',label:'DeepSeek V4 Pro'});expect(result.groups).toEqual([{heading:null,body:[0]},{heading:1,body:[2]}]);expect(f.call).toHaveBeenCalledWith('destroy',expect.anything(),expect.objectContaining({sessionId:expect.any(String)}));expect(f.history.displaySource).toHaveBeenCalledTimes(2);});
 it('rejects a model artifact that skips or reorders source blocks and still destroys the private planning session',async()=>{const f=layoutFixture([{heading:null,body:[0,2]},{heading:1,body:[]}]);await expect(f.service.planLayout({pageId:f.pageId,versionId:f.versionId,templates:[{id:'chapter-reader',version:'1.0.0',name:'章节工作本',description:''}]},f.user as any)).rejects.toThrow('PI_LAYOUT_RESULT_INVALID');expect(f.call).toHaveBeenCalledWith('destroy',expect.anything(),expect.objectContaining({sessionId:expect.any(String)}));});
});
