import { useEffect, useState } from 'react';
import { Alert, Button, Group, Modal, NumberInput, PasswordInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import { piError, piRequest } from './pi-workbench-api';

type ModelForm={provider:string;modelId:string;label:string;api:string;baseUrl:string;apiKey:string;reasoning:boolean;contextWindow:number;maxTokens:number;input:string[];compat?:object};
type Settings={revision:string;models:(Omit<ModelForm,'apiKey'>&{configured:boolean})[];allowLoopback:boolean};
const blank=():ModelForm=>({provider:'custom',modelId:'',label:'',api:'openai-completions',baseUrl:'',apiKey:'',reasoning:false,contextWindow:65536,maxTokens:8192,input:['text']});
export default function PiModelSettings({opened,onClose,onSaved}:{opened:boolean;onClose:()=>void;onSaved:()=>void}){
  const [settings,setSettings]=useState<Settings|null>(null),[form,setForm]=useState<ModelForm>(blank),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!opened)return;let active=true;setError('');void piRequest<Settings>('model-settings',{}).then(value=>{if(active)setSettings(value);}).catch(failure=>{if(active)setError(piError(failure));});return()=>{active=false;setForm(blank());};},[opened]);
  const change=(key:keyof ModelForm,value:unknown)=>setForm(current=>({...current,[key]:value}));
  function choose(value:string|null){const model=settings?.models.find(item=>`${item.provider}/${item.modelId}`===value);setForm(model?{provider:model.provider,modelId:model.modelId,label:model.label,api:model.api,baseUrl:model.baseUrl,apiKey:'',reasoning:model.reasoning,contextWindow:model.contextWindow,maxTokens:model.maxTokens,input:model.input||['text'],...(model.compat?{compat:model.compat}:{})}:blank());setError('');}
  async function save(remove=false){
    if(!settings||busy)return;
    if(remove&&!window.confirm('删除这个模型配置？已保存的对话不会删除。'))return;
    setBusy(true);setError('');
    try{const next=await piRequest<Settings>('save-model',{revision:settings.revision,model:form,remove});setSettings(next);setForm(current=>({...current,apiKey:''}));onSaved();if(remove)setForm(blank());}
    catch(failure){setError(piError(failure));}finally{setBusy(false);}
  }
  const configured=settings?.models.some(model=>model.provider===form.provider&&model.modelId===form.modelId);
  return <Modal opened={opened} onClose={()=>{if(!busy)onClose();}} title="智能体模型设置" size="md" centered>
    <Stack gap="sm">
      <Text size="xs" c="dimmed">仅工作空间管理员可修改。密钥保存在服务端加密配置中，不写入文档或聊天记录。</Text>
      <Select label="已配置模型" placeholder="新增模型" clearable data={(settings?.models||[]).map(model=>({value:`${model.provider}/${model.modelId}`,label:model.label||model.modelId}))} onChange={choose}/>
      <Group grow><TextInput label="提供方标识" description="小写字母、数字和短横线" value={form.provider} onChange={event=>change('provider',event.currentTarget.value)}/><TextInput label="显示名称" value={form.label} onChange={event=>change('label',event.currentTarget.value)}/></Group>
      <TextInput label="模型编号" value={form.modelId} onChange={event=>change('modelId',event.currentTarget.value)}/>
      <Select label="接口协议" value={form.api} onChange={value=>value&&change('api',value)} data={[{value:'openai-completions',label:'聊天补全兼容接口'},{value:'openai-responses',label:'响应式兼容接口'},{value:'anthropic-messages',label:'消息式兼容接口'}]}/>
      <TextInput label="服务地址" placeholder="完整的接口基础地址" value={form.baseUrl} onChange={event=>change('baseUrl',event.currentTarget.value)}/>
      <PasswordInput label="模型密钥" description={configured?'留空保留已有密钥；服务端不会回传原值。':'填写此提供方的访问密钥。'} value={form.apiKey} onChange={event=>change('apiKey',event.currentTarget.value)} autoComplete="new-password"/>
      <Group grow><NumberInput label="上下文上限" value={form.contextWindow} min={256} max={2000000} onChange={value=>change('contextWindow',Number(value))}/><NumberInput label="输出上限" value={form.maxTokens} min={256} max={200000} onChange={value=>change('maxTokens',Number(value))}/></Group>
      <Switch label="模型支持思考强度" checked={form.reasoning} onChange={event=>change('reasoning',event.currentTarget.checked)}/>
      <Switch label="模型支持图片输入" checked={form.input.includes('image')} onChange={event=>change('input',event.currentTarget.checked?['text','image']:['text'])}/>
      <Text size="xs" c="dimmed">修改前请先停止本工作空间内正在运行的智能体。保存后重新载入模型，不删除会话。</Text>
      {error&&<Alert color="red">{error}</Alert>}
      <Group justify="space-between"><Button variant="subtle" color="red" disabled={!configured||busy} onClick={()=>void save(true)}>删除此模型</Button><Button disabled={!settings||!form.modelId||!form.baseUrl||busy} loading={busy} onClick={()=>void save()}>保存模型配置</Button></Group>
    </Stack>
  </Modal>;
}
