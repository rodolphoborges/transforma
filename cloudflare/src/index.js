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
  if(!Number.isInteger(s.index)||s.index<0||s.index>29||typeof s.title!=="string"||JSON.stringify(s).length>14000)return;
  // V12.3: richer, presenter-approved complementary content (summary, highlight, sections, glossary, link)
  const str=(x,n)=>String(x??"").slice(0,n);
  const sections=Array.isArray(s.sections)?s.sections.slice(0,6).map(x=>({title:str(x&&x.title,90),items:(Array.isArray(x&&x.items)?x.items:[]).slice(0,12).map(i=>str(i,260))})):[];
  const glossary=Array.isArray(s.glossary)?s.glossary.slice(0,8).filter(g=>Array.isArray(g)).map(g=>[str(g[0],50),str(g[1],260)]):[];
  const hl=s.highlight&&s.highlight.value?{value:str(s.highlight.value,24),label:str(s.highlight.label,160)}:null;
  const link=s.link&&/^https:\/\/[^\s"<>]{3,200}$/.test(String(s.link.url||""))?{label:str(s.link.label,70),url:String(s.link.url)}:null;
  const slide={index:s.index,total:Number.isInteger(s.total)&&s.total>=1&&s.total<=30?s.total:18,title:s.title.slice(0,130),eyebrow:str(s.eyebrow,100),summary:str(s.summary,420),highlight:hl,sections,glossary,link,points:(Array.isArray(s.points)?s.points:[]).slice(0,12).map(x=>str(x,300))};
  await this.state.storage.put("current",slide);await this.state.storage.delete("caption");
  for(const peer of this.state.getWebSockets())if(peer!==ws)try{peer.send(JSON.stringify({type:"slide",slide}))}catch{}
  this.count();
 }
 webSocketClose(){this.count()}
 async alarm(){for(const peer of this.state.getWebSockets())try{peer.close(1000,"expired")}catch{}await this.state.storage.deleteAll()}
 count(){const peers=this.state.getWebSockets();const count=peers.filter(x=>x.deserializeAttachment()?.role==="viewer").length;for(const peer of peers)if(peer.deserializeAttachment()?.role==="host")try{peer.send(JSON.stringify({type:"viewers",count}))}catch{}}
}
const AUDIENCE=String.raw`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#062f22"><title>Radar Live · Unimed Fesp</title><style>
:root{--forest:#062f22;--forest2:#0a4a35;--lime:#b8ed42;--ink:#10291e;--muted:#4e6a5c;--line:#dbe8df;--paper:#f4f8f2;--card:#fff;--coral:#ff8664;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--paper)}
*{box-sizing:border-box}html,body{margin:0}body{min-height:100dvh;background:var(--paper);-webkit-text-size-adjust:100%}
header{position:sticky;top:0;z-index:20;background:var(--forest);color:#fff;padding:calc(10px + env(safe-area-inset-top)) 16px 0}
.hrow{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:28px}
.brand{font-size:11px;font-weight:800;letter-spacing:.16em;color:var(--lime)}
.state{display:flex;align-items:center;gap:7px;font-size:12px;color:#d9efe1;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:#7f9b8c}.live .dot{background:var(--lime);box-shadow:0 0 8px var(--lime)}.warn .dot{background:#ffc857}.off .dot{background:var(--coral)}
.counter{font:700 12px ui-monospace,Menlo,monospace;color:#fff;background:#ffffff1f;border-radius:99px;padding:3px 9px}
.progress{height:3px;margin:9px -16px 0;background:#ffffff1a}.progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--lime),var(--coral));transition:width .5s}
#capbox{position:sticky;top:var(--hh,52px);z-index:15;margin:0;background:#0b3a2a;color:#fff;padding:11px 16px 13px;border-bottom:1px solid #2c6a4d;box-shadow:0 8px 18px #0003}
.caphead{display:flex;align-items:center;gap:8px;font:800 10px system-ui;letter-spacing:.14em;color:var(--lime);margin-bottom:5px}
.rec{width:8px;height:8px;border-radius:50%;background:var(--coral);animation:blink 1.4s infinite}@keyframes blink{50%{opacity:.3}}
#captext{margin:0;font-size:17px;line-height:1.42;font-weight:600}
#capnote{margin:8px 0 0;font-size:13px;line-height:1.4;color:#cfeedd}#capnote b{color:#fff}
main{max-width:640px;margin:0 auto;padding:18px 16px calc(96px + env(safe-area-inset-bottom))}
.eyebrow{font:700 11px system-ui;letter-spacing:.14em;color:#2f7a57;text-transform:uppercase}
h1{font-size:clamp(24px,6.6vw,34px);line-height:1.12;letter-spacing:-.03em;margin:6px 0 14px;overflow-wrap:anywhere}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:12px 0;box-shadow:0 4px 14px #0b3b2510}
.label{font:800 10.5px system-ui;letter-spacing:.14em;color:#2f7a57;text-transform:uppercase;margin:0 0 8px}
.summary p{margin:0;font-size:17px;line-height:1.5}.summary p.label{font-size:10.5px;line-height:1.3;margin:0 0 8px}
.hl{display:flex;gap:14px;align-items:center;background:var(--forest);color:#fff;border:0}
.hl .v{font-size:clamp(34px,11vw,48px);font-weight:850;letter-spacing:-.05em;color:var(--lime);line-height:1;white-space:nowrap}
.hl .l{font-size:14px;line-height:1.4;color:#e4f5ea}
ul{margin:0;padding:0;list-style:none}li{position:relative;padding:7px 0 7px 18px;font-size:15px;line-height:1.45;border-top:1px solid #eef3ef}li:first-child{border-top:0}
li:before{content:"";position:absolute;left:2px;top:15px;width:7px;height:7px;border-radius:50%;background:#2f9b68}
details{background:var(--card);border:1px solid var(--line);border-radius:14px;margin:12px 0;overflow:hidden}
summary{cursor:pointer;list-style:none;padding:14px 16px;font:800 13px system-ui;letter-spacing:.04em;color:#174d36;display:flex;justify-content:space-between;align-items:center;min-height:48px}
summary::-webkit-details-marker{display:none}summary:after{content:"+";font-size:20px;color:#2f7a57}details[open] summary:after{content:"–"}
.gl{padding:0 16px 12px}.gl dt{font-weight:800;font-size:14px;margin-top:10px;color:#0d3d29}.gl dd{margin:2px 0 0;font-size:14px;line-height:1.45;color:#2b4639}
.link{display:flex;align-items:center;justify-content:center;gap:8px;min-height:50px;margin:14px 0;border-radius:12px;background:var(--lime);color:#0b2a1c;font-weight:800;font-size:15px;text-decoration:none}
.hist{padding:0 16px 10px}.hist button{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid #eef3ef;padding:10px 0;font:inherit;color:inherit;cursor:pointer}
.hist b{font:700 11px ui-monospace,monospace;color:#2f7a57;margin-right:8px}.hist span{font-size:14px}
.notice{text-align:center;padding:34px 10px;color:var(--muted)}.notice h2{color:var(--ink);font-size:20px;margin:10px 0 6px}
.viewing{background:#fff6d6;border:1px solid #f1d58a;border-radius:12px;padding:10px 12px;font-size:13px;display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 6px}
.viewing button{border:0;background:var(--forest);color:#fff;border-radius:8px;padding:8px 10px;font:700 12px system-ui;min-height:36px}
.tools{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;gap:8px;justify-content:center;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:#ffffffeb;backdrop-filter:blur(8px);border-top:1px solid var(--line)}
.tools button{flex:1;max-width:160px;min-height:44px;border-radius:10px;border:1px solid #b9d6c5;background:#eef7f1;color:#134b31;font:700 13px system-ui}
.tools button[aria-pressed=true]{background:var(--forest);color:#fff}
.hide{display:none!important}
.large .summary p:not(.label),.large #captext{font-size:21px}.large li,.large .gl dd,.large .gl dt{font-size:18px}.large h1{font-size:clamp(28px,8vw,40px)}
.hc{--paper:#fff;--card:#fff;--line:#000;--ink:#000}.hc .card,.hc details{border:2px solid #000;box-shadow:none}.hc li:before{background:#000}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
<header id="hdr"><div class="hrow"><span class="brand">RADAR LIVE · UNIMED FESP</span><span id="state" class="state"><span class="dot"></span><span id="stateText">Conectando…</span></span><span id="counter" class="counter hide">--/--</span></div><div class="progress"><i id="bar"></i></div></header>
<section id="capbox" class="hide" aria-live="polite"><div class="caphead"><span class="rec"></span><span>VÍDEO EM EXIBIÇÃO · LEGENDA</span></div><p id="captext"></p><p id="capnote" class="hide"></p></section>
<main id="main">
 <div id="viewing" class="viewing hide"><span id="viewingText"></span><button id="backLive" type="button">Voltar ao vivo</button></div>
 <div id="wait" class="notice"><div style="font-size:34px">📡</div><h2>Acompanhe a apresentação</h2><p>Mantenha esta página aberta. O conteúdo aparece aqui automaticamente, slide a slide.</p></div>
 <article id="slide" class="hide">
  <div id="eyebrow" class="eyebrow"></div><h1 id="title"></h1>
  <div id="summary" class="card summary hide"><p class="label">Em uma frase</p><p id="summaryText"></p></div>
  <div id="hl" class="card hl hide"><span id="hlv" class="v"></span><span id="hll" class="l"></span></div>
  <div id="sections"></div>
  <details id="gloss" class="hide"><summary>📖 Termos deste slide</summary><dl id="glossList" class="gl"></dl></details>
  <a id="link" class="link hide" target="_blank" rel="noopener noreferrer"></a>
 </article>
 <details id="history" class="hide"><summary>🕘 Slides anteriores</summary><div id="histList" class="hist"></div></details>
</main>
<nav class="tools" aria-label="Opções"><button id="speak" type="button">▶ Ouvir</button><button id="font" type="button" aria-pressed="false">A+ Texto</button><button id="contrast" type="button" aria-pressed="false">◑ Contraste</button></nav>
<script>
(()=>{const el=id=>document.getElementById(id),u=new URL(location.href),room=u.searchParams.get("room"),token=decodeURIComponent(location.hash.slice(1));
let current=null,viewing=null,ended=false;const seen=new Map();
const hh=()=>document.documentElement.style.setProperty("--hh",el("hdr").offsetHeight+"px");addEventListener("resize",hh);hh();
function setState(cls,txt){el("state").className="state "+cls;el("stateText").textContent=txt}
function text(n,t){n.textContent=t||"";return n}
function render(s){
 el("wait").classList.add("hide");el("slide").classList.remove("hide");
 text(el("eyebrow"),s.eyebrow);text(el("title"),s.title);
 const sum=s.summary||"";el("summary").classList.toggle("hide",!sum);text(el("summaryText"),sum);
 const h=s.highlight;el("hl").classList.toggle("hide",!(h&&h.value));if(h){text(el("hlv"),h.value);text(el("hll"),h.label)}
 const box=el("sections");box.replaceChildren();
 let secs=Array.isArray(s.sections)&&s.sections.length?s.sections:(Array.isArray(s.points)&&s.points.length?[{title:"Informações complementares",items:s.points}]:[]);
 for(const sec of secs){const c=document.createElement("div");c.className="card";if(sec.title){const l=document.createElement("p");l.className="label";l.textContent=sec.title;c.append(l)}const ul=document.createElement("ul");for(const it of sec.items||[]){const li=document.createElement("li");li.textContent=it;ul.append(li)}c.append(ul);box.append(c)}
 const gl=Array.isArray(s.glossary)?s.glossary:[];el("gloss").classList.toggle("hide",!gl.length);const dl=el("glossList");dl.replaceChildren();
 for(const g of gl){const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=g[0];dd.textContent=g[1];dl.append(dt,dd)}
 const lk=s.link;el("link").classList.toggle("hide",!(lk&&lk.url));if(lk&&lk.url){el("link").href=lk.url;el("link").textContent="↗ "+(lk.label||"Abrir link")}
}
function counter(s){el("counter").classList.remove("hide");el("counter").textContent=String(s.index+1).padStart(2,"0")+"/"+String(s.total||15).padStart(2,"0");el("bar").style.width=((s.index+1)/(s.total||15)*100)+"%"}
function history(){const list=el("histList");list.replaceChildren();const items=[...seen.values()].filter(x=>!current||x.index!==current.index).sort((a,b)=>b.index-a.index);
 el("history").classList.toggle("hide",!items.length);
 for(const s of items){const b=document.createElement("button");b.type="button";const n=document.createElement("b");n.textContent=String(s.index+1).padStart(2,"0");const t=document.createElement("span");t.textContent=s.title;b.append(n,t);b.onclick=()=>{viewing=s;render(s);el("viewing").classList.remove("hide");el("viewingText").textContent="Você está revendo o slide "+(s.index+1)+".";scrollTo({top:0,behavior:"smooth"})};list.append(b)}}
el("backLive").onclick=()=>{viewing=null;el("viewing").classList.add("hide");if(current)render(current);scrollTo({top:0,behavior:"smooth"})};
function onSlide(s){current=s;seen.set(s.index,s);counter(s);if(!viewing){render(s);scrollTo({top:0})}history();caption({})}
function caption(c){const on=!!(c.text||c.note);el("capbox").classList.toggle("hide",!on);text(el("captext"),c.text).classList.toggle("hide",!c.text);
 const n=el("capnote");n.classList.toggle("hide",!c.note);n.replaceChildren();if(c.note){const m=c.note.split(" = ");if(m.length>1){const b=document.createElement("b");b.textContent="ⓘ "+m[0];n.append(b," = "+m.slice(1).join(" = "))}else n.textContent="ⓘ "+c.note}hh()}
el("speak").onclick=()=>{const s=viewing||current;if(!s||!("speechSynthesis"in window))return;speechSynthesis.cancel();const parts=[s.title,s.summary||""];for(const sec of s.sections||[])parts.push(sec.title+": "+(sec.items||[]).join(". "));const ut=new SpeechSynthesisUtterance(parts.filter(Boolean).join(". "));ut.lang="pt-BR";ut.rate=.95;speechSynthesis.speak(ut)};
el("font").onclick=()=>{const on=document.body.classList.toggle("large");el("font").setAttribute("aria-pressed",String(on));hh()};
el("contrast").onclick=()=>{const on=document.body.classList.toggle("hc");el("contrast").setAttribute("aria-pressed",String(on))};
if(!room||!token){setState("off","Link inválido");el("wait").querySelector("h2").textContent="Link inválido";return}
let delay=800;
function connect(){if(ended)return;const url=new URL("/socket",location.origin);url.protocol=url.protocol==="https:"?"wss:":"ws:";url.searchParams.set("room",room);url.searchParams.set("role","viewer");
 const ws=new WebSocket(url.href,["radar-v1","token-"+token]);let opened=false;
 ws.onopen=()=>{opened=true;delay=800;setState("live","Ao vivo")};
 ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==="slide")onSlide(m.slide);else if(m.type==="caption")caption(m.caption||{});else if(m.type==="status"&&m.status==="waiting")setState("live","Aguardando início")}catch{}};
 ws.onclose=e=>{if(e.code===1000&&/ended|expired/.test(e.reason||"")){ended=true;setState("off","Sessão encerrada");caption({});el("wait").classList.remove("hide");el("wait").querySelector("h2").textContent="A apresentação terminou";el("wait").querySelector("p").textContent="Obrigado por acompanhar! O conteúdo abaixo continua disponível nesta página.";return}
  if(!opened&&delay>6000){setState("off","Sessão indisponível");return}
  setState("warn","Reconectando…");setTimeout(connect,delay);delay=Math.min(delay*2,15000)};
}
connect();})();
</script></body></html>`;
