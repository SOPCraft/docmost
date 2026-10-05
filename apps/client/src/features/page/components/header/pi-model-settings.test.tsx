import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import PiModelSettings from './pi-model-settings-legacy';
import { editModel, groupProviders, modelErrors, newModel } from './pi-model-config';
import type { ModelSettings } from './pi-model-config';
const mocks=vi.hoisted(()=>({request:vi.fn(),onSaved:vi.fn(),onClose:vi.fn()}));
vi.mock('./pi-workbench-api',()=>({piRequest:mocks.request,piError:()=> '配置未保存，请检查后重试。'}));
const saved={provider:'internal',modelId:'model-one',label:'日常模型',api:'openai-completions',baseUrl:'https://example.invalid/v1',reasoning:false,contextWindow:65536,maxTokens:8192,input:['text'],configured:true};
let settings:ModelSettings;
function renderSettings(opened=true){return <MantineProvider env="test"><PiModelSettings opened={opened} onClose={mocks.onClose} onSaved={mocks.onSaved}/></MantineProvider>;}
async function ready(){render(renderSettings());await screen.findByText('日常模型');}
beforeEach(()=>{
 settings={revision:'10000000-0000-4000-8000-000000000001',models:[structuredClone(saved),{...saved,modelId:'model-two',label:'第二模型'}],allowLoopback:false};
 mocks.onSaved.mockReset();mocks.onClose.mockReset();mocks.request.mockReset().mockImplementation(async(route,body)=>{
  if(route==='model-settings')return structuredClone(settings);
  if(route==='save-model'){const {apiKey,...model}=body.model;settings={...settings,revision:'20000000-0000-4000-8000-000000000001',models:settings.models.filter(item=>!(item.provider===model.provider&&item.modelId===model.modelId))};if(!body.remove)settings.models.push({...model,configured:true});return structuredClone(settings);}
 });
 Object.defineProperty(document,'fonts',{configurable:true,value:new EventTarget()});Object.defineProperty(window,'matchMedia',{configurable:true,value:vi.fn().mockImplementation(()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}}))});vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('provider-oriented model settings',()=>{
 it('discarding dirty connection values really restores them even if the next action is cancelled',async()=>{
  await ready();fireEvent.change(screen.getByLabelText('服务地址'),{target:{value:'https://unsaved.invalid/v1'}});
  fireEvent.change(screen.getByLabelText('访问密钥'),{target:{value:'synthetic-unsaved-secret'}});
  fireEvent.click(screen.getByRole('button',{name:'移除模型 model-one'}));fireEvent.click(screen.getByRole('button',{name:'放弃修改'}));
  const dialog=screen.getByRole('dialog',{name:'移除这个模型？'});fireEvent.click(within(dialog).getByRole('button',{name:'取消'}));
  expect((screen.getByLabelText('服务地址') as HTMLInputElement).value).toBe(saved.baseUrl);
  expect((screen.getByLabelText('访问密钥') as HTMLInputElement).value).toBe('');
  expect(mocks.request.mock.calls.some(([route])=>route==='save-model')).toBe(false);
 });
 it('reopening after a pending save cannot leave the fresh settings permanently busy',async()=>{
  const rendered=render(renderSettings());await screen.findByText('日常模型');
  let finish!:(value:unknown)=>void;mocks.request.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
  fireEvent.change(screen.getByLabelText('服务地址'),{target:{value:'https://pending.invalid/v1'}});fireEvent.click(screen.getByRole('button',{name:'保存连接'}));
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  rendered.rerender(renderSettings(false));rendered.rerender(renderSettings(true));await screen.findByText('日常模型');
  expect((screen.getByRole('button',{name:'添加服务商'}) as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>finish({...settings,models:[{...saved,label:'late-old-save'}]}));
  expect(screen.queryByText('late-old-save')).toBeNull();expect(mocks.onSaved).not.toHaveBeenCalled();
 });
 it('locks editable controls while explicitly reloading configuration instead of discarding newly typed edits',async()=>{
  await ready();mocks.request.mockRejectedValueOnce(new Error('failure'));
  fireEvent.change(screen.getByLabelText('服务地址'),{target:{value:'https://unsaved.invalid/v1'}});fireEvent.click(screen.getByRole('button',{name:'保存连接'}));await screen.findByText('配置未保存，请检查后重试。');
  let finish!:(value:unknown)=>void;mocks.request.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
  fireEvent.click(screen.getByRole('button',{name:'重新读取配置'}));fireEvent.click(screen.getByRole('button',{name:'放弃修改'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
  expect((screen.getByLabelText('服务地址').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  await act(async()=>finish(settings));await screen.findByText('日常模型');
  expect((screen.getByLabelText('服务地址').closest('fieldset') as HTMLFieldSetElement).disabled).toBe(false);
 });

 it('groups models under one service and keeps advanced fields out of the main list',async()=>{await ready();expect(screen.getByRole('navigation',{name:'模型服务商'})).toBeTruthy();expect(screen.getByRole('region',{name:'服务商模型列表'})).toBeTruthy();expect(screen.getByText('第二模型')).toBeTruthy();expect(screen.queryByLabelText('上下文上限')).toBeNull();expect((screen.getByLabelText('访问密钥') as HTMLInputElement).value).toBe('');});
 it('adds a model to an existing service without requesting or exposing the stored credential',async()=>{await ready();fireEvent.click(screen.getByRole('button',{name:'添加模型'}));fireEvent.change(screen.getByLabelText('模型编号'),{target:{value:'new-model'}});fireEvent.change(screen.getByLabelText('显示名称'),{target:{value:'新增模型'}});fireEvent.click(screen.getByRole('button',{name:'保存模型'}));await waitFor(()=>expect(mocks.onSaved).toHaveBeenCalledTimes(1));const body=mocks.request.mock.calls.find(([route])=>route==='save-model')?.[1];expect(body.model.apiKey).toBe('');expect(body.model.provider).toBe('internal');expect(body.model.baseUrl).toBe(saved.baseUrl);expect(body.revision).toBe('10000000-0000-4000-8000-000000000001');expect(body.model.configured).toBeUndefined();});
 it('rejects duplicate model identifiers before sending any write',async()=>{await ready();fireEvent.click(screen.getByRole('button',{name:'添加模型'}));fireEvent.change(screen.getByLabelText('模型编号'),{target:{value:'model-one'}});fireEvent.click(screen.getByRole('button',{name:'保存模型'}));await screen.findByText(/这个模型已经存在/);expect(mocks.request.mock.calls.some(([route])=>route==='save-model')).toBe(false);});
 it('opens advanced model parameters only when requested and preserves existing fields',async()=>{await ready();fireEvent.click(screen.getByRole('button',{name:'编辑模型 model-one'}));expect((screen.getByLabelText('模型编号') as HTMLInputElement).readOnly).toBe(true);fireEvent.click(screen.getByRole('button',{name:'高级参数'}));expect(screen.getByLabelText('上下文上限')).toBeTruthy();fireEvent.change(screen.getByLabelText('显示名称'),{target:{value:'改名后'}});fireEvent.click(screen.getByRole('button',{name:'保存模型'}));await waitFor(()=>expect(mocks.onSaved).toHaveBeenCalled());const body=mocks.request.mock.calls.find(([route])=>route==='save-model')?.[1];expect(body.model.contextWindow).toBe(65536);expect(body.model.maxTokens).toBe(8192);expect(body.model.modelId).toBe('model-one');});
 it('asks before discarding unsaved connection settings',async()=>{await ready();fireEvent.change(screen.getByLabelText('服务地址'),{target:{value:'https://new.invalid/v1'}});fireEvent.click(screen.getByRole('button',{name:'关闭模型设置'}));expect(screen.getByRole('dialog',{name:'放弃未保存的修改？'})).toBeTruthy();expect(mocks.onClose).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'继续编辑'}));expect((screen.getByLabelText('服务地址') as HTMLInputElement).value).toBe('https://new.invalid/v1');});
 it('confirms model removal without touching another model or history',async()=>{await ready();fireEvent.click(screen.getByRole('button',{name:'移除模型 model-one'}));expect(mocks.request.mock.calls.some(([route])=>route==='save-model')).toBe(false);fireEvent.click(screen.getByRole('button',{name:'确认移除'}));await waitFor(()=>expect(mocks.onSaved).toHaveBeenCalled());expect(settings.models.map(item=>item.modelId)).toEqual(['model-two']);expect(mocks.request.mock.calls.find(([route])=>route==='save-model')?.[1].remove).toBe(true);});
 it('does not present a failed save as configured success',async()=>{await ready();mocks.request.mockRejectedValueOnce(new Error('failure'));fireEvent.change(screen.getByLabelText('服务地址'),{target:{value:'https://new.invalid/v1'}});fireEvent.click(screen.getByRole('button',{name:'保存连接'}));await screen.findByText('配置未保存，请检查后重试。');expect(mocks.onSaved).not.toHaveBeenCalled();expect((screen.getByLabelText('服务地址') as HTMLInputElement).value).toBe('https://new.invalid/v1');});
 it('requires credentials for the first model and never silently creates placeholder models',async()=>{settings.models=[];render(renderSettings());await screen.findByText('连接你的模型服务');fireEvent.click(screen.getByRole('button',{name:'添加服务商'}));fireEvent.change(screen.getByLabelText('服务地址'),{target:{value:'https://example.invalid/v1'}});fireEvent.click(screen.getByRole('button',{name:'保存并添加模型'}));expect(screen.getByText('首次连接此服务商需要填写访问密钥。')).toBeTruthy();expect(mocks.request.mock.calls.some(([route])=>route==='save-model')).toBe(false);});
 it('ignores a configuration read that arrives after closing the settings window',async()=>{let done!:(value:unknown)=>void;mocks.request.mockImplementation(()=>new Promise(resolve=>done=resolve));const view=render(renderSettings());await waitFor(()=>expect(done).toBeTypeOf('function'));view.rerender(renderSettings(false));await act(async()=>done(settings));expect(screen.queryByText('日常模型')).toBeNull();});
});
it('provider grouping preserves the existing models and never mutates the input',()=>{const input=[{...saved},{...saved,modelId:'second'},{...saved,provider:'other'}];expect(groupProviders(input).map(group=>group.models.length)).toEqual([2,1]);expect(input.length).toBe(3);});
it('form conversion retains custom compatibility while omitting response-only fields',()=>{const form=editModel({...saved,compat:{supportsStore:false}});expect(form.compat).toEqual({supportsStore:false});expect('configured' in form).toBe(false);expect(form.apiKey).toBe('');});
it('validation distinguishes saved provider keys from first-time credentials',()=>{const form={...newModel('internal'),modelId:'another',baseUrl:saved.baseUrl};expect(modelErrors(form,settings,false)).toEqual({});expect(modelErrors({...form,provider:'other'},settings,false).apiKey).toBeTruthy();});
