import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadSimple, FileXls, SpinnerGap, WarningCircle } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SheetView } from "@/components/cbe/SheetView";
import { CbeStringsProvider } from "@/components/cbe/cbe-strings";
import { useLearnerCbeStrings } from "@/lib/cbe/learner-cbe-strings";
import { getPublicUrl } from "@/services/upload_file";
import { markSlideCompletion } from "@/services/study-library/tracking-api/mark-slide-completion";
import { getSlideCompletionThreshold } from "@/constants/study-library";
import { SlideDownloadTypeKey } from "@/constants/slide-download-permission";
import { useSlideDownloadPermission } from "@/hooks/useSlideDownloadPermission";
import type { Slide } from "@/hooks/study-library/use-slides";
import type { CompletionContext } from "../mark-complete-button";
import { parseSpreadsheetSlideData, spreadsheetDownloadName } from "./spreadsheet-slide-utils";
import { fetchSpreadsheetGrid } from "./spreadsheet-grid-loader";
import { saveUrl } from "@/lib/download/save-file";

/** Seconds on the slide before it counts as viewed. */
const VIEWED_AFTER_MS = 3000;

/** Saves the workbook; when the file host refuses a cross-origin fetch, the browser opens it. */
const saveUrlAs = (url: string, name: string) => saveUrl(url, name);

/**
 * Read-only spreadsheet slide: every worksheet tab in the CBE grid (scrolls
 * both ways), plus a Download button for the original workbook when the
 * teacher allows it. The slide data holds only metadata; the grid is its own
 * JSON file, fetched when the slide opens. Viewing the loaded grid marks the
 * slide complete, like reading a document.
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
  const gridFileId = data?.sheet ? null : (data?.gridFileId ?? null);
  const gridQuery = useQuery({
    queryKey: ["spreadsheet-slide-grid", gridFileId],
    queryFn: () => fetchSpreadsheetGrid(gridFileId as string),
    enabled: !!gridFileId,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    retry: 1,
  });
  const sheet = data?.sheet ?? gridQuery.data ?? null;
  const [downloading, setDownloading] = useState(false);
  // The institute's Content Protection matrix (Settings) decides who may download
  // files; a workbook is treated like the other uploaded documents (Word files).
  const { canDownload: roleCanDownload } = useSlideDownloadPermission();

  // Mark viewed once per slide, only if it is not complete already.
  const markedRef = useRef<string | null>(null);
  // Latest context without restarting the view timer when the parent re-renders.
  const contextRef = useRef(completionContext);
  contextRef.current = completionContext;
  const alreadyComplete = (slide.percentage_completed || 0) >= getSlideCompletionThreshold();
  useEffect(() => {
    if (!sheet || alreadyComplete || markedRef.current === slide.id) return;
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
  }, [sheet, alreadyComplete, slide.id, queryClient]);

  if (!data) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <p className="text-sm text-neutral-500">{t("spreadsheet.unavailable")}</p>
      </div>
    );
  }

  const canDownload =
    data.allowDownload && !!data.fileId && roleCanDownload(SlideDownloadTypeKey.DOCUMENT_DOC);
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
        {sheet ? (
          <SheetView
            key={slide.id}
            sheet={sheet}
            emptyText={t("spreadsheet.empty")}
            className="min-w-0"
          />
        ) : gridQuery.isError ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center"
          >
            <WarningCircle className="size-6 text-danger-600" aria-hidden />
            <p className="text-sm text-neutral-600">{t("spreadsheet.loadFailed")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => gridQuery.refetch()}
              disabled={gridQuery.isFetching}
            >
              {gridQuery.isFetching && (
                <SpinnerGap className="size-4 animate-spin" aria-hidden />
              )}
              {t("spreadsheet.retry")}
            </Button>
          </div>
        ) : (
          <div
            role="status"
            className="flex items-center justify-center gap-2 rounded-lg border border-neutral-200 p-8 text-sm text-neutral-500"
          >
            <SpinnerGap className="size-5 animate-spin text-primary-500" aria-hidden />
            {t("spreadsheet.loading")}
          </div>
        )}
      </div>
    </CbeStringsProvider>
  );
}

export default SpreadsheetSlide;
