/* Radar Live V12.3: temporary rooms, server sends only presenter-approved slide details and video captions. */
const TTL=14400000;
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"authorization,content-type","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const reply=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"content-type":"application/json;charset=utf-8"}});
const rand=n=>Array.from(crypto.getRandomValues(new Uint8Array(n)),x=>x.toString(16).padStart(2,"0")).join("");
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,"0")).join("");
async function same(a,b){if(!a||!b)return false;const [x,y]=await Promise.all([digest(a),digest(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0}
export default {
 async fetch(req,env){
  const u=new URL(req.url);
  if(req.method==="OPTIONS")return new Response(null,{headers:cors});
  if(u.pathname==="/health")return reply({ok:true,name:"radar-live",content:"not hosted"});
  if(u.pathname==="/join"&&req.method==="GET")return new Response(AUDIENCE,{headers:{...cors,"content-type":"text/html;charset=utf-8","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https: wss:; img-src data:"}});
  if(u.pathname==="/api/session"&&req.method==="POST"){
    // tolerate copy/paste noise in the dashboard secret: surrounding spaces, line breaks, quotes or a trailing comma
    const hostKey=String(env.RADAR_LIVE_HOST_KEY||"").trim().replace(/^["']+|["',;\s]+$/g,"");
    if(hostKey.length<24)return reply({error:"Host key not configured"},503);
    if(!await same((req.headers.get("authorization")||"").replace(/^Bearer /i,"").trim(),hostKey))return reply({error:"Not authorized"},403);
    const room=crypto.randomUUID(),viewer=rand(24),host=rand(24);
    const obj=env.RADAR_ROOMS.get(env.RADAR_ROOMS.idFromName(room));
    const initialized=await obj.fetch(new Request("https://internal.radar/init",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({viewerHash:await digest(viewer),hostHash:await digest(host),expires:Date.now()+TTL})}));
    if(!initialized.ok)return reply({error:"Unable to create room"},500);
    return reply({room,hostToken:host,viewerUrl:u.origin+"/join?room="+room+"#"+viewer,expiresInSeconds:TTL/1000});
  }
  if(u.pathname==="/socket"&&req.method==="GET"){
    const room=u.searchParams.get("room");if(!room||!/^[0-9a-f-]{36}$/.test(room))return reply({error:"Invalid room"},400);
    return env.RADAR_ROOMS.get(env.RADAR_ROOMS.idFromName(room)).fetch(req);
  }
  return reply({error:"Not found"},404);
 }
};
export class RadarRoom {
 constructor(state){this.state=state}
 async fetch(req){
  const u=new URL(req.url);
  if(u.pathname==="/init"&&req.method==="POST"){
    if(await this.state.storage.get("config"))return new Response("exists",{status:409});
    const data=await req.json();await this.state.storage.put("config",data);await this.state.storage.setAlarm(data.expires);return new Response("ok");
  }
  if(u.pathname!=="/socket"||req.headers.get("upgrade")?.toLowerCase()!=="websocket")return new Response("websocket required",{status:400});
  const config=await this.state.storage.get("config");if(!config||Date.now()>config.expires)return new Response("expired",{status:410});
  const role=u.searchParams.get("role");
  if(!["host","viewer"].includes(role))return new Response("role required",{status:403});
  const token=(req.headers.get("sec-websocket-protocol")||"").split(",").map(x=>x.trim()).find(x=>x.startsWith("token-"))?.slice(6);
  if(!token||!await same(await digest(token),role==="host"?config.hostHash:config.viewerHash))return new Response("unauthorized",{status:403});
  const pair=new WebSocketPair(),server=pair[1];this.state.acceptWebSocket(server);server.serializeAttachment({role});
  const current=await this.state.storage.get("current");
  server.send(JSON.stringify(current?{type:"slide",slide:current}:{type:"status",status:"waiting"}));
  const caption=await this.state.storage.get("caption");if(caption&&caption.text)server.send(JSON.stringify({type:"caption",caption}));
  this.count();
  return new Response(null,{status:101,webSocket:pair[0],headers:{"sec-websocket-protocol":"radar-v1"}});
 }
 async webSocketMessage(ws,message){
  if(ws.deserializeAttachment()?.role!=="host")return;
  let data;try{data=JSON.parse(message)}catch{return}
  if(data.type==="end"){for(const peer of this.state.getWebSockets())try{peer.close(1000,"session ended")}catch{}await this.state.storage.deleteAll();return}
  if(data.type==="caption"&&data.caption){
    // V12.3: live caption of the video playing on the projector (text + optional explanatory note)
    const c=data.caption;if(JSON.stringify(c).length>1200)return;
    const caption={text:String(c.text||"").slice(0,400),note:String(c.note||"").slice(0,300),slide:Number.isInteger(c.slide)?c.slide:-1,video:String(c.video||"").slice(0,80)};
    await this.state.storage.put("caption",caption);
    for(const peer of this.state.getWebSockets())if(peer!==ws)try{peer.send(JSON.stringify({type:"caption",caption}))}catch{}
    return;
  }
  if(data.type!=="slide"||!data.slide)return;
  const s=data.slide;
  if(!Number.isInteger(s.index)||s.index<0||s.index>17||typeof s.title!=="string"||!Array.isArray(s.points)||JSON.stringify(s).length>6000)return;
  const slide={index:s.index,total:Number.isInteger(s.total)&&s.total>=1&&s.total<=30?s.total:18,title:s.title.slice(0,130),eyebrow:String(s.eyebrow||"").slice(0,100),metric:String(s.metric||"").slice(0,100),points:s.points.slice(0,6).map(x=>String(x).slice(0,300)),footer:String(s.footer||"").slice(0,180)};
  await this.state.storage.put("current",slide);await this.state.storage.delete("caption");
  for(const peer of this.state.getWebSockets())if(peer!==ws)try{peer.send(JSON.stringify({type:"slide",slide}))}catch{}
  this.count();
 }
 webSocketClose(){this.count()}
 async alarm(){for(const peer of this.state.getWebSockets())try{peer.close(1000,"expired")}catch{}await this.state.storage.deleteAll()}
 count(){const peers=this.state.getWebSockets();const count=peers.filter(x=>x.deserializeAttachment()?.role==="viewer").length;for(const peer of peers)if(peer.deserializeAttachment()?.role==="host")try{peer.send(JSON.stringify({type:"viewers",count}))}catch{}}
}
const AUDIENCE=String.raw`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>Radar Live | Unimed</title><style>
:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#103a25;background:#f5f7ed}*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:#f5f7ed;color:#113923}header{padding:22px;background:#075430;color:white;position:relative;overflow:hidden}header:after{content:"";width:170px;height:170px;position:absolute;right:-80px;top:-100px;border:30px solid #b8ff523b;border-radius:100%;pointer-events:none}.top{display:flex;justify-content:space-between;align-items:center}.brand{font-size:11px;font-weight:800;letter-spacing:.14em;color:#beff6e}.led{font-size:11px;color:#def5e2}.led:before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:#b8ff52;box-shadow:0 0 10px #b8ff52;margin-right:8px}.tag{margin-top:28px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.8}h1{font-size:clamp(31px,9vw,55px);letter-spacing:-.055em;line-height:1.03;margin:12px 0 8px;overflow-wrap:break-word}.body{max-width:650px;margin:auto;padding:23px 20px 90px}.metric{font-size:clamp(48px,15vw,80px);font-weight:850;letter-spacing:-.08em;color:#0f7543;margin:10px 0}.cap{font-size:11px;letter-spacing:.16em;color:#317758;font-weight:800;margin:17px 0}.card{padding:19px;border:1px solid #dce9de;background:white;border-radius:14px;box-shadow:0 5px 20px #0e3c2214;margin:12px 0}.num{font:700 11px ui-monospace,monospace;color:#168351;margin-right:12px}.point{font-size:15px;line-height:1.5;display:inline}#footer{font-size:13px;line-height:1.5;color:#496355}.sticky{position:fixed;bottom:0;left:0;right:0;display:flex;justify-content:space-between;gap:8px;padding:13px 18px max(13px,env(safe-area-inset-bottom));background:#072e1d;color:#ddf7e1;font-size:11px}.hide{display:none}.tools{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.tools button{background:#d8f0df;color:#13492d;border:1px solid #8cc1a0;border-radius:9px;padding:10px 12px;font:700 13px system-ui;min-height:44px}.tools button:focus-visible{outline:3px solid #0b7747;outline-offset:2px}.large .point{font-size:20px}.large #footer{font-size:17px}.high-contrast{background:#fff;color:#000}.high-contrast .card{border:2px solid #000;box-shadow:none}.high-contrast .point{color:#000}.high-contrast #footer{color:#000} .captionbox{position:fixed;left:10px;right:10px;bottom:calc(52px + env(safe-area-inset-bottom));background:#062e1d;color:#fff;border:1px solid #2f7a52;border-radius:14px;padding:12px 15px 14px;box-shadow:0 10px 30px #0006;z-index:5}.caphead{display:flex;align-items:center;gap:8px;font:800 10px system-ui;letter-spacing:.14em;color:#b8ff52;margin-bottom:6px}.recdot{width:8px;height:8px;border-radius:50%;background:#ff8664;box-shadow:0 0 8px #ff8664;animation:blink 1.4s infinite}@keyframes blink{50%{opacity:.3}}#captionText{margin:0;font-size:19px;line-height:1.4;font-weight:600}.capnote{margin:8px 0 0;padding-top:8px;border-top:1px solid #2f7a52;font-size:14px;line-height:1.4;color:#d6f5e0}.large #captionText{font-size:24px}.large .capnote{font-size:17px}.high-contrast .captionbox{background:#000;border:2px solid #fff}.with-caption .body{padding-bottom:230px} @media(prefers-reduced-motion:reduce){*{animation:none!important}}</style></head><body><header><div class="top"><span class="brand">RADAR / UNIMED FESP</span><span class="led" id="status">Conectando…</span></div><div class="tag" id="eyebrow">RADAR LIVE</div><h1 id="title">Acompanhe a apresentação</h1></header><main class="body"><div class="metric hide" id="metric"></div><div class="tools" aria-label="Opções de acessibilidade"><button id="speak" type="button" aria-label="Ouvir a descrição do slide">▶ Ouvir slide</button><button id="stop" type="button">■ Parar áudio</button><button id="font" type="button" aria-pressed="false">A+ Texto</button><button id="contrast" type="button" aria-pressed="false">◑ Contraste</button></div><div class="cap">INFORMAÇÕES COMPLEMENTARES</div><div id="points"><div class="card"><p class="point">Os dados aparecerão quando o apresentador iniciar a sessão.</p></div></div><p id="footer">Mantenha esta página aberta para acompanhar os slides automaticamente.</p></main><section id="captionBox" class="captionbox hide" aria-live="polite"><div class="caphead"><span class="recdot"></span><span id="captionLabel">VÍDEO EM EXIBIÇÃO · LEGENDA</span></div><p id="captionText"></p><p id="captionNote" class="capnote hide"></p></section><div class="sticky"><span id="counter">AGUARDANDO</span><span>RADAR LIVE · INTEGRIDADE</span></div><script>
(()=>{const u=new URL(location.href),room=u.searchParams.get("room"),token=decodeURIComponent(location.hash.slice(1)),el=id=>document.getElementById(id);let last=null;el("speak").onclick=()=>{if(!last||!("speechSynthesis"in window))return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(last.title+". "+last.points.join(". "));u.lang="pt-BR";u.rate=.9;window.speechSynthesis.speak(u)};el("stop").onclick=()=>window.speechSynthesis?.cancel();el("font").onclick=()=>{const on=document.body.classList.toggle("large");el("font").setAttribute("aria-pressed",String(on))};el("contrast").onclick=()=>{const on=document.body.classList.toggle("high-contrast");el("contrast").setAttribute("aria-pressed",String(on))};if(!room||!token){el("status").textContent="Link inválido";return}let delay=800;function connect(){const url=new URL("/socket",location.origin);url.protocol=url.protocol==="https:"?"wss:":"ws:";url.searchParams.set("room",room);url.searchParams.set("role","viewer");const ws=new WebSocket(url.href,["radar-v1","token-"+token]);ws.onopen=()=>{delay=800;el("status").textContent="Sincronizado"};ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==="caption"){const c=m.caption||{},on=!!(c.text||c.note);el("captionBox").classList.toggle("hide",!on);document.body.classList.toggle("with-caption",on);el("captionText").textContent=c.text||"";el("captionNote").textContent=c.note?"ⓘ "+c.note:"";el("captionNote").classList.toggle("hide",!c.note);el("captionText").classList.toggle("hide",!c.text);return}if(m.type!=="slide")return;el("captionBox").classList.add("hide");document.body.classList.remove("with-caption");const s=m.slide;last=s;el("eyebrow").textContent=s.eyebrow||"RADAR LIVE";el("title").textContent=s.title;el("counter").textContent=String(s.index+1).padStart(2,"0")+" / "+(s.total||18);el("metric").textContent=s.metric||"";el("metric").classList.toggle("hide",!s.metric);el("footer").textContent=s.footer||"Acompanhe o telão";const root=el("points");root.replaceChildren();s.points.forEach((p,i)=>{const box=document.createElement("div"),num=document.createElement("span"),txt=document.createElement("p");box.className="card";num.className="num";num.textContent=String(i+1).padStart(2,"0");txt.className="point";txt.textContent=p;box.append(num,txt);root.append(box)})}catch{}};ws.onclose=()=>{el("status").textContent="Reconectando…";setTimeout(connect,delay);delay=Math.min(delay*1.6,10000)};ws.onerror=()=>ws.close()}connect()})()
</script></body></html>`;
