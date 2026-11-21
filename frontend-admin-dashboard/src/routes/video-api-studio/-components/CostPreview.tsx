import { useEffect, useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Warning, Coins, CircleNotch } from '@phosphor-icons/react';
import {
    previewVideoCost,
    buildQualityTiers,
    buildVoiceGenders,
    getTargetAudienceLabel,
    getTargetDurationLabel,
    type GenerateVideoRequest,
    type VideoCostPreviewRequest,
    type VideoCostPreviewResponse,
    type VideoCostPreviewBreakdownRow,
} from '../-services/video-generation';
import { getInstituteId } from '@/constants/helper';
import type { StudioAvatar } from '@/features/vimotion/api/dashboardTypes';

// Credit-only display: USD figures are intentionally not shown to the
// user (credits are the only billing currency). The backend response
// still carries `cost_usd` fields for internal accounting / forensic
// debugging — we just don't render them. To re-enable USD for an
// internal admin view, render the same `row.cost_usd` / `est.*_cost_usd`
// fields explicitly behind your own gate.

function buildPreviewPayload(
    options: Omit<GenerateVideoRequest, 'prompt'>,
    extras: {
        reviewMode: boolean;
        attachmentsCount: number;
        backgroundMusicEnabled?: boolean | null;
    }
): VideoCostPreviewRequest {
    return {
        quality_tier: options.quality_tier,
        // The model the estimate (and the "Model" row) should reflect is what
        // the user actually picked. Per-stage overrides live in
        // `model_overrides.default` (the "Default model" dropdown) — the legacy
        // top-level `options.model` is undefined in vimMode and unused there.
        // Without this, the estimator gets no model and falls back to the
        // ai_model_defaults default (google/gemini-2.5-pro), so the confirm
        // modal showed gemini-2.5-pro even after the user chose e.g. Claude.
        // The actual run already honors `model_overrides` (buildRequest forwards
        // it); this only aligns the pre-run preview with that reality.
        model: options.model_overrides?.default || options.model || undefined,
        target_duration: options.target_duration,
        target_audience: options.target_audience,
        orientation: options.orientation || 'landscape',
        visual_style: options.visual_style,
        voice_gender: options.voice_gender,
        tts_provider: options.tts_provider,
        voice_id: options.voice_id || undefined,
        language: options.language,
        generate_avatar: false,
        background_music_enabled:
            extras.backgroundMusicEnabled === undefined ? null : extras.backgroundMusicEnabled,
        sound_effects_enabled: true,
        content_type: options.content_type || 'VIDEO',
        captions_enabled: options.captions_enabled,
        html_quality: options.html_quality,
        review_mode: extras.reviewMode,
        attachments_count: extras.attachmentsCount,
        // Forward the host config so the BE estimator can add the avatar
        // synthesis + reference-image cost lines. BE silently ignores `host`
        // for tiers below ultra (matches the API-edge tier gate).
        host: options.host,
        // Lesson mode — the BE adds the Spatius teacher row when a teacher is set.
        lesson: options.lesson,
        // Forward AI video opt-in so the BE adds a worst-case Veo row to
        // the breakdown. Same tier-gate as host above — BE ignores on
        // sub-ultra tiers.
        ai_video_enabled: options.ai_video_enabled,
        ai_video_audio_enabled: options.ai_video_audio_enabled,
        // Dialogue scenes are the dominant cost line when on ($0.13-0.30 per
        // second of acted clip) — without these the confirm modal priced a
        // drama run 5-10x under reality.
        dialogue_scenes_enabled: options.dialogue_scenes_enabled,
        dialogue_mode: options.dialogue_mode,
        dialogue_clip_model: options.dialogue_clip_model,
    };
}

// ---------------------------------------------------------------------------
// Avatar breakdown rewriter — drop the misleading fal-endpoint string from
// the BE response and replace it with the picked avatar's display name. The
// BE may still emit `~81s @ fal-ai/kling-video/...` even when the actual
// dispatch is Argil/VEED (see video_estimation_service.py — pre-fix backends
// don't resolve saved_avatar_id at preview time). This FE pass gives users
// a stable, accurate label regardless of which BE version is responding.
// ---------------------------------------------------------------------------

const _AVATAR_SYNTH_COMPONENT = 'Avatar video synthesis (host)';
const _AVATAR_REF_COMPONENT = 'Avatar reference images (host)';

function rewriteAvatarRow(
    row: VideoCostPreviewBreakdownRow,
    pickedAvatar: StudioAvatar | undefined,
    t: TFunction
): VideoCostPreviewBreakdownRow | null {
    if (row.component === _AVATAR_SYNTH_COMPONENT) {
        // Always rewrite to drop the technical endpoint string. Use the
        // picked avatar's name when available; fall back to a bare label
        // for admin (free-form upload, no studio_avatar row).
        if (pickedAvatar) {
            const isBuiltin = pickedAvatar.provider !== 'custom';
            const label = isBuiltin
                ? t('avatarRow.presetAvatar')
                : t('avatarRow.customAvatar');
            const name = (pickedAvatar.name || '').trim();
            return {
                ...row,
                detail: name ? t('avatarRow.labelWithName', { label, name }) : label,
            };
        }
        return { ...row, detail: t('avatarRow.customAvatar') };
    }
    if (row.component === _AVATAR_REF_COMPONENT) {
        // Built-in catalog avatars skip Seedream entirely — drop this row
        // when a built-in is picked. The cost number is harmless either way
        // (we'd just be over-displaying a charge that won't actually fire).
        if (pickedAvatar && pickedAvatar.provider !== 'custom') {
            return null;
        }
        // Custom path — keep the row but simplify the detail.
        return { ...row, detail: t('avatarRow.perShotIdentityImages') };
    }
    return row;
}

/** Bound credits formatter — factored so components can supply their own
 *  `t` for the null-value placeholder. */
function buildFmtCredits(t: TFunction, locale: string) {
    return (n: number | null | undefined): string => {
        if (n == null) return t('common.emptyValue');
        return Math.round(n).toLocaleString(locale);
    };
}

// ---------------------------------------------------------------------------
// Hook — debounced fetch as user toggles options.
// ---------------------------------------------------------------------------

export function useCostPreview(args: {
    apiKey?: string | null;
    options: Omit<GenerateVideoRequest, 'prompt'>;
    reviewMode: boolean;
    attachmentsCount: number;
    enabled?: boolean;
}) {
    const { apiKey, options, reviewMode, attachmentsCount, enabled = true } = args;
    const { t } = useTranslation('videoApiStudioCostPreview');
    const [data, setData] = useState<VideoCostPreviewResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const payload = useMemo(
        () => buildPreviewPayload(options, { reviewMode, attachmentsCount }),
        [options, reviewMode, attachmentsCount]
    );
    const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);

    useEffect(() => {
        if (!enabled || !apiKey) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            setLoading(true);
            setError(null);
            previewVideoCost(payload, apiKey)
                .then((res) => {
                    if (!cancelled) setData(res);
                })
                .catch((err) => {
                    if (!cancelled)
                        setError(
                            err instanceof Error ? err.message : t('hook.previewFailedFallback')
                        );
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [payloadKey, apiKey, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

    return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Inline summary — sits below PromptInput, auto-updates.
// ---------------------------------------------------------------------------

export function CostPreviewInline({
    data,
    loading,
}: {
    data: VideoCostPreviewResponse | null;
    loading: boolean;
}) {
    const { t, i18n } = useTranslation('videoApiStudioCostPreview');
    const fmtCredits = useMemo(() => buildFmtCredits(t, i18n.language), [t, i18n.language]);
    if (!data && !loading) return null;
    const est = data?.estimate;
    const bal = data?.balance;
    const insufficient = !!(bal && !bal.sufficient_for_high);

    // Selection details (quality_tier / duration / orientation / voice / model)
    // are already shown as chips in the option-bubble row above this preview,
    // so we only render the cost + balance summary here.
    if (!est && !bal && !loading) return null;

    // Visual weight bumped intentionally — the previous neutral `text-2xs`
    // strip was being missed by users who only discovered the cost at the
    // confirmation modal. Amber pill makes "this is the price tag" obvious
    // at a glance; insufficient balance flips to red.
    return (
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            {loading && <CircleNotch className="size-3.5 animate-spin text-muted-foreground" />}
            {est && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-amber-200">
                    <Coins className="size-3.5 text-amber-600" />
                    {t('inline.expectedCredits', {
                        count: est.expected_credits,
                        value: fmtCredits(est.expected_credits),
                    })}
                    <span className="font-normal text-amber-700">
                        {t('inline.range', {
                            low: fmtCredits(est.low_credits),
                            high: fmtCredits(est.high_credits),
                        })}
                    </span>
                </span>
            )}
            {bal && bal.current != null && (
                <span
                    className={
                        insufficient
                            ? 'inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 font-semibold text-red-700 ring-1 ring-red-200'
                            : 'inline-flex items-center gap-1 px-1 text-muted-foreground'
                    }
                >
                    {insufficient ? '⚠ ' : '✓ '}
                    {t('inline.balanceAvailable', { value: fmtCredits(bal.current) })}
                </span>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Confirmation modal — full breakdown, blocks on insufficient balance.
// ---------------------------------------------------------------------------

export function CostPreviewModal({
    open,
    onOpenChange,
    data,
    loading,
    error,
    onConfirm,
    savedAvatarId,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    data: VideoCostPreviewResponse | null;
    loading: boolean;
    error: string | null;
    onConfirm: () => void;
    /**
     * studio_avatar.id of the picked saved avatar, when one is selected.
     * Used to rewrite the BE-built breakdown rows so the user sees a
     * friendly label ("Custom avatar — Matteo" / "Preset avatar — Matteo")
     * instead of the inert fal endpoint slug carried by the BE for
     * back-compat. Lookup uses the React Query cache populated by
     * VimSavedAvatarSelect — no extra fetch.
     */
    savedAvatarId?: string;
}) {
    const { t, i18n } = useTranslation('videoApiStudioCostPreview');
    const fmtCredits = useMemo(() => buildFmtCredits(t, i18n.language), [t, i18n.language]);
    const sel = data?.selections;
    const est = data?.estimate;
    const bal = data?.balance;
    const insufficient = bal != null && !bal.sufficient_for_high;

    // Resolve the picked saved avatar from the React Query cache so we can
    // render its name + provider in the breakdown. Cache key matches the
    // one VimSavedAvatarSelect uses; we don't trigger a fetch from here.
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const cachedAvatars =
        queryClient.getQueryData<StudioAvatar[]>(['vim-saved-avatars', instituteId]) ?? [];
    const pickedAvatar = savedAvatarId
        ? cachedAvatars.find((a) => a.id === savedAvatarId)
        : undefined;

    const visibleBreakdown = useMemo(() => {
        if (!est) return [];
        return est.breakdown
            .map((row) => rewriteAvatarRow(row, pickedAvatar, t))
            .filter((row): row is VideoCostPreviewBreakdownRow => row !== null);
    }, [est, pickedAvatar, t]);

    // Backend echoes these selections back as plain strings, but they're
    // drawn from small closed sets the FE owns — render the translated
    // label, not the raw enum value (bug: raw enum was shown verbatim).
    const qualityTierLabel = sel
        ? (buildQualityTiers(t).find((tier) => tier.value === sel.quality_tier)?.label ??
          sel.quality_tier)
        : '';
    const orientationLabel = sel
        ? sel.orientation === 'portrait'
            ? t('modal.selections.orientationPortrait')
            : t('modal.selections.orientationLandscape')
        : '';
    const voiceGenderLabel = sel
        ? (buildVoiceGenders(t).find((g) => g.value === sel.voice.gender)?.label ??
          sel.voice.gender)
        : '';

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-dialog-tall w-dialog-lg flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>{t('modal.title')}</DialogTitle>
                </DialogHeader>

                <div className="-mx-6 flex-1 overflow-y-auto px-6">
                    {loading && !data && (
                        <div className="flex items-center justify-center py-10 text-muted-foreground">
                            <CircleNotch className="me-2 size-4 animate-spin" />
                            {t('modal.estimating')}
                        </div>
                    )}

                    {error && !data && (
                        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                            <Warning className="mt-0.5 size-4 shrink-0" />
                            <span>{t('modal.loadFailed', { error })}</span>
                        </div>
                    )}

                    {sel && est && (
                        <div className="space-y-4 text-sm">
                            {/* Selections summary */}
                            <section>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {t('modal.selections.heading')}
                                </h3>
                                <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                                    <SelectionRow
                                        label={t('modal.selections.quality')}
                                        value={qualityTierLabel}
                                        highlight
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.model')}
                                        value={sel.model || t('modal.selections.modelDefault')}
                                        highlight
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.duration')}
                                        value={getTargetDurationLabel(sel.target_duration, t)}
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.orientation')}
                                        value={orientationLabel}
                                        highlight
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.audience')}
                                        value={getTargetAudienceLabel(sel.target_audience, t)}
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.language')}
                                        value={sel.language}
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.voice')}
                                        value={`${sel.voice.provider} · ${voiceGenderLabel}${
                                            sel.voice.voice_id ? ` (${sel.voice.voice_id})` : ''
                                        }`}
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.captions')}
                                        value={
                                            sel.captions_enabled
                                                ? t('common.on')
                                                : t('common.off')
                                        }
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.backgroundMusic')}
                                        value={
                                            sel.background_music_enabled
                                                ? t('common.on')
                                                : t('common.off')
                                        }
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.soundEffects')}
                                        value={
                                            sel.sound_effects_enabled
                                                ? t('common.on')
                                                : t('common.off')
                                        }
                                    />
                                    <SelectionRow
                                        label={t('modal.selections.reviewMode')}
                                        value={
                                            sel.review_mode
                                                ? t('modal.selections.reviewModeOn')
                                                : t('common.off')
                                        }
                                    />
                                    {sel.attachments_count > 0 && (
                                        <SelectionRow
                                            label={t('modal.selections.attachments')}
                                            value={t('modal.selections.attachmentsValue', {
                                                count: sel.attachments_count,
                                            })}
                                        />
                                    )}
                                </dl>
                            </section>

                            {/* Cost breakdown */}
                            <section>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {t('modal.cost.heading')}
                                </h3>
                                <table className="w-full border-separate border-spacing-y-1 text-xs">
                                    <thead className="text-muted-foreground">
                                        <tr>
                                            <th className="text-start font-normal">
                                                {t('modal.cost.component')}
                                            </th>
                                            <th className="text-end font-normal">
                                                {t('modal.cost.credits')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleBreakdown.map((row) => (
                                            <tr key={row.component}>
                                                <td>
                                                    <div className="font-medium">
                                                        {row.component}
                                                    </div>
                                                    <div className="text-2xs text-muted-foreground">
                                                        {row.detail}
                                                    </div>
                                                </td>
                                                <td className="text-right tabular-nums">
                                                    {fmtCredits(row.credits)}
                                                </td>
                                            </tr>
                                        ))}
                                        <tr className="border-t font-semibold">
                                            <td>
                                                {t('modal.cost.expectedTotal')}
                                                <div className="text-2xs font-normal text-muted-foreground">
                                                    {t('modal.cost.range', {
                                                        low: fmtCredits(est.low_credits),
                                                        high: fmtCredits(est.high_credits),
                                                    })}
                                                </div>
                                            </td>
                                            <td className="text-right tabular-nums">
                                                {fmtCredits(est.expected_credits)}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </section>

                            {/* Balance */}
                            {bal && bal.current != null && (
                                <section
                                    className={`rounded-md border p-2.5 text-xs ${
                                        insufficient ? 'border-red-300 bg-red-50' : 'bg-muted/40'
                                    }`}
                                >
                                    <div className="flex items-center justify-between">
                                        <span>{t('modal.balance.current')}</span>
                                        <span className="font-medium tabular-nums">
                                            {t('modal.balance.currentValue', {
                                                value: fmtCredits(bal.current),
                                            })}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-muted-foreground">
                                        <span>{t('modal.balance.afterExpected')}</span>
                                        <span className="tabular-nums">
                                            {fmtCredits(bal.after_expected)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between text-muted-foreground">
                                        <span>{t('modal.balance.afterHigh')}</span>
                                        <span className="tabular-nums">
                                            {fmtCredits(bal.after_high)}
                                        </span>
                                    </div>
                                    {insufficient && (
                                        <div className="mt-2 flex items-center gap-1.5 font-medium text-red-700">
                                            <Warning className="size-3.5" />
                                            {t('modal.balance.insufficient')}
                                        </div>
                                    )}
                                </section>
                            )}

                            {est.assumptions.length > 0 && (
                                <details className="text-2xs text-muted-foreground">
                                    <summary className="cursor-pointer">
                                        {t('modal.assumptions.summary')}
                                    </summary>
                                    <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                        {est.assumptions.map((a, i) => (
                                            <li key={i}>{a}</li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('modal.footer.cancel')}
                    </Button>
                    {insufficient ? (
                        <Button disabled className="bg-red-600 text-white hover:bg-red-700">
                            {t('modal.footer.insufficientTopUp')}
                        </Button>
                    ) : (
                        <Button onClick={onConfirm} disabled={loading && !data}>
                            {t('modal.footer.confirm')}
                            {est &&
                                t('modal.footer.confirmCredits', {
                                    count: est.expected_credits,
                                    value: fmtCredits(est.expected_credits),
                                })}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function SelectionRow({
    label,
    value,
    highlight,
}: {
    label: string;
    value: string;
    highlight?: boolean;
}) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={highlight ? 'font-semibold' : ''}>{value}</dd>
        </>
    );
}
