import { chromium } from 'playwright';
import { join } from 'node:path';
import { loadEnv, TOOL_ROOT } from './env.mjs';
const env = loadEnv();
const BASE = env.VACADEMY_BASE_URL.replace(/\/+$/,'');
const browser = await chromium.launch({ headless:true });
const ctx = await browser.newContext({ storageState: join(TOOL_ROOT,'auth-state.json'), viewport:{width:1440,height:900} });
const page = await ctx.newPage();
const log=(...a)=>console.log(...a);
await page.goto(BASE+'/study-library/courses',{waitUntil:'domcontentloaded',timeout:35000});
await page.waitForLoadState('networkidle').catch(()=>{});
await page.waitForTimeout(2500);
await page.getByText('Create Course',{exact:false}).first().click().catch(()=>{});
await page.waitForTimeout(1500);
for (const h of await page.locator('input').elementHandles()){ const ph=(await h.getAttribute('placeholder'))||''; if(/course name/i.test(ph)) await h.fill('Foundation Science'); }
await page.waitForTimeout(300);
await page.getByRole('button',{name:/^Next$/i}).last().click().catch(()=>{});
await page.waitForTimeout(1500);
const createDisabled = async () => await page.getByRole('button',{name:/Create/i}).last().isDisabled().catch(()=>'n/a');
log('Create disabled at step2 start:', await createDisabled());
// click each structure card by its CONTAINER center and re-check
for (const name of ['2-Level Course Structure','3-Level Course Structure']){
  const heading = page.getByText(name,{exact:false}).first();
  const box = await heading.boundingBox().catch(()=>null);
  if(!box){ log('no box for',name); continue; }
  // click ~120px above-left center to hit the card body, then re-check
  await page.mouse.click(Math.round(box.x+200), Math.round(box.y+40)).catch(()=>{});
  await page.waitForTimeout(700);
  log('after click '+name+': Create disabled=', await createDisabled());
}
// if enabled, click it
const cb = page.getByRole('button',{name:/Create/i}).last();
if(!(await cb.isDisabled().catch(()=>true))){
  await cb.click().catch(e=>log('create err',e.message.split(String.fromCharCode(10))[0]));
  await page.waitForTimeout(4500);
  log('after Create click: url=',page.url(),' addCourseStillOpen=', await page.getByText('Add Course',{exact:false}).first().count().catch(()=>0));
}
await page.screenshot({path: join(TOOL_ROOT,'capture','_inspect','course2.png')});
await browser.close();
