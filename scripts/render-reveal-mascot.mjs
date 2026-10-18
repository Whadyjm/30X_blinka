// Offline frame export of Oli's existing renderer. No product or financial code changes.
import { createServer } from 'node:http';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=root+'/assets/reveal-demo/mascot';
const module=process.env.OLI_PLAYWRIGHT_MODULE??'/tmp/oli-ui-verification/node_modules/playwright/index.mjs';
const {chromium}=await import(module);
const fps=60,size=1080;
for(const dir of ['alpha','previews','portraits'])mkdirSync(out+'/'+dir,{recursive:true});
const shots=[
 {name:'01-reveal',state:'idle',frames:461,events:[[0.48,'listening'],[3.36,'happy']]},
 {name:'02-listening',state:'listening',frames:360},
 {name:'03-thinking',state:'thinking',frames:360},
 {name:'04-focused',state:'focused',frames:360},
 {name:'05-understanding',state:'understanding',frames:360},
 {name:'06-happy',state:'happy',frames:360},
 {name:'07-celebrating',state:'understanding',frames:360,events:[[0.48,'celebrating']]},
 {name:'08-look-and-touch',state:'listening',frames:461,interaction:true},
 {name:'09-idle',state:'idle',frames:360},
];
const html=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}canvas{width:400px;height:400px;display:block}</style><canvas id="oli"></canvas><script type="module">
import {OliCanvas} from '/renderer.js';
import {STATES} from '/particles.js';
const canvas=document.querySelector('canvas');let oli;
window.reset=(state,dark=true)=>{
 oli?.destroy();oli=new OliCanvas(canvas,{state,paused:true,dark,particles:1600});
 oli.resizeObserver.disconnect();oli.intersectionObserver.disconnect();
 canvas.width=${size};canvas.height=${size};oli.width=400;oli.height=400;oli.ctx.setTransform(${size/400},0,0,${size/400},0,0);
 oli.paused=false;oli.render(0,true);
};
window.state=s=>{if(s!==oli.state){oli.stateTime=0;if(s==='celebrating')oli.burst=1;oli.state=s;}};
window.frame=({frame,events=[],interaction=false,portrait=false})=>{
 const time=frame/${fps};
 for(const [at,state] of events)if(Math.round(at*${fps})===frame)window.state(state);
 if(interaction){oli.lookAt(Math.sin(time*1.1)*0.85,Math.cos(time*0.9)*0.35);if(frame===144){oli.ripple(-0.2,0.1);window.state('happy')}if(frame===288)window.state('celebrating');}
 oli.render(1/${fps});return canvas.toDataURL('image/png').split(',')[1];
};
window.ready=true;
</script>`;
const server=createServer((req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html)}else if(['/renderer.js','/particles.js'].includes(req.url)){res.setHeader('Content-Type','text/javascript');res.end(readFileSync(out+'/source'+req.url))}else{res.statusCode=404;res.end()}}catch{res.statusCode=500;res.end()}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:400,height:400},reducedMotion:'no-preference'});
const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.ready);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 for(const shot of shots){
  await page.evaluate(state=>window.reset(state,true),shot.state);
  const alpha=out+'/alpha/'+shot.name+'.webm',preview=out+'/previews/'+shot.name+'.mp4';
  const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-i','pipe:0','-filter_complex','[0:v]split=2[a][b];color=c=0x191715:s=1920x1080:r=60[bg];[bg][b]overlay=(W-w)/2:(H-h)/2:shortest=1:format=auto,format=yuv420p[preview]','-map','[a]','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-crf','22','-b:v','0','-deadline','realtime','-cpu-used','6','-row-mt','1','-auto-alt-ref','0','-metadata:s:v:0','alpha_mode=1',alpha,'-map','[preview]','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',preview],{stdio:['pipe','ignore','pipe']});
  let stderr='';ff.stderr.on('data',v=>stderr+=v);const completed=once(ff,'close');
  for(let frame=0;frame<shot.frames;frame++){
   const data=Buffer.from(await page.evaluate(({frame,events,interaction})=>window.frame({frame,events,interaction}),{frame,events:shot.events,interaction:shot.interaction}),'base64');
   if(!ff.stdin.write(data))await once(ff.stdin,'drain');
   if(frame===60)writeFileSync(out+'/portraits/'+shot.name+'-ivory.png',data);
   if(frame%120===0)console.log(JSON.stringify({shot:shot.name,frame,total:shot.frames}));
  }
  ff.stdin.end();const[code]=await completed;if(code!==0)throw new Error(stderr);
  console.log(JSON.stringify({shot:shot.name,exported:true}));
 }
 for(const state of ['idle','listening','thinking','focused','understanding','happy','celebrating']){
  await page.evaluate(state=>window.reset(state,false),state);let png;
  for(let frame=0;frame<=60;frame++)png=await page.evaluate(frame=>window.frame({frame}),frame);
  writeFileSync(out+'/portraits/'+state+'-graphite.png',Buffer.from(png,'base64'));
 }
 const hashes=Object.fromEntries(['renderer.js','particles.js'].map(name=>[name,createHash('sha256').update(readFileSync(out+'/source/'+name)).digest('hex')]));
 writeFileSync(out+'/render-manifest.json',JSON.stringify({renderer:'Original Oli Canvas renderer, including current seeded glints. Unmodified copied source.',sourceHashes:hashes,fps,size,background:'Transparent VP9 alpha; MP4 preview uses #191715',shots,errors},null,2)+'\n');
}finally{await browser.close();server.close();}
