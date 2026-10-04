import { useRef, useState } from "react";
import { Alert, Button, Checkbox, Group, NativeSelect, Stack, Switch, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
type Option={id:string;version:string;name:string;description:string};
type Proposal={proposalHash:string;versionId:string;revision:number;summary:{modelUsed:boolean;counts:{blocks:number;headings:number;tables:number;images:number;videos:number};outline:{block:number;level:number;title:string}[];notes:string[]}};
function message(error:unknown){const e=error as {response?:{status?:number;data?:{message?:string}}};const code=e.response?.data?.message||"";
 if(e.response?.status===409)return "原稿、任务或排版配置已变化，请重新读取结构后确认。本次没有用旧确认替换新的配置。";
 if([401,403,404].includes(e.response?.status||0))return "当前无法访问原稿或原素材，请检查登录及编辑权限。";
 if(code.includes('unsupported-source-block-'))return "这份原稿含当前不能完整显示的内容块："+code.replace('LAYOUT_INPUT:','')+"。未删除或跳过内容，请回原稿调整后重试。";
 if(code.includes('empty'))return "原稿尚无可展示内容，请先保存正文。";
 return "尚未完成结构核对或生成。请确认原稿已保存为固定版本、内容受支持后重试；旧结果保留。";
}
export default function HandbookSetup({pageId,userId,configured,defaultAuto=false,onApplied,onCancel}:{pageId:string;userId:string;configured:boolean;defaultAuto?:boolean;onApplied:()=>void;onCancel:()=>void}){
 const options=useQuery({queryKey:["handbook-layout-options",userId,pageId],queryFn:async({signal})=>(await api.post<Option[]>("/pages/handbook/layout-options",{pageId},{signal})).data,retry:false,gcTime:0});
 const [chosen,setChosen]=useState(""),[density,setDensity]=useState("comfortable"),[proposal,setProposal]=useState<Proposal|null>(null),[confirmed,setConfirmed]=useState(false),[automatic,setAutomatic]=useState(defaultAuto),[busy,setBusy]=useState(false),[error,setError]=useState("");const attempt=useRef(0);
 const selected=options.data?.find(o=>o.id===chosen)||options.data?.[0];
 function invalidate(){attempt.current++;setProposal(null);setConfirmed(false);setError("");}
 async function preview(){if(!selected)return;const ticket=++attempt.current;setBusy(true);setError("");setProposal(null);setConfirmed(false);
  try{const r=await api.post<Proposal>("/pages/handbook/layout-preview",{pageId,templateId:selected.id,templateVersion:selected.version,density});if(ticket===attempt.current)setProposal(r.data);}catch(e){if(ticket===attempt.current)setError(message(e));}finally{if(ticket===attempt.current)setBusy(false);}
 }
 async function apply(){if(!selected||!proposal||!confirmed)return;setBusy(true);setError("");
  try{await api.post("/pages/handbook/layout-apply",{pageId,templateId:selected.id,templateVersion:selected.version,density,proposalHash:proposal.proposalHash,autoUpdate:automatic});onApplied();}
  catch(e){setError(message(e));setProposal(null);setConfirmed(false);}finally{setBusy(false);}
 }
 return <Stack gap="sm" data-testid="handbook-setup">
  <Text fw={600}>{configured?"重新排版或更换版式":"首次排版"}</Text>
  <Text size="sm">只按原有标题、全文顺序和原素材组合，不改正文，不补流程。当前采用固定规则识别，不调用模型。</Text>
  {options.isError?<Alert color="red">无法读取可用版式。<Button variant="subtle" onClick={()=>options.refetch()}>重试</Button></Alert>:<>
   <NativeSelect label="版式" data-testid="handbook-template-choice" value={selected?.id||""} disabled={busy||!options.data?.length} onChange={e=>{setChosen(e.currentTarget.value);invalidate();}} data={(options.data||[]).map(o=>({value:o.id,label:o.name}))}/>
   <Text size="xs" c="dimmed">{selected?.description}</Text>
   <NativeSelect label="阅读间距" value={density} disabled={busy} data={[{value:'comfortable',label:'舒适间距'},{value:'compact',label:'紧凑间距（不缩小正文）'}]} onChange={e=>{setDensity(e.currentTarget.value);invalidate();}}/>
   <Button variant="light" data-testid="handbook-layout-preview" disabled={!selected} loading={busy} onClick={preview}>读取原稿并核对结构</Button>
  </>}
  {proposal&&<>
   <Alert title={`固定原稿第${proposal.revision}版`} data-testid="handbook-layout-summary">{proposal.summary.counts.blocks}个内容块 · {proposal.summary.counts.headings}个原有标题 · {proposal.summary.counts.tables}张表格 · {proposal.summary.counts.images}张图片 · {proposal.summary.counts.videos}段视频</Alert>
   {proposal.summary.outline.length>0&&<div style={{maxHeight:220,overflowY:'auto',border:'1px solid var(--mantine-color-gray-3)',padding:12}} aria-label="原稿标题核对">{proposal.summary.outline.map(item=><Text key={item.block} size="sm" style={{paddingLeft:Math.max(0,item.level-1)*10}}>{item.title||'（原稿空标题）'}</Text>)}</div>}
   {proposal.summary.notes.map(note=><Text size="xs" key={note}>{note}</Text>)}
   <Switch label="后续原稿保存后自动更新" checked={automatic} disabled={busy} onChange={e=>setAutomatic(e.currentTarget.checked)}/>
   <Checkbox data-testid="handbook-layout-confirm" label={configured?"已核对原有结构，确认更换当前排版配置；旧完整结果保留。":"已核对原有结构，确认按所选版式生成。"} checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.currentTarget.checked)}/>
   <Button data-testid="handbook-layout-apply" disabled={!confirmed} loading={busy} onClick={apply}>确认并生成手册</Button>
  </>}
  {error&&<Alert color="red" role="alert">{error}</Alert>}
  <Group justify="flex-end"><Button variant="subtle" disabled={busy} onClick={()=>{attempt.current++;onCancel();}}>取消，不更改配置</Button></Group>
 </Stack>;
}
