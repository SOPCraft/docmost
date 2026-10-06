import { useState } from "react";
import { ActionIcon, Alert, Button, Modal, Text, Tooltip } from "@mantine/core";
import { IconBook2, IconExternalLink, IconSparkles } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import api from "@/lib/api-client";
import classes from "./handbook-button.module.css";

type Status={enabled:boolean;configured:boolean;autoUpdate?:boolean;state?:string;errorCode?:string|null;outdated?:boolean;assetsAccessible?:boolean;current?:{url:string;revision:number;versionId:string;pageId:string;jobId:string}|null;template?:{id:string;version:string}};
const templateNames:Record<string,string>={"chapter-reader":"章节工作本","continuous-reader":"连续阅读"};

export default function HandbookButton({pageId}:{pageId:string;readOnly?:boolean}){
 const userId=useAtomValue(currentUserAtom)?.user?.id;
 return userId?<Entry key={`${userId}:${pageId}`} pageId={pageId} userId={userId}/>:null;
}

function Entry({pageId,userId}:{pageId:string;userId:string}){
 const [opened,setOpened]=useState(false),setAside=useSetAtom(asideStateAtom),key=["sop-handbook",userId,pageId];
 const status=useQuery({queryKey:key,queryFn:async({signal})=>(await api.post<Status>("/pages/handbook/status",{pageId},{signal})).data,refetchInterval:opened?3000:false,retry:false,gcTime:0});
 const data=status.data;
 if(!status.isError&&!data?.enabled)return null;
 const openAgent=()=>{setOpened(false);setAside({tab:"pi",isAsideOpen:true});};
 const running=["queued","running"].includes(data?.state||"");
 const template=data?.template?.id?templateNames[data.template.id]||data.template.id:"标准版式";
 return <>
  <Tooltip label="标准 SOP 手册"><ActionIcon variant="subtle" color="dark" aria-label="标准 SOP 手册" data-testid="handbook-trigger" onClick={()=>setOpened(true)}><IconBook2 size={20}/></ActionIcon></Tooltip>
  <Modal opened={opened} onClose={()=>setOpened(false)} title="标准 SOP 手册" size="sm" centered classNames={{content:classes.modal,body:classes.body}}>
   <div className={classes.shell}>
    <div className={classes.hero}><div className={classes.icon}><IconBook2 size={20}/></div><div><div className={classes.title}>这篇文档的 SOP 手册</div><div className={classes.subtitle}>生成交给 Pi 智能体完成；这里仅查看当前结果和状态。</div></div></div>
    {status.isError?<Alert color="red">当前无法读取 SOP 状态。请检查文档权限后重试。</Alert>:data?.assetsAccessible===false?<Alert color="red">当前 SOP 引用的素材已不可访问，已停止提供阅读入口。</Alert>:data?.current?<div className={classes.card}>
      <div className={classes.cardHead}><div><div className={classes.version}>第 {data.current.revision} 版标准 SOP</div><div className={classes.meta}>{template} · {data.autoUpdate?"原稿更新后自动生成新版":"按需生成"}</div></div><span className={classes.status} data-state={data.outdated?"outdated":"current"}>{data.outdated?"原稿有更新":"当前可用"}</span></div>
      {data.errorCode&&<Alert color="orange" mb="sm">最近一次更新没有完成，当前完整版本仍然保留。</Alert>}
      {data.outdated&&<Text size="xs" c="dimmed">原稿已经有新版本。请在右侧 Pi 智能体中再次发送“把这篇文档生成标准 SOP 手册”。</Text>}
      <div className={classes.actions}><Button className={classes.open} component="a" href={data.current.url} target="_blank" rel="noopener noreferrer" rightSection={<IconExternalLink size={14}/>} data-testid="handbook-open">查看 SOP</Button><Button variant="default" leftSection={<IconSparkles size={14}/>} onClick={openAgent}>打开 Pi 智能体</Button></div>
     </div>:<div className={classes.empty}><div className={classes.emptyTitle}>{running?"正在生成 SOP":"还没有生成 SOP"}</div><div className={classes.emptyText}>{running?"Pi 智能体正在处理当前生成请求，可以回到右侧对话查看进度。":"打开右侧 Pi 智能体，点击底部“把这篇文档生成标准 SOP 手册”，或直接输入同样的话。"}</div><Button variant="light" leftSection={<IconSparkles size={14}/>} onClick={openAgent}>{running?"查看智能体进度":"打开 Pi 智能体"}</Button></div>}
    <div className={classes.note}>原文仍在当前文档中编辑；SOP 是这个固定版本的展示结果，不另存一份可编辑正文。</div>
   </div>
  </Modal>
 </>;
}
