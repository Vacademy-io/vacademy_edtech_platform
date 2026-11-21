import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Star } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { fetchSlideEngagement, saveSlideEngagement, type SlideEngagementSetting } from './activity-api';

const MAX_POINTS = 100;

/**
 * "Count as engagement" for one course slide (Question, Quiz, HTML, Flashcards, Poll,
 * Game). When on, every learner who finishes the slide earns its points once, into the
 * same points as daily engagement: points pill, leaderboard, streak and points badges.
 * No time window — the slide stays in the course. The server decides who earns.
 */
export function EngagementToggle({
    slideId,
    documentType,
}: {
    slideId: string;
    documentType?: string | null;
}) {
    const { t } = useTranslation('slideActivity');
    const queryClient = useQueryClient();
    const queryKey = ['slide-engagement', slideId];
    const [open, setOpen] = useState(false);

    const { data, isLoading, isError } = useQuery({
        queryKey,
        queryFn: () => fetchSlideEngagement(slideId),
        staleTime: 30_000,
    });

    const [pointsText, setPointsText] = useState('');
    useEffect(() => {
        if (data) setPointsText(String(data.points));
    }, [data?.points, slideId]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = useMutation({
        mutationFn: (change: { enabled?: boolean; points?: number }) => saveSlideEngagement(slideId, change),
        onSuccess: (next: SlideEngagementSetting, change) => {
            queryClient.setQueryData(queryKey, next);
            if (change.enabled === true) {
                toast.success(
                    t('engagement.toastOn', {
                        defaultValue: 'Learners now earn {{points}} points for finishing this slide',
                        points: next.points,
                    })
                );
            } else if (change.enabled === false) {
                toast.success(t('engagement.toastOff', { defaultValue: 'This slide no longer earns points' }));
            }
        },
        onError: () => {
            toast.error(t('engagement.toastFailed', { defaultValue: 'Could not save. Please try again.' }));
            if (data) setPointsText(String(data.points));
        },
    });

    if (isLoading || isError || !data || !data.eligible) return null;

    const commitPoints = () => {
        const n = Math.round(Number(pointsText));
        if (!Number.isFinite(n) || n < 1 || n > MAX_POINTS) {
            toast.error(
                t('engagement.pointsRange', {
                    defaultValue: 'Points must be between 1 and {{max}}',
                    max: MAX_POINTS,
                })
            );
            setPointsText(String(data.points));
            return;
        }
        if (n !== data.points) save.mutate({ points: n });
    };

    const hint =
        documentType === 'HTML'
            ? t('engagement.hintHtml', {
                  defaultValue:
                      'Learners finish it with "Mark as complete" (or when your page reports that it is done).',
              })
            : documentType === 'GAME'
              ? t('engagement.hintGame', {
                    defaultValue:
                        'Finishing a round completes it. The game score is shown to you but does not change the points.',
                })
              : documentType === 'POLL'
                ? t('engagement.hintPoll', { defaultValue: 'Voting completes it.' })
                : documentType === 'FLASHCARDS'
                  ? t('engagement.hintFlashcards', {
                        defaultValue: 'Going through the deck once completes it.',
                    })
                  : t('engagement.hintQuestion', { defaultValue: 'Submitting an answer completes it.' });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="default"
                    aria-label={t('engagement.button', { defaultValue: 'Count as engagement' })}
                    className={cn(data.enabled && 'border-warning-300 bg-warning-50 text-warning-700')}
                >
                    <Star size={18} weight={data.enabled ? 'fill' : 'regular'} />
                    <span className="hidden md:inline">
                        {data.enabled
                            ? t('engagement.buttonOn', {
                                  defaultValue: 'Engagement · {{points}} pts',
                                  points: data.points,
                              })
                            : t('engagement.button', { defaultValue: 'Count as engagement' })}
                    </span>
                </MyButton>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <Label htmlFor={`engagement-${slideId}`} className="text-sm font-semibold text-neutral-800">
                            {t('engagement.title', { defaultValue: 'Count as engagement' })}
                        </Label>
                        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
                            {t('engagement.body', {
                                defaultValue:
                                    'Learners earn points the first time they finish this slide. There is no deadline: it stays in the course to come back to.',
                            })}
                        </p>
                    </div>
                    <Switch
                        id={`engagement-${slideId}`}
                        checked={data.enabled}
                        disabled={save.isPending}
                        onCheckedChange={(checked) => save.mutate({ enabled: checked })}
                    />
                </div>

                {data.enabled && (
                    <>
                        <div className="flex items-center gap-2">
                            <Label htmlFor={`engagement-points-${slideId}`} className="text-sm text-neutral-700">
                                {t('engagement.points', { defaultValue: 'Points' })}
                            </Label>
                            <Input
                                id={`engagement-points-${slideId}`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={MAX_POINTS}
                                value={pointsText}
                                disabled={save.isPending}
                                onChange={(e) => setPointsText(e.target.value)}
                                onBlur={commitPoints}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitPoints();
                                }}
                                className="h-8 w-20"
                            />
                        </div>
                        <p className="text-xs text-neutral-500">{hint}</p>
                        <p className="text-xs font-medium text-neutral-700">
                            {t('engagement.earned', {
                                defaultValue: '{{count}} learners have earned these points',
                                count: data.earnedCount,
                            })}
                        </p>
                    </>
                )}

                {!data.gamificationOn && (
                    <p className="rounded-md bg-warning-50 p-2 text-xs text-warning-700">
                        {t('engagement.gamificationOff', {
                            defaultValue:
                                'Points are switched off for your institute, so nobody earns them yet. Turn on Settings → Badges & Rewards.',
                        })}
                    </p>
                )}
            </PopoverContent>
        </Popover>
    );
}
