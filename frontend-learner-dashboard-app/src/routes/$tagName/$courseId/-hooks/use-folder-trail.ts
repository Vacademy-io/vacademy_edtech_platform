import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchPublicFolderTree, type PublicFolderNode } from "../../-services/folder-library-service";
import { folderBrowserSections, folderTrail, type FolderCrumb } from "../-utils/folder-trail";

/**
 * The course page's folder trail (see folder-trail), read from the site's
 * Folder Browser libraries through the same query the section uses, so a
 * visitor arriving from a folder reuses the tree already loaded. `enabled`
 * false, or a site without a Folder Browser, reads nothing: null.
 */
export const useFolderTrail = (input: {
  enabled: boolean;
  instituteId: string | null | undefined;
  pages: Parameters<typeof folderBrowserSections>[0];
  productPageCode?: string | null;
  tags?: string[] | null;
}): FolderCrumb[] | null => {
  const { enabled, instituteId, pages, productPageCode, tags } = input;
  const sections = useMemo(() => (enabled ? folderBrowserSections(pages) : []), [enabled, pages]);
  const libraryIds = useMemo(() => [...new Set(sections.map((s) => s.libraryId))], [sections]);
  const results = useQueries({
    queries: libraryIds.map((libraryId) => ({
      queryKey: ["FOLDER_LIBRARY_PUBLIC", instituteId, libraryId],
      queryFn: () => fetchPublicFolderTree(instituteId!, libraryId),
      enabled: !!instituteId,
      staleTime: 60_000,
      retry: (count: number, err: unknown) =>
        (err as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
    })),
  });
  const roots = results.map((r) => r.data?.roots);
  const rootsKey = results.map((r) => r.dataUpdatedAt).join(",");
  const tagsKey = (tags || []).join("\u0000");
  return useMemo(() => {
    if (!sections.length) return null;
    const trees: Record<string, PublicFolderNode[] | undefined> = {};
    libraryIds.forEach((id, i) => {
      trees[id] = roots[i];
    });
    return folderTrail({ sections, trees, productPageCode, tags });
    // roots/tags change identity every render; their keys say when they changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, libraryIds, rootsKey, productPageCode, tagsKey]);
};
