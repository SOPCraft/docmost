export type PiRecord = { type: string; [key: string]: unknown };
export type PiMessage = { role: string; content: unknown; timestamp?: number; [key: string]: unknown };
export type PiViewState = {
  messages: PiMessage[];
  streaming: PiMessage | null;
  busy: boolean;
  phase: string;
  sequence: number;
  dialogs: PiRecord[];
};
export const emptyPiState = (): PiViewState => ({ messages: [], streaming: null, busy: false, phase: '', sequence: 0, dialogs: [] });
export function applyPiRecord(state: PiViewState, record: PiRecord, sequence: number): PiViewState {
  if (sequence <= state.sequence) return state;
  const next = { ...state, sequence };
  if (record.type === 'agent_start') return { ...next, busy: true, phase: '正在处理' };
  if (record.type === 'agent_settled') return { ...next, busy: false, streaming: null, phase: '' };
  // agent_end can precede automatic recovery or queued work; it is not completion.
  if (record.type === 'message_update' || record.type === 'message_start') {
    return record.message ? { ...next, streaming: record.message as PiMessage } : next;
  }
  if (record.type === 'message_end' && record.message) {
    return { ...next, messages: [...next.messages, record.message as PiMessage], streaming: null };
  }
  if (record.type === 'tool_execution_start') return { ...next, phase: `正在执行：${String(record.toolName || '工具')}` };
  if (record.type === 'auto_compaction_start') return { ...next, busy: true, phase: '正在整理长对话上下文' };
  if (record.type === 'auto_retry_start') return { ...next, busy: true, phase: '正在重试' };
  if (record.type === 'extension_ui_request') return { ...next, dialogs: [...next.dialogs.filter(x => x.id !== record.id), record] };
  if (record.type === 'host_process_exit') return { ...next, busy: false, streaming: null, phase: '执行进程已停止；已保存的对话保留' };
  return next;
}
export function piMessageText(message: PiMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content.filter(item => item?.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n');
}
