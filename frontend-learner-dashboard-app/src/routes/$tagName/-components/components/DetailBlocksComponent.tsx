import React from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "@phosphor-icons/react";
import { CatalogueLink } from "../CatalogueLink";

/**
 * Detail Blocks — the editorial "spec sheet" section.
 *
 * One self-contained block per thing being documented (a programme, service,
 * plan, syllabus unit): an eyebrow tag, a title, a description, a gapless
 * hairline table of detail items, a strip of label/value specs, and an optional
 * note. Deep-linkable, so a nav or footer can jump straight to one block.
 *
 * WHY THIS EXISTS: featureGrid renders floating gapped cards, which is a
 * marketing pattern. A reference/directory page wants the opposite — dense,
 * bordered, scannable rows where every offering keeps its real name. Asked for
 * "details of programs", the composer previously approximated with
 * sectionHeading + featureGrid and collapsed 25 offerings into 3 generic
 * buckets, because nothing in the vocabulary could express this shape.
 *
 * WHY THE HEADER AND BODY LOOK WELDED: the header carries a top-only radius and
 * no bottom border, and the body a bottom-only radius, so together they read as
 * ONE card rather than two stacked ones.
 *
 * DELIBERATELY HAS NO price / image / enrol PROPS. That is load-bearing: this
 * component cannot render a commerce surface, so it is safe to hand the model
 * for informational pages, and having no image field means it can never carry a
 * hallucinated image URL past the server's image allowlist.
 */

interface SpecPair {
  label: string;
  value: string;
}

interface BlockItem {
  title: string;
  description?: string;
}

interface DetailBlock {
  title: string;
  /** Deep-link target. Defaults to a slug of the title. */
  anchor?: string;
  /** Small uppercase eyebrow above the title, e.g. "Flagship Program". */
  tag?: string;
  description?: string;
  /** 'solid' brand-fills the header — use for exactly ONE flagship block. */
  headerVariant?: "subtle" | "tint" | "solid";
  headerColor?: string;
  items?: BlockItem[];
  specs?: SpecPair[];
  note?: string;
  noteTone?: "warn" | "info" | "plain";
  /** Informational navigation only — never an enrol/buy action. */
  link?: { text: string; url: string };
}

export interface DetailBlocksProps {
  blocks?: DetailBlock[];
  headerText?: string;
  subheading?: string;
  /** Desktop columns for the items table. */
  columns?: number;
  /** Desktop columns for the spec strip. */
  specColumns?: number;
  /** Namespaces derived anchor ids when a page has two of these sections. */
  anchorPrefix?: string;
  backgroundColor?: string;
  /** Admin canvas / learner preview passes this so the section shows guidance. */
  isPreviewMode?: boolean;
  /** The untranslated props (JsonRenderer): anchor ids come from the authored
   *  anchor or title, so a deep link (#new-program) works in every language. */
  baseProps?: { blocks?: DetailBlock[] };
}

const slugify = (s: string): string =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

/** 3 -> 2 -> 1 and 4 -> 2 -> 1, using only the standard breakpoints. */
const itemGridCols = (cols: number): string => {
  if (cols <= 1) return "grid-cols-1";
  if (cols === 2) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
};

const specGridCols = (cols: number): string => {
  if (cols <= 1) return "grid-cols-1";
  if (cols === 2) return "grid-cols-1 sm:grid-cols-2";
  if (cols === 3) return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";
};

const NOTE_TONE: Record<string, string> = {
  warn: "bg-warning-50 text-catalogue-text-secondary",
  info: "bg-primary-50 text-catalogue-text-secondary",
  plain: "bg-catalogue-bg-muted text-catalogue-text-secondary",
};

export const DetailBlocksComponent: React.FC<DetailBlocksProps> = ({
  blocks,
  headerText,
  subheading,
  columns = 3,
  specColumns = 4,
  anchorPrefix = "",
  backgroundColor,
  isPreviewMode = false,
  baseProps,
}) => {
  const { t } = useTranslation("coursePlayerB");
  // Each shown block with the authored block it was translated from (paired
  // by position: a translation keeps the list's order and length).
  const baseBlocks = baseProps?.blocks;
  const authored =
    Array.isArray(blocks) && Array.isArray(baseBlocks) && baseBlocks.length === blocks.length ? baseBlocks : null;
  const list = Array.isArray(blocks)
    ? blocks.map((b, i) => ({ b, base: authored?.[i] || b })).filter(({ b }) => b && b.title)
    : [];

  const section = (children: React.ReactNode) => (
    <section
      className="catalogue-section bg-catalogue-bg"
      style={backgroundColor ? { backgroundColor } : undefined}
    >
      <div className="catalogue-shell">
        {(headerText || subheading) && (
          <div className="catalogue-section-header text-center">
            {headerText && <h2 className="catalogue-h2 text-catalogue-text-primary">{headerText}</h2>}
            {subheading && (
              <p className="catalogue-lead catalogue-measure text-catalogue-text-muted">{subheading}</p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );

  if (list.length === 0) {
    if (!isPreviewMode) return null;
    return section(
      <div className="catalogue-card rounded-catalogue-lg border border-dashed border-catalogue-border p-8 text-center text-sm text-catalogue-text-muted">
        {t("detailBlocks.emptyGuidance")}
      </div>
    );
  }

  // A section heading owns h2, so blocks drop to h3 to keep the outline valid.
  const BlockHeading = (headerText ? "h3" : "h2") as "h2" | "h3";
  const ItemHeading = (headerText ? "h4" : "h3") as "h3" | "h4";

  const itemCols = itemGridCols(Math.min(Math.max(Number(columns) || 3, 1), 3));
  const specCols = specGridCols(Math.min(Math.max(Number(specColumns) || 4, 1), 4));

  const used = new Set<string>();

  return section(
    <div className="space-y-12">
      {list.map(({ b, base }, i) => {
        let anchorId = `${anchorPrefix}${slugify(base.anchor || base.title)}` || `block-${i}`;
        while (used.has(anchorId)) anchorId = `${anchorId}-${i}`;
        used.add(anchorId);

        const items = Array.isArray(b.items) ? b.items.filter((it) => it && it.title) : [];
        const specs = Array.isArray(b.specs) ? b.specs.filter((s) => s && s.label) : [];
        const variant = b.headerVariant || "subtle";
        const isSolid = variant === "solid" && !b.headerColor;

        // A brand-filled header needs inverted text; the tinted and subtle
        // variants sit on light surfaces and keep the normal ink.
        const headerClass = isSolid
          ? "bg-primary-500"
          : variant === "tint"
            ? "bg-primary-50"
            : "bg-catalogue-bg-muted";
        const titleClass = isSolid ? "text-white" : "text-catalogue-text-primary";
        const bodyTextClass = isSolid ? "text-white/85" : "text-catalogue-text-secondary";
        const tagClass = isSolid
          ? "bg-white/15 text-white"
          : "bg-primary-50 text-catalogue-brand-ink ring-1 ring-primary-100";

        return (
          <article key={anchorId} id={anchorId} className="catalogue-block-anchor">
            {/* Header — top radius only, no bottom border, so it welds to the body. */}
            <div
              className={`rounded-t-catalogue-lg border border-b-0 border-catalogue-border px-6 py-6 sm:px-8 ${headerClass}`}
              style={b.headerColor ? { backgroundColor: b.headerColor } : undefined}
            >
              {b.tag && (
                <span
                  className={`mb-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide-08 ${tagClass}`}
                >
                  {b.tag}
                </span>
              )}
              <BlockHeading className={`catalogue-h3 ${titleClass}`}>{b.title}</BlockHeading>
              {b.description && (
                <p className={`catalogue-measure-start mt-2 text-sm leading-relaxed ${bodyTextClass}`}>
                  {b.description}
                </p>
              )}
            </div>

            {/* Body — bottom radius only. */}
            <div className="overflow-hidden rounded-b-catalogue-lg border border-catalogue-border bg-catalogue-bg">
              {items.length > 0 && (
                <div className={`catalogue-hairline-grid ${itemCols}`}>
                  {items.map((it, j) => (
                    <div key={j} className="px-6 py-5">
                      <ItemHeading className="mb-1.5 text-sm font-semibold text-catalogue-text-primary">
                        {it.title}
                      </ItemHeading>
                      {it.description && (
                        <p className="text-xs leading-relaxed text-catalogue-text-secondary">
                          {it.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Specs are genuinely name/value pairs, so mark them up as a
                  description list rather than anonymous divs. */}
              {specs.length > 0 && (
                <dl className={`catalogue-hairline-grid ${specCols}`}>
                  {specs.map((s, j) => (
                    <div key={j} className="px-6 py-4 space-y-1">
                      <dt className="text-xs font-semibold uppercase tracking-wide-08 text-catalogue-text-muted">
                        {s.label}
                      </dt>
                      <dd className="text-sm font-medium text-catalogue-text-secondary">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {b.note && (
                <p className={`px-6 py-4 text-sm ${NOTE_TONE[b.noteTone || "warn"] ?? NOTE_TONE.warn}`}>
                  {b.note}
                </p>
              )}

              {b.link?.text && b.link?.url && (
                <div className="px-6 py-4">
                  <CatalogueLink
                    to={b.link.url}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-catalogue-brand-ink no-underline hover:underline"
                  >
                    {b.link.text}
                    <ArrowUpRight className="size-3.5" weight="bold" aria-hidden="true" />
                  </CatalogueLink>
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
};

export default DetailBlocksComponent;
