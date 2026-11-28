import { useQuery } from '@tanstack/react-query';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { folderTreeQueryKey, getFolderTree } from '../../-services/folder-library-service';
import {
    objectOf,
    streamOptionsFromItems,
    streamOptionsFromTree,
    textOf,
    type Props,
    type StreamOption,
} from './catalog-design-props';

/**
 * The section's stream tabs and their categories, for the stream / category
 * pickers: the folder library the tabs come from (the same cached tree query
 * the folder editors use), or the tag tabs typed into `streams.items`.
 * Empty until the section has stream tabs.
 */
export const useCatalogStreams = (props: Props, enabled: boolean): StreamOption[] => {
    const instituteId = getCurrentInstituteId();
    const streams = objectOf(props.streams);
    const fromTags = streams.source === 'tags';
    const libraryId = textOf(streams.libraryId);
    const { data: tree } = useQuery({
        queryKey: folderTreeQueryKey(instituteId, libraryId),
        queryFn: () => getFolderTree(instituteId!, libraryId),
        enabled: enabled && !fromTags && !!instituteId && !!libraryId,
        staleTime: 30_000,
    });
    if (fromTags) return streamOptionsFromItems(streams.items);
    // Guard the shape: an unexpected body must not take the property panel down.
    return streamOptionsFromTree(tree && Array.isArray(tree.roots) ? tree.roots : null);
};
