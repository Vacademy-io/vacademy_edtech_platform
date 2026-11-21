import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleNotch, ArrowsClockwise, Sparkle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
    getThumbnailSet,
    regenerateThumbnails,
    setSelectedThumbnail,
} from '@/features/vimotion/api/thumbnails';
import type {
    ThumbnailOption,
    ThumbnailSet,
} from '@/routes/video-api-studio/-services/video-generation';
import { ThumbnailRenderer } from '@/features/vimotion/dashboard/ThumbnailRenderer';
import { getDefaultBrandKit } from '@/features/vimotion/api/brandKits';
import type { BrandKit } from '@/features/vimotion/api/dashboardTypes';
import { getInstituteId } from '@/constants/helper';

interface ThumbnailPickerPanelProps {
    videoId: string;
    apiKey?: string;
    /** Production-view layout uses default; editor toolbar can ask for a more
     *  compact set of alternates ('compact'). */
    variant?: 'default' | 'compact';
}

export function ThumbnailPickerPanel({
    videoId,
    apiKey,
    variant = 'default',
}: ThumbnailPickerPanelProps) {
    const { t } = useTranslation('videoApiStudioThumbnailPickerPanel');
    const instituteId = getInstituteId();
    const queryClient = useQueryClient();
    const [optimisticSelectedId, setOptimisticSelectedId] = useState<string | null>(null);

    const setQuery = useQuery<ThumbnailSet | null>({
        queryKey: ['vimotion-thumbnails', videoId],
        queryFn: () => getThumbnailSet(videoId, apiKey!),
        enabled: !!apiKey && !!videoId,
        // Poll while the thumbnail batch is still running so the panel
        // hydrates as soon as the daemon thread persists its result.
        refetchInterval: (q) => {
            const data = q.state.data as ThumbnailSet | null | undefined;
            const hasOptions = !!data && Array.isArray(data.options) && data.options.length > 0;
            return hasOptions ? false : 15_000;
        },
        staleTime: 30_000,
    });

    const brandKitQuery = useQuery<BrandKit | null>({
        queryKey: ['vimotion-default-brand-kit', instituteId],
        queryFn: () => getDefaultBrandKit(instituteId ?? ''),
        enabled: !!instituteId,
        staleTime: 60_000,
    });
    const brandKit = brandKitQuery.data ?? null;

    const selectMutation = useMutation({
        mutationFn: (selectedId: string) =>
            setSelectedThumbnail(videoId, selectedId, apiKey!),
        onMutate: (selectedId: string) => {
            setOptimisticSelectedId(selectedId);
        },
        onSuccess: (next) => {
            queryClient.setQueryData(['vimotion-thumbnails', videoId], next);
            // Also nudge the Recent grid so the selected swap is visible there.
            queryClient.invalidateQueries({ queryKey: ['vimotion-history'] });
        },
        onError: (err: Error) => {
            setOptimisticSelectedId(null);
            toast.error(err.message || t('toast.selectError'));
        },
        onSettled: () => {
            // Resolve the optimistic state into whatever the server confirmed.
            setOptimisticSelectedId(null);
        },
    });

    const regenMutation = useMutation({
        mutationFn: () => regenerateThumbnails(videoId, apiKey!),
        onSuccess: () => {
            toast.success(t('toast.regenerateSuccess'));
            // Drop the cached set so the polling loop picks up the new one.
            queryClient.setQueryData(['vimotion-thumbnails', videoId], null);
            queryClient.invalidateQueries({ queryKey: ['vimotion-thumbnails', videoId] });
        },
        onError: (err: Error) => {
            toast.error(err.message || t('toast.regenerateError'));
        },
    });

    if (!apiKey || !videoId) return null;

    const data = setQuery.data;
    const options = data?.options ?? [];
    const orientation =
        (data?.orientation as 'landscape' | 'portrait' | undefined) ?? 'landscape';
    const serverSelectedId = data?.selected_id ?? null;
    const selectedId = optimisticSelectedId ?? serverSelectedId;
    const selected = options.find((o) => o.id === selectedId) || options[0] || null;
    const alternates = options.filter((o) => o.id !== (selected?.id ?? ''));

    return (
        <div className="rounded-lg border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
                <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('heading')}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-2xs"
                    onClick={() => regenMutation.mutate()}
                    disabled={regenMutation.isPending || options.length === 0}
                    title={t('regenerate.title')}
                >
                    {regenMutation.isPending ? (
                        <CircleNotch className="size-3 animate-spin" />
                    ) : (
                        <ArrowsClockwise className="size-3" />
                    )}
                    {t('regenerate.button')}
                </Button>
            </div>

            {selected ? (
                <>
                    <ThumbnailRenderer
                        thumb={selected}
                        brandKit={brandKit}
                        size={variant === 'compact' ? 'md' : 'lg'}
                        orientation={orientation}
                        className="rounded-md"
                    />
                    {alternates.length > 0 && (
                        <div className="mt-2 grid grid-cols-3 gap-1.5">
                            {alternates.map((alt) => (
                                <AlternateButton
                                    key={alt.id}
                                    option={alt}
                                    brandKit={brandKit}
                                    orientation={orientation}
                                    onClick={() => selectMutation.mutate(alt.id)}
                                    pending={
                                        selectMutation.isPending &&
                                        optimisticSelectedId === alt.id
                                    }
                                />
                            ))}
                        </div>
                    )}
                </>
            ) : (
                <ThumbnailPlaceholder
                    orientation={orientation}
                    loading={setQuery.isFetching}
                />
            )}
        </div>
    );
}

function AlternateButton({
    option,
    brandKit,
    orientation,
    onClick,
    pending,
}: {
    option: ThumbnailOption;
    brandKit: BrandKit | null;
    orientation: 'landscape' | 'portrait';
    onClick: () => void;
    pending: boolean;
}) {
    const { t } = useTranslation('videoApiStudioThumbnailPickerPanel');
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={pending}
            className={cn(
                'relative overflow-hidden rounded-md border transition-all',
                pending
                    ? 'cursor-wait border-neutral-300'
                    : 'border-transparent hover:border-neutral-400'
            )}
            title={t('alternate.selectTitle')}
        >
            <ThumbnailRenderer
                thumb={option}
                brandKit={brandKit}
                size="sm"
                orientation={orientation}
            />
            {pending && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                    <CircleNotch className="size-4 animate-spin" />
                </div>
            )}
        </button>
    );
}

function ThumbnailPlaceholder({
    orientation,
    loading,
}: {
    orientation: 'landscape' | 'portrait';
    loading: boolean;
}) {
    const { t } = useTranslation('videoApiStudioThumbnailPickerPanel');
    return (
        <div
            className={cn(
                'flex w-full items-center justify-center rounded-md border border-dashed bg-neutral-50 text-2xs text-muted-foreground',
                orientation === 'portrait' ? 'aspect-[9/16]' : 'aspect-video'
            )}
        >
            {loading ? (
                <div className="flex items-center gap-1.5">
                    <CircleNotch className="size-3 animate-spin" />
                    {t('placeholder.loading')}
                </div>
            ) : (
                <div className="flex flex-col items-center gap-1 px-3 text-center">
                    <Sparkle className="size-4 text-neutral-400" />
                    {t('placeholder.empty')}
                </div>
            )}
        </div>
    );
}
