import { spawn } from "node:child_process";
import fs from "node:fs"; import net from "node:net"; import os from "node:os"; import path from "node:path";
const APP=fs.readFileSync("E:/DSHdesktop/work/music-player/.port","utf8").trim();
const CHROME="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const srv=net.createServer();await new Promise(r=>srv.listen(0,"127.0.0.1",r));
const CDP=srv.address().port;await new Promise(r=>srv.close(r));
const PROFILE=path.join(os.tmpdir(),"lg-h3-"+Date.now());
const ch=spawn(CHROME,["--headless=new","--no-sandbox","--no-first-run","--user-data-dir="+PROFILE,"--remote-debugging-port="+CDP,"--hide-scrollbars","--mute-audio","--autoplay-policy=no-user-gesture-required","about:blank"],{stdio:"ignore"});
for(let i=0;i<40;i++){try{await(await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();break}catch{await sleep(300)}}
const tab=await(await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`,{method:"PUT"})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
let id=0;const pend=new Map();const errs=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);p.resolve(m.result)}if(m.method==="Runtime.exceptionThrown"){const d=m.params.exceptionDetails||{};errs.push(((d.exception&&d.exception.description)||d.text||"").split("\n")[0].slice(0,160))}};
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,{resolve:res});ws.send(JSON.stringify({id:i,method:m,params:p}))});
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return "EXC:"+((r.exceptionDetails.exception||{}).description||"").split("\n")[0];return r.result.value};
await send("Page.enable");await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:1192,height:910,deviceScaleFactor:1,mobile:false});
await send("Page.navigate",{url:`http://127.0.0.1:${APP}/`});
await sleep(3200);
await ev(`localStorage.removeItem('lizi.hall.lastTrack'); 1`);
console.log("清空后 hero:", await ev(`document.getElementById('hall-hero-title')?.textContent`));
console.log("清空后 播放键隐藏:", await ev(`document.getElementById('hall-hero-play')?.hidden`));
// 播一首，验证 trackchange 会写进 hero
const played = await ev(`(async () => { const d = await API.search('草东', 3); Player.playQueue(d.tracks, 0, false); return d.tracks[0].name; })()`);
await sleep(1500);
console.log("播放:", played);
console.log("hero 标题变成:", await ev(`document.getElementById('hall-hero-title')?.textContent`));
console.log("hero 副题:", await ev(`document.getElementById('hall-hero-sub')?.textContent`));
console.log("localStorage:", (await ev(`localStorage.getItem('lizi.hall.lastTrack')`))?.slice(0,120));
console.log("播放键已显示:", await ev(`!document.getElementById('hall-hero-play')?.hidden`));
console.log("异常:", errs.length?errs.slice(0,3).join(" ; "):"无");
ws.close();ch.kill();await sleep(200);
try{fs.rmSync(PROFILE,{recursive:true,force:true,maxRetries:5})}catch{}
