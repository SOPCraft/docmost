import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { HandbookService, handbookFilePattern } from './handbook.service';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const user={id:randomUUID(),workspaceId:randomUUID()},page={id:randomUUID(),spaceId:randomUUID(),workspaceId:user.workspaceId},mediaPage={id:randomUUID(),spaceId:page.spaceId,workspaceId:user.workspaceId},aid=randomUUID();
 const bytes=Buffer.from('<html>original fixed output</html>'),asset={id:aid,pageId:mediaPage.id,spaceId:page.spaceId,workspaceId:user.workspaceId,fileSize:10,filePath:'private-original',deletedAt:null};
 const job={id:randomUUID(),state:'succeeded',spaceId:page.spaceId,workspaceId:user.workspaceId,pageId:page.id,storagePrefix:'private-result',manifest:{renderFiles:[{path:'index.html',sha256:hash(bytes)}],assets:[{url:'http://127.0.0.1:3026/api/files/'+aid+'/image.png',output:'assets/'+hash(bytes)+'.png',sha256:hash(bytes)}]}};
 let pageAllowed=true,assetAllowed=true,accountActive=true;
 const users={findById:jest.fn(async()=>accountActive?user:{...user,deactivatedAt:new Date()})};
 const history={displayAccess:jest.fn(async id=>{if(!pageAllowed||id===mediaPage.id&&!assetAllowed)throw new ForbiddenException();return id===page.id?page:mediaPage;})};
 const store={job:jest.fn(async(w,p,id)=>w===user.workspaceId&&p===page.id&&id===job.id?job:undefined)};
 const storage={exists:jest.fn(async()=>true),read:jest.fn(async()=>bytes)};
 const attachmentRepo={findById:jest.fn(async()=>asset)};
 const service=new HandbookService({} as any,store as any,history as any,users as any,{} as any,attachmentRepo as any,storage as any,{} as any,{} as any);
 jest.spyOn(service,'configuration').mockResolvedValue({origin:'http://127.0.0.1:3026',rendererHash:'a'.repeat(64),runner:'/trusted/runner'});
 return {user,page,mediaPage,job,asset,bytes,service,store,storage,history,users,attachmentRepo,revokePage:()=>pageAllowed=false,revokeMedia:()=>assetAllowed=false,deactivate:()=>accountActive=false};
}
describe('permission-checked saved handbook files',()=>{
 it('native attachment Date values produce a deterministic JSON-safe fingerprint',async()=>{const f=fixture();(f.asset as any).updatedAt=new Date('2026-10-04T00:00:00.000Z');const content={type:'doc',content:[{type:'image',attrs:{src:f.job.manifest.assets[0].url,attachmentId:f.asset.id}}]};const a=await (f.service as any).mediaStamp(content,f.user,'http://127.0.0.1:3026');const b=await (f.service as any).mediaStamp(content,f.user,'http://127.0.0.1:3026');expect(a).toMatch(/^[a-f0-9]{64}$/);expect(a).toBe(b);});
 it('reads saved bytes only after checking both source and owning media-page permissions',async()=>{const f=fixture();expect((await f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).bytes).toEqual(f.bytes);expect(f.history.displayAccess).toHaveBeenCalledWith(f.mediaPage.id,f.user);});
 it('deactivated account cannot read cached output',async()=>{const f=fixture();f.deactivate();await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(ForbiddenException);expect(f.storage.read).not.toHaveBeenCalled();});
 it('page membership revocation prevents reading cached output',async()=>{const f=fixture();f.revokePage();await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(ForbiddenException);expect(f.storage.read).not.toHaveBeenCalled();});
 it('revoking access to the media owner denies the whole cached page',async()=>{const f=fixture();f.revokeMedia();await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(ForbiddenException);expect(f.storage.read).not.toHaveBeenCalled();});
 it('deleted media denies the cached page',async()=>{const f=fixture();(f.asset as any).deletedAt=new Date();await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(NotFoundException);expect(f.storage.read).not.toHaveBeenCalled();});
 it('missing original media is not satisfied with cached media bytes',async()=>{const f=fixture();f.storage.exists.mockResolvedValue(false);await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(NotFoundException);expect(f.storage.read).not.toHaveBeenCalled();});
 it('cross-workspace attachment is denied before reading bytes',async()=>{const f=fixture();f.asset.workspaceId=randomUUID();await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(NotFoundException);expect(f.storage.read).not.toHaveBeenCalled();});
 it('moved source is not silently adopted by a prior saved result',async()=>{const f=fixture();f.job.spaceId=randomUUID();await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(NotFoundException);expect(f.storage.read).not.toHaveBeenCalled();});
 it('another page cannot select this job even with a known job identifier',async()=>{const f=fixture();await expect(f.service.file(f.mediaPage.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(NotFoundException);});
 it('tampered stored bytes fail closed',async()=>{const f=fixture();f.storage.read.mockResolvedValue(Buffer.from('changed'));await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow('RESULT_INTEGRITY_FAILED');});
 it('source access is rechecked after reading from storage',async()=>{const f=fixture();f.storage.read.mockImplementation(async()=>{f.revokePage();return f.bytes;});await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(ForbiddenException);});
 it('media permissions are rechecked after reading stored page bytes',async()=>{const f=fixture();f.storage.read.mockImplementation(async()=>{f.revokeMedia();return f.bytes;});await expect(f.service.file(f.page.id,f.job.id,'index.html',f.user as any)).rejects.toThrow(ForbiddenException);});
 it.each(['../index.html','manifest.json','private-source-package.json','.env','assets/../../secret','assets/%2e%2e/secret','vendor/vendor.lock.json'])('non-display path denied: %s',async file=>{const f=fixture();await expect(f.service.file(f.page.id,f.job.id,file,f.user as any)).rejects.toThrow(NotFoundException);expect(f.storage.read).not.toHaveBeenCalled();expect(handbookFilePattern.test(file)).toBe(false);});
});
