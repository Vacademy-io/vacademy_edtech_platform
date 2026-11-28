import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { GameController, UploadSimple } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import type { Slide } from '../../-hooks/use-slides';
import {
    GAME_LIMITS,
    gameReportsScore,
    parseGameData,
    serializeGameData,
    type GameSlideData,
} from './activity-types';
import { fetchGameScores } from './activity-api';
import { ALL_BATCHES, ActivityShell, BatchFilter } from './activity-shell';
import { storedActivityJson, useSyncActivityDraft } from './use-sync-activity-draft';

/**
 * The message a game posts to report its result (the HTML slide protocol). A string
 * constant because written inline its braces read as a hex colour to the design linter.
 */
const SCORE_SNIPPET = "parent.postMessage({ type: 'vacademy:complete', score, maxScore }, '*')";

/**
 * Game slide: the teacher's own HTML page, run sandboxed on the learner's device. The
 * page reports `vacademy:complete`; the server keeps each learner's best score, capped at
 * the top score set here.
 */
export function GameSlideEditor({ slide, isEditable }: { slide: Slide; isEditable: boolean }) {
    const { t } = useTranslation('slideActivity');
    const [initialJson] = useState(() =>
        isEditable
            ? storedActivityJson(slide)
            : slide.document_slide?.published_data || storedActivityJson(slide)
    );
    const [data, setData] = useState<GameSlideData>(() => parseGameData(initialJson));
    const [userEdited, setUserEdited] = useState(false);
    const json = useMemo(() => serializeGameData(data), [data]);
    useSyncActivityDraft(slide.id, json, userEdited, initialJson);
    const fileRef = useRef<HTMLInputElement>(null);

    const edit = (patch: Partial<GameSlideData>) => {
        setUserEdited(true);
        setData((d) => ({ ...d, ...patch }));
    };

    const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (file.size > GAME_LIMITS.maxBytes) {
            toast.error(t('game.tooBig'));
            return;
        }
        edit({ html: await file.text() });
    };

    const reports = data.html.trim() === '' || gameReportsScore(data.html);

    const setup = (
        <fieldset disabled={!isEditable} className="space-y-5">
            <div className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="game-html">{t('game.page')}</Label>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => fileRef.current?.click()}
                    >
                        <UploadSimple size={14} aria-hidden /> {t('game.upload')}
                    </MyButton>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".html,.htm,text/html"
                        className="hidden"
                        onChange={(e) => void onFile(e)}
                    />
                </div>
                <Textarea
                    id="game-html"
                    value={data.html}
                    rows={10}
                    spellCheck={false}
                    placeholder={t('game.pagePlaceholder')}
                    className="font-mono text-caption"
                    onChange={(e) => edit({ html: e.target.value })}
                />
                <p className="text-caption text-neutral-500">
                    {t('game.protocol')} <code className="break-all">{SCORE_SNIPPET}</code>
                </p>
                {!reports && <p className="text-caption text-warning-700">{t('game.noScore')}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor="game-max">{t('game.maxScore')}</Label>
                    <Input
                        id="game-max"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={GAME_LIMITS.maxScore}
                        value={data.maxScore ?? ''}
                        onChange={(e) => {
                            const n = Number(e.target.value);
                            edit({
                                maxScore:
                                    e.target.value === '' || !Number.isFinite(n) || n <= 0
                                        ? null
                                        : Math.min(GAME_LIMITS.maxScore, Math.round(n)),
                            });
                        }}
                    />
                    <p className="text-caption text-neutral-500">{t('game.maxScoreHint')}</p>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="game-instructions">{t('game.instructions')}</Label>
                    <Textarea
                        id="game-instructions"
                        value={data.instructions}
                        rows={3}
                        maxLength={GAME_LIMITS.instructionsMax}
                        placeholder={t('game.instructionsPlaceholder')}
                        onChange={(e) => edit({ instructions: e.target.value })}
                    />
                </div>
            </div>
            {data.html.trim() && (
                <div className="space-y-1.5">
                    <span className="text-sm font-medium text-neutral-900">
                        {t('game.preview')}
                    </span>
                    <iframe
                        title={t('game.preview')}
                        srcDoc={data.html}
                        // Same isolation learners get: scripts run, but with an opaque origin.
                        sandbox="allow-scripts"
                        className="h-96 w-full rounded-md border border-neutral-200 bg-white"
                    />
                </div>
            )}
        </fieldset>
    );

    return (
        <ActivityShell
            slideId={slide.id}
            icon={<GameController size={20} weight="duotone" aria-hidden />}
            title={t('game.title')}
            json={json}
            userEdited={userEdited}
            isEditable={isEditable}
            setup={setup}
            results={<GameScoresPanel slideId={slide.id} />}
            resultsLabel={t('tabs.scores')}
        />
    );
}

function GameScoresPanel({ slideId }: { slideId: string }) {
    const { t, i18n } = useTranslation('slideActivity');
    const [batch, setBatch] = useState(ALL_BATCHES);
    const query = useQuery({
        queryKey: ['slide-game-scores', slideId, batch],
        queryFn: () => fetchGameScores(slideId, batch === ALL_BATCHES ? undefined : batch),
        staleTime: 15_000,
    });
    if (query.isPending)
        return <p className="text-body text-neutral-500">{t('results.loading')}</p>;
    if (query.isError) return <p className="text-body text-danger-600">{t('results.error')}</p>;
    const { rows, batches } = query.data;
    const fmt = (n: number | null) =>
        n == null
            ? '—'
            : n.toLocaleString(i18n.resolvedLanguage || 'en', { maximumFractionDigits: 1 });
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body text-neutral-700">
                    {t('results.players', { count: rows.length })}
                </p>
                <BatchFilter batches={batches} value={batch} onChange={setBatch} />
            </div>
            {rows.length > 0 && (
                <ol className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
                    {rows.map((r, i) => (
                        <li key={r.userId} className="flex items-center gap-3 p-3 text-body">
                            <span className="w-6 shrink-0 text-end tabular-nums text-neutral-500">
                                {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-neutral-900">
                                {r.name || t('results.learner')}
                            </span>
                            <span className="shrink-0 tabular-nums text-neutral-900">
                                {r.maxScore
                                    ? t('results.scoreOf', {
                                          score: fmt(r.bestScore),
                                          max: fmt(r.maxScore),
                                      })
                                    : fmt(r.bestScore)}
                            </span>
                            <span className="hidden shrink-0 text-caption text-neutral-500 sm:inline">
                                {t('results.attempts', { count: r.attempts })}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
