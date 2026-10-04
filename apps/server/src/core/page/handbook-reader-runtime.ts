// No automatic navigation: a newer result is offered without interrupting scroll or playback.
export const handbookReaderRuntime=String.raw`(()=>{
 'use strict';const pageId=document.documentElement.dataset.managedHandbook,jobId=document.documentElement.dataset.handbookJob;
 const bar=document.getElementById('handbook-live-notice'),label=bar?.querySelector('span'),link=document.getElementById('handbook-new-version');
 if(!pageId||!bar)return;let stopped=false,timer;
 function deny(message){stopped=true;clearTimeout(timer);document.querySelectorAll('video').forEach(v=>{v.pause();v.removeAttribute('src');v.load();});
  document.querySelectorAll('main,.page-grid,.topbar,.mobile-nav,dialog').forEach(n=>n.remove());label.textContent=message;link.hidden=true;bar.setAttribute('role','alert');}
 async function check(){try{const r=await fetch('/api/pages/handbook/status',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({pageId,jobId}),signal:AbortSignal.timeout(12000)});
  if(!r.ok){deny([401,403,404].includes(r.status)?'登录或原稿访问权限已失效，已停止展示。':'当前无法核验原稿权限，已暂停展示；重新打开后重试。');return;}
  const s=(await r.json()).data;if(!s?.enabled||!s.configured||!s.assetsAccessible){deny('原稿或原素材已不可访问，已停止展示。');return;}
  if(s.current&&s.current.jobId!==jobId){label.textContent='已有更新结果。本页仍为固定旧版，不作为最新执行依据；切换由你决定。';link.href=s.current.url;link.textContent='打开新版';link.hidden=false;}
  else if(s.outdated||s.state==='failed'){label.textContent='原稿已变更或更新失败。本页已过期，不作为最新执行依据；请回原稿核对。';link.hidden=true;}
  else{label.textContent='固定版本阅读 · 当前访问权限有效'+(s.state==='queued'||s.state==='running'?' · 正在生成更新':'');link.hidden=true;}
 }catch{deny('无法核验原稿权限，已暂停展示；重新打开后重试。');}
 if(!stopped)timer=setTimeout(check,5000);}
 window.addEventListener('pageshow',e=>{if(e.persisted){clearTimeout(timer);check();}});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!stopped){clearTimeout(timer);check();}});check();
})();`;
