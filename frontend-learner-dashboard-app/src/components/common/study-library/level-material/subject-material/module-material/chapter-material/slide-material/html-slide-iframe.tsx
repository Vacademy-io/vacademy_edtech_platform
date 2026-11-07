import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  FRAME_SELECTION_MSG,
  FRAME_SELECTION_SCRIPT,
  publishFrameSelection,
} from "@/components/chatbot/moments/frame-selection";
import { buildScormShim, htmlWantsScorm, useHtmlSlideScorm } from "./html-slide-scorm";

const HEIGHT_MSG = "vac-html-slide-height";
const MAX_HEIGHT = 20000;

// Result protocol: creative HTML slides post these to report interactive
// outcomes (quiz score, game completion) so the platform can record them.
export type SlideResult = {
  score?: number;
  maxScore?: number;
  wrong?: number;
  timesSec?: number[];
};

// Injected into the sandboxed document so it can report its height (the frame
// has an opaque origin, so we can't read it directly — but postMessage works
// across origins). Also opens links in a new tab.
const RESIZE_SCRIPT = `<script>(function(){
  function post(){try{
    var h=Math.max(document.documentElement.scrollHeight, document.body?document.body.scrollHeight:0);
    parent.postMessage({type:'${HEIGHT_MSG}',height:h},'*');
  }catch(e){}}
  window.addEventListener('load',post);
  window.addEventListener('resize',post);
  try{new ResizeObserver(post).observe(document.documentElement);}catch(e){}
  setTimeout(post,300);setTimeout(post,1200);
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
    if(a){a.setAttribute('target','_blank');a.setAttribute('rel','noopener');}
  },true);
  // Full-height render with NO internal scroll → scroll-reveal entrance
  // animations (opacity:0 revealed on scroll) never fire and their content
  // stays invisible. Snap any faded-in-place element to visible; leaves
  // display:none / visibility:hidden content (quiz answers, tabs) alone.
  function revealAll(){try{
    var els=document.querySelectorAll('body *');
    for(var i=0;i<els.length;i++){var el=els[i];
      if(el.offsetParent===null)continue;
      var cs=getComputedStyle(el);
      if(cs.visibility==='hidden')continue;
      if(parseFloat(cs.opacity)<0.05 && cs.transition && cs.transition.indexOf('opacity')>-1){
        el.style.setProperty('opacity','1','important');
        el.style.setProperty('transform','none','important');
      }
    }
    post();
  }catch(e){}}
  setTimeout(revealAll,700);setTimeout(revealAll,1800);
})();</script>`;

function withResizeScript(html: string): string {
  if (!html) return `<!DOCTYPE html><html><body></body></html>`;
  // The selection reporter lets "Ask AI" work on text selected in the frame.
  const scripts = `${RESIZE_SCRIPT}${FRAME_SELECTION_SCRIPT}`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${scripts}</body>`);
  return `${html}${scripts}`;
}

// ── Opt-in rendering (engagement runner) ──────────────────────────────────────
// Everything below is used ONLY when a caller passes one of the opt-in props
// (baseCss, measure="content", injectVars, dir, lang). Without them the srcDoc,
// title, class and height logic are exactly what course slides always had.

/**
 * `measure="content"`: report the BODY's own height instead of
 * max(documentElement.scrollHeight, body.scrollHeight). The document height never
 * drops below the frame's current height, so a short reading could not shrink
 * the frame below its first 480 px; the body's box can.
 */
const CONTENT_RESIZE_SCRIPT = `<script>(function(){
  function measure(){
    var b=document.body;if(!b)return 0;
    var r=b.getBoundingClientRect();var cs=getComputedStyle(b);
    return Math.ceil(r.height+(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0));
  }
  function post(){try{
    parent.postMessage({type:'${HEIGHT_MSG}',height:measure()},'*');
  }catch(e){}}
  window.addEventListener('load',post);
  window.addEventListener('resize',post);
  try{var ro=new ResizeObserver(post);ro.observe(document.body||document.documentElement);}catch(e){}
  setTimeout(post,300);setTimeout(post,1200);
  document.addEventListener('click',function(e){
    var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
    if(a){a.setAttribute('target','_blank');a.setAttribute('rel','noopener');}
  },true);
  function revealAll(){try{
    var els=document.querySelectorAll('body *');
    for(var i=0;i<els.length;i++){var el=els[i];
      if(el.offsetParent===null)continue;
      var cs=getComputedStyle(el);
      if(cs.visibility==='hidden')continue;
      if(parseFloat(cs.opacity)<0.05 && cs.transition && cs.transition.indexOf('opacity')>-1){
        el.style.setProperty('opacity','1','important');
        el.style.setProperty('transform','none','important');
      }
    }
    post();
  }catch(e){}}
  setTimeout(revealAll,700);setTimeout(revealAll,1800);
})();</script>`;

function withContentResizeScript(html: string): string {
  if (!html) return `<!DOCTYPE html><html><body>${CONTENT_RESIZE_SCRIPT}</body></html>`;
  const scripts = `${CONTENT_RESIZE_SCRIPT}${FRAME_SELECTION_SCRIPT}`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${scripts}</body>`);
  return `${html}${scripts}`;
}

/** A CSS custom-property value, stripped of anything that could close the rule. */
function safeCssValue(value: string): string {
  return value.replace(/[;{}<>]/g, "").trim();
}

/** Inline JS string literal that can never close the surrounding script tag. */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

interface HeadOptions {
  baseCss?: string;
  injectVars?: Record<string, string>;
  dir?: "ltr" | "rtl" | "auto";
  lang?: string;
}

/**
 * Markup injected at the START of <head>: the host's variables, then its base
 * styles, so the document's own stylesheet still wins wherever it sets something.
 * `dir` / `lang` are applied only when the document declares none of its own.
 */
function headPrefix({ baseCss, injectVars, dir, lang }: HeadOptions): string {
  let out = "";
  const vars = Object.entries(injectVars ?? {})
    .filter(([name, value]) => /^--[a-z0-9-]+$/i.test(name) && typeof value === "string")
    .map(([name, value]) => `${name}:${safeCssValue(value)};`)
    .join("");
  if (vars) out += `<style data-vac="vars">:root{${vars}}</style>`;
  if (baseCss) out += `<style data-vac="base">${baseCss.replace(/<\/style/gi, "<\\/style")}</style>`;
  if (dir || lang) {
    const setDir = dir ? `if(!d.getAttribute('dir'))d.setAttribute('dir',${jsString(dir)});` : "";
    const setLang = lang ? `if(!d.getAttribute('lang'))d.setAttribute('lang',${jsString(lang)});` : "";
    out += `<script>(function(){var d=document.documentElement;${setDir}${setLang}})();</script>`;
  }
  return out;
}

/** Put `prefix` first in <head>, creating one when needed (after any doctype). */
function insertAtHeadStart(html: string, prefix: string): string {
  const headOpen = /<head(\s[^>]*)?>/i;
  const htmlOpen = /<html(\s[^>]*)?>/i;
  if (headOpen.test(html)) return html.replace(headOpen, (tag) => `${tag}${prefix}`);
  if (htmlOpen.test(html)) return html.replace(htmlOpen, (tag) => `${tag}<head>${prefix}</head>`);
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return `${doctype[0]}<head>${prefix}</head>${html.slice(doctype[0].length)}`;
  return `<head>${prefix}</head>${html}`;
}

/** Put `prefix` first in <head> (creating one when needed) and make it a standards-mode document. */
function withHeadPrefix(html: string, prefix: string): string {
  const doc = insertAtHeadStart(html, prefix);
  // A fragment without a doctype renders in quirks mode (body heights and table
  // fonts behave differently); opting in always gets a standards-mode document.
  return /^\s*<!doctype/i.test(doc) ? doc : `<!DOCTYPE html>${doc}`;
}

export interface HtmlSlideIframeProps {
  html: string;
  onLoad?: () => void;
  onProgress?: (percent: number) => void;
  onComplete?: (result: SlideResult) => void;

  // ── Opt-in (all optional; course slides pass none of these) ──
  /** CSS placed first in the document's <head>, before the document's own styles. */
  baseCss?: string;
  /**
   * How the frame height is measured. `document` (default): the document's scroll
   * height, as course slides always did. `content`: the body's own box, so a short
   * document can shrink the frame.
   */
  measure?: "document" | "content";
  /** Called with each height the frame is set to. */
  onMeasured?: (height: number) => void;
  /** Accessible name of the frame (defaults to the generic "document" label). */
  title?: string;
  /** CSS custom properties (`--vac-*`) defined on the document's :root. */
  injectVars?: Record<string, string>;
  /** Text direction / language, applied only when the document sets none. */
  dir?: "ltr" | "rtl" | "auto";
  lang?: string;
  /** Classes merged over the frame's own. */
  className?: string;
  /** Smallest height the frame may take, in px (default 120). */
  minHeight?: number;
  /**
   * Slide id for SCORM state. When set and the document looks for a SCORM API,
   * the frame gets one and the lesson's own saved state persists per learner.
   */
  scormSlideId?: string;
}

/**
 * Renders a creative HTML document slide inside a sandboxed iframe.
 * `sandbox="allow-scripts"` WITHOUT `allow-same-origin` gives the document a
 * unique opaque origin: its CSS/JS/animations run but it is fully isolated from
 * the learner app (cannot read the parent DOM, cookies, or storage).
 */
export const HtmlSlideIframe = ({
  html,
  onLoad,
  onProgress,
  onComplete,
  baseCss,
  measure,
  onMeasured,
  title,
  injectVars,
  dir,
  lang,
  className,
  minHeight,
  scormSlideId,
}: HtmlSlideIframeProps) => {
  const { t } = useTranslation("libraryCommonB");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(480);
  const varsKey = injectVars ? JSON.stringify(injectVars) : "";
  // Keep latest handlers without re-subscribing the listener.
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // A SCORM-aware lesson that reports completion completes the slide through
  // the same callbacks as `vacademy:progress` + `vacademy:complete` messages
  // (progress also counts as learner activity, so a paused timer resumes).
  const scorm = useHtmlSlideScorm(
    scormSlideId && htmlWantsScorm(html) ? scormSlideId : undefined,
    () => {
      onProgressRef.current?.(100);
      onCompleteRef.current?.({});
    }
  );
  const scormSeed = scorm.state.status === "ready" ? scorm.state.seed : null;
  const handleScormMessageRef = useRef(scorm.handleMessage);
  handleScormMessageRef.current = scorm.handleMessage;
  const srcDoc = useMemo(() => {
    // The API must exist before the lesson's own scripts look for it.
    const doc = scormSeed ? insertAtHeadStart(html, buildScormShim(scormSeed)) : html;
    const optIn = Boolean(baseCss || measure === "content" || varsKey || dir || lang);
    if (!optIn) return withResizeScript(doc);
    const vars = varsKey ? (JSON.parse(varsKey) as Record<string, string>) : undefined;
    const prefixed = withHeadPrefix(doc, headPrefix({ baseCss, injectVars: vars, dir, lang }));
    return measure === "content" ? withContentResizeScript(prefixed) : withResizeScript(prefixed);
  }, [html, baseCss, measure, varsKey, dir, lang, scormSeed]);
  const onMeasuredRef = useRef(onMeasured);
  onMeasuredRef.current = onMeasured;
  const minHeightRef = useRef(minHeight ?? 120);
  minHeightRef.current = minHeight ?? 120;

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (handleScormMessageRef.current(e.data)) return;
      const data = e.data as { type?: string; height?: number; percent?: number } & SlideResult;
      if (data?.type === HEIGHT_MSG && typeof data.height === "number") {
        const next = Math.min(Math.max(data.height, minHeightRef.current), MAX_HEIGHT);
        setHeight(next);
        onMeasuredRef.current?.(next);
      } else if (data?.type === FRAME_SELECTION_MSG && iframeRef.current) {
        publishFrameSelection(iframeRef.current, data);
      } else if (data?.type === "vacademy:progress" && typeof data.percent === "number") {
        onProgressRef.current?.(data.percent);
      } else if (data?.type === "vacademy:complete") {
        onCompleteRef.current?.({
          score: data.score,
          maxScore: data.maxScore,
          wrong: data.wrong,
          timesSec: Array.isArray(data.timesSec) ? data.timesSec : undefined,
        });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Load the saved state first: the frame reads it synchronously on start, and
  // a later srcDoc change would reload the lesson.
  if (scorm.state.status === "loading") {
    return <div className={className ? cn("w-full bg-white", className) : "w-full bg-white"} style={{ height }} />;
  }

  return (
    <iframe
      ref={iframeRef}
      title={title || t("htmlSlideIframe.documentTitle")}
      sandbox="allow-scripts allow-popups"
      srcDoc={srcDoc}
      onLoad={onLoad}
      className={className ? cn("w-full border-0 bg-white", className) : "w-full border-0 bg-white"}
      allow="autoplay; fullscreen"
      // Height is driven by the document's reported content height (dynamic).
      style={{ height }}
    />
  );
};
