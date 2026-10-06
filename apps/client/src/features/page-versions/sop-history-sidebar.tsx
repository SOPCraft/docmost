import { useMemo, useState } from "react";
import { Group, Loader, Text, UnstyledButton } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useParams } from "react-router-dom";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom";
import { usePageQuery } from "@/features/page/queries/page-query";
import { extractPageSlugId } from "@/lib";
import api from "@/lib/api-client";
import native from "@/features/page-history/components/css/history.module.css";
import classes from "@/features/page-versions/history-workspace.module.css";
import { localDateKey, timeLabel } from "@/features/page-versions/history-types";

type SopHistoryItem={
  jobId:string;
  revision:number;
  versionId:string;
  template?:{id:string;version:string}|null;
  current:boolean;
  completedAt?:string|null;
  url:string;
};
type SopTemplateOption={id:string;version:string;name:string;description?:string};

const legacyTemplateNames=new Map([["editorial-guide@2.1.0","专用章节版"]]);

export default function SopHistorySidebar(){
  const {pageSlug}=useParams();
  const {data:page,isError}=usePageQuery({pageId:extractPageSlugId(pageSlug)});
  const userId=useAtomValue(currentUserAtom)?.user?.id;
  if(isError)return <Text size="sm" c="dimmed">文档不可访问</Text>;
  return page&&userId&&!page.isBase?<SopHistoryWorkspace key={page.id+":"+userId} pageId={page.id} userId={userId}/>:null;
}

function SopHistoryWorkspace({pageId,userId}:{pageId:string;userId:string}){
  const [collapsed,setCollapsed]=useState<Set<string>>(()=>new Set());
  const history=useQuery({
    queryKey:["sop-handbook-history-workspace",userId,pageId],
    queryFn:async({signal})=>(await api.post<{enabled:boolean;items:SopHistoryItem[]}>("/pages/handbook/history",{pageId},{signal})).data,
    refetchInterval:10000,
    retry:false,
    gcTime:0,
  });
  const templates=useQuery({
    queryKey:["sop-handbook-history-layout-options",userId,pageId],
    queryFn:async({signal})=>{
      const value=(await api.post<SopTemplateOption[]>("/pages/handbook/layout-options",{pageId},{signal})).data;
      return Array.isArray(value)?value:[];
    },
    retry:false,
    gcTime:0,
  });
  const rows=useMemo(()=>[...(history.data?.items||[])].sort((a,b)=>Number(b.current)-Number(a.current)||new Date(b.completedAt||0).getTime()-new Date(a.completedAt||0).getTime()),[history.data]);
  const current=rows.find(item=>item.current)||null;
  const past=rows.filter(item=>!item.current);
  const templateMap=useMemo(()=>new Map((templates.data||[]).map(item=>[item.id+"@"+item.version,item.name])),[templates.data]);
  const templateName=(item:SopHistoryItem)=>item.template?templateMap.get(item.template.id+"@"+item.template.version)||legacyTemplateNames.get(item.template.id+"@"+item.template.version)||item.template.id:"标准版式";
  const groups=useMemo(()=>{
    const map=new Map<string,SopHistoryItem[]>();
    for(const row of past){
      const key=row.completedAt?localDateKey(row.completedAt):"时间未知";
      map.set(key,[...(map.get(key)||[]),row]);
    }
    return Array.from(map);
  },[past]);

  if(history.isPending)return <div className={classes.empty}><Loader size="sm"/></div>;
  if(history.isError)return <Text size="sm" c="dimmed">SOP 历史版本暂不可用</Text>;

  return <div className={classes.drawer} data-testid="sop-history-workspace">
    {current&&<UnstyledButton
      component="a"
      href={current.url}
      target="_blank"
      rel="noopener noreferrer"
      className={[native.history,classes.current,native.active].join(" ")}
      data-testid="sop-history-current"
    >
      <Group gap="xs" wrap="nowrap">
        <IconFileText size={18} stroke={1.5}/>
        <div>
          <Text size="sm" fw={500}>当前版本</Text>
          <Text size="xs" c="dimmed">查看正在使用的 SOP · 原稿第 {current.revision} 版 · {templateName(current)}</Text>
        </div>
      </Group>
    </UnstyledButton>}
    <div className={classes.drawerScroll} data-testid="sop-history-sidebar-scroll">
      <Group justify="space-between" py="xs" wrap="nowrap">
        <Text size="xs" c="dimmed">{rows.length} 个已生成版本</Text>
      </Group>
      <div className={classes.timeline} aria-label="SOP 历史版本列表">
        {groups.map(([date,versions])=><section key={date}>
          <UnstyledButton
            className={classes.dayToggle}
            aria-expanded={!collapsed.has(date)}
            onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(date))next.delete(date);else next.add(date);return next;})}
          >
            {collapsed.has(date)?"▸":"▾"} {date}
          </UnstyledButton>
          {!collapsed.has(date)&&versions.map(item=><UnstyledButton
            component="a"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            key={item.jobId}
            className={[native.history,native.historyButton,classes.row].join(" ")}
            aria-label={`原稿第${item.revision}版 ${templateName(item)} ${item.completedAt?timeLabel(item.completedAt):"时间未知"}`}
          >
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text size="sm"><time dateTime={item.completedAt||undefined}>{item.completedAt?timeLabel(item.completedAt):"时间未知"}</time></Text>
              <Text size="xs" c="dimmed">原稿第 {item.revision} 版</Text>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={1} mt={2}>{templateName(item)}</Text>
          </UnstyledButton>)}
        </section>)}
      </div>
      {past.length===0&&<Text size="sm" c="dimmed" p="xs">暂无历史 SOP 版本</Text>}
    </div>
  </div>;
}
