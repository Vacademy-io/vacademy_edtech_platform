import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { FilePreview } from "@/components/common/file-preview";
import { downloadFileWithName } from "@/services/upload_file";
import { DashboardLoader } from "@/components/core/dashboard-loader";

interface EvaluatedReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileUrl: string | null;
  // Real name + MIME type from media-service so the file renders and downloads
  // in its actual format (PDF, JPEG, PNG, …) rather than assuming a PDF.
  fileName?: string;
  fileType?: string;
  remark?: string | null;
  title?: string;
}

/**
 * In-app viewer for an evaluated / submitted answer file. Renders a PDF with the
 * react-pdf viewer or an uploaded image inline, and — when provided — shows the
 * teacher's remark above it, so the learner sees everything on one screen
 * instead of opening a new browser tab (which fails in the native app for the
 * extension-less S3 URL).
 */
export function EvaluatedReportDialog({
  open,
  onOpenChange,
  fileUrl,
  fileName,
  fileType,
  remark,
  title,
}: EvaluatedReportDialogProps) {
  const { t } = useTranslation("testRecords");
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!fileUrl) return;
    try {
      setDownloading(true);
      await downloadFileWithName(
        fileUrl,
        fileName || title || "download",
        fileType
      );
    } catch {
      toast.error(t("evaluatedReportDialog.downloadError"));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-w-5xl flex-col gap-0 overflow-hidden p-0"
        style={{ /* design-lint-ignore: viewport-relative height for the in-app viewer */ height: "90vh" }}
      >
        <DialogHeader className="shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-neutral-200 px-4 py-3 pe-12">
          <DialogTitle className="truncate text-base font-semibold">
            {title || t("evaluatedReportDialog.defaultTitle")}
          </DialogTitle>
          {fileUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={downloading}
              className="h-9 shrink-0 gap-1.5"
            >
              {downloading ? (
                <SpinnerGap className="size-4 animate-spin" />
              ) : (
                <DownloadSimple className="size-4" />
              )}
              <span className="hidden sm:inline">
                {downloading ? t("common.downloadingEllipsis") : t("common.download")}
              </span>
            </Button>
          )}
        </DialogHeader>

        {remark && remark.trim().length > 0 && (
          <div className="shrink-0 border-b border-primary-100 bg-primary-50 px-4 py-3">
            <p className="text-2xs font-semibold uppercase tracking-wide text-primary-500">
              {t("evaluatedReportDialog.evaluatorRemark")}
            </p>
            <p className="mt-1 whitespace-pre-line text-sm text-neutral-700">
              {remark}
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 bg-neutral-100">
          {fileUrl ? (
            <FilePreview url={fileUrl} fileName={fileName} fileType={fileType} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <DashboardLoader />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EvaluatedReportDialog;
