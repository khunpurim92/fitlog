/* FitLog Service Worker
   - เก็บตัวแอปไว้ในเครื่อง → เปิดได้ทันทีแม้ไม่มีเน็ต
   - มีเน็ตเมื่อไหร่ โหลดเวอร์ชันใหม่เบื้องหลัง ถ้าเปลี่ยนจะบอกหน้าแอปให้ขึ้นแถบ "อัปเดต"
   - ไม่ยุ่งกับการเรียก AI / บาร์โค้ด / YouTube (ต้องใช้เน็ตจริงเสมอ)
   ไม่ต้องแก้เลขเวอร์ชันเวลาอัป index.html ใหม่ — ระบบเทียบเนื้อหาเอง */
const SHELL="fitlog-shell-v1", RUNTIME="fitlog-runtime-v1";
const SHELL_FILES=["./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./apple-touch-icon.png"];
const PASSTHRU=["api.anthropic.com","world.openfoodfacts.org","www.youtube.com","youtube.com"];
let pendingUpdate=false;

self.addEventListener("install",e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(SHELL);
    // ทีละไฟล์ — ถ้าบางไฟล์ไม่มี (เช่น ลืมอัปไอคอน) ก็ยังติดตั้งได้
    await Promise.all(SHELL_FILES.map(u=>fetch(u,{cache:"no-store"}).then(r=>r.ok&&c.put(u,r)).catch(()=>{})));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",e=>{
  e.waitUntil((async()=>{
    const ks=await caches.keys();
    await Promise.all(ks.filter(k=>k!==SHELL&&k!==RUNTIME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("message",e=>{
  if(e.data&&e.data.type==="CHECK_UPDATE"&&pendingUpdate&&e.source)e.source.postMessage({type:"FITLOG_UPDATE"});
});
async function notifyUpdate(){
  pendingUpdate=true;
  const cs=await self.clients.matchAll({type:"window"});
  cs.forEach(c=>c.postMessage({type:"FITLOG_UPDATE"}));
}
const OFFLINE_PAGE=()=>new Response("<meta charset='utf-8'><meta name='viewport' content='width=device-width'><body style='background:#0E0E16;color:#eee;font-family:sans-serif;padding:40px;line-height:1.6'>📴 ออฟไลน์ และเครื่องนี้ยังไม่เคยเปิด FitLog ตอนมีเน็ต<br>เปิดตอนมีเน็ตครั้งแรกก่อนนะครับ</body>",{status:503,headers:{"content-type":"text/html; charset=utf-8"}});
/* หน้าแอป: ส่งของในเครื่องทันที แล้วโหลดของใหม่เบื้องหลัง (ลงทะเบียนงานเบื้องหลังทันที กันเบราว์เซอร์ตัดกลางคัน) */
function handleShell(e){
  const work=(async()=>{
    const cache=await caches.open(SHELL);
    const cached=await cache.match("./index.html");
    const net=fetch(e.request,{cache:"no-store"}).then(async res=>{
      if(res&&res.ok){
        const txt=await res.clone().text();
        const old=cached?await cached.clone().text():null;
        await cache.put("./index.html",res.clone());
        if(old!==null&&old!==txt)await notifyUpdate();
      }
      return res;
    }).catch(()=>null);
    return{cached,net};
  })();
  e.respondWith(work.then(async({cached,net})=>cached||(await net)||OFFLINE_PAGE()));
  e.waitUntil(work.then(({net})=>net));
}
/* ฟอนต์/ไฟล์อื่น: ใช้ของในเครื่องก่อน แล้วอัปเดตเบื้องหลัง */
function staleWhileRevalidate(e,cacheName){
  const work=(async()=>{
    const cache=await caches.open(cacheName);
    const cached=await cache.match(e.request);
    const net=fetch(e.request).then(res=>{if(res&&(res.ok||res.type==="opaque"))cache.put(e.request,res.clone());return res;}).catch(()=>null);
    return{cached,net};
  })();
  e.respondWith(work.then(async({cached,net})=>cached||(await net)||new Response("",{status:504})));
  e.waitUntil(work.then(({net})=>net));
}
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(PASSTHRU.some(h=>url.hostname===h))return; // ต้องออกเน็ตจริง
  if(req.mode==="navigate"||(url.origin===self.location.origin&&/\/(index\.html)?$/.test(url.pathname))){handleShell(e);return;}
  if(url.hostname==="fonts.googleapis.com"||url.hostname==="fonts.gstatic.com"){staleWhileRevalidate(e,RUNTIME);return;}
  if(url.origin===self.location.origin){staleWhileRevalidate(e,SHELL);return;}
});
