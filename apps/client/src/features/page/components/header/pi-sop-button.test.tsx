import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PiSopButton, { PiDraftPreview } from './pi-sop-button';
import { PiPreview, piErrorMessage, selectionIds } from './pi-sop-types';

const mocks = vi.hoisted(() => ({ post: vi.fn(), user: { id: 'fixture-user' } as { id: string } | null }));
vi.mock('@/lib/api-client', () => ({ default: { post: mocks.post } }));
vi.mock('jotai', () => ({ useAtomValue: () => ({ user: mocks.user }) }));
vi.mock('@/features/user/atoms/current-user-atom', () => ({ currentUserAtom: {} }));
const pageId = '50000000-0000-4000-8000-000000000001';
const versionId = '60000000-0000-4000-8000-000000000001';
const pinned = [{ pageId, versionId, revision: 2, title: '合成资料' }];
const config = { enabled: true, configurationId: 'a'.repeat(64), model: { id: 'fixture', label: '合成模型', provider: 'fixture' }, skill: { id: 'sop-organizer', version: '0.1.0', label: '通用流程整理' } };
function preview(): PiPreview {
  const claim = { text: '检查合成素材', kind: 'source' as const, references: [{ blockId: 'source-1:block-0', quote: '<img src=x onerror=alert(1)>' }] };
  return { schema: 'sop.draft-envelope/1', reviewRequired: true, saved: false, uninterpreted: [{ blockId: 'source-1:block-1', kind: 'image' }],
    draft: { title: '合成流程预览', goal: claim, scope: { text: '待确认适用范围', kind: 'missing', references: [] }, prerequisites: [],
      steps: [{ id: 'step-1', title: '素材检查', action: claim, owner: null, checks: [], exceptions: [], next: [] }],
      issues: [{ kind: 'gap', question: '请明确责任人', references: [] }],
      coverage: [{ blockId: 'source-1:block-0', stepIds: ['step-1'], reason: null }, { blockId: 'source-1:block-1', stepIds: [], reason: '图片未解析' }] } };
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MantineProvider env="test"><PiSopButton pageId={pageId} title="合成资料" /></MantineProvider></QueryClientProvider>);
}
async function open() {
  setup(); fireEvent.click(screen.getByRole('button', { name: '流程整理' }));
  await screen.findByText(/内置技能：通用流程整理/);
  await waitFor(() => expect((screen.getByRole('button', { name: '整理选中资料' }) as HTMLButtonElement).disabled).toBe(false));
}
beforeEach(() => {
  mocks.user = { id: 'fixture-user' };
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  // jsdom lacks FontFaceSet; the real Mantine autosize component subscribes to it.
  Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockImplementation(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  mocks.post.mockReset().mockImplementation(async (route: string) => {
    if (route.endsWith('/status')) return { data: config };
    if (route.endsWith('/prepare')) return { data: { items: pinned } };
    if (route.endsWith('/generate')) return { data: preview() };
    if (route.endsWith('/revalidate')) return { data: { valid: true } };
    return { data: { items: [] } };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('native organizer', () => {
  it('is absent for anonymous users', () => {
    mocks.user = null; setup(); expect(screen.queryByRole('button', { name: '流程整理' })).toBeNull();
  });
  it('requires configured workspace model and does not ask for a client key', async () => {
    mocks.post.mockResolvedValue({ data: { enabled: false } });
    setup(); fireEvent.click(screen.getByRole('button', { name: '流程整理' }));
    await screen.findByText(/管理员尚未为当前工作空间启用模型/);
    expect((screen.getByRole('button', { name: '整理选中资料' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('整理要求')).toBeTruthy();
    expect(screen.getByLabelText('添加资料')).toBeTruthy();
    expect(screen.getAllByText('合成资料').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '整理选中资料' }));
    expect(mocks.post.mock.calls.some(([route]) => route.endsWith('/generate'))).toBe(false);
  });
  it('keeps generation disabled until the administrator configuration is resolved', async () => {
    let resolve!: (value: unknown) => void;
    const fallback = mocks.post.getMockImplementation()!;
    mocks.post.mockImplementation((route, ...args) => route.endsWith('/status') ? new Promise(done => { resolve = done; }) : fallback(route, ...args));
    setup(); fireEvent.click(screen.getByRole('button', { name: '流程整理' }));
    const button = screen.getByRole('button', { name: '整理选中资料' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.post.mock.calls.some(([route]) => route.endsWith('/prepare') || route.endsWith('/generate'))).toBe(false);
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    await act(async () => { resolve({ data: config }); });
    await waitFor(() => expect(button.disabled).toBe(false));
  });
  it('prepares exact versions before generation and labels the result unsaved', async () => {
    await open(); fireEvent.click(screen.getByRole('button', { name: '整理选中资料' }));
    await screen.findByText('合成流程预览');
    expect(screen.getByText(/当前是待核对预览，尚未保存/)).toBeTruthy();
    const generate = mocks.post.mock.calls.find(([route]) => route.endsWith('/generate'));
    expect(generate?.[1]).toEqual({ selections: [{ pageId, versionId }], instruction: expect.any(String), skillId: 'sop-organizer', configurationId: config.configurationId });
    expect(mocks.post.mock.calls.findIndex(([route]) => route.endsWith('/prepare'))).toBeLessThan(mocks.post.mock.calls.findIndex(([route]) => route.endsWith('/generate')));
    expect(screen.getByText(/固定第2版/)).toBeTruthy();
  });
  it('does not send a generation request after source preparation fails', async () => {
    const fallback = mocks.post.getMockImplementation()!;
    mocks.post.mockImplementation((route, ...args) => route.endsWith('/prepare') ? Promise.reject(new Error('private-source')) : fallback(route, ...args));
    await open(); fireEvent.click(screen.getByRole('button', { name: '整理选中资料' }));
    await screen.findByText(/整理未完成。请核对/);
    expect(mocks.post.mock.calls.some(([route]) => route.endsWith('/generate'))).toBe(false);
    expect(screen.queryByText('private-source')).toBeNull();
  });
  it('aborts cancellation and ignores a late result even if transport still resolves', async () => {
    let resolve!: (value: unknown) => void; let signal!: AbortSignal;
    const fallback = mocks.post.getMockImplementation()!;
    mocks.post.mockImplementation((route, body, options) => {
      if (!route.endsWith('/generate')) return fallback(route, body, options);
      signal = options.signal; return new Promise(done => { resolve = done; });
    });
    await open(); fireEvent.click(screen.getByRole('button', { name: '整理选中资料' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: '取消本次整理' }));
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ data: preview() }); });
    expect(screen.queryByText('合成流程预览')).toBeNull();
  });
  it('clears a preview when the page leaves the foreground', async () => {
    await open(); fireEvent.click(screen.getByRole('button', { name: '整理选中资料' })); await screen.findByText('合成流程预览');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByText('合成流程预览')).toBeNull();
  });
  it('removes the preview when periodic source revalidation fails', async () => {
    const fallback = mocks.post.getMockImplementation()!;
    mocks.post.mockImplementation((route, ...args) => route.endsWith('/revalidate') ? Promise.reject(new Error('revoked')) : fallback(route, ...args));
    await open(); fireEvent.click(screen.getByRole('button', { name: '整理选中资料' })); await screen.findByText('合成流程预览');
    await waitFor(() => expect(screen.queryByText('合成流程预览')).toBeNull(), { timeout: 7000 });
    expect(screen.getByText(/来源已变化、无法访问或连接中断/)).toBeTruthy();
  }, 10000);
  it('renders hostile source snippets as text rather than executable markup', () => {
    const view = render(<MantineProvider env="test"><PiDraftPreview result={preview()} /></MantineProvider>);
    expect(view.container.querySelector('img')).toBeNull();
    expect(screen.getAllByText(/<img src=x onerror=alert\(1\)>/).length).toBeGreaterThan(0);
    expect(screen.getByText('请明确责任人')).toBeTruthy();
    expect(screen.getByText(/共有1处媒体或链接目标未解析/)).toBeTruthy();
  });
});
it('strips title and revision from source selections submitted to generation', () => {
  expect(selectionIds(pinned)).toEqual([{ pageId, versionId }]);
});
it('never surfaces an arbitrary server or provider error message', () => {
  expect(piErrorMessage({ response: { data: { message: 'DO_NOT_EXPOSE_KEY' } } })).not.toContain('DO_NOT_EXPOSE_KEY');
  expect(piErrorMessage(null)).toContain('整理未完成');
});
it('explains known cancellation and timeout without claiming a saved result', () => {
  expect(piErrorMessage({ response: { data: { message: 'PI_TIMEOUT' } } })).toContain('没有保存');
  expect(piErrorMessage({ response: { data: { message: 'PI_CANCELLED' } } })).toContain('已取消');
});
