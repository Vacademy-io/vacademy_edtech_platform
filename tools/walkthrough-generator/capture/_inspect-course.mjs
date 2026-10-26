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
// step 1: fill course name
for (const h of await page.locator('input').elementHandles()){ const ph=(await h.getAttribute('placeholder'))||''; if(/course name/i.test(ph)){ await h.fill('Foundation Science'); log('filled course name'); } }
await page.waitForTimeout(400);
// click Next
const next = page.getByRole('button',{name:/^Next$/i}).last();
log('Next disabled:', await next.isDisabled().catch(()=>'n/a'));
await next.click().catch(e=>log('next click err',e.message.split(String.fromCharCode(10))[0]));
await page.waitForTimeout(1500);
log('on step 2 now. heading present:', await page.getByText(/Step 2|Course Structure/i).first().count().catch(()=>0));
// click 3-Level card
const card = page.getByText('3-Level Course Structure',{exact:false}).first();
await card.click().catch(e=>log('card click err',e.message.split(String.fromCharCode(10))[0]));
await page.waitForTimeout(800);
// Create button
const createBtn = page.getByRole('button',{name:/Create/i}).last();
log('Create disabled:', await createBtn.isDisabled().catch(()=>'n/a'));
const cb = await createBtn.boundingBox().catch(()=>null); log('Create box:', JSON.stringify(cb));
await createBtn.click().catch(e=>log('create click err',e.message.split(String.fromCharCode(10))[0]));
await page.waitForTimeout(4000);
log('after Create: url=', page.url());
log('dialog still open:', await page.getByText('Add Course',{exact:false}).first().count().catch(()=>0));
log('any toast/success text:', JSON.stringify((await page.locator('body').innerText().catch(()=>'')).match(/success|created|congrat|added/gi)||[]));
await page.screenshot({path: join(TOOL_ROOT,'capture','_inspect','course-after-create.png')});
await browser.close();
