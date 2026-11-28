/**
 * Renders scan candidates with multi-select + a sticky bottom action bar.
 *
 * Slice 2 ships only Gate 1 (scoring). Selecting candidates + clicking
 * "Preview" is wired to a prop callback — slice 3 will hang the
 * PreviewTray drawer off it.
 */
import { useState } from 'react';
import { ChevronLeft, Sparkles } from 'lucide-react';
import { VimotionLoader } from '../../brand/VimotionLoader';
import { cn } from '@/lib/utils';
import type { ReelCandidate } from '../services/reels-api';
import { ReelCandidateCard } from './ReelCandidateCard';

interface ScanResultsGridProps {
    candidates: ReelCandidate[];
    /** Playable URL of the source video — enables click-to-play segment
     *  previews on every card. Null while the asset record loads. */
    sourceVideoUrl: string | null;
    /** Called when the user clicks "Preview selected". Slice 3 wires this
     *  to the PreviewTray. For slice 2 we just toast. */
    onPreview: (candidateIds: string[]) => void;
    /** Optional back-to-asset-picker handler. Hidden when not provided
     *  (e.g. when the user deep-linked from AssetDetailPanel). */
    onBack?: () => void;
    /** Disabled state for the Preview button — e.g. while a follow-up
     *  request is in flight. */
    busy?: boolean;
}

// Cap how many we can preview at once. Server schema enforces max 10
// (PreviewRequest.candidate_ids: list[str], max_length=10), so mirror it
// here as UX guidance rather than letting the server reject the POST.
const MAX_SELECTION = 10;

export function ScanResultsGrid({
    candidates,
    sourceVideoUrl,
    onPreview,
    onBack,
    busy = false,
}: ScanResultsGridProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const toggle = (id: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else if (next.size < MAX_SELECTION) {
                next.add(id);
            }
            return next;
        });
    };

    const selectAll = () => {
        setSelectedIds(new Set(candidates.slice(0, MAX_SELECTION).map((c) => c.candidate_id)));
    };
    const clearAll = () => setSelectedIds(new Set());

    const selectedCount = selectedIds.size;
    const atLimit = selectedCount >= MAX_SELECTION;

    if (candidates.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center">
                <Sparkles className="mx-auto size-8 text-neutral-400" />
                <h2 className="mt-4 text-base font-semibold text-neutral-900">
                    No usable clips found
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
                    We couldn’t find strong moments at these settings. Try a longer
                    target duration, different topic keywords, or another source video.
                </p>
                {onBack && (
                    <button
                        type="button"
                        onClick={onBack}
                        className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-200 px-3 text-sm font-medium hover:bg-neutral-50"
                    >
                        <ChevronLeft className="size-4" />
                        Pick a different video
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-5 pb-24">
            {/* Header: back link + count + select-all/clear */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            className="inline-flex items-center gap-1 rounded-md p-1 text-sm text-neutral-600 hover:bg-neutral-100"
                        >
                            <ChevronLeft className="size-4" />
                            Change source
                        </button>
                    )}
                    <div>
                        <h2 className="text-base font-semibold text-neutral-900">
                            {candidates.length} candidate{candidates.length === 1 ? '' : 's'}
                        </h2>
                        <p className="text-xs text-neutral-500">
                            Pick up to {MAX_SELECTION} to preview. We’ll show what gets cut
                            before you render.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                    <button
                        type="button"
                        onClick={selectAll}
                        className="rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-100"
                    >
                        Select top {Math.min(MAX_SELECTION, candidates.length)}
                    </button>
                    <button
                        type="button"
                        onClick={clearAll}
                        disabled={selectedCount === 0}
                        className="rounded-md px-2 py-1 text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Clear
                    </button>
                </div>
            </div>

            {/* Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {candidates.map((c) => (
                    <ReelCandidateCard
                        key={c.candidate_id}
                        candidate={c}
                        sourceVideoUrl={sourceVideoUrl}
                        selected={selectedIds.has(c.candidate_id)}
                        onToggle={() => toggle(c.candidate_id)}
                    />
                ))}
            </div>

            {/* Sticky action bar — only when selection is non-empty */}
            {selectedCount > 0 && (
                <div data-assistant-fab="avoid-phone" className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-6 pb-6">
                    <div className="pointer-events-auto flex items-center gap-4 rounded-2xl border border-neutral-200 bg-white px-5 py-3 shadow-xl">
                        <div className="text-sm">
                            <p className="font-medium text-neutral-900">
                                {selectedCount} selected
                                {atLimit && (
                                    <span className="ml-2 text-xs font-normal text-amber-600">
                                        Max {MAX_SELECTION}
                                    </span>
                                )}
                            </p>
                            <p className="text-xs text-neutral-500">
                                Preview shows the cut plan before you commit a render
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => onPreview(Array.from(selectedIds))}
                            disabled={busy || selectedCount === 0}
                            className={cn(
                                'inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium text-white shadow-sm transition-colors',
                                busy
                                    ? 'cursor-not-allowed bg-neutral-400'
                                    : 'bg-neutral-900 hover:bg-neutral-800'
                            )}
                        >
                            {busy ? <VimotionLoader size={16} className="text-white" /> : null}
                            Preview selected
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
