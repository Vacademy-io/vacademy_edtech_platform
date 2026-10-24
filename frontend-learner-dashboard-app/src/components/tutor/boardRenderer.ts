/**
 * Whiteboard ops → HTML (learner side). Mirrors the server materializer
 * (ai_service/app/services/tutor/board_ops.py): same class names, same
 * data-op-id attributes, so the stored board_html and the live-rendered
 * board never disagree. Text is escaped; SVG bodies arrive sanitized from the
 * server and pass through DOMPurify again before insertion.
 *
 * Two things only the live board does after insertion (`enhance`): formulas
 * are typeset with KaTeX, and media tasks get a real player — a YouTube
 * embed, a <video>, or the PDF in an iframe (file ids resolved to signed
 * public urls).
 */
import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";

export type BoardOp = Record<string, unknown> & { op: string; id?: string; target?: string };

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

const safeUrl = (u: unknown): string | null => {
  const s = String(u ?? "").trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
};

const ANIM = new Set(["write", "fade", "pop"]);

export function renderOp(op: BoardOp): string {
  const id = esc(op.id ?? "");
  const anim = ANIM.has(String(op.anim)) ? String(op.anim) : "write";
  const attrs = ` data-op-id="${id}" class="tb-op tb-anim-${anim}"`;
  switch (op.op) {
    case "heading": {
      const level = Math.max(1, Math.min(4, Number(op.level) || 2));
      return `<h${level}${attrs.replace('class="', 'class="tb-heading ')}>${esc(op.text)}</h${level}>`;
    }
    case "text":
      return `<p${attrs.replace('class="', 'class="tb-text ')}>${esc(op.text)}</p>`;
    case "bullet": {
      const items = ((op.items as unknown[]) || []).map((i) => `<li>${esc(i)}</li>`).join("");
      return `<ul${attrs.replace('class="', 'class="tb-bullets ')}>${items}</ul>`;
    }
    case "formula": {
      const cap = op.caption ? `<figcaption>${esc(op.caption)}</figcaption>` : "";
      return `<figure${attrs.replace('class="', 'class="tb-formula ')}><span class="tb-latex" data-latex="${esc(op.latex)}">${esc(op.latex)}</span>${cap}</figure>`;
    }
    case "svg": {
      const body = DOMPurify.sanitize(String(op.svg ?? ""), { USE_PROFILES: { svg: true, svgFilters: false }, FORBID_ATTR: ["style"] });
      if (!body.includes("<svg")) return "";
      return `<figure${attrs.replace('class="', 'class="tb-svg ')} aria-label="${esc(op.description)}">${body}<figcaption class="tb-visually-hidden">${esc(op.description)}</figcaption></figure>`;
    }
    case "image": {
      const url = safeUrl(op.url);
      if (!url) return "";
      const cap = op.caption ? `<figcaption>${esc(op.caption)}</figcaption>` : "";
      return `<figure${attrs.replace('class="', 'class="tb-image ')}><img src="${esc(url)}" alt="${esc(op.description)}" loading="lazy">${cap}</figure>`;
    }
    case "video": {
      const url = safeUrl(op.url);
      if (!url) return "";
      return `<figure${attrs.replace('class="', 'class="tb-video ')}><video src="${esc(url)}" controls playsinline ${op.muted === false ? "" : "muted"}></video><figcaption>${esc(op.description)}</figcaption></figure>`;
    }
    case "media_task": {
      const url = safeUrl(op.url) || "";
      return `<div${attrs.replace('class="', 'class="tb-media-task ')} data-kind="${esc(op.kind)}" data-src="${esc(url)}" data-file-id="${esc(op.file_id ?? "")}"><p>${esc(op.description)}</p><div class="tb-media-embed" hidden></div></div>`;
    }
    case "table": {
      const rows = (op.rows as unknown[][]) || [];
      if (!rows.length) return "";
      const head = (rows[0] || []).map((c) => `<th>${esc(c)}</th>`).join("");
      const body = rows.slice(1).map((r) => `<tr>${(r || []).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
      return `<table${attrs.replace('class="', 'class="tb-table ')}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case "callout":
      return `<aside${attrs.replace('class="', `class="tb-callout tb-callout-${esc(op.kind || "tip")} ${op.note ? "tb-note " : ""}`)}>${esc(op.text)}</aside>`;
    case "annotate":
      return `<span${attrs.replace('class="', `class="tb-annotation tb-annotation-${esc(op.position || "right")} `)} data-target="${esc(op.target)}">${esc(op.text)}</span>`;
    case "arrow":
      return `<span${attrs.replace('class="', 'class="tb-arrow ')} data-from="${esc(op.from)}" data-to="${esc(op.to)}">${esc(op.text ?? "")}</span>`;
    case "columns": {
      const cols = (op.columns as unknown[][]) || [];
      const inner = cols
        .map((col) => `<div class="tb-col">${(col || []).map((c) => renderOp(c as BoardOp)).join("")}</div>`)
        .join("");
      return `<div${attrs.replace('class="', `class="tb-columns tb-columns-${cols.length} `)}>${inner}</div>`;
    }
    default:
      return "";
  }
}

/**
 * Draw every arrow op as a real line between its two targets, in an overlay
 * that scrolls with the board. Cheap enough to redo after every insert.
 */
export function drawArrows(root: HTMLElement): void {
  let layer = root.querySelector<SVGSVGElement>(":scope > svg.tb-arrow-layer");
  const arrows = Array.from(root.querySelectorAll<HTMLElement>(".tb-arrow[data-from][data-to]"));
  if (!arrows.length) {
    layer?.remove();
    return;
  }
  if (!layer) {
    layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.classList.add("tb-arrow-layer");
    layer.innerHTML = `<defs><marker id="tb-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"></path></marker></defs>`;
    root.insertBefore(layer, root.firstChild);
  }
  const rootRect = root.getBoundingClientRect();
  const height = root.scrollHeight;
  layer.setAttribute("width", String(root.clientWidth));
  layer.setAttribute("height", String(height));
  layer.style.height = `${height}px`;
  layer.querySelectorAll("line").forEach((l) => l.remove());
  for (const a of arrows) {
    const from = root.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(a.dataset.from || "")}"]`);
    const to = root.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(a.dataset.to || "")}"]`);
    if (!from || !to || from === to) continue;
    const fr = from.getBoundingClientRect();
    const tr = to.getBoundingClientRect();
    const x1 = fr.left - rootRect.left + fr.width / 2;
    const y1 = fr.bottom - rootRect.top + root.scrollTop;
    const x2 = tr.left - rootRect.left + tr.width / 2;
    const y2 = tr.top - rootRect.top + root.scrollTop;
    if (Math.abs(y2 - y1) < 6 && Math.abs(x2 - x1) < 6) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2 > y1 ? y2 - 2 : y2));
    line.setAttribute("marker-end", "url(#tb-arrowhead)");
    layer.appendChild(line);
  }
}

/** Dock an annotation where the plan asked for it: above, below, left or right of its target. */
export function placeAnnotation(el: HTMLElement, target: HTMLElement | null, position: string): void {
  if (!target) return;
  const wrapped = target.parentElement?.classList.contains("tb-row") ? target.parentElement : null;
  if (position === "above") {
    (wrapped ?? target).insertAdjacentElement("beforebegin", el);
    return;
  }
  // Moving a mounted player reloads it: keep media targets where they are.
  if ((position === "left" || position === "right") && !target.querySelector("iframe, video")) {
    let row = target.parentElement;
    if (!row || !row.classList.contains("tb-row")) {
      row = document.createElement("div");
      row.className = "tb-row";
      target.insertAdjacentElement("beforebegin", row);
      row.appendChild(target);
    }
    if (position === "left") row.insertBefore(el, row.firstChild);
    else row.appendChild(el);
    return;
  }
  target.insertAdjacentElement("afterend", el);
}

/** Show the diagram parts whose step is at or before `sentence` (narration-synced reveal). */
export function revealStepsUpTo(root: ParentNode, sentence: number): void {
  root.querySelectorAll<SVGElement>(".tb-step:not(.tb-step-on)").forEach((el) => {
    if (Number(el.dataset.step) <= sentence) el.classList.add("tb-step-on");
  });
}

/** Ops that change the board's DOM (as opposed to highlight/clear). */
export const isElementOp = (op: BoardOp): boolean =>
  !["highlight", "unhighlight", "reveal", "clear"].includes(op.op);

// ── post-insertion enhancement ───────────────────────────────────────────────

const YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/i;

const DRAWABLE = "path, line, polyline, polygon, circle, ellipse, rect";
const STEP_MS = 1100;

/**
 * Make an inserted diagram draw itself: every stroke animates on (pathLength
 * normalises the dash to 0-1 whatever the shape's real length) with a small
 * stagger, and parts the compiler marked with a `step` stay hidden until
 * their turn, appearing one by one while the teacher speaks.
 */
export function animateDiagram(figure: HTMLElement, parts: Array<{ id?: unknown; step?: unknown }>, synced = false): void {
  const svg = figure.querySelector("svg");
  if (!svg) return;
  const stepped = new Map<string, number>();
  for (const p of parts) {
    const id = String(p.id ?? "");
    const step = Number(p.step) || 0;
    if (id && step > 0) stepped.set(id, step);
  }
  let maxStep = 0;
  stepped.forEach((step, id) => {
    const el = svg.querySelector<SVGElement>(`#${CSS.escape(id)}`);
    if (!el) return;
    el.classList.add("tb-step");
    el.dataset.step = String(step);
    maxStep = Math.max(maxStep, step);
  });
  let i = 0;
  svg.querySelectorAll<SVGElement>(DRAWABLE).forEach((shape) => {
    if (shape.closest(".tb-step")) return; // stepped parts pop in whole, later
    shape.setAttribute("pathLength", "1");
    shape.classList.add("tb-draw");
    shape.style.animationDelay = `${Math.min(i, 24) * 70}ms`;
    i += 1;
  });
  // Synced boards reveal steps as the narration reaches them (revealStepsUpTo);
  // text-mode boards fall back to a fixed cadence.
  if (synced) return;
  for (let step = 1; step <= maxStep; step++) {
    window.setTimeout(() => {
      svg.querySelectorAll<SVGElement>(`.tb-step[data-step="${step}"]`).forEach((el) => el.classList.add("tb-step-on"));
    }, step * STEP_MS);
  }
}

/** Show every stepped part at once (the narration is over or was interrupted). */
export function revealAllSteps(root: ParentNode): void {
  root.querySelectorAll<SVGElement>(".tb-step:not(.tb-step-on)").forEach((el) => el.classList.add("tb-step-on"));
}

/** Typeset every formula inside `root` that has not been typeset yet. */
export function typesetFormulas(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".tb-latex:not([data-typeset])").forEach((el) => {
    const latex = el.dataset.latex || el.textContent || "";
    el.dataset.typeset = "1";
    try {
      katex.render(latex, el, { throwOnError: false, displayMode: true, output: "html" });
    } catch {
      /* leave the raw source visible */
    }
  });
}

/**
 * Put a real player into a media-task box. `resolveFileId` turns a media
 * file id into a signed https url (the learner's normal getPublicUrl).
 */
export async function mountMediaTask(el: HTMLElement, resolveFileId: (fileId: string) => Promise<string>): Promise<void> {
  const slot = el.querySelector<HTMLElement>(".tb-media-embed");
  if (!slot || slot.dataset.mounted) return;
  slot.dataset.mounted = "1";
  const kind = el.dataset.kind || "video";
  let src = el.dataset.src || "";
  const fileId = el.dataset.fileId || "";
  if (!src && fileId) {
    try {
      src = await resolveFileId(fileId);
    } catch {
      src = "";
    }
  }
  if (!safeUrl(src)) return;
  slot.hidden = false;
  const yt = src.match(YOUTUBE);
  const vm = src.match(VIMEO);
  if (yt) {
    const f = document.createElement("iframe");
    f.src = `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0`;
    f.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    f.allowFullscreen = true;
    f.title = "Video";
    slot.appendChild(f);
  } else if (vm) {
    const f = document.createElement("iframe");
    f.src = `https://player.vimeo.com/video/${vm[1]}`;
    f.allow = "autoplay; fullscreen; picture-in-picture";
    f.allowFullscreen = true;
    f.title = "Video";
    slot.appendChild(f);
  } else if (kind === "pdf" || /\.pdf(\?|#|$)/i.test(src)) {
    const f = document.createElement("iframe");
    f.className = "tb-pdf";
    f.src = src;
    f.title = "Document";
    slot.appendChild(f);
    const a = document.createElement("a");
    a.className = "tb-media-link";
    a.href = src;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Open the document in a new tab";
    el.appendChild(a);
  } else {
    const v = document.createElement("video");
    v.src = src;
    v.controls = true;
    v.playsInline = true;
    v.preload = "metadata";
    slot.appendChild(v);
  }
}
