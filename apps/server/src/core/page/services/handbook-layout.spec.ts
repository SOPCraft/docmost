import { ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { HandbookService } from './handbook.service';
import { canonicalJson } from '../../../integrations/versioning/version-snapshot';

function fixture(){
 const pageId=randomUUID(),spaceId=randomUUID(),versionId=randomUUID(),user={id:randomUUID(),workspaceId:randomUUID()} as any,selection={id:'chapter-reader',version:'1.0.0',density:'comfortable'};
 const source={pageId,versionId,revision:3,title:'固定原稿',snapshotSha256:'a'.repeat(64),content:{type:'doc',content:[{type:'paragraph',attrs:{id:'p'},content:[{type:'text',text:'原文'}]}]}};
 const history={displaySource:jest.fn(async()=>structuredClone(source))};
 const store={configure:jest.fn().mockResolvedValue({}),target:jest.fn().mockResolvedValue(undefined)};
 const service=new HandbookService({} as any,store as any,history as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any);
 const access={user,page:{id:pageId,spaceId,slugId:'fixed'}} as any,version={id:versionId,revision:3};
 const prepared={access,plan:{binding:{schema:'binding'},summary:{modelUsed:true,planner:'pi-layout-designer/1',counts:{blocks:1}}},token:null,bindingHash:'binding-hash',version,proposalHash:'proposal-hash',sourceHash:createHash('sha256').update(canonicalJson(source)).digest('hex'),assetStamp:'asset-stamp',rendererHash:'renderer-hash',decision:{template:{id:'chapter-reader',version:'1.0.0'},density:'comfortable'}};
 jest.spyOn(service as any,'prepareLayout').mockResolvedValue(prepared);
 jest.spyOn(service,'configuration').mockResolvedValue({origin:'http://127.0.0.1:3026',rendererHash:'renderer-hash',runner:'/trusted/runner'});
 jest.spyOn(service as any,'access').mockResolvedValue(access);
 jest.spyOn(service as any,'latest').mockResolvedValue(version);
 jest.spyOn(service as any,'mediaStamp').mockResolvedValue('asset-stamp');
 const refresh=jest.spyOn(service,'refresh').mockResolvedValue({state:'queued'} as any);
 return{service,store,history,user,selection,prepared,refresh,pageId,source};
}
async function preview(f:ReturnType<typeof fixture>){return f.service.previewLayout(f.pageId,f.selection,f.user);}

describe('first-layout preview and explicit confirmation',()=>{
 it('preview keeps one model-authored layout proposal without saving configuration or queuing generation',async()=>{const f=fixture();const r=await preview(f);expect(r.versionId).toBe(f.prepared.version.id);expect(r.revision).toBe(3);expect(r.summary).toEqual(f.prepared.plan.summary);expect(r.recommendation).toEqual({templateId:'chapter-reader',templateVersion:'1.0.0',density:'comfortable'});expect(f.store.configure).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();});
 it('apply revalidates the confirmed fixed source instead of asking the model a second time',async()=>{const f=fixture();await preview(f);(f.service as any).prepareLayout.mockClear();await f.service.applyLayout(f.pageId,f.selection,'proposal-hash',true,f.user);expect((f.service as any).prepareLayout).not.toHaveBeenCalled();expect(f.store.configure).toHaveBeenCalledWith(expect.objectContaining({pageId:f.pageId,workspaceId:f.user.workspaceId,actorId:f.user.id,binding:f.prepared.plan.binding}),{targetToken:null,versionId:f.prepared.version.id});expect(f.refresh).toHaveBeenCalledWith(f.pageId,f.user);});
 it('stale or missing proposal is refused before configuration writes',async()=>{const f=fixture();await expect(f.service.applyLayout(f.pageId,f.selection,'old-hash',false,f.user)).rejects.toThrow(ConflictException);expect(f.store.configure).not.toHaveBeenCalled();expect(f.refresh).not.toHaveBeenCalled();});
 it('a changed source invalidates the exact preview instead of silently recomputing it',async()=>{const f=fixture();await preview(f);f.history.displaySource.mockResolvedValueOnce({...f.source,title:'changed'});await expect(f.service.applyLayout(f.pageId,f.selection,'proposal-hash',true,f.user)).rejects.toThrow(ConflictException);expect(f.store.configure).not.toHaveBeenCalled();});
 it.each(['LAYOUT_TARGET_CHANGED','LAYOUT_SOURCE_CHANGED'])('transaction conflict %s never starts a replacement job',async code=>{const f=fixture();await preview(f);f.store.configure.mockRejectedValue(new Error(code));await expect(f.service.applyLayout(f.pageId,f.selection,'proposal-hash',false,f.user)).rejects.toThrow(ConflictException);expect(f.refresh).not.toHaveBeenCalled();});
 it('proposal ownership cannot cross actors or workspaces',async()=>{const f=fixture();await preview(f);await expect(f.service.applyLayout(f.pageId,f.selection,'proposal-hash',true,{...f.user,id:randomUUID()})).rejects.toThrow(ConflictException);expect(f.store.configure).not.toHaveBeenCalled();});
 it('a newer preview for the same actor and page invalidates the older proposal instead of accumulating them',async()=>{const f=fixture(),second={...f.prepared,proposalHash:'proposal-new'};(f.service as any).prepareLayout.mockResolvedValueOnce(f.prepared).mockResolvedValueOnce(second);await f.service.previewLayout(f.pageId,f.selection,f.user);await f.service.previewLayout(f.pageId,f.selection,f.user);expect((f.service as any).layoutProposals.size).toBe(1);await expect(f.service.applyLayout(f.pageId,f.selection,'proposal-hash',true,f.user)).rejects.toThrow(ConflictException);});
});
