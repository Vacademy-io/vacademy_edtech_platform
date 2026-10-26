/**
 * build-video — turns a captured flow (real frames + cursor coords + captions)
 * into ONE self-contained HTML "video": a faux-browser frame showing the REAL
 * screenshots, with a ghost cursor that moves to each recorded click point, a tap
 * ripple, crossfades between frames, captions, and a seekable player bar.
 *
 * Deterministic — no AI, no UI recreation. The UI shown IS the captured product.
 * Frames are inlined as base64 so the file is fully portable.
 *
 * Usage: node capture/build-video.mjs <flow-slug-dir>            (→ walkthroughs/)
 *        node capture/build-video.mjs <slug> --out=walkthroughs-v2 (→ another folder)
 *        node capture/build-video.mjs learner-profile-view
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_ROOT } from './env.mjs';

const argv = process.argv.slice(2);
const dirName = argv.find((a) => !a.startsWith('--')) || 'learner-profile-view';
const outArg = argv.find((a) => a.startsWith('--out='));
const OUT_FOLDER = outArg ? outArg.split('=')[1] : 'walkthroughs';
const flowDir = join(TOOL_ROOT, 'screenshots', 'flows', dirName);
if (!existsSync(join(flowDir, 'manifest.json'))) { console.error('no manifest in', flowDir); process.exit(1); }
const man = JSON.parse(readFileSync(join(flowDir, 'manifest.json'), 'utf8'));

const VW = man.viewport.width, VH = man.viewport.height;
const DEFAULT_DUR = 3400, FINAL_DUR = 3800;

const frames = man.steps.map((s, i) => {
    const b64 = readFileSync(join(flowDir, s.img)).toString('base64');
    return {
        src: `data:image/png;base64,${b64}`,
        caption: s.caption || '',
        address: s.address || '/',
        cursor: s.cursor || null,
        click: !!s.click,
        dur: s.dur != null ? s.dur : (s.final ? FINAL_DUR : DEFAULT_DUR),
    };
});

const outDir = join(TOOL_ROOT, OUT_FOLDER);
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${man.slug}.html`);

const DATA = JSON.stringify({ vw: VW, vh: VH, urlBase: man.urlBase, title: man.title, frames });

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Walkthrough — ${man.title.replace(/</g, '&lt;')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --brand:#F5A700; --brand-bright:#FFB81C; --brand-deep:#C77D00; --brand-soft:#FFF6E6;
    --ink:#1B2333; --ink-2:#475467; --ink-3:#98A2B3; --line:#EAECF0; --wash:#F8F9FB; --page-bg:#FBFAF6;
    --ff-display:'Plus Jakarta Sans', system-ui, sans-serif; --ff-ui:'Inter', system-ui, sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:var(--ff-ui);background:var(--page-bg);color:var(--ink);-webkit-font-smoothing:antialiased;
    height:100dvh;overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:12px 14px 0}
  .brandstrip{width:100%;max-width:1080px;display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px;padding:0 4px}
  .brandstrip .left{display:flex;align-items:center;gap:11px;min-width:0}
  .brand-badge{width:34px;height:34px;border-radius:9px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;
    font-family:var(--ff-display);font-weight:800;font-size:13px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand-deep));overflow:hidden}
  .brand-badge img{width:100%;height:100%;object-fit:cover}
  .brand-name{font-family:var(--ff-display);font-weight:700;font-size:16px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .brand-tag{font-size:12.5px;color:var(--ink-3);font-weight:500;white-space:nowrap}

  .framewrap{width:100%;display:flex;justify-content:center;align-items:flex-start;flex:0 0 auto}
  .browser{background:#fff;border-radius:16px;overflow:hidden;border:1px solid var(--line);
    box-shadow:0 18px 50px -18px rgba(16,24,40,.30),0 2px 6px rgba(16,24,40,.05);transform-origin:top center}
  .topbar{height:42px;background:var(--wash);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:13px;padding:0 14px}
  .dots{display:flex;gap:7px}.dots i{width:11px;height:11px;border-radius:50%;display:block}
  .dots .r{background:#FF5F57}.dots .a{background:#FEBC2E}.dots .g{background:#28C840}
  .addr{flex:1;height:25px;background:#fff;border:1px solid var(--line);border-radius:13px;display:flex;align-items:center;gap:7px;padding:0 12px;font-size:12px;color:var(--ink-2);max-width:600px}
  .addr svg{width:11px;height:11px;flex:0 0 auto;opacity:.7}

  .screen{position:relative;overflow:hidden;background:#fff}
  .screen img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center;opacity:0;transition:opacity .35s ease}
  .screen img.on{opacity:1}
  .cursor{position:absolute;top:0;left:0;width:26px;height:26px;z-index:30;pointer-events:none;
    transition:left .72s cubic-bezier(.5,.05,.2,1),top .72s cubic-bezier(.5,.05,.2,1);filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))}
  .cursor.tap{animation:tap .32s ease}
  @keyframes tap{0%{transform:scale(1)}45%{transform:scale(.78)}100%{transform:scale(1)}}
  .ripple{position:absolute;width:22px;height:22px;border-radius:50%;z-index:25;background:var(--brand);opacity:.5;pointer-events:none;transform:translate(-50%,-50%) scale(0)}
  .ripple.go{animation:rip .6s ease-out forwards}
  @keyframes rip{to{transform:translate(-50%,-50%) scale(3.6);opacity:0}}

  .caption{width:100%;max-width:1080px;text-align:center;margin-top:11px;min-height:24px;font-size:15px;color:var(--ink-2);font-weight:500;line-height:1.5;padding:0 8px;transition:opacity .3s;flex:0 0 auto}
  .caption b{color:var(--ink);font-weight:700}

  .player{width:100vw;margin-top:auto;flex:0 0 auto;background:#fff;border-top:1px solid var(--line);padding:11px 22px;display:flex;align-items:center;gap:16px;box-shadow:0 -4px 20px -8px rgba(16,24,40,.12)}
  .pbtn{width:38px;height:38px;border-radius:10px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--ink);flex:0 0 auto;transition:background .2s,transform .1s}
  .pbtn:hover{background:var(--wash)}.pbtn:active{transform:scale(.94)}.pbtn svg{width:17px;height:17px}
  .pbtn.primary{background:var(--brand);border-color:var(--brand);color:#fff}
  .pbtn.pulse{animation:pulse 1.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 0 var(--brand-soft)}50%{box-shadow:0 0 0 7px transparent}}
  .timeline{flex:1;position:relative;height:30px;display:flex;align-items:center;cursor:pointer}
  .track{position:relative;width:100%;height:6px;background:var(--line);border-radius:4px}
  .fill{position:absolute;left:0;top:0;height:100%;width:0;background:var(--brand);border-radius:4px;transition:width .08s linear}
  .tick{position:absolute;top:50%;transform:translate(-50%,-50%);width:2px;height:11px;background:#fff;opacity:.85;border-radius:1px}
  .plabel{font-size:12.5px;font-weight:600;color:var(--ink-2);white-space:nowrap;min-width:96px;text-align:right}
  .ptime{font-size:12px;font-weight:600;color:var(--ink-3);font-variant-numeric:tabular-nums;min-width:78px;text-align:right}
  @media (max-width:720px){.ptime,.plabel{display:none}.brand-tag{display:none}}
</style>
</head>
<body>
  <div class="brandstrip">
    <div class="left"><div class="brand-badge" id="brandBadge"></div><div class="brand-name" id="brandName"></div></div>
    <div class="brand-tag" id="brandTag">Guided walkthrough</div>
  </div>
  <div class="framewrap" id="framewrap">
    <div class="browser" id="browser">
      <div class="topbar">
        <div class="dots"><i class="r"></i><i class="a"></i><i class="g"></i></div>
        <div class="addr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><span id="addrText">dash.vacademy.io</span></div>
      </div>
      <div class="screen" id="screen">
        <div class="cursor" id="cursor"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 3l5.5 16 2.2-6.4L19 10.5 5 3z" fill="#fff" stroke="rgba(0,0,0,.4)" stroke-width="1" stroke-linejoin="round"/></svg></div>
      </div>
    </div>
  </div>
  <div class="caption" id="caption"></div>
  <div class="player">
    <button class="pbtn primary" id="playBtn" aria-label="Play or pause"><svg id="playIcon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
    <button class="pbtn" id="restartBtn" aria-label="Restart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/></svg></button>
    <div class="timeline" id="timeline"><div class="track"><div class="fill" id="fill"></div><div id="ticks"></div></div></div>
    <div class="plabel" id="plabel">Step 1</div>
    <div class="ptime" id="ptime">0:00 / 0:00</div>
  </div>
<script>
window.BRAND = window.BRAND || { name:"CPO Test", logo:"", url:"" };
var DATA = ${DATA};
var FR = DATA.frames, VW = DATA.vw, VH = DATA.vh;
var DESIGN_W = 1080, DESIGN_H = Math.round(DESIGN_W * VH / VW);

var screen = document.getElementById('screen');
var browser = document.getElementById('browser');
var framewrap = document.getElementById('framewrap');
var cursor = document.getElementById('cursor');
var addrText = document.getElementById('addrText');
var caption = document.getElementById('caption');
var fill = document.getElementById('fill'), plabel = document.getElementById('plabel'), ptime = document.getElementById('ptime');
var playIcon = document.getElementById('playIcon'), playBtn = document.getElementById('playBtn'), restartBtn = document.getElementById('restartBtn');
var timeline = document.getElementById('timeline'), ticksWrap = document.getElementById('ticks');

browser.style.width = (DESIGN_W + 2) + 'px';
screen.style.width = DESIGN_W + 'px';
screen.style.height = DESIGN_H + 'px';

// header: neutral walkthrough mark + the flow title (frames carry the real institute branding)
(function applyHeader(){
  document.getElementById('brandBadge').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
  document.getElementById('brandName').textContent = DATA.title;
  document.getElementById('brandTag').textContent = 'Guided walkthrough';
})();
var URLBASE = (window.BRAND && window.BRAND.url) ? window.BRAND.url : (DATA.urlBase || 'dash.vacademy.io');

// build frame images
var imgs = FR.map(function(f,i){
  var im=document.createElement('img'); im.src=f.src; im.alt='step '+(i+1); im.draggable=false;
  screen.insertBefore(im, cursor); return im;
});

var DUR = FR.map(function(f){return f.dur;});
var TOTAL = DUR.reduce(function(a,b){return a+b;},0);
var bounds=[],acc=0; DUR.forEach(function(d){bounds.push({start:acc,end:acc+d});acc+=d;});
bounds.slice(0,-1).forEach(function(b){var t=document.createElement('div');t.className='tick';t.style.left=(b.end/TOTAL*100)+'%';ticksWrap.appendChild(t);});

function scaleK(){ return screen.clientWidth / VW; }
function fmt(ms){ms=Math.max(0,ms);var s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

function fitFrame(){
  var brand=document.querySelector('.brandstrip'),cap=document.getElementById('caption'),player=document.querySelector('.player');
  var natH = 42 + DESIGN_H; var natW = DESIGN_W + 2;
  var availH = window.innerHeight - (brand?brand.offsetHeight:46) - (cap?Math.max(cap.offsetHeight,24):24) - (player?player.offsetHeight:60) - 40;
  var availW = window.innerWidth - 24;
  var s = Math.min(1, availW/natW, availH/natH); s=Math.max(s,.3);
  browser.style.transform = s<1 ? 'scale('+s+')' : '';
  framewrap.style.height = Math.ceil(natH*s)+'px';
}
window.addEventListener('resize', fitFrame);
window.addEventListener('load', fitFrame);

function ripple(x,y){var r=document.createElement('div');r.className='ripple';r.style.left=x+'px';r.style.top=y+'px';screen.appendChild(r);void r.offsetWidth;r.classList.add('go');setTimeout(function(){r.remove();},620);}

var cur=0, playing=false, rafId=null, segStart=0, elapsedBefore=0, stepTimers=[];
function clearTimers(){stepTimers.forEach(clearTimeout);stepTimers=[];}
function setIcon(p){playIcon.innerHTML = p ? '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>' : '<path d="M8 5v14l11-7z"/>';}

function showFrame(i){ imgs.forEach(function(im,j){im.classList.toggle('on', j===i);}); }

function placeCursorInstant(i){
  var f=FR[i]; if(!f.cursor){return;}
  var k=scaleK(); cursor.style.transition='none';
  cursor.style.left=(f.cursor.x*k)+'px'; cursor.style.top=(f.cursor.y*k)+'px';
  void cursor.offsetWidth; cursor.style.transition='';
}

function runStep(i, seekFresh){
  cur=i; clearTimers();
  var f=FR[i];
  showFrame(i);
  addrText.textContent = URLBASE + f.address;
  caption.style.opacity=0;
  stepTimers.push(setTimeout(function(){caption.innerHTML=f.caption;caption.style.opacity=1;},110));
  plabel.textContent='Step '+(i+1)+' of '+FR.length;
  elapsedBefore=bounds[i].start; segStart=performance.now();

  var k=scaleK();
  if(f.cursor){
    // move cursor from its current spot to this frame's target
    stepTimers.push(setTimeout(function(){ cursor.style.left=(f.cursor.x*k)+'px'; cursor.style.top=(f.cursor.y*k)+'px'; }, 260));
    if(f.click){
      stepTimers.push(setTimeout(function(){ cursor.classList.remove('tap');void cursor.offsetWidth;cursor.classList.add('tap'); ripple(f.cursor.x*k, f.cursor.y*k); }, f.dur-900));
    }
  }
  // advance
  stepTimers.push(setTimeout(function(){
    if(i+1<FR.length){ runStep(i+1); }
    else finish();
  }, f.dur));
}

function loop(){
  var total = elapsedBefore + (performance.now()-segStart); if(total>TOTAL)total=TOTAL;
  fill.style.width=(total/TOTAL*100)+'%'; ptime.textContent=fmt(total)+' / '+fmt(TOTAL);
  rafId=requestAnimationFrame(loop);
}
function startLoop(){cancelAnimationFrame(rafId);rafId=requestAnimationFrame(loop);}

function play(){ if(playing)return; if(parseFloat(fill.style.width||'0')>=100){restart();return;} playing=true;setIcon(true);restartBtn.classList.remove('pulse'); placeCursorInstant(cur); runStep(cur); startLoop(); }
function pause(){ if(!playing)return; playing=false;setIcon(false);clearTimers();cancelAnimationFrame(rafId); var total=elapsedBefore+(performance.now()-segStart);elapsedBefore=Math.min(total,TOTAL); }
function toggle(){ playing?pause():play(); }
function restart(){ clearTimers();cur=0;fill.style.width='0';elapsedBefore=0;restartBtn.classList.remove('pulse');playing=true;setIcon(true);placeCursorInstant(0);runStep(0);startLoop(); }
function finish(){ playing=false;setIcon(false);clearTimers();cancelAnimationFrame(rafId);fill.style.width='100%';ptime.textContent=fmt(TOTAL)+' / '+fmt(TOTAL);plabel.textContent='Finished · replay anytime';restartBtn.classList.add('pulse'); }
function seek(frac){ frac=Math.max(0,Math.min(.999,frac));var target=frac*TOTAL;var idx=0;for(var i=0;i<bounds.length;i++){if(target>=bounds[i].start&&target<bounds[i].end){idx=i;break;}} clearTimers();cur=idx;playing=true;setIcon(true);restartBtn.classList.remove('pulse');placeCursorInstant(idx);runStep(idx);startLoop(); }

playBtn.addEventListener('click', toggle);
restartBtn.addEventListener('click', restart);
timeline.addEventListener('click', function(ev){var r=timeline.getBoundingClientRect();seek((ev.clientX-r.left)/r.width);});

var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
fitFrame();
showFrame(0); addrText.textContent=URLBASE+FR[0].address; caption.innerHTML=FR[0].caption; ptime.textContent='0:00 / '+fmt(TOTAL);
if(reduce){ cursor.style.display='none'; var last=FR.length-1; showFrame(last); caption.innerHTML=FR[last].caption; }
else { placeCursorInstant(0); setTimeout(function(){fitFrame();play();},450); }
</script>
</body>
</html>`;

writeFileSync(outFile, html);
console.log(`built ${frames.length}-frame video → ${outFile}`);
console.log(`(self-contained, ${(html.length / 1024 / 1024).toFixed(2)} MB)`);
