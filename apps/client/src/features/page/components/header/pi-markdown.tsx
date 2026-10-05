import type { ReactNode } from 'react';
import classes from './pi-workbench.module.css';

function inline(value:string):ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,index)=>{
    if(part.startsWith('**')&&part.endsWith('**'))return <strong key={index}>{part.slice(2,-2)}</strong>;
    if(part.startsWith('`')&&part.endsWith('`'))return <code key={index}>{part.slice(1,-1)}</code>;
    return part;
  });
}
const boundary=(line:string)=>/^(#{1,6}\s|```|\s*[-*]\s|\s*\d+\.\s)/.test(line);
export default function PiMarkdown({text}:{text:string}) {
  const lines=text.split('\n'),result:ReactNode[]=[];let index=0;
  while(index<lines.length) {
    const line=lines[index];
    if(!line.trim()){index++;continue;}
    if(line.startsWith('```')) {
      const code:string[]=[];index++;
      while(index<lines.length&&!lines[index].startsWith('```'))code.push(lines[index++]);
      if(index<lines.length)index++;
      result.push(<pre key={index}><code>{code.join('\n')}</code></pre>);continue;
    }
    if(/^#{1,6}\s/.test(line)) {result.push(<h3 key={index}>{inline(line.replace(/^#{1,6}\s+/,''))}</h3>);index++;continue;}
    if(/^\s*[-*]\s/.test(line)) {
      const items:string[]=[];while(index<lines.length&&/^\s*[-*]\s/.test(lines[index]))items.push(lines[index++].replace(/^\s*[-*]\s+/,''));
      result.push(<ul key={index}>{items.map((item,position)=><li key={position}>{inline(item)}</li>)}</ul>);continue;
    }
    if(/^\s*\d+\.\s/.test(line)) {
      const items:string[]=[];const start=Number(line.trim().match(/^\d+/)?.[0]||1);
      while(index<lines.length&&/^\s*\d+\.\s/.test(lines[index]))items.push(lines[index++].replace(/^\s*\d+\.\s+/,''));
      result.push(<ol key={index} start={start}>{items.map((item,position)=><li key={position}>{inline(item)}</li>)}</ol>);continue;
    }
    const paragraph=[line];index++;
    while(index<lines.length&&lines[index].trim()&&!boundary(lines[index]))paragraph.push(lines[index++]);
    result.push(<p key={index}>{inline(paragraph.join('\n'))}</p>);
  }
  // Every model fragment remains a React text node; source HTML is not executed.
  return <div className={classes.prose}>{result}</div>;
}
