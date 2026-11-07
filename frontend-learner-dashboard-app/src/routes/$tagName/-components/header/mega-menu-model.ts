/**
 * Header mega menu ("Knowledge Streams") — what the panel shows, derived from
 * a public folder tree. Pure, so tiles, categories, links and coming-soon
 * handling are unit-tested (mega-menu-model.test.ts).
 *
 *   library
 *   ├── stream (top-level FOLDER)   → a tile + the detail panel
 *   │   └── category (child FOLDER) → a row in the detail panel
 *   └── …
 *
 * Product pages in the tree are not part of the menu (they are learning
 * paths, shown elsewhere). Empty folders are KEPT: a category filters the
 * Courses page by course tag, so it need not hold anything in the tree.
 *
 * Strings stay raw here; the components translate them for display only
 * (useSiteT), and links are built from slugs, never from display text.
 */

import { folderSlug, type PublicFolderNode, type PublicFolderTree } from "../../-services/folder-library-service";
import type { HeaderMegaMenuConfig } from "../../-types/course-catalogue-types";
import {
  DEFAULT_CATEGORY_LINK_PATTERN,
  DEFAULT_STREAM_LINK_PATTERN,
  linkFromPattern,
  safeAccentColor,
  safeHeaderLink,
  safeImageSrc,
  type HeaderLink,
} from "./header-links";

/** What activating an item does. */
export type MegaMenuAction =
  | { kind: "link"; link: HeaderLink }
  /** Coming soon with a "notify me" form: opens the audience form. */
  | { kind: "notify"; audienceId: string }
  /** Nothing to open: coming soon without a form, or no usable link. */
  | { kind: "none" };

export interface MegaMenuItem {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  imageUrl: string | null;
  accentColor: string | null;
  comingSoon: boolean;
  action: MegaMenuAction;
}

export type MegaMenuCategory = MegaMenuItem;

export interface MegaMenuStream extends MegaMenuItem {
  tagline: string;
  /** The folder's own CTA label; null = use the menu's ctaLabelPattern. */
  ctaLabel: string | null;
  categories: MegaMenuCategory[];
}

export interface MegaMenuModel {
  streams: MegaMenuStream[];
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const isFolder = (n: PublicFolderNode | null | undefined): n is PublicFolderNode =>
  !!n && n.node_type === "FOLDER" && !!(text(n.title) || text(n.subtitle));

const actionFor = (
  comingSoon: boolean,
  audienceId: string,
  link: () => HeaderLink | null,
): MegaMenuAction => {
  if (comingSoon) return audienceId ? { kind: "notify", audienceId } : { kind: "none" };
  const resolved = link();
  return resolved ? { kind: "link", link: resolved } : { kind: "none" };
};

const baseItem = (n: PublicFolderNode) => ({
  id: n.id,
  slug: folderSlug(n),
  title: text(n.title) || text(n.subtitle),
  // A folder with only a subtitle shows it as the title; don't repeat it.
  subtitle: text(n.title) ? text(n.subtitle) : "",
  description: text(n.description),
  imageUrl: safeImageSrc(n.image_url),
  accentColor: safeAccentColor(n.accent_color),
});

/**
 * Streams and categories from a public folder tree. A missing tree (still
 * loading, deleted library) gives an empty model, never a throw.
 */
export const buildMegaMenuModel = (
  tree: PublicFolderTree | null | undefined,
  config: HeaderMegaMenuConfig | null | undefined,
): MegaMenuModel => {
  const roots = Array.isArray(tree?.roots) ? tree!.roots : [];

  const streams = roots.filter(isFolder).map((node): MegaMenuStream => {
    const item = baseItem(node);
    const streamComingSoon = node.coming_soon === true;
    const streamAudience = text(node.audience_id);

    const categories = (Array.isArray(node.children) ? node.children : [])
      .filter(isFolder)
      .map((child): MegaMenuCategory => {
        const cat = baseItem(child);
        // A category of a coming-soon stream cannot be open either; it
        // collects sign-ups for its own form, else for the stream's.
        const comingSoon = streamComingSoon || child.coming_soon === true;
        const audienceId = text(child.audience_id) || (streamComingSoon ? streamAudience : "");
        return {
          ...cat,
          comingSoon,
          action: actionFor(comingSoon, audienceId, () =>
            safeHeaderLink(child.link_url) ??
            linkFromPattern(config?.categoryLinkPattern, DEFAULT_CATEGORY_LINK_PATTERN, {
              stream: item.slug,
              category: cat.slug,
            }),
          ),
        };
      });

    return {
      ...item,
      tagline: text(node.tagline),
      ctaLabel: text(node.cta_label) || null,
      comingSoon: streamComingSoon,
      action: actionFor(streamComingSoon, streamAudience, () =>
        safeHeaderLink(node.link_url) ??
        linkFromPattern(config?.streamLinkPattern, DEFAULT_STREAM_LINK_PATTERN, { stream: item.slug }),
      ),
      categories,
    };
  });

  return { streams };
};

/**
 * The menu's library no longer exists: the public tree answers 404 for a
 * deleted or unknown library (any other failure may pass, so it is retried
 * and offered "Try again"). The header then shows the item as a plain link.
 */
export const isMissingLibraryError = (err: unknown): boolean =>
  (err as { response?: { status?: unknown } } | null | undefined)?.response?.status === 404;

/**
 * The tile selected when the panel opens: the stream named by ?stream= (the
 * page the visitor is on), else the first one. -1 when there are no streams.
 */
export const initialStreamIndex = (streams: MegaMenuStream[], streamParam: string | null | undefined): number => {
  if (!streams.length) return -1;
  const wanted = text(streamParam).toLowerCase();
  if (wanted) {
    const hit = streams.findIndex((s) => s.slug.toLowerCase() === wanted);
    if (hit >= 0) return hit;
  }
  return 0;
};

/**
 * Values for the menu's text patterns ("Explore {stream}"): {stream} is the
 * stream's name — its subtitle (the English caption under a Hindi title),
 * else its title — and {title} is its title. `translate` is the display
 * translation (useSiteT); identity when the site has one language.
 */
export const streamTextValues = (
  stream: Pick<MegaMenuItem, "title" | "subtitle">,
  translate: (s: string) => string = (s) => s,
): Record<string, string> => {
  const title = translate(stream.title);
  const name = stream.subtitle ? translate(stream.subtitle) : title;
  return { stream: name, title };
};
