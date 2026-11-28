/**
 * CBE_RESPONSE ("Spreadsheet & Written Response") shared types and helpers.
 *
 * Contract: docs/CBE_RESPONSE_QUESTION.md (§2 CbeSheet, §3 config, §4 answer).
 * This file is identical in frontend-admin-dashboard and
 * frontend-learner-dashboard-app — change both together.
 *
 * Nothing here knows about Fortune-sheet; the grid library is converted to and
 * from `CbeSheet` at the edge (fortune-adapter.ts).
 */

// ---------------------------------------------------------------------------
// §2 CbeSheet — spreadsheet interchange format
// ---------------------------------------------------------------------------

export type CbeCellValue = number | string | boolean | null;

export type CbeCellStyle = {
  /** bold */
  b?: 1;
  /** italic */
  i?: 1;
  /** underline */
  u?: 1;
  /** horizontal align */
  al?: "l" | "c" | "r";
  /** number format: "#,##0", "#,##0.00", "0%", "0.0%", "General", … */
  nf?: string;
  /** background colour, "#rrggbb" (user content, not a design token) */
  bg?: string;
  /** font colour, "#rrggbb" (user content, not a design token) */
  fc?: string;
  /** top border */
  bt?: 1;
  /** bottom border */
  bb?: 1;
};

export type CbeCell = {
  /** computed / literal value — always the value the learner saw */
  v?: CbeCellValue;
  /** formula INCLUDING the leading "=", e.g. "=SUM(B7:B10)" */
  f?: string;
  s?: CbeCellStyle;
};

export type CbeSheetTab = {
  name: string;
  /** key = A1 ref within this tab ("B7"); sparse, empty cells omitted */
  cells: Record<string, CbeCell>;
  /** "A" -> px */
  colWidths?: Record<string, number>;
  /** ["A1:C1"] */
  merges?: string[];
  /** visible rows (default 40) */
  rowCount?: number;
  /** visible cols (default 12) */
  colCount?: number;
};

export type CbeSheet = {
  /** >= 1 */
  sheets: CbeSheetTab[];
};

export const CBE_DEFAULT_ROW_COUNT = 40;
export const CBE_DEFAULT_COL_COUNT = 12;

export const emptyCbeSheet = (name = "Sheet1"): CbeSheet => ({
  sheets: [{ name, cells: {}, rowCount: CBE_DEFAULT_ROW_COUNT, colCount: CBE_DEFAULT_COL_COUNT }],
});

// ---------------------------------------------------------------------------
// §3 Question config (auto_evaluation_json)
// ---------------------------------------------------------------------------

export const CBE_QUESTION_TYPE = "CBE_RESPONSE" as const;
export const CBE_RESPONSE_TYPE = "CBE" as const;

export type CbePartKind = "SPREADSHEET" | "DOCUMENT";

export type CbeSheetContent = { sheet: CbeSheet };
export type CbeHtmlContent = { html: string };
export type CbePartContent = CbeSheetContent | CbeHtmlContent;

export type CbeMarkingLine = {
  id: string;
  label: string;
  marks: number;
  /** formatted expected figure, e.g. "3,200" */
  expected?: string;
  /** "Tab!B7" */
  cellRef?: string;
  guidance?: string;
};

export type CbePart = {
  /** stable, generated once (newPartId), never reused */
  id: string;
  label: string;
  promptHtml?: string;
  kind: CbePartKind;
  marks: number;
  /** learner's starting content (learner-safe) */
  template?: CbePartContent | null;
  // ---- SECRET (never sent to a learner before release) ----
  solution?: CbePartContent | null;
  markingScheme?: CbeMarkingLine[];
  solutionFileId?: string | null;
};

export type CbeConfigData = {
  version: 1;
  parts: CbePart[];
  // ---- SECRET ----
  gradingNotes?: string;
};

export type CbeConfig = {
  type: typeof CBE_QUESTION_TYPE;
  data: CbeConfigData;
};

/** Keys removed by redactCbeConfig — exactly these and nothing else (§3). */
export const CBE_SECRET_KEYS = {
  part: ["solution", "markingScheme", "solutionFileId"] as const,
  data: ["gradingNotes"] as const,
};

export type CbeSecretPartKey = (typeof CBE_SECRET_KEYS.part)[number];

/** Learner-safe part: what a learner may receive before release. */
export type CbeLearnerPart = Omit<CbePart, CbeSecretPartKey>;

/**
 * Secret half of a slide config (`question_slide.evaluation_secret_json`):
 * `{ parts: [{id, solution, markingScheme, solutionFileId}], gradingNotes }`.
 */
export type CbeSecret = {
  parts: Array<Pick<CbePart, "id" | CbeSecretPartKey>>;
  gradingNotes?: string;
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Parses `auto_evaluation_json` (string or already-parsed object). Returns null
 * for anything that is not a CBE_RESPONSE config with a parts array.
 */
export function parseCbeConfig(raw: unknown): CbeConfig | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(obj) || obj.type !== CBE_QUESTION_TYPE) return null;
  const data = obj.data;
  if (!isRecord(data) || !Array.isArray(data.parts)) return null;
  return obj as unknown as CbeConfig;
}

/** Removes `parts[].solution|markingScheme|solutionFileId` and `data.gradingNotes`; keeps everything else. */
export function redactCbeConfig(config: CbeConfig): CbeConfig {
  const data: Record<string, unknown> = { ...config.data };
  for (const k of CBE_SECRET_KEYS.data) delete data[k];
  data.parts = (config.data.parts ?? []).map((p) => {
    const part: Record<string, unknown> = { ...p };
    for (const k of CBE_SECRET_KEYS.part) delete part[k];
    return part;
  });
  return { ...config, data: data as unknown as CbeConfigData };
}

/** Splits a full config into the learner-safe config and its secret half (question slides). */
export function splitCbeSecret(config: CbeConfig): { config: CbeConfig; secret: CbeSecret } {
  const secret: CbeSecret = {
    parts: (config.data.parts ?? []).map((p) => {
      const sp: CbeSecret["parts"][number] = { id: p.id };
      for (const k of CBE_SECRET_KEYS.part) {
        if (k in p) (sp as Record<string, unknown>)[k] = p[k];
      }
      return sp;
    }),
  };
  if ("gradingNotes" in config.data) secret.gradingNotes = config.data.gradingNotes;
  return { config: redactCbeConfig(config), secret };
}

/**
 * Re-attaches a secret to a (redacted) config by part id. Secret parts whose id
 * is not in the config are dropped; config parts with no secret stay as they are.
 */
export function mergeCbeSecret(config: CbeConfig, secret: CbeSecret | null | undefined): CbeConfig {
  if (!secret) return config;
  const byId = new Map((secret.parts ?? []).map((p) => [p.id, p]));
  const parts = (config.data.parts ?? []).map((p) => {
    const sp = byId.get(p.id);
    if (!sp) return p;
    const merged: Record<string, unknown> = { ...p };
    for (const k of CBE_SECRET_KEYS.part) {
      if (k in sp) merged[k] = sp[k];
    }
    return merged as unknown as CbePart;
  });
  const data: CbeConfigData = { ...config.data, parts };
  if (secret.gradingNotes !== undefined) data.gradingNotes = secret.gradingNotes;
  return { ...config, data };
}

/** Question total = sum(parts[].marks). */
export const cbeTotalMarks = (config: CbeConfig | null | undefined): number =>
  (config?.data.parts ?? []).reduce((sum, p) => sum + (Number.isFinite(p.marks) ? p.marks : 0), 0);

// ---------------------------------------------------------------------------
// §4 Learner answer (responseData)
// ---------------------------------------------------------------------------

export type CbePartAnswer =
  | { kind: "SPREADSHEET"; sheet: CbeSheet }
  | { kind: "DOCUMENT"; html: string };

export type CbeAnswer = {
  /** keyed by part id */
  parts: Record<string, CbePartAnswer>;
};

export type CbeResponseData = {
  type: typeof CBE_QUESTION_TYPE;
  answer: CbeAnswer;
};

export const emptyCbeAnswer = (): CbeAnswer => ({ parts: {} });

/** Serialized size cap per question answer (all parts), enforced client-side. */
export const CBE_MAX_ANSWER_BYTES = 300_000;

/** UTF-8 byte size of the serialized answer. */
export function cbeAnswerSize(answer: CbeAnswer | null | undefined): number {
  if (!answer) return 0;
  const json = JSON.stringify(answer);
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(json).length;
  // Fallback: count UTF-8 bytes by hand.
  let bytes = 0;
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export const isCbeAnswerTooLarge = (answer: CbeAnswer | null | undefined): boolean =>
  cbeAnswerSize(answer) > CBE_MAX_ANSWER_BYTES;

const isBlankValue = (v: CbeCellValue | undefined): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

const cellHasContent = (cell: CbeCell | undefined): boolean =>
  !!cell && (!isBlankValue(cell.v) || (typeof cell.f === "string" && cell.f.trim() !== ""));

/** Visible text of an HTML fragment (tags stripped, entities for spaces decoded). No DOM needed. */
export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:nbsp|#x0*a0|#0*160);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const sameCellContent = (a: CbeCell | undefined, b: CbeCell | undefined): boolean => {
  if (!a || !b) return false;
  const fa = a.f?.trim() ?? "";
  const fb = b.f?.trim() ?? "";
  if (fa || fb) return fa.toUpperCase() === fb.toUpperCase();
  return String(a.v ?? "").trim() === String(b.v ?? "").trim();
};

/** True when the sheet has at least one non-empty cell that is not identical to the template's. */
function sheetHasOwnContent(sheet: CbeSheet | undefined, template: CbeSheet | undefined): boolean {
  for (const tab of sheet?.sheets ?? []) {
    const tplTab = template?.sheets.find((t) => t.name === tab.name);
    for (const [ref, cell] of Object.entries(tab.cells ?? {})) {
      if (!cellHasContent(cell)) continue;
      if (tplTab && sameCellContent(cell, tplTab.cells?.[ref])) continue;
      return true;
    }
  }
  return false;
}

/** True when one part's answer adds nothing beyond its template. */
export function isCbePartAnswerEmpty(
  answer: CbePartAnswer | null | undefined,
  template?: CbePartContent | null,
): boolean {
  if (!answer) return true;
  if (answer.kind === "SPREADSHEET") {
    const tplSheet = template && "sheet" in template ? template.sheet : undefined;
    return !sheetHasOwnContent(answer.sheet, tplSheet);
  }
  const text = htmlToPlainText(answer.html);
  if (!text) return true;
  const tplText = template && "html" in template ? htmlToPlainText(template.html) : "";
  return tplText !== "" && text === tplText;
}

/**
 * "Answered" (§4) = at least one part has a non-empty cell beyond the template,
 * or non-blank text. Pass the config so template content does not count.
 */
export function isCbeAnswerEmpty(
  answer: CbeAnswer | null | undefined,
  config?: CbeConfig | null,
): boolean {
  if (!answer?.parts) return true;
  const templates = new Map((config?.data.parts ?? []).map((p) => [p.id, p.template ?? null]));
  return Object.entries(answer.parts).every(([id, part]) =>
    isCbePartAnswerEmpty(part, templates.get(id) ?? null),
  );
}

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const randomChars = (n: number): string => {
  const out: string[] = [];
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint8Array(n);
    cryptoObj.getRandomValues(buf);
    buf.forEach((b) => out.push(ID_ALPHABET[b % ID_ALPHABET.length] ?? "a"));
  } else {
    for (let i = 0; i < n; i += 1) {
      out.push(ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)] ?? "a");
    }
  }
  return out.join("");
};

/** New stable part id ("p_8f3k2a"), never colliding with `existing`. */
export function newPartId(existing?: Iterable<string>): string {
  const taken = new Set(existing ?? []);
  for (;;) {
    const id = `p_${randomChars(6)}`;
    if (!taken.has(id)) return id;
  }
}

/** New marking-line id ("m_x81k2c"). */
export const newMarkingLineId = (existing?: Iterable<string>): string => {
  const taken = new Set(existing ?? []);
  for (;;) {
    const id = `m_${randomChars(6)}`;
    if (!taken.has(id)) return id;
  }
};
