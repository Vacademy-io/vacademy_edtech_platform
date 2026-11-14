import { useState, useMemo, useEffect } from 'react';
import { Search, Network } from 'lucide-react';
import type { MappingRow } from '../-types/product-page-types';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface SuggestionsPanelProps {
    mappingRows: MappingRow[];
    suggestions: Record<string, string[]>;
    onUpdateSuggestions: (s: Record<string, string[]>) => void;
    getRowLabel: (row: MappingRow) => string;
}

export const SuggestionsPanel = ({
    mappingRows,
    suggestions,
    onUpdateSuggestions,
    getRowLabel,
}: SuggestionsPanelProps) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const courseLower = getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase();
    const coursesLower = getTerminologyPlural(
        ContentTerms.Course,
        SystemTerms.Course
    ).toLocaleLowerCase();
    const [leftSearch, setLeftSearch] = useState('');
    const [rightSearch, setRightSearch] = useState('');

    const readyRows = useMemo(
        () => mappingRows.filter((r) => !!r.psInvitePaymentOptionId),
        [mappingRows]
    );

    useEffect(() => {
        if (selectedId && !readyRows.some((r) => r.psInvitePaymentOptionId === selectedId)) {
            setSelectedId(null);
        }
    }, [readyRows, selectedId]);

    const filteredLeft = useMemo(() => {
        const q = leftSearch.toLowerCase();
        return q
            ? readyRows.filter((r) => getRowLabel(r).toLowerCase().includes(q))
            : readyRows;
    }, [readyRows, leftSearch, getRowLabel]);

    const selectedRow = useMemo(
        () => selectedId ? readyRows.find((r) => r.psInvitePaymentOptionId === selectedId) : undefined,
        [selectedId, readyRows]
    );
    const currentSuggestions = useMemo(
        () => (selectedId ? (suggestions[selectedId] ?? []) : []) as string[],
        [selectedId, suggestions]
    );

    const otherRows = useMemo(() => {
        if (!selectedId) return [];
        const q = rightSearch.toLowerCase();
        const others = readyRows.filter((r) => r.psInvitePaymentOptionId !== selectedId);
        return q ? others.filter((r) => getRowLabel(r).toLowerCase().includes(q)) : others;
    }, [readyRows, selectedId, rightSearch, getRowLabel]);

    const allVisibleSelected = useMemo(
        () => otherRows.length > 0 && otherRows.every((r) => currentSuggestions.includes(r.psInvitePaymentOptionId)),
        [otherRows, currentSuggestions]
    );

    const toggleAll = () => {
        if (!selectedId) return;
        const next = { ...suggestions };
        if (allVisibleSelected) {
            // Deselect all visible
            const idsToRemove = new Set(otherRows.map((r) => r.psInvitePaymentOptionId));
            next[selectedId] = (next[selectedId] ?? []).filter((id) => !idsToRemove.has(id));
            for (const id of idsToRemove) {
                next[id] = (next[id] ?? []).filter((sid) => sid !== selectedId);
            }
        } else {
            // Select all visible
            const idsToAdd = otherRows
                .map((r) => r.psInvitePaymentOptionId)
                .filter((id) => !currentSuggestions.includes(id));
            next[selectedId] = [...(next[selectedId] ?? []), ...idsToAdd];
            for (const id of idsToAdd) {
                if (!(next[id] ?? []).includes(selectedId)) {
                    next[id] = [...(next[id] ?? []), selectedId];
                }
            }
        }
        onUpdateSuggestions(next);
    };

    const toggle = (targetId: string) => {
        if (!selectedId) return;
        const isChecked = currentSuggestions.includes(targetId);
        const next = { ...suggestions };

        // A → B
        next[selectedId] = isChecked
            ? (next[selectedId] ?? []).filter((id) => id !== targetId)
            : [...(next[selectedId] ?? []), targetId];

        // B → A (bidirectional mirror)
        next[targetId] = isChecked
            ? (next[targetId] ?? []).filter((id) => id !== selectedId)
            : [...(next[targetId] ?? []), selectedId];

        onUpdateSuggestions(next);
    };

    const coursesWithSuggestions = useMemo(
        () => readyRows.filter((r) => (suggestions[r.psInvitePaymentOptionId] ?? []).length > 0).length,
        [readyRows, suggestions]
    );

    if (readyRows.length < 2) {
        return (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-white p-10 text-center">
                <Network className="size-8 text-neutral-300" />
                <div>
                    <p className="text-sm font-medium text-neutral-500">
                        Add at least 2 {coursesLower} to configure suggestions.
                    </p>
                    <p className="mt-1 text-xs text-neutral-400">
                        Suggestions let learners discover related {coursesLower} in their cart.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="grid min-h-[420px] grid-cols-2 divide-x divide-neutral-100">

                {/* ── Left: course list ────────────────────────────────── */}
                <div className="flex flex-col">
                    <div className="border-b border-neutral-100 px-4 py-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                            When this {courseLower} is in cart…
                        </p>
                        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5">
                            <Search className="size-3.5 shrink-0 text-neutral-400" />
                            <input
                                type="text"
                                placeholder={`Filter ${coursesLower}…`}
                                value={leftSearch}
                                onChange={(e) => setLeftSearch(e.target.value)}
                                className="flex-1 bg-transparent text-xs outline-none placeholder:text-neutral-400"
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {filteredLeft.map((row) => {
                            const id = row.psInvitePaymentOptionId;
                            const count = (suggestions[id] ?? []).length;
                            const isSelected = selectedId === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => { setSelectedId(id); setRightSearch(''); }}
                                    className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                                        isSelected ? 'bg-primary-50' : 'hover:bg-neutral-50'
                                    }`}
                                >
                                    <span className={`truncate text-sm font-medium ${isSelected ? 'text-primary-700' : 'text-neutral-700'}`}>
                                        {getRowLabel(row)}
                                    </span>
                                    {count > 0 && (
                                        <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                            isSelected
                                                ? 'bg-primary-200 text-primary-700'
                                                : 'bg-neutral-100 text-neutral-500'
                                        }`}>
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                        {filteredLeft.length === 0 && leftSearch && (
                            <p className="py-8 text-center text-xs text-neutral-400">
                                No {coursesLower} match "{leftSearch}"
                            </p>
                        )}
                    </div>

                    <div className="border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-400">
                        {readyRows.length} {coursesLower} · {coursesWithSuggestions} with
                        suggestions
                    </div>
                </div>

                {/* ── Right: suggestion checklist ──────────────────────── */}
                <div className="flex flex-col">
                    {selectedRow ? (
                        <>
                            <div className="border-b border-neutral-100 px-4 py-3">
                                <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                                    …suggest these {coursesLower}
                                </p>
                                <p className="mb-2 truncate text-sm font-semibold text-neutral-800">
                                    {getRowLabel(selectedRow)}
                                </p>
                                <div className="flex items-center gap-2">
                                    <div className="flex flex-1 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5">
                                        <Search className="size-3.5 shrink-0 text-neutral-400" />
                                        <input
                                            type="text"
                                            placeholder={`Search ${coursesLower}…`}
                                            value={rightSearch}
                                            onChange={(e) => setRightSearch(e.target.value)}
                                            className="flex-1 bg-transparent text-xs outline-none placeholder:text-neutral-400"
                                        />
                                    </div>
                                    {otherRows.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={toggleAll}
                                            className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                                allVisibleSelected
                                                    ? 'border-primary-300 bg-primary-50 text-primary-600 hover:bg-primary-100'
                                                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600'
                                            }`}
                                        >
                                            {allVisibleSelected ? 'Deselect all' : 'Select all'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto">
                                {otherRows.map((row) => {
                                    const id = row.psInvitePaymentOptionId;
                                    const isChecked = currentSuggestions.includes(id);
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => toggle(id)}
                                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
                                        >
                                            <span className={`flex size-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                                                isChecked
                                                    ? 'border-primary-500 bg-primary-500'
                                                    : 'border-neutral-300 bg-white'
                                            }`}>
                                                {isChecked && (
                                                    <svg viewBox="0 0 10 8" className="size-2.5">
                                                        <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                                    </svg>
                                                )}
                                            </span>
                                            <span className={`truncate text-sm ${isChecked ? 'font-medium text-neutral-800' : 'text-neutral-600'}`}>
                                                {getRowLabel(row)}
                                            </span>
                                        </button>
                                    );
                                })}
                                {otherRows.length === 0 && rightSearch && (
                                    <p className="py-8 text-center text-xs text-neutral-400">
                                        No {coursesLower} match "{rightSearch}"
                                    </p>
                                )}
                            </div>

                            <div className="border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-400">
                                {currentSuggestions.length} of {readyRows.length - 1} {coursesLower}{' '}
                                selected
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-1 items-center justify-center p-8 text-center">
                            <div>
                                <p className="text-sm font-medium text-neutral-400">
                                    ← Pick a {courseLower}
                                </p>
                                <p className="mt-1 text-xs text-neutral-300">
                                    to configure which {coursesLower} appear alongside it in the
                                    cart
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
