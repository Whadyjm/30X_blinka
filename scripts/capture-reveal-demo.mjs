// Captures existing production data; the session file stays outside the deliverable.
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),out=root+'/assets/reveal-demo',work=process.env.OLI_CAPTURE_WORK??'/tmp/oli-reveal-work';
const {chromium}=await import(process.env.OLI_PLAYWRIGHT_MODULE??'/tmp/oli-ui-verification/node_modules/playwright/index.mjs');
const base='https://oli30x.ultramare.dev',decisions=JSON.parse(readFileSync(out+'/evidence/decisions.json'));
const ids=Object.fromEntries(decisions.results.map(r=>[r.label,r.invoiceId]));
const previous=existsSync(out+'/evidence/captures.json')?JSON.parse(readFileSync(out+'/evidence/captures.json')):{errors:[],shots:[]};
const errors=previous.errors,shots=previous.shots;
const browser=await chromium.launch();
const ffprobe=path=>JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','json',path],{encoding:'utf8'})).format.duration;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function nativeCard(locator){return locator.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," rounded-2xl ") and contains(concat(" ",normalize-space(@class)," ")," border ")][1]');}
function card(page,title){return nativeCard(page.getByRole('heading',{name:title,exact:true}));}
async function cardStill(page,title,name){const el=card(page,title);await el.scrollIntoViewIfNeeded();await page.waitForTimeout(200);await el.screenshot({path:out+'/stills/'+name+'.png'});}
async function capture(name,route,{setup,action,state=work+'/reveal-state.json',duration=7.68,note='Real browser recording of existing registered data'}={}){
 if(shots.some(shot=>shot.name===name))return;
 const dir=work+'/raw/'+name;mkdirSync(dir,{recursive:true});
 const ctx=await browser.newContext({storageState:state,viewport:{width:1920,height:1080},deviceScaleFactor:2,recordVideo:{dir,size:{width:1920,height:1080}}});
 const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push({shot:name,message:e.message}));
 await page.goto(base+route);await page.locator('h1').first().waitFor();
 await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(900);
 if(setup)await setup(page);
 await page.waitForTimeout(250);await page.mouse.move(1880,1040);
 const started=Date.now();
 await page.screenshot({path:out+'/stills/'+name+'.png'});
 if(action)await action(page);else await page.waitForTimeout(duration*1000);
 const elapsed=(Date.now()-started)/1000;
 const video=page.video();await ctx.close();const raw=await video.path();
 const full=Number(ffprobe(raw)),start=Math.max(0,full-elapsed-.04),output=out+'/clips/'+name+'.mp4';
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(start),'-i',raw,'-t',String(elapsed),'-an','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',output],{stdio:['ignore','pipe','pipe']});
 shots.push({name,route,note,clip:'clips/'+name+'.mp4',still:'stills/'+name+'.png',duration:Number(ffprobe(output)),sourceFramesPerSecond:25});
 writeFileSync(out+'/evidence/captures.json',JSON.stringify({capturedAt:new Date().toISOString(),base,shots,errors},null,2)+'\n');
 console.log(JSON.stringify({shot:name,captured:true,duration:shots.at(-1).duration}));
}
const pan=async(page,pixels)=>{await page.waitForTimeout(2000);await page.evaluate(pixels=>window.scrollBy({top:pixels,behavior:'smooth'}),pixels);await page.waitForTimeout(5680);};
try{
 await capture('01-oli-home','/app',{setup:async page=>{await page.locator('canvas').first().waitFor();await page.waitForTimeout(800)},action:async page=>{await page.waitForTimeout(1300);const canvas=page.locator('canvas').first();const box=await canvas.boundingBox();if(box){await page.mouse.move(box.x+box.width*.75,box.y+box.height*.3,{steps:24});await page.waitForTimeout(1200);await canvas.click();}await page.waitForTimeout(5000)}});
 await capture('02-rules','/app/rules',{setup:async page=>{await page.getByRole('button',{name:'Editar reglas',exact:true}).waitFor();await nativeCard(page.getByRole('button',{name:'Editar reglas',exact:true})).screenshot({path:out+'/stills/02-rules-card.png'});await page.evaluate(()=>scrollTo(0,0))}});
 await capture('03-vendors','/app/rules',{setup:async page=>{await page.getByRole('tab',{name:'Proveedores',exact:true}).click();await page.getByText('Aspen Backup Demo LLC',{exact:true}).waitFor();await cardStill(page,'Proveedores autorizados','03-vendors-card')}});
 await capture('04-agreements','/app/rules',{setup:async page=>{await page.getByRole('tab',{name:'Acuerdos',exact:true}).click();await page.getByText(/Database backup retention/).waitFor();await cardStill(page,'Acuerdos','04-agreements-card')}});
 await capture('05-upload-web','/app/bills',{setup:async page=>{await page.getByRole('tab',{name:/^Todas/}).waitFor();await page.getByRole('region',{name:'Subir facturas'}).screenshot({path:out+'/stills/05-upload-zone.png'}).catch(()=>{})},action:async page=>{await page.waitForTimeout(1600);await page.getByRole('tab',{name:/^Aprobada/}).click();await page.waitForTimeout(2000);await page.getByRole('tab',{name:/^Bloqueada/}).click();await page.waitForTimeout(2000);await page.getByRole('tab',{name:/^Requiere aprobación/}).click();await page.waitForTimeout(2080)}});
 await capture('06-approved','/app/bills/'+ids.approved,{setup:async page=>{await page.getByRole('heading',{name:'Decisión',exact:true}).waitFor();await page.waitForTimeout(1200);await cardStill(page,'Decisión','06-approved-decision-card');await page.evaluate(()=>scrollTo(0,0))},action:page=>pan(page,360)});
 await capture('07-extraction','/app/bills/'+ids['human-review'],{setup:async page=>{await cardStill(page,'Lo que leyó Oli','07-extraction-card');await cardStill(page,'Documento original','07-original-card');await page.getByRole('heading',{name:'Lo que leyó Oli',exact:true}).scrollIntoViewIfNeeded()},action:page=>pan(page,260)});
 await capture('08-duplicate','/app/bills/'+ids.duplicate,{setup:async page=>{await cardStill(page,'Decisión','08-duplicate-decision-card');await page.getByRole('heading',{name:'Decisión',exact:true}).scrollIntoViewIfNeeded()},action:page=>pan(page,300)});
 await capture('09-human-review','/app/bills/'+ids['human-review'],{setup:async page=>{await page.getByRole('button',{name:/^Aprobar/}).waitFor();await cardStill(page,'Resolver revisión','09-human-approval-card');await cardStill(page,'Decisión','09-human-decision-card');await page.evaluate(()=>scrollTo(0,0))},action:page=>pan(page,280)});
 await capture('10-decision-trace','/app/bills/'+ids.approved,{setup:async page=>{await cardStill(page,'Rastro de decisión','10-trace-card');await page.getByRole('heading',{name:'Rastro de decisión',exact:true}).scrollIntoViewIfNeeded()},action:page=>pan(page,560)});
 await capture('11-policy-history','/app/rules',{setup:async page=>{await page.getByRole('tab',{name:'Historial de reglas',exact:true}).click();await page.getByText(/Owner de demostración/).first().waitFor();await page.locator('main').screenshot({path:out+'/stills/11-policy-history-card.png'})},note:'Actual policy version and owner activation history; decision trace is captured separately.'});
 await capture('12-dashboard','/app/dashboard',{setup:async page=>{await page.locator('#organization-overview').waitFor()},action:page=>pan(page,420)});
 // Show actual integration capabilities without exposing inbox addresses or issuing messages.
 await capture('13-email-channel','/app/integrations',{setup:async page=>{await page.getByRole('heading',{name:'Correo de Oli',exact:true}).waitFor();await page.locator('#oli-email-address').evaluate(el=>el.style.filter='blur(10px)').catch(()=>{});const section=page.locator('section[aria-labelledby="email-title"]').locator('..');await section.screenshot({path:out+'/stills/13-email-card.png'});await section.scrollIntoViewIfNeeded()},state:work+'/demo-state.json',note:'Actual integration settings; mailbox address blurred for publication. No email sent.'});
 await capture('14-agent-channel','/app/integrations',{setup:async page=>{const heading=page.getByRole('heading',{name:'Oli Skill',exact:true});await heading.waitFor();await nativeCard(heading).screenshot({path:out+'/stills/14-agent-card.png'});await heading.scrollIntoViewIfNeeded()},note:'Actual Oli Skill integration UI. No agent credential created and no agent submission performed.'});
 await capture('15-telegram-channel','/app/integrations',{setup:async page=>{await page.locator('#telegram-title').waitFor();await page.locator('#oli-email-address').evaluate(el=>el.style.filter='blur(10px)').catch(()=>{});const nativeCard=page.locator('#telegram-title').locator('xpath=../../..');await nativeCard.screenshot({path:out+'/stills/15-telegram-card.png'});await page.locator('#telegram-title').scrollIntoViewIfNeeded()},state:work+'/demo-state.json',note:'Actual connected Telegram integration UI. No external message sent.'});
 // A real read-only chat question about the recorded duplicate; no proposals or confirmations.
 await capture('16-ask-oli','/app',{duration:10,setup:async page=>{await page.locator('textarea').waitFor()},action:async page=>{
 const question='¿Por qué está bloqueada la factura duplicada RD-001-2026 de Aspen Backup Demo LLC? Consulta mis facturas. Respóndeme en dos frases breves, con el motivo registrado y sin proponer cambios.';
 const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/chat/messages',{timeout:60000});
 await page.locator('textarea').pressSequentially(question,{delay:10});await page.getByRole('button',{name:'Enviar mensaje a Oli',exact:true}).click();const response=await pending;
 if(!response.ok())throw new Error('Chat response HTTP '+response.status());const reply=(await response.json()).data;writeFileSync(out+'/evidence/chat.json',JSON.stringify(reply,null,2)+'\n');
 if(reply.actions.length)throw new Error('Read-only demo unexpectedly proposed an action');await page.waitForTimeout(6000);await page.screenshot({path:out+'/stills/16-ask-oli-answer.png'});
 },note:'Real recorded chat question and model answer using registered invoices; no financial actions.'});
 await capture('17-chat-answer','/app',{setup:async page=>{await page.getByRole('log').waitFor();await page.waitForTimeout(1200);await page.getByRole('log').screenshot({path:out+'/stills/17-chat-conversation.png'})}});
}finally{await browser.close();}
