import {useEffect,useState} from 'react';
import {Alert,Button,Group,Modal,NumberInput,Stack,Switch,Text,TextInput} from '@mantine/core';
import type {ServiceModel} from './pi-model-services-types';
const blank=():ServiceModel=>({modelId:'',label:'',reasoning:false,contextWindow:65536,maxTokens:8192,input:['text'],capabilities:{},origin:'manual'});
export default function PiServiceModelEditor({model,opened,busy,onClose,onSave,existingIds}:{model:ServiceModel|null;opened:boolean;busy:boolean;onClose:()=>void;onSave:(model:ServiceModel)=>Promise<void>;existingIds:string[]}){
 const [form,setForm]=useState<ServiceModel>(blank),[advanced,setAdvanced]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(opened){setForm(model?structuredClone(model):blank());setAdvanced(false);setError('');}},[opened,model]);
 async function save(){
  if(busy)return;const id=form.modelId.trim();
  if(!id||id.length>160){setError('请填写有效的模型编号。');return;}
  if(!model&&existingIds.includes(id)){setError('模型编号已存在，请编辑原模型。');return;}
  if(!Number.isInteger(form.contextWindow)||form.contextWindow<256||form.contextWindow>2000000||!Number.isInteger(form.maxTokens)||form.maxTokens<256||form.maxTokens>200000||form.maxTokens>form.contextWindow){setError('上下文和输出上限无效；输出不能超过上下文。');return;}
  await onSave({...form,modelId:id,label:form.label.trim()||id,origin:'manual'});
 }
 const capability=(name:'streaming'|'tools',checked:boolean)=>setForm(current=>({...current,capabilities:{...current.capabilities,[name]:checked}}));
 return <Modal opened={opened} onClose={()=>{if(!busy)onClose();}} title={model?'编辑模型':'新建模型'} centered size="md" closeOnClickOutside={false} closeOnEscape={!busy} closeButtonProps={{disabled:busy,'aria-label':'关闭模型编辑'}}>
  <Stack gap="sm"><Text size="xs" c="dimmed">模型编号必须与供应商实际提供的编号或云部署名称一致。</Text>
   <TextInput label="模型编号" value={form.modelId} readOnly={!!model} disabled={busy} onChange={event=>{const value=event.currentTarget.value;setForm(current=>({...current,modelId:value}));}}/>
   <TextInput label="显示名称" value={form.label} disabled={busy} onChange={event=>{const value=event.currentTarget.value;setForm(current=>({...current,label:value}));}}/>
   <Button size="compact-xs" variant="subtle" onClick={()=>setAdvanced(value=>!value)}>高级参数</Button>
   {advanced&&<Stack gap="xs"><Group grow><NumberInput label="上下文上限" value={form.contextWindow} min={256} max={2000000} disabled={busy} onChange={value=>setForm(current=>({...current,contextWindow:Number(value)}))}/><NumberInput label="输出上限" value={form.maxTokens} min={256} max={200000} disabled={busy} onChange={value=>setForm(current=>({...current,maxTokens:Number(value)}))}/></Group>
    <Switch label="支持图片输入" checked={form.input.includes('image')} disabled={busy} onChange={event=>{const checked=event.currentTarget.checked;setForm(current=>({...current,input:checked?['text','image']:['text'],capabilities:{...current.capabilities,vision:checked}}));}}/>
    <Switch label="支持工具调用" checked={form.capabilities?.tools===true} disabled={busy} onChange={event=>capability('tools',event.currentTarget.checked)}/>
    <Switch label="支持流式输出" checked={form.capabilities?.streaming===true} disabled={busy} onChange={event=>capability('streaming',event.currentTarget.checked)}/>
    <Switch label="支持思考强度" checked={form.reasoning} disabled={busy} onChange={event=>{const checked=event.currentTarget.checked;setForm(current=>({...current,reasoning:checked}));}}/>
    <Text size="xs" c="dimmed">这些是模型目录说明，不替代真实能力验证；未知项保持未声明。</Text>
   </Stack>}
   {error&&<Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy} onClick={onClose}>取消</Button><Button loading={busy} onClick={()=>void save()}>保存模型</Button></Group>
  </Stack>
 </Modal>;
}
