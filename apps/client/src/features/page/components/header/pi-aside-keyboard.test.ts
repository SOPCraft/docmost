// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {shouldClosePiAside} from './pi-aside-keyboard';
function setup(){const panel=document.createElement('aside'),input=document.createElement('textarea');panel.append(input);return {panel,input,event:{key:'Escape',defaultPrevented:false,target:input,currentTarget:panel}};}
describe('native Pi aside Escape routing',()=>{
  it('closes the aside from its ordinary message input',()=>{const {event}=setup();expect(shouldClosePiAside(event)).toBe(true);});
  it('closes a directly focused aside',()=>{const {event,panel}=setup();expect(shouldClosePiAside({...event,target:panel})).toBe(true);});
  it('does not close the aside when Escape comes from a menu portal',()=>{const {event}=setup(),menu=document.createElement('button');expect(shouldClosePiAside({...event,target:menu})).toBe(false);});
  it('allows an expanded model selector to handle Escape first',()=>{const {event,input}=setup();input.setAttribute('aria-expanded','true');expect(shouldClosePiAside(event)).toBe(false);});
  it('does not re-handle an Escape event consumed by a nested control',()=>{const {event}=setup();expect(shouldClosePiAside({...event,defaultPrevented:true})).toBe(false);});
  it('does not close the panel for another key or missing target',()=>{const {event}=setup();expect(shouldClosePiAside({...event,key:'Enter'})).toBe(false);expect(shouldClosePiAside({...event,target:null})).toBe(false);});
});
