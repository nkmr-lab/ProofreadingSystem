// debugOverlay.js
let debugEnabled = false; // 本番は false にする/URLパラメータで切替でもOK
let box, pre;

export function setDebugEnabled(v){ debugEnabled = !!v; }

export function dbg(...args){
  if(!debugEnabled) return;
  try{
    if(!box){
      box = document.createElement('div');
      box.style.cssText = `
        position:fixed; right:8px; bottom:8px; z-index:99999;
        width:min(92vw,420px); height:38vh; background:rgba(0,0,0,.78);
        color:#fff; font:12px/1.3 monospace; border-radius:10px;
        padding:8px; box-shadow:0 8px 24px rgba(0,0,0,.35);
        display:flex; flex-direction:column; gap:6px;`;
      const row = document.createElement('div');
      row.style.cssText = `display:flex; gap:6px; justify-content:flex-end;`;
      const btnCopy = document.createElement('button');
      btnCopy.textContent = 'Copy';
      btnCopy.style.cssText = `font-size:12px; padding:4px 8px; border-radius:8px;`;
      btnCopy.onclick = async ()=>{
        try{
          await navigator.clipboard.writeText(pre.textContent || '');
          btnCopy.textContent = 'Copied!';
          setTimeout(()=>btnCopy.textContent='Copy', 900);
        }catch(e){
          alert('Copy failed: ' + (e?.message||e));
        }
      };
      const btnHide = document.createElement('button');
      btnHide.textContent = 'Hide';
      btnHide.style.cssText = `font-size:12px; padding:4px 8px; border-radius:8px;`;
      btnHide.onclick = ()=>{ box.remove(); box=null; pre=null; };
      row.append(btnCopy, btnHide);

      pre = document.createElement('pre');
      pre.style.cssText = `margin:0; overflow:auto; white-space:pre-wrap; word-break:break-word; flex:1;`;

      box.append(row, pre);
      document.body.appendChild(box);
    }
    const s = args.map(a=>{
      if(a instanceof Error) return `Error(${a.message})`;
      if(typeof a === 'object') { try{return JSON.stringify(a);}catch{return String(a);} }
      return String(a);
    }).join(' ');
    pre.textContent += `[${new Date().toLocaleTimeString()}] ${s}\n`;
    pre.scrollTop = pre.scrollHeight;
  }catch{}
}
