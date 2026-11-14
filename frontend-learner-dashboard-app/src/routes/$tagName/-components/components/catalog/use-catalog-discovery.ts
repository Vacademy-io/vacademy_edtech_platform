import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPublicFolderTree } from "../../../-services/folder-library-service";
import { useCatalogueSearchParams } from "../../../-utils/catalogue-url-state";
import type { ResolvedStreams } from "./catalog-config";
import { streamsFromFolderTree, streamsFromTagItems, type CatalogStream } from "./catalog-streams";
import {
  EMPTY_DISCOVERY_STATE,
  discoveryPatchToParams,
  readDiscoveryParams,
  readStreamParams,
  sanitizeDiscoveryState,
  type DiscoveryState,
  type DiscoveryValidation,
} from "./catalog-url";

const NO_STREAMS: CatalogStream[] = [];

/**
 * The section's stream tabs. Folder-library streams share the folder
 * browser's query (same key), so a page showing both — or the header's mega
 * menu — fetches the tree once. Nothing is fetched while streams are off.
 */
export const useCatalogStreams = (instituteId: string, streams: ResolvedStreams | null) => {
  const libraryId = streams?.source === "folderLibrary" ? streams.libraryId : "";
  const query = useQuery({
    queryKey: ["FOLDER_LIBRARY_PUBLIC", instituteId, libraryId],
    queryFn: () => fetchPublicFolderTree(instituteId, libraryId),
    enabled: !!instituteId && !!libraryId,
    staleTime: 60_000,
    retry: (count, err: unknown) =>
      // A deleted library is a 404 — retrying will not change that.
      (err as { response?: { status?: number } })?.response?.status !== 404 && count < 2,
  });
  const list = useMemo(() => {
    if (!streams) return NO_STREAMS;
    if (streams.source === "tags") return streamsFromTagItems(streams.items);
    return streamsFromFolderTree(query.data?.roots);
  }, [streams, query.data]);
  return { streams: list, isLoading: !!libraryId && query.isLoading };
};

/**
 * Stream / category / language / price / badge state of the Courses page.
 *
 * With syncUrl the query string IS the state: tabs push a history entry,
 * filter tweaks replace it, and Back/Forward or a mega-menu link simply
 * re-render. Without it the state is local — but a ?stream= link still
 * preselects its tab, on arrival and whenever the link changes.
 *
 * Either way the state is read through `validation` (discoveryLinkScope):
 * a value the section offers no control for never applies — whether it came
 * from a link or was left behind by a control the page builder switched off.
 */
export const useDiscoveryState = (opts: {
  syncUrl: boolean;
  streamsEnabled: boolean;
  /** Streams are known (folder tree loaded), so ?stream= can be validated. */
  ready: boolean;
  validation: DiscoveryValidation;
}) => {
  const { syncUrl, streamsEnabled, ready, validation } = opts;
  const { searchStr, update } = useCatalogueSearchParams();
  const fromUrl = useMemo(() => readDiscoveryParams(searchStr, validation), [searchStr, validation]);
  const [local, setLocal] = useState<DiscoveryState>(EMPTY_DISCOVERY_STATE);

  const linkStream = fromUrl.stream;
  const linkCategories = fromUrl.categories.join(",");
  useEffect(() => {
    if (syncUrl || !streamsEnabled || !ready) return;
    const { stream, categories } = readStreamParams(searchStr, validation);
    setLocal((prev) => ({ ...prev, stream, categories }));
    // Re-seed only when the link's own stream/category change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncUrl, streamsEnabled, ready, linkStream, linkCategories]);

  const setState = useCallback(
    (patch: Partial<DiscoveryState>, o?: { push?: boolean }) => {
      if (syncUrl) update(discoveryPatchToParams(patch), o);
      else setLocal((prev) => ({ ...prev, ...patch }));
    },
    [syncUrl, update],
  );

  const localState = useMemo(() => sanitizeDiscoveryState(local, validation), [local, validation]);

  return { state: syncUrl ? fromUrl : localState, setState };
};
