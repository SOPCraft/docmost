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
