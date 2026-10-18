import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
assert.deepEqual(process.argv.slice(2),['--run']);
const root=new URL('../../../',import.meta.url).pathname.replace(/\/$/,''),base='https://oli30x.ultramare.dev';
const path=readdirSync(root+'/docs/evaluations').filter(p=>p.startsWith('candidate-ronda-live-')).sort().at(-1);
const sourceBytes=readFileSync(root+'/docs/evaluations/'+path),run=JSON.parse(sourceBytes);
assert.ok(run.finishedAt && run.results.length===20);
const hash=b=>createHash('sha256').update(b).digest('hex');
const candidate=JSON.parse(readFileSync(root+'/docs/evaluations/candidate-release-20261017.json'));
const auth=JSON.parse(execFileSync(root+'/apps/api/node_modules/.bin/wrangler',['auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const query=async(sql,params)=>{const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${candidate.account}/d1/database/349afff1-8b3b-4673-929b-ce6936c68d3a/query`,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:JSON.stringify({sql,params})});assert.ok(r.ok);const j=await r.json();assert.ok(j.success);return j.result[0].results;};
const session='ses_'+randomUUID(),csrf='csrf_'+randomUUID();
const output=root+'/docs/evaluations/candidate-final-browser-20261017.json';
const report={scope:'READ_ONLY_BROWSER_WALK_OF_ACTUAL_MEASURED_DECISIONS_NOT_NEW_OCR_OR_FRESH_REHEARSAL',startedAt:new Date().toISOString(),sourceReport:path,sourceSha256:hash(sourceBytes),candidateVersion:candidate.deployedVersion,browserErrors:[],checks:[],simulated:true};
const api=async p=>{const r=await fetch(base+'/api/v1'+p,{headers:{Cookie:'oli_session='+session}});assert.equal(r.status,200);return(await r.json()).data;};
const {chromium}=await import(process.env.OLI_PLAYWRIGHT_MODULE??'/tmp/oli-ui-verification/node_modules/playwright/index.mjs');
const {decisionView}=await import(root+'/apps/web/src/api/view-model.ts');
const dir=root+'/.impeccable/review/final-candidate-20261017';mkdirSync(dir,{recursive:true});
let browser;
try{
 await query('INSERT INTO sessions(token_hash,org_id,user_id,csrf_token,expires_at) VALUES(?,?,?,?,?)',[hash(session),run.orgId,run.setup.policy.activatedBy,csrf,new Date(Date.now()+1200000).toISOString()]);
 report.summary=await api('/evaluation/summary');const evidence=await api('/evaluation/report');assert.equal(evidence.reportSha256,hash(sourceBytes));
 const before=await query('SELECT count(*) n,sum(reserved_minor) reserved FROM budget_periods WHERE org_id=?',[run.orgId]);
 browser=await chromium.launch();
 for(const width of [1440,390]){
  const ctx=await browser.newContext({viewport:{width,height:1000},recordVideo:{dir:dir+`/video-${width}`,size:{width:width===390?390:1280,height:width===390?1000:900}}});
  await ctx.addCookies([{name:'oli_session',value:session,domain:new URL(base).hostname,path:'/',httpOnly:true,secure:true,sameSite:'Strict'}]);
  const page=await ctx.newPage();page.on('pageerror',e=>report.browserErrors.push(e.message));
  for(const route of ['/app/dashboard','/app/rules','/app/evaluation',...['001','011','013','014','016','009','010'].map(id=>'/app/bills/'+run.results.find(r=>r.caseId===id).invoiceId)]){
   await page.goto(base+route);await page.locator('h1').first().waitFor();
   let expectedText;
   if(route.endsWith('/evaluation'))expectedText=report.summary.datasetVersion;
   else if(route.includes('/bills/')){const row=run.results.find(r=>route.endsWith(r.invoiceId));expectedText=row.detail?.latestDecision?decisionView(row.detail.latestDecision).explanation:row.detail?.processingError?.message;}
   else if(route.endsWith('/dashboard')) await page.locator('#organization-overview').waitFor();
   if(expectedText)await page.getByText(expectedText,{exact:!route.endsWith('/evaluation')}).first().waitFor();
   await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth,{timeout:5000}).catch(()=>{});
   const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>({tag:e.tagName,className:String(e.className).slice(0,160),right:e.getBoundingClientRect().right}))}));
   const name=route.split('/').at(-1);await page.screenshot({path:dir+`/${width}-${name}.png`,fullPage:true});
   report.checks.push({width,route,expectedTextVerified:!!expectedText,layout,noHorizontalOverflow:layout.scrollWidth<=width});
   // Leave readable moments in the backup recording, then show the actual decision trace.
   await page.waitForTimeout(width===1440?6000:1800);
   if(route.includes('/bills/')){await page.getByRole('heading',{name:/^(Rastro de decisión|Decision trace)$/}).scrollIntoViewIfNeeded();await page.waitForTimeout(width===1440?3500:1000);}
  }
  const video=page.video();await ctx.close();report.checks.push({width,video:await video.path()});
 }
 const after=await query('SELECT count(*) n,sum(reserved_minor) reserved FROM budget_periods WHERE org_id=?',[run.orgId]);assert.deepEqual(after,before);report.noFinancialWrites=true;
 report.pass=report.browserErrors.length===0 && report.checks.filter(c=>c.route).every(c=>c.noHorizontalOverflow);
 if(!report.pass)process.exitCode=1;
}catch(e){report.error={name:e.name,message:e.message.slice(0,1600)};process.exitCode=1;}
finally{
 if(browser)await browser.close();
 await query('DELETE FROM sessions WHERE token_hash=? AND org_id=?',[hash(session),run.orgId]);report.sessionRevoked=true;report.finishedAt=new Date().toISOString();
 const body=JSON.stringify(report,null,2)+'\n';for(const secret of[auth.token,session,csrf])assert.ok(!body.includes(secret));writeFileSync(output,body);console.log(JSON.stringify({output,pass:report.pass,error:report.error,checks:report.checks.length}));
}
