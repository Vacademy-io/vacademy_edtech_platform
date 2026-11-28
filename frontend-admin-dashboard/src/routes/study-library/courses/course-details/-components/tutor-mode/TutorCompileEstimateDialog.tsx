import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleNotch, Coins, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import {
    estimateTutorCompile,
    type TutorCompileEstimate,
    type TutorCompileOptions,
} from '@/services/tutor';
import type { TFunction } from 'i18next';

const buildKindLabel = (t: TFunction): Record<string, string> => ({
    document: t('kindLabel.document'),
    pdf: t('kindLabel.pdf'),
    quiz: t('kindLabel.quiz'),
    ai_video: t('kindLabel.aiVideo'),
    youtube: t('kindLabel.youtube'),
    video_upload: t('kindLabel.videoUpload'),
    video_link: t('kindLabel.videoLink'),
    scorm: t('kindLabel.scorm'),
    other: t('kindLabel.notSupported'),
});

const buildActionLabel = (t: TFunction): Record<string, string> => ({
    compile: t('actionLabel.willPrepare'),
    up_to_date: t('actionLabel.alreadyPrepared'),
    needs_details: t('actionLabel.needsDetails'),
    free: t('actionLabel.free'),
    skip: t('actionLabel.skipped'),
    unsupported: t('actionLabel.notSupported'),
    unpublished: t('actionLabel.notPublished'),
});

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

interface Props {
    packageId: string;
    slideIds?: string[];
    open: boolean;
    options: TutorCompileOptions | null;
    transcribeVideos: boolean;
    onTranscribeVideosChange: (v: boolean) => void;
    ocrPdfs: boolean;
    onOcrPdfsChange: (v: boolean) => void;
    onClose: () => void;
    onConfirm: () => void;
}

/**
 * What "Prepare for teaching" will cost, slide by slide, before any credit is
 * spent: compile credits, transcription minutes for uploaded videos, and the
 * image cap. Prices come from the server, so super-admin overrides apply.
 */
export const TutorCompileEstimateDialog: React.FC<Props> = ({
    packageId,
    slideIds,
    open,
    options,
    transcribeVideos,
    onTranscribeVideosChange,
    ocrPdfs,
    onOcrPdfsChange,
    onClose,
    onConfirm,
}) => {
    const { t } = useTranslation('studyLibraryTutorCompileEstimateDialog');
    const KIND_LABEL = buildKindLabel(t);
    const ACTION_LABEL = buildActionLabel(t);
    const [estimate, setEstimate] = useState<TutorCompileEstimate | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const single = (slideIds?.length ?? 0) === 1;

    useEffect(() => {
        if (!open || !options) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        estimateTutorCompile(packageId, {
            ...options,
            transcribe_videos: transcribeVideos,
            ocr_pdfs: ocrPdfs,
            slide_ids: slideIds ?? [],
            force: single,
        })
            .then((e) => {
                if (!cancelled) setEstimate(e);
            })
            .catch((e: unknown) => {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : t('couldNotEstimate'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
        // options is rebuilt on every render; the inputs that matter are listed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, packageId, slideIds?.join(','), transcribeVideos, ocrPdfs, single, t]);

    const totals = estimate?.totals;
    const rows = (estimate?.slides ?? []).filter((r) => r.action !== 'up_to_date' || single);
    const upToDate = estimate?.slides.filter((r) => r.action === 'up_to_date').length ?? 0;
    const insufficient = estimate?.sufficient === false;
    const nothing = !!totals && totals.to_compile === 0;

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent className="max-h-screen w-full max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Coins className="size-5 text-primary-500" />
                        {single ? t('prepareThisSlide') : t('prepareForTeaching')}
                        {loading && (
                            <CircleNotch className="size-4 animate-spin text-neutral-400" />
                        )}
                    </DialogTitle>
                </DialogHeader>

                <p className="text-sm text-neutral-600">{t('intro')}</p>

                {estimate?.transcription_available && (
                    <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                        <Switch
                            id="tutor-transcribe"
                            checked={transcribeVideos}
                            onCheckedChange={onTranscribeVideosChange}
                        />
                        <Label htmlFor="tutor-transcribe" className="text-sm">
                            {t('transcribeSwitchLabel', {
                                perMinute: fmt(estimate.prices.transcription_per_minute),
                                minimum: fmt(estimate.prices.transcription_minimum),
                            })}
                        </Label>
                    </div>
                )}
                {estimate?.ocr_available && (
                    <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                        <Switch
                            id="tutor-ocr"
                            checked={ocrPdfs}
                            onCheckedChange={onOcrPdfsChange}
                        />
                        <Label htmlFor="tutor-ocr" className="text-sm">
                            {t('ocrSwitchLabel', { perPage: fmt(estimate.prices.ocr_per_page) })}
                        </Label>
                    </div>
                )}

                {error && (
                    <p className="flex items-center gap-2 text-sm text-danger-600">
                        <WarningCircle className="size-4" /> {error}
                    </p>
                )}

                {estimate && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                                    <th className="py-2 pe-3 text-start">{t('table.slide')}</th>
                                    <th className="py-2 pe-3 text-start">{t('table.kind')}</th>
                                    <th className="py-2 pe-3 text-start">
                                        {t('table.whatHappens')}
                                    </th>
                                    <th className="py-2 pe-3 text-end">{t('table.credits')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr
                                        key={r.slide_id}
                                        className="border-b border-neutral-100 align-top"
                                    >
                                        <td className="py-2 pe-3 font-medium text-neutral-800">
                                            {r.title ?? r.slide_id}
                                        </td>
                                        <td className="py-2 pe-3 text-neutral-600">
                                            {KIND_LABEL[r.kind] ?? r.kind}
                                        </td>
                                        <td className="py-2 pe-3 text-neutral-600">
                                            <span
                                                className={
                                                    r.action === 'needs_details'
                                                        ? 'text-warning-700'
                                                        : undefined
                                                }
                                            >
                                                {ACTION_LABEL[r.action] ?? r.action}
                                            </span>
                                            {r.note && (
                                                <span className="block text-xs text-neutral-500">
                                                    {r.note}
                                                    {r.minutes > 0
                                                        ? t('row.minutesSuffix', {
                                                              count: r.minutes,
                                                          })
                                                        : ''}
                                                    {r.ocr > 0
                                                        ? t('row.ocrSuffix', { credits: fmt(r.ocr) })
                                                        : ''}
                                                    {r.voice > 0
                                                        ? t('row.voiceSuffix', {
                                                              credits: fmt(r.voice),
                                                          })
                                                        : ''}
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-2 pe-3 text-end text-neutral-800">
                                            {r.total > 0 ? fmt(r.total) : '—'}
                                            {r.images_max > 0 && (
                                                <span className="block text-xs text-neutral-400">
                                                    {t('row.upToImages', { count: r.images_max })}
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                                {rows.length === 0 && !loading && (
                                    <tr>
                                        <td
                                            colSpan={4}
                                            className="py-4 text-center text-neutral-500"
                                        >
                                            {t('nothingToPrepare')}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {totals && (
                    <div className="space-y-1 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm">
                        <p className="flex justify-between">
                            <span>
                                {t('summary.slidesToPrepare', { count: totals.to_compile })}
                                {upToDate > 0 && !single
                                    ? t('summary.alreadyPreparedSuffix', { count: upToDate })
                                    : ''}
                                {totals.needs_details > 0
                                    ? t('summary.needDetailsSuffix', {
                                          count: totals.needs_details,
                                      })
                                    : ''}
                            </span>
                            <span className="font-semibold text-neutral-900">
                                {t('summary.approxCredits', { credits: fmt(totals.required) })}
                            </span>
                        </p>
                        <p className="text-xs text-neutral-500">
                            {t('summary.toCompile', { credits: fmt(totals.compile_credits) })}
                            {totals.transcription_minutes > 0
                                ? t('summary.transcriptionSuffix', {
                                      credits: fmt(totals.transcription_credits),
                                      count: totals.transcription_minutes,
                                  })
                                : ''}
                            {totals.ocr_pages > 0
                                ? t('summary.ocrSuffix', {
                                      credits: fmt(totals.ocr_credits),
                                      count: totals.ocr_pages,
                                  })
                                : ''}
                            {totals.voice_credits > 0
                                ? t('summary.voiceSuffix', {
                                      credits: fmt(totals.voice_credits),
                                      count: totals.voice_languages,
                                  })
                                : ''}
                            {totals.images_max > 0
                                ? t('summary.imagesSuffix', {
                                      credits: fmt(totals.images_max_credits),
                                  })
                                : ''}
                            {t('summary.compileCost', {
                                credits: fmt(estimate!.prices.compile_slide),
                            })}
                        </p>
                        {estimate?.balance !== null && estimate?.balance !== undefined && (
                            <p
                                className={`text-xs ${insufficient ? 'text-danger-600' : 'text-neutral-500'}`}
                            >
                                {t('summary.balance', { credits: fmt(estimate.balance) })}
                                {insufficient ? t('summary.insufficientSuffix') : ''}
                            </p>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        layoutVariant="default"
                        onClick={onClose}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        layoutVariant="default"
                        disable={loading || !estimate || insufficient || nothing}
                        onClick={onConfirm}
                    >
                        <Sparkle className="size-4" />
                        {totals
                            ? t('prepareWithCredits', { credits: fmt(totals.required) })
                            : t('prepare')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};
