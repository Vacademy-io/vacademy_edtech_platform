// Bulk Content Uploading — step 3: live commit progress.
//
// Keeps the machine awake (Screen Wake Lock) and warns before tab close while
// the run is in flight — a closed tab mid-run leaves partial (but resumable) state.

import { useEffect, useMemo } from 'react';
import { CheckCircle, CircleNotch, MinusCircle, Warning, XCircle } from '@phosphor-icons/react';
import { Progress } from '@/components/ui/progress';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    groupItemsByChapter,
    selectProgress,
    selectSectionsOrdered,
    useBulkContentUploadingStore,
} from '../use-bulk-content-uploading-store';
import type { BulkItem, BulkNode, ItemStatus } from '../types';

const statusBadge = (item: BulkItem) => {
    const status: ItemStatus = item.status;
    switch (status) {
        case 'preparing':
        case 'uploading':
        case 'creating':
            return (
                <span className="flex items-center gap-1 text-caption text-primary-500">
                    <CircleNotch className="size-3.5 animate-spin" />
                    {status === 'preparing'
                        ? 'Preparing…'
                        : status === 'uploading'
                          ? 'Uploading…'
                          : 'Creating slide…'}
                </span>
            );
        case 'done':
            return (
                <span className="flex items-center gap-1 text-caption text-success-600">
                    <CheckCircle className="size-3.5" />
                    Done
                </span>
            );
        case 'failed':
            return (
                <span className="flex items-center gap-1 text-caption text-danger-600">
                    <XCircle className="size-3.5" />
                    {item.error ? `Failed: ${item.error}` : 'Failed'}
                </span>
            );
        case 'blocked':
            return (
                <span className="flex items-center gap-1 text-caption text-danger-600">
                    <Warning className="size-3.5" />
                    Blocked
                </span>
            );
        case 'skipped':
            return (
                <span className="flex items-center gap-1 text-caption text-neutral-400">
                    <MinusCircle className="size-3.5" />
                    Skipped
                </span>
            );
        default:
            return <span className="text-caption text-neutral-400">Waiting…</span>;
    }
};

export const ProgressStep = () => {
    const items = useBulkContentUploadingStore((state) => state.items);
    const nodes = useBulkContentUploadingStore((state) => state.nodes);
    const mode = useBulkContentUploadingStore((state) => state.mode);
    const courseSections = useBulkContentUploadingStore((state) => state.courseSections);

    const progress = useMemo(() => selectProgress(items), [items]);
    const itemsByChapter = useMemo(() => groupItemsByChapter(items), [items]);
    const percent =
        progress.total === 0
            ? 0
            : Math.round(((progress.done + progress.failed) / progress.total) * 100);

    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        let wakeLock: { release: () => Promise<void> } | null = null;
        const requestWakeLock = async () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                wakeLock = await (navigator as any).wakeLock?.request?.('screen');
            } catch {
                // not supported / denied — upload still works, laptop may sleep
            }
        };
        void requestWakeLock();

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            void wakeLock?.release().catch(() => undefined);
        };
    }, []);

    return (
        <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-subtitle text-warning-700">
                Upload in progress — keep this tab open until it finishes.
            </div>

            <div className="flex items-center gap-3">
                <Progress value={percent} className="h-2 flex-1" />
                <span className="whitespace-nowrap text-subtitle font-medium text-neutral-700">
                    {progress.done + progress.failed}/{progress.total}
                </span>
                {progress.failed > 0 && (
                    <span className="text-caption text-danger-600">{progress.failed} failed</span>
                )}
            </div>

            <div className="max-h-96 overflow-y-auto rounded-lg border border-neutral-200 bg-white">
                {mode === 'multi'
                    ? selectSectionsOrdered(courseSections).map((section) => {
                          const sectionEntries = [...itemsByChapter.entries()].filter(
                              ([chapterNodeId]) => nodes[chapterNodeId]?.sectionId === section.id
                          );
                          if (sectionEntries.length === 0) return null;
                          return (
                              <div key={section.id}>
                                  <div className="border-b border-primary-100 bg-primary-50 px-4 py-2 text-caption font-semibold text-primary-500">
                                      {section.courseName ?? section.topFolderDisplay}
                                  </div>
                                  {renderChapterGroups(sectionEntries, nodes, items)}
                              </div>
                          );
                      })
                    : renderChapterGroups([...itemsByChapter.entries()], nodes, items)}
            </div>
        </div>
    );
};

function renderChapterGroups(
    entries: [string, BulkItem[]][],
    nodes: Record<string, BulkNode>,
    items: Record<string, BulkItem>
) {
    return entries.map(([chapterNodeId, chapterItems]) => {
        const chapterNode = nodes[chapterNodeId];
        return (
            <div key={chapterNodeId} className="border-b border-neutral-100 last:border-b-0">
                <div className="flex items-center gap-2 bg-neutral-50 px-4 py-2 text-caption font-semibold text-neutral-600">
                    {chapterNode?.displayName ??
                        getTerminology(ContentTerms.Chapter, SystemTerms.Chapter)}
                    {chapterNode?.status === 'creating' && (
                        <span className="flex items-center gap-1 font-normal text-primary-500">
                            <CircleNotch className="size-3.5 animate-spin" />
                            Creating…
                        </span>
                    )}
                    {chapterNode?.status === 'failed' && (
                        <span className="flex items-center gap-1 font-normal text-danger-600">
                            <XCircle className="size-3.5" />
                            {chapterNode.error ?? 'Could not be created'}
                        </span>
                    )}
                </div>
                <ul className="divide-y divide-neutral-100">
                    {chapterItems.map((item) => (
                        <li
                            key={item.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
                        >
                            <span className="truncate text-subtitle text-neutral-700">
                                {item.title}
                            </span>
                            {statusBadge(items[item.id] ?? item)}
                        </li>
                    ))}
                </ul>
            </div>
        );
    });
}
