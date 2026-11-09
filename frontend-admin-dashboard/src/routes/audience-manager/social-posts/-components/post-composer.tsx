/**
 * "New post" tab (also the editor for an existing post). Writes one post for several
 * networks: shared text with optional per-network versions, media, a link, the target
 * accounts and an optional schedule. Admins schedule / post now; other staff submit
 * for approval. Rules mirror the server's so problems show before anything is sent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CaretDown,
    Check,
    CheckCircle,
    Clock,
    PaperPlaneTilt,
    Sparkle,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { DatePickerButton } from '@/components/shared/crm-enhance/date-picker-button';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PlatformIcon, platformLabel, SOCIAL_PLATFORMS } from '../../-marketing/platform-meta';
import { useAiDraftSocialPost, useSaveSocialPost } from '../../-marketing/use-marketing';
import type {
    SocialAccount,
    SocialPlatform,
    SocialPost,
    SocialPostAction,
    SocialPostOverrides,
    SocialPostRequest,
} from '../../-marketing/types';
import { MediaPicker } from './media-picker';
import {
    effectiveText,
    isAccountUsable,
    localToIso,
    TEXT_LIMIT,
    toDayKey,
    toTimeKey,
    validateForDraft,
    validateForPublish,
    YOUTUBE_TITLE_LIMIT,
    type ComposerIssue,
    type ComposerMedia,
    type ComposerSnapshot,
} from './social-utils';
import { EmptyState } from './states';

const TONES = ['friendly', 'professional', 'exciting'] as const;
type Tone = (typeof TONES)[number];

const FIELD =
    'border-neutral-300 text-body text-neutral-700 shadow-none hover:border-primary-200 focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-primary-100';

function mediaFromPost(post: SocialPost | null): ComposerMedia[] {
    return (post?.media ?? []).map((m) => ({
        key: m.file_id,
        file_id: m.file_id,
        type: m.type,
        name: m.name ?? m.file_id,
        previewUrl: m.url,
        localPreview: false,
        uploading: false,
        failed: false,
    }));
}

export interface PostComposerProps {
    accounts: SocialAccount[] | undefined;
    accountsLoading: boolean;
    isAdmin: boolean;
    /** The post being edited; null for a new post. Remount (key) to switch posts. */
    editingPost: SocialPost | null;
    onSaved: (post: SocialPost | undefined) => void;
    onCancelEdit: () => void;
}

export function PostComposer({
    accounts,
    accountsLoading,
    isAdmin,
    editingPost,
    onSaved,
    onCancelEdit,
}: PostComposerProps) {
    const { t, i18n } = useTranslation('marketingSocial');
    const save = useSaveSocialPost();
    const aiDraft = useAiDraftSocialPost();

    const usableAccounts = useMemo(() => (accounts ?? []).filter(isAccountUsable), [accounts]);
    const usableIds = useMemo(() => new Set(usableAccounts.map((a) => a.id)), [usableAccounts]);

    const initialSchedule = editingPost?.scheduled_at ? new Date(editingPost.scheduled_at) : null;
    const [title, setTitle] = useState(editingPost?.title ?? '');
    const [body, setBody] = useState(editingPost?.body ?? '');
    const [linkUrl, setLinkUrl] = useState(editingPost?.link_url ?? '');
    const [media, setMedia] = useState<ComposerMedia[]>(() => mediaFromPost(editingPost));
    const [selected, setSelected] = useState<string[]>(
        () => editingPost?.targets.map((target) => target.social_account_id) ?? []
    );
    const [overrides, setOverrides] = useState<SocialPostOverrides>(
        () => editingPost?.overrides ?? {}
    );
    const [overridesOn, setOverridesOn] = useState(() =>
        Object.values(editingPost?.overrides ?? {}).some((text) => !!text?.trim())
    );
    const [day, setDay] = useState(initialSchedule ? toDayKey(initialSchedule) : '');
    const [time, setTime] = useState(initialSchedule ? toTimeKey(initialSchedule) : '');
    const [aiOpen, setAiOpen] = useState(false);
    const [brief, setBrief] = useState('');
    const [tone, setTone] = useState<Tone>('friendly');
    const [attempted, setAttempted] = useState<'draft' | 'publish' | null>(null);
    const [confirmNow, setConfirmNow] = useState(false);

    // Free object URLs this composer created when it goes away.
    const mediaRef = useRef(media);
    mediaRef.current = media;
    useEffect(
        () => () =>
            mediaRef.current.forEach((m) => {
                if (m.localPreview && m.previewUrl) URL.revokeObjectURL(m.previewUrl);
            }),
        []
    );

    // Only accounts that can still be posted to count (a target may have been disconnected).
    const selectedIds = useMemo(
        () => selected.filter((id) => usableIds.has(id)),
        [selected, usableIds]
    );
    const droppedTargets = selected.length - selectedIds.length;
    const platforms = useMemo<SocialPlatform[]>(() => {
        const set = new Set(
            usableAccounts.filter((a) => selectedIds.includes(a.id)).map((a) => a.platform)
        );
        return SOCIAL_PLATFORMS.filter((p) => set.has(p));
    }, [usableAccounts, selectedIds]);

    const snapshot: ComposerSnapshot = {
        title,
        body,
        linkUrl,
        media,
        platforms,
        accountCount: selectedIds.length,
        overridesOn,
        overrides,
    };
    const publishIssues = validateForPublish(snapshot);
    const draftIssues = validateForDraft(snapshot);
    const scheduledIso = localToIso(day, time);
    const scheduleInPast = !!scheduledIso && new Date(scheduledIso).getTime() < Date.now() - 60_000;
    const scheduleIssues: ComposerIssue[] = [];
    if ((day && !time) || (!day && time)) scheduleIssues.push({ key: 'scheduleIncomplete' });
    if (scheduleInPast) scheduleIssues.push({ key: 'schedulePast' });

    const [attemptedAction, setAttemptedAction] = useState<SocialPostAction | null>(null);
    const scheduleMissing = attemptedAction === 'SCHEDULE' && !scheduledIso;
    const shownIssues: ComposerIssue[] =
        attempted === 'draft'
            ? draftIssues
            : attempted === 'publish'
              ? [
                    ...publishIssues,
                    ...(attemptedAction === 'POST_NOW' ? [] : scheduleIssues),
                    ...(scheduleMissing && scheduleIssues.length === 0
                        ? [{ key: 'scheduleRequired' }]
                        : []),
                ]
              : [];

    // Strictest limit among the networks that use the main text.
    const bodyLimit = useMemo(() => {
        const users = platforms.filter((p) => !(overridesOn && overrides[p]?.trim()));
        if (users.length === 0) return null;
        return users.reduce(
            (best, p) =>
                TEXT_LIMIT[p] < best.limit ? { platform: p, limit: TEXT_LIMIT[p] } : best,
            { platform: users[0] as SocialPlatform, limit: TEXT_LIMIT[users[0] as SocialPlatform] }
        );
    }, [platforms, overridesOn, overrides]);

    const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
    const label = (platform: SocialPlatform) => platformLabel(platform, t, 'social');

    const issueText = (issue: ComposerIssue) => {
        const values = { ...(issue.values ?? {}) };
        if (typeof values.platform === 'string')
            values.platform = label(values.platform as SocialPlatform);
        return t(`composer.issues.${issue.key}`, values);
    };

    const toggleAccount = (id: string) =>
        setSelected((current) =>
            current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
        );

    const buildRequest = (action: SocialPostAction): SocialPostRequest => {
        const cleanOverrides: SocialPostOverrides = {};
        if (overridesOn) {
            for (const platform of platforms) {
                const text = overrides[platform]?.trim();
                if (text) cleanOverrides[platform] = overrides[platform];
            }
        }
        return {
            title: title.trim() || null,
            body: body.trim() ? body : null,
            link_url: linkUrl.trim() || null,
            media: media
                .filter((m) => m.file_id && !m.failed)
                .map((m) => ({ file_id: m.file_id as string, type: m.type, name: m.name })),
            overrides: cleanOverrides,
            account_ids: selectedIds,
            scheduled_at: action === 'POST_NOW' ? null : scheduledIso,
            action,
            source: editingPost?.source ?? 'MANUAL',
        };
    };

    const submit = (action: SocialPostAction) => {
        const isDraft = action === 'DRAFT';
        setAttempted(isDraft ? 'draft' : 'publish');
        setAttemptedAction(action);
        let issues: ComposerIssue[];
        if (isDraft) issues = draftIssues;
        else if (action === 'POST_NOW') issues = publishIssues;
        else issues = [...publishIssues, ...scheduleIssues];
        if (action === 'SCHEDULE' && !scheduledIso) return;
        if (issues.length > 0) return;
        save.mutate(
            { id: editingPost?.id, req: buildRequest(action) },
            { onSuccess: (post) => onSaved(post) }
        );
    };

    const runAiDraft = () => {
        if (!brief.trim()) return;
        aiDraft.mutate(
            {
                brief: brief.trim(),
                platforms: platforms.length > 0 ? platforms : [...SOCIAL_PLATFORMS],
                tone,
                language: i18n.language,
            },
            {
                onSuccess: (draft) => {
                    if (draft.title) setTitle(draft.title);
                    if (draft.body) setBody(draft.body);
                    const next: SocialPostOverrides = {};
                    for (const [platform, text] of Object.entries(draft.overrides ?? {}) as [
                        SocialPlatform,
                        string,
                    ][]) {
                        if (text?.trim() && text.trim() !== (draft.body ?? '').trim())
                            next[platform] = text;
                    }
                    setOverrides(next);
                    setOverridesOn(platforms.some((p) => !!next[p]));
                    setAiOpen(false);
                },
            }
        );
    };

    const saving = save.isPending;
    const pendingAction = save.isPending ? save.variables?.req.action : null;

    return (
        <div className="flex flex-col gap-5">
            {editingPost && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-info-50 px-3 py-2">
                    <p className="text-caption text-info-700">
                        {editingPost.status === 'SCHEDULED' && !isAdmin
                            ? t('composer.editingScheduled')
                            : t('composer.editing')}
                    </p>
                    <MyButton buttonType="text" scale="small" onClick={onCancelEdit}>
                        <X size={14} aria-hidden />
                        {t('composer.stopEditing')}
                    </MyButton>
                </div>
            )}

            {/* Accounts */}
            <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-subtitle font-medium text-neutral-800">
                    {t('composer.postTo')}
                </legend>
                {accountsLoading ? (
                    <div className="flex flex-wrap gap-2">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-12 w-44 rounded-lg" />
                        ))}
                    </div>
                ) : usableAccounts.length === 0 ? (
                    <EmptyState title={t('composer.noAccounts.title')} className="py-6">
                        {t('composer.noAccounts.body')}
                    </EmptyState>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {usableAccounts.map((account) => {
                            const on = selectedIds.includes(account.id);
                            return (
                                <button
                                    key={account.id}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => toggleAccount(account.id)}
                                    className={cn(
                                        'flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                                        on
                                            ? 'border-primary-400 bg-primary-50'
                                            : 'border-neutral-200 bg-white hover:border-neutral-300'
                                    )}
                                >
                                    <PlatformIcon platform={account.platform} size="md" />
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-caption font-medium text-neutral-800">
                                            {label(account.platform)}
                                        </span>
                                        <span className="max-w-40 truncate text-caption text-neutral-500">
                                            {account.handle || account.name}
                                        </span>
                                    </span>
                                    <span
                                        className={cn(
                                            'ms-1 flex size-4 shrink-0 items-center justify-center rounded-full border',
                                            on
                                                ? 'border-primary-500 bg-primary-500 text-white'
                                                : 'border-neutral-300'
                                        )}
                                        aria-hidden
                                    >
                                        {on && <Check size={10} weight="bold" />}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
                {droppedTargets > 0 && (
                    <p className="text-caption text-warning-700">
                        {t('composer.droppedTargets', { count: droppedTargets })}
                    </p>
                )}
            </fieldset>

            {/* Write with AI */}
            <div className="rounded-lg border border-primary-100 bg-primary-50/40">
                <button
                    type="button"
                    onClick={() => setAiOpen((open) => !open)}
                    aria-expanded={aiOpen}
                    aria-controls="social-ai-draft"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                    <Sparkle size={16} weight="fill" className="text-primary-500" aria-hidden />
                    <span className="flex-1 text-body font-medium text-primary-600">
                        {t('composer.ai.toggle')}
                    </span>
                    <CaretDown
                        size={14}
                        className={cn(
                            'text-primary-500 transition-transform',
                            aiOpen && 'rotate-180'
                        )}
                        aria-hidden
                    />
                </button>
                {aiOpen && (
                    <div id="social-ai-draft" className="flex flex-col gap-3 px-3 pb-3">
                        <Label htmlFor="social-ai-brief" className="text-caption text-neutral-600">
                            {t('composer.ai.briefLabel')}
                        </Label>
                        <Textarea
                            id="social-ai-brief"
                            value={brief}
                            onChange={(event) => setBrief(event.target.value)}
                            placeholder={t('composer.ai.briefPlaceholder')}
                            rows={3}
                            maxLength={2000}
                            className={cn(FIELD, 'bg-white')}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div
                                className="flex flex-wrap gap-1"
                                role="group"
                                aria-label={t('composer.ai.tone')}
                            >
                                {TONES.map((key) => (
                                    <button
                                        key={key}
                                        type="button"
                                        aria-pressed={tone === key}
                                        onClick={() => setTone(key)}
                                        className={cn(
                                            'h-7 rounded-full border px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                                            tone === key
                                                ? 'border-primary-300 bg-white text-primary-600'
                                                : 'border-transparent text-neutral-600 hover:bg-white'
                                        )}
                                    >
                                        <span className="text-caption font-medium">
                                            {t(`composer.ai.tones.${key}`)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                className="gap-1.5"
                                disable={!brief.trim() || aiDraft.isPending}
                                onClick={runAiDraft}
                            >
                                <Sparkle size={14} aria-hidden />
                                {aiDraft.isPending
                                    ? t('composer.ai.writing')
                                    : t('composer.ai.write')}
                            </MyButton>
                        </div>
                        <p className="text-caption text-neutral-500">{t('composer.ai.note')}</p>
                    </div>
                )}
            </div>

            {/* Title */}
            <div className="flex flex-col gap-1">
                <MyInput
                    id="social-post-title"
                    label={t('composer.title')}
                    input={title}
                    onChangeFunction={(event) => setTitle(event.target.value)}
                    inputPlaceholder={t('composer.titlePlaceholder')}
                    className="sm:w-full"
                    maxLength={255}
                    aria-label={t('composer.title')}
                />
                <p className="text-caption text-neutral-500">
                    {platforms.includes('YOUTUBE')
                        ? t('composer.titleYoutubeHint', { max: YOUTUBE_TITLE_LIMIT })
                        : t('composer.titleHint')}
                </p>
            </div>

            {/* Main text */}
            <div className="flex flex-col gap-1.5">
                <div className="flex items-end justify-between gap-2">
                    <Label
                        htmlFor="social-post-body"
                        className="text-subtitle font-regular text-neutral-800"
                    >
                        {t('composer.body')}
                    </Label>
                    <span
                        className={cn(
                            'text-caption tabular-nums',
                            bodyLimit && body.length > bodyLimit.limit
                                ? 'text-danger-600'
                                : 'text-neutral-500'
                        )}
                        aria-live="polite"
                    >
                        {bodyLimit
                            ? t('composer.counterWithLimit', {
                                  used: numberFormat.format(body.length),
                                  max: numberFormat.format(bodyLimit.limit),
                                  platform: label(bodyLimit.platform),
                              })
                            : t('composer.counter', { used: numberFormat.format(body.length) })}
                    </span>
                </div>
                <Textarea
                    id="social-post-body"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={t('composer.bodyPlaceholder')}
                    rows={6}
                    className={FIELD}
                />
            </div>

            {/* Per-network versions */}
            <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                        <Label
                            htmlFor="social-overrides"
                            className="text-body font-medium text-neutral-800"
                        >
                            {t('composer.overrides.label')}
                        </Label>
                        <p className="text-caption text-neutral-500">
                            {t('composer.overrides.hint')}
                        </p>
                    </div>
                    <Switch
                        id="social-overrides"
                        checked={overridesOn}
                        onCheckedChange={setOverridesOn}
                        disabled={platforms.length === 0}
                    />
                </div>
                {overridesOn && platforms.length > 0 && (
                    <div className="flex flex-col gap-3">
                        {platforms.map((platform) => {
                            const text = overrides[platform] ?? '';
                            const used = effectiveText(snapshot, platform).length;
                            const over = used > TEXT_LIMIT[platform];
                            const fieldId = `social-override-${platform}`;
                            return (
                                <div key={platform} className="flex flex-col gap-1.5">
                                    <div className="flex items-center justify-between gap-2">
                                        <Label
                                            htmlFor={fieldId}
                                            className="flex items-center gap-1.5 text-caption font-medium text-neutral-700"
                                        >
                                            <PlatformIcon platform={platform} size="sm" />
                                            {label(platform)}
                                        </Label>
                                        <span
                                            className={cn(
                                                'text-caption tabular-nums',
                                                over ? 'text-danger-600' : 'text-neutral-500'
                                            )}
                                        >
                                            {numberFormat.format(used)} /{' '}
                                            {numberFormat.format(TEXT_LIMIT[platform])}
                                        </span>
                                    </div>
                                    <Textarea
                                        id={fieldId}
                                        value={text}
                                        onChange={(event) =>
                                            setOverrides((current) => ({
                                                ...current,
                                                [platform]: event.target.value,
                                            }))
                                        }
                                        placeholder={body || t('composer.overrides.placeholder')}
                                        rows={3}
                                        className={FIELD}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Media */}
            <div className="flex flex-col gap-1.5">
                <span className="text-subtitle font-regular text-neutral-800">
                    {t('composer.media.label')}
                </span>
                <MediaPicker media={media} onChange={setMedia} />
                <p className="text-caption text-neutral-500">{t('composer.media.rules')}</p>
            </div>

            {/* Link */}
            <MyInput
                id="social-post-link"
                label={t('composer.link')}
                inputType="url"
                input={linkUrl}
                onChangeFunction={(event) => setLinkUrl(event.target.value)}
                inputPlaceholder="https://"
                className="sm:w-full"
                aria-label={t('composer.link')}
                error={
                    linkUrl.trim() && publishIssues.some((issue) => issue.key === 'badLink')
                        ? t('composer.issues.badLink')
                        : null
                }
            />

            {/* Schedule */}
            <div className="flex flex-col gap-1.5">
                <span className="text-subtitle font-regular text-neutral-800">
                    {t('composer.schedule.label')}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                    <DatePickerButton
                        label={t('composer.schedule.date')}
                        value={day}
                        onChange={(value) => {
                            setDay(value);
                            if (value && !time) setTime('10:00');
                        }}
                        min={toDayKey(new Date())}
                        placeholder={t('composer.schedule.pickDate')}
                    />
                    <div className="flex items-center gap-1.5">
                        <Clock size={16} className="text-neutral-500" aria-hidden />
                        <Input
                            type="time"
                            value={time}
                            onChange={(event) => setTime(event.target.value)}
                            aria-label={t('composer.schedule.time')}
                            className={cn(FIELD, 'h-8 w-32')}
                        />
                    </div>
                    {(day || time) && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            onClick={() => {
                                setDay('');
                                setTime('');
                            }}
                        >
                            {t('composer.schedule.clear')}
                        </MyButton>
                    )}
                </div>
                <p
                    className={cn(
                        'text-caption',
                        scheduleMissing ? 'text-danger-600' : 'text-neutral-500'
                    )}
                >
                    {scheduledIso
                        ? t('composer.schedule.summary', {
                              when: new Intl.DateTimeFormat(i18n.language, {
                                  dateStyle: 'full',
                                  timeStyle: 'short',
                              }).format(new Date(scheduledIso)),
                          })
                        : isAdmin
                          ? t('composer.schedule.hintAdmin')
                          : t('composer.schedule.hintStaff')}
                </p>
            </div>

            {/* Issues */}
            {shownIssues.length > 0 && (
                <div
                    role="alert"
                    className="flex flex-col gap-1.5 rounded-lg border border-warning-200 bg-warning-50 p-3"
                >
                    <p className="flex items-center gap-1.5 text-body font-medium text-warning-700">
                        <WarningCircle size={16} aria-hidden />
                        {t('composer.issues.heading')}
                    </p>
                    <ul className="flex list-disc flex-col gap-0.5 ps-6">
                        {shownIssues.map((issue, index) => (
                            <li
                                key={`${issue.key}-${index}`}
                                className="text-caption text-warning-700"
                            >
                                {issueText(issue)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Actions */}
            <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    disable={saving}
                    onClick={() => submit('DRAFT')}
                >
                    {pendingAction === 'DRAFT' ? t('composer.saving') : t('composer.saveDraft')}
                </MyButton>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    {isAdmin ? (
                        <>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                className="gap-1.5"
                                disable={saving}
                                onClick={() => {
                                    setAttempted('publish');
                                    setAttemptedAction('POST_NOW');
                                    if (publishIssues.length === 0) setConfirmNow(true);
                                }}
                            >
                                <PaperPlaneTilt size={16} aria-hidden />
                                {pendingAction === 'POST_NOW'
                                    ? t('composer.saving')
                                    : t('composer.postNow')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                className="gap-1.5"
                                disable={saving}
                                onClick={() => submit('SCHEDULE')}
                            >
                                <Clock size={16} aria-hidden />
                                {pendingAction === 'SCHEDULE'
                                    ? t('composer.saving')
                                    : t('composer.schedulePost')}
                            </MyButton>
                        </>
                    ) : (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            className="gap-1.5"
                            disable={saving}
                            onClick={() => submit('SUBMIT')}
                        >
                            <CheckCircle size={16} aria-hidden />
                            {pendingAction === 'SUBMIT'
                                ? t('composer.saving')
                                : t('composer.submit')}
                        </MyButton>
                    )}
                </div>
            </div>
            {!isAdmin && (
                <p className="-mt-3 text-caption text-neutral-500">{t('composer.staffNote')}</p>
            )}

            <AlertDialog open={confirmNow} onOpenChange={setConfirmNow}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('confirm.postNow.title', { count: platforms.length })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('confirm.postNow.body', {
                                networks: platforms.map(label).join(', '),
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('actions.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-primary-500 text-white hover:bg-primary-400"
                            onClick={() => {
                                setConfirmNow(false);
                                submit('POST_NOW');
                            }}
                        >
                            {t('confirm.postNow.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
