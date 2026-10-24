/**
 * The folder trail above a course page ("Current Affairs > Weekly > 2025"),
 * each folder linking back to the site page that shows it.
 *
 * A course reached through a Folder Browser carries its product page's code
 * (`?productPageCode=`); that page sits in exactly one folder of the library,
 * so the trail is the folders above it — where the visitor came from. Without
 * one, the course's tags (the institute files each PDF under its folder
 * names) are the trail, and a tag links only when one folder of the library
 * has that name: an ambiguous name ("2025" under Weekly and Monthly) stays
 * plain text rather than guess.
 *
 * A folder links to a page whose Folder Browser shows it: the section that
 * starts closest above it (a "Current Affairs" page before the whole
 * library), then a page other than the home page, then page order. A folder
 * no section shows stays plain text.
 */
import type { PublicFolderNode } from "../../-services/folder-library-service";

export interface FolderBrowserSection {
  /** Site page route ("current-affairs"). */
  route: string;
  libraryId: string;
  /** '' = the library's top level. */
  rootFolderId: string;
}

export interface FolderCrumb {
  key: string;
  title: string;
  /** The page that shows the folder, or null when none does. */
  route: string | null;
  /** `?folder=` for that page; null when the folder is the section's own top. */
  folderId: string | null;
}

interface PageLike {
  route?: string | null;
  components?: Array<{ type?: string; enabled?: boolean; props?: Record<string, unknown> | null }> | null;
}

const HOME_ROUTES = new Set(["", "home", "homepage"]);

/** The site's enabled Folder Browser sections, in page order. */
export const folderBrowserSections = (pages: PageLike[] | null | undefined): FolderBrowserSection[] => {
  const out: FolderBrowserSection[] = [];
  for (const page of pages || []) {
    for (const c of page.components || []) {
      if (c.type !== "folderBrowser" || c.enabled === false) continue;
      const libraryId = typeof c.props?.libraryId === "string" ? c.props.libraryId.trim() : "";
      if (!libraryId) continue;
      const root = typeof c.props?.rootFolderId === "string" ? c.props.rootFolderId.trim() : "";
      out.push({ route: (page.route || "").trim(), libraryId, rootFolderId: root });
    }
  }
  return out;
};

const pathWhere = (
  nodes: PublicFolderNode[],
  match: (n: PublicFolderNode) => boolean,
): PublicFolderNode[] => {
  for (const n of nodes) {
    if (match(n)) return [n];
    const below = pathWhere(n.children || [], match);
    if (below.length) return [n, ...below];
  }
  return [];
};

const titleOf = (n: PublicFolderNode) => (n.title || "").trim() || (n.product_page_name || "").trim();

/** The page (and `?folder=`) showing the last folder of `path`, or null. */
const linkFor = (
  path: PublicFolderNode[],
  libraryId: string,
  sections: FolderBrowserSection[],
): Pick<FolderCrumb, "route" | "folderId"> => {
  const folder = path[path.length - 1]!;
  let best: { section: FolderBrowserSection; depth: number } | null = null;
  for (const section of sections) {
    if (section.libraryId !== libraryId) continue;
    const depth = section.rootFolderId ? path.findIndex((n) => n.id === section.rootFolderId) : -1;
    if (section.rootFolderId && depth < 0) continue;
    if (
      !best ||
      depth > best.depth ||
      (depth === best.depth &&
        HOME_ROUTES.has(best.section.route.toLowerCase()) &&
        !HOME_ROUTES.has(section.route.toLowerCase()))
    ) {
      best = { section, depth };
    }
  }
  if (!best) return { route: null, folderId: null };
  const { section } = best;
  return { route: section.route, folderId: section.rootFolderId === folder.id ? null : folder.id };
};

/**
 * The trail for a course page, or null when the site has no folder library
 * to read it from (the page then shows the tags as they are).
 */
export const folderTrail = (input: {
  sections: FolderBrowserSection[];
  /** Loaded library trees, by library id. */
  trees: Record<string, PublicFolderNode[] | undefined>;
  productPageCode?: string | null;
  tags?: string[] | null;
}): FolderCrumb[] | null => {
  const libraryIds = [...new Set(input.sections.map((s) => s.libraryId))].filter(
    (id) => input.trees[id],
  );
  if (!libraryIds.length) return null;

  const code = (input.productPageCode || "").trim();
  if (code) {
    for (const libraryId of libraryIds) {
      const path = pathWhere(
        input.trees[libraryId]!,
        (n) => n.node_type === "PRODUCT_PAGE" && n.product_page_code === code,
      );
      const folders = path.slice(0, -1);
      if (!folders.length) continue;
      return folders.map((folder, i) => ({
        key: folder.id,
        title: titleOf(folder),
        ...linkFor(folders.slice(0, i + 1), libraryId, input.sections),
      }));
    }
  }

  const tags = (input.tags || []).map((t) => (t || "").trim()).filter(Boolean);
  if (!tags.length) return null;
  return tags.map((tag, i) => {
    const wanted = tag.toLowerCase();
    const hits: Array<{ libraryId: string; path: PublicFolderNode[] }> = [];
    const walk = (libraryId: string, nodes: PublicFolderNode[], above: PublicFolderNode[]) => {
      for (const n of nodes) {
        if (n.node_type !== "FOLDER") continue;
        const path = [...above, n];
        if (titleOf(n).toLowerCase() === wanted) hits.push({ libraryId, path });
        walk(libraryId, n.children || [], path);
      }
    };
    for (const libraryId of libraryIds) walk(libraryId, input.trees[libraryId]!, []);
    const link =
      hits.length === 1
        ? linkFor(hits[0]!.path, hits[0]!.libraryId, input.sections)
        : { route: null, folderId: null };
    return { key: `${tag}-${i}`, title: tag, ...link };
  });
};
