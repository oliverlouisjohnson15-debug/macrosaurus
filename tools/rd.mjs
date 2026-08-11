import { chromium } from 'playwright-core';
import http from 'http'; import { readFileSync, existsSync } from 'fs';
const D='/private/tmp/claude-501/-Users-oliverjohnson/490ad689-35c7-4b68-b8f2-a175aa09cfd9/scratchpad/zipx';
const srv=http.createServer((q,r)=>{
  let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/Settings.dc.html';
  const f=D+p;
  if(!existsSync(f)){r.writeHead(404);return r.end()}
  const t=p.endsWith('.js')?'text/javascript':p.endsWith('.png')?'image/png':'text/html';
  r.writeHead(200,{'content-type':t}); r.end(readFileSync(f));
});
await new Promise(r=>srv.listen(0,r)); const port=srv.address().port;
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const p=await b.newPage({viewport:{width:520,height:1200},deviceScaleFactor:2});
p.on('console',m=>{if(m.type()==='error')console.log('ERR',m.text().slice(0,120))});
await p.goto(`http://localhost:${port}/Settings.dc.html`,{waitUntil:'networkidle'});
await p.waitForTimeout(2500);
console.log('body len', await p.evaluate(()=>document.body.innerText.length));
await p.screenshot({path:'design-settings.png',fullPage:true});
await b.close(); srv.close();
