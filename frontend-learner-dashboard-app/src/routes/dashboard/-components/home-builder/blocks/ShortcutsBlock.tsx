import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { HomePlacement, ShortcutsConfig, ShortcutTile } from "@/types/learner-home";
import { useHomeBuilder } from "../home-context";
import { navigationHref, toNavigation } from "../link-target";
import { shortcutIcon } from "../icons";
import { altOf, srcSetOf } from "../image-sources";

/**
 * Shortcut tiles (spec 7.4.2). Phones: one row, four tiles visible; with more
 * the row scrolls and a sliver of the fifth tile shows that it does. Desktop
 * main/full: up to eight per row, then it scrolls. Rail: four per row, wrapping.
 */
export function ShortcutsBlock({
  blockKey,
  config,
  placement,
}: {
  blockKey: string;
  config: ShortcutsConfig;
  placement: HomePlacement;
}) {
  const { t } = useTranslation("learnerHome");
  const { analytics, preview } = useHomeBuilder();
  const listRef = useRef<HTMLUListElement>(null);
  const tiles = config.tiles;
  const title = (config.title ?? "").trim();
  const scrollsOnPhone = tiles.length > 4;
  const scrollsOnDesktop = placement !== "RAIL" && tiles.length > 8;

  // A tile counts as viewed the first time it is on screen.
  useEffect(() => {
    const list = listRef.current;
    if (!list || preview || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = (entry.target as HTMLElement).dataset.tileKey;
          if (key) analytics.view(blockKey, key);
          observer.unobserve(entry.target);
        }
      },
      { threshold: [0.6] }
    );
    list.querySelectorAll("[data-tile-key]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [analytics, blockKey, preview, tiles.length]);

  return (
    <nav aria-label={title || t("shortcuts.label")} className="fun-block-shortcuts">
      {title ? (
        <h2 className="mb-2 text-subtitle font-semibold text-foreground [.ui-play_&]:font-black fun-block-title">
          {title}
        </h2>
      ) : null}
      <ul
        ref={listRef}
        className={cn(
          "grid list-none gap-3 p-0",
          // Phones (and tablets): one row.
          scrollsOnPhone
            ? "snap-x snap-mandatory grid-flow-col auto-cols-[calc((100%-2.25rem)/4.4)] overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "grid-cols-4",
          // Desktop.
          placement === "RAIL"
            ? "lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-4 lg:overflow-visible"
            : scrollsOnDesktop
              ? "lg:auto-cols-[calc((100%-5.25rem)/8)]"
              : "lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-8 lg:overflow-visible"
        )}
      >
        {tiles.map((tile) => (
          <li key={tile.key} data-tile-key={tile.key} className="snap-start">
            <Tile blockKey={blockKey} tile={tile} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Tile({ blockKey, tile }: { blockKey: string; tile: ShortcutTile }) {
  const { openLink, linkContext } = useHomeBuilder();
  const nav = toNavigation(tile.link, linkContext);
  const Icon = tile.icon.kind === "ICON" ? shortcutIcon(tile.icon.name) : null;
  return (
    <a
      href={nav ? navigationHref(nav) : undefined}
      onClick={(e) => {
        e.preventDefault();
        openLink(tile.link, blockKey, tile.key);
      }}
      className={cn(
        "group flex min-h-20 min-w-16 flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 text-center",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
        "fun-block-tile"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full",
          "bg-primary-50 text-primary-500 transition-transform group-hover:scale-105 group-active:scale-95",
          "[.ui-vibrant_&]:bg-gradient-to-br [.ui-vibrant_&]:from-primary-50 [.ui-vibrant_&]:to-primary-100",
          "[.ui-play_&]:shadow-play-soft-card [.ui-cleaner-play_&]:bg-cp-gold-tint",
          "fun-block-tile__disc"
        )}
      >
        {Icon ? (
          <Icon size={26} weight="duotone" />
        ) : tile.icon.kind === "IMAGE" ? (
          <img
            src={tile.icon.image.url}
            srcSet={srcSetOf(tile.icon.image) || undefined}
            sizes="48px"
            alt={altOf(tile.icon.image)}
            loading="lazy"
            decoding="async"
            className="size-full rounded-full object-cover"
          />
        ) : null}
      </span>
      <span className="line-clamp-2 text-caption font-medium leading-tight text-foreground sm:text-caption [.ui-play_&]:font-bold fun-block-tile__label">
        {tile.label}
      </span>
    </a>
  );
}
