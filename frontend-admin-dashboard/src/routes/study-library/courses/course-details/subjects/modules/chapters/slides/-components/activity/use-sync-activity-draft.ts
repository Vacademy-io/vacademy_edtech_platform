import { useEffect, useRef } from 'react';
import type { Slide } from '../../-hooks/use-slides';
import { useContentStore } from '../../-stores/chapter-sidebar-store';

/** Draft JSON of a JSON-backed document slide: the draft column, else the live copy. */
export function storedActivityJson(slide: Slide | null | undefined): string {
    return slide?.document_slide?.data || slide?.document_slide?.published_data || '';
}

/**
 * Keeps the editor's latest JSON in `activeItem.document_slide.data`, which the slide
 * header's Save Draft and Publish send to the server (same contract as the Discussion
 * editor). A refetch that replaces activeItem with a value this editor wrote or started
 * from gets the local edits put back; any other value (a version restore) is left alone,
 * because the restore remounts the editor with it.
 */
export function useSyncActivityDraft(
    slideId: string,
    json: string,
    userEdited: boolean,
    initial: string
) {
    const storeActive = useContentStore((s) => s.activeItem);
    const setActiveItem = useContentStore((s) => s.setActiveItem);
    const ownValues = useRef<Set<string>>(new Set([initial]));

    useEffect(() => {
        if (!userEdited) return;
        if (!storeActive || storeActive.id !== slideId || !storeActive.document_slide) return;
        const current = storeActive.document_slide.data ?? '';
        if (current === json) return;
        if (!ownValues.current.has(current) && current !== '') return;
        ownValues.current.add(json);
        setActiveItem({
            ...storeActive,
            document_slide: { ...storeActive.document_slide, data: json },
        });
    }, [json, userEdited, slideId, storeActive, setActiveItem]);
}
