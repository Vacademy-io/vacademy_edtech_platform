import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useExamExperienceSettings } from "@/hooks/use-exam-experience-settings";
import {
  DEFAULT_EXAM_EXPERIENCE,
  type ExamExperienceSettings,
  type QuestionPaletteView,
} from "@/types/assessment-experience";

export type ExamTool = "calculator" | "scratchpad";

interface LiveTestUiContextValue {
  settings: ExamExperienceSettings;
  /** True once the viewport is phone-sized (matches Tailwind's `md` breakpoint). */
  isCompact: boolean;
  activeTool: ExamTool | null;
  toggleTool: (tool: ExamTool) => void;
  closeTool: () => void;
  scratchpad: string;
  setScratchpad: (value: string) => void;
  isPaletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /**
   * Desktop right rail. Open by default; the learner can collapse it to give
   * the question — a code editor especially — the full width. Independent of
   * `isPaletteOpen`, which is the phone bottom sheet.
   */
  isRailOpen: boolean;
  setRailOpen: (open: boolean) => void;
  paletteView: QuestionPaletteView;
  setPaletteView: (view: QuestionPaletteView) => void;
  /**
   * Bumped when a surface outside the header asks to submit (the palette's
   * "Submit paper" button). The header owns the submit flow — modal, retries,
   * proctoring teardown — so it watches this instead of duplicating any of it.
   */
  submitRequestId: number;
  requestSubmit: () => void;
}

const FALLBACK: LiveTestUiContextValue = {
  settings: DEFAULT_EXAM_EXPERIENCE,
  isCompact: false,
  activeTool: null,
  toggleTool: () => {},
  closeTool: () => {},
  scratchpad: "",
  setScratchpad: () => {},
  isPaletteOpen: false,
  setPaletteOpen: () => {},
  isRailOpen: true,
  setRailOpen: () => {},
  paletteView: "grid",
  setPaletteView: () => {},
  submitRequestId: 0,
  requestSubmit: () => {},
};

const LiveTestUiContext = createContext<LiveTestUiContextValue>(FALLBACK);

const COMPACT_QUERY = "(max-width: 767px)";

/**
 * Chrome state shared by the exam shell's header, footer and palette.
 *
 * These pieces are siblings rather than a single component (the header owns
 * submit/proctoring, the footer owns navigation), so the tool and palette
 * toggles they both drive live here instead of being drilled through `Page`.
 */
export function LiveTestUiProvider({ children }: { children: ReactNode }) {
  const settings = useExamExperienceSettings();
  const [activeTool, setActiveTool] = useState<ExamTool | null>(null);
  const [scratchpad, setScratchpad] = useState("");
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const [isRailOpen, setRailOpen] = useState(true);
  const [submitRequestId, setSubmitRequestId] = useState(0);
  const [paletteView, setPaletteView] = useState<QuestionPaletteView>(
    DEFAULT_EXAM_EXPERIENCE.questionPalette.defaultView,
  );
  const [isCompact, setIsCompact] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(COMPACT_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsCompact(event.matches);
    setIsCompact(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // The institute's default view applies until the learner picks one; after
  // that their choice stands for the rest of the attempt.
  const configuredView = settings.questionPalette.defaultView;
  useEffect(() => {
    setPaletteView(configuredView);
  }, [configuredView]);

  // A tool the institute turned off must not stay open across a settings
  // refresh mid-attempt.
  useEffect(() => {
    if (activeTool === "calculator" && !settings.calculator.enabled) {
      setActiveTool(null);
    }
    if (activeTool === "scratchpad" && !settings.scratchpad.enabled) {
      setActiveTool(null);
    }
  }, [activeTool, settings.calculator.enabled, settings.scratchpad.enabled]);

  const value = useMemo<LiveTestUiContextValue>(
    () => ({
      settings,
      isCompact,
      activeTool,
      toggleTool: (tool) =>
        setActiveTool((prev) => (prev === tool ? null : tool)),
      closeTool: () => setActiveTool(null),
      scratchpad,
      setScratchpad,
      isPaletteOpen,
      setPaletteOpen,
      isRailOpen,
      setRailOpen,
      paletteView,
      setPaletteView,
      submitRequestId,
      requestSubmit: () => {
        setPaletteOpen(false);
        setSubmitRequestId((prev) => prev + 1);
      },
    }),
    [
      settings,
      isCompact,
      activeTool,
      scratchpad,
      isPaletteOpen,
      isRailOpen,
      paletteView,
      submitRequestId,
    ],
  );

  return (
    <LiveTestUiContext.Provider value={value}>
      {children}
    </LiveTestUiContext.Provider>
  );
}

export function useLiveTestUi(): LiveTestUiContextValue {
  return useContext(LiveTestUiContext);
}
