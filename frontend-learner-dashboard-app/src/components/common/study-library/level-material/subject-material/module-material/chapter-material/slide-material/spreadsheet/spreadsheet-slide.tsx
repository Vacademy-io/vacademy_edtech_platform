import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { DownloadSimple, FileXls, SpinnerGap } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SheetView } from "@/components/cbe/SheetView";
import { CbeStringsProvider } from "@/components/cbe/cbe-strings";
import { useLearnerCbeStrings } from "@/lib/cbe/learner-cbe-strings";
import { getPublicUrl } from "@/services/upload_file";
import { markSlideCompletion } from "@/services/study-library/tracking-api/mark-slide-completion";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import type { Slide } from "@/hooks/study-library/use-slides";
import type { CompletionContext } from "../mark-complete-button";
import { parseSpreadsheetSlideData, spreadsheetDownloadName } from "./spreadsheet-slide-utils";

/** Seconds on the slide before it counts as viewed. */
const VIEWED_AFTER_MS = 3000;

const saveUrlAs = async (url: string, name: string) => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    // The file host refused a cross-origin fetch: let the browser open it.
    window.open(url, "_blank", "noopener,noreferrer");
  }
};

/**
 * Read-only spreadsheet slide: every worksheet tab in the CBE grid (scrolls
 * both ways), plus a Download button for the original workbook when the
 * teacher allows it. Opening the slide marks it complete, like reading a
 * document.
 */
export function SpreadsheetSlide({
  slide,
  completionContext,
}: {
  slide: Slide;
  completionContext?: CompletionContext;
}) {
  const { t } = useTranslation("studyContent");
  const cbeStrings = useLearnerCbeStrings();
  const queryClient = useQueryClient();
  const data = useMemo(
    () => parseSpreadsheetSlideData(slide.document_slide?.published_data),
    [slide.document_slide?.published_data]
  );
  const [downloading, setDownloading] = useState(false);

  // Mark viewed once per slide, only if it is not complete already.
  const markedRef = useRef<string | null>(null);
  // Latest context without restarting the view timer when the parent re-renders.
  const contextRef = useRef(completionContext);
  contextRef.current = completionContext;
  const alreadyComplete = (slide.percentage_completed || 0) >= getSlideCompletionThreshold();
  useEffect(() => {
    if (!data || alreadyComplete || markedRef.current === slide.id) return;
    const timer = window.setTimeout(() => {
      markedRef.current = slide.id;
      markSlideCompletion({
        slideId: slide.id,
        slideType: "DOCUMENT",
        completed: true,
        ...(contextRef.current ?? {}),
      })
        .then(() => {
          const chapterId = contextRef.current?.chapterId;
          if (chapterId) {
            queryClient.invalidateQueries({ queryKey: ["slides", chapterId] });
          }
        })
        .catch(() => {
          // Not fatal: the learner can still mark it complete by hand.
          markedRef.current = null;
        });
    }, VIEWED_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [data, alreadyComplete, slide.id, queryClient]);

  if (!data) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <p className="text-sm text-neutral-500">{t("spreadsheet.unavailable")}</p>
      </div>
    );
  }

  const canDownload = data.allowDownload && !!data.fileId;
  const downloadName = spreadsheetDownloadName(data, slide.title);
  const downloadExt = downloadName.split(".").pop() || "xlsx";

  const download = async () => {
    if (!data.fileId) return;
    setDownloading(true);
    try {
      const url = await getPublicUrl(data.fileId);
      if (!url) throw new Error("no url");
      await saveUrlAs(url, downloadName);
    } catch {
      toast.error(t("spreadsheet.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <CbeStringsProvider value={cbeStrings}>
      <div className="flex h-full w-full flex-col gap-3 overflow-auto p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <FileXls className="size-5 shrink-0 text-success-600" weight="duotone" />
            <span className="truncate text-sm font-medium text-neutral-700">
              {data.fileName || slide.title}
            </span>
            <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
              {t("spreadsheet.readOnly")}
            </span>
          </div>
          {canDownload && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={download}
              disabled={downloading}
              className="gap-1.5 self-start sm:self-auto"
            >
              {downloading ? (
                <SpinnerGap className="size-4 animate-spin" aria-hidden />
              ) : (
                <DownloadSimple className="size-4" aria-hidden />
              )}
              {t("spreadsheet.download", { ext: downloadExt })}
            </Button>
          )}
        </div>
        <SheetView
          key={slide.id}
          sheet={data.sheet}
          emptyText={t("spreadsheet.empty")}
          className="min-w-0"
        />
      </div>
    </CbeStringsProvider>
  );
}

export default SpreadsheetSlide;
