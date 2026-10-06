import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Button, Drawer, Group, Loader, Menu, Modal, Popover, Select, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconArrowUp, IconPlus, IconSquare, IconSparkles, IconPaperclip, IconRefresh, IconX, IconSettings2, IconRoute, IconChecklist, IconBook2, IconFileText } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router-dom';
import { currentUserAtom } from '@/features/user/atoms/current-user-atom';
import { asideStateAtom } from '@/components/layouts/global/hooks/atoms/sidebar-atom';
import { usePageQuery } from '@/features/page/queries/page-query';
import { extractPageSlugId } from '@/lib';
import api from '@/lib/api-client';
import { importPage } from '@/features/page/services/page-service';
import { PiConversation, PiModel, PiView, piError, piRequest, selectedConversationKey } from './pi-workbench-api';
import { PiTranscript } from './pi-workbench-messages';
import PiWorkbenchQuestion from './pi-workbench-question';
import PiModelSettings from './pi-model-settings';
import PiWorkbenchActions from './pi-workbench-actions';
import brand from './pi-brand.module.css';
import classes from './pi-workbench.module.css';

type Candidate={id:string;title:string};
type ImageInput={type:'image';mimeType:string;data:string};
type SopGenerationResult={state:'pending'|'succeeded'|'failed';url?:string;revision?:number;template?:{id:string;version:string};reused?:boolean;message?:string};
type SopHistoryItem={jobId:string;revision:number;versionId:string;template?:{id:string;version:string}|null;current:boolean;completedAt?:string|null;url:string};
const labels:Record<string,string>={get_state:'运行状态',get_messages:'完整消息',get_entries:'历史条目',get_tree:'树形历史',get_session_stats:'用量统计',get_commands:'技能与扩展命令',get_available_models:'可用模型',get_available_thinking_levels:'思考强度',get_fork_messages:'分支起点',get_last_assistant_text:'最后一次回复',abort:'停止本轮',clear_queue:'清空追加队列',new_session:'新建原生会话',clone:'克隆当前分支',cycle_model:'切换下个模型',cycle_thinking_level:'切换思考强度',set_model:'选择模型',set_thinking_level:'设置思考强度',set_steering_mode:'纠正队列模式',set_follow_up_mode:'后续队列模式',compact:'整理长对话上下文',set_auto_compaction:'自动压缩设置',set_auto_retry:'自动重试设置',abort_retry:'停止重试',bash:'隔离终端命令',abort_bash:'停止终端命令',export_html:'导出对话网页',switch_session:'恢复原生会话',fork:'从历史节点分支',set_session_name:'重命名会话',prompt:'发送消息',steer:'执行中纠正',follow_up:'追加后续任务'};

export default function PiWorkbenchSidebar(){
  const {pageSlug}=useParams();const {data:page}=usePageQuery({pageId:extractPageSlugId(pageSlug)});
  const current=useAtomValue(currentUserAtom);
  return current?.user?.id && page?.id ? <PiWorkbenchPanel key={`${current.user.workspaceId}:${current.user.id}`} userId={current.user.id} workspaceId={current.user.workspaceId || current.workspace?.id || ''} pageId={page.id} spaceId={page.spaceId} title={page.title || '未命名文档'}/> : null;
}
export function PiWorkbenchPanel({userId,workspaceId,pageId,spaceId,title}:{userId:string;workspaceId:string;pageId:string;spaceId:string;title:string}){
  const aside=useAtomValue(asideStateAtom),opened=aside.isAsideOpen&&aside.tab==='pi',client=useQueryClient();
  const storageKey=selectedConversationKey(workspaceId,userId);
  const [sessionId,setSessionId]=useState(()=>{try{return localStorage.getItem(storageKey)||'';}catch{return '';}});
  const [text,setText]=useState(''),[error,setError]=useState(''),[posting,setPosting]=useState(false),[sourcePicker,setSourcePicker]=useState(false);
  const [query,setQuery]=useState(''),[debounced]=useDebouncedValue(query,300),[selected,setSelected]=useState<Candidate[]>([{id:pageId,title}]);
  const [mode,setMode]=useState('followUp'),[image,setImage]=useState<ImageInput|null>(null),[advanced,setAdvanced]=useState(false),[modelSettings,setModelSettings]=useState(false),[pendingModel,setPendingModel]=useState('');
  const [operation,setOperation]=useState('get_state'),[parameters,setParameters]=useState('{}'),[inspection,setInspection]=useState<unknown>(null);
  const [files,setFiles]=useState<{name:string;bytes:number}[]>([]),[unknown,setUnknown]=useState(false),[sopResults,setSopResults]=useState<Record<string,SopGenerationResult>>({}),[localImporting,setLocalImporting]=useState(false),[historyOpen,setHistoryOpen]=useState(false);
  const transcript=useRef<HTMLDivElement>(null),followBottom=useRef(true),fileInput=useRef<HTMLInputElement>(null),localFileInput=useRef<HTMLInputElement>(null),epoch=useRef(0),sopProcessing=useRef(new Set<string>());
  const openGate=useRef({opened,epoch:0});
  if(openGate.current.opened!==opened)openGate.current={opened,epoch:openGate.current.epoch+(opened?1:0)};
  const status=useQuery({queryKey:['pi-workbench-status',workspaceId,userId,pageId,openGate.current.epoch],enabled:opened,retry:false,gcTime:0,queryFn:({signal})=>piRequest<{enabled:boolean;models?:PiModel[];configuredModels?:PiModel[];canManageModels?:boolean}>('status',{pageId},signal)});
  const sessions=useQuery({queryKey:['pi-workbench-list',workspaceId,userId,openGate.current.epoch],enabled:opened&&!!status.data?.enabled,retry:false,gcTime:0,refetchInterval:opened?10000:false,queryFn:({signal})=>piRequest<{items:PiConversation[]}>('list',{},signal)});
  const view=useQuery({queryKey:['pi-workbench-view',workspaceId,userId,sessionId,openGate.current.epoch],enabled:opened&&!!sessionId&&!!status.data?.enabled,retry:false,gcTime:0,refetchInterval:opened?1000:false,queryFn:({signal})=>piRequest<PiView>('view',{sessionId,after:0},signal)});
  const handbookHistory=useQuery({queryKey:['sop-handbook-history',userId,pageId,openGate.current.epoch],enabled:opened,retry:false,gcTime:0,refetchInterval:opened?10000:false,queryFn:async({signal})=>(await api.post<{enabled:boolean;items:SopHistoryItem[]}>('/pages/handbook/history',{pageId},{signal})).data});
  const recent=useQuery({queryKey:['pi-workbench-recent',workspaceId,userId,openGate.current.epoch],enabled:opened&&sourcePicker,retry:false,gcTime:0,queryFn:async({signal})=>(await api.post<{items:Candidate[]}>('/pages/recent',{limit:12},{signal})).data.items});
  const search=useQuery({queryKey:['pi-workbench-search',workspaceId,userId,debounced,openGate.current.epoch],enabled:opened&&sourcePicker&&debounced.trim().length>=1,retry:false,gcTime:0,queryFn:async({signal})=>(await api.post<{items:Candidate[]}>('/search',{query:debounced,titleOnly:true,limit:12},{signal})).data.items});
  const accessFailed=view.isError||status.isError||sessions.isError;
  const data=opened&&!accessFailed?view.data:undefined,busy=!!data?.busy||!!data?.state.isStreaming||!!data?.state.isCompacting;
  const ready=status.data?.enabled&&!status.isError;
  const statusModels=status.data?.models||[],availableModels=data?.models?.length?data.models:statusModels;
  const configured=availableModels.length>0,hasSavedModels=!!status.data?.configuredModels?.length;
  const modelKey=(model:PiModel)=>`${model.provider}/${model.id}`;
  const currentModel=data?.state.model?modelKey(data.state.model):'';
  const pendingAvailable=pendingModel&&availableModels.some(model=>modelKey(model)===pendingModel);
  const selectedModel=currentModel||(pendingAvailable?pendingModel:(availableModels[0]?modelKey(availableModels[0]):''));
  const desiredModel=availableModels.find(model=>modelKey(model)===selectedModel);
  useEffect(()=>{if(followBottom.current&&transcript.current)transcript.current.scrollTop=transcript.current.scrollHeight;},[data?.messages,data?.partial,data?.dialogs]);
  useEffect(()=>{
    if(!sessionId||!data?.messages?.length)return;
    const returned=new Map<string,boolean>();
    for(const message of data.messages)if(message.role==='toolResult'&&typeof message.toolCallId==='string')returned.set(message.toolCallId,message.isError!==true);
    for(const message of data.messages){
      if(message.role!=='assistant'||!Array.isArray(message.content))continue;
      for(const part of message.content){
        if(part?.type!=='toolCall'||part.name!=='generate_sop'||typeof part.id!=='string'||returned.get(part.id)!==true||sopProcessing.current.has(part.id))continue;
        const toolCallId=part.id;sopProcessing.current.add(toolCallId);setSopResults(current=>({...current,[toolCallId]:{state:'pending'}}));
        void api.post<{state:string;url?:string;revision?:number;template?:{id:string;version:string};reused?:boolean}>('/pages/handbook/agent-generate',{sessionId,toolCallId},{timeout:120000}).then(response=>{
          setSopResults(current=>({...current,[toolCallId]:{state:'succeeded',url:response.data.url,revision:response.data.revision,template:response.data.template,reused:response.data.reused}}));
          void client.invalidateQueries({queryKey:['sop-handbook',userId,pageId]});void client.invalidateQueries({queryKey:['sop-handbook-history',userId,pageId]});
        }).catch(failure=>{
          const code=(failure as {response?:{data?:{message?:string}}})?.response?.data?.message;
          const message=code==='LAYOUT_SOURCE_CHANGED'?'原稿已经有新版本，请重新发送一次生成要求。':'SOP 生成没有完成，请检查模型和文档权限后重试。';
          setSopResults(current=>({...current,[toolCallId]:{state:'failed',message}}));
        });
      }
    }
  },[sessionId,data?.messages,client,userId,pageId]);
  useEffect(()=>()=>{epoch.current++;},[]);
  useEffect(()=>{
    if(!accessFailed)return;
    epoch.current++;setPosting(false);setInspection(null);setFiles([]);setImage(null);setUnknown(true);
  },[accessFailed]);
  function resetDraft(items:Candidate[]=[{id:pageId,title}]){epoch.current++;setPosting(false);setSessionId('');setPendingModel(selectedModel);setSelected(items);setText('');setImage(null);setError('');setUnknown(false);setInspection(null);setFiles([]);setSopResults({});try{localStorage.removeItem(storageKey);}catch{}}
  function choose(id:string){epoch.current++;setPosting(false);setSessionId(id);setPendingModel('');setText('');setImage(null);setError('');setUnknown(false);setInspection(null);setFiles([]);try{localStorage.setItem(storageKey,id);}catch{}}
  async function createConversation(pageIds=selected.map(item=>item.id)){
    const result=await piRequest<PiConversation>('create',{sessionId:crypto.randomUUID(),pageIds});
    await client.invalidateQueries({queryKey:['pi-workbench-list',workspaceId,userId]});return result.id;
  }
  async function startNew(){if(posting||!ready)return;resetDraft([{id:pageId,title}]);}
  async function command(type:string,fields:Record<string,unknown>={},target=sessionId){
    if(!target)throw new Error('No conversation selected');
    const response=await piRequest<{success:boolean;data?:unknown;error?:string}>('command',{sessionId:target,command:{...fields,type,id:crypto.randomUUID()}});
    if(!response.success)throw new Error('Native command refused');
    await client.invalidateQueries({queryKey:['pi-workbench-view',workspaceId,userId,target]});return response.data;
  }
  async function act(type:string,fields:Record<string,unknown>={}){
    if(posting || !sessionId || accessFailed)return;
    const generation=epoch.current,target=sessionId;setPosting(true);setError('');
    try{const result=await command(type,fields,target);if(epoch.current===generation)setInspection(result??'操作已由原生执行器确认');}
    catch(failure){if(epoch.current===generation){setError(piError(failure));setUnknown(true);}}
    finally{if(epoch.current===generation)setPosting(false);}
  }
  async function sendMessage(message:string,attachment:ImageInput|null=null,clearComposer=false){
    const value=message.trim();if(!value||posting||unknown||!ready||accessFailed||(!configured&&!value.startsWith('/')))return;
    const generation=epoch.current;let target=sessionId;setPosting(true);setError('');
    try{
      if(!target){
        target=await createConversation();if(epoch.current!==generation)return;setSessionId(target);try{localStorage.setItem(storageKey,target);}catch{}
        if(desiredModel){await command('set_model',{provider:desiredModel.provider,modelId:desiredModel.id},target);if(epoch.current!==generation)return;setPendingModel('');}
      }
      await command('prompt',{message:value,...(attachment?{images:[attachment]}:{}),...(busy?{streamingBehavior:mode}:{})},target);
      if(epoch.current===generation){if(clearComposer)setText(current=>current===message?'':current);if(attachment)setImage(current=>current===attachment?null:current);followBottom.current=true;}
    }catch(failure){if(epoch.current===generation){setError(piError(failure));setUnknown(true);}}
    finally{if(epoch.current===generation)setPosting(false);}
  }
  async function send(){await sendMessage(text,image,true);}
  async function addSource(item:Candidate){
    const generation=epoch.current,target=sessionId;setError('');
    try{
      if(target){await piRequest('attach',{sessionId:target,pageIds:[item.id]});await client.invalidateQueries({queryKey:['pi-workbench-view',workspaceId,userId,target]});}
      else if(epoch.current===generation)setSelected(items=>items.some(value=>value.id===item.id)?items:[...items,item].slice(0,10));
      if(epoch.current===generation){setQuery('');setSourcePicker(false);}
    }catch(failure){if(epoch.current===generation)setError(piError(failure));}
  }
  function removeSource(page:string){
    const basis=sessionId?(data?.meta.sources||[]).map(source=>({id:source.pageId,title:source.title})):selected;
    const next=basis.filter(item=>item.id!==page);
    if(sessionId)resetDraft(next);else setSelected(next);
  }
  async function importLocalFile(file?:File){
    if(!file)return;if(file.size>30*1024*1024){setError('本机文档不能超过 30 MB。');return;}
    if(!/\.(md|html|docx|pdf)$/i.test(file.name)){setError('当前支持 Markdown、HTML、DOCX 和 PDF 文档。');return;}
    setLocalImporting(true);setError('');
    try{const imported=await importPage(file,spaceId);await addSource({id:imported.id,title:imported.title||file.name});void recent.refetch();}
    catch{setError('本机文档导入失败，请检查文件格式和当前空间权限。');}
    finally{setLocalImporting(false);if(localFileInput.current)localFileInput.current.value='';}
  }
  async function respond(response:object){
    const generation=epoch.current,target=sessionId;
    try{await piRequest('respond',{sessionId:target,response});await client.invalidateQueries({queryKey:['pi-workbench-view',workspaceId,userId,target]});}
    catch(failure){if(epoch.current===generation)setError(piError(failure));}
  }
  async function loadImage(file?:File){
    if(!file)return;if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>3*1024*1024){setError('请使用不超过三兆字节的常见图片。');return;}
    const generation=epoch.current,reader=new FileReader();
    reader.onload=()=>{if(epoch.current===generation)setImage({type:'image',mimeType:file.type,data:String(reader.result).split(',')[1]});};
    reader.onerror=()=>{if(epoch.current===generation)setError('图片读取失败。');};reader.readAsDataURL(file);
  }
  async function loadFiles(){
    const generation=epoch.current,target=sessionId;
    try{const result=await piRequest<{name:string;bytes:number}[]>('artifacts',{sessionId:target});if(epoch.current===generation)setFiles(result);}
    catch(failure){if(epoch.current===generation)setError(piError(failure));}
  }
  async function download(name:string){
    const generation=epoch.current,target=sessionId;
    try{
      const result=await piRequest<{name:string;data:string}>('artifact',{sessionId:target,name});if(epoch.current!==generation)return;
      const bytes=Uint8Array.from(atob(result.data),char=>char.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const link=document.createElement('a');link.href=url;link.download=result.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(failure){if(epoch.current===generation)setError(piError(failure));}
  }
  async function refresh(){
    const generation=epoch.current;
    const results=await Promise.all([status.refetch(),sessions.refetch(),...(sessionId?[view.refetch()]:[])]);
    if(epoch.current===generation&&results.every(result=>!result.isError)){setUnknown(false);setError('');}
  }
  const sourceItems=sessionId?(data?.meta.sources||[]):selected.map(item=>({pageId:item.id,title:item.title,versionId:'',key:item.id,revision:undefined}));
  const sourceIds=new Set(sourceItems.map(item=>item.pageId));
  const pickerItems=((debounced.trim()?search.data:recent.data)||[]).filter(item=>!sourceIds.has(item.id)).slice(0,12);
  const historyItems=[...(handbookHistory.data?.items||[])].sort((a,b)=>Number(b.current)-Number(a.current)||new Date(b.completedAt||0).getTime()-new Date(a.completedAt||0).getTime()),historyPreview=historyItems.slice(0,3);
  const formatHistoryTime=(value?:string|null)=>value?new Date(value).toLocaleString(undefined,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
  const historyLabel=(item:SopHistoryItem)=>item.current?'当前版本':item.template?.id==='chapter-reader'?'章节工作本':'历史版本';
  return <div className={classes.root} data-testid="pi-workbench-panel">
    <PiModelSettings opened={modelSettings} onClose={()=>setModelSettings(false)} onSaved={()=>{void client.invalidateQueries({queryKey:['pi-workbench-status',workspaceId,userId]});void client.invalidateQueries({queryKey:['pi-workbench-view',workspaceId,userId]});}}/>
    <div className={classes.toolbar}>
      <Select className={classes.sessionSelect} aria-label="选择对话" placeholder="新对话" size="xs" style={{flex:1,minWidth:0}} value={sessionId||null} data={(sessions.isError?[]:sessions.data?.items||[]).map(item=>({value:item.id,label:item.title||'新对话'}))} onChange={value=>value&&choose(value)} searchable nothingFoundMessage="暂无对话" disabled={posting}/>
      <Tooltip label="新对话"><ActionIcon variant="subtle" color="gray" aria-label="新对话" disabled={posting||!ready} onClick={()=>void startNew()}><IconPlus size={17}/></ActionIcon></Tooltip>
      <Tooltip label="刷新会话"><ActionIcon variant="subtle" color="gray" aria-label="刷新会话" onClick={()=>void refresh()}><IconRefresh size={16}/></ActionIcon></Tooltip>
      <PiWorkbenchActions canManageModels={!!status.data?.canManageModels&&!status.isError} sessionAvailable={!!sessionId&&!accessFailed&&!!data} busy={busy} posting={posting} onModels={()=>setModelSettings(true)} onCommand={type=>void act(type)} onFiles={()=>void loadFiles()} onAdvanced={()=>setAdvanced(true)}/>
    </div>
    <div className={classes.handbookShelf} data-testid="sop-history-shelf"><div className={classes.handbookShelfHeader}><span><IconBook2 size={14}/>已生成 SOP</span>{historyItems.length>0&&<span className={classes.handbookShelfCount}>{historyItems.length} 个历史结果</span>}</div>{historyPreview.length?<div className={classes.handbookCards}>{historyPreview.map(item=><a key={item.jobId} className={classes.handbookCard} data-current={item.current?'true':undefined} href={item.url} target="_blank" rel="noopener noreferrer"><div><strong>第 {item.revision} 版</strong><span>{historyLabel(item)}</span></div><small>{formatHistoryTime(item.completedAt)}</small></a>)}</div>:<div className={classes.handbookEmpty}>还没有生成 SOP，可直接使用下方快捷指令。</div>}{historyItems.length>3&&<Button className={classes.handbookMore} variant="subtle" color="gray" size="compact-xs" onClick={()=>setHistoryOpen(true)}>查看更多版本（{historyItems.length}）</Button>}</div>
    <Drawer opened={historyOpen&&opened} onClose={()=>setHistoryOpen(false)} title="SOP 历史版本" position="right" size="sm" closeButtonProps={{"aria-label":"关闭 SOP 历史版本"}} overlayProps={{backgroundOpacity:.18}}><div className={classes.handbookDrawer}><div className={classes.handbookDrawerSummary}>{historyItems.length} 个已生成版本</div><div className={classes.handbookDrawerList}>{historyItems.map(item=><a key={item.jobId} className={classes.handbookDrawerCard} data-current={item.current?'true':undefined} href={item.url} target="_blank" rel="noopener noreferrer"><div><strong>第 {item.revision} 版</strong><span>{historyLabel(item)}</span></div><small>{formatHistoryTime(item.completedAt)}</small></a>)}</div></div></Drawer>
    <Modal opened={advanced&&opened} onClose={()=>setAdvanced(false)} title="高级工具" size="md" centered closeOnClickOutside={false} closeButtonProps={{"aria-label":"关闭高级工具"}}><Text data-autofocus tabIndex={-1} size="xs" c="dimmed" mb="md">完整原生控制，仅在需要时使用；不会替代日常对话。</Text><Stack gap="xs">
      <Select label="原生能力" size="xs" value={operation} onChange={value=>value&&setOperation(value)} data={(data?.protocolCommands||Object.keys(labels)).map(value=>({value,label:labels[value]||`${value}（原生操作）`}))} searchable/>
      <Textarea label="操作参数" description="高级控制使用原生参数对象；普通聊天不需要填写。" value={parameters} onChange={event=>setParameters(event.currentTarget.value)} autosize minRows={2} maxRows={5} size="xs"/>
      <Button size="xs" variant="default" disabled={!sessionId||posting||accessFailed} onClick={()=>{try{const fields=JSON.parse(parameters);if(!fields||typeof fields!=='object'||Array.isArray(fields))throw new Error();void act(operation,fields);}catch{setError('操作参数必须是对象。');}}}>执行选定操作</Button>
      {data?.sessions?.length>0&&<Select label="恢复原生历史会话" size="xs" data={data.sessions.map(item=>({value:item.path,label:item.name}))} value={data.state.sessionFile||null} onChange={value=>value&&void act('switch_session',{sessionPath:value})}/>}
    </Stack></Modal>
    <div className={classes.transcript} ref={transcript} onScroll={()=>{const node=transcript.current;if(node)followBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<60;}} aria-live="polite" aria-label="智能体对话记录">
      {!data?.messages?.length&&<div className={classes.empty}><div className={classes.emptyIcon}><IconSparkles size={22}/></div><div className={classes.emptyTitle}>从这份资料开始</div><div className={classes.emptyDescription}>直接告诉智能体你要完成的事，也可以使用底部快捷指令。</div></div>}
      {accessFailed?<div className={classes.error}>{piError(view.error||status.error||sessions.error)}</div>:data&&<PiTranscript messages={data.messages} partial={data.partial} sopResults={sopResults}/>}
      {data?.dialogs?.map(request=><PiWorkbenchQuestion key={String(request.id)} request={request} onRespond={respond}/>)}
      {data?.notices?.filter(item=>['notify','setStatus','setWidget'].includes(String(item.method))).map((item,index)=><div key={index} className={classes.notice}>{String(item.message||item.statusText||(Array.isArray(item.widgetLines)?item.widgetLines.join('\n'):''))}</div>)}
      {data?.notices?.filter(item=>item.method==='set_editor_text'&&typeof item.text==='string').map(item=><Button key={String(item.id)} size="compact-xs" variant="subtle" onClick={()=>{if(!text||window.confirm('用扩展返回的草稿替换当前输入内容？'))setText(String(item.text));}}>将扩展返回的草稿填入输入框</Button>)}
      {!!data&&!!inspection&&<details className={classes.tool}><summary>原生操作返回结果</summary><pre className={classes.payload}>{typeof inspection==='string'?inspection:JSON.stringify(inspection,null,2)}</pre></details>}
      {!!data&&files.map(file=><Button key={file.name} variant="subtle" size="compact-xs" onClick={()=>void download(file.name)}>{file.name}（生成文件）</Button>)}
    </div>
    <div className={classes.composerDock}>
    <div className={classes.quickPrompts}>{[{text:'把这篇文档生成标准 SOP 手册',Icon:IconBook2},{text:'梳理这篇文档的关键步骤',Icon:IconRoute},{text:'找出流程中的缺项与冲突',Icon:IconChecklist}].map(({text:value,Icon})=><button type="button" className={classes.quickPrompt} key={value} disabled={posting||unknown||!ready||accessFailed||!configured} onClick={()=>void sendMessage(value)}><Icon size={14}/><span>{value}</span></button>)}</div>
    <div className={classes.sourceRail}><div className={classes.sources}>{sourceItems.map((source,index)=><span className={classes.source} key={source.key||index}><IconFileText size={12}/><span className={classes.sourceText} title={source.title}>{source.title}{source.revision?` · 第${source.revision}版`:''}</span><ActionIcon size="xs" variant="subtle" aria-label={`移除${source.title}`} onClick={()=>removeSource(source.pageId)}><IconX size={10}/></ActionIcon></span>)}
      <Popover opened={sourcePicker} onChange={setSourcePicker} width={310} position="top-start" shadow="md"><Popover.Target><ActionIcon size="sm" variant="light" color="blue" aria-label="添加系统文档" title="添加系统文档" disabled={accessFailed||sourceItems.length>=10} onClick={()=>setSourcePicker(value=>!value)}><IconPlus size={14}/></ActionIcon></Popover.Target><Popover.Dropdown>
        <TextInput placeholder="搜索有权限的文档" size="xs" value={query} onChange={event=>setQuery(event.currentTarget.value)} mb={7}/>
        <Text size="xs" c="dimmed" mb={5}>{debounced.trim()?'搜索结果':'最近文档'}</Text>
        <div className={classes.sourcePickerList}>{!sourceIds.has(pageId)&&<button type="button" className={classes.sourcePickerItem} onClick={()=>void addSource({id:pageId,title})}><IconFileText size={13}/><span>{title}</span><small>当前文档</small></button>}{pickerItems.map(item=><button type="button" className={classes.sourcePickerItem} key={item.id} onClick={()=>void addSource(item)}><IconFileText size={13}/><span>{item.title||'未命名文档'}</span></button>)}{(debounced.trim()?search.isLoading:recent.isLoading)&&<Text size="xs" c="dimmed">正在加载…</Text>}{!(debounced.trim()?search.isLoading:recent.isLoading)&&pickerItems.length===0&&sourceIds.has(pageId)&&<Text size="xs" c="dimmed">没有更多可添加的文档。</Text>}</div>
      </Popover.Dropdown></Popover></div></div>
    {(busy||posting||localImporting)&&<div className={classes.status}><Loader size={11}/>{localImporting?'正在导入本机文档':posting?'正在提交操作':data?.state.isCompacting?'正在整理上下文':'智能体正在处理，可继续补充要求'}</div>}
    {error&&<div className={classes.error} role="alert">{error}</div>}
    <div className={classes.composer}>
      <Textarea aria-label="发送给智能体" placeholder={busy?'补充要求，或纠正正在执行的任务…':'询问、整理或修改文档…'} value={text} onChange={event=>setText(event.currentTarget.value)} autosize minRows={3} maxRows={8} maxLength={64000} classNames={{input:classes.composerInput}} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
      {image&&<Text size="xs" px="sm">已附加图片 <Button size="compact-xs" variant="subtle" onClick={()=>setImage(null)}>移除</Button></Text>}
      <div className={classes.composerBar}>
        <Tooltip label="从本机导入文档"><ActionIcon variant="subtle" color="gray" aria-label="从本机导入文档" disabled={accessFailed||localImporting} onClick={()=>localFileInput.current?.click()}><IconPlus size={16}/></ActionIcon></Tooltip>
        <input ref={localFileInput} hidden type="file" accept=".md,text/html,.docx,.pdf" onChange={event=>void importLocalFile(event.target.files?.[0])}/>
        <Tooltip label="添加图片"><ActionIcon variant="subtle" color="gray" aria-label="添加图片" disabled={accessFailed} onClick={()=>fileInput.current?.click()}><IconPaperclip size={16}/></ActionIcon></Tooltip>
        <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event=>void loadImage(event.target.files?.[0])}/>
        <Menu position="top-start"><Menu.Target><ActionIcon variant="subtle" color="gray" aria-label="选择技能与命令"><IconSparkles size={15}/></ActionIcon></Menu.Target><Menu.Dropdown>{data?.commands?.length?data.commands.map(item=><Menu.Item key={item.name} onClick={()=>setText(`/${item.name} ${text}`)}>{item.description||`${item.name}（${item.source==='skill'?'技能':'命令'}）`}</Menu.Item>):<Menu.Item disabled>会话启动后加载原生技能</Menu.Item>}</Menu.Dropdown></Menu>
        <div className={classes.model}>{!configured&&status.data?.canManageModels?<button type="button" className={classes.setupModel} onClick={()=>setModelSettings(true)}><IconSettings2 size={13}/>{hasSavedModels?'验证模型':'配置模型'}</button>:<Select aria-label="模型" placeholder="未配置模型" size="xs" value={selectedModel||null} data={availableModels.map(model=>({value:modelKey(model),label:model.name||model.label||model.id}))} disabled={posting||busy||accessFailed||!availableModels.length} onChange={value=>{if(!value)return;const model=availableModels.find(item=>modelKey(item)===value);if(!model)return;if(!sessionId){setPendingModel(value);return;}void act('set_model',{provider:model.provider,modelId:model.id});}}/>}</div>
        {busy?<ActionIcon variant="filled" color="gray" aria-label="停止当前运行" onClick={()=>void act('abort')}><IconSquare size={13}/></ActionIcon>:<ActionIcon variant="filled" className={brand.send} aria-label="发送消息" title={!configured&&!text.trim().startsWith("/")?"请先配置模型":"发送消息"} disabled={!text.trim()||posting||unknown||!ready||accessFailed||(!configured&&!text.trim().startsWith('/'))} onClick={()=>void send()}><IconArrowUp size={17}/></ActionIcon>}
      </div>
      {busy&&<Group px="xs" pb="xs" gap={6}><Select aria-label="运行中补充方式" size="xs" value={mode} onChange={value=>value&&setMode(value)} data={[{value:'steer',label:'纠正当前任务'},{value:'followUp',label:'排队追加任务'}]} style={{flex:1}}/><Button size="xs" disabled={!text.trim()||posting||unknown||accessFailed} onClick={()=>void send()}>追加</Button></Group>}
    </div>
    <div className={classes.hint}>{status.isError?'执行器连接失败。':!ready?status.isLoading?'正在检查执行器连接。':'执行器尚未配置。':!configured?(hasSavedModels?'模型连接已保存，但尚未通过实际调用验证。':'尚未配置实际模型；不会使用模拟回复冒充生成。'):'所选资料会交给当前模型处理。原稿不变，收起面板不会删除对话。'}</div>
    </div>
  </div>;
}
