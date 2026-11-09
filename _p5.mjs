import { spawn } from 'node:child_process';
import fs from 'node:fs'; import net from 'node:net'; import os from 'node:os'; import path from 'node:path';
const ROOT='E:/DSHdesktop/work/music-player';const APP=fs.readFileSync(ROOT+'/.port','utf8').trim();
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const srv=net.createServer();await new Promise(r=>srv.listen(0,'127.0.0.1',r));const CDP=srv.address().port;await new Promise(r=>srv.close(r));
const P=path.join(os.tmpdir(),'p5b-'+Date.now());
const ch=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--mute-audio','--user-data-dir='+P,'--remote-debugging-port='+CDP,'--hide-scrollbars','--window-size=1440,810','about:blank'],{stdio:'ignore'});
for(let i=0;i<60;i++){try{await(await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();break}catch{await sleep(300)}}
const tab=await(await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`,{method:'PUT'})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
let id=0;const pend=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);p.resolve(m.result)}};
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,{resolve:res});ws.send(JSON.stringify({id:i,method:m,params:p}))});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r.exceptionDetails?'EXC:'+((r.exceptionDetails.exception||{}).description||'').slice(0,300):r.result.value};
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:810,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:`http://127.0.0.1:${APP}/stages/lizi05-ferrofluid.html`});
await sleep(1200);
await ev(`(()=>{const texts=['当自我磨平了轮廓','才看清里面的光','直到夜色把一切收走把所有的路都还给沉默的远方'];const lines=[];for(let i=0;i<30;i++){const text=texts[i%texts.length];const chars=[];let acc=0;for(let k=0;k<text.length;k++){chars.push({t:+(i*2.4+acc).toFixed(3),d:0.2,c:text[k]});acc+=0.2}lines.push({t:i*2.4,dur:2.4,text,chars})}
window.postMessage({__c100:1,type:'init',payload:{lines,accent:[180,170,255]}},'*');window.__T=0;if(window.__tk)clearInterval(window.__tk);
window.__tk=setInterval(()=>{window.__T+=0.066;window.postMessage({__c100:1,type:'tick',payload:{time:window.__T,playing:true}},'*')},66);return 1})()`);
for (const wait of [2500, 3000, 3000]) {
  await sleep(wait);
  console.log(JSON.stringify(await ev('window.__dbg?window.__dbg():null')));
}
ws.close();ch.kill();await sleep(200);try{fs.rmSync(P,{recursive:true,force:true,maxRetries:5})}catch{}
