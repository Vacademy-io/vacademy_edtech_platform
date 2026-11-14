"use client";

import type React from "react";

import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { HelpModal } from "@/components/modals/help-modals";
import { useAssessmentStore } from "@/stores/assessment-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Question,
  UploadSimple,
  FileText,
  Clock,
  CloudCheck,
  ArrowsClockwise,
  WarningCircle,
  Calculator as CalculatorIcon,
  PencilSimple,
  SidebarSimple,
} from "@phosphor-icons/react";
import { MyButton } from "@/components/design-system/button";
import { cn } from "@/lib/utils";
import { useLiveTestUi } from "./live-test-ui-context";
import { useLiveTestEngine } from "./engine/live-test-engine-context";
import {
  entireTimerTone,
  formatHms,
  shouldShowEntireTimer,
  type TimerTone,
} from "./engine/clock-logic";
import { useFileUpload } from "@/hooks/use-file-upload";
import type {
  DocumentLoadEvent,
  PageChangeEvent,
} from "@react-pdf-viewer/core";
import { PdfViewerComponent } from "../study-library/level-material/subject-material/module-material/chapter-material/slide-material/pdf-viewer-component";

/** Header clock colours by remaining share of the test (see entireTimerTone). */
const TIMER_TONE_CLASS: Record<TimerTone, string> = {
  danger: "border-danger-200 bg-danger-50 text-danger-600",
  warning: "border-warning-200 bg-warning-50 text-warning-700",
  neutral: "border-neutral-200 bg-neutral-100 text-neutral-800",
};

/** Save-state pill shown beside the assessment name. */
function AutoSaveStatus({
  status,
  compact,
}: {
  status: "idle" | "saving" | "success" | "failed";
  compact?: boolean;
}) {
  const { t } = useTranslation("questionTest");
  const map = {
    idle: {
      Icon: CloudCheck,
      label: t("navbar.autoSave.saved"),
      tone: "text-neutral-500",
    },
    success: {
      Icon: CloudCheck,
      label: t("navbar.autoSave.saved"),
      tone: "text-neutral-500",
    },
    saving: {
      Icon: ArrowsClockwise,
      label: t("navbar.autoSave.saving"),
      tone: "text-neutral-500",
    },
    failed: {
      Icon: WarningCircle,
      label: t("navbar.autoSave.notSaved"),
      tone: "text-danger-600",
    },
  } as const;
  const { Icon, label, tone } = map[status];
  return (
    <span
      className={cn("flex items-center gap-1.5 text-2xs font-medium", tone)}
      role="status"
      aria-live="polite"
    >
      <Icon
        size={compact ? 13 : 14}
        weight="duotone"
        className={cn("flex-none", status === "saving" && "animate-spin")}
      />
      {label}
    </span>
  );
}

export function Navbar() {
  const { t } = useTranslation("questionTest");
  const {
    settings,
    isCompact,
    activeTool,
    toggleTool,
    isRailOpen,
    setRailOpen,
  } = useLiveTestUi();
  // Submit, the clocks, proctoring and the guards live in the engine
  // (engine/live-test-engine.tsx); this header only draws.
  const {
    playMode,
    evaluationType,
    assessmentName,
    instituteId: INSTITUTE_ID,
    userId,
    openSubmitModal,
  } = useLiveTestEngine();
  const {
    assessment,
    entireTestTimer,
    setPdfFile,
    pdfFile,
    currentQuestion,
  } = useAssessmentStore();
  const remoteSaveStatus = useAssessmentStore((s) => s.remoteSaveStatus);

  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isUploading, setIsUploading] = useState(false);

  const { uploadFile, getPublicUrl } = useFileUpload();

  const [pdfDocumentInfo, setPdfDocumentInfo] = useState({
    numPages: 0,
    currentPage: 0,
  });

  interface HelpType {
    type: "instructions" | "alerts" | "reattempt" | "time" | null;
  }

  const [helpType, setHelpType] = useState<HelpType["type"]>(null);

  if (!assessment) return null;

  const handleDocumentLoad = (e: DocumentLoadEvent) => {
    setPdfDocumentInfo((prev) => ({
      ...prev,
      numPages: e.doc.numPages,
    }));
    console.log("pdfDocumentInfo", pdfDocumentInfo);
  };

  const handlePageChange = (e: PageChangeEvent) => {
    setPdfDocumentInfo((prev) => ({
      ...prev,
      currentPage: e.currentPage,
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const fileId = await uploadFile({
        file,
        setIsUploading,
        userId: userId ?? "",
        source: INSTITUTE_ID ?? undefined,
        sourceId: "EVALUATIONS",
      });

      if (fileId) {
        const publicUrl = await getPublicUrl(fileId);
        console.log("Public URL:", publicUrl);
        console.log("File ID:", fileId);
        setPdfFile({
          fileId,
          fileName: file.name,
          fileUrl: publicUrl,
          size: file.size,
          file: file,
        });
        // Open the preview automatically so the learner can verify their
        // uploaded response right away before submitting.
        setShowPdfPreview(true);
      }
    } catch (error) {
      console.error("PDF Upload failed:", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handlePreviewPdf = () => {
    if (pdfFile) {
      setShowPdfPreview(true);
    }
  };

  const showTimer = shouldShowEntireTimer(playMode, entireTestTimer);
  const timerTone = TIMER_TONE_CLASS[
    entireTimerTone(entireTestTimer, assessment.duration)
  ];

  // CODING and CBE (spreadsheet / written) are answered on screen, never on paper.
  const isManualUpload =
    evaluationType === "MANUAL" &&
    currentQuestion?.question_type !== "CODING" &&
    currentQuestion?.question_type !== "CBE_RESPONSE";
  // Tools live in the header on desktop and in the footer's tool menu on a
  // phone, where header width is reserved for the timer and Submit.
  const showHeaderTools = !isCompact;
  // The question rail's own close button only hides it; this is the one place
  // that brings it back, so it stays in the header regardless of rail state.
  const showRailToggle = !isCompact && settings.questionPalette.enabled;

  return (
    <>
      <header className="flex h-14 flex-none items-center gap-2 border-b border-neutral-200 bg-white px-3 md:h-16 md:gap-4 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0">
            {assessmentName && (
              <p className="truncate text-caption font-semibold text-neutral-900 md:text-body">
                {assessmentName}
              </p>
            )}
            <AutoSaveStatus status={remoteSaveStatus} compact={isCompact} />
          </div>
        </div>

        {showTimer && (
          <div
            title={t("navbar.timer.title")}
            className={cn(
              "flex flex-none items-center gap-1.5 rounded-lg border px-2 py-1.5 md:px-3",
              timerTone,
            )}
          >
            <Clock size={15} weight="duotone" className="flex-none" />
            <span className="font-mono text-caption font-semibold tabular-nums md:text-body">
              {formatHms(entireTestTimer)}
            </span>
          </div>
        )}

        <div className="flex flex-none items-center gap-1.5 md:gap-2">
          {showHeaderTools && settings.calculator.enabled && (
            <Button
              variant="outline"
              size="icon"
              aria-label={t("common.tools.calculator")}
              aria-pressed={activeTool === "calculator"}
              onClick={() => toggleTool("calculator")}
              className={cn(
                "size-9 border-neutral-200",
                activeTool === "calculator" &&
                  "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white",
              )}
            >
              <CalculatorIcon size={17} />
            </Button>
          )}
          {showHeaderTools && settings.scratchpad.enabled && (
            <Button
              variant="outline"
              size="icon"
              aria-label={t("common.tools.scratchpad")}
              aria-pressed={activeTool === "scratchpad"}
              onClick={() => toggleTool("scratchpad")}
              className={cn(
                "size-9 border-neutral-200",
                activeTool === "scratchpad" &&
                  "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 hover:text-white",
              )}
            >
              <PencilSimple size={17} />
            </Button>
          )}

          {showRailToggle && (
            <Button
              variant="outline"
              size="icon"
              aria-label={
                isRailOpen
                  ? t("navbar.questionPanel.hide")
                  : t("navbar.questionPanel.show")
              }
              title={
                isRailOpen
                  ? t("navbar.questionPanel.hide")
                  : t("navbar.questionPanel.show")
              }
              aria-pressed={isRailOpen}
              onClick={() => setRailOpen(!isRailOpen)}
              className="size-9 border-neutral-200"
            >
              {/* Open is the default, so it reads as weight (like ViewToggle)
                  rather than the filled "tool active" treatment next door.
                  The glyph draws its bar on the start side; the rail is on
                  the end. */}
              <SidebarSimple
                size={17}
                weight={isRailOpen ? "fill" : "regular"}
                className="-scale-x-100 rtl:scale-x-100"
              />
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("navbar.help.ariaLabel")}
                className="size-9 border-neutral-200"
              >
                <Question size={17} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setHelpType("instructions")}>
                {t("navbar.help.menu.instructions")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpType("alerts")}>
                {t("navbar.help.menu.alerts")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpType("reattempt")}>
                {t("navbar.help.menu.reattempt")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setHelpType("time")}>
                {t("navbar.help.menu.timeIncrease")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {isManualUpload ? (
            <>
              <input
                type="file"
                ref={fileInputRef}
                accept="application/pdf"
                onChange={handleFileUpload}
                className="hidden"
              />

              {pdfFile ? (
                <MyButton
                  scale="small"
                  buttonType="secondary"
                  layoutVariant="default"
                  onClick={handlePreviewPdf}
                  className="flex h-9 items-center gap-2 px-3"
                >
                  <FileText className="size-4" />
                  <span className="hidden md:inline">
                    {t("navbar.pdf.preview")}
                  </span>
                </MyButton>
              ) : (
                <MyButton
                  scale="small"
                  buttonType="primary"
                  layoutVariant="default"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-9 items-center gap-2 px-3"
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <span className="loader size-4"></span>
                  ) : (
                    <UploadSimple className="size-4" />
                  )}
                  {isUploading
                    ? t("navbar.pdf.uploading")
                    : t("navbar.pdf.upload")}
                </MyButton>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={openSubmitModal}
              className="h-9 rounded-lg bg-neutral-900 px-4 text-caption font-semibold text-white transition-colors hover:bg-neutral-800 md:text-body"
            >
              {t("common.submit")}
            </button>
          )}
        </div>
      </header>

      {showPdfPreview && pdfFile ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-5xl h-screen-90 flex flex-col">
            <div className="flex justify-between items-center p-4 border-b">
              {/* <h2 className="text-lg font-semibold">
                PDF Preview: {pdfFile.fileName} {pdfDocumentInfo.currentPage + 1}/{pdfDocumentInfo.numPages}
              </h2> */}
              <Button variant="ghost" onClick={() => setShowPdfPreview(false)}>
                <span className="sr-only">{t("navbar.pdf.back")}</span>←{" "}
                {t("navbar.pdf.back")}
              </Button>
            </div>
            <div className="flex-1 overflow-auto">
              <PdfViewerComponent
                pdfUrl={pdfFile.fileUrl}
                handleDocumentLoad={handleDocumentLoad}
                handlePageChange={handlePageChange}
              />
            </div>
            <div className="flex justify-between p-4 border-t">
              <MyButton
                // variant="outline"
                buttonType="secondary"
                onClick={() => {
                  setShowPdfPreview(false);
                  fileInputRef.current?.click();
                }}
              >
                {t("navbar.pdf.replace")}
              </MyButton>
              <MyButton
                buttonType="primary"
                onClick={() => {
                  setShowPdfPreview(false);
                  openSubmitModal();
                }}
              >
                {t("common.submit")}
              </MyButton>
            </div>
          </div>
        </div>
      ) : null}

      <HelpModal
        open={helpType !== null}
        onOpenChange={(open) => !open && setHelpType(null)}
        type={helpType || "instructions"}
      />
    </>
  );
}
