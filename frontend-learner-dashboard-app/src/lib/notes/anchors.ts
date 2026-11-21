import type { NoteAnchor, NoteRect } from "./types";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function parseAnchor(json?: string | null): NoteAnchor {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as NoteAnchor;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Keeps stored anchors small: long selections are many tiny rectangles. */
export const MAX_ANCHOR_RECTS = 120;

/**
 * Joins the per-word rectangles a text selection produces into one box per
 * line, so a highlight reads as one band instead of darker overlapping strips.
 */
export function mergeLineRects(rects: NoteRect[]): NoteRect[] {
  const ordered = [...rects]
    .filter((r) => r.w > 0.05 && r.h > 0.05)
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const out: NoteRect[] = [];
  for (const rect of ordered) {
    const line = out.find((candidate) => {
      if (candidate.page !== rect.page) return false;
      const overlap =
        Math.min(candidate.y + candidate.h, rect.y + rect.h) - Math.max(candidate.y, rect.y);
      const sameLine = overlap > Math.min(candidate.h, rect.h) * 0.5;
      const gap = rect.x - (candidate.x + candidate.w);
      return sameLine && gap < 2.5;
    });
    if (!line) {
      out.push({ ...rect });
      continue;
    }
    const right = Math.max(line.x + line.w, rect.x + rect.w);
    const bottom = Math.max(line.y + line.h, rect.y + rect.h);
    line.x = Math.min(line.x, rect.x);
    line.y = Math.min(line.y, rect.y);
    line.w = round(right - line.x);
    line.h = round(bottom - line.y);
  }
  return out.slice(0, MAX_ANCHOR_RECTS);
}

/** A client rectangle as percent of its page box, clamped to the page. */
export function toPageRect(client: Box, pageBox: Box, page: number): NoteRect | null {
  if (pageBox.width <= 0 || pageBox.height <= 0) return null;
  const left = Math.max(client.left, pageBox.left);
  const right = Math.min(client.right, pageBox.right);
  const top = Math.max(client.top, pageBox.top);
  const bottom = Math.min(client.bottom, pageBox.bottom);
  if (right <= left || bottom <= top) return null;
  return {
    page,
    x: round(((left - pageBox.left) / pageBox.width) * 100),
    y: round(((top - pageBox.top) / pageBox.height) * 100),
    w: round(((right - left) / pageBox.width) * 100),
    h: round(((bottom - top) / pageBox.height) * 100),
  };
}

/** The box dragged out between two points on a page, in page percent. */
export function dragRect(
  page: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
): NoteRect {
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  const x1 = clamp(Math.min(a.x, b.x));
  const x2 = clamp(Math.max(a.x, b.x));
  const y1 = clamp(Math.min(a.y, b.y));
  const y2 = clamp(Math.max(a.y, b.y));
  return { page, x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1) };
}

/** The boxes a PDF text selection covers, read from the viewer's page layers. */
export function pdfRectsFromRange(range: Range): NoteRect[] {
  const pages = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="core__page-layer-"]'),
  ).map((el) => ({
    index: Number((el.dataset.testid ?? "").replace("core__page-layer-", "")),
    box: el.getBoundingClientRect(),
  }));
  const rects: NoteRect[] = [];
  for (const client of Array.from(range.getClientRects())) {
    const cx = (client.left + client.right) / 2;
    const cy = (client.top + client.bottom) / 2;
    const page = pages.find(
      (p) => cx >= p.box.left && cx <= p.box.right && cy >= p.box.top && cy <= p.box.bottom,
    );
    if (!page || Number.isNaN(page.index)) continue;
    const rect = toPageRect(client, page.box, page.index);
    if (rect) rects.push(rect);
  }
  return mergeLineRects(rects);
}

export interface TextHit {
  startNode: number;
  startOffset: number;
  endNode: number;
  endOffset: number;
}

/**
 * Finds `quote` across a run of text nodes, ignoring whitespace altogether: a
 * saved quote has it collapsed, the page has line breaks and indents, and two
 * paragraphs in a row may have none between them. Returns where it starts and
 * ends, by node and offset.
 */
export function findQuote(nodes: string[], quote: string): TextHit | null {
  const wanted = quote.replace(/\s+/g, "");
  if (!wanted) return null;
  let flat = "";
  const origin: Array<{ node: number; offset: number }> = [];
  nodes.forEach((text, node) => {
    for (let offset = 0; offset < text.length; offset += 1) {
      const ch = text[offset] as string;
      if (/\s/.test(ch)) continue;
      flat += ch;
      origin.push({ node, offset });
    }
  });
  const at = flat.indexOf(wanted);
  if (at < 0) return null;
  const start = origin[at];
  const end = origin[at + wanted.length - 1];
  if (!start || !end) return null;
  return {
    startNode: start.node,
    startOffset: start.offset,
    endNode: end.node,
    endOffset: end.offset + 1,
  };
}
