/**
 * The only module that imports Fortune-sheet at runtime. Always reach it via
 * React.lazy (SpreadsheetEditor does) so the grid and its CSS stay out of the
 * main bundle.
 */
import "@fortune-sheet/react/dist/index.css";
import { Workbook } from "@fortune-sheet/react";

export default Workbook;
