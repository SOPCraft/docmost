import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PiSopService, PiGenerateRequest, validatePiSelections } from './pi-sop.service';

// Repository dependencies are fixtures. These are host service unit tests,
// not real database, Gitea, browser or model-provider acceptance tests.
const workspaceId = '30000000-0000-4000-8000-000000000001';
const actorId = '40000000-0000-4000-8000-000000000001';
const pageId = '50000000-0000-4000-8000-000000000001';
const versionId = '60000000-0000-4000-8000-000000000001';
const configId = 'a'.repeat(64);
function fixture() {
  const user = { id: actorId, workspaceId, deletedAt: null, deactivatedAt: null };
  const selection = { pageId, versionId };
  const body: PiGenerateRequest = { selections: [selection], skillId: 'sop-organizer', instruction: '合成资料整理', configurationId: configId };
  const users = { findById: jest.fn().mockImplementation(async () => ({ ...user })) };
  const history = {
    displayAccess: jest.fn().mockResolvedValue({ id: pageId, spaceId: 'fixture-space' }),
    list: jest.fn().mockResolvedValue({ items: [{ id: versionId, status: 'synced' }] }),
    displaySource: jest.fn().mockImplementation(async (p, v) => ({ pageId: p, versionId: v, revision: 1, title: '合成资料' })),
  };
  const envelope = () => ({ schema: 'sop.draft-envelope/1', reviewRequired: true,
    provenance: { actorId, workspaceId, sources: [selection] }, draft: { title: '合成流程' } });
  const runtime = {
    describe: jest.fn().mockResolvedValue({ enabled: true, workspaceId, configurationId: configId,
      model: { id: 'synthetic', label: '合成模型', provider: 'sop-configured' }, skill: { id: 'sop-organizer' } }),
    organize: jest.fn().mockImplementation(async (options) => {
      for (const s of options.request.selections) {
        expect(await options.authorize({ selection: s, signal: options.signal })).toBe(true);
        await options.readSource({ selection: s, signal: options.signal });
      }
      return envelope();
    }),
  };
  const service = new PiSopService(users as any, history as any, runtime as any);
  return { service, users, user, history, runtime, body, selection, envelope };
}

it('prepares the current synced fixed revision and rechecks all sources', async () => {
  const f = fixture();
  const result = await f.service.prepare({ pageIds: [pageId] }, f.user as any);
  expect(result.items).toEqual([{ pageId, versionId, revision: 1, title: '合成资料' }]);
  expect(f.history.displaySource).toHaveBeenCalledTimes(2);
  expect(f.runtime.organize).not.toHaveBeenCalled();
});
it('rejects pending versions rather than substituting current text', async () => {
  const f = fixture(); f.history.list.mockResolvedValue({ items: [{ id: versionId, status: 'pending' }] });
  await expect(f.service.prepare({ pageIds: [pageId] }, f.user as any)).rejects.toThrow('PI_SOURCE_VERSION_PENDING');
  expect(f.history.displaySource).not.toHaveBeenCalled();
});
it('does not return earlier selections after access is revoked', async () => {
  const f = fixture(); f.history.displayAccess.mockResolvedValueOnce({ id: pageId }).mockRejectedValue(new ForbiddenException());
  await expect(f.service.prepare({ pageIds: [pageId] }, f.user as any)).rejects.toBeInstanceOf(ForbiddenException);
});
it.each([[], Array(11).fill({ pageId, versionId }), [{ pageId, versionId }, { pageId: pageId.toUpperCase(), versionId }],
  [{ pageId: '../private', versionId }], [{ pageId, versionId, actorId }]].map(value => [value]))('rejects invalid selections %j', value => {
  expect(() => validatePiSelections(value)).toThrow();
});
it('uses the authenticated actor and actual source service callbacks', async () => {
  const f = fixture(); const result = await f.service.generate(f.body, f.user as any);
  expect(result.saved).toBe(false); expect(result.reviewRequired).toBe(true);
  expect(f.runtime.organize.mock.calls[0][0].context).toEqual({ actorId, workspaceId });
  expect(f.history.displaySource.mock.calls.every(([p, v]) => p === pageId && v === versionId)).toBe(true);
  expect(f.users.findById).toHaveBeenCalledWith(actorId, workspaceId);
  expect(f.runtime.organize.mock.calls[0][0].request).not.toHaveProperty('configurationId');
});
it('rejects browser-provided model configuration or identity fields', async () => {
  const f = fixture();
  await expect(f.service.generate({ ...f.body, model: 'https://attacker.invalid' } as any, f.user as any)).rejects.toThrow('PI_REQUEST_INVALID');
  expect(f.runtime.organize).not.toHaveBeenCalled();
});
it.each(['deletedAt', 'deactivatedAt'])('rejects account %s before model invocation', async property => {
  const f = fixture(); f.users.findById.mockResolvedValue({ ...f.user, [property]: new Date() });
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('PI_ACCOUNT_UNAVAILABLE');
  expect(f.runtime.organize).not.toHaveBeenCalled();
});
it('rejects a repository user with mismatched workspace', async () => {
  const f = fixture(); f.users.findById.mockResolvedValue({ ...f.user, workspaceId: pageId });
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('PI_ACCOUNT_UNAVAILABLE');
});
it('does not use another workspace administrator model configuration', async () => {
  const f = fixture(); f.runtime.describe.mockResolvedValue({ enabled: true, workspaceId: pageId, configurationId: configId });
  expect(await f.service.status(pageId, f.user as any)).toEqual({ enabled: false });
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('PI_HOST_DISABLED');
  expect(f.runtime.organize).not.toHaveBeenCalled();
});
it('rejects stale selected configuration before sending any source', async () => {
  const f = fixture();
  await expect(f.service.generate({ ...f.body, configurationId: 'b'.repeat(64) }, f.user as any)).rejects.toThrow('PI_MODEL_CONFIGURATION_CHANGED');
  expect(f.runtime.organize).not.toHaveBeenCalled();
});
it('checks all source permissions before invoking the runtime', async () => {
  const f = fixture(); f.history.displayAccess.mockRejectedValue(new ForbiddenException());
  await expect(f.service.generate(f.body, f.user as any)).rejects.toBeInstanceOf(ForbiddenException);
  expect(f.runtime.organize).not.toHaveBeenCalled();
});
it('rejects source changes instead of adopting a late model result', async () => {
  const f = fixture(); f.runtime.organize.mockImplementation(async () => {
    f.history.displaySource.mockRejectedValue(new ConflictException('Source changed')); return f.envelope();
  });
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('Source changed');
});
it('rechecks actor revocation after generation', async () => {
  const f = fixture(); f.runtime.organize.mockImplementation(async () => {
    f.users.findById.mockResolvedValue(null); return f.envelope();
  });
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('PI_ACCOUNT_UNAVAILABLE');
});
it('rejects configuration changes during generation', async () => {
  const f = fixture(); f.runtime.organize.mockImplementation(async () => {
    f.runtime.describe.mockResolvedValue({ enabled: false }); return f.envelope();
  });
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('PI_MODEL_CONFIGURATION_CHANGED');
});
it('rejects mismatched result provenance', async () => {
  const f = fixture(); f.runtime.organize.mockResolvedValue({ ...f.envelope(), provenance: { actorId: 'other', workspaceId, sources: [f.selection] } });
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('PI_RESULT_IDENTITY_INVALID');
});
it('redacts provider exceptions and releases the actor slot after failure', async () => {
  const f = fixture(); f.runtime.organize.mockRejectedValueOnce(new Error('DO_NOT_EXPOSE_KEY_OR_SOURCE'));
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('PI_GENERATION_FAILED');
  await expect(f.service.generate(f.body, f.user as any)).resolves.toHaveProperty('saved', false);
});
it('cancels before model invocation', async () => {
  const f = fixture(); const controller = new AbortController(); controller.abort();
  await expect(f.service.generate(f.body, f.user as any, controller.signal)).rejects.toThrow('PI_CANCELLED');
  expect(f.runtime.organize).not.toHaveBeenCalled();
});
it('refuses a late result after cancellation', async () => {
  const f = fixture(); const controller = new AbortController();
  f.runtime.organize.mockImplementation(async () => { controller.abort(); return f.envelope(); });
  await expect(f.service.generate(f.body, f.user as any, controller.signal)).rejects.toThrow('PI_CANCELLED');
});
it('limits concurrent generation by actor and allows another request after completion', async () => {
  const f = fixture(); let release!: (value: unknown) => void;
  f.runtime.organize.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = f.service.generate(f.body, f.user as any);
  await expect(f.service.generate(f.body, f.user as any)).rejects.toThrow('PI_GENERATION_BUSY');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release(f.envelope()); await first;
  await expect(f.service.generate(f.body, f.user as any)).resolves.toHaveProperty('saved', false);
});
it('preview revalidation fails closed when a source is no longer accessible', async () => {
  const f = fixture(); f.history.displayAccess.mockRejectedValue(new ForbiddenException());
  await expect(f.service.revalidate({ selections: [f.selection] }, f.user as any)).rejects.toBeInstanceOf(ForbiddenException);
});
