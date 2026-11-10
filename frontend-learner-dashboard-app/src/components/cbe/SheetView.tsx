/**
 * Light read-only renderer for a CbeSheet (reports, review, previews). A plain
 * HTML table: row/column headers, formatted values, the formula in each cell's
 * tooltip. Does not load Fortune-sheet.
 */
import { useMemo, useState, type CSSProperties } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useCbeStrings } from "./cbe-strings";
import { colToLetters, parseA1, parseRange, splitSheetRef, toA1 } from "./a1";
import { formatCbeCell } from "./format";
import type { CbeCell, CbeSheet, CbeSheetTab } from "./types";

export type SheetViewProps = {
  sheet: CbeSheet | null | undefined;
  className?: string;
  /** Index of the tab shown first (default 0). */
  initialTab?: number;
  /** "Tab!B7" (or bare "B7") refs to highlight, e.g. marking-scheme cells. */
  highlight?: string[];
  /** Shown when the sheet has no content. */
  emptyText?: string;
};

type Layout = {
  rows: number;
  cols: number;
  /** "r_c" of merge masters -> spans */
  spans: Map<string, { rs: number; cs: number }>;
  /** "r_c" of cells hidden under a merge */
  covered: Set<string>;
};

function layoutOf(tab: CbeSheetTab): Layout {
  let rows = 0;
  let cols = 0;
  for (const ref of Object.keys(tab.cells ?? {})) {
    const p = parseA1(ref);
    if (!p) continue;
    rows = Math.max(rows, p.r + 1);
    cols = Math.max(cols, p.c + 1);
  }
  const spans = new Map<string, { rs: number; cs: number }>();
  const covered = new Set<string>();
  for (const m of tab.merges ?? []) {
    const r = parseRange(m);
    if (!r) continue;
    rows = Math.max(rows, r.e.r + 1);
    cols = Math.max(cols, r.e.c + 1);
    spans.set(`${r.s.r}_${r.s.c}`, { rs: r.e.r - r.s.r + 1, cs: r.e.c - r.s.c + 1 });
    for (let rr = r.s.r; rr <= r.e.r; rr += 1) {
      for (let cc = r.s.c; cc <= r.e.c; cc += 1) {
        if (rr !== r.s.r || cc !== r.s.c) covered.add(`${rr}_${cc}`);
      }
    }
  }
  return { rows, cols, spans, covered };
}

const ALIGN = { l: "text-left", c: "text-center", r: "text-right" } as const;

function cellClass(cell: CbeCell | undefined, highlighted: boolean): string {
  const s = cell?.s;
  const v = cell?.v;
  const align = s?.al ?? (typeof v === "number" ? "r" : typeof v === "boolean" ? "c" : "l");
  return cn(
    "border border-border px-2 py-1 align-top text-caption text-foreground",
    typeof v === "number" ? "whitespace-nowrap tabular-nums" : "whitespace-pre-wrap break-words",
    ALIGN[align],
    s?.b && "font-bold", // user-authored bold in the sheet, not UI chrome
    s?.i && "italic",
    s?.u && "underline",
    s?.bt && "border-t-2 border-t-foreground",
    s?.bb && "border-b-2 border-b-foreground",
    highlighted && "bg-primary-50 outline outline-2 -outline-offset-2 outline-primary-300",
  );
}

/** User-authored cell colours are data, not theme tokens — applied inline on purpose. */
function cellColors(cell: CbeCell | undefined): CSSProperties | undefined {
  const s = cell?.s;
  if (!s?.bg && !s?.fc) return undefined;
  return { backgroundColor: s.bg, color: s.fc };
}

export function SheetView({ sheet, className, initialTab = 0, highlight, emptyText: emptyTextProp }: SheetViewProps) {
  const strings = useCbeStrings();
  const emptyText = emptyTextProp ?? strings.noSpreadsheetAnswer;
  const tabs = sheet?.sheets ?? [];
  const [active, setActive] = useState(() => Math.min(Math.max(initialTab, 0), Math.max(tabs.length - 1, 0)));
  const tab = tabs[active] ?? tabs[0];
  const layout = useMemo(() => (tab ? layoutOf(tab) : null), [tab]);
  const marked = useMemo(() => {
    const set = new Set<string>();
    for (const full of highlight ?? []) {
      const { sheet: s, ref } = splitSheetRef(full);
      if (!tab || (s !== null && s !== tab.name)) continue;
      const p = parseA1(ref);
      if (p) set.add(toA1(p.r, p.c));
    }
    return set;
  }, [highlight, tab]);

  const isEmpty = !tab || !layout || layout.rows === 0 || layout.cols === 0;
  const allEmpty = tabs.every((t) => Object.keys(t.cells ?? {}).length === 0);

  if (!tabs.length || allEmpty) {
    return <p className={cn("text-body italic text-muted-foreground", className)}>{emptyText}</p>;
  }

  const colIdx = layout ? Array.from({ length: layout.cols }, (_, c) => c) : [];
  const rowIdx = layout ? Array.from({ length: layout.rows }, (_, r) => r) : [];

  return (
    <div className={cn("flex flex-col gap-2", className)} data-cbe-sheet-view="">
      {tabs.length > 1 && (
        <Tabs value={String(active)} onValueChange={(v) => setActive(Number(v))}>
          <TabsList className="h-auto flex-wrap justify-start">
            {tabs.map((t, i) => (
              <TabsTrigger key={`${t.name}-${i}`} value={String(i)} className="text-caption">
                {t.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {isEmpty ? (
        <p className="text-body italic text-muted-foreground">{strings.emptyTab}</p>
      ) : (
        <div className="max-h-screen overflow-auto rounded-md border border-border bg-card">
          <table className="table-fixed border-collapse" aria-label={tab?.name}>
            <colgroup>
              <col className="w-10" />
              {colIdx.map((c) => {
                const w = tab?.colWidths?.[colToLetters(c)];
                return (
                  <col
                    key={c}
                    className={w ? undefined : "w-24"}
                    style={w ? { width: w } : undefined} /* design-lint-ignore: authored column width (data) */
                  />
                );
              })}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border border-border bg-muted" aria-label={strings.rowHeader} />
                {colIdx.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="sticky top-0 z-10 border border-border bg-muted px-2 py-0.5 text-center text-caption font-semibold text-muted-foreground"
                  >
                    {colToLetters(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowIdx.map((r) => (
                <tr key={r}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border border-border bg-muted px-1 text-center text-caption font-semibold text-muted-foreground"
                  >
                    {r + 1}
                  </th>
                  {colIdx.map((c) => {
                    const key = `${r}_${c}`;
                    if (layout?.covered.has(key)) return null;
                    const ref = toA1(r, c);
                    const cell = tab?.cells[ref];
                    const span = layout?.spans.get(key);
                    const text = formatCbeCell(cell);
                    const title = cell?.f ? `${ref}: ${cell.f}` : text.length > 24 ? text : undefined;
                    return (
                      <td
                        key={key}
                        rowSpan={span?.rs}
                        colSpan={span?.cs}
                        data-ref={ref}
                        data-formula={cell?.f}
                        title={title}
                        className={cellClass(cell, marked.has(ref))}
                        style={cellColors(cell)}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default SheetView;
