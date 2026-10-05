import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import PiWorkbenchActions from './pi-workbench-actions';

const actions = { onModels: vi.fn(), onCommand: vi.fn(), onFiles: vi.fn(), onAdvanced: vi.fn() };
function open(overrides: Partial<Parameters<typeof PiWorkbenchActions>[0]> = {}) {
  render(<MantineProvider env="test"><PiWorkbenchActions {...actions} canManageModels sessionAvailable busy={false} posting={false} {...overrides} /></MantineProvider>);
  fireEvent.click(screen.getByRole('button', { name: '设置与工具' }));
}
beforeEach(() => { Object.values(actions).forEach(action => action.mockReset()); });
afterEach(cleanup);

describe('one grouped workbench settings entry', () => {
  it('replaces the two neighboring ambiguous icons with one labeled entry', () => {
    open();
    expect(screen.getAllByRole('button', { name: '设置与工具' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '更多会话操作' })).toBeNull();
    expect(screen.queryByRole('button', { name: '模型服务设置' })).toBeNull();
    expect(screen.getByText('当前会话')).toBeTruthy();
    expect(screen.getByText('高级工具')).toBeTruthy();
    Object.values(actions).forEach(action => expect(action).not.toHaveBeenCalled());
  });
  it('retains administrator model configuration', () => {
    open();fireEvent.click(screen.getByRole('menuitem', { name: '模型设置' }));expect(actions.onModels).toHaveBeenCalledTimes(1);
  });
  it('does not expose model administration to ordinary members', () => {
    open({ canManageModels: false });expect(screen.queryByRole('menuitem', { name: '模型设置' })).toBeNull();expect(screen.getByRole('menuitem', { name: '完整原生控制' })).toBeTruthy();
  });
  for (const [name, command] of [['克隆当前会话分支', 'clone'], ['整理长对话上下文', 'compact'], ['清空追加队列', 'clear_queue'], ['查看真实用量统计', 'get_session_stats'], ['导出对话网页', 'export_html']]) {
    it('preserves ' + name, () => { open();fireEvent.click(screen.getByRole('menuitem', { name }));expect(actions.onCommand).toHaveBeenCalledWith(command); });
  }
  it('preserves file delivery and the advanced tool launcher', () => {
    open();fireEvent.click(screen.getByRole('menuitem', { name: '查看生成文件' }));expect(actions.onFiles).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '设置与工具' }));fireEvent.click(screen.getByRole('menuitem', { name: '完整原生控制' }));expect(actions.onAdvanced).toHaveBeenCalledTimes(1);
  });
  it('does not mutate a session while another operation is still being submitted', () => {
    open({ posting: true });const item=screen.getByRole('menuitem', { name: '克隆当前会话分支' });
    expect(item.getAttribute('data-disabled') !== null || item.getAttribute('aria-disabled') === 'true' || (item as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(item);expect(actions.onCommand).not.toHaveBeenCalled();
  });
  it('does not allow compression during an active native run', () => {
    open({ busy: true });fireEvent.click(screen.getByRole('menuitem', { name: '整理长对话上下文' }));expect(actions.onCommand).not.toHaveBeenCalled();
  });
});
