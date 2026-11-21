import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChatsCircle } from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Slide } from '../../-hooks/use-slides';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { DISCUSSION_THREAD_KEY, fetchDiscussionThread } from './discussion-api';
import { DiscussionSettingsPanel } from './discussion-settings-panel';
import { ALL_BATCHES, DiscussionResponsesPanel } from './discussion-responses-panel';
import {
    isSamePromptHtml,
    parseDiscussionData,
    serializeDiscussionData,
    type DiscussionSettings,
    type DiscussionSlideData,
} from './discussion-types';

/** Draft JSON for a discussion slide: the draft column, falling back to the live copy. */
function storedJson(slide: Slide | null | undefined): string {
    return slide?.document_slide?.data || slide?.document_slide?.published_data || '';
}

/**
 * Keeps the editor's latest JSON in `activeItem.document_slide.data`, which is what the
 * slide header's Save Draft (SaveDraft → add-update-document-slide, status DRAFT/UNSYNC)
 * and Publish (handlePublishSlide → data + published_data) send to the server.
 *
 * A slides refetch (window focus, another mutation) replaces activeItem with the server
 * copy; when the store holds a value this editor wrote or started from, the local edits
 * are put back so a later save never sends stale settings. Any other value (a version
 * history restore) is left alone — the restore remounts this editor with it.
 */
function useSyncDraftToActiveSlide(
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

export function DiscussionSlideEditor({
    slide,
    isEditable,
}: {
    slide: Slide;
    isEditable: boolean;
}) {
    const slideId = slide.id;
    // Learner preview shows what learners get: the published copy.
    const [initialJson] = useState(() =>
        isEditable ? storedJson(slide) : slide.document_slide?.published_data || storedJson(slide)
    );
    const [data, setData] = useState<DiscussionSlideData>(() => parseDiscussionData(initialJson));
    const [userEdited, setUserEdited] = useState(false);
    const [tab, setTab] = useState<'setup' | 'responses'>('setup');
    const [batchFilter, setBatchFilter] = useState<string>(ALL_BATCHES);

    const json = useMemo(() => serializeDiscussionData(data), [data]);
    useSyncDraftToActiveSlide(slideId, json, userEdited, initialJson);

    const status = useContentStore((s) =>
        s.activeItem?.id === slideId ? s.activeItem.status : slide.status
    );
    const persistedJson = useContentStore((s) => storedJson(s.items.find((i) => i.id === slideId)));
    const hasUnsavedChanges = userEdited && persistedJson !== json;

    const threadQuery = useQuery({
        queryKey: [DISCUSSION_THREAD_KEY, slideId, batchFilter],
        queryFn: () =>
            fetchDiscussionThread(slideId, batchFilter === ALL_BATCHES ? undefined : batchFilter),
        enabled: isEditable && !!slideId,
        staleTime: 15_000,
    });

    const promptRef = useRef(data.prompt_html);
    promptRef.current = data.prompt_html;

    const handlePromptChange = useCallback((html: string) => {
        // TipTap reports an empty doc as '<p></p>' on mount; that is not an edit.
        if (isSamePromptHtml(promptRef.current, html)) return;
        setUserEdited(true);
        setData((prev) => ({ ...prev, prompt_html: html }));
    }, []);

    const handleSettingsChange = useCallback((patch: Partial<DiscussionSettings>) => {
        setUserEdited(true);
        setData((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
    }, []);

    const statusHint = hasUnsavedChanges
        ? { tone: 'warning', text: 'Unsaved changes — use Save Draft or Publish above.' }
        : status === 'PUBLISHED'
          ? { tone: 'success', text: 'Live for learners.' }
          : status === 'UNSYNC'
            ? { tone: 'warning', text: 'Saved changes are not live yet — Publish to share them.' }
            : {
                  tone: 'neutral',
                  text: 'Draft — learners can’t see this discussion until you publish.',
              };

    const responseCount = threadQuery.data?.stats?.responses;

    return (
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-full bg-primary-50">
                        <ChatsCircle className="size-5 text-primary-500" weight="duotone" />
                    </span>
                    <div className="flex flex-col">
                        <span className="text-subtitle font-semibold text-neutral-700">
                            Discussion
                        </span>
                        <span
                            className={cn(
                                'text-caption',
                                statusHint.tone === 'warning' && 'text-warning-600',
                                statusHint.tone === 'success' && 'text-success-600',
                                statusHint.tone === 'neutral' && 'text-neutral-500'
                            )}
                        >
                            {statusHint.text}
                        </span>
                    </div>
                </div>
            </div>

            {isEditable ? (
                <Tabs value={tab} onValueChange={(v) => setTab(v as 'setup' | 'responses')}>
                    <TabsList>
                        <TabsTrigger value="setup">Question &amp; settings</TabsTrigger>
                        <TabsTrigger value="responses">
                            Responses{responseCount !== undefined ? ` (${responseCount})` : ''}
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="setup" className="mt-4">
                        <DiscussionSettingsPanel
                            data={data}
                            isEditable
                            onPromptChange={handlePromptChange}
                            onSettingsChange={handleSettingsChange}
                        />
                    </TabsContent>
                    <TabsContent value="responses" className="mt-4">
                        <DiscussionResponsesPanel
                            slideId={slideId}
                            threadQuery={threadQuery}
                            batchFilter={batchFilter}
                            onBatchFilterChange={setBatchFilter}
                        />
                    </TabsContent>
                </Tabs>
            ) : (
                <DiscussionSettingsPanel
                    data={data}
                    isEditable={false}
                    onPromptChange={handlePromptChange}
                    onSettingsChange={handleSettingsChange}
                />
            )}
        </div>
    );
}
