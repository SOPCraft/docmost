import type { PiMessage } from './pi-workbench-state';
import { piMessageText } from './pi-workbench-state';
import PiMarkdown from './pi-markdown';
import classes from './pi-workbench.module.css';

const names:Record<string,string>={read:'读取文件',write:'写入文件',edit:'修改文件',bash:'执行终端命令',grep:'搜索文件内容',find:'查找文件',ls:'查看目录',list_documents:'查看已选文档',read_document:'读取原稿',ask_user:'向用户提问',create_skill:'创建可复用技能',read_skill:'读取自建技能',patch_skill:'修改自建技能',propose_document:'生成文档草稿',codemode:'编排工具调用',tool_search:'查找可用工具'};
const label=(name:unknown)=>names[String(name)]||`${String(name||'未命名')}（扩展工具）`;
export function PiTranscript({messages,partial}:{messages:PiMessage[];partial:PiMessage|null}) {
  const items=partial?[...messages,partial]:messages;
  const results=new Map<string,PiMessage>();
  for(const message of messages)if(message.role==='toolResult'&&typeof message.toolCallId==='string')results.set(message.toolCallId,message);
  return <>{items.map((message,index)=>{
    if(message.role==='toolResult')return null;
    const isUser=message.role==='user',text=piMessageText(message),parts=Array.isArray(message.content)?message.content:[];
    const calls=parts.filter(item=>item?.type==='toolCall');
    return <div key={index} data-pi-role={message.role} className={`${classes.message} ${isUser?classes.user:classes.assistant}`}>
      {isUser?<span style={{whiteSpace:'pre-wrap'}}>{text}</span>:<PiMarkdown text={text}/>}
      {calls.map((call,position)=>{
        const result=results.get(call.id);
        return <details key={call.id||position} className={`${classes.tool} ${result?.isError?classes.toolError:''}`}>
          <summary>{label(call.name)} · {result?result.isError?'未完成':'已返回':'执行记录'}</summary>
          <pre className={classes.payload}>{JSON.stringify(call.arguments,null,2)}</pre>
          {result&&<pre className={classes.payload}>{piMessageText(result)}</pre>}
        </details>;
      })}
      {message.role==='bashExecution'&&<details className={classes.tool}>
        <summary>终端执行记录</summary><pre className={classes.payload}>{String(message.command||'')}{'\n'}{String(message.output||'')}</pre>
      </details>}
      {parts.filter(item=>item?.type==='image'&&['image/png','image/jpeg','image/webp','image/gif'].includes(item.mimeType)&&typeof item.data==='string').map((image,position)=><img key={position} alt="本轮上传的图片" className={classes.image} src={`data:${image.mimeType};base64,${image.data}`}/>)}
    </div>;
  })}</>;
}
