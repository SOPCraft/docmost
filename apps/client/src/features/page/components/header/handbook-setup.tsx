import { useRef, useState } from "react";
import { Alert, Button, Checkbox, Group, NativeSelect, Stack, Switch, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api-client";
import classes from "./handbook-setup.module.css";

type Option={id:string;version:string;name:string;description:string};
type Proposal={proposalHash:string;versionId:string;revision:number;recommendation?:{templateId:string;templateVersion:string;density:string};summary:{planner?:string;modelUsed:boolean;model?:{provider:string;id:string;label?:string}|null;template?:{id:string;version:string};density?:string;counts:{blocks:number;headings:number;tables:number;images:number;videos:number};outline:{block:number;level:number;title:string}[];notes:string[]}};

function message(error:unknown){const e=error as {response?:{status?:number;data?:{message?:string}}};const code=e.response?.data?.message||"";
 if(e.response?.status===409)return "原稿、任务或排版配置已变化，请重新分析后确认。本次没有用旧确认替换新的配置。";
 if([401,403,404].includes(e.response?.status||0))return "当前无法访问原稿或原素材，请检查登录及编辑权限。";
 if(code.includes("PI_MODEL_NOT_CONFIGURED"))return "当前工作空间还没有可用模型，请先到模型设置中完成连接并通过测试。";
 if(code.includes("PI_LAYOUT_RESULT_INVALID")||code.includes("LAYOUT_MODEL_REQUIRED"))return "模型返回的排版引用没有通过原稿完整性校验。本次没有生成，请重新分析。";
 if(code.includes("PI_LAYOUT_GENERATION_FAILED"))return "排版技能没有形成可验证方案，请检查模型连接后重试。";
 if(code.includes("unsupported-source-block-"))return "这份原稿含当前不能完整显示的内容块："+code.replace("LAYOUT_INPUT:","")+"。未删除或跳过内容，请回原稿调整后重试。";
 if(code.includes("empty"))return "原稿尚无可展示内容，请先保存正文。";
 return "排版分析没有完成。请确认原稿已保存为固定版本、模型连接正常后重试；旧结果保留。";
}
export default function HandbookSetup({pageId,userId,configured,defaultAuto=false,onApplied,onCancel}:{pageId:string;userId:string;configured:boolean;defaultAuto?:boolean;onApplied:()=>void;onCancel:()=>void}){
 const options=useQuery({queryKey:["handbook-layout-options",userId,pageId],queryFn:async({signal})=>(await api.post<Option[]>("/pages/handbook/layout-options",{pageId},{signal})).data,retry:false,gcTime:0});
 const [chosen,setChosen]=useState(""),[density,setDensity]=useState("comfortable"),[proposal,setProposal]=useState<Proposal|null>(null),[confirmed,setConfirmed]=useState(false),[automatic,setAutomatic]=useState(defaultAuto),[busy,setBusy]=useState(false),[error,setError]=useState("");const attempt=useRef(0);
 const selected=options.data?.find(o=>o.id===chosen)||options.data?.[0],recommended=proposal?.recommendation,recommendedOption=options.data?.find(o=>o.id===recommended?.templateId);
 function invalidate(){attempt.current++;setProposal(null);setConfirmed(false);setError("");}
 async function preview(){if(!selected)return;const ticket=++attempt.current;setBusy(true);setError("");setProposal(null);setConfirmed(false);
  try{const r=await api.post<Proposal>("/pages/handbook/layout-preview",{pageId,templateId:selected.id,templateVersion:selected.version,density},{timeout:90000});if(ticket===attempt.current)setProposal(r.data);}catch(e){if(ticket===attempt.current)setError(message(e));}finally{if(ticket===attempt.current)setBusy(false);}
 }
 async function apply(){if(!selected||!proposal||!confirmed)return;setBusy(true);setError("");
  try{await api.post("/pages/handbook/layout-apply",{pageId,templateId:selected.id,templateVersion:selected.version,density,proposalHash:proposal.proposalHash,autoUpdate:automatic});onApplied();}
  catch(e){setError(message(e));setProposal(null);setConfirmed(false);}finally{setBusy(false);}
 }
 return <Stack className={classes.root} data-testid="handbook-setup">
  <div className={classes.intro}><div className={classes.introTitle}>{configured?"重新排版或更换版式":"首次排版"}</div><div className={classes.introText}>排版技能读取当前固定版本，由已配置模型判断版式和原稿块引用；程序再做完整性校验并原样装入正文。模型不能改写、删减或重排原内容。</div></div>
  {options.isError?<Alert color="red">无法读取可用版式。<Button variant="subtle" onClick={()=>options.refetch()}>重试</Button></Alert>:<>
   <div className={classes.controls}>
    <NativeSelect label="版式偏好" data-testid="handbook-template-choice" value={selected?.id||""} disabled={busy||!options.data?.length} onChange={e=>{setChosen(e.currentTarget.value);invalidate();}} data={(options.data||[]).map(o=>({value:o.id,label:o.name}))}/>
    <NativeSelect label="阅读间距偏好" value={density} disabled={busy} data={[{value:"comfortable",label:"舒适间距"},{value:"compact",label:"紧凑间距（不缩小正文）"}]} onChange={e=>{setDensity(e.currentTarget.value);invalidate();}}/>
   </div>
   <Text className={classes.hint}>{selected?.description}。这是偏好，不是强制套模板；排版技能会结合完整原稿判断，最终推荐会在确认前展示。</Text>
   <Button variant="light" data-testid="handbook-layout-preview" disabled={!selected} loading={busy} onClick={preview}>让排版技能分析原稿</Button>
  </>}
  {proposal&&<div className={classes.summary}>
   <div className={classes.recommendation}><span>模型排版建议</span><strong>{recommendedOption?.name||recommended?.templateId||proposal.summary.template?.id} · {recommended?.density==="compact"?"紧凑间距":"舒适间距"}</strong></div>
   <Alert title={`固定原稿第${proposal.revision}版 · 已通过内容完整性校验`} data-testid="handbook-layout-summary">{proposal.summary.counts.blocks}个内容块 · {proposal.summary.counts.headings}个原有标题 · {proposal.summary.counts.tables}张表格 · {proposal.summary.counts.images}张图片 · {proposal.summary.counts.videos}段视频{proposal.summary.model?.label?` · ${proposal.summary.model.label}`:""}</Alert>
   {proposal.summary.outline.length>0&&<div className={classes.outline} aria-label="原稿标题核对">{proposal.summary.outline.map(item=><Text key={item.block} size="sm" style={{paddingLeft:Math.max(0,item.level-1)*10}}>{item.title||"（原稿空标题）"}</Text>)}</div>}
   <div className={classes.notes}>{proposal.summary.notes.map((note,index)=><Text size="xs" c="dimmed" key={index}>{note}</Text>)}</div>
   <Switch label="后续原稿保存后自动更新" checked={automatic} disabled={busy} onChange={e=>setAutomatic(e.currentTarget.checked)}/>
   <Checkbox data-testid="handbook-layout-confirm" label={configured?"已核对模型建议与原稿结构，确认替换当前排版配置；旧完整结果保留。":"已核对模型建议与原稿结构，确认生成标准手册。"} checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.currentTarget.checked)}/>
   <Button data-testid="handbook-layout-apply" disabled={!confirmed} loading={busy} onClick={apply}>确认并生成手册</Button>
  </div>}
  {error&&<Alert color="red" role="alert">{error}</Alert>}
  <Group className={classes.actions}><Button variant="subtle" disabled={busy} onClick={()=>{attempt.current++;onCancel();}}>取消，不更改配置</Button></Group>
 </Stack>;
}
