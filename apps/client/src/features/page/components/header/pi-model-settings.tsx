import {useEffect,useRef,useState} from 'react';
import {ActionIcon,Alert,Button,Group,Loader,Modal,Text,TextInput,Tooltip} from '@mantine/core';
import {IconCube,IconFileText,IconPhoto,IconVideo,IconVolume,IconMicrophone,IconSearch,IconPlus,IconLock} from '@tabler/icons-react';
import {piRequest} from './pi-workbench-api';
import {modelState,providerError,serviceEntries} from './pi-model-services-types';
import type {ModelServicesView,ServiceCategory,ServiceEntry} from './pi-model-services-types';
import PiServiceProviderPanel,{ProviderIcon} from './pi-service-provider-panel';
import LegacyModelSettings from './pi-model-settings-legacy';
import styles from './pi-model-services.module.css';

const icons={chat:IconCube,image:IconPhoto,video:IconVideo,tts:IconVolume,asr:IconMicrophone,document:IconFileText,webSearch:IconSearch};
export default function PiModelSettings({opened,onClose,onSaved}:{opened:boolean;onClose:()=>void;onSaved:()=>void}){
 const [view,setView]=useState<ModelServicesView|null>(null),[category,setCategory]=useState<ServiceCategory>('chat'),[selected,setSelected]=useState<Partial<Record<ServiceCategory,string>>>({}),[search,setSearch]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[legacy,setLegacy]=useState(false),[panelEpoch,setPanelEpoch]=useState(0);
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[discard,setDiscard]=useState(false),[custom,setCustom]=useState<ServiceEntry|null>(null);
 const epoch=useRef(0),next=useRef<(()=>void)|null>(null),abort=useRef<AbortController|null>(null);
 async function load(){
  const generation=++epoch.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;setLoading(true);setError('');
  try{const result=await piRequest<ModelServicesView>('provider-settings',{},controller.signal);if(epoch.current!==generation)return;if(result?.schema!=='sop.model-services/1'||!Array.isArray(result.catalog?.categories))throw new Error('Invalid services response');setView(result);const preferred=result.connections.find(item=>item.category==='chat'&&item.status.state==='passed')||result.connections.find(item=>item.category==='chat'&&item.configured);if(preferred)setSelected({chat:preferred.provider});}
  catch(failure){if(epoch.current===generation){const status=(failure as {response?:{status?:number}})?.response?.status;if(status===404)setLegacy(true);else setError(providerError(failure));}}
  finally{if(epoch.current===generation)setLoading(false);}
 }
 useEffect(()=>{
  if(!opened)return;setView(null);setCategory('chat');setSelected({});setSearch('');setCustom(null);setDirty(false);setBusy(false);setLegacy(false);void load();
  return()=>{epoch.current++;abort.current?.abort();next.current=null;setDiscard(false);setBusy(false);setDirty(false);};
 },[opened]);
 function navigate(action:()=>void){if(busy||loading)return;if(dirty){next.current=action;setDiscard(true);}else action();}
 function apply(result:ModelServicesView,selectedProvider?:string){setView(result);if(selectedProvider){setSelected(current=>({...current,chat:selectedProvider}));setCustom(null);}onSaved();}
 function add(){const id='custom-'+crypto.randomUUID().slice(0,8);navigate(()=>{setCustom({id,preset:null,connection:null,name:'自定义模型服务'});setSelected(current=>({...current,chat:id}));setCategory('chat');setSearch('');});}
 const entries=view?serviceEntries(view,category):[];
 if(category==='chat'&&custom&&!entries.some(entry=>entry.id===custom.id))entries.push(custom);
 const entry=entries.find(item=>item.id===selected[category])||entries[0];
 const providerRank=(item:ServiceEntry)=>item.connection?.status.state==='passed'?0:item.connection?.configured?1:2;
 const filtered=entries.filter(item=>(item.name+' '+item.id).toLowerCase().includes(search.toLowerCase())).sort((a,b)=>providerRank(a)-providerRank(b));
 const configuredCount=view?.connections.filter(item=>item.configured).length||0;
 if(legacy)return <LegacyModelSettings opened={opened} onClose={onClose} onSaved={onSaved}/>;
 return <>
  <Modal opened={opened} onClose={()=>navigate(onClose)} title={<div><Text fw={650} size="md">模型服务</Text><Text size="xs" c="dimmed" mt={3}>{view?'已接入 '+configuredCount+' 个服务 · 选择供应商管理连接和模型':'选择供应商，管理访问凭据、接口地址与模型目录'}</Text></div>} size="min(1120px, calc(100vw - 24px))" centered padding={0} radius={14} classNames={{content:styles.modal,header:styles.header,body:styles.body}} closeOnClickOutside={false} closeOnEscape={!busy&&!discard} closeButtonProps={{disabled:busy,'aria-label':'关闭模型设置'}}>
   {opened&&<div className={styles.root} data-testid="pi-model-services">
    {view&&<div className={styles.tabs} role="tablist" aria-label="模型服务分类">{view.catalog.categories.map(tab=>{const Icon=icons[tab.id];return <button type="button" key={tab.id} role="tab" aria-selected={tab.id===category} aria-controls="model-service-category-panel" className={styles.tab} disabled={busy||loading} onClick={()=>navigate(()=>{setCategory(tab.id);setSearch('');})}><Icon size={15}/>{tab.label}</button>;})}</div>}
    {loading&&!view&&<Group justify="center" p="xl"><Loader size="sm"/><Text size="sm">正在读取供应商目录</Text></Group>}
    {error&&<Alert title="无法读取配置" color="red" m="md">{error}<Button variant="subtle" size="compact-xs" disabled={busy} onClick={()=>navigate(()=>{void load();})}>重新读取</Button></Alert>}
    {view&&<div className={styles.layout} id="model-service-category-panel" role="tabpanel">
     <nav className={styles.providers} aria-label="模型供应商">
      <TextInput className={styles.search} size="xs" aria-label="搜索供应商" placeholder="搜索供应商" value={search} onChange={event=>setSearch(event.currentTarget.value)} leftSection={<IconSearch size={13}/>}/>
      <div className={styles.providerList}>{filtered.map(item=><button type="button" key={item.id} className={styles.provider} aria-pressed={entry?.id===item.id} aria-label={`选择供应商 ${item.name}`} disabled={busy||loading} onClick={()=>navigate(()=>setSelected(current=>({...current,[category]:item.id})))}><ProviderIcon preset={item.preset}/><span><span className={styles.providerName}>{item.name}</span><span className={styles.providerSub}><span className={styles.dot} data-state={item.connection?.status.state||'unset'}/>{item.preset?.execution==='pending'?'未接入':modelState(item.connection)}</span></span></button>)}{!filtered.length&&<Text size="xs" c="dimmed" p="sm">没有匹配的供应商</Text>}</div>
      {category==='chat'&&<Button variant="subtle" color="gray" size="xs" justify="flex-start" leftSection={<IconPlus size={13}/>} disabled={busy||loading} onClick={add}>添加自定义供应商</Button>}
     </nav>
     <main className={styles.main}>{entry&&<PiServiceProviderPanel key={`${category}/${entry.id}/${entry.connection?'saved':'preset'}/${panelEpoch}`} entry={entry} view={view} custom={!entry.preset} onApply={apply} onDirty={setDirty} onBusy={setBusy}/>}</main>
    </div>}
    <div className={styles.foot}><span><IconLock size={12}/>凭据仅在服务端加密保存，不写入文档和版本仓库</span><span>{view?`目录快照：${view.catalog.reference.capturedAt}`:'未读取配置'} · 已保存不等于验证通过</span></div>
   </div>}
  </Modal>
  <Modal opened={discard} onClose={()=>{setDiscard(false);next.current=null;}} title="放弃未保存的修改？" size="sm" centered closeOnClickOutside={false}><Text size="sm">当前输入尚未保存。已保存的连接、模型和会话不受影响。</Text><Group mt="md" justify="flex-end"><Button variant="default" onClick={()=>{setDiscard(false);next.current=null;}}>继续编辑</Button><Button color="red" onClick={()=>{const action=next.current;next.current=null;setDirty(false);setDiscard(false);setPanelEpoch(value=>value+1);action?.();}}>放弃修改</Button></Group></Modal>
 </>;
}
