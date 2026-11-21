import React, { useEffect, useRef, useState } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import type { HeaderNavChild } from "../../../-types/course-catalogue-types";

/**
 * Header nav item of type "dropdown": a label that opens a list of links, and
 * a link may carry its own `children` (one more level, opened beside it) —
 * e.g. Exams → SSC → CGL / CPO / JE / CHSL. Two levels is the ceiling on
 * purpose: deeper menus are unusable on a phone.
 */

type Navigate = (route: string, label: string, openInSameTab: boolean) => void;

const sameTab = (c: HeaderNavChild) => c.openInSameTab === true || String(c.openInSameTab) === "true";
const hasChildren = (c: HeaderNavChild) => Array.isArray(c.children) && c.children.length > 0;
const visible = (list: HeaderNavChild[] | undefined) =>
  (Array.isArray(list) ? list : []).filter((c) => c && c.enabled !== false && (c.label || "").trim());

export const DesktopNavDropdown: React.FC<{
  label: string;
  items: HeaderNavChild[];
  active: boolean;
  buttonClassName: string;
  onNavigate: Navigate;
}> = ({ label, items, active, buttonClassName, onNavigate }) => {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<number | null>(null);
  // Not enough room on the right for the panel and its second column (the
  // item sits near the end of the bar on a laptop screen): anchor the panel
  // to the item's right edge and open the second column to the left instead.
  const [flip, setFlip] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const list = visible(items);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setGroup(null);
  }, [open]);

  const decideSide = () => {
    const rect = root.current?.getBoundingClientRect();
    // Two columns of min-w-56 (14rem) plus a little air.
    const needed = 2 * 14 * 16 + 16;
    setFlip(!!rect && rect.left + needed > window.innerWidth);
  };
  const enter = () => {
    window.clearTimeout(closeTimer.current);
    if (!open) decideSide();
    setOpen(true);
  };
  // A short grace period so moving the pointer from the label to the panel
  // (or between columns) does not snap the menu shut.
  const leave = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };

  const go = (c: HeaderNavChild) => {
    if (!(c.route || "").trim()) return;
    setOpen(false);
    onNavigate(c.route!, c.label, sameTab(c));
  };

  const sub = group !== null ? visible(list[group]?.children) : [];
  const rowCls =
    "flex w-full items-center justify-between gap-6 px-5 py-3 text-start text-sm font-medium text-catalogue-text-secondary transition-colors duration-150 hover:bg-catalogue-interactive-hover hover:text-catalogue-text-primary focus-visible:bg-catalogue-interactive-hover focus-visible:outline-none";

  return (
    <div ref={root} className="relative" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (!open) decideSide();
          setOpen((o) => !o);
        }}
        className={`inline-flex items-center gap-1 ${buttonClassName}`}
      >
        {label}
        <CaretDown size={12} weight="bold" aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && list.length > 0 && (
        <div className={`absolute top-full z-catalogue-dropdown flex pt-2 ${flip ? "end-0 flex-row-reverse" : "start-0"}`}>
          <div
            role="menu"
            className="min-w-56 overflow-hidden rounded-b-catalogue-md border-t-2 border-primary-500 bg-catalogue-bg-elevated py-2 shadow-xl"
          >
            {list.map((c, i) =>
              hasChildren(c) ? (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={group === i}
                  onMouseEnter={() => setGroup(i)}
                  onFocus={() => setGroup(i)}
                  onClick={() => (c.route ? go(c) : setGroup(i))}
                  className={`${rowCls} ${group === i ? "text-primary-500" : ""}`}
                >
                  <span>{c.label}</span>
                  <CaretRight size={12} weight="bold" aria-hidden="true" className={flip ? "rotate-180" : ""} />
                </button>
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  onMouseEnter={() => setGroup(null)}
                  onClick={() => go(c)}
                  className={rowCls}
                >
                  {c.label}
                </button>
              ),
            )}
          </div>
          {sub.length > 0 && (
            <div
              role="menu"
              className={`min-w-56 overflow-hidden rounded-b-catalogue-md border-t-2 border-primary-500 bg-catalogue-bg-elevated py-2 shadow-xl ${flip ? "me-px" : "ms-px"}`}
            >
              {sub.map((c, j) => (
                <button key={j} type="button" role="menuitem" onClick={() => go(c)} className={rowCls}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {active && <span className="sr-only">(current section)</span>}
    </div>
  );
};

export const MobileNavDropdown: React.FC<{
  label: string;
  items: HeaderNavChild[];
  itemClassName: string;
  onNavigate: Navigate;
  onDone: () => void;
}> = ({ label, items, itemClassName, onNavigate, onDone }) => {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<number | null>(null);
  const list = visible(items);
  const go = (c: HeaderNavChild) => {
    if (!(c.route || "").trim()) return;
    onDone();
    onNavigate(c.route!, c.label, sameTab(c));
  };
  const leafCls =
    "block w-full text-start px-4 py-2 rounded-catalogue-sm text-sm font-medium text-catalogue-text-secondary hover:text-catalogue-text-primary hover:bg-catalogue-interactive-hover";
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center justify-between ${itemClassName}`}
      >
        <span>{label}</span>
        <CaretDown size={14} weight="bold" aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="ms-4 border-s border-catalogue-border-subtle ps-2">
          {list.map((c, i) =>
            hasChildren(c) ? (
              <div key={i}>
                <button
                  type="button"
                  aria-expanded={group === i}
                  onClick={() => setGroup((g) => (g === i ? null : i))}
                  className={`flex items-center justify-between ${leafCls}`}
                >
                  <span>{c.label}</span>
                  <CaretDown size={12} weight="bold" aria-hidden="true" className={`transition-transform duration-200 ${group === i ? "rotate-180" : ""}`} />
                </button>
                {group === i && (
                  <div className="ms-4 border-s border-catalogue-border-subtle ps-2">
                    {visible(c.children).map((leaf, j) => (
                      <button key={j} type="button" onClick={() => go(leaf)} className={leafCls}>
                        {leaf.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button key={i} type="button" onClick={() => go(c)} className={leafCls}>
                {c.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
};
