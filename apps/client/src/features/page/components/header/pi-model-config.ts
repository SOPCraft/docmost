export type ModelForm = {
  provider: string; modelId: string; label: string; api: string; baseUrl: string; apiKey: string;
  reasoning: boolean; contextWindow: number; maxTokens: number; input: string[]; compat?: object;
};
export type SavedModel = Omit<ModelForm, 'apiKey'> & { configured: boolean };
export type ModelSettings = { revision: string; models: SavedModel[]; allowLoopback: boolean };
export type ProviderGroup = { id: string; models: SavedModel[] };
export const protocols = [
  { value: 'openai-completions', label: '聊天补全兼容接口' },
  { value: 'openai-responses', label: '响应式兼容接口' },
  { value: 'anthropic-messages', label: '消息式兼容接口' },
];
export function groupProviders(models: SavedModel[]): ProviderGroup[] {
  const groups = new Map<string, SavedModel[]>();
  for (const model of models) groups.set(model.provider, [...(groups.get(model.provider) || []), model]);
  return [...groups].map(([id, models]) => ({ id, models }));
}
export function providerName(id: string) {
  const names: Record<string, string> = { qwen: '千问', dashscope: '千问', deepseek: '深度求索', zhipu: '智谱', glm: '智谱', doubao: '豆包', moonshot: '月之暗面', kimi: '月之暗面', openai: 'OpenAI（模型服务）', anthropic: 'Anthropic（模型服务）', custom: '自定义服务' };
  return Object.prototype.hasOwnProperty.call(names, id.toLowerCase()) ? names[id.toLowerCase()] : id;
}
export function newModel(provider = 'custom'): ModelForm {
  return { provider, modelId: '', label: '', api: 'openai-completions', baseUrl: '', apiKey: '', reasoning: false, contextWindow: 65536, maxTokens: 8192, input: ['text'] };
}
export function editModel(model: SavedModel): ModelForm {
  // Only protocol input fields are copied. Never round-trip workspace IDs,
  // credential indicators or future response-only fields into the write API.
  return { provider: model.provider, modelId: model.modelId, label: model.label, api: model.api, baseUrl: model.baseUrl, apiKey: '', reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens, input: [...model.input], ...(model.compat ? { compat: structuredClone(model.compat) } : {}) };
}
export function modelErrors(form: ModelForm, settings: ModelSettings, existing: boolean) {
  const errors: Record<string, string> = {};
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(form.provider)) errors.provider = '使用小写字母开头，可包含数字、短横线和下划线。';
  if (!form.modelId.trim() || form.modelId.trim().length > 160) errors.modelId = '填写服务商提供的模型编号。';
  if (!existing && settings.models.some(item => item.provider === form.provider && item.modelId === form.modelId.trim())) errors.modelId = '这个模型已经存在，请在列表中编辑。';
  try {
    const url = new URL(form.baseUrl);
    const local = settings.allowLoopback && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !local)) throw new Error();
  } catch { errors.baseUrl = '填写有效的安全接口地址，不包含凭据或查询参数。'; }
  if (!form.apiKey && !settings.models.some(item => item.provider === form.provider && item.configured)) errors.apiKey = '首次连接此服务商需要填写访问密钥。';
  if (!protocols.some(item => item.value === form.api)) errors.api = '选择支持的接口协议。';
  if (!Number.isInteger(form.contextWindow) || form.contextWindow < 256 || form.contextWindow > 2000000) errors.contextWindow = '上下文上限须在256至2000000之间。';
  if (!Number.isInteger(form.maxTokens) || form.maxTokens < 256 || form.maxTokens > 200000 || form.maxTokens > form.contextWindow) errors.maxTokens = '输出上限不得超过上下文上限，且须在256至200000之间。';
  return errors;
}
export function endpointPreview(form: Pick<ModelForm, 'baseUrl' | 'api'>) {
  const suffix = form.api === 'anthropic-messages' ? '/messages' : form.api === 'openai-responses' ? '/responses' : '/chat/completions';
  return form.baseUrl.trim() ? form.baseUrl.replace(/\/$/, '') + suffix : '';
}
