import { useState } from "react";
import { ActionIcon, Alert, Button, Group, Modal, Stack, Switch, Text, Tooltip } from "@mantine/core";
import { IconBook2 } from "@tabler/icons-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import api from "@/lib/api-client";
import HandbookSetup from "./handbook-setup";
type Status={enabled:boolean;configured:boolean;autoUpdate?:boolean;state?:string;attempts?:number;errorCode?:string|null;outdated?:boolean;assetsAccessible?:boolean;current?:{url:string;revision:number;pageId:string;jobId:string}|null;template?:{id:string;version:string}};
const labels:Record<string,string>={idle:"尚未生成",queued:"等待更新",running:"正在读取与生成",succeeded:"已生成",failed:"更新失败",superseded:"已由新任务替代"};
const errors:Record<string,string>={LAYOUT_REQUIRED:"章节或表格结构已改变，需要重新排版。",SOURCE_ACCESS_REVOKED:"原稿或素材权限已失效，自动更新已停止。",SOURCE_CHANGED:"生成期间原稿发生变化，旧任务没有覆盖新结果。",SOURCE_TEMPORARILY_UNAVAILABLE:"来源暂不可用，任务会按限定次数重试。",LEASE_EXHAUSTED:"任务多次中断，请手动重试。"};
export default function HandbookButton({pageId,readOnly=false}:{pageId:string;readOnly?:boolean}){
 const userId=useAtomValue(currentUserAtom)?.user?.id;
 return userId?<Entry key={`${userId}:${pageId}`} pageId={pageId} userId={userId} readOnly={readOnly}/>:null;
}
function Entry({pageId,userId,readOnly}:{pageId:string;userId:string;readOnly:boolean}){
 const [opened,setOpened]=useState(false),[setup,setSetup]=useState(false),client=useQueryClient(),key=["sop-handbook",userId,pageId];
 const status=useQuery({queryKey:key,queryFn:async({signal})=>(await api.post<Status>("/pages/handbook/status",{pageId},{signal})).data,refetchInterval:opened?5000:false,retry:false,gcTime:0});
 const action=useMutation({mutationFn:async(payload:{route:string;enabled?:boolean})=>(await api.post<Status>(`/pages/handbook/${payload.route}`,{pageId,...(payload.enabled===undefined?{}:{enabled:payload.enabled})})).data,
  onSuccess:data=>client.setQueryData(key,data),onError:()=>{void client.invalidateQueries({queryKey:key});}});
 const data=status.data;if(!status.isError&&!data?.enabled)return null;
 return <>
  <Tooltip label="手册展示"><ActionIcon variant="subtle" color="dark" aria-label="手册展示" data-testid="handbook-trigger" onClick={()=>setOpened(true)}><IconBook2 size={20}/></ActionIcon></Tooltip>
  <Modal opened={opened} onClose={()=>{setOpened(false);setSetup(false);}} title={setup?"手册排版":"手册展示"} size="md" centered>
   <Stack gap="md">
    <Text size="sm">内容继续在原文档修改，展示沿用已关联的模板，不另存一份可编辑正文。</Text>
    {setup&&!readOnly?<HandbookSetup pageId={pageId} userId={userId} configured={!!data?.configured} defaultAuto={!!data?.autoUpdate} onApplied={()=>{setSetup(false);void client.invalidateQueries({queryKey:key});}} onCancel={()=>setSetup(false)}/>:status.isError?<Alert color="red">当前无法读取手册状态或访问权限已失效。<Button variant="subtle" onClick={()=>status.refetch()}>重新检查</Button></Alert>:!data?.configured?<Stack><Alert>这份文档尚未排版。选择版式后读取本篇原稿结构，核对无误再生成。</Alert>{!readOnly&&<Button data-testid="handbook-start-setup" onClick={()=>setSetup(true)}>首次排版</Button>}</Stack>:<>
     <Text role="status" data-testid="handbook-task-state">{labels[data.state||"idle"]||"状态待核验"}{data.attempts?` · 已尝试${data.attempts}次`:""}</Text>
     {data.errorCode&&<Alert color="orange">{errors[data.errorCode]||"更新未完成。旧结果未被失败任务覆盖，请检查后重试。"}</Alert>}
     {data.outdated&&<Alert color="orange">原稿或配置已更新。保留的旧版不作为最新执行依据，请回原稿核对。</Alert>}
     {data.assetsAccessible===false&&<Alert color="red">原素材访问检查失败，已停止提供阅读入口。</Alert>}
     <Group>
      {!readOnly&&<Button data-testid="handbook-refresh" loading={action.isPending} onClick={()=>action.mutate({route:"refresh"})}>生成或更新手册</Button>}
      {data.current&&!status.isError&&<Button component="a" href={data.current.url} target="_blank" rel="noopener noreferrer" variant="light" data-testid="handbook-open">查看第{data.current.revision}版</Button>}
     </Group>
     {!readOnly&&<Button variant="subtle" data-testid="handbook-change-layout" disabled={action.isPending} onClick={()=>setSetup(true)}>重新排版或更换版式</Button>}
     {!readOnly&&<Switch label="原稿保存后自动更新这份手册" description="仅对已关联手册生效；读取沿用当前操作者权限，撤权后停止。" checked={!!data.autoUpdate} disabled={action.isPending} onChange={e=>action.mutate({route:"automatic",enabled:e.currentTarget.checked})}/>}
     <Text size="xs" c="dimmed">{data.current?`当前结果：${data.current.pageId}`:"尚无完整生成结果"}。阅读中的页面只提示新版，不强制跳转或中断视频。</Text>
    </>}
    {action.isError&&<Alert color="red">操作未完成，请检查编辑权限、原稿版本是否已保存及连接状态；本次没有显示为成功。</Alert>}
   </Stack>
  </Modal>
 </>;
}
