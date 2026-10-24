/**
 * The small Markdown subset the assistant writes — paragraphs, line breaks,
 * **bold**, *italic*, bullet and numbered lists, [links](…) and bare https
 * URLs — parsed into a tiny tree that React renders as elements. Nothing is
 * ever injected as HTML, so model text cannot carry markup; link targets are
 * vetted again when rendered (links.ts).
 */

export type MdInline =
  | { t: "text"; v: string }
  | { t: "strong"; c: MdInline[] }
  | { t: "em"; c: MdInline[] }
  | { t: "link"; href: string; c: MdInline[] };

export type MdBlock =
  | { t: "p"; lines: MdInline[][] }
  | { t: "ul"; items: MdInline[][] }
  | { t: "ol"; items: MdInline[][]; start: number };

const INLINE =
  /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|\[([^\]\n]+)\]\(([^)\s]+)\)|(https:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"])|(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g;

export const parseInline = (text: string): MdInline[] => {
  const out: MdInline[] = [];
  let last = 0;
  const pushText = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev && prev.t === "text") prev.v += v;
    else out.push({ t: "text", v });
  };
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    pushText(text.slice(last, index));
    if (m[1] !== undefined || m[2] !== undefined) out.push({ t: "strong", c: parseInline(m[1] ?? m[2]) });
    else if (m[3] !== undefined) out.push({ t: "link", href: m[4], c: parseInline(m[3]) });
    else if (m[5] !== undefined) out.push({ t: "link", href: m[5], c: [{ t: "text", v: m[5] }] });
    else if (m[6] !== undefined) out.push({ t: "em", c: parseInline(m[6]) });
    last = index + m[0].length;
  }
  pushText(text.slice(last));
  return out;
};

const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export const parseMarkdownLite = (source: string): MdBlock[] => {
  const blocks: MdBlock[] = [];
  let para: MdInline[][] | null = null;
  let list: Extract<MdBlock, { t: "ul" | "ol" }> | null = null;

  const closePara = () => {
    if (para?.length) blocks.push({ t: "p", lines: para });
    para = null;
  };
  const closeList = () => {
    if (list?.items.length) blocks.push(list);
    list = null;
  };

  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closePara();
      closeList();
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    if (bullet || ordered) {
      closePara();
      const kind = bullet ? "ul" : "ol";
      if (!list || list.t !== kind) {
        closeList();
        list = kind === "ul" ? { t: "ul", items: [] } : { t: "ol", items: [], start: Number(ordered![1]) || 1 };
      }
      list.items.push(parseInline(bullet ? bullet[1] : ordered![2]));
      continue;
    }
    // An indented continuation of a list item.
    if (list && /^\s{2,}\S/.test(rawLine)) {
      const items: MdInline[][] = list.items;
      items[items.length - 1] = [...items[items.length - 1], { t: "text", v: " " }, ...parseInline(line.trim())];
      continue;
    }
    closeList();
    const heading = HEADING.exec(line);
    const inline = heading ? [{ t: "strong" as const, c: parseInline(heading[1]) }] : parseInline(line.trim());
    if (!para) para = [];
    para.push(inline);
  }
  closePara();
  closeList();
  return blocks;
};
