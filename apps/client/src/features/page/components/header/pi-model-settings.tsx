import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Collapse, Group, Loader, Modal, NumberInput, PasswordInput, Select, Stack, Switch, Text, TextInput, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconChevronDown, IconCpu, IconKey, IconLock, IconPencil, IconPlugConnected, IconPlus, IconSearch, IconSettings2, IconTrash } from '@tabler/icons-react';
import { piError, piRequest } from './pi-workbench-api';
import { editModel, endpointPreview, groupProviders, modelErrors, newModel, protocols, providerName } from './pi-model-config';
import type { ModelForm, ModelSettings, SavedModel } from './pi-model-config';
import styles from './pi-model-settings.module.css';

export default function PiModelSettings({ opened, onClose, onSaved }: { opened: boolean; onClose: () => void; onSaved: () => void }) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [form, setForm] = useState<ModelForm>(newModel);
  const [baseline, setBaseline] = useState('');
  const [editing, setEditing] = useState<{ original: string | null; providerNew: boolean } | null>(null);
  const [search, setSearch] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [fields, setFields] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false), [discard, setDiscard] = useState(false), [deleting, setDeleting] = useState<SavedModel | null>(null);
  const nextAction = useRef<(() => void) | null>(null), epoch = useRef(0);
  const groups = groupProviders(settings?.models || []), group = groups.find(item => item.id === selection);
  const dirty = !!baseline && JSON.stringify(form) !== baseline;
  function reset(value: ModelForm, next: typeof editing) {
    setForm(value); setBaseline(JSON.stringify(value)); setEditing(next); setFields({}); setError(''); setNotice(''); setAdvanced(false);
  }
  function selectProvider(id: string | null, snapshot = settings) {
    const first = snapshot?.models.find(item => item.provider === id);
    setSelection(first ? id : null); reset(first ? editModel(first) : newModel(), null);
  }
  function navigate(action: () => void) {
    if (busy) return;
    if (dirty) { nextAction.current = action; setDiscard(true); } else action();
  }
  async function load(signal?: AbortSignal) {
    const generation = ++epoch.current; setLoading(true); setError('');
    try {
      const result = await piRequest<ModelSettings>('model-settings', {}, signal);
      if (generation !== epoch.current) return;
      setSettings(result); selectProvider(result.models.find(item => item.provider === selection)?.provider || result.models[0]?.provider || null, result);
    } catch (failure) { if (generation === epoch.current && !signal?.aborted) { setSettings(null); setError(piError(failure)); } }
    finally { if (generation === epoch.current) setLoading(false); }
  }
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController(); setSettings(null); setSearch(''); setNotice(''); setSelection(null); setEditing(null); setBaseline('');
    void load(controller.signal);
    return () => { epoch.current++; controller.abort(); setForm(newModel()); setBaseline(''); setDiscard(false); setDeleting(null); nextAction.current = null; };
  }, [opened]);
  const change = (key: keyof ModelForm, value: unknown) => { setForm(current => ({ ...current, [key]: value })); setNotice(''); setFields(current => ({ ...current, [key]: '' })); };
  function addProvider(api = 'openai-completions') {
    navigate(() => {
      let provider = 'custom', counter = 2; while (groups.some(item => item.id === provider)) provider = `custom-${counter++}`;
      setSelection(null); reset({ ...newModel(provider), api }, { original: null, providerNew: true });
    });
  }
  function addModel() {
    if (!group) return;
    navigate(() => { const connection = group.models[0]; reset({ ...newModel(group.id), api: connection.api, baseUrl: connection.baseUrl }, { original: null, providerNew: false }); });
  }
  async function save(remove = false) {
    if (!settings || busy) return;
    const payload = remove && deleting ? editModel(deleting) : { ...form, modelId: form.modelId.trim(), baseUrl: form.baseUrl.trim() };
    if (!remove) {
      const errors = modelErrors(payload, settings, !editing || editing.original !== null);
      if (Object.keys(errors).length) { setFields(errors); if (errors.contextWindow || errors.maxTokens) setAdvanced(true); return; }
    }
    const generation = epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await piRequest<ModelSettings>('save-model', { revision: settings.revision, model: payload, remove });
      if (generation !== epoch.current) return;
      setSettings(result); setDeleting(null);
      selectProvider(result.models.some(item => item.provider === payload.provider) ? payload.provider : result.models[0]?.provider || null, result);
      setNotice(remove ? '模型已移除，会话记录保留。' : editing ? '模型已保存。' : '服务连接已保存。'); onSaved();
    } catch (failure) { if (generation === epoch.current) setError(piError(failure)); }
    finally { if (generation === epoch.current) setBusy(false); }
  }
  const providerNew = !!editing?.providerNew;
  const visibleGroups = groups.filter(item => `${providerName(item.id)} ${item.id}`.toLowerCase().includes(search.toLowerCase()));
  const connectionFields = (
    <section className={styles.section} aria-label="服务连接配置">
      <div className={styles.sectionHeading}><IconKey size={16} /><Text size="sm" fw={600}>连接配置</Text>{group && !editing && <Button size="compact-xs" variant="subtle" disabled={!dirty || busy} onClick={() => void save()}>保存连接</Button>}</div>
      <Stack gap="md">
        {providerNew && <TextInput label="服务商标识" description="给这组连接取一个唯一标识，例如 qwen（千问）或 company（公司服务）。" value={form.provider} onChange={event => change('provider', event.currentTarget.value)} error={fields.provider} autoComplete="off" />}
        <Select label="接口协议" data={protocols} value={form.api} onChange={value => value && change('api', value)} error={fields.api} />
        <TextInput label="服务地址" placeholder="粘贴服务商提供的接口基础地址" value={form.baseUrl} onChange={event => change('baseUrl', event.currentTarget.value)} error={fields.baseUrl} autoComplete="off" spellCheck={false} />
        {endpointPreview(form) && <div className={styles.endpoint}><span>请求地址</span><code>{endpointPreview(form)}</code></div>}
        <PasswordInput label="访问密钥" placeholder={group ? '已保存 · 留空保留当前密钥' : '填写服务商的访问密钥'} description={group ? '同一服务商的模型共用这组连接，保存连接会同步更新。' : '只写入服务端加密配置，不保存在浏览器。'} value={form.apiKey} onChange={event => change('apiKey', event.currentTarget.value)} error={fields.apiKey} autoComplete="new-password" />
      </Stack>
    </section>
  );
  return <>
    <Modal opened={opened} onClose={() => navigate(onClose)} title={<Group gap={10}><span className={styles.titleIcon}><IconCpu size={20} /></span><div><Text fw={600}>模型服务</Text><Text size="xs" c="dimmed">管理连接与可用模型</Text></div></Group>} size="min(980px, calc(100vw - 32px))" centered padding={0} radius={14} classNames={{ header: styles.modalHeader, content: styles.modal, body: styles.modalBody }} closeOnClickOutside={false} closeOnEscape={!busy && !discard && !deleting} closeButtonProps={{ disabled: busy, 'aria-label': '关闭模型设置' }}>
      <div className={styles.layout} data-testid="pi-model-services">
        <nav className={styles.providers} aria-label="模型服务商">
          <div className={styles.navHeading}><Text size="xs" fw={600} c="dimmed">服务商</Text><Tooltip label="添加服务商"><ActionIcon variant="subtle" color="gray" aria-label="添加服务商" disabled={!settings || busy} onClick={() => addProvider()}><IconPlus size={16} /></ActionIcon></Tooltip></div>
          <TextInput aria-label="搜索服务商" placeholder="搜索服务商" size="xs" leftSection={<IconSearch size={14} />} value={search} onChange={event => setSearch(event.currentTarget.value)} classNames={{ input: styles.searchInput }} />
          <div className={styles.providerList}>
            {loading && <div className={styles.loading}><Loader size="sm" /><Text size="xs">正在读取配置</Text></div>}
            {visibleGroups.map(item => <button type="button" className={styles.provider} key={item.id} aria-pressed={selection === item.id} disabled={busy} onClick={() => navigate(() => selectProvider(item.id))}>
              <span className={styles.providerIcon}><IconPlugConnected size={17} /></span><span className={styles.providerName}><span>{providerName(item.id)}</span><small><i />已配置 · {item.models.length}个模型</small></span>
            </button>)}
            {providerNew && <div className={`${styles.provider} ${styles.newProvider}`}><span className={styles.providerIcon}><IconPlus size={17} /></span><span className={styles.providerName}>新服务商<small>尚未保存</small></span></div>}
            {!loading && !providerNew && !groups.length && <Text size="xs" c="dimmed" px={8} py="md">还没有配置服务商</Text>}
            {!!groups.length && !visibleGroups.length && <Text size="xs" c="dimmed" p="xs">没有匹配的服务商</Text>}
          </div>
          <Button leftSection={<IconPlus size={14} />} variant="default" size="xs" fullWidth disabled={!settings || busy} onClick={() => addProvider()}>添加新的服务商</Button>
          <div className={styles.security}><IconLock size={13} /><span>仅工作空间管理员可修改</span></div>
        </nav>
        <div className={styles.main}>
          <div className={styles.mainScroll}>
            {error && <Alert color="red" mb="md" title="操作未完成">{error}<Button variant="subtle" size="compact-xs" disabled={busy} onClick={() => navigate(() => { void load(); })}>重新读取配置</Button></Alert>}
            {notice && <Alert color="green" mb="md" role="status">{notice}</Alert>}
            {!loading && settings && !group && !editing && <div className={styles.welcome}>
              <div className={styles.welcomeIcon}><IconPlugConnected size={27} /></div><Text fw={600} size="lg">连接你的模型服务</Text><Text size="sm" c="dimmed">先添加服务商，再管理这组连接下的模型。对话中随时切换，无需重复填写密钥。</Text>
              <div className={styles.protocolCards}>{protocols.map(item => <button key={item.value} type="button" onClick={() => addProvider(item.value)}><IconCpu size={18} /><span>{item.label}</span><IconPlus size={15} /></button>)}</div>
              <Text size="xs" c="dimmed">使用已有的模型账号与接口地址，不会自动开通或购买服务。</Text>
            </div>}
            {(group || editing) && <fieldset className={styles.fieldset} disabled={busy || !settings}>
              <div className={styles.providerHeader}><span className={styles.providerHeroIcon}><IconPlugConnected size={21} /></span><div><Text fw={600}>{providerNew ? '添加服务商' : providerName(form.provider)}</Text><Text size="xs" c="dimmed">{providerNew ? '保存首个模型后，这组服务即会出现在列表中' : `${form.provider} · 模型与连接独立管理`}</Text></div>{group && <Badge variant="light" color="gray" size="sm">已配置</Badge>}</div>
              {(!editing || providerNew) && connectionFields}
              {editing ? <section className={styles.section} data-testid="pi-model-editor">
                <div className={styles.sectionHeading}>{!providerNew && <ActionIcon variant="subtle" color="gray" aria-label="返回模型列表" onClick={() => navigate(() => selectProvider(selection))}><IconArrowLeft size={16} /></ActionIcon>}<Text fw={600} size="sm">{providerNew ? '首个模型' : editing.original ? '编辑模型' : '添加模型'}</Text></div>
                {!providerNew && <div className={styles.inheritHint}><IconLock size={13} />沿用当前服务商的地址、协议和已保存密钥。</div>}
                <Stack gap="md"><TextInput label="模型编号" description="与服务商提供的模型名称完全一致。" placeholder="输入准确的模型编号" value={form.modelId} readOnly={editing.original !== null} onChange={event => change('modelId', event.currentTarget.value)} error={fields.modelId} autoComplete="off" />
                  <TextInput label="显示名称" placeholder="用于对话中的模型选择，可留空" value={form.label} onChange={event => change('label', event.currentTarget.value)} />
                  <div className={styles.capabilities}><Switch size="sm" label="图片输入" checked={form.input.includes('image')} onChange={event => change('input', event.currentTarget.checked ? ['text', 'image'] : ['text'])} /><Switch size="sm" label="思考强度" checked={form.reasoning} onChange={event => change('reasoning', event.currentTarget.checked)} /></div>
                  <button type="button" className={styles.advancedToggle} aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><IconSettings2 size={15} />高级参数<IconChevronDown size={14} style={{ transform: advanced ? 'rotate(180deg)' : undefined }} /></button>
                  <Collapse in={advanced}><div className={styles.advanced}><NumberInput label="上下文上限" value={form.contextWindow} min={256} max={2000000} onChange={value => change('contextWindow', Number(value))} error={fields.contextWindow} /><NumberInput label="输出上限" value={form.maxTokens} min={256} max={200000} onChange={value => change('maxTokens', Number(value))} error={fields.maxTokens} /><Text size="xs" c="dimmed">按服务商能力填写；这些数值不是系统探测结果。</Text></div></Collapse>
                </Stack>
              </section> : group && <section className={styles.section} aria-label="服务商模型列表">
                <div className={styles.sectionHeading}><Text fw={600} size="sm">模型</Text><Badge variant="light" color="gray" size="xs">{group.models.length}</Badge><Button variant="default" size="compact-xs" leftSection={<IconPlus size={13} />} onClick={addModel}>添加模型</Button></div>
                <div className={styles.models}>{group.models.map(model => <div className={styles.modelCard} key={model.modelId}>
                  <IconCpu size={19} className={styles.modelIcon} /><div className={styles.modelInfo}><Text fw={500} size="sm">{model.label || model.modelId}</Text><Text size="xs" c="dimmed" className={styles.modelId}>{model.modelId}</Text><div className={styles.tags}><span>上下文 {model.contextWindow.toLocaleString()}</span>{model.input.includes('image') && <span>图片</span>}{model.reasoning && <span>思考</span>}</div></div>
                  <Tooltip label="编辑模型"><ActionIcon variant="subtle" color="gray" aria-label={`编辑模型 ${model.modelId}`} onClick={() => navigate(() => reset(editModel(model), { original: model.modelId, providerNew: false }))}><IconPencil size={16} /></ActionIcon></Tooltip>
                  <Tooltip label="移除模型"><ActionIcon variant="subtle" color="gray" aria-label={`移除模型 ${model.modelId}`} onClick={() => navigate(() => setDeleting(model))}><IconTrash size={16} /></ActionIcon></Tooltip>
                </div>)}</div>
              </section>}
            </fieldset>}
          </div>
          <div className={styles.footer}><span><IconLock size={13} />密钥加密保存，不回显原值</span>{editing ? <Group gap="xs"><Button variant="default" size="xs" disabled={busy} onClick={() => navigate(() => selectProvider(selection))}>取消</Button><Button size="xs" loading={busy} disabled={!settings} onClick={() => void save()}>{providerNew ? '保存并添加模型' : '保存模型'}</Button></Group> : <Text size="xs" c="dimmed">{dirty ? '连接配置有未保存的修改' : '已配置不代表已验证连通性'}</Text>}</div>
        </div>
      </div>
    </Modal>
    <Modal opened={discard} onClose={() => { setDiscard(false); nextAction.current = null; }} title="放弃未保存的修改？" centered size="sm" radius="md"><Text size="sm" c="dimmed">尚未保存的连接或模型修改将被丢弃，已保存配置不会改变。</Text><Group justify="flex-end" mt="lg"><Button variant="default" onClick={() => { setDiscard(false); nextAction.current = null; }}>继续编辑</Button><Button color="red" onClick={() => { const action = nextAction.current; nextAction.current = null; setDiscard(false); action?.(); }}>放弃修改</Button></Group></Modal>
    <Modal opened={!!deleting} onClose={() => { if (!busy) setDeleting(null); }} title="移除这个模型？" centered size="sm" radius="md" closeOnEscape={!busy} closeOnClickOutside={false} closeButtonProps={{ disabled: busy }}><Text size="sm">{deleting?.label || deleting?.modelId}</Text><Text size="sm" c="dimmed" mt="xs">仅移除可选模型，不删除文档或历史会话。</Text><Group justify="flex-end" mt="lg"><Button variant="default" disabled={busy} onClick={() => setDeleting(null)}>取消</Button><Button color="red" loading={busy} onClick={() => void save(true)}>确认移除</Button></Group></Modal>
  </>;
}
