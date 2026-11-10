/**
 * CBE_RESPONSE shared frontend kit (contract: docs/CBE_RESPONSE_QUESTION.md §7).
 *
 * Bundle notes:
 *  - Fortune-sheet is only reached through React.lazy inside SpreadsheetEditor.
 *  - DocumentEditor (TipTap) is lazy inside CbeWorkspace; import it directly
 *    only where an editor is always shown.
 *  - xlsx-import pulls in SheetJS and is NOT re-exported here: use
 *    `loadXlsxImport()` or `await import("@/components/cbe/xlsx-import")`.
 */
export * from "./types";
export * from "./a1";
export * from "./format";
export {
  cbeToFortune,
  fortuneToCbe,
  normalizeCbeSheet,
  cbeSheetSignature,
  hasUncomputedFormulas,
} from "./fortune-adapter";
export { SpreadsheetEditor, CBE_THOUSANDS_FORMAT, CBE_PERCENT_FORMAT } from "./SpreadsheetEditor";
export type { SpreadsheetEditorProps, SpreadsheetEditorHandle } from "./SpreadsheetEditor";
export { SheetView } from "./SheetView";
export type { SheetViewProps } from "./SheetView";
export { DocumentView } from "./DocumentView";
export type { DocumentViewProps } from "./DocumentView";
export type { DocumentEditorProps } from "./DocumentEditor";
export { CbeWorkspace, cbePartTabLabel, seedPartAnswer } from "./CbeWorkspace";
export type { CbeWorkspaceProps, CbeWorkspaceHandle } from "./CbeWorkspace";
export { CbeStringsProvider, DEFAULT_CBE_STRINGS, useCbeStrings } from "./cbe-strings";
export type { CbeStrings, CbeToolKey } from "./cbe-strings";
export { commitCbeEditors, registerCbeCommit } from "./commit-registry";

/** Lazily loads the SheetJS-backed importer (xlsxToCbeSheet, readXlsxFile, extractMarkingScheme). */
export const loadXlsxImport = () => import("./xlsx-import");

/** Lazily loads the TipTap document editor module. */
export const loadDocumentEditor = () => import("./DocumentEditor");
