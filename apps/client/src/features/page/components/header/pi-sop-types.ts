export interface PiSource { pageId: string; versionId: string; revision: number; title: string }
export interface PiReference { blockId: string; quote: string }
export interface PiClaim { text: string; kind: 'source' | 'suggestion' | 'missing'; references: PiReference[] }
export interface PiStep {
  id: string; title: string; action: PiClaim; owner: PiClaim | null;
  checks: PiClaim[]; exceptions: PiClaim[];
  next: { condition: PiClaim; stepId: string | null }[];
}
export interface PiPreview {
  schema: 'sop.draft-envelope/1'; saved: false; reviewRequired: true;
  draft: {
    title: string; goal: PiClaim; scope: PiClaim; prerequisites: PiClaim[];
    steps: PiStep[]; issues: { kind: 'gap' | 'conflict'; question: string; references: PiReference[] }[];
    coverage: { blockId: string; stepIds: string[]; reason: string | null }[];
  };
  uninterpreted: { blockId: string; kind: string }[];
}
export interface PiStatus {
  enabled: boolean; configurationId?: string;
  model?: { id: string; label: string; provider: string };
  skill?: { id: string; version: string; label: string };
}
export const selectionIds = (items: PiSource[]) => items.map(({ pageId, versionId }) => ({ pageId, versionId }));
const messages: Record<string, string> = {
  PI_GENERATION_BUSY: '已有整理任务正在运行，请先完成或取消当前任务。',
  PI_SOURCE_VERSION_PENDING: '所选资料尚未形成已同步的固定版本，请先保存原稿并等待版本同步。',
  PI_MODEL_CONFIGURATION_CHANGED: '管理员已调整模型配置，本次结果未采用，请重新核对模型。',
  PI_HOST_CONFIGURATION_INVALID: '模型运行配置不完整，请由管理员检查；密钥不在此页面填写。',
  PI_HOST_DISABLED: '当前工作空间尚未启用流程整理。',
  PI_TIMEOUT: '本次整理超时，没有保存或发布任何结果。',
  PI_CANCELLED: '本次整理已取消。',
  SOURCE_TOO_LARGE_NO_TRUNCATION: '资料超出本批处理范围，系统没有截断内容，请减少所选资料。',
  UNSUPPORTED_SOURCE_STRUCTURE: '资料包含尚未支持的内容结构，系统没有跳过这些内容。',
};
export function piErrorMessage(error: unknown): string {
  const value = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof value === 'string' && messages[value]
    ? messages[value]
    : '整理未完成。请核对账户与资料权限、原稿是否已同步，以及模型连接；没有覆盖原稿。';
}
