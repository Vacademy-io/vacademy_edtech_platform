import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileUploader, parseAllowedFileTypes } from "./file-uploader";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { SUBMIT_ASSIGNMENT_SLIDE_ANSWERS, GET_ASSIGNMENT_ACTIVITY_LOGS } from "@/constants/urls";
import { getPublicUrl } from "@/services/upload_file";
import { v4 as uuidv4 } from "uuid";
import { getUserId } from "@/constants/getUserId";
import { resolveSlideSource } from "@/lib/offline/resolve";
import { refreshProgressAfterSubmit } from "@/utils/study-library/tracking/refreshProgressAfterSubmit";
import { MyInput } from "@/components/design-system/input";
import { Textarea } from "@/components/ui/textarea";
import { useContentStore } from "@/stores/study-library/chapter-sidebar-store";
import { useResolvedPackageSessionId } from "@/hooks/study-library/useResolvedPackageSessionId";
import { getTerminology } from "@/components/common/layout-container/sidebar/utils";
import { RoleTerms, SystemTerms } from "@/types/naming-settings";
import { useSlideDownloadPermission } from "@/hooks/useSlideDownloadPermission";
import { SlideDownloadTypeKey } from "@/constants/slide-download-permission";
import "katex/dist/katex.min.css";
import katex from "katex";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Network } from "@/utils/network-plugin";
import {
  FilePdf,
  FileDoc,
  FileXls,
  FileImage,
  FileVideo,
  FileAudio,
  File as FileGeneric,
  Archive as ArchiveIcon,
  DownloadSimple,
  ArrowSquareOut,
  Eye,
  Clock,
  Hourglass,
  WarningCircle,
} from "@phosphor-icons/react";
import SimplePDFViewer from "@/components/common/simple-pdf-viewer";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { useServerTime, getServerTime } from "@/hooks/use-server-time";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { format, parseISO } from "date-fns";

/** Returns an SVG icon string based on file extension / MIME type */
const getFileIconSvg = (fileName: string, mimeType: string): string => {
  const name = fileName.toLowerCase();
  const type = mimeType.toLowerCase();

  // PDF
  if (type.includes("pdf") || name.endsWith(".pdf")) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M10 12l-2 4h4l-2 4"/></svg>`; // design-lint-ignore: inline SVG icon string literal
  }
  // Images
  if (type.includes("image") || /\.(jpg|jpeg|png|gif|svg|webp|bmp)$/i.test(name)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`; // design-lint-ignore: inline SVG icon string literal
  }
  // Word docs
  if (/\.(doc|docx)$/i.test(name) || type.includes("word")) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`; // design-lint-ignore: inline SVG icon string literal
  }
  // Spreadsheets
  if (/\.(xls|xlsx|csv)$/i.test(name) || type.includes("sheet") || type.includes("excel")) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><rect x="8" y="12" width="8" height="6" rx="1"/></svg>`; // design-lint-ignore: inline SVG icon string literal
  }
  // Video
  if (type.includes("video") || /\.(mp4|mov|avi|webm|mkv)$/i.test(name)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9333ea" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`; // design-lint-ignore: inline SVG icon string literal
  }
  // Audio
  if (type.includes("audio") || /\.(mp3|wav|ogg|aac|flac)$/i.test(name)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ea580c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`; // design-lint-ignore: inline SVG icon string literal
  }
  // Archive
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ca8a04" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>`; // design-lint-ignore: inline SVG icon string literal
  }
  // Generic file
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`; // design-lint-ignore: inline SVG icon string literal
};

/** Download arrow icon */
const downloadIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`; // design-lint-ignore: inline SVG icon string literal

/** Get human-readable file size label from extension */
const getFileTypeLabel = (fileName: string, mimeType: string): string => {
  const name = fileName.toLowerCase();
  const type = mimeType.toLowerCase();
  if (type.includes("pdf") || name.endsWith(".pdf")) return "PDF";
  if (/\.(jpg|jpeg)$/i.test(name) || type.includes("jpeg")) return "JPEG";
  if (name.endsWith(".png") || type.includes("png")) return "PNG";
  if (/\.(doc|docx)$/i.test(name) || type.includes("word")) return "Word";
  if (/\.(xls|xlsx)$/i.test(name) || type.includes("sheet")) return "Excel";
  if (/\.(ppt|pptx)$/i.test(name) || type.includes("presentation")) return "PPT";
  if (name.endsWith(".csv")) return "CSV";
  if (/\.(mp4|mov|avi|webm)$/i.test(name) || type.includes("video")) return "Video";
  if (/\.(mp3|wav|ogg)$/i.test(name) || type.includes("audio")) return "Audio";
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return "Archive";
  return "File";
};

/** Extract a usable filename from a presigned S3 URL (strips UUID prefix). */
const fileNameFromUrl = (url: string, fallback: string): string => {
  try {
    const pathname = new URL(url).pathname;
    const raw = decodeURIComponent(pathname.split("/").pop() || "");
    if (!raw) return fallback;
    return raw.replace(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_]/i,
      ""
    );
  } catch {
    return fallback;
  }
};

const extFromName = (name: string): string =>
  (name.split("?")[0]?.split("#")[0]?.split(".").pop() || "").toLowerCase();

const isPdfExt = (ext: string) => ext === "pdf";

const FileTypeIcon = ({
  ext,
  className,
}: {
  ext: string;
  className?: string;
}) => {
  if (isPdfExt(ext)) return <FilePdf className={className} weight="duotone" />;
  if (["doc", "docx"].includes(ext))
    return <FileDoc className={className} weight="duotone" />;
  if (["xls", "xlsx", "csv"].includes(ext))
    return <FileXls className={className} weight="duotone" />;
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext))
    return <FileImage className={className} weight="duotone" />;
  if (["mp4", "mov", "avi", "webm", "mkv"].includes(ext))
    return <FileVideo className={className} weight="duotone" />;
  if (["mp3", "wav", "ogg", "aac", "flac"].includes(ext))
    return <FileAudio className={className} weight="duotone" />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext))
    return <ArchiveIcon className={className} weight="duotone" />;
  return <FileGeneric className={className} weight="duotone" />;
};

const fileTypeColor = (ext: string): string => {
  if (isPdfExt(ext)) return "text-red-600";
  if (["doc", "docx"].includes(ext)) return "text-blue-600";
  if (["xls", "xlsx", "csv"].includes(ext)) return "text-emerald-600";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext))
    return "text-purple-600";
  return "text-gray-500";
};

interface PreviewRequest {
  url: string;
  fileName: string;
}

/** Parse a backend datetime string (LocalDateTime → "YYYY-MM-DDTHH:mm:ss")
 *  or legacy date-only ("YYYY-MM-DD"). Returns ms-epoch, or null on failure. */
const parseAssignmentDate = (raw?: string | null): number | null => {
  if (!raw) return null;
  const normalized = raw.length <= 10 ? `${raw}T00:00:00` : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
};

/** "Mar 25, 2026 at 11:59 PM" — used in the description meta block. */
const formatDateTime = (raw?: string | null): string => {
  if (!raw) return "N/A";
  const normalized = raw.length <= 10 ? `${raw}T00:00:00` : raw;
  try {
    return format(parseISO(normalized), "MMM d, yyyy 'at' h:mm a");
  } catch {
    return raw;
  }
};

/** Countdown formatter: "2d 4h 12m" (drops days/hours when zero). */
const formatCountdown = (ms: number): string => {
  const total = Math.max(0, ms);
  const day = 86_400_000;
  const hour = 3_600_000;
  const minute = 60_000;
  if (total >= day) {
    const d = Math.floor(total / day);
    const h = Math.floor((total % day) / hour);
    return `${d}d ${h}h`;
  }
  if (total >= hour) {
    const h = Math.floor(total / hour);
    const m = Math.floor((total % hour) / minute);
    return `${h}h ${m}m`;
  }
  if (total >= minute) {
    const m = Math.floor(total / minute);
    const s = Math.floor((total % minute) / 1000);
    return `${m}m ${s}s`;
  }
  return `${Math.floor(total / 1000)}s`;
};

/** Live countdown / status badge for an assignment's submission window.
 *  Renders nothing when both bounds are null (assignment is always open).
 *  `now` is supplied by the parent so all consumers share one ticker. */
const AssignmentWindowBadge = ({
  liveDate,
  endDate,
  now,
}: {
  liveDate?: string | null;
  endDate?: string | null;
  now: number;
}) => {
  const { t } = useTranslation("libraryCommonA");
  const liveTs = parseAssignmentDate(liveDate);
  const endTs = parseAssignmentDate(endDate);
  if (liveTs == null && endTs == null) return null;

  // State 1: before live_date
  if (liveTs != null && now < liveTs) {
    const remaining = liveTs - now;
    return (
      <span className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        "bg-blue-50 text-blue-700"
      )}>
        <Clock className="size-3.5" weight="duotone" />
        {t("assignmentSlide.opensInCountdown", { countdown: formatCountdown(remaining) })}
      </span>
    );
  }

  // State 2: within window
  if (endTs != null && now <= endTs) {
    const remaining = endTs - now;
    const isCritical = remaining < 60 * 60 * 1000; // <1h
    const isWarning = !isCritical && remaining < 24 * 60 * 60 * 1000; // <24h
    return (
      <span className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        isCritical && "bg-red-50 text-red-700 animate-pulse",
        isWarning && "bg-amber-50 text-amber-700",
        !isCritical && !isWarning && "bg-emerald-50 text-emerald-700"
      )}>
        <Hourglass className="size-3.5" weight="duotone" />
        {t("assignmentSlide.closesInCountdown", { countdown: formatCountdown(remaining) })}
      </span>
    );
  }

  // State 3: past end_date (or only live_date present and past it — fall here)
  if (endTs != null && now > endTs) {
    return (
      <span className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
        "bg-amber-50 text-amber-700"
      )}>
        <WarningCircle className="size-3.5" weight="duotone" />
        {t("assignmentSlide.closedAgoLateAccepted", { ago: formatCountdown(now - endTs) })}
      </span>
    );
  }

  // Only live_date is set and we're past it — assignment is "Open"
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
      "bg-emerald-50 text-emerald-700"
    )}>
      <Hourglass className="size-3.5" weight="duotone" />
      {t("assignmentSlide.openBadge")}
    </span>
  );
};

interface RichTextAttachment {
  url: string;
  fileName: string;
  mimeType: string;
}

const FILE_EXT_PATTERN =
  /\.(pdf|docx?|xlsx?|csv|pptx?|zip|rar|7z|tar|gz|jpg|jpeg|png|gif|svg|webp|mp4|mov|webm|mp3|wav|ogg)(\?|#|$)/i;

/** Parse rich-text HTML for file-attachment anchors. Returns the cleaned HTML
 *  (with attachments removed so we don't display them twice) and the extracted
 *  attachment list. Runs at render time, not via DOM mutation — reliable even
 *  when the legacy HtmlWithKatex enhancement fails. */
const extractAndStripAttachments = (
  html: string,
  attachmentFallbackName: string
): { cleanHtml: string; attachments: RichTextAttachment[] } => {
  if (!html || typeof DOMParser === "undefined") {
    return { cleanHtml: html, attachments: [] };
  }
  try {
    // DOMParser with "text/html" auto-wraps fragments in <html><body>,
    // so we read from doc.body without wrapping the input ourselves.
    const doc = new DOMParser().parseFromString(html, "text/html");
    const anchors = doc.querySelectorAll('a[data-attachment="true"], a[href]');
    const attachments: RichTextAttachment[] = [];
    const seen = new Set<string>();

    anchors.forEach((node) => {
      const anchor = node as HTMLAnchorElement;
      const href = anchor.getAttribute("href") || "";
      if (!href || href === "#") return;
      const name =
        anchor.getAttribute("name") || anchor.textContent?.trim() || "";
      const type = anchor.getAttribute("type") || "";
      const isAttachment = anchor.getAttribute("data-attachment") === "true";
      const isFileLink =
        FILE_EXT_PATTERN.test(href) || (!!name && FILE_EXT_PATTERN.test(name));
      if (!isAttachment && !isFileLink) return;

      if (!seen.has(href)) {
        seen.add(href);
        attachments.push({
          url: href,
          fileName: name || href.split("/").pop() || attachmentFallbackName,
          mimeType: type,
        });
      }
      anchor.parentNode?.removeChild(anchor);
    });

    return {
      cleanHtml: doc.body?.innerHTML || "",
      attachments,
    };
  } catch {
    return { cleanHtml: html, attachments: [] };
  }
};

/** Inline card for a single file attachment. Opens PDFs in a modal preview;
 *  other types fall back to "Open" / "Download" actions.
 *  Accepts either a `fileId` (fetches signed URL) or `directUrl` (used as-is). */
const AttachmentPreview = ({
  fileId,
  directUrl,
  fileName: explicitFileName,
  mimeType,
  fallbackLabel,
  onPreviewPdf,
  tone = "neutral",
}: {
  fileId?: string;
  directUrl?: string;
  fileName?: string;
  mimeType?: string;
  fallbackLabel: string;
  onPreviewPdf: (req: PreviewRequest) => void;
  tone?: "neutral" | "graded";
}) => {
  const { t } = useTranslation("libraryCommonA");
  const [url, setUrl] = useState<string | null>(directUrl || null);
  const [loading, setLoading] = useState(!directUrl);
  const [error, setError] = useState(false);
  const revokeRef = useRef<(() => void) | null>(null);
  const { activeItem } = useContentStore();

  // Whether this user's role is allowed to download assignment files.
  const { canDownload } = useSlideDownloadPermission();
  const allowDownload = canDownload(SlideDownloadTypeKey.ASSIGNMENT);

  useEffect(() => {
    revokeRef.current?.();
    revokeRef.current = null;
    if (directUrl) {
      setUrl(directUrl);
      setLoading(false);
      setError(false);
      return;
    }
    if (!fileId) {
      setError(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    // Offline-aware resolution (plan §B4): assignment attachments (question
    // media / uploaded reference files) resolve through the same offline
    // decrypt path as other downloadable assets while offline; online keeps
    // the existing getPublicUrl behavior untouched.
    const resolve = async () => {
      const { connected } = await Network.getStatus();
      if (connected) return getPublicUrl(fileId);
      const userId = await getUserId();
      if (!userId || !activeItem?.id) return getPublicUrl(fileId);
      const result = await resolveSlideSource({
        userId,
        fileId,
        slideId: activeItem.id,
        mimeType: mimeType || "application/octet-stream",
        resolveRemoteUrl: () => getPublicUrl(fileId),
      });
      if (result.kind === "offline-blob" && result.revoke) {
        revokeRef.current = result.revoke;
      }
      return result.url ?? null;
    };
    resolve()
      .then((resolved) => {
        if (cancelled) return;
        if (!resolved) {
          setError(true);
        } else {
          setUrl(resolved);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      revokeRef.current?.();
      revokeRef.current = null;
    };
  }, [fileId, directUrl, mimeType, activeItem?.id]);

  const mimeExt = mimeType?.toLowerCase().includes("pdf") ? "pdf" : "";
  const ext = mimeExt || (url ? extFromName(url) || extFromName(fallbackLabel) : extFromName(fallbackLabel));
  const fileName = explicitFileName || (url ? fileNameFromUrl(url, fallbackLabel) : fallbackLabel);
  const typeLabel = ext ? ext.toUpperCase() : t("assignmentSlide.genericFileType");
  const canPreview = !!url && isPdfExt(ext);

  const triggerDownload = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const isGraded = tone === "graded";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-white transition-colors",
        isGraded ? "border-emerald-200" : "border-gray-200"
      )}
    >
      <div
        className={cn(
          "flex items-start gap-3 px-3 py-3 sm:px-4",
          isGraded ? "bg-emerald-50" : "bg-gray-50"
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white shadow-sm sm:h-11 sm:w-11">
          {loading ? (
            <span className="size-5 animate-pulse rounded-sm bg-gray-200" />
          ) : (
            <FileTypeIcon
              ext={ext}
              className={cn("size-6", isGraded ? "text-emerald-600" : fileTypeColor(ext))}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium sm:text-base",
              isGraded ? "text-emerald-900" : "text-gray-900"
            )}
            title={fileName}
          >
            {loading ? t("assignmentSlide.loadingAttachment") : error ? t("assignmentSlide.attachmentUnavailable") : fileName}
          </p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              isGraded ? "text-emerald-700" : "text-gray-500"
            )}
          >
            {error ? t("assignmentSlide.couldNotLoadFile") : t("assignmentSlide.typeDocument", { type: typeLabel })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-2 py-2 sm:px-3">
        {canPreview && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!url}
            onClick={() => url && onPreviewPdf({ url, fileName })}
            className="h-9"
          >
            <Eye className="me-1.5 size-4" />
            {t("assignmentSlide.preview")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={!url}
          onClick={() =>
            url && window.open(url, "_blank", "noopener,noreferrer")
          }
          className="h-9"
        >
          <ArrowSquareOut className="me-1.5 size-4" />
          {t("assignmentSlide.open")}
        </Button>
        {allowDownload && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!url}
            onClick={triggerDownload}
            className="h-9"
          >
            <DownloadSimple className="me-1.5 size-4" />
            {t("common.download")}
          </Button>
        )}
      </div>
    </div>
  );
};

/** Renders HTML content with KaTeX math support and enhanced attachment rendering */
const HtmlWithKatex = ({
  html,
  className = "",
  onPreviewPdf,
}: {
  html: string;
  className?: string;
  onPreviewPdf?: (req: PreviewRequest) => void;
}) => {
  const { t } = useTranslation("libraryCommonA");
  const ref = useRef<HTMLDivElement>(null);
  const previewRef = useRef(onPreviewPdf);
  useEffect(() => {
    previewRef.current = onPreviewPdf;
  }, [onPreviewPdf]);

  useEffect(() => {
    if (!ref.current) return;
    // Re-render math-inline/math-display spans with data-latex attributes
    const mathSpans = ref.current.querySelectorAll(
      "span.math-inline[data-latex], span.math-display[data-latex], div.math-display[data-latex], span[data-latex], div[data-latex]"
    );
    mathSpans.forEach((span) => {
      const latex = span.getAttribute("data-latex");
      if (!latex) return;
      const isDisplay = span.classList.contains("math-display");
      try {
        katex.render(latex, span as HTMLElement, {
          throwOnError: false,
          displayMode: isDisplay,
        });
      } catch {
        // Keep original content on failure
      }
    });

    // Helper: style an anchor as a file download card
    const enhanceAnchorAsFileCard = (anchor: HTMLAnchorElement, fileName: string, mimeType: string) => {
      const typeLabel = getFileTypeLabel(fileName, mimeType);
      const iconSvg = getFileIconSvg(fileName, mimeType);

      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
      anchor.removeAttribute("style");
      // design-lint-ignore: DOM style injection for dynamic file card component (hex colors in cssText string)
      const cardBg = "#f9fafb"; // design-lint-ignore: DOM style injection
      const cardBorder = "#e5e7eb"; // design-lint-ignore: DOM style injection
      const cardText = "#111827"; // design-lint-ignore: DOM style injection
      const iconBg = "#f3f4f6"; // design-lint-ignore: DOM style injection
      const mutedText = "#6b7280"; // design-lint-ignore: DOM style injection
      const btnBg = "#111827"; // design-lint-ignore: DOM style injection
      const btnText = "#ffffff"; // design-lint-ignore: DOM style injection
      const hoverBg = "#f3f4f6"; // design-lint-ignore: DOM style injection
      const hoverBorder = "#d1d5db"; // design-lint-ignore: DOM style injection
      anchor.style.cssText = [
        "display: flex; align-items: center; gap: 12px;",
        `background: ${cardBg}; padding: 14px 18px; border-radius: 10px;`,
        `border: 1px solid ${cardBorder}; text-decoration: none; color: ${cardText};`,
        "transition: all 0.15s ease; cursor: pointer; max-width: 480px;",
        "margin: 8px 0;",
      ].join(" ");
      anchor.innerHTML = [
        `<span style="display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 8px; background: ${iconBg}; flex-shrink: 0;">`,
        iconSvg,
        "</span>",
        `<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1;">`,
        `<span style="font-size: 14px; font-weight: 500; color: ${cardText}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">`,
        fileName,
        "</span>",
        `<span style="font-size: 12px; color: ${mutedText};">`,
        t("assignmentSlide.typeDocument", { type: typeLabel }),
        "</span>",
        "</span>",
        `<span style="flex-shrink: 0; display: flex; align-items: center; gap: 6px; background: ${btnBg}; color: ${btnText}; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500;">`,
        downloadIconSvg.replace('stroke="#6b7280"', `stroke="${btnText}"`), // design-lint-ignore: SVG string attribute replacement
        t("common.download"),
        "</span>",
      ].join("");
      anchor.addEventListener("mouseenter", () => {
        anchor.style.background = hoverBg;
        anchor.style.borderColor = hoverBorder;
      });
      anchor.addEventListener("mouseleave", () => {
        anchor.style.background = cardBg;
        anchor.style.borderColor = cardBorder;
      });
    };

    // 1. Enhance existing attachment links and file links
    const allLinks = ref.current.querySelectorAll('a[data-attachment="true"], a[href]');
    allLinks.forEach((link) => {
      if (link.getAttribute("data-enhanced")) return;

      const anchor = link as HTMLAnchorElement;
      const href = anchor.getAttribute("href") || "";
      const isAttachment = anchor.getAttribute("data-attachment") === "true";
      const fileName = anchor.getAttribute("name") || anchor.textContent?.trim() || "File";

      const fileExtPattern = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|rar|7z|tar|gz|mp4|mp3|wav|jpg|jpeg|png|gif|svg)$/i;
      const isFileLink = fileExtPattern.test(href) || fileExtPattern.test(fileName);

      if (!isAttachment && !isFileLink) return;

      link.setAttribute("data-enhanced", "true");
      const mimeType = anchor.getAttribute("type") || "";
      enhanceAnchorAsFileCard(anchor, fileName, mimeType);

      // For PDFs, intercept the click and open the in-app preview dialog
      // instead of navigating to a new tab. Falls through to default
      // navigation when no preview handler is wired.
      const isPdf =
        /\.pdf(\?|#|$)/i.test(href) ||
        /\.pdf$/i.test(fileName) ||
        mimeType.toLowerCase().includes("pdf");
      if (isPdf) {
        anchor.addEventListener("click", (e) => {
          if (!previewRef.current || !href || href === "#") return;
          e.preventDefault();
          previewRef.current({ url: href, fileName });
        });
      }
    });

    // 2. Detect plain text that looks like file references (UUID-filename.ext pattern)
    // e.g. "71862984-686c-4f50-a9d6-a3a798006508-3._thesis_montreal_protocol_and_the_uae_(2).pdf"
    const fileIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[-_](.+\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|rar|jpg|jpeg|png|gif|mp4|mp3))/i;
    const walker = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT, null);
    const textNodesToReplace: { node: Text; fileId: string; displayName: string }[] = [];

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
      // Skip if already inside an enhanced element
      if (textNode.parentElement?.closest('[data-enhanced]')) continue;

      const text = textNode.textContent || "";
      const match = text.match(fileIdPattern);
      if (match) {
        const fileId = match[0];
        // Extract display name: remove UUID prefix and clean up underscores
        const rawName = match[1] || fileId;
        const displayName = rawName
          .replace(/^[\d]+\.?\s*_?/, (m) => m.replace(/_/g, ' '))
          .replace(/_/g, ' ')
          .replace(/\(\s*/g, '(')
          .replace(/\s*\)/g, ')');
        textNodesToReplace.push({ node: textNode, fileId, displayName });
      }
    }

    textNodesToReplace.forEach(({ node, fileId, displayName }) => {
      const anchor = document.createElement("a");
      anchor.setAttribute("href", "#");
      anchor.setAttribute("data-enhanced", "true");
      anchor.setAttribute("data-file-id", fileId);

      // Extract extension for mime type detection
      const ext = displayName.split('.').pop() || "";

      enhanceAnchorAsFileCard(anchor, displayName, ext);

      // Override click to use getPublicUrl. For PDFs, open in the in-app
      // preview dialog; for other types, fall back to a new tab.
      anchor.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          const url = await getPublicUrl(fileId);
          if (!url) {
            toast.error(t("assignmentSlide.couldNotLoadFileUrlToast"));
            return;
          }
          const isPdf = /\.pdf$/i.test(displayName);
          if (isPdf && previewRef.current) {
            previewRef.current({ url, fileName: displayName });
          } else {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        } catch {
          toast.error(t("assignmentSlide.failedToDownloadFileToast"));
        }
      });

      // Replace the text node with the anchor
      const parent = node.parentNode;
      if (parent) {
        const fullText = node.textContent || "";
        const matchIndex = fullText.indexOf(fileId);
        if (matchIndex >= 0) {
          const before = fullText.substring(0, matchIndex);
          const after = fullText.substring(matchIndex + fileId.length);
          const fragment = document.createDocumentFragment();
          if (before.trim()) fragment.appendChild(document.createTextNode(before));
          fragment.appendChild(anchor);
          if (after.trim()) fragment.appendChild(document.createTextNode(after));
          parent.replaceChild(fragment, node);
        }
      }
    });
  }, [html]);

  return (
    <div
      ref={ref}
      className={className}
      dangerouslySetInnerHTML={{ __html: html || "" }}
    />
  );
};

interface QuestionResponseMap {
  [key: string]: {
    value: string | string[];
    type: string;
  };
}

interface Option {
  id: string;
  text: {
    content: string;
  };
}

interface Question {
  id: string;
  text_data: {
    content: string;
  };
  question_type?: string;
  question_order?: number;
  options?: Option[];
  re_attempt_count?: number;
  options_json?: string;
  status?: string;
  new_question?: boolean;
}

interface AssignmentSlideProps {
  assignmentData: {
    id: string;
    text_data?: {
      content: string;
    };
    parent_rich_text?: {
      content: string;
    };
    live_date: string;
    end_date: string;
    re_attempt_count: number;
    total_marks?: number | null;
    passing_marks?: number | null;
    comma_separated_media_ids?: string;
    questions?: Question[];
  };
  onUpload: (
    file: File
  ) => Promise<{ success: boolean; fileId?: string; error?: string }>;
  isUploading: boolean;
}

const AssignmentSlide = ({
  assignmentData,
  onUpload,
  isUploading,
}: AssignmentSlideProps) => {
  const { t } = useTranslation("libraryCommonA");
  const { activeItem } = useContentStore();
  const resolvePackageSessionId = useResolvedPackageSessionId();
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploadedFileIds, setUploadedFileIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const [questionResponses, setQuestionResponses] =
    useState<QuestionResponseMap>({});
  const [numericValuesMap, setNumericValuesMap] = useState<
    Record<string, string>
  >({});
  const [pdfPreview, setPdfPreview] = useState<PreviewRequest | null>(null);
  // Student Display Settings → Course settings → Assignment (both off by default).
  const [assignmentDisplay, setAssignmentDisplay] = useState({
    hideAttemptsAllowed: false,
    hideRepeatedTitle: false,
  });
  useEffect(() => {
    let alive = true;
    getStudentDisplaySettings(false)
      .then((s) => {
        if (!alive) return;
        setAssignmentDisplay({
          hideAttemptsAllowed: s?.courseSettings?.assignment?.hideAttemptsAllowed === true,
          hideRepeatedTitle: s?.courseSettings?.assignment?.hideRepeatedTitle === true,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  // Real time the learner has had this slide open (mount → submit) so the
  // reported "Time Spent" reflects actual engagement, not a fake 1 minute.
  const activityStartRef = useRef<number>(Date.now());

  // Live server-time-aware window status. Ticks every second so the submit
  // gate / banner flip in real time as the window opens or closes.
  const { data: serverTimeData } = useServerTime();
  const [windowNow, setWindowNow] = useState<number>(() =>
    getServerTime(serverTimeData)
  );
  useEffect(() => {
    setWindowNow(getServerTime(serverTimeData));
    const id = setInterval(
      () => setWindowNow(getServerTime(serverTimeData)),
      1000
    );
    return () => clearInterval(id);
  }, [serverTimeData]);

  // Extract any file attachments embedded in the rich-text description so we
  // can render them as proper interactive cards (the legacy HtmlWithKatex DOM
  // enhancement is unreliable in some setups).
  const richTextProcessed = useMemo(
    () =>
      extractAndStripAttachments(
        assignmentData.parent_rich_text?.content || "",
        t("assignmentSlide.attachmentFallbackName")
      ),
    [assignmentData.parent_rich_text?.content, t]
  );

  const mediaIdsField = assignmentData.comma_separated_media_ids || "";
  const idAttachments = useMemo(
    () =>
      mediaIdsField && !mediaIdsField.startsWith("types:")
        ? mediaIdsField.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    [mediaIdsField]
  );

  const hasAnyAttachments =
    idAttachments.length > 0 || richTextProcessed.attachments.length > 0;

  // Fetch grading results and submission history for this assignment
  const slideId = activeItem?.id || '';
  const { data: gradingData } = useQuery({
    queryKey: ['ASSIGNMENT_GRADING_RESULTS', slideId],
    queryFn: async () => {
      const userId = await getUserId();
      const response = await authenticatedAxiosInstance.get(GET_ASSIGNMENT_ACTIVITY_LOGS, {
        params: { userId, slideId, pageNo: 0, pageSize: 100 },
      });
      return response.data;
    },
    enabled: !!slideId,
    staleTime: 30 * 1000,
  });

  // Count actual assignment submissions (exclude llm_assignment etc.)
  const assignmentLogs = gradingData?.content?.filter(
    (item: any) => item.source_type === 'ASSIGNMENT'
  ) || [];
  const submissionCount = assignmentLogs.length;
  const maxAttempts = assignmentData.re_attempt_count || 0;
  const attemptsExhausted = maxAttempts > 0 && submissionCount >= maxAttempts;

  // Temporal gating derived from the live tick. `notYetOpen` is a hard block
  // (matches backend); `isLate` is allowed but flagged on the server.
  const liveTs = parseAssignmentDate(assignmentData.live_date);
  const endTs = parseAssignmentDate(assignmentData.end_date);
  const notYetOpen = liveTs != null && windowNow < liveTs;
  const isLate = endTs != null && windowNow > endTs;

  // Extract latest submission with tracked data
  const latestWithData = assignmentLogs.find(
    (item: any) => item.assignment_slides?.length > 0
  );
  const latestSubmission = latestWithData?.assignment_slides?.[0];
  const gradedMarks = latestSubmission?.marks ?? null;
  const gradedFeedback = latestSubmission?.feedback ?? null;
  const checkedFileId = latestSubmission?.checked_file_id ?? null;
  const previousFileIds = latestSubmission?.comma_separated_file_ids
    ?.split(',').filter(Boolean) || [];
  const previousSubmissionLate = !!latestSubmission?.late_submission;
  const totalMarks = assignmentData.total_marks;
  const passingMarks = assignmentData.passing_marks;
  // The submission has marks=0 by default at submission time. So we only treat
  // it as "graded" when the teacher has actually written feedback, uploaded a
  // checked copy, or assigned non-zero marks.
  const isGraded =
    (gradedMarks != null && gradedMarks > 0) ||
    !!gradedFeedback ||
    !!checkedFileId;
  const isPassed = isGraded && gradedMarks != null && passingMarks != null ? gradedMarks >= passingMarks : null;
  const teacherTerm = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);

  // Constants for numeric input
  const isDecimal = false;
  const maxDecimals = 2;

  // Handle file upload
  const handleFileUpload = async (file: File) => {
    try {
      const result = await onUpload(file);
      if (result.success && result.fileId) {
        setUploadedFiles((prev) => [...prev, file]);
        setUploadedFileIds((prev) => [...prev, result.fileId!]);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error uploading file:", error);
      return false;
    }
  };

  // Handle question response change
  const handleResponseChange = (
    questionId: string,
    value: string | string[],
    type: string
  ) => {
    setQuestionResponses((prev) => ({
      ...prev,
      [questionId]: { value, type },
    }));
  };

  // Get question type display name
  const getQuestionTypeDisplay = (type: string) => {
    switch (type) {
      case "MCQS":
        return t("assignmentSlide.questionType.mcqs");
      case "MCQM":
        return t("assignmentSlide.questionType.mcqm");
      case "ONE_WORD":
        return t("assignmentSlide.questionType.oneWord");
      case "LONG_ANSWER":
        return t("assignmentSlide.questionType.longAnswer");
      case "NUMERIC":
        return t("assignmentSlide.questionType.numeric");
      case "TRUE_FALSE":
        return t("assignmentSlide.questionType.trueFalse");
      default:
        return type;
    }
  };

  // Handle numeric input changes
  const handleNumericChange = (questionId: string, value: string) => {
    if (isDecimal) {
      if (/^-?\d*\.?\d*$/.test(value)) {
        if (value.includes(".")) {
          const parts = value.split(".");
          if (parts[1].length <= maxDecimals) {
            setNumericValuesMap((prev) => ({
              ...prev,
              [questionId]: value,
            }));
          }
        } else {
          setNumericValuesMap((prev) => ({
            ...prev,
            [questionId]: value,
          }));
        }
      }
    } else {
      if (/^-?\d*$/.test(value)) {
        setNumericValuesMap((prev) => ({
          ...prev,
          [questionId]: value,
        }));
      }
    }
  };

  // Handle keypad button press for numeric input
  const handleKeyPress = (questionId: string, key: string) => {
    const currentValue = numericValuesMap[questionId] || "";
    if (key === "backspace") {
      setNumericValuesMap((prev) => ({
        ...prev,
        [questionId]: currentValue.slice(0, -1),
      }));
    } else if (key === "clear") {
      setNumericValuesMap((prev) => ({
        ...prev,
        [questionId]: "",
      }));
    } else if (key === "." && isDecimal && !currentValue.includes(".")) {
      setNumericValuesMap((prev) => ({
        ...prev,
        [questionId]: currentValue + ".",
      }));
    } else if (/[0-9]/.test(key)) {
      if (currentValue.includes(".")) {
        const parts = currentValue.split(".");
        if (parts[1].length < maxDecimals) {
          setNumericValuesMap((prev) => ({
            ...prev,
            [questionId]: currentValue + key,
          }));
        }
      } else {
        setNumericValuesMap((prev) => ({
          ...prev,
          [questionId]: currentValue + key,
        }));
      }
    }
  };

  // Submit assignment mutation
  const submitAssignmentMutation = useMutation({
    mutationFn: async () => {
      if (!activeItem) throw new Error("No active item");

      const payload = {
        id: uuidv4(),
        source_id: activeItem.source_id || "",
        source_type: activeItem.source_type || "",
        user_id: "current-user-id",
        slide_id: activeItem.id || "",
        start_time_in_millis: activityStartRef.current,
        end_time_in_millis: Date.now(),
        percentage_watched: 100,
        videos: [],
        documents: [],
        question_slides: [],
        assignment_slides: [
          {
            id: uuidv4(),
            comma_separated_file_ids: uploadedFileIds.join(","),
            date_submitted: new Date().toISOString(),
            marks: 0,
          },
        ],
        video_slides_questions: [],
        new_activity: true,
        concentration_score: {
          id: uuidv4(),
          concentration_score: 100,
          tab_switch_count: 0,
          pause_count: 0,
          answer_times_in_seconds: [],
        },
      };

      const urlParams = new URLSearchParams(window.location.search);
      // Key the submission off the assignment slide's own id (same value the
      // body's slide_id uses), NOT the URL's slideId. The URL param tracks the
      // currently-viewed slide, which can drift to a neighbouring slide (e.g.
      // the answer-key DOCUMENT that follows the assignment in the chapter).
      // The backend resolves this slideId -> source_id -> assignment_slide, so
      // a drifted DOCUMENT id makes it 404 "Assignment slide not found".
      const slideId = activeItem?.id || urlParams.get("slideId") || "";
      const userId = await getUserId();
      // The backend cascades slide -> chapter -> module -> subject -> course
      // progress from these ids. Omitting them (as this call used to) still set
      // the slide to 100% but rolled nothing up, so submitting an assignment as
      // the last action in a chapter left the course percentage untouched until
      // the learner happened to open some other slide. `sessionId` is the URL's
      // name for packageSessionId.
      const chapterId = urlParams.get("chapterId") || "";
      const moduleId = urlParams.get("moduleId") || "";
      const subjectId = urlParams.get("subjectId") || "";
      const packageSessionId =
        urlParams.get("sessionId") || (await resolvePackageSessionId());
      return authenticatedAxiosInstance.post(
        SUBMIT_ASSIGNMENT_SLIDE_ANSWERS,
        payload,
        {
          params: {
            slideId,
            chapterId,
            moduleId,
            subjectId,
            packageSessionId,
            userId,
          },
        }
      );
    },
    onSuccess: () => {
      toast.success(t("assignmentSlide.toast.submitSuccess"));
      queryClient.invalidateQueries({ queryKey: ['ASSIGNMENT_GRADING_RESULTS'] });
      // Reconcile progress UI (chapter/module/course %) after the async
      // completion cascade lands. chapterId comes from the slide route URL,
      // same source the submit uses for slideId.
      const chapterId =
        new URLSearchParams(window.location.search).get("chapterId") || "";
      if (chapterId) {
        void refreshProgressAfterSubmit(queryClient, chapterId);
      }
    },
    onError: (error: unknown) => {
      // Backend returns ErrorInfo { message } via GlobalExceptionHandler when
      // throwing VacademyException (e.g. assignment not yet open).
      const axiosMsg =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message;
      const fallbackMsg = (error as Error)?.message;
      toast.error(axiosMsg || fallbackMsg || t("assignmentSlide.toast.submitFailed"));
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  // Handle assignment submission. Assignments involve file uploads that
  // already require connectivity to have happened (uploadedFileIds come from
  // a prior online upload) — offline submissions aren't queued like
  // video/pdf/audio/quiz activity; they're simply blocked with a clear
  // message so the learner knows to retry once back online.
  const handleSubmit = async () => {
    const status = await Network.getStatus();
    if (!status.connected) {
      toast.error(t("assignmentSlide.toast.needsInternet"));
      return;
    }
    setIsSubmitting(true);
    submitAssignmentMutation.mutate();
  };

  // Render MCQ options (shared for MCQS, MCQM, TRUE_FALSE)
  const renderOptions = (question: Question, isMultiSelect: boolean) => {
    const currentResponse = questionResponses[question.id]?.value || "";
    const qType = question.question_type || "";

    if (!question.options?.length) return null;

    return (
      <div className="space-y-4">
        {question.options.map((option, optIndex) => {
          const isSelected = isMultiSelect
            ? Array.isArray(currentResponse) && currentResponse.includes(option.id)
            : typeof currentResponse === "string" && currentResponse === option.id;

          return (
            <div
              key={option.id}
              className={`flex flex-row-reverse items-center justify-between rounded-lg border p-4 w-full cursor-pointer ${
                isSelected ? "border-primary-500 bg-primary-50" : "border-gray-200"
              }`}
              onClick={() => {
                if (isMultiSelect) {
                  const currentValues = Array.isArray(currentResponse) ? currentResponse : [];
                  const newValues = currentValues.includes(option.id)
                    ? currentValues.filter((id) => id !== option.id)
                    : [...currentValues, option.id];
                  handleResponseChange(question.id, newValues, qType);
                } else {
                  handleResponseChange(question.id, option.id, qType);
                }
              }}
            >
              <div className="relative flex items-center">
                <div
                  className={`w-6 h-6 border rounded-md flex items-center justify-center ${
                    isSelected ? "bg-green-500 border-green-500" : "border-gray-300"
                  }`}
                >
                  {isSelected && <span className="text-white font-bold">✔</span>}
                </div>
              </div>
              <label className={`flex-grow text-sm ${isSelected ? "font-semibold" : "text-gray-700"}`}>
                {qType === "TRUE_FALSE" ? (
                  <HtmlWithKatex html={option.text.content} className="inline" />
                ) : (
                  <>
                    {String.fromCharCode(65 + optIndex)}.{" "}
                    <HtmlWithKatex html={option.text.content} className="inline" />
                  </>
                )}
              </label>
            </div>
          );
        })}
      </div>
    );
  };

  // Render question based on type
  const renderQuestion = (question: Question, index: number) => {
    if (!question.text_data?.content) return null;

    const currentResponse = questionResponses[question.id]?.value || "";
    const qType = question.question_type || "";

    return (
      <div className="mb-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="flex gap-1 text-md font-medium">
            <span className="min-w-fit">{index + 1}.</span>
            <HtmlWithKatex html={question.text_data.content} />
          </h3>
          {qType && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500 sm:ms-4 sm:min-w-fit sm:flex-col sm:items-end sm:gap-y-0 sm:text-sm">
              <span>{t("assignmentSlide.typeLabel", { type: getQuestionTypeDisplay(qType) })}</span>
              {question.re_attempt_count != null && (
                <span>{t("assignmentSlide.attemptsLabel", { value: question.re_attempt_count || t("assignmentSlide.unlimited") })}</span>
              )}
            </div>
          )}
        </div>

        {(() => {
          switch (qType) {
            case "MCQS":
              return renderOptions(question, false);

            case "TRUE_FALSE":
              return renderOptions(question, false);

            case "MCQM":
              return renderOptions(question, true);

            case "ONE_WORD":
              return (
                <div className="w-full max-w-md">
                  <MyInput
                    inputType="text"
                    input={typeof currentResponse === "string" ? currentResponse : ""}
                    onChangeFunction={(e) =>
                      handleResponseChange(question.id, e.target.value, qType)
                    }
                    inputPlaceholder={t("assignmentSlide.placeholder.oneWord")}
                    className="text-xl py-4 font-medium w-full"
                    onCopy={(e) => e.preventDefault()}
                    onCut={(e) => e.preventDefault()}
                    onPaste={(e) => e.preventDefault()}
                  />
                </div>
              );

            case "LONG_ANSWER":
              return (
                <div className="w-full">
                  <Textarea
                    value={typeof currentResponse === "string" ? currentResponse : ""}
                    onChange={(e) =>
                      handleResponseChange(question.id, e.target.value, qType)
                    }
                    placeholder={t("assignmentSlide.placeholder.longAnswer")}
                    className="min-h-reg-200 text-base"
                    onCopy={(e) => e.preventDefault()}
                    onCut={(e) => e.preventDefault()}
                    onPaste={(e) => e.preventDefault()}
                  />
                </div>
              );

            case "NUMERIC":
              return (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <MyInput
                      inputType="text"
                      input={numericValuesMap[question.id] || ""}
                      onChangeFunction={(e) =>
                        handleNumericChange(question.id, e.target.value)
                      }
                      inputPlaceholder={
                        isDecimal ? t("assignmentSlide.placeholder.decimal") : t("assignmentSlide.placeholder.integer")
                      }
                      inputMode="numeric"
                      className="text-xl py-4 font-medium w-full max-w-md"
                      onCopy={(e) => e.preventDefault()}
                      onCut={(e) => e.preventDefault()}
                      onPaste={(e) => e.preventDefault()}
                    />
                  </div>

                  <Card className="mx-auto hidden max-w-md sm:block">
                    <CardContent className="p-card">
                      <div className="grid grid-cols-3 gap-2">
                        {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((num) => (
                          <Button
                            key={num}
                            variant="outline"
                            className="h-14 text-xl font-medium"
                            onClick={() => handleKeyPress(question.id, num.toString())}
                          >
                            {num}
                          </Button>
                        ))}
                        <Button
                          variant="outline"
                          className="h-14 text-xl font-medium"
                          onClick={() => handleKeyPress(question.id, "0")}
                        >
                          0
                        </Button>
                        {isDecimal && (
                          <Button
                            variant="outline"
                            className="h-14 text-xl font-medium"
                            onClick={() => handleKeyPress(question.id, ".")}
                            disabled={numericValuesMap[question.id]?.includes(".")}
                          >
                            .
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          className="h-14 text-xl font-medium"
                          onClick={() => handleKeyPress(question.id, "backspace")}
                        >
                          ←
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <Button
                          variant="outline"
                          className="h-14"
                          onClick={() => handleKeyPress(question.id, "clear")}
                        >
                          {t("assignmentSlide.clear")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );

            default:
              // No question_type — display as read-only text question
              // (student answers via file upload)
              return null;
          }
        })()}
      </div>
    );
  };

  // The card title is the assignment's own title text, else the slide name —
  // which the slide header above already shows. hideRepeatedTitle drops it
  // only in that repeat case; a title with text of its own always shows.
  const cardTitleHtml = assignmentData.text_data?.content || activeItem?.title || "";
  const plainOf = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const titleRepeatsSlideName =
    !plainOf(assignmentData.text_data?.content || "") ||
    plainOf(cardTitleHtml) === plainOf(activeItem?.title || "");
  const showCardTitle = !(assignmentDisplay.hideRepeatedTitle && titleRepeatsSlideName);

  return (
    <div className="w-full max-w-none mx-auto px-2 sm:px-4">
      <Card className="mb-4 sm:mb-6 bg-white shadow-sm">
        <CardHeader className="space-y-2">
          {showCardTitle && (
            <CardTitle className="text-lg sm:text-xl font-medium text-gray-900">
              <HtmlWithKatex html={cardTitleHtml} />
            </CardTitle>
          )}
          <CardDescription className="text-sm sm:text-base text-gray-600">
            <div className="mt-2 flex flex-col gap-2">
              {(assignmentData.live_date || assignmentData.end_date) && (
                <AssignmentWindowBadge
                  liveDate={assignmentData.live_date}
                  endDate={assignmentData.end_date}
                  now={windowNow}
                />
              )}
              <div className="flex flex-col space-y-1">
                {assignmentData.live_date && (
                  <span>
                    <strong className="font-medium">{t("assignmentSlide.startLabel")}</strong>{" "}
                    {formatDateTime(assignmentData.live_date)}
                  </span>
                )}
                {assignmentData.end_date && (
                  <span>
                    <strong className="font-medium">{t("assignmentSlide.dueLabel")}</strong>{" "}
                    {formatDateTime(assignmentData.end_date)}
                  </span>
                )}
                {!assignmentDisplay.hideAttemptsAllowed && (
                  <span>
                    <strong className="font-medium">{t("assignmentSlide.attemptsAllowedLabel")}</strong>{" "}
                    {assignmentData.re_attempt_count || t("assignmentSlide.unlimited")}
                  </span>
                )}
              </div>
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {richTextProcessed.cleanHtml &&
            richTextProcessed.cleanHtml.replace(/<[^>]+>/g, "").trim() !== "" && (
              <HtmlWithKatex
                html={richTextProcessed.cleanHtml}
                className="richtext-content max-w-none text-gray-700 text-sm sm:text-base"
                onPreviewPdf={setPdfPreview}
              />
            )}
        </CardContent>
      </Card>

      {/* Graded Results Banner — shown prominently at top when graded */}
      {isGraded && (
        <Card className="mb-4 sm:mb-6 overflow-hidden border-2 border-emerald-200 bg-white shadow-md">
          {/* Hero strip */}
          <div className="bg-gradient-to-r from-success-50 to-white px-4 sm:px-6 py-4 border-b border-emerald-100">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-emerald-600">
                  {t("assignmentSlide.reviewedBy", { teacher: teacherTerm })}
                </p>
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">
                  {t("assignmentSlide.gradedHeading")}
                </h2>
              </div>
            </div>
          </div>

          <CardContent className="space-y-4 px-4 sm:px-6 py-5">
            {/* Score row — pill drops below the score on very narrow screens */}
            <div className="flex flex-col items-start gap-2 xs:flex-row xs:flex-wrap xs:items-end xs:gap-4">
              <div className="flex flex-col">
                <span className="text-xs font-medium text-gray-500">{t("assignmentSlide.yourScoreLabel")}</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl sm:text-4xl font-bold text-gray-900">
                    {gradedMarks}
                  </span>
                  {totalMarks != null && (
                    <span className="text-lg text-gray-400">{t("assignmentSlide.totalMarksSuffix", { total: totalMarks })}</span>
                  )}
                </div>
              </div>
              {isPassed != null && (
                <span
                  className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                    isPassed
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {isPassed ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      {t("assignmentSlide.passed")}
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      {t("assignmentSlide.notPassed")}
                    </>
                  )}
                </span>
              )}
            </div>

            {/* Feedback */}
            {gradedFeedback && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  {/* design-lint-ignore: inline SVG illustration with fixed stroke color */}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {t("assignmentSlide.teacherFeedbackLabel", { teacher: teacherTerm })}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
                  {gradedFeedback}
                </p>
              </div>
            )}

            {/* Checked Answer Copy */}
            {checkedFileId && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {t("assignmentSlide.checkedAnswerCopyLabel")}
                </p>
                <AttachmentPreview
                  fileId={checkedFileId}
                  fallbackLabel={t("assignmentSlide.markedCopyFallback", { teacher: teacherTerm.toLowerCase() })}
                  onPreviewPdf={setPdfPreview}
                  tone="graded"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Assignment files — combines comma_separated_media_ids attachments
          with files embedded in the rich-text description. */}
      {hasAnyAttachments && (
        <Card className="mb-4 sm:mb-6 bg-white shadow-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg sm:text-xl font-medium text-gray-900">
              {t("assignmentSlide.filesHeading")}
            </CardTitle>
            <CardDescription className="text-sm sm:text-base text-gray-600">
              {t("assignmentSlide.tapPdfHint")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-stack">
              {idAttachments.map((fileId, idx) => (
                <AttachmentPreview
                  key={`id-${fileId}`}
                  fileId={fileId}
                  fallbackLabel={t("assignmentSlide.documentFallback", { number: idx + 1 })}
                  onPreviewPdf={setPdfPreview}
                />
              ))}
              {richTextProcessed.attachments.map((att, idx) => (
                <AttachmentPreview
                  key={`url-${att.url}`}
                  directUrl={att.url}
                  fileName={att.fileName}
                  mimeType={att.mimeType}
                  fallbackLabel={att.fileName || t("assignmentSlide.attachmentFallbackNumbered", { number: idx + 1 })}
                  onPreviewPdf={setPdfPreview}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Questions Section */}
      {assignmentData.questions && assignmentData.questions.length > 0 && (
        <Card className="mb-4 sm:mb-6 bg-white shadow-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg sm:text-xl font-medium text-gray-900">
              {t("assignmentSlide.questionsHeading")}
            </CardTitle>
            <CardDescription className="text-sm sm:text-base text-gray-600">
              {t("assignmentSlide.answerAllHint")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {assignmentData.questions
              .filter((q: Question) => q.text_data?.content)
              .map((question: Question, index: number) => (
                <div
                  key={question.id}
                  className="mb-6 pb-6 border-b border-gray-200 last:border-0 last:mb-0 last:pb-0"
                >
                  {renderQuestion(question, index)}
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Previously Submitted Files */}
      {previousFileIds.length > 0 && (
        <Card className="mb-4 sm:mb-6 bg-white shadow-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg sm:text-xl font-medium text-gray-900">
              {t("assignmentSlide.submittedFilesHeading")}
              {previousSubmissionLate && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                  <WarningCircle className="size-3.5" weight="duotone" />
                  {t("assignmentSlide.lateBadge")}
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-sm sm:text-base text-gray-600">
              {t("assignmentSlide.previousSubmissionHint")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-stack">
              {previousFileIds.map((fileId: string, idx: number) => (
                <AttachmentPreview
                  key={fileId}
                  fileId={fileId}
                  fallbackLabel={t("assignmentSlide.submissionFileFallback", { number: idx + 1 })}
                  onPreviewPdf={setPdfPreview}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* File Upload & Submit — gated on attempts and the submission window. */}
      {attemptsExhausted ? (
        <Card className="mb-4 sm:mb-6 bg-white shadow-sm">
          <CardContent className="py-6">
            <p className="text-center text-sm text-gray-500">
              {t("assignmentSlide.maxAttemptsReached", { count: submissionCount, max: maxAttempts })}
            </p>
          </CardContent>
        </Card>
      ) : notYetOpen ? (
        <Card className="mb-4 sm:mb-6 border-blue-200 bg-blue-50 shadow-sm">
          <CardContent className="py-6 text-center">
            <Clock className="mx-auto mb-2 size-6 text-blue-600" weight="duotone" />
            <p className="text-sm font-medium text-blue-900">
              {t("assignmentSlide.opensOn", { date: formatDateTime(assignmentData.live_date) })}
            </p>
            <p className="mt-1 text-xs text-blue-700">
              {t("assignmentSlide.opensInCountdown", { countdown: formatCountdown(liveTs! - windowNow) })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* File Upload Section */}
          <Card className={cn(
            "mb-4 sm:mb-6 bg-white shadow-sm",
            isLate && "border-amber-200"
          )}>
            <CardHeader className="space-y-1">
              <CardTitle className="text-lg sm:text-xl font-medium text-gray-900">
                {t("assignmentSlide.uploadFilesHeading")}
              </CardTitle>
              <CardDescription className="text-sm sm:text-base text-gray-600">
                {t("assignmentSlide.uploadHint")}
                {maxAttempts > 0 && (
                  <span className="ms-1">
                    {t("assignmentSlide.attemptOfMax", { current: submissionCount + 1, max: maxAttempts })}
                  </span>
                )}
              </CardDescription>
              {isLate && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                  <WarningCircle className="size-4" weight="duotone" />
                  {t("assignmentSlide.lateWindowNotice", { date: formatDateTime(assignmentData.end_date) })}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <FileUploader
                onUpload={handleFileUpload}
                isUploading={isUploading}
                uploadedFiles={uploadedFiles}
                allowedFileTypes={parseAllowedFileTypes(
                  assignmentData.comma_separated_media_ids
                )}
                onRejected={(_file, reason) => toast.error(reason)}
                onRemove={(index) => {
                  setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
                  setUploadedFileIds((prev) => prev.filter((_, i) => i !== index));
                }}
              />
            </CardContent>
          </Card>

          {/* Submit Button — sticky full-width on mobile, inline right-aligned on desktop */}
          <div
            className={cn(
              "sticky bottom-0 z-20 -mx-2 mt-2 border-t border-gray-200 bg-white/95 px-2 py-3 backdrop-blur sm:static sm:mx-0 sm:mt-0 sm:flex sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none",
              isLate && "border-amber-300"
            )}
          >
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || isUploading || uploadedFileIds.length === 0}
              title={uploadedFileIds.length === 0 ? t("assignmentSlide.uploadAtLeastOneFile") : undefined}
              className={cn(
                "w-full rounded-md px-6 py-3 text-sm font-medium transition-colors sm:w-auto sm:py-2.5 sm:text-base",
                isSubmitting || isUploading || uploadedFileIds.length === 0
                  ? "cursor-not-allowed bg-gray-100 text-gray-400"
                  : isLate
                    ? "bg-amber-600 text-white hover:bg-amber-700"
                    : "bg-gray-900 text-white hover:bg-gray-800"
              )}
            >
              {isSubmitting ? t("assignmentSlide.submitting") : isLate ? t("assignmentSlide.submitLate") : t("assignmentSlide.submitAssignment")}
            </button>
          </div>
        </>
      )}

      {/* In-app PDF preview dialog. Lazy-mounts SimplePDFViewer only when open. */}
      <Dialog
        open={!!pdfPreview}
        onOpenChange={(open) => {
          if (!open) setPdfPreview(null);
        }}
      >
        <DialogContent
          className={cn(
            "flex w-full max-w-5xl flex-col gap-0 overflow-hidden p-0"
          )}
          // Viewport-relative size is genuinely dynamic; not expressible as a Tailwind token. design-lint-ignore
          style={{ height: "90vh", width: "95vw", maxHeight: "900px" }}
        >
          {/* Header — note: Radix DialogContent renders its own close button
              at top-right, so we leave the right side padded for it. */}
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 pe-12">
            <DialogTitle className="truncate text-sm font-medium text-gray-900 sm:text-base">
              {pdfPreview?.fileName || t("assignmentSlide.documentPreviewTitle")}
            </DialogTitle>
            {pdfPreview?.url && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  window.open(pdfPreview.url, "_blank", "noopener,noreferrer")
                }
                className="h-9 shrink-0"
              >
                <ArrowSquareOut className="me-1.5 size-4" />
                <span className="hidden sm:inline">{t("assignmentSlide.openInNewTab")}</span>
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-hidden bg-gray-100">
            {pdfPreview && <SimplePDFViewer pdfUrl={pdfPreview.url} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AssignmentSlide;
