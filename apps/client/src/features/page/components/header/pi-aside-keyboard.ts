type PanelKeyEvent={key:string;defaultPrevented:boolean;target:EventTarget|null;currentTarget:HTMLElement};

export function shouldClosePiAside(event:PanelKeyEvent):boolean{
  if(event.key!=='Escape'||event.defaultPrevented)return false;
  const target=event.target;
  // React portals bubble through their logical parent even when the menu or
  // dialog lives outside the aside. Escape belongs to that inner popup first.
  if(!(target instanceof Node)||!event.currentTarget.contains(target))return false;
  const element=target instanceof Element?target:target.parentElement;
  if(element?.closest('[aria-expanded="true"]'))return false;
  return true;
}
