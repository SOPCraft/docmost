import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { asideBounds, clampAsideWidth, widthAfterKey, ASIDE_WIDTH_KEY } from './aside-size';
import { useResizableAside } from './use-resizable-aside';
const storage = new Map<string, string>(), writes = vi.fn();
function Harness({enabled = true}:{enabled?:boolean}) { const panel = useResizableAside(300, enabled); return <><output data-testid="width">{panel.width}</output><div {...panel.handleProps}/></>; }
beforeEach(() => {
 storage.clear(); writes.mockReset(); document.body.style.cursor='';document.body.style.userSelect='';
 vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>{storage.set(key,value);writes(key,value);}});
 Object.defineProperty(window,'innerWidth',{configurable:true,value:1440});
 vi.stubGlobal('PointerEvent',class extends MouseEvent { pointerId:number; constructor(type:string,options:any){super(type,options);this.pointerId=options?.pointerId||1;} });
 HTMLElement.prototype.setPointerCapture=vi.fn(); HTMLElement.prototype.hasPointerCapture=vi.fn(()=>false); HTMLElement.prototype.releasePointerCapture=vi.fn();
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('native aside bounds',()=>{
 it('reserves editor width and never grows beyond the desktop maximum',()=>{expect(asideBounds(1440,300)).toEqual({min:320,max:720});expect(asideBounds(1024,300)).toEqual({min:320,max:364});});
 it('rejects invalid persisted widths and bounds valid numeric strings',()=>{expect(clampAsideWidth('bad',1440,300)).toBe(420);expect(clampAsideWidth('500',1440,300)).toBe(500);expect(clampAsideWidth(-50,1440,300)).toBe(320);expect(clampAsideWidth(9999,1440,300)).toBe(720);});
 it('left arrow widens the right-anchored panel, with accessible limits',()=>{expect(widthAfterKey('ArrowLeft',420,1440,300)).toBe(436);expect(widthAfterKey('ArrowRight',420,1440,300,true)).toBe(372);expect(widthAfterKey('Home',420,1440,300)).toBe(320);expect(widthAfterKey('End',420,1440,300)).toBe(720);expect(widthAfterKey('Enter',420,1440,300)).toBeNull();});
});
describe('native aside resize input',()=>{
 it('dragging left widens immediately and persists only at release',()=>{render(<Harness/>);const handle=screen.getByRole('separator');fireEvent.pointerDown(handle,{clientX:1020,button:0,pointerId:1});fireEvent.pointerMove(handle,{clientX:900,pointerId:1});expect(screen.getByTestId('width').textContent).toBe('540');expect(writes).not.toHaveBeenCalled();fireEvent.pointerUp(handle,{pointerId:1});expect(storage.get(ASIDE_WIDTH_KEY)).toBe('540');expect(document.body.style.cursor).toBe('');});
 it('Escape cancels an in-progress drag without persisting it',()=>{render(<Harness/>);const handle=screen.getByRole('separator');fireEvent.pointerDown(handle,{clientX:1000,pointerId:1});fireEvent.pointerMove(handle,{clientX:700,pointerId:1});fireEvent.keyDown(window,{key:'Escape'});expect(screen.getByTestId('width').textContent).toBe('420');expect(writes).not.toHaveBeenCalled();expect(document.body.style.userSelect).toBe('');});
 it('losing focus or pointer capture restores document interaction',()=>{render(<Harness/>);const handle=screen.getByRole('separator');fireEvent.pointerDown(handle,{clientX:1000,pointerId:1});fireEvent.blur(window);expect(document.body.style.cursor).toBe('');fireEvent.pointerDown(handle,{clientX:1000,pointerId:1});fireEvent.lostPointerCapture(handle);expect(document.body.style.userSelect).toBe('');});
 it('supports keyboard sizing and double-click reset',()=>{render(<Harness/>);const handle=screen.getByRole('separator');fireEvent.keyDown(handle,{key:'End'});expect(handle.getAttribute('aria-valuenow')).toBe('720');fireEvent.doubleClick(handle);expect(storage.get(ASIDE_WIDTH_KEY)).toBe('420');});
 it('restores the preferred width after a remount',()=>{storage.set(ASIDE_WIDTH_KEY,'512');render(<Harness/>);expect(screen.getByTestId('width').textContent).toBe('512');});
 it('clamps width when the viewport shrinks without overwriting the preference',()=>{storage.set(ASIDE_WIDTH_KEY,'600');render(<Harness/>);Object.defineProperty(window,'innerWidth',{configurable:true,value:1024});fireEvent(window,new Event('resize'));expect(screen.getByTestId('width').textContent).toBe('364');expect(storage.get(ASIDE_WIDTH_KEY)).toBe('600');});
 it('disables resize on mobile and on closed panels',()=>{Object.defineProperty(window,'innerWidth',{configurable:true,value:390});render(<Harness/>);const handle=screen.getByRole('separator');expect(handle.tabIndex).toBe(-1);fireEvent.pointerDown(handle,{clientX:200,pointerId:1});fireEvent.pointerMove(handle,{clientX:10,pointerId:1});expect(writes).not.toHaveBeenCalled();});
 it('unmount cleans up the temporary body cursor',()=>{const view=render(<Harness/>);fireEvent.pointerDown(screen.getByRole('separator'),{clientX:1000,pointerId:1});view.unmount();expect(document.body.style.cursor).toBe('');});
});
