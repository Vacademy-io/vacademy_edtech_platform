import React from "react";

/**
 * "All courses" + "Sorted by most popular" right above the grid (feature
 * 'cards'; Figma courses node 1:386). Only for a section with
 * render.gridHeading. Texts arrive in the visitor's language.
 */

const TITLE_CLASS = "text-[22px] font-bold leading-[30px] text-palette-text"; // design-lint-ignore: Figma 22/30 heading
const NOTE_CLASS = "text-[13px] leading-[18px] text-palette-muted"; // design-lint-ignore: Figma 13/18 note

export const CatalogGridHeading: React.FC<{ title: string; note?: string | null }> = ({ title, note }) => (
  <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1" data-grid-heading="">
    <h2 className={TITLE_CLASS}>{title}</h2>
    {note && <p className={NOTE_CLASS}>{note}</p>}
  </div>
);

export default CatalogGridHeading;
