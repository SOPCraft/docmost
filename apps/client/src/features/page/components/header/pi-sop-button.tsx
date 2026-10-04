import { useEffect, useRef, useState } from 'react';
import { Accordion, ActionIcon, Alert, Badge, Button, Drawer, Group, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSparkles, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useAtomValue } from 'jotai';
import { currentUserAtom } from '@/features/user/atoms/current-user-atom';
import api from '@/lib/api-client';
import { PiClaim, PiPreview, PiReference, PiSource, PiStatus, piErrorMessage, selectionIds } from './pi-sop-types';

type Candidate = { id: string; title: string };
export default function PiSopButton({ pageId, title }: { pageId: string; title: string }) {
  const userId = useAtomValue(currentUserAtom)?.user?.id;
  return userId ? <Entry key={`${userId}:${pageId}`} pageId={pageId} title={title} userId={userId} /> : null;
}

function References({ items }: { items: PiReference[] }) {
  return <>{items.map((item, index) => <Text key={index} size="xs" c="dimmed" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>来源片段 {item.blockId}：{item.quote}</Text>)}</>;
}
function Claim({ value }: { value: PiClaim }) {
  const labels = { source: '来自资料', suggestion: '新增建议', missing: '待补充' };
  return <Stack gap={4}><Badge variant="light">{labels[value.kind]}</Badge><Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value.text}</Text><References items={value.references} /></Stack>;
}
export function PiDraftPreview({ result }: { result: PiPreview }) {
  const draft = result.draft;
  return <Stack gap="md" data-testid="pi-sop-preview">
    <Alert color="orange">当前是待核对预览，尚未保存。关闭侧栏、切换资料或来源校验失败会清除预览；原稿未被修改。</Alert>
    <Text fw={700}>{draft.title}</Text>
    <Text fw={600}>目标</Text><Claim value={draft.goal} />
    <Text fw={600}>适用范围</Text><Claim value={draft.scope} />
    {draft.prerequisites.length > 0 && <><Text fw={600}>准备事项</Text>{draft.prerequisites.map((item, index) => <Claim key={index} value={item} />)}</>}
    <Accordion multiple defaultValue={draft.steps.slice(0, 1).map(item => item.id)}>
      {draft.steps.map((step, index) => <Accordion.Item key={step.id} value={step.id}>
        <Accordion.Control>{index + 1}. {step.title}</Accordion.Control>
        <Accordion.Panel><Stack gap="sm">
          <Claim value={step.action} />
          <Text fw={600} size="sm">责任人</Text>{step.owner ? <Claim value={step.owner} /> : <Text size="sm">原资料未明确，需人工确认。</Text>}
          {step.checks.length > 0 && <><Text fw={600} size="sm">检查标准</Text>{step.checks.map((item, i) => <Claim key={i} value={item} />)}</>}
          {step.exceptions.length > 0 && <><Text fw={600} size="sm">异常处理</Text>{step.exceptions.map((item, i) => <Claim key={i} value={item} />)}</>}
          {step.next.map((branch, i) => <Stack key={i} gap={4}><Claim value={branch.condition} /><Text size="sm">{branch.stepId ? `转到步骤 ${branch.stepId}` : '流程结束'}</Text></Stack>)}
        </Stack></Accordion.Panel>
      </Accordion.Item>)}
    </Accordion>
    {draft.issues.map((issue, index) => <Alert key={index} color="orange" title={issue.kind === 'conflict' ? '资料存在冲突' : '需要补充'}>{issue.question}<References items={issue.references} /></Alert>)}
    {result.uninterpreted.length > 0 && <Alert color="orange">共有{result.uninterpreted.length}处媒体或链接目标未解析；不能把文字说明视为已阅读完整图片、视频或链接内容。</Alert>}
    <Accordion><Accordion.Item value="coverage"><Accordion.Control>检查全部来源覆盖</Accordion.Control><Accordion.Panel>
      <Stack gap="xs">{draft.coverage.map(item => <Text key={item.blockId} size="xs">{item.blockId}：{item.stepIds.length ? item.stepIds.join('、') : '未纳入步骤'}{item.reason ? `；${item.reason}` : ''}</Text>)}</Stack>
    </Accordion.Panel></Accordion.Item></Accordion>
    <Text size="xs" c="dimmed">引用校验只证明引文存在，不代表推理、流程或制度正确。请人工核对后再采用。</Text>
  </Stack>;
}

function Entry({ pageId, title, userId }: { pageId: string; title: string; userId: string }) {
  const [opened, setOpened] = useState(false);
  const [selected, setSelected] = useState<Candidate[]>([{ id: pageId, title }]);
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 300);
  const [instruction, setInstruction] = useState('整理成新人能照着执行的标准流程，标出冲突和缺少的信息。');
  const [pinned, setPinned] = useState<PiSource[]>([]);
  const [result, setResult] = useState<PiPreview | null>(null);
  const [resultConfig, setResultConfig] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const active = useRef<AbortController | null>(null);
  const status = useQuery({
    queryKey: ['pi-sop-status', userId, pageId], enabled: opened, retry: false, gcTime: 0,
    refetchInterval: opened ? 5000 : false,
    queryFn: async ({ signal }) => (await api.post<PiStatus>('/pages/pi-sop/status', { pageId }, { signal, timeout: 6000 })).data,
  });
  const search = useQuery({
    queryKey: ['pi-sop-search', userId, debounced], enabled: opened && debounced.trim().length >= 2,
    retry: false, gcTime: 0,
    queryFn: async ({ signal }) => (await api.post<{ items: Candidate[] }>('/search', { query: debounced, titleOnly: true }, { signal, timeout: 6000 })).data.items,
  });

  const invalidate = () => {
    epoch.current += 1;
    active.current?.abort(); active.current = null;
    setBusy(false); setResult(null); setPinned([]); setResultConfig('');
  };
  useEffect(() => () => { epoch.current += 1; active.current?.abort(); }, []);
  useEffect(() => {
    if (status.isError || (result && (!status.data?.enabled || status.data.configurationId !== resultConfig))) {
      invalidate(); setError('模型配置或当前访问校验失效，预览已撤下。');
    }
  }, [status.isError, status.data?.enabled, status.data?.configurationId, resultConfig]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { invalidate(); setError('页面离开前台，当前整理和预览已清除。'); } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  useEffect(() => {
    if (!result) return;
    const controller = new AbortController(); let checking = false;
    const check = async () => {
      if (checking) return; checking = true;
      try {
        const response = await api.post<{ valid: boolean }>('/pages/pi-sop/revalidate', { selections: selectionIds(pinned) }, { signal: controller.signal, timeout: 6000 });
        if (response.data.valid !== true) throw new Error();
      } catch {
        if (!controller.signal.aborted) { invalidate(); setError('来源已变化、无法访问或连接中断，预览已撤下，请重新整理。'); }
      } finally { checking = false; }
    };
    const timer = window.setInterval(() => { void check(); }, 5000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [result, pinned]);

  const generate = async () => {
    if (!status.data?.enabled || !status.data.configurationId || !selected.length || busy) return;
    invalidate(); setError(''); setBusy(true);
    const generation = epoch.current;
    const controller = new AbortController(); active.current = controller;
    const configurationId = status.data.configurationId;
    try {
      const prepared = (await api.post<{ items: PiSource[] }>('/pages/pi-sop/prepare', { pageIds: selected.map(item => item.id) }, { signal: controller.signal, timeout: 65000 })).data;
      if (generation !== epoch.current || controller.signal.aborted) return;
      setPinned(prepared.items);
      const response = (await api.post<PiPreview>('/pages/pi-sop/generate', {
        selections: selectionIds(prepared.items), instruction, skillId: 'sop-organizer', configurationId,
      }, { signal: controller.signal, timeout: 70000 })).data;
      if (generation !== epoch.current || controller.signal.aborted) return;
      setResultConfig(configurationId); setResult(response);
    } catch (failure) {
      if (generation === epoch.current && !controller.signal.aborted) { setResult(null); setError(piErrorMessage(failure)); }
    } finally {
      if (generation === epoch.current) { setBusy(false); active.current = null; }
    }
  };
  const close = () => { invalidate(); setError(''); setQuery(''); setSelected([{ id: pageId, title }]); setOpened(false); };

  return <>
    <Tooltip label="流程整理"><ActionIcon aria-label="流程整理" variant="subtle" color="dark" data-testid="pi-sop-trigger" onClick={() => setOpened(true)}><IconSparkles size={20} /></ActionIcon></Tooltip>
    <Drawer opened={opened} onClose={close} title="流程整理" position="right" size="lg">
      <Stack gap="md">
        <Text size="sm">选择一篇或多篇资料，使用内置技能梳理步骤、责任人、检查项与异常处理。不会覆盖原稿。</Text>
        {status.isLoading && <Text role="status">正在检查访问权限和模型设置。</Text>}
        {!status.isLoading && !status.isError && !status.data?.enabled && <Alert>管理员尚未为当前工作空间启用模型。模型地址和密钥只在服务端配置。</Alert>}
        {status.data?.enabled && <>
          <Text size="sm">内置技能：{status.data.skill?.label}；模型：{status.data.model?.label}（管理员配置）。</Text>
          <Alert>点击整理后，所选资料的文字与表格文字会发送给上述模型。图片、视频和链接目标暂不解析。</Alert>
          <Text fw={600}>已选资料（{selected.length}/10）</Text>
          {selected.map(item => <Group key={item.id} justify="space-between" wrap="nowrap"><Text size="sm" style={{ overflowWrap: 'anywhere' }}>{item.title || '未命名文档'}</Text><ActionIcon aria-label={`移除${item.title}`} disabled={busy} onClick={() => { invalidate(); setSelected(selected.filter(value => value.id !== item.id)); }}><IconX size={16} /></ActionIcon></Group>)}
          <TextInput label="添加资料" placeholder="输入至少两个字搜索文档标题" value={query} disabled={busy || selected.length >= 10} onChange={event => setQuery(event.currentTarget.value)} />
          {search.isError && <Text size="sm" c="red">搜索失败，未添加任何资料。</Text>}
          {debounced.trim().length >= 2 && search.data?.filter(item => !selected.some(value => value.id === item.id)).slice(0, 10).map(item => <Button key={item.id} variant="light" disabled={busy || selected.length >= 10} onClick={() => { invalidate(); setSelected([...selected, item]); setQuery(''); }}>{item.title || '未命名文档'}</Button>)}
          <Textarea label="整理要求" value={instruction} maxLength={4000} autosize minRows={3} disabled={busy} onChange={event => { invalidate(); setInstruction(event.currentTarget.value); }} />
          <Group><Button data-testid="pi-sop-generate" loading={busy} disabled={!selected.length || status.isError} onClick={() => { void generate(); }}>整理选中资料</Button>{busy && <Button variant="default" onClick={() => { invalidate(); setError('本次整理已取消。'); }}>取消本次整理</Button>}</Group>
          {busy && <Text role="status">正在固定来源、调用指定技能并校验结果；尚未保存任何内容。</Text>}
        </>}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        {pinned.length > 0 && <Stack gap={4}>{pinned.map((item, index) => <Text key={item.pageId} size="xs">来源{index + 1}：{item.title} · 固定第{item.revision}版</Text>)}</Stack>}
        {result && <PiDraftPreview result={result} />}
      </Stack>
    </Drawer>
  </>;
}
