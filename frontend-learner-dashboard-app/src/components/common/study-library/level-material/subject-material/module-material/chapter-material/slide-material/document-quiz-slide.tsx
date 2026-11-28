import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DotsSixVertical, FilePdf, ListChecks } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useFileUpload } from "@/hooks/use-file-upload";
import { PdfViewerComponent } from "./pdf-viewer-component";
import {
  DOCUMENT_QUIZ_DEFAULT_SPLIT,
  DOCUMENT_QUIZ_MAX_SPLIT,
  DOCUMENT_QUIZ_MIN_SPLIT,
  documentQuizSplitPercent,
  nudgeDocumentQuizSplit,
  type DocumentQuizRef,
} from "./document-quiz-ref";

// The bare PDF renderer, without PDFViewer's reading tracker: the slide is a
// QUIZ, so its progress comes from the quiz alone, exactly like a plain quiz.
const ignoreDocumentLoad = () => {};
const ignorePageChange = () => {};

const isRtl = () =>
  typeof document !== "undefined" && document.documentElement.dir === "rtl";

interface DocumentQuizSlideProps {
  documentRef: DocumentQuizRef;
  /** The slide's ordinary QuizViewer. */
  quiz: ReactNode;
}

/**
 * Document + Quiz slide: the PDF on one side and the quiz on the other, each
 * scrolling on its own, with a draggable divider. On a phone the two become
 * tabs (document first); both stay mounted so switching never loses answers.
 */
export const DocumentQuizSlide = ({ documentRef, quiz }: DocumentQuizSlideProps) => {
  const { t } = useTranslation("studyContent");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { getPublicUrl } = useFileUpload();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"document" | "quiz">("document");
  const [split, setSplit] = useState(DOCUMENT_QUIZ_DEFAULT_SPLIT);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getPublicUrl(documentRef.fileId)
      .then((resolved) => {
        if (cancelled) return;
        if (resolved) setUrl(resolved);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // getPublicUrl is a fresh function each render; the file id is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentRef.fileId]);

  const moveDivider = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(documentQuizSplitPercent(clientX, rect.left, rect.width, isRtl()));
  };

  const tabClass = (active: boolean) =>
    cn(
      "flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "border-primary-500 text-primary-500"
        : "border-transparent text-neutral-500 hover:text-neutral-700"
    );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white animate-in fade-in duration-100 motion-reduce:animate-none">
      <div role="tablist" className="flex shrink-0 border-b border-neutral-200 md:hidden">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "document"}
          className={tabClass(tab === "document")}
          onClick={() => setTab("document")}
        >
          <FilePdf className="size-4" />
          {t("documentQuiz.documentTab")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "quiz"}
          className={tabClass(tab === "quiz")}
          onClick={() => setTab("quiz")}
        >
          <ListChecks className="size-4" />
          {t("documentQuiz.questionsTab")}
        </button>
      </div>

      <div
        ref={containerRef}
        className={cn("flex min-h-0 flex-1 flex-col md:flex-row", dragging && "select-none")}
      >
        <section
          aria-label={t("documentQuiz.documentTab")}
          className={cn(
            // overflow-y-auto, not hidden: on wide screens the PDF viewer sizes itself
            // from the window height, which can be a little taller than this panel.
            "min-h-0 min-w-0 flex-1 flex-col overflow-y-auto md:flex md:flex-none",
            tab === "document" ? "flex" : "hidden"
          )}
          // Inline width: the divider position is a live, learner-dragged value.
          style={isDesktop ? { width: `${split}%` } : undefined}
        >
          {url ? (
            <PdfViewerComponent
              pdfUrl={url}
              handleDocumentLoad={ignoreDocumentLoad}
              handlePageChange={ignorePageChange}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-neutral-500">
              {failed ? t("documentQuiz.loadFailed") : t("documentQuiz.loading")}
            </div>
          )}
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("documentQuiz.resize")}
          aria-valuemin={DOCUMENT_QUIZ_MIN_SPLIT}
          aria-valuemax={DOCUMENT_QUIZ_MAX_SPLIT}
          aria-valuenow={split}
          tabIndex={0}
          className={cn(
            "hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center border-x border-neutral-200 bg-neutral-100 transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 md:flex",
            dragging && "bg-primary-100"
          )}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (dragging) moveDivider(e.clientX);
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setDragging(false);
          }}
          onPointerCancel={() => setDragging(false)}
          onDoubleClick={() => setSplit(DOCUMENT_QUIZ_DEFAULT_SPLIT)}
          onKeyDown={(e) => {
            const next = nudgeDocumentQuizSplit(split, e.key, isRtl());
            if (next === null) return;
            e.preventDefault();
            setSplit(next);
          }}
        >
          <DotsSixVertical className="size-4 text-neutral-400" />
        </div>

        <section
          aria-label={t("documentQuiz.questionsTab")}
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-y-auto md:block",
            tab === "quiz" ? "block" : "hidden"
          )}
        >
          {quiz}
        </section>
      </div>
    </div>
  );
};
