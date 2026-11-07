import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Check,
    Sparkle,
    Image as ImageIcon,
    PlayCircle,
    MagnifyingGlass,
    UploadSimple,
    CircleNotch,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import {
    searchStock,
    type DecisionAnswer,
    type DecisionRequest,
    type VisualCastingCandidate,
    type VisualCastingGroup,
} from '../../../-services/video-generation';

interface VisualCastingDecisionProps {
    decision: DecisionRequest;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
    apiKey?: string;
}

/**
 * Visual-casting gate — one candidate grid per media query. Per shot the user
 * can: pick a stock candidate, re-search stock with their own terms, upload
 * their own image, or let the AI generate it (null pick). Selections are keyed
 * by the query string (the backend forcing key); a null pick = "AI generates".
 */
export function VisualCastingDecision({ decision, isSubmitting, onSubmit, apiKey }: VisualCastingDecisionProps) {
    const { t } = useTranslation('videoApiStudioVisualCastingDecision');
    const groups: VisualCastingGroup[] = useMemo(() => {
        if (decision.payload?.groups?.length) return decision.payload.groups;
        if (decision.payload?.candidates?.length) {
            return [
                {
                    query: decision.payload.query ?? '',
                    kind: 'image',
                    shot_index: decision.shot_index ?? undefined,
                    candidates: decision.payload.candidates,
                    recommended_candidate_id: decision.payload.recommended_candidate_id,
                },
            ];
        }
        return [];
    }, [decision]);

    // Mutable per-query candidate lists (replaced by search, appended by upload).
    const [cands, setCands] = useState<Record<string, VisualCastingCandidate[]>>(() => {
        const m: Record<string, VisualCastingCandidate[]> = {};
        for (const g of groups) m[g.query] = g.candidates;
        return m;
    });
    // Per-query selected candidate_id (null = let AI generate).
    const [picks, setPicks] = useState<Record<string, string | null>>(() => {
        const m: Record<string, string | null> = {};
        for (const g of groups) m[g.query] = g.recommended_candidate_id ?? null;
        return m;
    });
    const [terms, setTerms] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState<Record<string, boolean>>({});
    const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
    const { uploadFile, getPublicUrl } = useFileUpload();

    const setBusyFor = (q: string, v: boolean) => setBusy((p) => ({ ...p, [q]: v }));

    const runSearch = async (g: VisualCastingGroup) => {
        const term = (terms[g.query] ?? '').trim();
        if (!term || !apiKey) return;
        setBusyFor(g.query, true);
        const results = await searchStock(g.kind, term, apiKey);
        setBusyFor(g.query, false);
        if (results.length === 0) {
            toast.info(t('toast.noResults'));
            return;
        }
        setCands((p) => ({ ...p, [g.query]: results }));
    };

    const runUpload = async (g: VisualCastingGroup, file: File) => {
        setBusyFor(g.query, true);
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: getUserId(),
                source: 'AI_INPUT_IMAGE',
                sourceId: 'ADMIN',
                publicUrl: true,
            });
            const url = fileId ? await getPublicUrl(fileId) : null;
            if (!url) throw new Error('Upload failed');
            const cand: VisualCastingCandidate = {
                candidate_id: `upload:${url}`,
                kind: 'image',
                url,
                thumb: url,
                provider: 'upload',
                is_recommended: false,
            };
            setCands((p) => ({ ...p, [g.query]: [cand, ...(p[g.query] ?? [])] }));
            setPicks((p) => ({ ...p, [g.query]: cand.candidate_id }));
        } catch {
            toast.error(t('toast.uploadFailed'));
        } finally {
            setBusyFor(g.query, false);
        }
    };

    const apply = () => {
        const selections = groups.map((g) => {
            const cid = picks[g.query] ?? null;
            const url = cid ? (cands[g.query] ?? []).find((c) => c.candidate_id === cid)?.url : undefined;
            return { query: g.query, candidate_id: cid, url, shot_index: g.shot_index };
        });
        onSubmit({ kind: 'edit', gate_type: 'visual_casting', selections });
    };

    if (groups.length === 0) {
        return (
            <div className="rounded-xl border bg-white p-6 text-center text-sm text-muted-foreground shadow-sm dark:bg-card">
                {t('empty.noCandidates')}
                <div className="mt-3">
                    <Button size="sm" disabled={isSubmitting} onClick={() => onSubmit({ kind: 'auto' })}>
                        {t('empty.continue')}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-foreground">
                <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                    <ImageIcon className="size-4 text-violet-600" />
                </span>
                {t('header.title', { count: groups.length })}
            </div>

            <div className="max-h-96 space-y-5 overflow-y-auto p-3">
                {groups.map((g, gi) => {
                    const list = cands[g.query] ?? [];
                    const isBusy = !!busy[g.query];
                    const aiPicked = picks[g.query] == null;
                    return (
                        <div key={`${g.query}-${gi}`} className="space-y-2">
                            <div className="flex items-center gap-2 px-1 text-xs">
                                <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                                    {(g.shot_index ?? gi) + 1}
                                </span>
                                <span className="truncate text-muted-foreground">
                                    {g.query || t('shot.queryFallback')}
                                </span>
                                <button
                                    type="button"
                                    disabled={isSubmitting}
                                    onClick={() => setPicks((p) => ({ ...p, [g.query]: null }))}
                                    className={cn(
                                        'ml-auto flex items-center gap-1 rounded px-1.5 py-0.5',
                                        aiPicked
                                            ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30'
                                            : 'text-muted-foreground hover:text-foreground'
                                    )}
                                >
                                    <Sparkle className="size-3" />
                                    {t('shot.generateWithAi')}
                                </button>
                            </div>

                            {/* Search + upload controls */}
                            <div className="flex items-center gap-2 px-1">
                                <div className="relative flex-1">
                                    <MagnifyingGlass className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        value={terms[g.query] ?? ''}
                                        disabled={isSubmitting || isBusy}
                                        onChange={(e) =>
                                            setTerms((p) => ({ ...p, [g.query]: e.target.value }))
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                void runSearch(g);
                                            }
                                        }}
                                        placeholder={
                                            g.kind === 'video'
                                                ? t('shot.searchPlaceholderClips')
                                                : t('shot.searchPlaceholderPhotos')
                                        }
                                        className="h-8 pl-7 text-xs"
                                    />
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={isSubmitting || isBusy || !(terms[g.query] ?? '').trim()}
                                    onClick={() => void runSearch(g)}
                                    className="h-8 gap-1"
                                >
                                    {isBusy ? (
                                        <CircleNotch className="size-3.5 animate-spin" />
                                    ) : (
                                        t('shot.search')
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={isSubmitting || isBusy}
                                    onClick={() => fileInputs.current[g.query]?.click()}
                                    className="h-8 gap-1"
                                >
                                    <UploadSimple className="size-3.5" />
                                    {t('shot.upload')}
                                </Button>
                                <input
                                    ref={(el) => {
                                        fileInputs.current[g.query] = el;
                                    }}
                                    type="file"
                                    accept="image/*"
                                    hidden
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) void runUpload(g, f);
                                        e.target.value = '';
                                    }}
                                />
                            </div>

                            {list.length === 0 ? (
                                <div className="px-1 text-xs text-muted-foreground">
                                    {t('shot.noCandidates')}
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                                    {list.map((c) => {
                                        const isSel = picks[g.query] === c.candidate_id;
                                        return (
                                            <button
                                                key={c.candidate_id}
                                                type="button"
                                                disabled={isSubmitting}
                                                onClick={() =>
                                                    setPicks((p) => ({ ...p, [g.query]: c.candidate_id }))
                                                }
                                                className={cn(
                                                    'group relative aspect-video overflow-hidden rounded-lg border-2 bg-muted transition-colors',
                                                    isSel
                                                        ? 'border-violet-500 ring-2 ring-violet-500/30'
                                                        : 'border-transparent hover:border-border'
                                                )}
                                            >
                                                <img
                                                    src={c.thumb || c.url}
                                                    alt={c.alt ?? ''}
                                                    className="size-full object-cover"
                                                    loading="lazy"
                                                />
                                                {c.kind === 'video' && (
                                                    <PlayCircle className="absolute bottom-1 right-1 size-4 text-white drop-shadow" />
                                                )}
                                                {c.provider === 'upload' && (
                                                    <span className="absolute left-1 top-1 rounded bg-emerald-600 px-1 py-0.5 text-xs font-semibold text-white">
                                                        {t('shot.yours')}
                                                    </span>
                                                )}
                                                {isSel && (
                                                    <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-violet-600 text-white">
                                                        <Check className="size-2.5" />
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => onSubmit({ kind: 'auto_all' })}
                    className="gap-1.5 text-muted-foreground"
                >
                    <Sparkle className="size-3.5" />
                    {t('footer.letAiDoAll')}
                </Button>
                <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={apply}
                    className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                >
                    <Check className="size-4" />
                    {t('footer.useThese')}
                </Button>
            </div>
        </div>
    );
}
