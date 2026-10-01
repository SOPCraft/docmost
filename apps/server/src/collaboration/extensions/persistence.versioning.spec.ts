jest.mock('@hocuspocus/transformer', () => ({
  TiptapTransformer: { fromYdoc: jest.fn() },
}));
jest.mock('yjs', () => ({ encodeStateAsUpdate: jest.fn() }));
jest.mock('../collaboration.util', () => ({
  getPageId: (name: string) => name.replace(/^page\./, ''),
  jsonToText: () => 'new text',
  tiptapExtensions: [],
}));
jest.mock('@docmost/db/utils', () => ({ executeTx: jest.fn() }));
jest.mock('@docmost/db/repos/page/page.repo', () => ({ PageRepo: class {} }));
jest.mock('../../common/helpers/prosemirror/utils', () => ({
  extractMentions: () => [],
  extractUserMentions: () => [],
}));
jest.mock('../services/collab-history.service', () => ({
  CollabHistoryService: class {},
}));
jest.mock('../../core/page/transclusion/transclusion.service', () => ({
  TransclusionService: class {},
}));

import { PersistenceExtension } from './persistence.extension';
import { TiptapTransformer } from '@hocuspocus/transformer';
import * as Y from 'yjs';
import { executeTx } from '@docmost/db/utils';
import { Logger } from '@nestjs/common';

const tx = { isTransaction: true };
const a = { id: 'actor-a', workspaceId: 'workspace-a', name: '甲' };
const b = { id: 'actor-b', workspaceId: 'workspace-a', name: '乙' };
const oldContent = { type: 'doc', content: [] };
const newContent = { type: 'doc', content: [{ type: 'paragraph' }] };

function fixture() {
  const page = {
    id: 'page-a',
    slugId: 'slug-a',
    creatorId: a.id,
    workspaceId: 'workspace-a',
    spaceId: 'space-a',
    contributorIds: [],
    content: oldContent,
    ydoc: Buffer.from([1]),
    createdAt: new Date(),
    deletedAt: null,
  };
  const repo = {
    findById: jest.fn().mockResolvedValue(page),
    updatePage: jest.fn().mockResolvedValue({}),
    emitPageUpdated: jest.fn(),
  };
  const ai = { add: jest.fn().mockResolvedValue({}) };
  const history = { add: jest.fn().mockResolvedValue({}) };
  const notifications = { add: jest.fn().mockResolvedValue({}) };
  const contributors = {
    addContributors: jest.fn().mockResolvedValue(undefined),
  };
  const transclusion = {
    syncPageTransclusions: jest.fn().mockResolvedValue(undefined),
    syncPageReferences: jest.fn().mockResolvedValue(undefined),
  };
  const capture = {
    config: { enabled: true },
    capture: jest
      .fn()
      .mockResolvedValue({ id: 'event-a', revision: 1, sha256: 'digest' }),
  };
  const extension = new PersistenceExtension(
    repo as any,
    {} as any,
    ai as any,
    history as any,
    notifications as any,
    contributors as any,
    transclusion as any,
    capture as any,
  );
  const document = { broadcastStateless: jest.fn() };
  const data = {
    documentName: 'page.page-a',
    document,
    lastContext: { user: a },
  } as any;
  const change = (user: typeof a) =>
    extension.onChange({
      documentName: data.documentName,
      context: { user },
    } as any);
  return {
    page,
    repo,
    ai,
    history,
    notifications,
    contributors,
    transclusion,
    capture,
    extension,
    document,
    data,
    change,
  };
}

describe('collaborative save and version capture transaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    (executeTx as jest.Mock).mockImplementation(async (_db, callback) =>
      callback(tx),
    );
    (TiptapTransformer.fromYdoc as jest.Mock).mockReturnValue(newContent);
    (Y.encodeStateAsUpdate as jest.Mock).mockReturnValue(Uint8Array.from([2]));
  });
  afterEach(() => jest.restoreAllMocks());
  it('captures inside the same transaction before broadcasting saved status', async () => {
    const f = fixture();
    await f.change(a);
    await f.extension.onStoreDocument(f.data);
    expect(f.repo.updatePage.mock.calls[0][2]).toBe(tx);
    expect(f.repo.updatePage.mock.calls[0][3]).toEqual({ emitEvent: false });
    expect(f.repo.emitPageUpdated).toHaveBeenCalledWith(
      ['page-a'],
      'workspace-a',
    );
    expect(f.capture.capture.mock.invocationCallOrder[0]).toBeLessThan(
      f.repo.emitPageUpdated.mock.invocationCallOrder[0],
    );
    expect(f.capture.capture).toHaveBeenCalledWith(tx, {
      pageId: 'page-a',
      workspaceId: 'workspace-a',
      actorIds: [a.id],
    });
    const message = JSON.parse(f.document.broadcastStateless.mock.calls[0][0]);
    expect(message.versionCapture.status).toBe('pending');
    expect(f.capture.capture.mock.invocationCallOrder[0]).toBeLessThan(
      f.document.broadcastStateless.mock.invocationCallOrder[0],
    );
  });
  it('rethrows write failure without any success side effects', async () => {
    const f = fixture();
    f.repo.updatePage.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.extension.onStoreDocument(f.data)).rejects.toThrow(
      'database unavailable',
    );
    expect(f.document.broadcastStateless).not.toHaveBeenCalled();
    expect(f.capture.capture).not.toHaveBeenCalled();
    expect(f.repo.emitPageUpdated).not.toHaveBeenCalled();
    expect(f.ai.add).not.toHaveBeenCalled();
    expect(f.history.add).not.toHaveBeenCalled();
    expect(f.transclusion.syncPageTransclusions).not.toHaveBeenCalled();
  });
  it('rethrows snapshot failure without reporting a committed page', async () => {
    const f = fixture();
    f.capture.capture.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(f.extension.onStoreDocument(f.data)).rejects.toThrow(
      'outbox unavailable',
    );
    expect(f.document.broadcastStateless).not.toHaveBeenCalled();
    expect(f.contributors.addContributors).not.toHaveBeenCalled();
    expect(f.repo.emitPageUpdated).not.toHaveBeenCalled();
  });
  it('retains both contributors for retry after a failed save', async () => {
    const f = fixture();
    await f.change(a);
    await f.change(b);
    f.repo.updatePage.mockRejectedValueOnce(new Error('temporary'));
    await expect(f.extension.onStoreDocument(f.data)).rejects.toThrow();
    await f.extension.onStoreDocument(f.data);
    expect(f.capture.capture.mock.calls[0][1].actorIds.sort()).toEqual([
      a.id,
      b.id,
    ]);
  });
  it('does not consume new contributors that arrive during an earlier save', async () => {
    const f = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.repo.updatePage.mockImplementationOnce(() => gate);
    await f.change(a);
    const saving = f.extension.onStoreDocument(f.data);
    await new Promise((resolve) => setImmediate(resolve));
    await f.change(b);
    release();
    await saving;
    await f.extension.onStoreDocument({ ...f.data, lastContext: { user: b } });
    expect(f.capture.capture.mock.calls[0][1].actorIds).toEqual([a.id]);
    expect(f.capture.capture.mock.calls[1][1].actorIds).toEqual([b.id]);
  });
  it('keeps binary-only changes even when visible text is unchanged', async () => {
    const f = fixture();
    (TiptapTransformer.fromYdoc as jest.Mock).mockReturnValue(oldContent);
    await f.extension.onStoreDocument(f.data);
    expect(f.repo.updatePage).toHaveBeenCalled();
    expect(f.capture.capture).toHaveBeenCalledTimes(1);
  });
  it('does not create another version when content and binary state match', async () => {
    const f = fixture();
    (TiptapTransformer.fromYdoc as jest.Mock).mockReturnValue(oldContent);
    (Y.encodeStateAsUpdate as jest.Mock).mockReturnValue(Uint8Array.from([1]));
    await f.extension.onStoreDocument(f.data);
    expect(f.repo.updatePage).not.toHaveBeenCalled();
    expect(f.capture.capture).not.toHaveBeenCalled();
    expect(f.document.broadcastStateless).not.toHaveBeenCalled();
  });
  it('does not revive a deleted page while capturing', async () => {
    const f = fixture();
    f.page.deletedAt = new Date() as any;
    await expect(f.extension.onStoreDocument(f.data)).rejects.toThrow(
      'deleted page',
    );
    expect(f.repo.updatePage).not.toHaveBeenCalled();
    expect(f.document.broadcastStateless).not.toHaveBeenCalled();
  });
  it('does not label a disabled capture as synchronized', async () => {
    const f = fixture();
    f.capture.config.enabled = false;
    f.capture.capture.mockResolvedValueOnce(null);
    await f.extension.onStoreDocument(f.data);
    expect(
      JSON.parse(f.document.broadcastStateless.mock.calls[0][0]).versionCapture,
    ).toBeUndefined();
  });
});
