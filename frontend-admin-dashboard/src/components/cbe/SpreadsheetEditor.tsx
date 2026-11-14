/**
 * Spreadsheet answer editor: Fortune-sheet behind React.lazy, our own trimmed
 * accounting toolbar on top, CbeSheet in and out.
 *
 *  - `value` seeds the grid. Changes that come back from our own onChange are
 *    recognised and do not remount it; any other new value (template import,
 *    reset) does.
 *  - `onChange` is debounced (400 ms) and flushed on unmount, and only fires
 *    when the sheet really changed.
 *  - Formulas imported without cached values are recalculated on load.
 *  - `commit()` (ref handle, and the commit registry for submits) saves the
 *    cell being typed in and emits the pending change at once. A pointerdown
 *    outside the editor does the same: Fortune's in-cell editor has no blur
 *    handling, so a click on Submit / Next would otherwise drop the entry.
 */
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { WorkbookInstance } from "@fortune-sheet/react";
import {
  AlignBottomSimple,
  AlignTopSimple,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsMerge,
  Percent,
  Square,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextUnderline,
} from "@phosphor-icons/react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CbeErrorBoundary } from "./cbe-error-boundary";
import { useCbeStrings } from "./cbe-strings";
import { registerCbeCommit } from "./commit-registry";
import { ToolButton, ToolDivider, ToolText, Toolbar } from "./cbe-toolbar";
import { adjustDecimals } from "./format";
import {
  cbeSheetSignature,
  cbeToFortune,
  fortuneToCbe,
  hasUncomputedFormulas,
  type FortuneSheet,
} from "./fortune-adapter";
import { emptyCbeSheet, type CbeSheet } from "./types";

const loadWorkbook = () => import("./fortune-workbook");

export const CBE_THOUSANDS_FORMAT = "#,##0";
export const CBE_PERCENT_FORMAT = "0%";

export type SpreadsheetEditorProps = {
  value: CbeSheet | null | undefined;
  onChange?: (sheet: CbeSheet) => void;
  readOnly?: boolean;
  /** Grid height in px (default 420). */
  height?: number;
  /** onChange debounce in ms (default 400). */
  debounceMs?: number;
  className?: string;
  /** Accessible name of the grid region. */
  label?: string;
};

export type SpreadsheetEditorHandle = {
  /** Saves an open cell edit and emits any pending change now (synchronously). */
  commit: () => void;
};

type FocusState = { b: boolean; i: boolean; u: boolean; ht: number | null; merged: boolean };
const NO_FOCUS: FocusState = { b: false, i: false, u: false, ht: null, merged: false };

type Sel = { row: number[]; column: number[] };

const CELL_MENU = ["copy", "paste", "|", "insert-row", "insert-column", "delete-row", "delete-column", "|", "clear"];
const HEADER_MENU = [
  "copy",
  "paste",
  "|",
  "insert-row",
  "insert-column",
  "delete-row",
  "delete-column",
  "|",
  "set-column-width",
  "set-row-height",
  "|",
  "clear",
];
const TAB_MENU = ["rename", "delete"];

export const SpreadsheetEditor = forwardRef<SpreadsheetEditorHandle, SpreadsheetEditorProps>(function SpreadsheetEditor(
  { value, onChange, readOnly = false, height = 420, debounceMs = 400, className, label },
  ref,
) {
  const strings = useCbeStrings();
  const tools = strings.tools;
  const [Workbook, setWorkbook] = useState(() => lazy(loadWorkbook));
  const wbRef = useRef<WorkbookInstance | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // --- seed / external value tracking ------------------------------------
  const lastSigRef = useRef<string>(cbeSheetSignature(value ?? emptyCbeSheet()));
  const [seed, setSeed] = useState(() => ({ sheet: value ?? emptyCbeSheet(), key: 0 }));
  useEffect(() => {
    if (!value) return;
    const sig = cbeSheetSignature(value);
    if (sig === lastSigRef.current) return; // our own echo, or no real change
    lastSigRef.current = sig;
    setSeed((s) => ({ sheet: value, key: s.key + 1 }));
  }, [value]);

  const data = useMemo(() => cbeToFortune(seed.sheet, { dense: true }), [seed]);
  // Fortune sheet ids whose imported formulas still need computing. Fortune's
  // calculateFormula writes results into the ACTIVE sheet, so each tab is
  // recalculated only while it is the active one (on mount / on activation).
  const recalcPlan = useMemo(
    () =>
      new Set(
        data
          .filter((fs, i) => fs.id && hasUncomputedFormulas({ sheets: [seed.sheet.sheets[i] ?? { name: "", cells: {} }] }))
          .map((fs) => fs.id as string),
      ),
    [data, seed.sheet],
  );
  // Read by the ref callback, which can run before effects; one Set per seed.
  const recalcPlanRef = useRef(recalcPlan);
  recalcPlanRef.current = recalcPlan;
  const recalc = useCallback((sheetId: string | undefined) => {
    const wb = wbRef.current;
    const plan = recalcPlanRef.current;
    if (!wb || !sheetId || !plan.has(sheetId)) return;
    plan.delete(sheetId);
    setTimeout(() => {
      try {
        wb.calculateFormula(sheetId);
      } catch (e) {
        console.warn("[cbe] formula recalculation failed", e);
      }
    }, 0);
  }, []);

  // --- debounced change emission -----------------------------------------
  const pendingRef = useRef<FortuneSheet[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const next = fortuneToCbe(pending);
    const sig = cbeSheetSignature(next);
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;
    onChangeRef.current?.(next);
  }, []);
  const handleChange = useCallback(
    (sheets: unknown) => {
      if (readOnly) return;
      pendingRef.current = sheets as FortuneSheet[];
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, debounceMs);
    },
    [debounceMs, flush, readOnly],
  );
  useEffect(() => flush, [flush]);

  // --- commit: save the cell being edited, then emit now ---------------------
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Ends an open in-cell edit the way Enter does. True when one was open. */
  const commitOpenEdit = useCallback((): boolean => {
    const grid = gridRef.current;
    const wb = wbRef.current;
    if (readOnly || !grid || !wb) return false;
    // Fortune lifts its in-cell editor above the grid (z-index > 0) only while a cell is edited.
    const box = grid.querySelector<HTMLElement>(".luckysheet-input-box");
    const input = grid.querySelector<HTMLElement>(".luckysheet-cell-input");
    if (!box || !input || !(Number(box.style.zIndex) > 0)) return false;
    // An open formula suggestion would take the Enter instead of the cell.
    grid
      .querySelectorAll(".luckysheet-formula-search-item-active")
      .forEach((el) => el.classList.remove("luckysheet-formula-search-item-active"));
    let selection: unknown;
    try {
      selection = wb.getSelection();
    } catch {
      selection = undefined;
    }
    try {
      // flushSync: the grid's state (and our ref handle) is current when this returns.
      flushSync(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }),
        );
      });
    } catch (e) {
      console.warn("[cbe] committing the open cell failed", e);
      return false;
    }
    // Enter also moves the cursor down a row; leave it where the learner was.
    if (Array.isArray(selection) && selection.length) {
      try {
        wbRef.current?.setSelection(selection as never);
      } catch {
        /* selection restore is cosmetic */
      }
    }
    return true;
  }, [readOnly]);

  const commit = useCallback(() => {
    if (readOnly) return;
    if (commitOpenEdit()) {
      try {
        const sheets = wbRef.current?.getAllSheets();
        if (sheets?.length) pendingRef.current = sheets as unknown as FortuneSheet[];
      } catch (e) {
        console.warn("[cbe] reading the sheet after commit failed", e);
      }
    }
    flush();
  }, [commitOpenEdit, flush, readOnly]);

  useImperativeHandle(ref, () => ({ commit }), [commit]);

  useEffect(() => {
    if (readOnly) return;
    const unregister = registerCbeCommit(commit);
    // Capture phase: runs before the clicked control (Submit, Next, a tab) acts.
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root || (event.target instanceof Node && root.contains(event.target))) return;
      commit();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      unregister();
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [commit, readOnly]);

  // --- toolbar state -----------------------------------------------------
  const [focus, setFocus] = useState<FocusState>(NO_FOCUS);
  const focusPosRef = useRef<{ r: number; c: number } | null>(null);
  const refreshFocus = useCallback(() => {
    const wb = wbRef.current;
    const pos = focusPosRef.current;
    if (!wb || !pos) return;
    const get = (type: string) => {
      try {
        return wb.getCellValue(pos.r, pos.c, { type: type as never });
      } catch {
        return undefined;
      }
    };
    const ht = get("ht");
    setFocus({
      b: Number(get("bl")) === 1,
      i: Number(get("it")) === 1,
      u: Number(get("un")) === 1,
      ht: ht === undefined || ht === null || ht === "" ? null : Number(ht),
      merged: !!get("mc"),
    });
  }, []);
  const hooks = useMemo(
    () => ({
      afterSelectionChange: (sheetId: string, sel: { row_focus?: number; column_focus?: number; row: number[]; column: number[] }) => {
        // Fortune's tab bar switches sheets without firing afterActivateSheet;
        // this hook does run on every sheet switch, so recalc from here too.
        recalc(sheetId);
        const r = sel.row_focus ?? sel.row[0];
        const c = sel.column_focus ?? sel.column[0];
        if (r === undefined || c === undefined) return;
        focusPosRef.current = { r, c };
        // Hooks run inside Fortune's render cycle; read state after it settles.
        setTimeout(refreshFocus, 0);
      },
      afterActivateSheet: (sheetId: string) => recalc(sheetId),
    }),
    [recalc, refreshFocus],
  );

  const firstSheetId = data[0]?.id;
  const setWorkbookRef = useCallback(
    (inst: WorkbookInstance | null) => {
      wbRef.current = inst;
      if (inst) recalc(firstSheetId);
    },
    [firstSheetId, recalc],
  );

  // --- toolbar actions ---------------------------------------------------
  const withSelection = useCallback(
    (fn: (wb: WorkbookInstance, sel: Sel[]) => void) => {
      const wb = wbRef.current;
      const sel = wb?.getSelection() as Sel[] | undefined;
      if (!wb || !sel?.length) return;
      try {
        fn(wb, sel);
      } catch (e) {
        console.warn("[cbe] toolbar action failed", e);
      }
      setTimeout(refreshFocus, 0);
    },
    [refreshFocus],
  );
  const setAttr = (attr: string, v: unknown) =>
    withSelection((wb, sel) => wb.setCellFormatByRange(attr as never, v, sel));
  const setFormat = (fa: string) => setAttr("ct", { fa, t: "n" });
  const changeDecimals = (delta: 1 | -1) =>
    withSelection((wb, sel) => {
      const pos = focusPosRef.current;
      const ct = pos ? (wb.getCellValue(pos.r, pos.c, { type: "ct" }) as { fa?: string } | undefined) : undefined;
      wb.setCellFormatByRange("ct", { fa: adjustDecimals(ct?.fa, delta), t: "n" }, sel);
    });
  const border = (edge: "top" | "bottom" | "none") =>
    withSelection((wb, sel) => {
      for (const s of sel) {
        const [r1 = 0, r2 = r1] = s.row;
        const row = edge === "top" ? [r1, r1] : edge === "bottom" ? [r2, r2] : [r1, r2];
        wb.setCellFormatByRange("bd" as never, { borderType: `border-${edge}` }, { row, column: s.column });
      }
    });
  const toggleMerge = () =>
    withSelection((wb, sel) => {
      if (focus.merged) wb.cancelMerge(sel);
      else wb.mergeCells(sel, "merge-all");
    });

  const retry = useCallback(() => setWorkbook(() => lazy(loadWorkbook)), []);

  const showTabs = !readOnly || seed.sheet.sheets.length > 1;

  return (
    <div
      ref={rootRef}
      className={cn("flex w-full flex-col overflow-hidden rounded-md border border-border bg-card", className)}
      aria-label={label ?? strings.spreadsheetAnswer}
      role="region"
      // Answer surface marker (same in both apps; the learner app's proctoring allows copy / select here).
      data-cbe-workspace=""
    >
      {!readOnly && (
        <Toolbar label={tools.spreadsheetToolbar}>
          <ToolButton label={tools.undo} onClick={() => wbRef.current?.handleUndo()}>
            <ArrowCounterClockwise size={16} />
          </ToolButton>
          <ToolButton label={tools.redo} onClick={() => wbRef.current?.handleRedo()}>
            <ArrowClockwise size={16} />
          </ToolButton>
          <ToolDivider />
          <ToolButton label={tools.bold} active={focus.b} onClick={() => setAttr("bl", focus.b ? 0 : 1)}>
            <TextB size={16} weight="bold" />
          </ToolButton>
          <ToolButton label={tools.italic} active={focus.i} onClick={() => setAttr("it", focus.i ? 0 : 1)}>
            <TextItalic size={16} />
          </ToolButton>
          <ToolButton label={tools.underline} active={focus.u} onClick={() => setAttr("un", focus.u ? 0 : 1)}>
            <TextUnderline size={16} />
          </ToolButton>
          <ToolDivider />
          <ToolButton label={tools.alignLeft} active={focus.ht === 1} onClick={() => setAttr("ht", 1)}>
            <TextAlignLeft size={16} />
          </ToolButton>
          <ToolButton label={tools.alignCentre} active={focus.ht === 0} onClick={() => setAttr("ht", 0)}>
            <TextAlignCenter size={16} />
          </ToolButton>
          <ToolButton label={tools.alignRight} active={focus.ht === 2} onClick={() => setAttr("ht", 2)}>
            <TextAlignRight size={16} />
          </ToolButton>
          <ToolDivider />
          <ToolButton label={tools.thousands} onClick={() => setFormat(CBE_THOUSANDS_FORMAT)}>
            <ToolText>1,000</ToolText>
          </ToolButton>
          <ToolButton label={tools.moreDecimals} onClick={() => changeDecimals(1)}>
            <ToolText>.0+</ToolText>
          </ToolButton>
          <ToolButton label={tools.fewerDecimals} onClick={() => changeDecimals(-1)}>
            <ToolText>.0−</ToolText>
          </ToolButton>
          <ToolButton label={tools.percent} onClick={() => setFormat(CBE_PERCENT_FORMAT)}>
            <Percent size={16} />
          </ToolButton>
          <ToolDivider />
          <ToolButton label={tools.topBorder} onClick={() => border("top")}>
            <AlignTopSimple size={16} />
          </ToolButton>
          <ToolButton label={tools.bottomBorder} onClick={() => border("bottom")}>
            <AlignBottomSimple size={16} />
          </ToolButton>
          <ToolButton label={tools.clearBorders} onClick={() => border("none")}>
            <Square size={16} />
          </ToolButton>
          <ToolButton label={focus.merged ? tools.unmergeCells : tools.mergeCells} active={focus.merged} onClick={toggleMerge}>
            <ArrowsMerge size={16} />
          </ToolButton>
        </Toolbar>
      )}
      <div
        ref={gridRef}
        className="relative w-full"
        style={{ height }} /* design-lint-ignore: runtime height prop; Fortune-sheet needs a pixel box */
        data-cbe-grid=""
      >
        <CbeErrorBoundary
          label="spreadsheet"
          message={strings.spreadsheetLoadFailed}
          retryLabel={strings.tryAgain}
          onRetry={retry}
        >
          <Suspense fallback={<Skeleton className="size-full rounded-none" />}>
            <Workbook
              key={seed.key}
              ref={setWorkbookRef}
              data={data as never}
              onChange={handleChange}
              lang="en"
              allowEdit={!readOnly}
              showToolbar={false}
              showFormulaBar
              showSheetTabs={showTabs}
              cellContextMenu={readOnly ? [] : CELL_MENU}
              headerContextMenu={readOnly ? [] : HEADER_MENU}
              sheetTabContextMenu={readOnly ? [] : TAB_MENU}
              hooks={hooks as never}
            />
          </Suspense>
        </CbeErrorBoundary>
      </div>
    </div>
  );
});

export default SpreadsheetEditor;
