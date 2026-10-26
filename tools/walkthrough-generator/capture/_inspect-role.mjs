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
// open invite dialog
const inv = page.getByText('Invite User',{exact:false}).first();
await inv.click().catch(()=>{});
await page.waitForTimeout(1500);
// find the Role Type trigger
const trig = page.getByText('Select option',{exact:false}).first();
const tb = await trig.boundingBox().catch(()=>null);
console.log('role trigger box:', JSON.stringify(tb));
await trig.click().catch(()=>{});
await page.waitForTimeout(900);
// dump what appeared
const dump = await page.evaluate(()=>{
  const out={roleOptions:[],portals:[]};
  for (const el of document.querySelectorAll('[role="option"],[role="menuitem"],li,[class*="option"],[class*="Option"]')){
    const t=(el.innerText||'').trim(); const r=el.getBoundingClientRect();
    if(t && t.length<40 && r.width>0 && r.top>150) out.roleOptions.push({t, tag:el.tagName.toLowerCase(), cls:(el.className||'').toString().slice(0,50), x:Math.round(r.x),y:Math.round(r.y)});
  }
  return out;
});
console.log('options after click:', JSON.stringify(dump.roleOptions.slice(0,15),null,1));
await page.screenshot({path: join(TOOL_ROOT,'capture','_inspect','role-open.png')});
await browser.close();
