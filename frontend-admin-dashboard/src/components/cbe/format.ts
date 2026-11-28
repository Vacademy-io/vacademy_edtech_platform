/**
 * Small, dependency-free Excel number-format renderer for CbeSheet values.
 * Covers what accounting answers use: "#,##0", "#,##0.00", "0%", "0.0%",
 * "#,##0;(#,##0);-" style sections, escaped literals, [$£-809] currency tags,
 * thousands scaling ("#,##0,"). Anything it does not understand (dates,
 * scientific) falls back to General. Identical in both apps.
 */
import type { CbeCell, CbeCellValue } from "./types";

/** Excel "General": integers as-is, others to 10 significant digits, no grouping. */
export function formatGeneral(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(10)));
}

type Token = { kind: "lit"; text: string } | { kind: "ph"; ch: string };

type ParsedSection = {
  prefix: string;
  suffix: string;
  pattern: string;
  percent: boolean;
  general: boolean;
  unsupported: boolean;
};

/** Splits a format into its ';' sections, ignoring ';' inside quotes or escaped. */
function splitSections(fmt: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < fmt.length; i += 1) {
    const ch = fmt[i] ?? "";
    if (ch === "\\" && !inQuote) {
      cur += ch + (fmt[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === '"') inQuote = !inQuote;
    if (ch === ";" && !inQuote) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSection(section: string): ParsedSection {
  const tokens: Token[] = [];
  let percent = false;
  let unsupported = false;
  const general = /general/i.test(section.replace(/"[^"]*"/g, ""));
  const src = general ? section.replace(/general/i, "\u0000") : section;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] ?? "";
    if (ch === "\u0000") {
      tokens.push({ kind: "ph", ch: "G" });
    } else if (ch === "\\") {
      tokens.push({ kind: "lit", text: src[i + 1] ?? "" });
      i += 1;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      const stop = end < 0 ? src.length : end;
      tokens.push({ kind: "lit", text: src.slice(i + 1, stop) });
      i = stop;
    } else if (ch === "_" || ch === "*") {
      i += 1; // alignment padding / fill: no visible text in a plain render
    } else if (ch === "[") {
      const end = src.indexOf("]", i + 1);
      const stop = end < 0 ? src.length : end;
      const inner = src.slice(i + 1, stop);
      if (inner.startsWith("$")) tokens.push({ kind: "lit", text: inner.slice(1).split("-")[0] ?? "" });
      i = stop;
    } else if ("0#?.,".includes(ch)) {
      tokens.push({ kind: "ph", ch });
    } else if (ch === "%") {
      percent = true;
      tokens.push({ kind: "lit", text: "%" });
    } else if ((ch === "E" || ch === "e") && (src[i + 1] === "+" || src[i + 1] === "-")) {
      unsupported = true;
    } else if (/[dmyhs]/i.test(ch)) {
      unsupported = true; // date/time
    } else if (ch === "@") {
      // text placeholder — numbers never use it
    } else {
      tokens.push({ kind: "lit", text: ch });
    }
  }
  const first = tokens.findIndex((t) => t.kind === "ph");
  let last = -1;
  tokens.forEach((t, idx) => {
    if (t.kind === "ph") last = idx;
  });
  const litText = (ts: Token[]) => ts.map((t) => (t.kind === "lit" ? t.text : "")).join("");
  if (first < 0) {
    return { prefix: litText(tokens), suffix: "", pattern: "", percent, general: false, unsupported };
  }
  return {
    prefix: litText(tokens.slice(0, first)),
    suffix: litText(tokens.slice(last + 1)),
    pattern: tokens
      .slice(first, last + 1)
      .map((t) => (t.kind === "ph" ? t.ch : ""))
      .join(""),
    percent,
    general,
    unsupported,
  };
}

function renderNumber(abs: number, sec: ParsedSection): string {
  if (sec.general || sec.pattern.includes("G")) return formatGeneral(abs);
  let pattern = sec.pattern;
  let scaled = sec.percent ? abs * 100 : abs;
  while (pattern.endsWith(",")) {
    scaled /= 1000;
    pattern = pattern.slice(0, -1);
  }
  const dot = pattern.indexOf(".");
  const intPat = dot >= 0 ? pattern.slice(0, dot) : pattern;
  const decPat = dot >= 0 ? pattern.slice(dot + 1).replace(/[^0#?]/g, "") : "";
  const thousands = intPat.includes(",");
  const minInt = (intPat.match(/0/g) ?? []).length;
  const decMax = decPat.length;
  const decMin = (decPat.match(/0/g) ?? []).length;
  let fixed = scaled.toFixed(decMax);
  let [intStr = "0", decStr = ""] = fixed.split(".");
  while (decStr.length > decMin && decStr.endsWith("0")) decStr = decStr.slice(0, -1);
  if (intStr === "0" && minInt === 0) intStr = "";
  while (intStr.length < minInt) intStr = `0${intStr}`;
  if (thousands) intStr = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  fixed = decStr ? `${intStr}.${decStr}` : intStr;
  return fixed;
}

/** Formats a number with an Excel-style format string. */
export function formatNumber(n: number, nf?: string | null): string {
  if (!Number.isFinite(n)) return String(n);
  if (!nf || /^general$/i.test(nf.trim())) return formatGeneral(n);
  const sections = splitSections(nf);
  let idx = 0;
  if (n < 0 && sections.length >= 2) idx = 1;
  else if (n === 0 && sections.length >= 3) idx = 2;
  const sec = parseSection(sections[idx] ?? "");
  if (sec.unsupported) return formatGeneral(n);
  if (!sec.pattern && !sec.general) return sec.prefix; // e.g. "-" zero section
  const body = renderNumber(Math.abs(n), sec);
  const needsSign = n < 0 && idx === 0 && Number(body.replace(/,/g, "")) !== 0;
  return `${needsSign ? "-" : ""}${sec.prefix}${body}${sec.suffix}`;
}

/** Display text of a value under an optional number format. */
export function formatCbeValue(v: CbeCellValue | undefined, nf?: string | null): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return formatNumber(v, nf);
  return v;
}

/** Display text of a cell (value formatted with its own number format). */
export const formatCbeCell = (cell: CbeCell | undefined | null): string =>
  cell ? formatCbeValue(cell.v, cell.s?.nf) : "";

/** Changes the number of decimals in a format by `delta` ("#,##0" +1 -> "#,##0.0"). */
export function adjustDecimals(nf: string | null | undefined, delta: 1 | -1): string {
  const base = !nf || /^general$/i.test(nf.trim()) ? "0" : nf;
  return splitSections(base)
    .map((section) => {
      // Operate on the last run of digit placeholders in the section.
      const m = /([0#?,]*0)(\.([0#?]*))?(?![\s\S]*[0#?])/.exec(section);
      if (!m || m.index === undefined) return section;
      const intPart = m[1] ?? "0";
      const decs = m[3] ?? "";
      let nextDecs = decs;
      if (delta > 0) nextDecs = `${decs}0`;
      else nextDecs = decs.slice(0, -1);
      const replacement = nextDecs ? `${intPart}.${nextDecs}` : intPart;
      return section.slice(0, m.index) + replacement + section.slice(m.index + m[0].length);
    })
    .join(";");
}
