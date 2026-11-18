import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChartBar, Plus, Trash } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { MyButton } from '@/components/design-system/button';
import type { Slide } from '../../-hooks/use-slides';
import {
    POLL_LIMITS,
    newPollOptionId,
    parsePollData,
    pollProblems,
    serializePollData,
    type PollResultsVisibility,
    type PollSlideData,
} from './activity-types';
import { fetchPollResults } from './activity-api';
import { ALL_BATCHES, ActivityShell, BatchFilter } from './activity-shell';
import { storedActivityJson, useSyncActivityDraft } from './use-sync-activity-draft';

const RESULTS: PollResultsVisibility[] = ['AFTER_VOTE', 'ALWAYS', 'TEACHER_ONLY'];

/** Poll slide: one question, 2–8 options, who sees the results, whether a vote can change. */
export function PollSlideEditor({ slide, isEditable }: { slide: Slide; isEditable: boolean }) {
    const { t } = useTranslation('slideActivity');
    const [initialJson] = useState(() =>
        isEditable
            ? storedActivityJson(slide)
            : slide.document_slide?.published_data || storedActivityJson(slide)
    );
    const [data, setData] = useState<PollSlideData>(() => parsePollData(initialJson));
    const [userEdited, setUserEdited] = useState(false);
    const json = useMemo(() => serializePollData(data), [data]);
    useSyncActivityDraft(slide.id, json, userEdited, initialJson);

    const edit = (patch: (d: PollSlideData) => PollSlideData) => {
        setUserEdited(true);
        setData(patch);
    };
    const problems = pollProblems(data);

    const setup = (
        <fieldset disabled={!isEditable} className="space-y-5">
            <div className="space-y-1.5">
                <Label htmlFor="poll-question">{t('poll.question')}</Label>
                <Textarea
                    id="poll-question"
                    value={data.question}
                    maxLength={POLL_LIMITS.questionMax}
                    rows={3}
                    placeholder={t('poll.questionPlaceholder')}
                    onChange={(e) => {
                        const question = e.target.value;
                        edit((d) => ({ ...d, question }));
                    }}
                />
            </div>
            <div className="space-y-2">
                <span className="text-sm font-medium text-neutral-900">{t('poll.options')}</span>
                <ol className="space-y-2">
                    {data.options.map((option, index) => (
                        <li key={option.id} className="flex items-center gap-2">
                            <span
                                aria-hidden
                                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-caption font-semibold text-neutral-600"
                            >
                                {String.fromCharCode(65 + index)}
                            </span>
                            <Input
                                value={option.text}
                                maxLength={POLL_LIMITS.optionMax}
                                aria-label={t('poll.optionLabel', { n: index + 1 })}
                                placeholder={t('poll.optionPlaceholder', { n: index + 1 })}
                                onChange={(e) => {
                                    const text = e.target.value;
                                    edit((d) => ({
                                        ...d,
                                        options: d.options.map((o) =>
                                            o.id === option.id ? { ...o, text } : o
                                        ),
                                    }));
                                }}
                            />
                            <button
                                type="button"
                                disabled={data.options.length <= POLL_LIMITS.minOptions}
                                onClick={() =>
                                    edit((d) => ({
                                        ...d,
                                        options: d.options.filter((o) => o.id !== option.id),
                                    }))
                                }
                                aria-label={t('poll.removeOption', { n: index + 1 })}
                                className="flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-danger-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-40"
                            >
                                <Trash size={16} aria-hidden />
                            </button>
                        </li>
                    ))}
                </ol>
                {data.options.length < POLL_LIMITS.maxOptions && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() =>
                            edit((d) => ({
                                ...d,
                                options: [
                                    ...d.options,
                                    { id: newPollOptionId(d.options.map((o) => o.id)), text: '' },
                                ],
                            }))
                        }
                    >
                        <Plus size={14} aria-hidden /> {t('poll.addOption')}
                    </MyButton>
                )}
                <p className="text-caption text-neutral-500">{t('poll.optionsHint')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <span className="text-sm font-medium text-neutral-900">
                        {t('poll.results')}
                    </span>
                    <Select
                        value={data.settings.results}
                        onValueChange={(v) =>
                            edit((d) => ({
                                ...d,
                                settings: { ...d.settings, results: v as PollResultsVisibility },
                            }))
                        }
                    >
                        <SelectTrigger aria-label={t('poll.results')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {RESULTS.map((r) => (
                                <SelectItem key={r} value={r}>
                                    {t(`poll.resultsOption.${r}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-3 sm:pt-6">
                    <Switch
                        id="poll-change"
                        checked={data.settings.allowChange}
                        onCheckedChange={(v) =>
                            edit((d) => ({ ...d, settings: { ...d.settings, allowChange: v } }))
                        }
                    />
                    <Label htmlFor="poll-change">{t('poll.allowChange')}</Label>
                </div>
            </div>
            {problems.length > 0 && (
                <ul className="space-y-1 rounded-md border border-warning-200 bg-warning-50 p-3 text-caption text-warning-700">
                    {problems.map((p) => (
                        <li key={p}>{t(p)}</li>
                    ))}
                </ul>
            )}
        </fieldset>
    );

    return (
        <ActivityShell
            slideId={slide.id}
            icon={<ChartBar size={20} weight="duotone" aria-hidden />}
            title={t('poll.title')}
            json={json}
            userEdited={userEdited}
            isEditable={isEditable}
            setup={setup}
            results={<PollResultsPanel slideId={slide.id} />}
            resultsLabel={t('tabs.results')}
        />
    );
}

function PollResultsPanel({ slideId }: { slideId: string }) {
    const { t } = useTranslation('slideActivity');
    const [batch, setBatch] = useState(ALL_BATCHES);
    const query = useQuery({
        queryKey: ['slide-poll-results', slideId, batch],
        queryFn: () => fetchPollResults(slideId, batch === ALL_BATCHES ? undefined : batch),
        staleTime: 15_000,
    });
    if (query.isPending)
        return <p className="text-body text-neutral-500">{t('results.loading')}</p>;
    if (query.isError) return <p className="text-body text-danger-600">{t('results.error')}</p>;
    const { options, counts, totalVotes, batches } = query.data;
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body text-neutral-700">
                    {t('results.votes', { count: totalVotes })}
                </p>
                <BatchFilter batches={batches} value={batch} onChange={setBatch} />
            </div>
            {options.length === 0 ? (
                <p className="text-body text-neutral-500">{t('results.publishFirst')}</p>
            ) : (
                <ul className="space-y-3">
                    {options.map((o) => {
                        const n = counts[o.id] ?? 0;
                        const pct = totalVotes > 0 ? Math.round((n / totalVotes) * 100) : 0;
                        return (
                            <li key={o.id} className="space-y-1">
                                <div className="flex justify-between gap-2 text-body">
                                    <span className="min-w-0 truncate text-neutral-900">
                                        {o.text}
                                    </span>
                                    <span className="shrink-0 tabular-nums text-neutral-600">
                                        {t('results.optionCount', { count: n, pct })}
                                    </span>
                                </div>
                                <div
                                    className="h-2 overflow-hidden rounded-full bg-neutral-100"
                                    role="presentation"
                                >
                                    <div
                                        className="h-full rounded-full bg-primary-400"
                                        // Width is the live vote share.
                                        style={{ width: `${pct}%` }} // design-lint-ignore: data-driven bar width
                                    />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
