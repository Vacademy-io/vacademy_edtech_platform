/**
 * Every string the CBE kit shows or announces. English by default; an app that
 * ships other languages wraps the kit in <CbeStringsProvider> with translated
 * strings (the learner app builds them from i18n). Kept identical in both apps.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { CbePartKind } from "./types";

export type CbeToolKey =
  | "spreadsheetToolbar"
  | "textToolbar"
  | "undo"
  | "redo"
  | "bold"
  | "italic"
  | "underline"
  | "alignLeft"
  | "alignCentre"
  | "alignRight"
  | "thousands"
  | "moreDecimals"
  | "fewerDecimals"
  | "percent"
  | "topBorder"
  | "bottomBorder"
  | "clearBorders"
  | "mergeCells"
  | "unmergeCells"
  | "bulletList"
  | "numberedList"
  | "insertTable"
  | "addRowBelow"
  | "addColumnRight"
  | "deleteRow"
  | "deleteColumn"
  | "deleteTable";

export type CbeStrings = {
  kind: Record<CbePartKind, string>;
  /** "16 marks" */
  marks: (count: number) => string;
  /** Accessible name of a part's editor, from its tab label. */
  partAnswer: (tabLabel: string) => string;
  noParts: string;
  /** Sizes arrive formatted ("312 KB"). */
  sizeTooLarge: (size: string, max: string) => string;
  sizeNearLimit: (size: string, max: string) => string;
  spreadsheetLoadFailed: string;
  documentLoadFailed: string;
  tryAgain: string;
  documentPlaceholder: string;
  writtenAnswer: string;
  spreadsheetAnswer: string;
  noSpreadsheetAnswer: string;
  noWrittenAnswer: string;
  emptyTab: string;
  rowHeader: string;
  tools: Record<CbeToolKey, string>;
};

export const DEFAULT_CBE_STRINGS: CbeStrings = {
  kind: { SPREADSHEET: "Spreadsheet", DOCUMENT: "Document" },
  marks: (count) => `${count} ${count === 1 ? "mark" : "marks"}`,
  partAnswer: (tabLabel) => `${tabLabel} answer`,
  noParts: "This question has no answer parts.",
  sizeTooLarge: (size, max) =>
    `Your answer is too large to save (${size} of ${max}). Remove unused rows, tabs or pasted content.`,
  sizeNearLimit: (size, max) => `Your answer is close to the size limit (${size} of ${max}).`,
  spreadsheetLoadFailed: "The spreadsheet could not be loaded.",
  documentLoadFailed: "The document editor could not be loaded.",
  tryAgain: "Try again",
  documentPlaceholder: "Write your answer here…",
  writtenAnswer: "Written answer",
  spreadsheetAnswer: "Spreadsheet answer",
  noSpreadsheetAnswer: "No spreadsheet answer.",
  noWrittenAnswer: "No written answer.",
  emptyTab: "This tab is empty.",
  rowHeader: "Row",
  tools: {
    spreadsheetToolbar: "Spreadsheet formatting",
    textToolbar: "Text formatting",
    undo: "Undo",
    redo: "Redo",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    alignLeft: "Align left",
    alignCentre: "Align centre",
    alignRight: "Align right",
    thousands: "Thousands separator (#,##0)",
    moreDecimals: "More decimals",
    fewerDecimals: "Fewer decimals",
    percent: "Percent",
    topBorder: "Top border",
    bottomBorder: "Bottom border",
    clearBorders: "Clear borders",
    mergeCells: "Merge cells",
    unmergeCells: "Unmerge cells",
    bulletList: "Bulleted list",
    numberedList: "Numbered list",
    insertTable: "Insert table",
    addRowBelow: "Add row below",
    addColumnRight: "Add column right",
    deleteRow: "Delete row",
    deleteColumn: "Delete column",
    deleteTable: "Delete table",
  },
};

const CbeStringsContext = createContext<CbeStrings>(DEFAULT_CBE_STRINGS);

export function CbeStringsProvider({ value, children }: { value: CbeStrings; children: ReactNode }) {
  return <CbeStringsContext.Provider value={value}>{children}</CbeStringsContext.Provider>;
}

export const useCbeStrings = (): CbeStrings => useContext(CbeStringsContext);
