/* eslint-disable */
// @ts-nocheck
import { useState, useEffect, useRef, ChangeEvent, Fragment } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Canvas, StaticCanvas } from "fabric";
import {
    UploadSimple as Upload,
    DownloadSimple as Download,
    CaretLeft as ChevronLeft,
    CaretRight as ChevronRight,
    WarningCircle as AlertCircle,
    ArrowsClockwise as RefreshCcw,
    CircleNotch as Loader2,
    Calculator as CalculatorIcon,
    Pen,
    Hash,
    ArrowCounterClockwise as RotateCcw,
    ArrowClockwise as RotateCw,
    SlidersHorizontal,
    DotsThreeVertical,
    CornersOut,
    CornersIn,
    NoteBlank as StickyNote,
} from "@phosphor-icons/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    AlertDialog,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MagnifyingGlassMinus, MagnifyingGlassPlus, X, SidebarSimple, ListNumbers, ArrowUUpLeft, ArrowUUpRight, Info, PaperPlaneTilt } from "@phosphor-icons/react";
import { PDFDocument } from "pdf-lib";
// Lazy-load heavy libs where used
import Calculator from "./calculator";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorPicker } from "@/components/ui/color-picker";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import useCanvasTools from "../-hooks/tools";
import useFabric from "../-hooks/canvas";
import Dropzone, { useDropzone } from "react-dropzone";
import ImportFileImage from '@/assets/svgs/import-file.svg';
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { toast } from "sonner";
import { ProgressBar } from "@/components/design-system/progress-bar";
import Evaluation from "./evaluation";
import { useNavigate, useParams, useRouter } from "@tanstack/react-router";
import { useTimerStore } from "@/stores/evaluation/timer-store";
import {
    submitEvlauationMarks,
    releaseEvaluationResult,
    saveEvaluationDraft,
    getEvaluationDraft,
    EvaluationDraftState,
} from "../../evaluations/-services/evaluation-service";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useInstituteQuery } from "@/services/student-list-section/getInstituteDetails";
import { getTokenDecodedData, getTokenFromCookie } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { useFileUpload } from "@/hooks/use-file-upload";
import { cn } from "@/lib/utils";
import { MyButton } from "@/components/design-system/button";
import { MyDialog } from "@/components/design-system/dialog";
import { useMarksStore, feedbackKey } from "@/stores/evaluation/marks-store";
import { LoadingOverlay, UploadingOverlay } from "./Overlay";
import { readEvalReturnUrl, clearEvalReturnUrl } from "../-utils/eval-return";
import { runEvaluationSubmit } from "../-utils/submit-evaluation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.mjs`;

// Decode a data: URL (e.g. from canvas.toDataURL) into raw bytes for pdf-lib.
const dataUrlToUint8 = (dataUrl: string): Uint8Array => {
    const base64 = dataUrl.split(",")[1] || "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });

// Export raster quality multiplier — matches the on-screen preview's minimum
// devicePixelRatio floor so strokes/text stay crisp in the downloaded PDF.
const RENDER_SCALE = 3;

// Zoom bounds shared by manual zoom and fit-to-width. The floor used to be 0.5,
// which made a phone-camera answer sheet (page boxes several thousand px wide)
// impossible to see whole: both "Zoom out" and "Fit page to width" bottomed out
// at 50% with the page still overflowing the pane. 10% is low enough to fit any
// scan we get while still rendering something rather than nothing.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
// Auto-fit stops higher than manual zoom does. Fitting is what the evaluator LANDS on, and
// a phone-camera page in a phone-width pane fits at ~15% — the whole sheet visible and the
// handwriting unreadable. Better to fit to a quarter scale and let the pane scroll; anyone
// who genuinely wants the whole page smaller can still zoom out to MIN_ZOOM by hand.
const MIN_FIT_ZOOM = 0.25;

// Help text for the tool guide dialog. Tool rows reuse the live `tools` list (so
// icons stay in sync); this keys a short description by the tool's label.
// Module-scope factory (no React context here) — called with the component's
// own `t` once useTranslation is available. Keys stay the English tool labels
// coming from useCanvasTools, which is the lookup identity, not user-facing text.
const buildToolHelp = (t: TFunction): Record<string, string> => ({
    Select: t("toolHelp.select"),
    Pen: t("toolHelp.pen"),
    Tick: t("toolHelp.tick"),
    Cross: t("toolHelp.cross"),
    Text: t("toolHelp.text"),
    Box: t("toolHelp.box"),
    Circle: t("toolHelp.circle"),
    Delete: t("toolHelp.delete"),
});

// The non-tool controls (toolbar actions + the bottom bar).
const buildControlHelp = (t: TFunction) => [
    { icon: SlidersHorizontal, label: t("controlHelp.strokeColour.label"), description: t("controlHelp.strokeColour.description") },
    { icon: ListNumbers, label: t("controlHelp.marksNumber.label"), description: t("controlHelp.marksNumber.description") },
    { icon: Upload, label: t("controlHelp.upload.label"), description: t("controlHelp.upload.description") },
    { icon: Download, label: t("controlHelp.download.label"), description: t("controlHelp.download.description") },
    { icon: RefreshCcw, label: t("controlHelp.reset.label"), description: t("controlHelp.reset.description") },
    { icon: ArrowUUpLeft, label: t("controlHelp.undo.label"), description: t("controlHelp.undo.description") },
    { icon: ArrowUUpRight, label: t("controlHelp.redo.label"), description: t("controlHelp.redo.description") },
    { icon: ChevronLeft, label: t("controlHelp.pageNavigation.label"), description: t("controlHelp.pageNavigation.description") },
    { icon: RotateCcw, label: t("controlHelp.rotate.label"), description: t("controlHelp.rotate.description") },
    { icon: MagnifyingGlassPlus, label: t("controlHelp.zoom.label"), description: t("controlHelp.zoom.description") },
    { icon: CornersOut, label: t("controlHelp.fullscreen.label"), description: t("controlHelp.fullscreen.description") },
    { icon: PaperPlaneTilt, label: t("controlHelp.submit.label"), description: t("controlHelp.submit.description") },
];

// Quick-pick colours for the Pen/Box/Circle stroke. Literal canvas colour
// values (not design tokens) — these paint onto the answer sheet itself, the
// same "user-picked colour in an editor" exception the ColorPicker below uses.
const buildPenSwatches = (t: TFunction): { label: string; value: string }[] => [
    { label: t("penSwatches.green"), value: "green" },
    { label: t("penSwatches.red"), value: "red" },
    { label: t("penSwatches.blue"), value: "#1D4ED8" }, // design-lint-ignore: literal ink colour, not UI chrome
    { label: t("penSwatches.black"), value: "#111827" }, // design-lint-ignore: literal ink colour, not UI chrome
];

interface PDFEvaluatorProps {
    isFreeTool: boolean;
    file?: File;
    questionData?: any;
    fileId?: string;
    attemptId?: string;
    assessmentId?: string;
    instituteId?: string;
    examType?: string;
    assessmentVisibility?: string;
}

const PDFEvaluator = ({
    isFreeTool = true,
    file,
    // `fileId` (the learner's original answer file) is intentionally not read
    // here — the evaluator loads the sheet through `file`/`pdfUrl`, and the
    // submit sends the ANNOTATED file's id, never this one.
    questionData,
    assessmentId,
    attemptId,
    instituteId,
    examType,
    assessmentVisibility,
}: PDFEvaluatorProps) => {
    const { t, i18n: i18nInstance } = useTranslation("evaluationPdfEditor");
    const TOOL_HELP = buildToolHelp(t);
    const CONTROL_HELP = buildControlHelp(t);
    const PEN_SWATCHES = buildPenSwatches(t);

    // File states
    const [pdfFile, setPdfFile] = useState<File | null>(file);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [error, setError] = useState("");
    const navigate = useNavigate();

    // PDF states
    const [numPages, setNumPages] = useState<number>(0);
    const [pageNumber, setPageNumber] = useState(1);
    const [scale, setScale] = useState(1.0);
    const [pagesVisited, setPagesVisited] = useState<number[]>([]);
    const [docLoaded, setDocLoaded] = useState(false);
    const [prevPageNumber, setPrevPageNumber] = useState(1);
    const [loadingDoc, setLoadingDoc] = useState(true);
    const [progress, setProgress] = useState<number>(0);
    const [uploadingProgress, setUploadingProgress] = useState<number>(0);
    const [dimensions, setDimensions] = useState({
        width: 600,
        height: 800,
    });
    const router = useRouter();
    const { startTimer, stopTimer, currentTime, startTimestamp, setElapsedTime } = useTimerStore();
    const { marksData, resetMarks, feedbackByQuestion, addOrUpdateMark, setQuestionFeedback } =
        useMarksStore();

    // --- Draft (save-for-later) state ---
    // Draft is saved ONLY when the evaluator clicks "Save draft" — no background
    // polling. Keeps the network quiet and gives the user explicit control.
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    // ISO timestamp of the last successful save/restore — powers the "Draft saved …" hint.
    const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
    // Prevents overlapping/duplicate draft saves (e.g. double-clicks).
    const savingDraftRef = useRef(false);
    // Ensures we only attempt the one-time draft restore per mount.
    const restoreAttemptedRef = useRef(false);

    // Submit is allowed once the evaluator has awarded at least one mark. Remarks
    // are optional.
    const canSubmit = marksData.length > 0;
    const { uploadFile, isUploading: isUploadingFile } = useFileUpload();
    const [isUploading, setIsUploading] = useState<boolean>(false);
    // Canvas states
    const [fabricCanvas, setFabricCanvas] = useState<Canvas | null>(null);
    const [annotations, setAnnotations] = useState<{ [key: number]: any }>({});
    const canvasUtils = useFabric(fabricCanvas);
    const { tools, deleteTool, numbers } = useCanvasTools(canvasUtils);

    // Per-page view rotation (0/90/180/270), for scans that came in sideways or
    // upside-down. Purely a display/export concern — the fabric canvas itself
    // just gets resized to match the rotated page, same as loading a
    // differently-sized PDF; see rotatePage() and buildEvaluatedPdfBytes().
    const [pageRotations, setPageRotations] = useState<Record<number, number>>({});
    // The annotation canvas's own width/height at the moment each page's marks
    // were captured — needed at export time because a rotated page's canvas is a
    // different shape than an unrotated one, so a single shared size (as before)
    // no longer holds across all pages once rotation varies per page.
    const [pageCanvasDims, setPageCanvasDims] = useState<
        Record<number, { width: number; height: number }>
    >({});
    // Each page's OWN /Rotate as authored in the PDF (scanner output commonly
    // carries one). The evaluator's rotation is applied on top of this, never
    // instead of it — see the <Page rotate> prop and buildEvaluatedPdfBytes.
    const [pageIntrinsicRotations, setPageIntrinsicRotations] = useState<Record<number, number>>({});

    // Jump to page state
    const [jumpPage, setJumpPage] = useState<number | "">("");

    // Loading state
    const [isLoading, setIsLoading] = useState(false);

    // Zoom state — default to 90% so the full page fits on screen without scrolling.
    const [zoomLevel, setZoomLevel] = useState(0.9);

    // Render the PDF page bitmap at a high pixel density so scanned / handwritten
    // answer sheets stay sharp and legible. The displayed CSS size is unchanged,
    // so the Fabric annotation overlay (sized to the rendered page) stays aligned.
    const renderPixelRatio =
        typeof window !== "undefined" ? Math.max(3, window.devicePixelRatio || 1) : 3;

    // Bound the workspace to the visible viewport so the PDF pane scrolls inside
    // its own area (independent of the page) when zoomed — instead of growing the
    // whole layout. Measured (not a fixed calc) so it adapts to the responsive
    // navbar height and any container padding above it.
    const [workspaceHeight, setWorkspaceHeight] = useState<number | undefined>(() =>
        typeof window !== "undefined" ? window.innerHeight - 72 : undefined,
    );

    // Evaluation panel state — persistent by default so the marks panel fills the
    // workspace instead of leaving a large empty area on the right.
    const [showEvaluationPanel, setShowEvaluationPanel] = useState(true);

    // Refs
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const canvasRef = useRef(null);
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);
    const pdfViewerRef = useRef<HTMLDivElement | null>(null);
    // The PDF pane's own scroll area — measured to zoom the page to fill the
    // available width by default (see the fit-to-width effect below), instead
    // of always rendering at a flat 90% with wasted grey margin on a wide
    // screen, which was making the handwriting harder to read than it needed
    // to be.
    const pdfScrollAreaRef = useRef<HTMLDivElement | null>(null);
    // Sticks to auto-fit until the evaluator manually zooms in/out; "Reset
    // zoom" clears it back to auto-fit.
    const hasManualZoomRef = useRef(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    // The toolbar's button row scrolls horizontally when the workspace (e.g. the
    // sidebar open) leaves it less room than every tool + action needs. These
    // track whether there's actually more to scroll to, so the left/right
    // buttons only show up when they'd do something.
    const toolbarScrollRef = useRef<HTMLDivElement | null>(null);
    const [canScrollToolbarLeft, setCanScrollToolbarLeft] = useState(false);
    const [canScrollToolbarRight, setCanScrollToolbarRight] = useState(false);
    // Fullscreen ("distraction-free") reading mode — hides the browser's own
    // chrome so the answer sheet gets that vertical space. Mirrors the real
    // document.fullscreenElement rather than tracking our own boolean, so the
    // button icon stays correct when the browser exits fullscreen on its own
    // (Esc, or the user leaving via browser UI).
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Undo / redo history (per page). Stacks hold canvas JSON snapshots; the guard
    // flag prevents programmatic loads (page changes, undo/redo, reset) from being
    // recorded as new user edits.
    const undoStack = useRef<string[]>([]);
    const redoStack = useRef<string[]>([]);
    const isRestoringRef = useRef(false);
    // Set when a new PDF is loaded from the device so the canvas re-measures to the
    // newly-rendered page size on its next render.
    const pendingResizeRef = useRef(false);
    // Guards against overlapping page changes (rapid Next/Prev clicking): the
    // sequence marks which page-load is current, and the in-flight flag stops
    // a cleared/partially-loaded canvas being snapshotted over a real page's
    // saved annotations. See the page-change effect below.
    const pageLoadSeqRef = useRef(0);
    const pageLoadInFlightRef = useRef(false);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    const syncHistoryFlags = () => {
        setCanUndo(undoStack.current.length > 1);
        setCanRedo(redoStack.current.length > 0);
    };

    const [openCalc, setOpenCalc] = useState(false);

    const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
    const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
    const [isHelpDialogOpen, setIsHelpDialogOpen] = useState(false);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: (acceptedFiles) => handleFile(acceptedFiles[0]),
        accept: {
            "application/pdf": [".pdf"],
        },
        maxFiles: 1,
        onDropRejected: (errors) => {
            console.log(errors);
            setError(t("errors.invalidFileType"));
        },
    });

    const handleFile = (file: File) => {
        const fileUrl = URL.createObjectURL(file);
        setPdfFile(file);
        setPdfUrl(fileUrl);
        setPageNumber(1);
        setPrevPageNumber(1);
        setNumPages(0);
        setAnnotations({});
        // A rotation/canvas-size chosen for the old file's pages doesn't apply
        // to this (unrelated) one — start fresh, or a page number this new
        // file happens to share with the old one would inherit stale rotation
        // and render pre-rotated, sized from the old file's dimensions.
        setPageRotations({});
        setPageCanvasDims({});
        setPageIntrinsicRotations({});

        // Start a fresh annotation layer on the uploaded PDF (any marks already
        // baked into the file stay as part of the page image and aren't editable).
        if (fabricCanvas) {
            isRestoringRef.current = true;
            fabricCanvas.clear();
            isRestoringRef.current = false;
            undoStack.current = [JSON.stringify(fabricCanvas.toJSON())];
        } else {
            undoStack.current = [];
        }
        redoStack.current = [];
        syncHistoryFlags();

        // The replacement page may be a different size — re-measure on next render.
        pendingResizeRef.current = true;
        // A manual zoom chosen for the old file's page size likely doesn't fit
        // this one — go back to auto-fit-to-width for it.
        hasManualZoomRef.current = false;
    };

    const handleFileInput = (e: ChangeEvent<HTMLInputElement>) => {
        if (typeof e?.target?.files === "undefined" || e.target.files?.length === 0) return;
        // @ts-expect-error : //TODO: fix this
        handleFile(e.target.files[0] as File);
    };

    // Canvas setup — create the Fabric canvas once the <canvas> element + a PDF are
    // available. Crucially, this effect does NOT dispose on dep changes, so loading
    // a different PDF (e.g. a device-uploaded evaluated sheet) reuses the same
    // canvas instead of tearing it down. Disposal is handled on unmount below.
    useEffect(() => {
        if (pdfFile && canvasRef.current && !fabricCanvas) {
            const canvas = new Canvas(canvasRef.current, {
                width: 600,
                height: 800,
                selection: true,
                renderOnAddRemove: true,
            });
            setFabricCanvas(canvas);
        }
    }, [pdfFile, loadingDoc]);

    // Window-resize handling + dispose, tied to the canvas instance (the canvas is
    // created once, so the cleanup effectively runs only on unmount).
    useEffect(() => {
        if (!fabricCanvas) return;
        const handleResize = () => {
            // The rendered page size is fixed by the Page `scale` prop (window size
            // doesn't change it), so keep the annotation canvas synced to the page —
            // sizing it to the container here desynced them, clipping annotations.
            const pageCanvas = document.querySelector(".react-pdf__Page__canvas");
            if (pageCanvas?.clientWidth && pageCanvas?.clientHeight) {
                fabricCanvas.setDimensions({
                    width: pageCanvas.clientWidth,
                    height: pageCanvas.clientHeight,
                });
            }
            fabricCanvas.requestRenderAll();
        };
        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
            fabricCanvas.dispose();
        };
    }, [fabricCanvas]);

    useEffect(() => {
        setTimeout(() => {
            loadPDF();
            setLoadingDoc(false);
        }, 50);
    }, [fabricCanvas]);

    // Record an undo snapshot on every user edit, and seed the baseline for the
    // first page. Programmatic loads set isRestoringRef so they aren't recorded.
    useEffect(() => {
        if (!fabricCanvas) return;

        undoStack.current = [JSON.stringify(fabricCanvas.toJSON())];
        redoStack.current = [];
        syncHistoryFlags();

        const recordHistory = () => {
            if (isRestoringRef.current) return;
            undoStack.current.push(JSON.stringify(fabricCanvas.toJSON()));
            redoStack.current = [];
            syncHistoryFlags();
        };

        fabricCanvas.on("object:added", recordHistory);
        fabricCanvas.on("object:modified", recordHistory);
        fabricCanvas.on("object:removed", recordHistory);

        return () => {
            fabricCanvas.off("object:added", recordHistory);
            fabricCanvas.off("object:modified", recordHistory);
            fabricCanvas.off("object:removed", recordHistory);
        };
    }, [fabricCanvas]);

    // Keep the workspace height pinned to the viewport (top offset accounts for the
    // navbar/chrome above it), so the PDF pane gets a real bounded height and its
    // internal overflow-auto scrolls on its own instead of the whole page.
    useEffect(() => {
        const measure = () => {
            const top = rootRef.current?.getBoundingClientRect().top ?? 0;
            setWorkspaceHeight(Math.max(window.innerHeight - top, 320));
        };
        measure();
        window.addEventListener("resize", measure);
        // Entering/leaving fullscreen changes the available height. That fires a
        // resize too, but it lands after the transition — re-measure on the next
        // frame as well so the workspace claims the new height promptly.
        const raf = requestAnimationFrame(measure);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", measure);
        };
        // Re-measure once the PDF view actually mounts the root (e.g. after a file
        // is chosen in the standalone tool), not just on first render.
    }, [loadingDoc, pdfFile, isFullscreen]);

    // Recompute whenever the row scrolls or is resized (e.g. the sidebar or
    // grading panel toggles) — a ResizeObserver on the scroll container itself
    // catches "got narrower/wider", not just window resizes.
    const updateToolbarScrollState = () => {
        const el = toolbarScrollRef.current;
        if (!el) return;
        setCanScrollToolbarLeft(el.scrollLeft > 4);
        setCanScrollToolbarRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };

    const scrollToolbar = (delta: number) => {
        toolbarScrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
    };

    useEffect(() => {
        const el = toolbarScrollRef.current;
        if (!el) return;
        updateToolbarScrollState();
        const resizeObserver = new ResizeObserver(updateToolbarScrollState);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, [loadingDoc, pdfFile]);

    // Keep the page fit to the available width by default — re-fits whenever
    // the scroll area resizes (sidebar/grading-panel toggling, window resize)
    // or the page's own native size changes (a new page, a rotation). Backs
    // off entirely once the evaluator manually zooms; "Reset zoom" re-enables it.
    useEffect(() => {
        const el = pdfScrollAreaRef.current;
        if (!el) return;
        const applyFit = () => {
            if (hasManualZoomRef.current) return;
            const fit = computeFitZoom();
            if (fit) setZoomLevel(fit);
        };
        applyFit();
        const resizeObserver = new ResizeObserver(applyFit);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, [loadingDoc, pdfFile, dimensions.width, dimensions.height]);

    // Waits until the annotation canvas has resized to match `expectedDims` —
    // needed because a page/rotation change re-renders the PDF page (and thus
    // resizes the canvas) ASYNCHRONOUSLY via react-pdf/pdf.js. Loading a saved
    // page's ink before that resize lands would load it against the WRONG
    // canvas size (still the previous page's), leaving it visually misplaced
    // with nothing to self-correct it afterward. A bounded poll, not a real
    // event, since Fabric/react-pdf don't expose a direct "resized" signal —
    // degrades to resolving once the budget runs out rather than risk hanging.
    const waitForCanvasDims = (expectedDims?: { width: number; height: number }): Promise<void> =>
        new Promise((resolve) => {
            const dimsMatch = () =>
                !expectedDims ||
                !fabricCanvas ||
                (Math.abs(fabricCanvas.width - expectedDims.width) < 1 &&
                    Math.abs(fabricCanvas.height - expectedDims.height) < 1);
            if (dimsMatch()) {
                resolve();
                return;
            }
            let attempts = 0;
            const check = () => {
                attempts += 1;
                if (dimsMatch() || attempts > 180) {
                    resolve();
                } else {
                    requestAnimationFrame(check);
                }
            };
            requestAnimationFrame(check);
        });

    // Save annotations when changing pages
    useEffect(() => {
        if (!fabricCanvas) return;

        // Identifies THIS page-change. Flipping pages again supersedes it, and
        // the async work below bails rather than painting a stale page's ink
        // onto the page the evaluator has since moved to.
        const seq = ++pageLoadSeqRef.current;

        // Snapshot the outgoing page — but ONLY when the canvas actually holds
        // its content. Mid-flight the canvas is cleared/partially loaded, and
        // saving that would overwrite a real page's marks with an empty layer
        // (i.e. silently erase them) when pages are flipped rapidly.
        if (!pageLoadInFlightRef.current) {
            const currentAnnotations = fabricCanvas.toJSON();
            setAnnotations((prev) => ({
                ...prev,
                [prevPageNumber]: currentAnnotations, // Use previous page number reference
            }));
            setPageCanvasDims((prev) => ({
                ...prev,
                [prevPageNumber]: { width: fabricCanvas.width, height: fabricCanvas.height },
            }));
        }

        // Clearing + loading fire canvas events — guard them so they don't get
        // recorded as user edits in the undo history.
        isRestoringRef.current = true;
        pageLoadInFlightRef.current = true;
        fabricCanvas.clear();

        const targetAnnotations = annotations[pageNumber];
        const expectedDims = pageCanvasDims[pageNumber];

        (async () => {
            // No-op when this page's dims already match (the common case: same
            // rotation/size as whatever was already on screen).
            await waitForCanvasDims(expectedDims);
            if (seq !== pageLoadSeqRef.current) return; // superseded mid-wait
            if (targetAnnotations) {
                await fabricCanvas.loadFromJSON(targetAnnotations);
                if (seq !== pageLoadSeqRef.current) return; // superseded mid-load
            }
            fabricCanvas.requestRenderAll();
            // Reset undo/redo to this page's freshly-loaded baseline.
            undoStack.current = [JSON.stringify(fabricCanvas.toJSON())];
            redoStack.current = [];
            // Only the run that actually finished may lift the guards — a
            // superseded run returning early would otherwise re-enable undo
            // recording while the winning run is still painting.
            isRestoringRef.current = false;
            pageLoadInFlightRef.current = false;
            syncHistoryFlags();
        })();

        // Update previous page reference
        setPrevPageNumber(pageNumber);
    }, [pageNumber]);

    // Mark a page visited as soon as it's ENTERED (covers the initial page and
    // the final page the evaluator lands on) — not when leaving it.
    useEffect(() => {
        setPagesVisited((prev) => (prev.includes(pageNumber) ? prev : [...prev, pageNumber]));
    }, [pageNumber]);

    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            const message = t("confirmLeave");
            e.returnValue = message;
            return message;
        };

        window.addEventListener("beforeunload", handleBeforeUnload);

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, []);

    useEffect(() => {
        const unsubscribe = router.subscribe("onBeforeNavigate", (event) => {
            if (pdfFile) {
                const confirmMessage = t("confirmLeave");

                if (!window.confirm(confirmMessage)) {
                    event.preventDefault();
                }
            }
        });

        return () => {
            unsubscribe();
        };
    }, [annotations, router]);

    useEffect(() => {
        startTimer();

        return () => {
            stopTimer();
        };
    }, [startTimer, stopTimer]);

    // ---------------------------------------------------------------------------
    // Draft (save-for-later): persist the full EDITABLE evaluator state so a
    // faculty can pause and resume grading later from any device — instead of the
    // old download-PDF / re-upload dance (which also baked ticks into the image and
    // made them un-editable). We store raw Fabric annotations per page + marks +
    // feedback + timer, never a flattened PDF; the flattened PDF is still only
    // produced on the final Submit.
    // ---------------------------------------------------------------------------
    const buildDraftState = (): EvaluationDraftState => {
        // Include unsaved edits on the live page alongside the per-page snapshots.
        const perPageAnnotations: { [key: number]: any } = { ...annotations };
        const perPageDims = { ...pageCanvasDims };
        if (fabricCanvas) {
            perPageAnnotations[pageNumber] = fabricCanvas.toJSON();
            perPageDims[pageNumber] = { width: fabricCanvas.width, height: fabricCanvas.height };
        }
        return {
            version: 1,
            annotations: perPageAnnotations,
            marksData: marksData.map((m) => ({
                section_id: m.section_id,
                question_id: m.question_id,
                status: m.status,
                marks: m.marks,
            })),
            feedbackByQuestion,
            elapsedSeconds: currentTime(),
            pageNumber,
            pagesVisited,
            savedAt: new Date().toISOString(),
            pageRotations,
            pageCanvasDims: perPageDims,
        };
    };

    // The draft write itself, without the "is the evaluator busy" guards. Split
    // out of persistDraft so a FAILED submit can rescue the evaluator's work: at
    // that moment isUploading/isLoading are still stale-true in this closure, so
    // going through persistDraft would silently no-op and the annotations would
    // be lost with the tab.
    // `announce: false` is for the submit-failure rescue, where the failure toast
    // already tells the evaluator their marking was kept — a second "Draft saved"
    // toast right after an error reads as contradictory. It also rethrows there,
    // so the caller can report whether the rescue actually worked.
    const saveDraftNow = async ({ announce = true } = {}) => {
        if (isFreeTool || !attemptId) return;
        if (savingDraftRef.current) return;

        savingDraftRef.current = true;
        setIsSavingDraft(true);
        try {
            const draft = buildDraftState();
            await saveEvaluationDraft(assessmentId, instituteId, attemptId, draft);
            setDraftSavedAt(draft.savedAt);
            if (announce) {
                toast.success(t("toasts.draftSavedTitle"), {
                    description: t("toasts.draftSavedDesc"),
                    duration: 3000,
                });
            }
        } catch (error) {
            console.error("Failed to save evaluation draft:", error);
            if (!announce) throw error;
            toast.error(t("errors.draftSaveFailed"));
        } finally {
            savingDraftRef.current = false;
            setIsSavingDraft(false);
        }
    };

    // Save the current progress on demand (only from the "Save draft" button).
    const persistDraft = async () => {
        if (savingDraftRef.current || isUploading || isLoading) return;
        await saveDraftNow();
    };

    // One-time draft restore. Runs when the annotation canvas is ready so we can
    // paint the current page's saved marks. Also clears any stale marks/timer left
    // in the (session-global) stores by a previously-opened attempt.
    useEffect(() => {
        if (isFreeTool || !attemptId || restoreAttemptedRef.current) return;
        if (!fabricCanvas) return;
        restoreAttemptedRef.current = true;

        // Fresh baseline before we (maybe) hydrate from a draft.
        resetMarks();
        setElapsedTime(0);

        (async () => {
            try {
                const draft = await getEvaluationDraft(attemptId);
                if (!draft) return;

                const restoredAnnotations = draft.annotations || {};
                setAnnotations(restoredAnnotations);
                const restoredRotations = draft.pageRotations || {};
                setPageRotations(restoredRotations);
                const restoredDims = draft.pageCanvasDims || {};
                setPageCanvasDims(restoredDims);

                (draft.marksData || []).forEach((m) => addOrUpdateMark(m));
                Object.entries(draft.feedbackByQuestion || {}).forEach(([key, value]) => {
                    const sep = key.indexOf("__");
                    if (sep > 0) {
                        setQuestionFeedback(key.slice(0, sep), key.slice(sep + 2), value as string);
                    }
                });
                if (typeof draft.elapsedSeconds === "number") setElapsedTime(draft.elapsedSeconds);
                if (Array.isArray(draft.pagesVisited) && draft.pagesVisited.length) {
                    setPagesVisited(draft.pagesVisited);
                }

                // Paint the page currently on screen (page 1 on open). If that page
                // was saved rotated, setPageRotations() above triggers a re-render of
                // the (now differently-sized) PDF page — wait for the annotation
                // canvas to catch up to that size before loading its ink, or the ink
                // would land at the wrong scale. Degrades to painting immediately when
                // there's no recorded size to wait for (older drafts, or rotation 0).
                // Claim the page-load sequence so this restore and any page
                // change the evaluator made while the draft was still being
                // fetched can't both paint the canvas — whichever is newer wins.
                const currentPageAnnotations = restoredAnnotations[pageNumber];
                if (currentPageAnnotations && fabricCanvas) {
                    // Claim the sequence only when we're actually going to paint:
                    // claiming it unconditionally would invalidate an in-flight
                    // page-load that then bails without ever clearing the
                    // restore guards, silently stopping undo from recording.
                    const restoreSeq = ++pageLoadSeqRef.current;
                    await waitForCanvasDims(restoredDims[pageNumber]);
                    // If the evaluator changed page while the draft was being
                    // fetched, that page-load owns the canvas now — skip only
                    // the painting here. The marks/feedback/timer restored above
                    // still stand, so the draft-restored notice below is correct.
                    if (restoreSeq === pageLoadSeqRef.current) {
                        isRestoringRef.current = true;
                        pageLoadInFlightRef.current = true;
                        fabricCanvas.clear();
                        await fabricCanvas.loadFromJSON(currentPageAnnotations);
                        if (restoreSeq === pageLoadSeqRef.current) {
                            fabricCanvas.requestRenderAll();
                            undoStack.current = [JSON.stringify(fabricCanvas.toJSON())];
                            redoStack.current = [];
                            isRestoringRef.current = false;
                            pageLoadInFlightRef.current = false;
                            syncHistoryFlags();
                        }
                    }
                }

                setDraftSavedAt(draft.savedAt || null);
                toast.success(t("toasts.draftRestoredTitle"), {
                    description: t("toasts.draftRestoredDesc"),
                    duration: 4000,
                });
            } catch (error) {
                console.error("Failed to restore evaluation draft:", error);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fabricCanvas, isFreeTool, attemptId]);

    // Short, local "last saved" label for the draft hint.
    const formatSavedAt = (iso: string) => {
        try {
            return new Date(iso).toLocaleTimeString(i18nInstance.language, { hour: "2-digit", minute: "2-digit" });
        } catch {
            return "";
        }
    };

    // PDF navigation
    const changePage = (offset: number) => {
        setPageNumber((prevPageNumber) => {
            const newPageNumber = prevPageNumber + offset;
            return Math.max(1, Math.min(newPageNumber, numPages));
        });
    };

    const handleJumpPage = () => {
        if (jumpPage && jumpPage > 0 && jumpPage <= numPages) {
            setPageNumber(jumpPage);
        }
    };

    // Build the evaluated PDF by overlaying ONLY the annotation layer onto the
    // ORIGINAL PDF pages with pdf-lib. The student's original page content is kept
    // natively (never re-rasterized), so the answer sheet retains its full original
    // quality; we render each page's Fabric annotations to a transparent, high-res
    // PNG offscreen and stamp it on top. Because the annotation canvas spans the
    // full displayed page, drawing it full-page maps the coordinates automatically.
    // Render one page's Fabric annotations to a transparent offscreen PNG at
    // `dims` (that page's own captured canvas size — required now that rotated
    // pages don't share a single size with the rest of the document). Returns
    // null when the page has no marks, so callers can leave it untouched.
    const renderInkOverlayPng = async (
        pageAnnotations: any,
        dims: { width: number; height: number },
    ): Promise<string | null> => {
        const offscreen = document.createElement("canvas");
        const staticCanvas = new StaticCanvas(offscreen, {
            width: dims.width,
            height: dims.height,
            enableRetinaScaling: false,
        });
        await staticCanvas.loadFromJSON(pageAnnotations);
        // Force a 1:1 viewport so the export is unaffected by any on-screen zoom.
        staticCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        staticCanvas.renderAll();
        const hasInk = staticCanvas.getObjects().length > 0;
        // multiplier=RENDER_SCALE keeps thin strokes / text crisp.
        const pngDataUrl = hasInk
            ? staticCanvas.toDataURL({ format: "png", multiplier: RENDER_SCALE })
            : null;
        staticCanvas.dispose();
        return pngDataUrl;
    };

    // Build the evaluated PDF by overlaying the annotation layer onto the
    // ORIGINAL PDF pages with pdf-lib. An untouched (unrotated, unmarked) page is
    // never re-rasterized — it keeps its native vector/image content exactly as
    // uploaded. A page the evaluator ROTATED is a different story: the rotation
    // is only meaningful once it's baked into the actual page content (otherwise
    // downloading/submitting would just show the original sideways page again),
    // so those specific pages are rasterised via pdf.js at the chosen rotation,
    // flattened with their ink on top, and swapped in whole. Every other page's
    // quality is completely unaffected.
    const buildEvaluatedPdfBytes = async (): Promise<Uint8Array> => {
        if (!pdfFile) throw new Error(t("errors.noPdfFile"));

        // Snapshot annotations + the canvas size they were captured at, including
        // unsaved edits on the live page.
        const perPageAnnotations: { [key: number]: any } = { ...annotations };
        const perPageDims: { [key: number]: { width: number; height: number } } = {
            ...pageCanvasDims,
        };
        if (fabricCanvas) {
            perPageAnnotations[pageNumber] = fabricCanvas.toJSON();
            perPageDims[pageNumber] = { width: fabricCanvas.width, height: fabricCanvas.height };
        }
        // Fallback for the rare page with ink but no recorded size (only possible
        // for a draft saved before per-page dims existed).
        const fallbackDims = {
            width: (fabricCanvas && fabricCanvas.width) || dimensions.width,
            height: (fabricCanvas && fabricCanvas.height) || dimensions.height,
        };

        const pdfDoc = await PDFDocument.load(await pdfFile.arrayBuffer());
        const pageCount = pdfDoc.getPageCount();

        // Only loaded if some page actually needs rasterising.
        let pdfJsDoc: any = null;
        const getPdfJsDoc = async () => {
            if (!pdfJsDoc) {
                pdfJsDoc = await pdfjs.getDocument({ data: await pdfFile.arrayBuffer() }).promise;
            }
            return pdfJsDoc;
        };

        for (let i = 0; i < pageCount; i++) {
            const pageNum1 = i + 1; // annotations/rotations are 1-based
            const pageAnnotations = perPageAnnotations[pageNum1];
            const rotation = pageRotations[pageNum1] || 0;
            const dims = perPageDims[pageNum1] || fallbackDims;

            // Untouched page → leave the original completely alone.
            if (!pageAnnotations && rotation === 0) continue;

            if (rotation === 0) {
                const pngDataUrl = await renderInkOverlayPng(pageAnnotations, dims);
                if (!pngDataUrl) continue; // saved annotation layer turned out empty
                const overlay = await pdfDoc.embedPng(dataUrlToUint8(pngDataUrl));
                const page = pdfDoc.getPage(i);
                const { width, height } = page.getSize();
                page.drawImage(overlay, { x: 0, y: 0, width, height });
                continue;
            }

            // Rotated page: rasterise the original content at that rotation (via
            // pdf.js — the same renderer already used for the on-screen preview),
            // flatten the ink on top at matching resolution, and replace the page.
            const srcDoc = await getPdfJsDoc();
            const srcPage = await srcDoc.getPage(pageNum1);
            // The evaluator's rotation is relative to what they SAW, which was
            // the page at its own /Rotate — so combine them, exactly as the
            // on-screen <Page rotate> prop does. Using `rotation` alone here
            // would discard the page's intrinsic orientation.
            const totalRotation = ((srcPage.rotate || 0) + rotation) % 360;

            // Page size in PDF points, at the final orientation.
            const baseViewport = srcPage.getViewport({ scale: 1, rotation: totalRotation });
            // Cap the raster so a large scan can't blow the browser's canvas
            // limit (iOS Safari tops out near 16.7 MPx, where toDataURL silently
            // returns "data:," and the export then throws — failing the whole
            // submission). Below the cap this is a no-op and quality is unchanged.
            const MAX_RASTER_PIXELS = 12_000_000;
            const fitScale = Math.sqrt(
                MAX_RASTER_PIXELS / Math.max(baseViewport.width * baseViewport.height, 1),
            );
            const rasterScale = Math.max(Math.min(RENDER_SCALE, fitScale), 1);
            const viewport = srcPage.getViewport({ scale: rasterScale, rotation: totalRotation });

            const contentCanvas = document.createElement("canvas");
            contentCanvas.width = viewport.width;
            contentCanvas.height = viewport.height;
            const ctx = contentCanvas.getContext("2d");
            if (!ctx) throw new Error(t("errors.canvasContext"));
            // JPEG has no alpha, so paint an opaque base first — otherwise the
            // un-drawn margins would encode as black.
            ctx.fillStyle = "#ffffff"; // design-lint-ignore: canvas paint value, not UI chrome
            ctx.fillRect(0, 0, contentCanvas.width, contentCanvas.height);
            await srcPage.render({ canvasContext: ctx, viewport }).promise;

            if (pageAnnotations) {
                const inkDataUrl = await renderInkOverlayPng(pageAnnotations, dims);
                if (inkDataUrl) {
                    const inkImg = await loadImage(inkDataUrl);
                    ctx.drawImage(inkImg, 0, 0, contentCanvas.width, contentCanvas.height);
                }
            }

            // JPEG rather than lossless PNG: a rotated page is a photographic
            // scan, and PNG here cost ~100MB peak per page and produced files
            // large enough to stall or fail the upload.
            const flattenedJpg = contentCanvas.toDataURL("image/jpeg", 0.92);
            const flattenedImg = await pdfDoc.embedJpg(dataUrlToUint8(flattenedJpg));
            const ptWidth = baseViewport.width;
            const ptHeight = baseViewport.height;
            pdfDoc.removePage(i);
            const newPage = pdfDoc.insertPage(i, [ptWidth, ptHeight]);
            newPage.drawImage(flattenedImg, { x: 0, y: 0, width: ptWidth, height: ptHeight });
        }

        return pdfDoc.save();
    };

    // Download the evaluated PDF (UI/UX unchanged — only the generation differs).
    const downloadAnnotatedPDF = async () => {
        if (!pdfFile) return;
        try {
            // Keep state in sync with the live canvas for the current page.
            if (fabricCanvas) {
                const currentAnnotations = fabricCanvas.toJSON();
                setAnnotations((prev) => ({
                    ...prev,
                    [pageNumber]: currentAnnotations,
                }));
            }

            setIsLoading(true);
            setError(t("errors.generatingPdf"));

            const bytes = await buildEvaluatedPdfBytes();
            const blob = new Blob([bytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `evaluated-${(pdfFile.name || "attempt").replace(/\.[^./\\]+$/, "")}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            setIsLoading(false);
            setError("");
        } catch (error) {
            console.error("Error generating annotated PDF:", error);
            setError(t("errors.generatePdfFailed"));
            setIsLoading(false);
        }
    };

    // Used by handleSubmit to upload the evaluated artifact — same Blob contract.
    const generateAnnotatedPDF = async (): Promise<Blob> => {
        const bytes = await buildEvaluatedPdfBytes();
        return new Blob([bytes], { type: "application/pdf" });
    };

    const handleZoomIn = () => {
        hasManualZoomRef.current = true;
        setZoomLevel((prevZoom) => Math.min(prevZoom + ZOOM_STEP, MAX_ZOOM));
    };

    const handleZoomOut = () => {
        hasManualZoomRef.current = true;
        setZoomLevel((prevZoom) => Math.max(prevZoom - ZOOM_STEP, MIN_ZOOM));
    };

    // Fill the scroll area's available width, so a wide screen shows the
    // handwriting bigger instead of leaving it small with empty grey margin
    // on both sides. The floor has to go below 50% or an oversized scan can never
    // actually be fitted to the width — but see MIN_FIT_ZOOM for why it doesn't go
    // all the way down to the manual limit.
    const computeFitZoom = (): number | null => {
        const availableWidth = pdfScrollAreaRef.current?.clientWidth;
        if (!availableWidth || !dimensions.width) return null;
        const PADDING = 32; // the CardContent's own p-4 (16px each side)
        const fit = (availableWidth - PADDING) / dimensions.width;
        return Math.min(Math.max(fit, MIN_FIT_ZOOM), MAX_ZOOM);
    };

    const handleResetZoom = () => {
        hasManualZoomRef.current = false;
        const fit = computeFitZoom();
        setZoomLevel(fit ?? 0.9);
    };

    // Fullscreen the whole document (not just this evaluator panel) on purpose:
    // the confirm dialogs, popovers and tooltips here all render through React
    // portals into document.body. Fullscreening a sub-element would leave that
    // portalled content outside the fullscreen element and therefore invisible —
    // "Reset annotations" would silently appear to do nothing. Fullscreening the
    // document keeps every one of them working.
    const toggleFullscreen = async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await document.documentElement.requestFullscreen();
            }
        } catch (error) {
            // Browsers reject this when the gesture isn't trusted or the policy
            // blocks it — tell the evaluator instead of failing silently.
            console.error("Fullscreen toggle failed:", error);
            toast.error(t("errors.fullscreenBlocked"));
        }
    };

    // Track the browser's real fullscreen state so the button reflects reality
    // even when fullscreen is exited outside our button (Esc, browser chrome).
    useEffect(() => {
        const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
        syncFullscreen();
        document.addEventListener("fullscreenchange", syncFullscreen);
        return () => document.removeEventListener("fullscreenchange", syncFullscreen);
    }, []);

    // Rotate the CURRENT page's view in 90° steps (0→90→180→270→0) — for a scan
    // that came in sideways or upside-down. The PDF page is re-rendered rotated
    // (react-pdf's `rotate` prop) and the annotation canvas is resized to match,
    // same as loading a differently-sized PDF — see remeasureCanvasToPdf().
    const rotatePage = (delta: number) => {
        if (fabricCanvas && fabricCanvas.getObjects().length > 0) {
            toast.info(t("toasts.rotateWarning"));
        }
        setPageRotations((prev) => {
            const current = prev[pageNumber] ?? 0;
            const next = ((current + delta) % 360 + 360) % 360;
            return { ...prev, [pageNumber]: next };
        });
    };

    // Restore the previous canvas snapshot. Guarded so the reload itself isn't
    // recorded as a new edit.
    const handleUndo = () => {
        if (!fabricCanvas || undoStack.current.length <= 1) return;
        const current = undoStack.current.pop();
        redoStack.current.push(current);
        const target = undoStack.current[undoStack.current.length - 1];
        isRestoringRef.current = true;
        fabricCanvas.clear();
        fabricCanvas.loadFromJSON(target).then(() => {
            fabricCanvas.requestRenderAll();
            isRestoringRef.current = false;
            syncHistoryFlags();
        });
    };

    const handleRedo = () => {
        if (!fabricCanvas || redoStack.current.length === 0) return;
        const target = redoStack.current.pop();
        undoStack.current.push(target);
        isRestoringRef.current = true;
        fabricCanvas.clear();
        fabricCanvas.loadFromJSON(target).then(() => {
            fabricCanvas.requestRenderAll();
            isRestoringRef.current = false;
            syncHistoryFlags();
        });
    };

    // Clear all annotations (the current page's canvas + every saved page) in
    // place — no page reload.
    const handleResetAnnotations = () => {
        canvasUtils.clearCanvas();
        setAnnotations({});
        // Reset history to the now-empty baseline.
        undoStack.current = fabricCanvas ? [JSON.stringify(fabricCanvas.toJSON())] : [];
        redoStack.current = [];
        syncHistoryFlags();
        setIsResetDialogOpen(false);
        toast.success(t("toasts.annotationsCleared"));
    };

    async function loadPDF() {
        if (!loadingDoc || !pdfUrl) return;
        const abc = document.querySelector(".react-pdf__Document");

        const width = abc?.clientWidth || 600;
        const height = abc?.clientHeight || 800;

        fabricCanvas?.setWidth(width);
        fabricCanvas?.setHeight(height);

        setDimensions({ width, height });
    }

    // Resize the annotation canvas to the currently-rendered page. Runs on every
    // page render: the initial loadPDF() measure fires on a timer that can beat
    // the first page paint (leaving the canvas at its 600×800 default and making
    // wide scanned sheets only partially annotatable), and pages within one scan
    // can differ in size. Measures the page's own canvas (exact rendered size)
    // rather than the Document wrapper.
    const remeasureCanvasToPdf = () => {
        const pageCanvas = document.querySelector(".react-pdf__Page__canvas");
        const doc = document.querySelector(".react-pdf__Document");
        const width = pageCanvas?.clientWidth || doc?.clientWidth || dimensions.width;
        const height = pageCanvas?.clientHeight || doc?.clientHeight || dimensions.height;
        // No-op when already in sync so per-page-render calls don't churn state.
        if (
            Math.abs(width - (fabricCanvas?.width ?? 0)) < 1 &&
            Math.abs(height - (fabricCanvas?.height ?? 0)) < 1
        )
            return;
        fabricCanvas?.setWidth(width);
        fabricCanvas?.setHeight(height);
        setDimensions({ width, height });
        fabricCanvas?.requestRenderAll();
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Check if text is currently selected
            const isTextSelected = window.getSelection()?.toString().trim() !== "";

            // Check if the active element is an input, textarea, or has contenteditable attribute
            const activeTag = document.activeElement?.tagName.toLowerCase();
            const isInputFocused =
                activeTag === "input" ||
                activeTag === "textarea" ||
                document.activeElement?.getAttribute("contenteditable") === "true";

            // Check if the active canvas object is a text object with an active cursor
            const isTextObjectActive =
                fabricCanvas?.getActiveObject()?.type === "i-text" &&
                (fabricCanvas?.getActiveObject() as fabric.IText)?.isEditing;

            // Only proceed with delete if none of the above conditions are true
            if (
                (event.key === "Delete" || event.key === "Backspace") &&
                fabricCanvas &&
                !isTextSelected &&
                !isInputFocused &&
                !isTextObjectActive
            ) {
                event.preventDefault();
                canvasUtils.deleteSelectedShape();
            }

            // Escape backs out of whatever tool is armed (pen drawing, or a
            // click-to-stamp tool like Tick/Box) back to plain Select.
            if (event.key === "Escape" && fabricCanvas && !isInputFocused && !isTextObjectActive) {
                canvasUtils.enableSelection();
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [fabricCanvas, canvasUtils]);

    const handleSubmit = async () => {
        // Guard: never submit an evaluation without marks.
        if (!canSubmit) {
            setIsSubmitDialogOpen(false);
            toast.error(t("errors.awardMarksBeforeSubmit"));
            return;
        }
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const tokenData = getTokenDecodedData(accessToken);

        // Drafts only exist for a real attempt — the standalone free tool has
        // nowhere to save to, so don't offer a rescue it can't perform.
        const canRescueDraft = !isFreeTool && !!attemptId;
        let progressInterval;

        // The ordering, the failure handling and the "never lose the marking"
        // guarantees live in runEvaluationSubmit, which is typed and unit-tested
        // (this file is @ts-nocheck'd, so nothing here is). Everything below is
        // just wiring: what to upload, what to save, which spinners to drive.
        const outcome = await runEvaluationSubmit({
            buildAnnotatedPdf: generateAnnotatedPDF,
            uploadEvaluatedPdf: (annotatedPdfBlob) => {
                // Always give the evaluated artifact a .pdf name/type — the source
                // answer file may be named without an extension (or be missing),
                // which would otherwise produce a file that won't open/download as PDF.
                const baseName = (file?.name || `attempt-${attemptId}`).replace(/\.[^./\\]+$/, "");
                return uploadFile({
                    file: new File([annotatedPdfBlob], `evaluated-${baseName}.pdf`, {
                        type: "application/pdf",
                    }),
                    setIsUploading,
                    userId: "your-user-id",
                    source: instituteId,
                    sourceId: "EVALUATIONS",
                });
            },
            submitMarks: (evaluatedFileId) =>
                submitEvlauationMarks(assessmentId, instituteId, attemptId, {
                    set_id: "",
                    // file_id IS the evaluated artifact — the backend stores it on
                    // student_attempt.evaluated_file_id (the file shown to the learner).
                    // Send the annotated PDF, NOT the student's original answer file,
                    // which stays in attemptData.
                    file_id: evaluatedFileId,
                    data_json: JSON.stringify({
                        timeTakenInSeconds: currentTime(),
                        attemptId,
                        evaluationStartTime: startTimestamp,
                        evaluatedFileId,
                        setId: "",
                        assessmentId,
                        evaluatorUserId: tokenData?.user,
                    }),
                    // Merge the learner-facing feedback into each question's marks entry.
                    request: marksData.map((mark) => ({
                        ...mark,
                        evaluator_feedback:
                            feedbackByQuestion[feedbackKey(mark.section_id, mark.question_id)] ||
                            undefined,
                    })),
                }),
            // Auto-release so the result is visible to the learner right after
            // evaluation. Best-effort — a release failure never loses the marks.
            releaseResult: () => releaseEvaluationResult(assessmentId, instituteId, attemptId),
            rescueDraft: canRescueDraft ? () => saveDraftNow({ announce: false }) : undefined,
            onStage: (stage) => {
                if (stage === "building") {
                    setIsLoading(true);
                    return;
                }
                if (stage === "uploading") {
                    setIsLoading(false);
                    setIsUploading(true);
                    setUploadingProgress(0);
                    progressInterval = setInterval(() => {
                        setUploadingProgress((prev) => Math.min(prev + Math.random() * 10, 90));
                    }, 200);
                    return;
                }
                // "settled" fires on every path, success or failure, so the editor
                // can never be left behind the loading overlay with both Submit and
                // Save draft disabled — a dead end whose only escape was a reload,
                // which discards every annotation on the sheet.
                if (progressInterval) clearInterval(progressInterval);
                setIsLoading(false);
                setIsUploading(false);
            },
        });

        if (outcome.status !== "submitted") {
            setUploadingProgress(0);
            // Name what broke and say plainly that nothing was saved — the old
            // generic "Error submitting evaluation" let a failure read like a
            // slow success, so evaluators walked away from ungraded copies.
            toast.error(t("errors.submitFailedTitle"), {
                description: outcome.workRescued
                    ? t("errors.submitFailedRescued", { reason: outcome.reason })
                    : t("errors.submitFailedNotRescued", { reason: outcome.reason }),
                duration: 8000,
            });
            return;
        }

        resetMarks();
        toast.success(t("toasts.evaluationSubmittedTitle"), {
            description: t("toasts.evaluationSubmittedDesc"),
            duration: 3000,
        });

        // Return to wherever the admin launched the evaluator from (e.g. the
        // assessment slide). Falls back to the assessment-details page using the
        // REAL play_mode / visibility — never hardcoded values.
        const returnUrl = readEvalReturnUrl();
        if (returnUrl) {
            clearEvalReturnUrl();
            window.location.assign(returnUrl);
        } else {
            navigate({
                to: "/evaluation/evaluations/assessment-details/$assessmentId/$examType/$assesssmentType",
                params: {
                    assessmentId,
                    examType: examType || "EXAM",
                    assesssmentType: assessmentVisibility || "PRIVATE",
                },
            });
        }
    };

    if (!pdfFile && !pdfUrl) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-y-4 p-4">
                <Card className="w-full max-w-lg">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold">
                            {t("upload.heading")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex w-full flex-col items-center gap-2">
                            <div
                                {...getRootProps()}
                                className={`w-full cursor-pointer rounded-lg border-2 border-dashed border-primary-500 p-6 ${isDragActive ? "bg-primary-50" : "bg-white"
                                    } transition-colors duration-200 ease-in-out`}
                            >
                                <input {...getInputProps()} />
                                <div className="flex flex-col items-center justify-center gap-4">
                                    <ImportFileImage />

                                    <p className="text-center text-base text-neutral-600">
                                        {t("upload.dropzone")}
                                    </p>
                                </div>
                            </div>

                            {error && (
                                <AlertDialog>
                                    <AlertCircle className="size-6 text-red-400" />
                                    <AlertDialogDescription className="text-red-500">
                                        {error}
                                    </AlertDialogDescription>
                                </AlertDialog>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div
            ref={rootRef}
            className="flex w-full p-6 lg:p-8"
            style={{ /* design-lint-ignore: dynamic viewport-bounded workspace height */ height: workspaceHeight }}
        >
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                {/* Loading overlay */}
                {isLoading && <LoadingOverlay numPages={numPages} pageNumber={pageNumber} />}
                {isUploading && <UploadingOverlay progress={uploadingProgress} />}

                {/* Floating annotation toolbar — Excalidraw-style: floats over the
                    page instead of taking a dedicated full-width row, so the
                    answer sheet gets that space back. Positioned relative to the
                    Card (not the scroll position), so it stays put as the
                    evaluator scrolls a tall page — see the wrapping `relative`
                    on the PDF Viewer container below. */}
                <div className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center px-4">
                    <TooltipProvider delayDuration={200}>
                        <div className="pointer-events-auto flex max-w-full items-center gap-1 rounded-2xl border border-neutral-200 bg-white p-1 shadow-lg">
                            <div className="relative min-w-0">
                                {canScrollToolbarLeft && (
                                    <button
                                        type="button"
                                        onClick={() => scrollToolbar(-200)}
                                        aria-label={t("toolbar.scrollLeft")}
                                        className="absolute left-0 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-md hover:bg-neutral-50"
                                    >
                                        <ChevronLeft className="size-3.5" aria-hidden="true" />
                                    </button>
                                )}
                                <div
                                    ref={toolbarScrollRef}
                                    onScroll={updateToolbarScrollState}
                                    className="scrollbar-hide flex flex-row items-center gap-1 overflow-x-auto scroll-smooth [&>*]:shrink-0"
                                >
                                {tools.map((tool) => {
                                    const isActive = canvasUtils.activeTool === tool.key;
                                    return (
                                        <Fragment key={tool.key}>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={tool.action}
                                                        className={cn(
                                                            "size-9 rounded-lg transition-colors hover:bg-neutral-100",
                                                            isActive &&
                                                                "bg-primary-100 hover:bg-primary-100",
                                                        )}
                                                        disabled={isLoading}
                                                        aria-label={tool.label}
                                                        aria-pressed={isActive}
                                                    >
                                                        <tool.icon className={tool.color} aria-hidden="true" />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>{tool.label}</TooltipContent>
                                            </Tooltip>
                                            {tool.key === "pen" && (
                                                <Popover>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <PopoverTrigger asChild>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="size-9 rounded-lg hover:bg-neutral-100"
                                                                    disabled={isLoading}
                                                                    aria-label={t("toolbar.strokeThicknessColour")}
                                                                >
                                                                    <SlidersHorizontal
                                                                        className="size-4 text-neutral-600"
                                                                        aria-hidden="true"
                                                                    />
                                                                </Button>
                                                            </PopoverTrigger>
                                                        </TooltipTrigger>
                                                        <TooltipContent>{t("controlHelp.strokeColour.label")}</TooltipContent>
                                                    </Tooltip>
                                                    <PopoverContent className="w-64 space-y-4 p-3" side="right">
                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-xs font-medium text-neutral-600">
                                                                    {t("toolbar.thickness")}
                                                                </span>
                                                                <span className="text-xs tabular-nums text-neutral-400">
                                                                    {canvasUtils.strokeWidth}px
                                                                </span>
                                                            </div>
                                                            <Slider
                                                                min={1}
                                                                max={10}
                                                                step={1}
                                                                value={[canvasUtils.strokeWidth]}
                                                                onValueChange={([value]) => {
                                                                    canvasUtils.setStrokeWidth(value);
                                                                    canvasUtils.updateSelectedStrokeWidth(value);
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <span className="text-xs font-medium text-neutral-600">
                                                                {t("toolbar.colour")}
                                                            </span>
                                                            <div className="flex items-center gap-2">
                                                                {PEN_SWATCHES.map((swatch) => (
                                                                    <button
                                                                        key={swatch.value}
                                                                        type="button"
                                                                        aria-label={swatch.label}
                                                                        title={swatch.label}
                                                                        onClick={() => {
                                                                            canvasUtils.setPenColor(swatch.value);
                                                                            canvasUtils.applyColorToSelection(
                                                                                swatch.value,
                                                                            );
                                                                        }}
                                                                        className={cn(
                                                                            "size-6 shrink-0 rounded-full border-2 transition-transform hover:scale-110",
                                                                            canvasUtils.penColor === swatch.value
                                                                                ? "border-primary-500"
                                                                                : "border-transparent",
                                                                        )}
                                                                        style={{ /* design-lint-ignore: literal ink colour drawn on the canvas, not UI chrome */ backgroundColor: swatch.value }}
                                                                    />
                                                                ))}
                                                                <ColorPicker
                                                                    value={canvasUtils.penColor}
                                                                    onChange={(color) => {
                                                                        canvasUtils.setPenColor(color);
                                                                        canvasUtils.applyColorToSelection(color);
                                                                    }}
                                                                    className="size-6 shrink-0 rounded-full p-0"
                                                                />
                                                            </div>
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            )}
                                        </Fragment>
                                    );
                                })}
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={deleteTool.action}
                                            className="size-9 rounded-lg transition-colors hover:bg-neutral-100"
                                            disabled={isLoading}
                                            aria-label={deleteTool.label}
                                        >
                                            <deleteTool.icon className={deleteTool.color} aria-hidden="true" />
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{deleteTool.label}</TooltipContent>
                                </Tooltip>
                                <div className="mx-1 h-7 w-px bg-neutral-200" aria-hidden="true" />
                                <Popover>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-9 rounded-lg hover:bg-neutral-100"
                                                    aria-label={t("toolbar.insertMarksNumber")}
                                                >
                                                    <ListNumbers className="size-4" aria-hidden="true" />
                                                </Button>
                                            </PopoverTrigger>
                                        </TooltipTrigger>
                                        <TooltipContent>{t("controlHelp.marksNumber.label")}</TooltipContent>
                                    </Tooltip>
                                    <PopoverContent className="w-64 p-2" side="right">
                                        <div className="grid grid-cols-5 gap-2">
                                            {numbers.map(({ value, action }) => (
                                                <MyButton
                                                    key={value}
                                                    scale="small"
                                                    layoutVariant="floating"
                                                    buttonType="text"
                                                    onClick={action}
                                                    value={value.toString()}
                                                    disabled={isLoading}
                                                    className="border border-primary-400 text-base hover:bg-primary-300"
                                                >
                                                    {value}
                                                </MyButton>
                                            ))}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                                <div className="mx-1 h-7 w-px bg-neutral-200" aria-hidden="true" />
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="application/pdf"
                                    onChange={handleFileInput}
                                    className="hidden"
                                />
                                {/* Everything used once-per-session (file ops, reset, help)
                                    lives behind one "More" menu — matches Excalidraw's own
                                    hamburger menu for the same kind of rare actions, and
                                    keeps the always-visible row down to just the tools. */}
                                <Popover>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="size-9 rounded-lg hover:bg-neutral-100"
                                                    aria-label={t("toolbar.moreActions")}
                                                >
                                                    <DotsThreeVertical className="size-4" aria-hidden="true" />
                                                </Button>
                                            </PopoverTrigger>
                                        </TooltipTrigger>
                                        <TooltipContent>{t("toolbar.more")}</TooltipContent>
                                    </Tooltip>
                                    <PopoverContent className="w-56 p-1" side="bottom" align="end">
                                        <Button
                                            variant="ghost"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isLoading}
                                            className="w-full justify-start gap-2 px-2 py-2 text-sm font-normal text-neutral-700 hover:bg-neutral-100"
                                        >
                                            <Upload className="size-4 text-neutral-500" aria-hidden="true" />
                                            {t("toolbar.uploadEvaluatedPdf")}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={downloadAnnotatedPDF}
                                            disabled={isLoading}
                                            className="w-full justify-start gap-2 px-2 py-2 text-sm font-normal text-neutral-700 hover:bg-neutral-100"
                                        >
                                            <Download className="size-4 text-neutral-500" aria-hidden="true" />
                                            {t("toolbar.downloadAnnotatedPdf")}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={() => setIsResetDialogOpen(true)}
                                            disabled={isLoading}
                                            className="w-full justify-start gap-2 px-2 py-2 text-sm font-normal text-neutral-700 hover:bg-neutral-100"
                                        >
                                            <RefreshCcw className="size-4 text-neutral-500" aria-hidden="true" />
                                            {t("toolbar.resetAnnotations")}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            onClick={() => setIsHelpDialogOpen(true)}
                                            className="w-full justify-start gap-2 px-2 py-2 text-sm font-normal text-neutral-700 hover:bg-neutral-100"
                                        >
                                            <Info className="size-4 text-neutral-500" aria-hidden="true" />
                                            {t("toolbar.toolGuide")}
                                        </Button>
                                    </PopoverContent>
                                </Popover>
                                <AlertDialog
                                    open={isResetDialogOpen}
                                    onOpenChange={setIsResetDialogOpen}
                                >
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>{t("resetDialog.title")}</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                {t("resetDialog.description")}
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>{t("resetDialog.cancel")}</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={handleResetAnnotations}
                                                className="bg-danger-500 text-white hover:bg-danger-400"
                                            >
                                                {t("resetDialog.confirm")}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                {/* Submit confirmation — opened from the grading sidebar's
                                    "Submit evaluation" button (controlled via state). */}
                                <AlertDialog
                                    open={isSubmitDialogOpen}
                                    onOpenChange={setIsSubmitDialogOpen}
                                >
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>{t("submitDialog.title")}</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                {t("submitDialog.description")}
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>{t("submitDialog.cancel")}</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={handleSubmit}
                                                className="bg-primary-500 text-white hover:bg-primary-400"
                                            >
                                                {(isUploading || isUploadingFile) && (
                                                    <Loader2 className="size-6 animate-spin text-primary-500" />
                                                )}
                                                {t("submitDialog.confirm")}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                </div>
                                {canScrollToolbarRight && (
                                    <button
                                        type="button"
                                        onClick={() => scrollToolbar(200)}
                                        aria-label={t("toolbar.scrollRight")}
                                        className="absolute right-0 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-md hover:bg-neutral-50"
                                    >
                                        <ChevronRight className="size-3.5" aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </TooltipProvider>
                </div>

                <MyDialog
                    heading={t("toolbar.toolGuide")}
                    open={isHelpDialogOpen}
                    onOpenChange={setIsHelpDialogOpen}
                >
                    <div className="max-h-96 space-y-5 overflow-y-auto pr-1">
                        <div>
                            <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-neutral-500">
                                {t("helpDialog.annotationTools")}
                            </p>
                            <ul className="space-y-3">
                                {[...tools, deleteTool].map((tool) => (
                                    <li
                                        key={tool.label}
                                        className="flex items-start gap-3"
                                    >
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700">
                                            <tool.icon
                                                className="size-4"
                                                aria-hidden="true"
                                            />
                                        </span>
                                        <div>
                                            <p className="text-sm font-medium text-neutral-800">
                                                {tool.label}
                                            </p>
                                            <p className="text-xs text-neutral-500">
                                                {TOOL_HELP[tool.label]}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-neutral-500">
                                {t("helpDialog.controls")}
                            </p>
                            <ul className="space-y-3">
                                {CONTROL_HELP.map((item) => (
                                    <li
                                        key={item.label}
                                        className="flex items-start gap-3"
                                    >
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700">
                                            <item.icon
                                                className="size-4"
                                                aria-hidden="true"
                                            />
                                        </span>
                                        <div>
                                            <p className="text-sm font-medium text-neutral-800">
                                                {item.label}
                                            </p>
                                            <p className="text-xs text-neutral-500">
                                                {item.description}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </MyDialog>

                {/* PDF Viewer */}
                <div className="relative flex min-h-0 w-full flex-1">
                    <Card className="flex h-full w-full flex-col overflow-hidden">
                        <CardHeader className="shrink-0 border-b border-neutral-200 bg-white py-2">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <CardTitle className="text-base font-semibold">
                                        {t("header.title")}
                                    </CardTitle>
                                    {(pageRotations[pageNumber] ?? 0) !== 0 && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-info-50 px-2.5 py-1 text-2xs font-medium text-info-600">
                                            <RotateCw className="size-3" aria-hidden="true" />
                                            {t("header.rotatedBadge", { degrees: pageRotations[pageNumber] })}
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    <MyButton
                                        buttonType="primary"
                                        scale="medium"
                                        onClick={() => setShowEvaluationPanel(true)}
                                        className={cn(
                                            (isFreeTool || showEvaluationPanel) && "hidden"
                                        )}
                                        aria-label={t("header.openGradingPanel")}
                                    >
                                        {t("header.grade")}
                                    </MyButton>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent
                            ref={pdfScrollAreaRef}
                            className="min-h-0 flex-1 overflow-auto bg-neutral-100 p-4"
                        >
                            {loadingDoc ? (
                                <div className="flex h-full items-center justify-center">
                                    <DashboardLoader />
                                </div>
                            ) : (
                                <div
                                    ref={pdfViewerRef}
                                    className="relative mx-auto"
                                    style={{ /* design-lint-ignore: dynamic PDF page dimensions scaled by zoom */
                                        width: dimensions.width * zoomLevel,
                                        height: dimensions.height * zoomLevel,
                                    }}
                                >
                                    <div
                                        style={{ /* design-lint-ignore: dynamic canvas sizing */
                                            // overflowY: "auto",
                                            // overflowX: "auto",
                                            maxHeight: "fit-content",
                                            // width: "600px",
                                        }}
                                    >
                                        <div
                                            ref={canvasContainerRef}
                                            className="relative flex justify-start rounded-lg"
                                            style={{ /* design-lint-ignore: dynamic zoom transform */
                                                transform: `scale(${zoomLevel})`,
                                                transformOrigin: "top left",
                                            }}
                                        >
                                            <ProgressBar progress={progress} />
                                            <Document
                                                file={pdfUrl || file}
                                                onLoadSuccess={({ numPages }) => {
                                                    setNumPages(numPages);
                                                    setDocLoaded(true);
                                                }}
                                                onLoadProgress={({ loaded, total }) => {
                                                    setProgress((loaded / total) * 100);
                                                }}
                                                onLoadError={(error) => console.log(error)}
                                                className="absolute min-w-fit"
                                            >
                                                <Page
                                                    pageNumber={pageNumber}
                                                    scale={scale}
                                                    // Pass undefined (NOT 0) when the evaluator
                                                    // hasn't rotated: react-pdf resolves this as
                                                    // `rotate ?? page.rotate`, so a literal 0 would
                                                    // override the PDF's own /Rotate and render
                                                    // scanner output (which routinely carries one)
                                                    // sideways. Their rotation is applied ON TOP of
                                                    // the page's intrinsic orientation.
                                                    rotate={
                                                        pageRotations[pageNumber]
                                                            ? ((pageIntrinsicRotations[pageNumber] ?? 0) +
                                                                  pageRotations[pageNumber]) %
                                                              360
                                                            : undefined
                                                    }
                                                    devicePixelRatio={renderPixelRatio}
                                                    renderTextLayer={false}
                                                    renderAnnotationLayer={false}
                                                    className="max-h-fit shadow-lg"
                                                    onLoadSuccess={(loadedPage) => {
                                                        // Remember the page's own /Rotate so the
                                                        // evaluator's rotation can be added to it
                                                        // rather than replace it. Guarded so it
                                                        // can't loop on re-render.
                                                        const intrinsic = loadedPage.rotate ?? 0;
                                                        setPageIntrinsicRotations((prev) =>
                                                            prev[pageNumber] === intrinsic
                                                                ? prev
                                                                : { ...prev, [pageNumber]: intrinsic },
                                                        );
                                                    }}
                                                    onRenderSuccess={() => {
                                                        pendingResizeRef.current = false;
                                                        // Always sync the annotation canvas to the
                                                        // just-rendered page so the full page stays
                                                        // annotatable (first paint can land after the
                                                        // initial measure, and page sizes can vary).
                                                        remeasureCanvasToPdf();
                                                    }}
                                                />
                                            </Document>

                                            <canvas
                                                ref={canvasRef}
                                                className="absolute left-0 top-0 z-10"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Evaluation Panel (right column). Fixed header + scrollable content
                (which grows to fill the height, so no dead gap) + pinned action footer. */}
            {showEvaluationPanel && (
                    // On small screens the panel is a solid full-height overlay
                    // (fixed + bg-white + z-40) so the PDF column behind it can't
                    // show through or bleed its toolbar over the grading content.
                    // From sm up it becomes an in-flow right column again.
                    <div className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-neutral-200 bg-white sm:static sm:z-auto sm:w-96 sm:shrink-0 lg:w-1/4">
                        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3">
                            <div className="flex flex-col">
                                <span className="text-2xs font-medium uppercase tracking-wide text-neutral-500">
                                    {t("gradingPanel.gradingLabel")}
                                </span>
                                <h2 className="text-base font-semibold text-neutral-900">
                                    {t("gradingPanel.heading")}
                                </h2>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setShowEvaluationPanel(false)}
                                className="hover:bg-neutral-100"
                                aria-label={t("gradingPanel.closePanel")}
                                title={t("gradingPanel.closePanelTitle")}
                            >
                                <X className="size-5" aria-hidden="true" />
                            </Button>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
                            <Evaluation
                                totalPages={numPages}
                                pagesVisited={pagesVisited}
                                currentPage={pageNumber}
                                questionData={questionData}
                            />
                        </div>
                        {/* Save-draft + Submit at the end of the grading sidebar.
                            Stacked full-width so neither label ever clips in the
                            narrow panel; Submit (primary) leads, Save draft is the
                            lighter fallback for finishing later. */}
                        {!isFreeTool && (
                            <div className="shrink-0 space-y-2 border-t border-neutral-200 bg-white p-4">
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => setIsSubmitDialogOpen(true)}
                                    disable={isLoading || !canSubmit}
                                    className="w-full"
                                >
                                    {t("footer.submitEvaluation")}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={persistDraft}
                                    disable={isSavingDraft || isLoading || isUploading}
                                    className="w-full"
                                >
                                    {isSavingDraft ? t("footer.savingDraft") : t("footer.saveDraft")}
                                </MyButton>
                                {(draftSavedAt || !canSubmit) && (
                                    <p className="text-center text-xs text-neutral-400">
                                        {draftSavedAt
                                            ? t("footer.draftSavedHint", { time: formatSavedAt(draftSavedAt) })
                                            : t("footer.awardMarksHint")}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}

            {/* Bottom floating page + zoom controls */}
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center">
                <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1 shadow-lg">
                    <button
                        onClick={handleUndo}
                        disabled={!canUndo || isLoading}
                        aria-label={t("bottomBar.undo")}
                        title={t("bottomBar.undo")}
                        className="cursor-pointer rounded-full p-2 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <ArrowUUpLeft className="size-4" aria-hidden="true" />
                    </button>
                    <button
                        onClick={handleRedo}
                        disabled={!canRedo || isLoading}
                        aria-label={t("bottomBar.redo")}
                        title={t("bottomBar.redo")}
                        className="cursor-pointer rounded-full p-2 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <ArrowUUpRight className="size-4" aria-hidden="true" />
                    </button>
                    <div className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
                    <button
                        onClick={() => changePage(-1)}
                        disabled={pageNumber <= 1 || isLoading}
                        aria-label={t("bottomBar.previousPage")}
                        title={t("bottomBar.previousPage")}
                        className="cursor-pointer rounded-full p-2 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <ChevronLeft className="size-4" aria-hidden="true" />
                    </button>
                    <span className="min-w-14 text-center text-xs font-medium tabular-nums text-neutral-700">
                        {pageNumber} / {numPages || "--"}
                    </span>
                    <button
                        onClick={() => changePage(1)}
                        disabled={pageNumber >= numPages || isLoading}
                        aria-label={t("bottomBar.nextPage")}
                        title={t("bottomBar.nextPage")}
                        className="cursor-pointer rounded-full p-2 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <ChevronRight className="size-4" aria-hidden="true" />
                    </button>
                    <div className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
                    <button
                        onClick={handleZoomOut}
                        disabled={isLoading || zoomLevel <= MIN_ZOOM}
                        aria-label={t("bottomBar.zoomOut")}
                        title={t("bottomBar.zoomOut")}
                        className="cursor-pointer rounded-full p-2 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <MagnifyingGlassMinus size={16} aria-hidden="true" />
                    </button>
                    <button
                        onClick={handleResetZoom}
                        disabled={isLoading}
                        aria-label={t("bottomBar.fitPageToWidth")}
                        title={t("bottomBar.fitPageToWidth")}
                        className="min-w-12 cursor-pointer rounded-full px-2 py-1 text-center text-xs font-medium tabular-nums text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-40"
                    >
                        {Math.round(zoomLevel * 100)}%
                    </button>
                    <button
                        onClick={handleZoomIn}
                        disabled={isLoading || zoomLevel >= MAX_ZOOM}
                        aria-label={t("bottomBar.zoomIn")}
                        title={t("bottomBar.zoomIn")}
                        className="cursor-pointer rounded-full p-2 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <MagnifyingGlassPlus size={16} aria-hidden="true" />
                    </button>
                    <div className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
                    <button
                        onClick={() => rotatePage(-90)}
                        disabled={isLoading}
                        aria-label={t("bottomBar.rotateLeft")}
                        title={t("bottomBar.rotateLeft")}
                        className="cursor-pointer rounded-full p-2 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-40"
                    >
                        <RotateCcw size={16} aria-hidden="true" />
                    </button>
                    <button
                        onClick={() => rotatePage(90)}
                        disabled={isLoading}
                        aria-label={t("bottomBar.rotateRight")}
                        title={t("bottomBar.rotateRight")}
                        className="cursor-pointer rounded-full p-2 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-40"
                    >
                        <RotateCw size={16} aria-hidden="true" />
                    </button>
                    <div className="mx-1 h-5 w-px bg-neutral-200" aria-hidden="true" />
                    <button
                        onClick={toggleFullscreen}
                        aria-label={isFullscreen ? t("bottomBar.exitFullscreen") : t("bottomBar.enterFullscreen")}
                        title={isFullscreen ? t("bottomBar.exitFullscreen") : t("bottomBar.fullscreenTitleEnter")}
                        aria-pressed={isFullscreen}
                        className={cn(
                            "cursor-pointer rounded-full p-2 transition-colors hover:bg-neutral-100",
                            isFullscreen ? "bg-primary-100 text-primary-600" : "text-neutral-700",
                        )}
                    >
                        {isFullscreen ? (
                            <CornersIn size={16} aria-hidden="true" />
                        ) : (
                            <CornersOut size={16} aria-hidden="true" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PDFEvaluator;
