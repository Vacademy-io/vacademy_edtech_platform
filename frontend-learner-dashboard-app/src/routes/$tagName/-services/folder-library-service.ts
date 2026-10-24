import axios from "axios";
import { BASE_URL } from "@/constants/urls";

/**
 * Public read of a folder library, for the catalogue `folderBrowser` section.
 * The server already drops hidden branches and product pages that are not
 * ACTIVE (see PublicCatalogueFolderController); empty folders are pruned here
 * because whether to show them is a per-section choice.
 */

const publicAxios = axios.create({ withCredentials: false });

const API_BASE = `${BASE_URL}/admin-core-service/public/folder-library/v1`;

export type FolderLayout = "cards" | "tiles" | "list";
export type FolderImageShape = "landscape" | "square" | "portrait" | "none";

export interface FolderView {
  layout?: FolderLayout;
  imageShape?: FolderImageShape;
  columns?: number;
  showDescription?: boolean;
  showCounts?: boolean;
}

export interface PublicFolderNode {
  id: string;
  parent_id?: string | null;
  node_type: "FOLDER" | "PRODUCT_PAGE";
  title?: string | null;
  description?: string | null;
  image_url?: string | null;
  product_page_code?: string | null;
  product_page_name?: string | null;
  view?: FolderView | null;
  /** URL-safe id used in links (?stream=shiksha). */
  slug?: string | null;
  /** The course tag this folder stands for; defaults to the slug. */
  course_tag?: string | null;
  /** Second line under the title (e.g. the English name under a Hindi title). */
  subtitle?: string | null;
  /** Headline when the folder is featured (mega menu detail panel). */
  tagline?: string | null;
  cta_label?: string | null;
  /** Site route (/courses?stream=shiksha) or full URL. */
  link_url?: string | null;
  accent_color?: string | null;
  /** Shown but not open yet; clicking collects an email for audience_id. */
  coming_soon?: boolean;
  audience_id?: string | null;
  children: PublicFolderNode[];
}

export interface PublicFolderTree {
  library: { id: string; name: string };
  roots: PublicFolderNode[];
}

export const fetchPublicFolderTree = async (
  instituteId: string,
  libraryId: string,
): Promise<PublicFolderTree> =>
  (
    await publicAxios.get<PublicFolderTree>(`${API_BASE}/tree`, {
      params: { instituteId, libraryId },
    })
  ).data;

/**
 * A folder survives pruning only while something a visitor can open is inside
 * it — or when it is marked coming soon, which is empty on purpose (it exists
 * to collect "notify me" sign-ups).
 */
export const pruneEmptyFolders = (nodes: PublicFolderNode[]): PublicFolderNode[] =>
  nodes.flatMap((n) => {
    if (n.node_type !== "FOLDER") return [n];
    const children = pruneEmptyFolders(n.children || []);
    if (children.length || n.coming_soon) return [{ ...n, children }];
    return [];
  });

/** The folder's link key: its slug, else a slug made from its subtitle or title. */
export const folderSlug = (n: Pick<PublicFolderNode, "slug" | "subtitle" | "title" | "id">): string => {
  const explicit = (n.slug || "").trim();
  if (explicit) return explicit;
  const fromText = (n.subtitle || n.title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return fromText || n.id;
};

/** The course tag a folder filters by: its explicit tag, else its slug. */
export const folderCourseTag = (n: Pick<PublicFolderNode, "slug" | "course_tag" | "subtitle" | "title" | "id">): string =>
  (n.course_tag || "").trim() || folderSlug(n);

/** Path from the top down to `id`, inclusive; [] when it is not in `nodes`. */
export const pathTo = (nodes: PublicFolderNode[], id: string | null | undefined): PublicFolderNode[] => {
  if (!id) return [];
  for (const n of nodes) {
    if (n.id === id) return [n];
    const below = pathTo(n.children || [], id);
    if (below.length) return [n, ...below];
  }
  return [];
};

export const nodeTitle = (n: PublicFolderNode): string =>
  (n.title || "").trim() || (n.product_page_name || "").trim();
