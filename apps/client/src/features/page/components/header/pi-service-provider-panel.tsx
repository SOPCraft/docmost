import {useEffect,useRef,useState} from 'react';
import {ActionIcon,Alert,Badge,Button,Group,Modal,PasswordInput,Select,Stack,Switch,Text,TextInput,Tooltip} from '@mantine/core';
import {IconBolt,IconDownload,IconExternalLink,IconFileText,IconPlugConnected,IconPlus,IconRefresh,IconSettings2,IconSparkles,IconTool,IconTrash,IconArrowUp} from '@tabler/icons-react';
import {piRequest} from './pi-workbench-api';
import {connectionForm,countLabel,modelState,presetModels,providerError,requestAddress} from './pi-model-services-types';
import type {ConnectionForm,ModelServicesView,ServiceEntry,ServiceModel,ServicePreset} from './pi-model-services-types';
import PiServiceModelEditor from './pi-service-model-editor';
import styles from './pi-model-services.module.css';

export function ProviderIcon({preset}:{preset:ServicePreset|null}){const [broken,setBroken]=useState(false);return <span className={styles.providerIcon}>{preset?.icon&&!broken?<img src={preset.icon} alt="" className={preset.monochrome?styles.monochrome:undefined} onError={()=>setBroken(true)}/>:<IconPlugConnected size={18}/>}</span>;}
export default function PiServiceProviderPanel({entry,view,custom,onApply,onDirty,onBusy}:{entry:ServiceEntry;view:ModelServicesView;custom:boolean;onApply:(view:ModelServicesView,selectedProvider?:string)=>void;onDirty:(value:boolean)=>void;onBusy:(value:boolean)=>void}){
 const [form,setForm]=useState<ConnectionForm>(()=>connectionForm(entry)),[baseline,setBaseline]=useState(()=>JSON.stringify(connectionForm(entry))),[busy,setBusy]=useState(''),[error,setError]=useState(''),[feedback,setFeedback]=useState<{success:boolean;message:string}|null>(null),[advanced,setAdvanced]=useState(false),[search,setSearch]=useState(''),[selectedTest,setSelectedTest]=useState('');
 const [editing,setEditing]=useState<{model:ServiceModel|null}|null>(null),[confirmation,setConfirmation]=useState<{kind:'hide-model'|'restore-catalog'|'remove-connection';modelId?:string}|null>(null);
 const alive=useRef(true),lock=useRef(false),controller=useRef<AbortController|null>(null);
 const models=presetModels(entry),dirty=JSON.stringify(form)!==baseline,supported=entry.preset?.execution!=='pending',saved=!!entry.connection;
 const chosenTest=models.some(model=>model.modelId===selectedTest)?selectedTest:models[0]?.modelId||'';
 useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
 useEffect(()=>{onBusy(!!busy);},[busy,onBusy]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();onBusy(false);onDirty(false);};},[onBusy,onDirty]);
 function change(key:keyof ConnectionForm,value:unknown){setForm(current=>({...current,[key]:value}));setError('');setFeedback(null);}
 async function run(kind:string,action:(signal:AbortSignal)=>Promise<unknown>){
  if(lock.current)return;lock.current=true;setBusy(kind);setError('');setFeedback(null);const abort=new AbortController();controller.current=abort;
  try{await action(abort.signal);}catch(failure){if(alive.current)setError(providerError(failure));}
  finally{lock.current=false;if(alive.current)setBusy('');}
 }
 async function apply(change:Record<string,unknown>,signal?:AbortSignal){
  const result=await piRequest<ModelServicesView>('provider-change',{revision:view.revision,change},signal);if(alive.current)onApply(result,change.kind==='save-connection'?String(change.provider):undefined);return result;
 }
 function saveConnection(){
  if(!supported)return;
  if(!form.baseUrl.trim()){setError('请填写服务地址。');return;}
  if(!form.apiKey&&!entry.connection?.keySet&&form.authMode!=='none'){setError('请填写此供应商的访问密钥。');return;}
  void run('save',async signal=>{
   const result=await apply({kind:'save-connection',...form},signal);if(!alive.current)return;
   const connection=result.connections.find(item=>item.provider===form.provider);if(!connection)throw new Error('No saved connection');
   const next=connectionForm({...entry,connection});setForm(next);setBaseline(JSON.stringify(next));setFeedback({success:true,message:'配置已保存。请点击测试连接，验证所选模型是否可用。'});
  });
 }
 function testConnection(){
  if(!saved||dirty||!chosenTest)return;
  void run('test',async signal=>{const result=await piRequest<{view:ModelServicesView;success:boolean;message:string}>('provider-test',{request:{provider:entry.id,revision:view.revision,modelId:chosenTest}},signal);if(alive.current){onApply(result.view);setFeedback({success:result.success,message:result.message});}});
 }
 function fetchModels(){
  if(!saved||dirty)return;
  void run('discover',async signal=>{const result=await piRequest<{view:ModelServicesView;added:number;removed:number;total:number}>('provider-discover',{request:{provider:entry.id,revision:view.revision}},signal);if(alive.current){onApply(result.view);setFeedback({success:true,message:`已完整拉取${result.total}个模型，新增${result.added}个，移除${result.removed}个过期发现项。预置、自定义和已隐藏项保持各自设置。`});}});
 }
 async function saveModel(model:ServiceModel){
  await run('model',async signal=>{await apply({kind:'upsert-model',provider:entry.id,model},signal);if(alive.current){setEditing(null);setFeedback({success:true,message:'模型已保存；参数修改不等于通过调用验证。'});}});
 }
 async function confirm(){
  if(!confirmation)return;await run('confirm',async signal=>{await apply({provider:entry.id,...confirmation},signal);if(alive.current)setConfirmation(null);});
 }
 const protocolOptions=[{value:'openai-completions',label:'聊天补全兼容接口'},{value:'openai-responses',label:'响应式兼容接口'},{value:'anthropic-messages',label:'消息式兼容接口'}];
 const filtered=models.filter(model=>(model.label+' '+model.modelId).toLowerCase().includes(search.toLowerCase()));
 return <div className={styles.panel} data-testid="provider-detail">
  <div className={styles.providerHeader}><div className={styles.hero}><ProviderIcon preset={entry.preset}/><div><div className={styles.heroTitle}>{entry.name}</div><div className={styles.heroHint}>{entry.connection?modelState(entry.connection):supported?'未配置，填写访问凭据后即可使用':'目录已预置，执行适配未开放'}</div></div></div>
   {saved&&<Tooltip label="移除服务商"><ActionIcon variant="subtle" color="gray" aria-label="移除服务商" disabled={!!busy} onClick={()=>setConfirmation({kind:'remove-connection'})}><IconTrash size={16}/></ActionIcon></Tooltip>}
  </div>
  {!supported&&<div className={styles.pending}>{entry.preset?.unavailableReason}</div>}
  {supported&&<fieldset className={styles.fieldset} disabled={!!busy}>
   {!!entry.preset?.links.length&&<div className={styles.links}><span>获取访问密钥</span>{entry.preset.links.map(link=><a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">{link.label}<IconExternalLink size={11}/></a>)}</div>}
   <div className={`${styles.connection} ${styles.fields}`}>
    {custom&&!saved&&<Group grow><TextInput label="服务商标识" value={form.provider} onChange={event=>change('provider',event.currentTarget.value)} description="小写字母开头，可包含数字和短横线"/><TextInput label="显示名称" value={form.name} onChange={event=>change('name',event.currentTarget.value)}/></Group>}
    {form.authMode!=='none'?<div className={styles.keyRow}><PasswordInput label="访问密钥" value={form.apiKey} onChange={event=>change('apiKey',event.currentTarget.value)} placeholder={entry.connection?.keySet?'已保存，留空保留原密钥':'填写对应供应商的密钥'} autoComplete="new-password" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();saveConnection();}}}/><Button size="sm" variant="default" leftSection={<IconBolt size={14}/>} disabled={!saved||dirty||!chosenTest} loading={busy==='test'} onClick={testConnection}>测试连接</Button></div>:<Group justify="space-between"><Text size="sm">本地服务无需密钥</Text><Button size="sm" variant="default" leftSection={<IconBolt size={14}/>} disabled={!saved||dirty||!chosenTest} loading={busy==='test'} onClick={testConnection}>测试连接</Button></Group>}
    <div><TextInput label="服务地址" value={form.baseUrl} onChange={event=>change('baseUrl',event.currentTarget.value)} placeholder={entry.preset?.baseUrlPlaceholder||'https://你的服务地址/v1'} autoComplete="off" spellCheck={false}/>
     {!!entry.preset?.alternateBaseUrls.length&&<div className={styles.regions}>{entry.preset.alternateBaseUrls.map(region=><button key={region.url} type="button" className={styles.region} aria-pressed={form.baseUrl.replace(/\/$/,'')===region.url.replace(/\/$/,'')} onClick={()=>change('baseUrl',region.url)}>{region.label}</button>)}</div>}
     <div className={styles.endpoint}>请求地址：{requestAddress(form)||'保存服务地址后显示'}</div>
    </div>
    {entry.preset?.setupHint&&<Text size="xs" c="dimmed">{entry.preset.setupHint}</Text>}
    <Group justify="space-between"><Button size="compact-xs" variant="subtle" onClick={()=>setAdvanced(value=>!value)}>高级连接选项</Button><Button size="xs" loading={busy==='save'} disabled={saved&&!dirty} onClick={saveConnection}>{saved?'保存连接':'保存配置'}</Button></Group>
    {(advanced||custom)&&<Stack gap="xs"><Select label="接口协议" value={form.api} data={protocolOptions} onChange={value=>{if(value){change('api',value);change('authMode',value==='anthropic-messages'?'anthropic-key':'bearer');}}}/>
      {form.api!=='anthropic-messages'&&<Select label="认证方式" value={form.authMode} data={[{value:'bearer',label:'访问密钥认证'},{value:'azure-api-key',label:'微软云密钥认证'},{value:'none',label:'无密钥（自托管服务）'}]} onChange={value=>{if(value){change('authMode',value);if(value==='none')change('clearKey',true);}}/>}
      <Text size="xs" c="dimmed">供应商预置了协议和地址，正常使用无需修改。切换保存过的服务地址时需重新输入密钥。</Text>
    </Stack>}
    {saved&&models.length>1&&<Select label="用于测试的模型" value={chosenTest} onChange={value=>value&&setSelectedTest(value)} data={models.map(model=>({value:model.modelId,label:model.label+'（模型）'}))} searchable/>}
    <Text size="xs" c="dimmed">测试连接只发送少量固定文字，供应商可计费；不读取你的文档。保存成功与验证通过分别显示。</Text>
   </div>
  </fieldset>}
  {error&&<Alert title="操作未完成" color="red" mb="sm">{error}</Alert>}
  {feedback&&<div role="status" className={styles.feedback} data-result={feedback.success?'success':'error'}>{feedback.message}</div>}
  {!feedback&&entry.connection?.status.checkedAt&&<div className={styles.feedback} data-result={entry.connection.status.state==='passed'?'success':'error'}>{entry.connection.status.message}<div className={styles.subtext}>核查时间：{new Date(entry.connection.status.checkedAt).toLocaleString()}</div></div>}
  <div className={styles.sectionHeading}><Text fw={600} size="sm">模型 <Text span size="xs" c="dimmed">{models.length}</Text></Text><Group gap={6}>
   {supported&&(entry.preset?.supportsModelDiscovery!==false)&&<Button size="compact-xs" variant="default" leftSection={<IconDownload size={13}/>} disabled={!saved||dirty||!!busy} loading={busy==='discover'} onClick={fetchModels}>拉取模型</Button>}
   {supported&&<Button size="compact-xs" variant="default" leftSection={<IconPlus size={13}/>} disabled={!saved||dirty||!!busy} onClick={()=>setEditing({model:null})}>新建模型</Button>}
  </Group></div>
  {models.length>8&&<TextInput aria-label="搜索模型" placeholder="搜索模型" value={search} onChange={event=>setSearch(event.currentTarget.value)} size="xs" mb="sm"/>}
  <div className={styles.models} role="region" aria-label="服务商模型列表">{filtered.map(model=><div className={styles.model} key={model.modelId}><div style={{minWidth:0}}><div className={styles.modelTitle}>{model.label}<Text span size="xs" c="dimmed">（模型）</Text></div>{model.label!==model.modelId&&<div className={styles.modelId}>{model.modelId}</div>}<div className={styles.capabilities}>
   {model.input.includes('image')&&<span title="图片输入"><IconSparkles size={12}/></span>}{model.capabilities?.tools&&<span title="工具调用"><IconTool size={12}/></span>}{model.capabilities?.streaming&&<span title="流式输出"><IconBolt size={12}/></span>}{model.reasoning&&<span title="推理模型">推理</span>}
   <span title="上下文容量"><IconFileText size={11}/>{countLabel(model.contextWindow)}</span><span title="输出上限"><IconArrowUp size={11}/>{countLabel(model.maxTokens)}</span><span>{model.origin==='manual'?'自定义':model.origin==='discovered'?'接口发现':'目录预置'}</span>
  </div></div>{supported&&<div className={styles.modelActions}><ActionIcon aria-label={`编辑模型 ${model.modelId}`} variant="default" size="sm" disabled={!saved||dirty||!!busy} onClick={()=>setEditing({model})}><IconSettings2 size={14}/></ActionIcon><ActionIcon aria-label={`移除模型 ${model.modelId}`} variant="default" color="red" size="sm" disabled={!saved||dirty||!!busy} onClick={()=>setConfirmation({kind:'hide-model',modelId:model.modelId})}><IconTrash size={14}/></ActionIcon></div>}</div>)}</div>
  {!models.length&&<Text size="sm" c="dimmed" py="md">{supported?'此服务尚未指定模型。保存连接后拉取实际列表，或添加供应商提供的模型编号。':'此服务没有语言模型目录，按对应分类接入后使用。'}</Text>}
  {saved&&!!entry.connection?.hidden.length&&<Group justify="space-between" mt="sm"><Text size="xs" c="dimmed">已隐藏{entry.connection.hidden.length}个模型，不会因拉取目录自动恢复。</Text>{entry.preset&&<Button size="compact-xs" variant="subtle" disabled={!!busy||dirty} leftSection={<IconRefresh size={12}/>} onClick={()=>setConfirmation({kind:'restore-catalog'})}>恢复预置目录</Button>}</Group>}
  <div className={styles.subtext}>目录依据参考项目的固定版本预置，不等于当前账户已获全部模型权限。请使用测试连接与供应商实际返回的列表核对；手工修改和已隐藏项目不会被自动覆盖。</div>
  <PiServiceModelEditor opened={!!editing} model={editing?.model||null} busy={!!busy} existingIds={models.map(model=>model.modelId)} onClose={()=>setEditing(null)} onSave={saveModel}/>
  <Modal opened={!!confirmation} onClose={()=>{if(!busy)setConfirmation(null);}} title={confirmation?.kind==='remove-connection'?'移除这个服务商？':confirmation?.kind==='restore-catalog'?'恢复预置模型？':'移除这个模型？'} size="sm" centered closeOnClickOutside={false} closeOnEscape={!busy} closeButtonProps={{disabled:!!busy}}><Text size="sm">{confirmation?.kind==='remove-connection'?'将移除这组模型连接及已保存密钥，不删除文档、技能或历史会话。':confirmation?.kind==='restore-catalog'?'恢复被隐藏的预置模型，保留已有自定义模型和已修改的参数。':'从当前可选列表移除，并记住这个选择；后续拉取不会擅自恢复。'}</Text><Group mt="md" justify="flex-end"><Button variant="default" disabled={!!busy} onClick={()=>setConfirmation(null)}>取消</Button><Button color={confirmation?.kind==='restore-catalog'?undefined:'red'} loading={busy==='confirm'} onClick={()=>void confirm()}>确认</Button></Group></Modal>
 </div>;
}
