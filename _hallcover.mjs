import { spawn } from "node:child_process";
import fs from "node:fs"; import net from "node:net"; import os from "node:os"; import path from "node:path";
const APP = fs.readFileSync("E:/DSHdesktop/work/music-player/.port","utf8").trim();
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const srv=net.createServer(); await new Promise(r=>srv.listen(0,"127.0.0.1",r));
const CDP=srv.address().port; await new Promise(r=>srv.close(r));
const PROFILE=path.join(os.tmpdir(),"lg-h2-"+Date.now());
const ch=spawn(CHROME,["--headless=new","--no-sandbox","--no-first-run","--user-data-dir="+PROFILE,"--remote-debugging-port="+CDP,"--hide-scrollbars","about:blank"],{stdio:"ignore"});
for(let i=0;i<40;i++){try{await(await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();break}catch{await sleep(300)}}
const tab=await(await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`,{method:"PUT"})).json();
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});
let id=0;const pend=new Map();const errs=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);p.resolve(m.result)}if(m.method==="Runtime.exceptionThrown"){const d=m.params.exceptionDetails||{};errs.push(((d.exception&&d.exception.description)||d.text||"").split("\n")[0].slice(0,200))}};
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,{resolve:res});ws.send(JSON.stringify({id:i,method:m,params:p}))});
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return "EXC:"+((r.exceptionDetails.exception||{}).description||"").split("\n")[0];return r.result.value};
await send("Page.enable");await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:1192,height:910,deviceScaleFactor:1,mobile:false});
await send("Page.navigate",{url:`http://127.0.0.1:${APP}/`});
await sleep(3000);
// 从歌单里拿一张真封面，写进上一首
const cover = await ev(`(async () => { const d = await API.topPlaylists(2); return d.playlists[0].cover; })()`);
console.log("真封面:", String(cover).slice(0,60));
await ev(`localStorage.setItem('lizi.hall.lastTrack', JSON.stringify({id:1901371647,name:'宝船',artists:'二手玫瑰 / 乐队的夏天',cover:${JSON.stringify(cover)},duration:252000,at:Date.now()-1000*60*47})); location.reload(); 1`);
await sleep(3500);
console.log("hero 封面已应用:", await ev(`document.getElementById('hall-hero-art')?.classList.contains('is-on')`));
console.log("hero 背景图:", (await ev(`document.getElementById('hall-hero-art')?.style.backgroundImage`))?.slice(0,70));
const png=await send("Page.captureScreenshot",{format:"png"});
fs.writeFileSync("shots/review/hall-5-cover.png",Buffer.from(png.data,"base64"));
console.log("→ shots/review/hall-5-cover.png");
console.log("异常:", errs.length?errs.slice(0,3).join(" ; "):"无");
ws.close();ch.kill();await sleep(200);
try{fs.rmSync(PROFILE,{recursive:true,force:true,maxRetries:5})}catch{}
