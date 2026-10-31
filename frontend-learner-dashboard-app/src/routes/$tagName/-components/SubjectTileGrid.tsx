import React from "react";
import { FitImage } from "@/components/common/fit-image/FitImage";
import { CaretLeft, CaretRight, FolderOpen } from "@phosphor-icons/react";

export interface ContentTile {
  id: string;
  /** Subject, module or chapter name — whatever level this grid is drawing. */
  name: string;
  description?: string;
}

/** @deprecated kept so existing imports keep working; use ContentTile. */
export type SubjectTile = ContentTile;

interface SubjectTileGridProps {
  items: ContentTile[];
  /** item id → resolved artwork URL. An item with no entry shows a glyph. */
  thumbs: Record<string, string>;
  onOpen: (id: string) => void;
  /** Tighter cards for a nested level. */
  dense?: boolean;
}

/**
 * A level of the course structure, as artwork cards.
 *
 * Card shape follows the admin dashboard and the enrolled learner's Content
 * Structure, which is what authors design their artwork against. Purely
 * presentational, and split out of CourseStructureDetails so it can be
 * rendered in a test — that component's data arrives from a fetch in an effect.
 *
 * Opening a card does NOT expand it in place. An earlier cut did, and on a
 * three-column grid the full-width panel that appeared did not visibly belong
 * to any one card. The caller swaps this grid for the level below instead
 * (see ContentDrillCrumb), so at any moment the screen shows exactly one
 * level and a trail back up.
 */
export const SubjectTileGrid: React.FC<SubjectTileGridProps> = ({
  items,
  thumbs,
  onOpen,
  dense = false,
}) => (
  <div
    className={
      dense
        ? "grid grid-cols-2 gap-3 sm:grid-cols-3"
        : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    }
  >
    {items.map((item) => {
      const thumb = thumbs[item.id];
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item.id)}
          className="group flex flex-col overflow-hidden rounded-catalogue-lg border border-catalogue-border bg-catalogue-bg-elevated text-start transition-shadow hover:border-primary-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <div className="aspect-video w-full overflow-hidden bg-catalogue-bg-subtle">
            {thumb ? (
              <FitImage
                src={thumb}
                alt=""
                loading="lazy"
                className="size-full transition-transform duration-200 group-hover:scale-[1.03]"
                onError={(e) => {
                  // A dead media id must not leave a broken-image glyph on a
                  // sales page; the card reads fine as text alone.
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <FolderOpen size={28} className="text-catalogue-text-muted" />
              </div>
            )}
          </div>
          <div className={`flex flex-1 items-start gap-2 ${dense ? "p-2" : "p-3"}`}>
            <div className="min-w-0 flex-1">
              {/* Two lines rather than one: these titles are long enough that
                  truncating loses the part that distinguishes them
                  ("Level 1: Active explorer pro…"). */}
              <div
                className={`line-clamp-2 font-medium text-catalogue-text-primary ${dense ? "text-sm" : ""}`}
              >
                {item.name}
              </div>
              {item.description?.trim() ? (
                <div className="line-clamp-1 text-sm text-catalogue-text-muted">
                  {item.description}
                </div>
              ) : null}
            </div>
            <CaretRight
              size={16}
              className="mt-0.5 shrink-0 text-catalogue-text-muted transition-colors group-hover:text-primary-500"
            />
          </div>
        </button>
      );
    })}
  </div>
);

/**
 * The trail back up out of a drilled-into level.
 *
 * Every step is clickable, and the current level is the heading — so the
 * visitor can always see where they are and get back in one click, which the
 * expand-in-place version could not tell them.
 */
export const ContentDrillCrumb: React.FC<{
  /** Ancestors, outermost first. The last entry is the level being shown. */
  trail: Array<{ id: string; name: string }>;
  rootLabel: string;
  onNavigate: (id: string | null) => void;
}> = ({ trail, rootLabel, onNavigate }) => {
  const current = trail[trail.length - 1];
  const ancestors = trail.slice(0, -1);
  return (
    <div className="mb-3 space-y-1">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-catalogue-text-muted">
        <button
          type="button"
          onClick={() => onNavigate(null)}
          className="inline-flex items-center gap-1 rounded-catalogue-sm px-1 py-0.5 hover:text-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <CaretLeft size={14} />
          {rootLabel}
        </button>
        {ancestors.map((step) => (
          <React.Fragment key={step.id}>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              onClick={() => onNavigate(step.id)}
              className="rounded-catalogue-sm px-1 py-0.5 hover:text-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {step.name}
            </button>
          </React.Fragment>
        ))}
      </nav>
      <h4 className="font-medium text-catalogue-text-primary">{current?.name}</h4>
    </div>
  );
};
