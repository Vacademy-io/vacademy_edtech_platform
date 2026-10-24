import { useCallback, useEffect, useRef, useState } from "react";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";

// SCORM runtime for creative HTML slides.
//
// Self-contained HTML lessons often save their own state (checks done,
// section reached, answers) through a SCORM API found on window / parent, and
// fall back to localStorage. Our sandboxed frame has an opaque origin, so both
// fail and the lesson resets on every visit ("Progress not saved").
//
// We define a SCORM 1.2 + 2004 API INSIDE the frame, seeded with the learner's
// saved CMI data, and relay commits to the parent via postMessage, which stores
// them through the same endpoints SCORM slides use (keyed by slide id). Only
// the lesson's own state is stored: no completion / score / progress fields go
// out, so the backend never cascades this into course progress, which stays
// driven by the document tracking. When the lesson reports itself completed,
// `onCompleted` fires once so the caller can complete the document the same
// way a `vacademy:complete` message does.

const SCORM_TRACKING_BASE = `${BASE_URL}/admin-core-service/scorm/tracking/v1`;
export const SCORM_MSG = "vac-html-slide-scorm";

// Commits are throttled; a lesson may Commit on every click.
const FLUSH_DELAY_MS = 3000;
// Guard against a runaway lesson posting huge payloads.
const MAX_PAYLOAD_CHARS = 512 * 1024;

type Cmi = Record<string, string>;

/** Only lessons that look for a SCORM API get one (avoids a tracking row per HTML slide). */
export function htmlWantsScorm(html: string): boolean {
  return /API_1484_11|LMSInitialize/.test(html || "");
}

/** Script defining window.API_1484_11 and window.API, seeded with `seed`. */
export function buildScormShim(seed: Cmi): string {
  const data = JSON.stringify(seed).replace(/</g, "\\u003c");
  return `<script>(function(){
  var d=${data},T='${SCORM_MSG}';
  function post(a){try{parent.postMessage({type:T,action:a,cmi:d},'*')}catch(e){}}
  function ok(){return "true"}
  function get(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:""}
  function set(k,v){d[String(k)]=String(v);return "true"}
  function commit(){post('commit');return "true"}
  function finish(){post('finish');return "true"}
  function noErr(){return "0"}
  function noText(){return ""}
  window.API_1484_11={Initialize:ok,Terminate:finish,GetValue:get,SetValue:set,Commit:commit,
    GetLastError:noErr,GetErrorString:noText,GetDiagnostic:noText};
  window.API={LMSInitialize:ok,LMSFinish:finish,LMSGetValue:get,LMSSetValue:set,LMSCommit:commit,
    LMSGetLastError:noErr,LMSGetErrorString:noText,LMSGetDiagnostic:noText};
})();</script>`;
}

const isCmiKey = (key: string) => key.startsWith("cmi.");

/** SCORM 2004 completion_status, or the 1.2 lesson_status (which also carries pass/fail). */
function isCompleted(cmi: Cmi): boolean {
  const status = String(cmi["cmi.completion_status"] ?? cmi["cmi.core.lesson_status"] ?? "");
  return /^(completed|passed)$/i.test(status);
}

/** Column-sized value or null (the full value is still kept in cmi_json). */
const fits = (value: string | undefined, max: number) =>
  value != null && value.length <= max ? value : null;

function buildPayload(cmi: Cmi) {
  const raw: Cmi = {};
  for (const [key, value] of Object.entries(cmi)) {
    if (isCmiKey(key) && typeof value === "string") raw[key] = value;
  }
  return {
    cmi_suspend_data: raw["cmi.suspend_data"] ?? null,
    cmi_location: fits(raw["cmi.location"] ?? raw["cmi.core.lesson_location"], 255),
    cmi_exit: fits(raw["cmi.exit"] ?? raw["cmi.core.exit"], 50),
    cmi_json: raw,
  };
}

export type HtmlSlideScorm =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ready"; seed: Cmi };

/**
 * Loads the learner's saved CMI data for `slideId` and returns a message
 * handler that persists the frame's commits. `slideId` undefined = disabled.
 * `onCompleted` fires once when the lesson first reports completion (not when
 * it was already completed on an earlier visit).
 */
export function useHtmlSlideScorm(slideId: string | undefined, onCompleted?: () => void) {
  const [state, setState] = useState<HtmlSlideScorm>(
    slideId ? { status: "loading" } : { status: "off" }
  );
  // The slide id travels with the data: a flush after switching slides must
  // still go to the slide that produced it.
  const pendingRef = useRef<{ id: string; cmi: Cmi } | null>(null);
  const lastSentRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideIdRef = useRef(slideId);
  slideIdRef.current = slideId;
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;
  // Already completed (saved state) or already reported during this visit.
  const completionReportedRef = useRef(false);

  useEffect(() => {
    if (!slideId) {
      setState({ status: "off" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    lastSentRef.current = "";
    completionReportedRef.current = true;
    authenticatedAxiosInstance
      .get(`${SCORM_TRACKING_BASE}/${slideId}/initialize`)
      .then((res) => {
        if (cancelled) return;
        const seed: Cmi = {};
        const cmiJson = (res.data?.cmi_json ?? {}) as Record<string, unknown>;
        for (const [key, value] of Object.entries(cmiJson)) {
          if (isCmiKey(key) && value != null) seed[key] = String(value);
        }
        const suspend = res.data?.cmi_suspend_data;
        if (typeof suspend === "string" && !seed["cmi.suspend_data"]) {
          seed["cmi.suspend_data"] = suspend;
        }
        completionReportedRef.current = isCompleted(seed);
        setState({ status: "ready", seed });
      })
      .catch((err) => {
        // Without a session row commits would fail, so leave the lesson
        // without an API (it reports "not saved" honestly) instead.
        console.warn("HTML slide SCORM initialize failed:", err);
        if (!cancelled) setState({ status: "off" });
      });
    return () => {
      cancelled = true;
    };
  }, [slideId]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const { id, cmi } = pending;
    const payload = buildPayload(cmi);
    const body = JSON.stringify(payload);
    if (body === lastSentRef.current || body.length > MAX_PAYLOAD_CHARS) return;
    lastSentRef.current = body;
    authenticatedAxiosInstance
      .post(`${SCORM_TRACKING_BASE}/${id}/commit`, payload)
      .catch((err) => {
        lastSentRef.current = "";
        console.error("HTML slide SCORM commit failed:", err);
      });
  }, []);

  /** Feed every frame message here; returns true when it was a SCORM message. */
  const handleMessage = useCallback(
    (data: unknown): boolean => {
      const msg = data as { type?: string; action?: string; cmi?: unknown };
      if (msg?.type !== SCORM_MSG) return false;
      const id = slideIdRef.current;
      if (!id || !msg.cmi || typeof msg.cmi !== "object") return true;
      const cmi = msg.cmi as Cmi;
      pendingRef.current = { id, cmi };
      if (!completionReportedRef.current && isCompleted(cmi)) {
        completionReportedRef.current = true;
        onCompletedRef.current?.();
      }
      if (msg.action === "finish" || document.visibilityState === "hidden") {
        flush();
      } else if (!timerRef.current) {
        timerRef.current = setTimeout(flush, FLUSH_DELAY_MS);
      }
      return true;
    },
    [flush]
  );

  // Don't lose the last change when the learner leaves the slide or the tab.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush, slideId]);

  return { state, handleMessage };
}
