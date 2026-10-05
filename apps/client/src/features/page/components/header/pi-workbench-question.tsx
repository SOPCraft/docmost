import { useState } from 'react';
import { Button, Group, Stack, Text, Textarea, TextInput } from '@mantine/core';
import type { PiRecord } from './pi-workbench-state';
import classes from './pi-workbench.module.css';

export default function PiWorkbenchQuestion({ request, onRespond }: { request: PiRecord; onRespond: (value: object) => Promise<void> }) {
  const [value, setValue] = useState(String(request.prefill || ''));
  const [pending, setPending] = useState(false);
  const options = Array.isArray(request.options) ? request.options.filter(item => typeof item === 'string') as string[] : [];
  async function respond(answer: object) {
    setPending(true);
    try { await onRespond({ id: request.id, ...answer }); } finally { setPending(false); }
  }
  return <div className={classes.question} data-testid="pi-extension-question"><Stack gap="xs">
    <Text size="sm" fw={600}>{String(request.title || '需要你的确认')}</Text>
    {!!request.message && <Text size="sm">{String(request.message)}</Text>}
    {request.method === 'select' ? options.map(option => <Button key={option} variant="default" size="xs" disabled={pending} onClick={() => void respond({ value: option })}>{option}</Button>) : request.method === 'confirm' ?
      <Group gap="xs"><Button size="xs" disabled={pending} onClick={() => void respond({ confirmed: true })}>确认</Button><Button size="xs" variant="default" disabled={pending} onClick={() => void respond({ confirmed: false })}>拒绝</Button></Group> : <>
        {request.method === 'editor' ? <Textarea label="补充内容" value={value} onChange={event => setValue(event.currentTarget.value)} autosize minRows={3} /> : <TextInput label="你的回答" value={value} onChange={event => setValue(event.currentTarget.value)} />}
        <Button size="xs" disabled={pending} onClick={() => void respond({ value })}>发送回答</Button>
      </>}
    <Button size="compact-xs" variant="subtle" disabled={pending} onClick={() => void respond({ cancelled: true })}>取消本次问题</Button>
  </Stack></div>;
}
