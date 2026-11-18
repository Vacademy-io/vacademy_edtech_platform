import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { AI_REPORT_WEB_HTML, EXPORT_AI_REPORT } from "@/constants/urls";
import { Button } from "@/components/ui/button";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { cn } from "@/lib/utils";

interface AiReportWebViewProps {
  assessmentId: string;
  assessmentName: string;
  attemptId?: string;
  /** Rendered instead when the server cannot produce the on-screen report. */
  fallback: ReactNode;
}

// The rendered report per attempt, kept for the session so switching tabs and coming
// back does not ask the server to build it again. A request still in flight is shared
// too: the page swaps layouts while it loads, and that must not build the report twice.
const renderedReports = new Map<string, string>();
const pendingReports = new Map<string, Promise<string | null>>();

/** A slow server falls back to the summary view instead of spinning forever. */
const REPORT_TIMEOUT_MS = 30_000;

async function currentInstituteId(): Promise<string> {
  const stored = await Preferences.get({ key: "InstituteDetails" });
  try {
    return JSON.parse(stored.value || "{}").id || "";
  } catch {
    return "";
  }
}

function loadReport(assessmentId: string, attemptId?: string): Promise<string | null> {
  const key = `${assessmentId}:${attemptId ?? ""}`;
  const done = renderedReports.get(key);
  if (done) return Promise.resolve(done);
  let pending = pendingReports.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const instituteId = await currentInstituteId();
        const res = await authenticatedAxiosInstance<{ html?: string }>({
          method: "GET",
          url: AI_REPORT_WEB_HTML,
          params: { assessmentId, ...(attemptId ? { attemptId } : {}), instituteId },
          timeout: REPORT_TIMEOUT_MS,
        });
        const html = res.data?.html || null;
        if (html) renderedReports.set(key, html);
        return html;
      } finally {
        pendingReports.delete(key);
      }
    })();
    pendingReports.set(key, pending);
  }
  return pending;
}

/**
 * The learner's AI report on screen. The server renders the same report as the
 * "Download PDF" file (same sections, numbers and report options), laid out for a
 * browser, so what a learner sees here is exactly what they download.
 *
 * The page is shown in a sandboxed iframe with scripts disabled: its styles stay
 * isolated from the app, and the AI-written text inside can never run code.
 */
export function AiReportWebView({
  assessmentId,
  assessmentName,
  attemptId,
  fallback,
}: AiReportWebViewProps) {
  const { t } = useTranslation("layoutCommonB");
  const { t: tAssessment } = useTranslation("assessment");
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [height, setHeight] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = renderedReports.get(`${assessmentId}:${attemptId ?? ""}`);
    if (cached) {
      setHtml(cached);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    loadReport(assessmentId, attemptId)
      .then((report) => {
        if (cancelled) return;
        if (report) {
          setHtml(report);
          setStatus("ready");
        } else {
          setStatus("failed");
        }
      })
      .catch((e) => {
        console.warn("On-screen AI report unavailable, showing the summary view:", e);
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [assessmentId, attemptId]);

  // Grow the iframe to its content, and again when the content reflows: fonts
  // arriving, or the iframe getting wider or narrower (rotated phone, resized window).
  // The observer watches the iframe itself, because an observer from this page is not
  // told when the body inside the iframe changes size. The report lays out again only
  // after the frame has resized, so the height is read on the next animation frame.
  const fitToContent = useCallback(() => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) return;
    const measure = () => setHeight(Math.ceil(doc.body.scrollHeight));
    measure();
    observerRef.current?.disconnect();
    // Old Android WebViews have no ResizeObserver: the height is still set once here.
    if (typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver(() => requestAnimationFrame(measure));
      observerRef.current.observe(frame);
    }
    doc.fonts?.ready.then(measure).catch(() => undefined);
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setDownloadFailed(false);
      const instituteId = await currentInstituteId();
      const res = await authenticatedAxiosInstance({
        method: "GET",
        url: EXPORT_AI_REPORT,
        params: { assessmentId, ...(attemptId ? { attemptId } : {}), instituteId },
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${assessmentName || "ai-report"}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      setDownloadFailed(true);
      setTimeout(() => setDownloadFailed(false), 3000);
    } finally {
      setDownloading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-96 items-center justify-center">
        <DashboardLoader />
      </div>
    );
  }

  if (status === "failed" || !html) return <>{fallback}</>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={downloading}
          className={cn("gap-1.5", downloadFailed && "border-destructive text-destructive")}
        >
          {downloading ? (
            <SpinnerGap className="size-4 animate-spin" />
          ) : (
            <DownloadSimple className="size-4" />
          )}
          {downloading
            ? t("aiReportDetails.generating")
            : downloadFailed
              ? t("aiReportDetails.failed")
              : t("aiReportDetails.downloadPdf")}
        </Button>
      </div>
      <iframe
        ref={frameRef}
        title={tAssessment("aiReport.tabs.analysis")}
        srcDoc={html}
        sandbox="allow-same-origin"
        onLoad={fitToContent}
        className="min-h-96 w-full overflow-hidden rounded-xl border bg-white"
        // Height follows the report's own content, measured after it renders.
        style={{ height: height || undefined }}
      />
    </div>
  );
}

export default AiReportWebView;
