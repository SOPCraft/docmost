import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { webcrypto } from 'node:crypto';
import { PiWorkbenchPanel } from './pi-workbench-panel';

const mocks = vi.hoisted(() => ({ post: vi.fn(), setAside: vi.fn(), revoked: false, opened: true }));
vi.mock('@/lib/api-client', () => ({ default: { post: mocks.post } }));
vi.mock('jotai', () => ({ useAtomValue: () => ({ isAsideOpen: mocks.opened, tab: 'pi' }), useSetAtom: () => mocks.setAside }));
vi.mock('@/features/user/atoms/current-user-atom', () => ({ currentUserAtom: {} }));
vi.mock('@/components/layouts/global/hooks/atoms/sidebar-atom', () => ({ asideStateAtom: {} }));
vi.mock('@/features/page/queries/page-query', () => ({ usePageQuery: () => ({ data: null }) }));
vi.mock('@/lib', () => ({ extractPageSlugId: (value: string) => value }));

const userId = '10000000-0000-4000-8000-000000000001';
const workspaceId = '20000000-0000-4000-8000-000000000001';
const pageId = '30000000-0000-4000-8000-000000000001';
const spaceId = '30000000-0000-4000-8000-000000000002';
const sessionId = '40000000-0000-4000-8000-000000000001';
const clients: QueryClient[] = [];
const meta = { id: sessionId, title: '合成会话', sources: [{ pageId, versionId: 'fixed', key: 'source', title: '合成保密资料', revision: 1 }] };
const view = {
  meta,
  state: { sessionId, isStreaming: false, isCompacting: false, thinkingLevel: 'off', model: { provider: 'fixture', id: 'synthetic' } },
  messages: [{ role: 'assistant', content: [{ type: 'text', text: '合成保密回复' }] }],
  partial: null, busy: false, cursor: 1, reset: false, events: [], dialogs: [], notices: [],
  models: [{ provider: 'fixture', id: 'synthetic', name: '合成模型' }], commands: [], stats: {}, sessions: [], protocolCommands: ['get_session_stats'], piVersion: '1.0.2',
};
async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const rendered = render(<QueryClientProvider client={client}><MantineProvider env="test"><PiWorkbenchPanel userId={userId} workspaceId={workspaceId} pageId={pageId} spaceId={spaceId} title="当前文档" /></MantineProvider></QueryClientProvider>);
  await screen.findByText('合成保密回复');
  return rendered;
}
async function menuItem(label: string) {
  fireEvent.click(screen.getByRole('button', { name: '设置与工具' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}
async function revoke() {
  mocks.revoked = true;
  fireEvent.click(screen.getByRole('button', { name: '刷新会话' }));
  await screen.findByText(/某份来源版本已不可访问/);
}
beforeEach(() => {
  mocks.revoked = false; mocks.opened = true; mocks.setAside.mockReset();
  vi.stubGlobal('localStorage', { getItem: () => sessionId, setItem() {}, removeItem() {} });
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  mocks.post.mockReset().mockImplementation(async (route: string) => {
    if (route.endsWith('/status')) return { data: { enabled: true, models: view.models, canManageModels: false } };
    if (route.endsWith('/list')) return { data: { items: mocks.revoked ? [] : [meta] } };
    if (route.endsWith('/view')) {
      if (mocks.revoked) throw { response: { data: { message: 'PI_SOURCE_VERSION_UNAVAILABLE' } } };
      return { data: structuredClone(view) };
    }
    if (route.endsWith('/command')) return { data: { success: true, data: { proof: '合成私有操作结果' } } };
    if (route.endsWith('/artifacts')) return { data: [{ name: 'synthetic-private-draft.json', bytes: 100 }] };
    return { data: {} };
  });
});
afterEach(() => { cleanup(); for (const client of clients.splice(0)) client.clear(); vi.unstubAllGlobals(); });

describe('conversation auxiliary state is private', () => {
  it('reopening never flashes a private cached reply before fresh permission validation', async () => {
    const rendered=await setup(); const client=clients.at(-1)!;
    await menuItem('查看真实用量统计');await screen.findByText(/合成私有操作结果/);
    const tree=()=> <QueryClientProvider client={client}><MantineProvider env="test"><PiWorkbenchPanel userId={userId} workspaceId={workspaceId} pageId={pageId} spaceId={spaceId} title="当前文档"/></MantineProvider></QueryClientProvider>;
    mocks.opened=false;rendered.rerender(tree());expect(screen.queryByText('合成保密回复')).toBeNull();expect(screen.queryByText(/合成私有操作结果/)).toBeNull();
    let resolve!:(value:unknown)=>void; const original=mocks.post.getMockImplementation()!;
    mocks.post.mockImplementation((route,...args)=>route.endsWith('/view')?new Promise(done=>{resolve=done;}):original(route,...args));
    mocks.opened=true;rendered.rerender(tree());expect(screen.queryByText('合成保密回复')).toBeNull();expect(screen.queryByText(/合成私有操作结果/)).toBeNull();
    await waitFor(()=>expect(resolve).toBeTypeOf('function'));
    await act(async()=>{resolve({data:structuredClone(view)});});await screen.findByText('合成保密回复');
  });

  it('removes operation output and source chips with the revoked transcript', async () => {
    await setup();
    await menuItem('查看真实用量统计');
    await screen.findByText(/合成私有操作结果/);
    await revoke();
    expect(screen.queryByText(/合成私有操作结果/)).toBeNull();
    expect(screen.queryByText('合成保密回复')).toBeNull();
    expect(screen.queryByText(/合成保密资料/)).toBeNull();
    expect(screen.queryByText('当前文档')).toBeNull();
  });
  it('removes artifact names as soon as source access is lost', async () => {
    await setup();
    await menuItem('查看生成文件');
    await screen.findByRole('button', { name: /synthetic-private-draft/ });
    await revoke();
    expect(screen.queryByRole('button', { name: /synthetic-private-draft/ })).toBeNull();
  });
  it('ignores an artifact list that resolves after the access epoch changed', async () => {
    let resolve!: (value: unknown) => void;
    const original = mocks.post.getMockImplementation()!;
    mocks.post.mockImplementation((route, ...args) => route.endsWith('/artifacts') ? new Promise(done => { resolve = done; }) : original(route, ...args));
    await setup();
    await menuItem('查看生成文件');
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    await revoke();
    await act(async () => { resolve({ data: [{ name: 'late-private-file.json', bytes: 100 }] }); });
    expect(screen.queryByRole('button', { name: /late-private-file/ })).toBeNull();
  });
});
