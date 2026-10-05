import type { PiMessage } from './pi-workbench-state';
import { piMessageText } from './pi-workbench-state';
import classes from './pi-workbench.module.css';

export function PiTranscript({ messages, partial }: { messages: PiMessage[]; partial: PiMessage | null }) {
  const items = partial ? [...messages, partial] : messages;
  return <>{items.map((message, index) => {
    const isUser = message.role === 'user';
    const isTool = message.role === 'toolResult';
    const text = piMessageText(message);
    if (isTool) return <details className={classes.tool} key={index}>
      <summary>工具执行结果 · {message.isError ? '未完成' : '已返回'}</summary>
      <pre className={classes.payload}>{text}</pre>
    </details>;
    return <div key={index} data-pi-role={message.role} className={`${classes.message} ${isUser ? classes.user : classes.assistant}`}>
      {text.split('\n\n').map((paragraph, line) => <p key={line} style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px' }}>{paragraph}</p>)}
    </div>;
  })}</>;
}
