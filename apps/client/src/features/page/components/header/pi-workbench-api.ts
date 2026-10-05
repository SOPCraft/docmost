import api from '@/lib/api-client';
import type { PiMessage, PiRecord } from './pi-workbench-state';
export type PiSourceRef = { pageId:string; versionId:string; title:string; revision?:number; key:string };
export type PiConversation = { id:string; title:string; createdAt:string; updatedAt:string; sources:PiSourceRef[] };
export type PiModel = { provider:string; id:string; name?:string; label?:string; reasoning?:boolean };
export type PiCommand = { name:string; description?:string; source:'skill'|'extension'|'prompt' };
export type PiView = {
  meta:PiConversation;
  state:{ sessionId:string; sessionFile?:string; sessionName?:string; model?:PiModel; isStreaming:boolean; isCompacting:boolean; thinkingLevel:string; autoCompactionEnabled:boolean; pendingMessageCount:number };
  messages:PiMessage[]; partial:PiMessage|null; busy:boolean; cursor:number; reset:boolean;
  events:{ sequence:number;record:PiRecord }[]; dialogs:PiRecord[]; notices:PiRecord[];
  models:PiModel[]; commands:PiCommand[]; stats:Record<string,unknown>;
  sessions:{path:string;name:string}[]; protocolCommands:string[]; piVersion:string;
};
export async function piRequest<T>(route:string,body:unknown,signal?:AbortSignal):Promise<T> {
  return (await api.post<T>('/pages/pi-workbench/'+route,body,{signal,timeout:70000})).data;
}
export const piError = (error:unknown):string => {
  const code=(error as {response?:{data?:{message?:string}}})?.response?.data?.message;
  const messages:Record<string,string>={
    PI_MODEL_ADMIN_REQUIRED:'只有工作空间管理员可以修改模型设置。',
    PI_MODEL_SETTINGS_BUSY:'请先停止正在运行的智能体，再修改模型配置。',
    PI_MODEL_SETTINGS_CHANGED:'模型配置已被其他操作更新，请重新打开设置后核对。',
    PI_MODEL_CONFIG_INVALID:'模型配置有误，请检查接口协议、地址和上下文限制。',
    PI_MODEL_KEY_REQUIRED:'新增模型需要填写访问密钥。',
    PI_WORKBENCH_NOT_CONFIGURED:'智能体执行器尚未配置。',
    PI_WORKBENCH_UNREACHABLE:'执行器连接中断；已保存的对话保留，不会自动重复发送。',
    PI_COMMAND_OUTCOME_UNKNOWN:'本次操作结果待核验。请刷新会话检查，不要重复发送。',
    PI_CAPACITY_BUSY:'执行器正在处理其他任务，请稍后重试。',
    PI_DIALOG_EXPIRED:'这个确认请求已结束，请以当前对话为准。',
    PI_SESSION_NOT_FOUND:'对话不可用或没有访问权限。',
    PI_SOURCE_VERSION_UNAVAILABLE:'某份来源版本已不可访问，对话暂时停止提供。',
    PI_SOURCE_VERSION_PENDING:'原稿最新版本尚未同步，请保存完成后重试。',
  };
  return code&&messages[code]?messages[code]:'操作未完成。请检查连接、文档权限和模型配置；系统没有把失败记为成功。';
};
export function selectedConversationKey(workspaceId:string,userId:string){return `pi-workbench:${workspaceId}:${userId}:selected`;}
