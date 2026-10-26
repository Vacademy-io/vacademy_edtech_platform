import { chromium } from 'playwright';
import { join } from 'node:path';
import { loadEnv, TOOL_ROOT } from './env.mjs';
const env = loadEnv();
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/,'');
const browser = await chromium.launch({ headless:true });
const ctx = await browser.newContext({ storageState: join(TOOL_ROOT,'auth-state.json'), viewport:{width:1440,height:900} });
const page = await ctx.newPage();
await page.goto(BASE+'/manage-institute/teams',{waitUntil:'domcontentloaded',timeout:35000});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
await page.getByText('Invite User',{exact:false}).first().click().catch(()=>{});
await page.waitForTimeout(1200);
// fill name + email
const inputs = await page.locator('input').elementHandles();
for (const h of inputs){ const ph=(await h.getAttribute('placeholder'))||''; if(/full name|first and last/i.test(ph)) await h.fill('Rahul Sharma'); else if(/email/i.test(ph)) await h.fill('rahul.sharma@example.com'); }
await page.waitForTimeout(300);
const btn = () => page.getByRole('button',{name:/^Invite User$/i}).last();
console.log('button disabled BEFORE role:', await btn().isDisabled().catch(()=>'(n/a)'));
// open role dropdown
await page.getByText('Select option',{exact:false}).first().click().catch(()=>{});
await page.waitForTimeout(800);
// inspect the Admin option element structure
const info = await page.evaluate(()=>{
  const cands=[...document.querySelectorAll('*')].filter(el=>{
    const t=(el.childElementCount===0?el.textContent:'')?.trim();
    const r=el.getBoundingClientRect();
    return t==='Admin' && r.width>0 && r.top>540;
  });
  return cands.slice(0,3).map(el=>{
    const chain=[]; let n=el; for(let i=0;i<4&&n;i++){chain.push(n.tagName.toLowerCase()+(n.getAttribute('role')?'[role='+n.getAttribute('role')+']':'')+(n.className?'.'+String(n.className).split(' ').slice(0,2).join('.'):''));n=n.parentElement;}
    const r=el.getBoundingClientRect();
    return {chain:chain.join(' < '), box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]};
  });
});
console.log('Admin option structure:', JSON.stringify(info,null,1));
// try clicking the first Admin option (force)
const adminOpt = page.getByText('Admin',{exact:true}).filter({hasNot:page.locator('x')}).last();
const opts = await page.getByText('Admin',{exact:true}).all();
console.log('num exact "Admin" matches:', opts.length);
// click the one in the popup (top>540)
for (const o of opts){ const b=await o.boundingBox().catch(()=>null); if(b&&b.y>540){ await o.click().catch(e=>console.log('click err',e.message.split(String.fromCharCode(10))[0])); console.log('clicked Admin at y=',Math.round(b.y)); break; } }
await page.waitForTimeout(900);
console.log('button disabled AFTER click Admin:', await btn().isDisabled().catch(()=>'(n/a)'));
const trigTxt = await page.getByText('Role Type',{exact:false}).first().evaluate(el=>el.closest('div')?.parentElement?.innerText?.slice(0,60)).catch(()=>'');
console.log('role area text after:', JSON.stringify(trigTxt));
await page.screenshot({path: join(TOOL_ROOT,'capture','_inspect','role-after-click.png')});
await browser.close();
