import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import SimplePDFViewer from "@/components/common/simple-pdf-viewer";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { getFileDetail } from "@/services/upload_file";
import { LEARNER_ANNOTATED_COPY_URL } from "@/constants/urls";
import {
  PdfAnnotationOverlay,
  type Annotation,
  type LayoutMap,
} from "./annotation-overlay/PdfAnnotationOverlay";

interface AnnotatedCopyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  attemptId: string;
  submittedFileId?: string | null;
}

/**
 * Shows the student's own submitted answer sheet with the AI evaluation's
 * annotations (ticks/crosses/margin notes) overlaid on the exact lines they
 * refer to — the same explainable view the teacher reviewed, read-only.
 */
export function AnnotatedCopyDialog({
  open,
  onOpenChange,
  assessmentId,
  attemptId,
  submittedFileId,
}: AnnotatedCopyDialogProps) {
  const { t } = useTranslation("testRecords");
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [layoutMap, setLayoutMap] = useState<LayoutMap | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  // Callback ref so the overlay gets a non-null container on the same tick the
  // PDF wrapper mounts (a bare useRef would still be null at JSX eval time).
  const [pdfContainerEl, setPdfContainerEl] = useState<HTMLDivElement | null>(
    null
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [detail, res] = await Promise.all([
          submittedFileId ? getFileDetail(submittedFileId) : Promise.resolve(null),
          authenticatedAxiosInstance.get(LEARNER_ANNOTATED_COPY_URL, {
            params: { assessmentId, attemptId },
          }),
        ]);
        if (cancelled) return;
        setPdfUrl(detail?.url ?? null);
        setLayoutMap((res.data?.layout_map as LayoutMap) ?? null);
        setAnnotations((res.data?.annotations as Annotation[]) ?? []);
      } catch {
        if (!cancelled) toast.error(t("annotatedCopyDialog.toastError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, assessmentId, attemptId, submittedFileId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-w-5xl flex-col gap-0 overflow-hidden p-0"
        style={{ /* design-lint-ignore: viewport-relative height for the in-app viewer */ height: "90vh" }}
      >
        <DialogHeader className="shrink-0 flex-row items-center justify-between gap-3 space-y-0 border-b border-neutral-200 px-4 py-3 pe-12">
          <DialogTitle className="truncate text-base font-semibold">
            {t("annotatedCopyDialog.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 bg-neutral-100">
          {loading || !pdfUrl ? (
            <div className="flex h-full items-center justify-center">
              <DashboardLoader />
            </div>
          ) : (
            <div ref={setPdfContainerEl} className="relative h-full w-full">
              <SimplePDFViewer pdfUrl={pdfUrl} />
              <PdfAnnotationOverlay
                pdfContainerEl={pdfContainerEl}
                layoutMap={layoutMap}
                annotations={annotations}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AnnotatedCopyDialog;
