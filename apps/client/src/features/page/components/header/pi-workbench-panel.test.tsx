import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { webcrypto } from 'node:crypto';
import { PiWorkbenchPanel } from './pi-workbench-panel';
import { PiTranscript } from './pi-workbench-messages';
import { applyPiRecord,emptyPiState } from './pi-workbench-state';
import { selectedConversationKey } from './pi-workbench-api';
const mocks=vi.hoisted(()=>({post:vi.fn(),aside:{isAsideOpen:true,tab:'pi'},views:{} as Record<string,any>,configured:true,savedOnly:false,canManageModels:true}));
vi.mock('@/lib/api-client',()=>({default:{post:mocks.post}}));
vi.mock('jotai',()=>({useAtomValue:()=>mocks.aside}));
vi.mock('@/features/user/atoms/current-user-atom',()=>({currentUserAtom:{}}));
vi.mock('@/components/layouts/global/hooks/atoms/sidebar-atom',()=>({asideStateAtom:{}}));
vi.mock('@/features/page/queries/page-query',()=>({usePageQuery:()=>({data:null})}));
vi.mock('@/lib',()=>({extractPageSlugId:(value:string)=>value}));
const userId='10000000-0000-4000-8000-000000000001',workspaceId='20000000-0000-4000-8000-000000000001',pageId='30000000-0000-4000-8000-000000000001',first='40000000-0000-4000-8000-000000000001',second='40000000-0000-4000-8000-000000000002';
const storage=new Map<string,string>(),clients:QueryClient[]=[];
function view(id:string,name:string){return {meta:{id,title:name,sources:[{pageId,versionId:'v1',key:'source',title:'合成资料',revision:1}]},state:{sessionId:id,sessionFile:'/sessions/'+id+'.jsonl',model:{provider:'fixture',id:'fixture-model',name:'合成模型'},isStreaming:false,isCompacting:false,thinkingLevel:'off',autoCompactionEnabled:true,pendingMessageCount:0},messages:[{role:'assistant',content:[{type:'text',text:'已保存的合成对话'}]}],partial:null,busy:false,cursor:1,reset:false,events:[],dialogs:[],notices:[],models:[{provider:'fixture',id:'fixture-model',name:'合成模型'}],commands:[{name:'tools-workspace',description:'查看工具',source:'extension'}],stats:{},sessions:[],protocolCommands:['get_state','abort','prompt'],piVersion:'1.0.2'};}
function setup(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0},mutations:{retry:false}}});clients.push(client);return render(<QueryClientProvider client={client}><MantineProvider env="test"><PiWorkbenchPanel userId={userId} workspaceId={workspaceId} pageId={pageId} title="合成资料"/></MantineProvider></QueryClientProvider>);}
async function ready(){setup();await screen.findByText('已保存的合成对话');}
const commands=()=>mocks.post.mock.calls.filter(([route])=>route.endsWith('/command')).map(([,body])=>body);
beforeEach(()=>{
  mocks.aside={isAsideOpen:true,tab:'pi'};mocks.configured=true;mocks.savedOnly=false;mocks.canManageModels=true;mocks.views={[first]:view(first,'对话一'),[second]:view(second,'对话二')};storage.clear();storage.set(selectedConversationKey(workspaceId,userId),first);
  vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});vi.stubGlobal('crypto',webcrypto);
  Object.defineProperty(document,'fonts',{configurable:true,value:new EventTarget()});Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn().mockImplementation(()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}))});vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
  mocks.post.mockReset().mockImplementation(async(route:string,body:any)=>{
    if(route.endsWith('/status')){const model={provider:'fixture',id:'fixture-model',name:'合成模型'};return {data:{enabled:true,models:mocks.configured?[model]:[],configuredModels:(mocks.configured||mocks.savedOnly)?[model]:[],canManageModels:mocks.canManageModels}};}
    if(route.endsWith('/list'))return {data:{items:[mocks.views[first].meta,mocks.views[second].meta]}};
    if(route.endsWith('/view'))return {data:structuredClone(mocks.views[body.sessionId]||view(body.sessionId,'新对话'))};
    if(route.endsWith('/create')){mocks.views[body.sessionId]=view(body.sessionId,'新对话');return {data:mocks.views[body.sessionId].meta};}
    if(route.endsWith('/command'))return {data:{success:true,data:{accepted:true}}};
    if(route.endsWith('/respond')){mocks.views[body.sessionId].dialogs=[];return {data:{accepted:true}};}
    if(route.endsWith('/handbook/agent-generate'))return {data:{state:'succeeded',url:'/api/pages/handbook/view/page/job/index.html',revision:4,template:{id:'chapter-reader',version:'1.0.0'},reused:false}};
    return {data:{items:[]}};
  });
});
afterEach(()=>{cleanup();for(const client of clients.splice(0))client.clear();vi.unstubAllGlobals();});
describe('native Pi workbench panel',()=>{
  it('shows advanced controls only in an explicitly opened dialog, not above the conversation',async()=>{
    await ready();expect(screen.queryByLabelText('原生能力')).toBeNull();
    expect(screen.queryByRole('button',{name:'更多会话操作'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'设置与工具'}));fireEvent.click(await screen.findByRole('menuitem',{name:'完整原生控制'}));
    expect(screen.getByRole('dialog',{name:'高级工具'})).toBeTruthy();expect(screen.getByRole('combobox',{name:'原生能力'})).toBeTruthy();
    expect(screen.getByRole('textbox',{name:'发送给智能体',hidden:true})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'关闭高级工具'}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'高级工具'})).toBeNull());
    expect(commands()).toHaveLength(0);
  });

  it('a completed send does not erase a newer message being typed',async()=>{
    let resolve!:(value:unknown)=>void;const original=mocks.post.getMockImplementation()!;
    mocks.post.mockImplementation((route,...args)=>route.endsWith('/command')?new Promise(done=>{resolve=done;}):original(route,...args));
    await ready();const input=screen.getByRole('textbox',{name:'发送给智能体'});
    fireEvent.change(input,{target:{value:'已经提交的第一句'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(resolve).toBeTypeOf('function'));fireEvent.change(input,{target:{value:'正在输入的第二句'}});
    await act(async()=>{resolve({data:{success:true,data:{accepted:true}}});});
    await waitFor(()=>expect((input as HTMLTextAreaElement).value).toBe('正在输入的第二句'));
  });

  it('renders inside the host panel without creating a drawer overlay',async()=>{await ready();expect(screen.getByTestId('pi-workbench-panel')).toBeTruthy();expect(document.querySelector('.mantine-Drawer-overlay')).toBeNull();expect(screen.queryByText('整理选中资料')).toBeNull();});
  it('sends multiple turns into the same persisted conversation',async()=>{await ready();const input=screen.getByRole('textbox',{name:'发送给智能体'});for(const text of ['第一轮问题','继续修改第二步']){fireEvent.change(input,{target:{value:text}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await waitFor(()=>expect((input as HTMLTextAreaElement).value).toBe(''));}expect(commands().map(body=>body.sessionId)).toEqual([first,first]);expect(commands().map(body=>body.command.message)).toEqual(['第一轮问题','继续修改第二步']);});
  it('sends the standard SOP shortcut as the exact user message instead of opening another flow',async()=>{await ready();fireEvent.click(screen.getByRole('button',{name:'把这篇文档生成标准 SOP 手册'}));await waitFor(()=>expect(commands()[0]?.command.message).toBe('把这篇文档生成标准 SOP 手册'));expect(commands()[0]?.command.type).toBe('prompt');});
  it('turns a verified generate_sop tool call into a handbook result card',async()=>{mocks.views[first].messages=[{role:'assistant',content:[{type:'toolCall',id:'sop-call-1',name:'generate_sop',arguments:{sourceKey:'source',autoUpdate:true}}]},{role:'toolResult',toolCallId:'sop-call-1',isError:false,content:[{type:'text',text:'已受理'}]}];setup();expect(await screen.findByText('标准 SOP 手册已生成')).toBeTruthy();expect((await screen.findByRole('link',{name:'查看 SOP'})).getAttribute('href')).toBe('/api/pages/handbook/view/page/job/index.html');await waitFor(()=>expect(mocks.post.mock.calls.some(([route,body])=>route.endsWith('/handbook/agent-generate')&&body.toolCallId==='sop-call-1'&&body.sessionId===first)).toBe(true));});
  it('closing the panel does not send an abort or erase the selected conversation',async()=>{const rendered=setup();await screen.findByText('已保存的合成对话');rendered.unmount();expect(commands().some(body=>body.command.type==='abort')).toBe(false);expect(storage.get(selectedConversationKey(workspaceId,userId))).toBe(first);});
  it('remounting restores the server transcript rather than a new temporary session',async()=>{const rendered=setup();await screen.findByText('已保存的合成对话');rendered.unmount();await ready();expect(mocks.post.mock.calls.filter(([route])=>route.endsWith('/create'))).toHaveLength(0);expect(mocks.post.mock.calls.filter(([route])=>route.endsWith('/view')).every(([,body])=>body.sessionId===first)).toBe(true);});
  it('stops only the current native run',async()=>{mocks.views[first].busy=true;mocks.views[first].state.isStreaming=true;await ready();fireEvent.click(screen.getByRole('button',{name:'停止当前运行'}));await waitFor(()=>expect(commands()[0]?.command.type).toBe('abort'));expect(commands()[0].sessionId).toBe(first);});
  it('queues follow-up instructions while a native run is active',async()=>{mocks.views[first].busy=true;await ready();fireEvent.change(screen.getByRole('textbox',{name:'发送给智能体'}),{target:{value:'继续补充要求'}});fireEvent.click(screen.getByRole('button',{name:'追加'}));await waitFor(()=>expect(commands()[0]?.command.streamingBehavior).toBe('followUp'));});
  it('native extension questions return the chosen answer to their own request',async()=>{mocks.views[first].dialogs=[{type:'extension_ui_request',id:'question-1',method:'select',title:'谁来确认？',options:['负责人甲','负责人乙']}];await ready();fireEvent.click(screen.getByRole('button',{name:'负责人乙'}));await waitFor(()=>expect(mocks.post.mock.calls.find(([route])=>route.endsWith('/respond'))?.[1]).toEqual({sessionId:first,response:{id:'question-1',value:'负责人乙'}}));});
  it('does not pretend model generation is available before configuration',async()=>{mocks.configured=false;mocks.views[first].models=[];mocks.views[first].state.model=undefined;await ready();fireEvent.change(screen.getByRole('textbox',{name:'发送给智能体'}),{target:{value:'请生成流程'}});expect((screen.getByRole('button',{name:'发送消息'}) as HTMLButtonElement).disabled).toBe(true);expect(commands()).toHaveLength(0);});
  it('opens model settings directly from the model area when an administrator has no configured model',async()=>{mocks.configured=false;mocks.savedOnly=false;storage.clear();setup();const button=await screen.findByRole('button',{name:'配置模型'});fireEvent.click(button);expect(await screen.findByRole('dialog',{name:/模型服务/})).toBeTruthy();});
  it('keeps a saved but unverified model out of generation and sends the administrator to verification',async()=>{mocks.configured=false;mocks.savedOnly=true;storage.clear();setup();expect(await screen.findByRole('button',{name:'验证模型'})).toBeTruthy();expect(await screen.findByText(/尚未通过实际调用验证/)).toBeTruthy();fireEvent.change(screen.getByRole('textbox',{name:'发送给智能体'}),{target:{value:'不能发送'}});expect((screen.getByRole('button',{name:'发送消息'}) as HTMLButtonElement).disabled).toBe(true);});
  it('shows workspace models before a conversation exists and applies the chosen default before the first prompt',async()=>{storage.clear();setup();const model=await screen.findByRole('combobox',{name:'模型'});await waitFor(()=>expect((model as HTMLInputElement).value).toBe('合成模型'));expect((model as HTMLInputElement).disabled).toBe(false);const input=screen.getByRole('textbox',{name:'发送给智能体'});fireEvent.change(input,{target:{value:'第一条真实问题'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await waitFor(()=>expect(commands().map(item=>item.command.type)).toEqual(['set_model','prompt']));expect(commands()[0].command).toMatchObject({type:'set_model',provider:'fixture',modelId:'fixture-model'});expect(commands()[0].sessionId).toBe(commands()[1].sessionId);});
  it('keeps native extension commands available without a model',async()=>{mocks.configured=false;mocks.views[first].models=[];mocks.views[first].state.model=undefined;await ready();fireEvent.change(screen.getByRole('textbox',{name:'发送给智能体'}),{target:{value:'/tools-workspace'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await waitFor(()=>expect(commands()[0]?.command.message).toBe('/tools-workspace'));});
  it('creates an owned conversation even before a model has been configured',async()=>{mocks.configured=false;storage.clear();setup();await screen.findByText(/尚未配置实际模型/);fireEvent.click(screen.getByRole('button',{name:'新对话'}));await waitFor(()=>expect(mocks.post.mock.calls.find(([route])=>route.endsWith('/create'))?.[1].pageIds).toEqual([pageId]));});
  it('permission or connection failure removes the previous private transcript',async()=>{await ready();const original=mocks.post.getMockImplementation()!;mocks.post.mockImplementation((route,...args)=>route.endsWith('/view')?Promise.reject({response:{data:{message:'PI_SOURCE_VERSION_UNAVAILABLE'}}}):original(route,...args));fireEvent.click(screen.getByRole('button',{name:'刷新会话'}));await screen.findByText(/某份来源版本已不可访问/);expect(screen.queryByText('已保存的合成对话')).toBeNull();});
  it('a delayed conversation creation cannot update browser selection after unmount',async()=>{storage.clear();let resolve!:(value:unknown)=>void;const original=mocks.post.getMockImplementation()!;mocks.post.mockImplementation((route,...args)=>route.endsWith('/create')?new Promise(done=>resolve=done):original(route,...args));const rendered=setup();await waitFor(()=>expect((screen.getByRole('button',{name:'新对话'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'新对话'}));await waitFor(()=>expect(resolve).toBeTypeOf('function'));rendered.unmount();await act(async()=>resolve({data:{id:second}}));expect(storage.get(selectedConversationKey(workspaceId,userId))).toBeUndefined();});
});
it('renders source HTML as text while preserving headings, lists and code',()=>{const result=render(<PiTranscript messages={[{role:'assistant',content:[{type:'text',text:'## 标题\n\n**重点**\n\n- 检查一步\n\n<img src=x onerror=alert(1)>\n\n```\n安全代码文本\n```'}]}]} partial={null}/>);expect(result.container.querySelector('img')).toBeNull();expect(screen.getByRole('heading',{name:'标题'})).toBeTruthy();expect(result.container.querySelector('strong')?.textContent).toBe('重点');expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();});
it('does not mistake agent_end for a fully settled run',()=>{const started=applyPiRecord(emptyPiState(),{type:'agent_start'},1);expect(applyPiRecord(started,{type:'agent_end'},2).busy).toBe(true);expect(applyPiRecord(started,{type:'agent_settled'},3).busy).toBe(false);});
it('ignores replayed events from an older cursor',()=>{const state=applyPiRecord(emptyPiState(),{type:'agent_settled'},5);expect(applyPiRecord(state,{type:'agent_start'},4)).toBe(state);});
