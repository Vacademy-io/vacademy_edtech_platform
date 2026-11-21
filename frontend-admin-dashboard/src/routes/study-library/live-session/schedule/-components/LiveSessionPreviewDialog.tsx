import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Article,
    BellRinging,
    EyeSlash,
    Globe,
    Lightning,
    UsersThree as UsersThreeIcon,
    Warning,
} from '@phosphor-icons/react';
import { buildStreamingOptions } from '../-constants/options';

export type PreviewSelectedLevel = {
    courseId: string;
    sessionId: string;
    levelId: string;
};

export type PreviewCourseInfo = {
    courseName: string;
    courseId: string;
    sessionId: string;
    levels: Array<{ name: string; id: string }>;
};

export type PreviewSessionRow = {
    title?: string;
    subject?: string;
    startDate?: string;
    startTime?: string;
    /** Overrides date+time rendering in the When column. Use for recurring labels like "Every Monday · 10:00". */
    whenLabel?: string;
    /** Optional secondary line under whenLabel (e.g., "Until 30 Jun 2026"). */
    whenSubLabel?: string;
    durationHours?: string | number;
    durationMinutes?: string | number;
    link?: string;
    platform?: string;
    selectedLevels?: PreviewSelectedLevel[];
    /** Per-row description HTML (used for bulk where each row may differ). */
    description?: string;
};

export type PreviewSessionFeatures = {
    enableWaitingRoom?: boolean;
    waitingRoomMinutes?: string | number;
    allowRewind?: boolean;
    allowPause?: boolean;
    enableFeedback?: boolean;
    recordSession?: boolean;
};

export type PreviewNotifications = {
    notifyBy?: {
        mail?: boolean;
        whatsapp?: boolean;
        push_notification?: boolean;
        system_notification?: boolean;
    };
    notifySettings?: {
        onCreate?: boolean;
        beforeLiveTime?: Array<{ time: string }>;
        onLive?: boolean;
        onAttendance?: boolean;
    };
};

export type PreviewRecurrenceBanner = {
    /** Short pattern label, e.g. "Recurring weekly". */
    pattern: string;
    /** Selected day chips (e.g., ["Mon", "Wed", "Fri"]). */
    days?: string[];
    /** Optional end-date label (e.g., "Until 30 Jun 2026"). */
    until?: string;
    /** Optional total slot count (e.g., "6 sessions/week"). */
    totalLabel?: string;
};

interface LiveSessionPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    submitting: boolean;
    onConfirm: () => void | Promise<void>;
    timeZone?: string;
    accessType?: string;
    sessionFeatures?: PreviewSessionFeatures;
    notifications?: PreviewNotifications;
    sessions: PreviewSessionRow[];
    /** Only meaningful in bulk mode. When undefined the validity badge / warning are hidden. */
    validCount?: number;
    courses: PreviewCourseInfo[];
    sessionList: Array<{ id: string; name: string }>;
    /** When set, renders a recurrence summary banner above the sessions table. */
    recurrenceBanner?: PreviewRecurrenceBanner;
    /**
     * Class-level description HTML rendered as its own section above the sessions
     * table. Use for single-class and recurring previews where every "row"
     * shares the same description. For bulk where rows differ, set
     * `description` per row instead.
     */
    topLevelDescription?: string;
    title?: string;
    description?: string;
    confirmLabel?: string;
    submittingLabel?: string;
    backLabel?: string;
    footerNote?: string;
    /**
     * Institute runs live classes in "attendance only" mode
     * (LIVE_SESSION_SETTING.attendanceOnlyMode): learners won't see these
     * classes, only their attendance. Renders a notice so the admin knows.
     */
    attendanceOnly?: boolean;
}

export function LiveSessionPreviewDialog({
    open,
    onOpenChange,
    submitting,
    onConfirm,
    timeZone,
    accessType,
    sessionFeatures,
    notifications,
    sessions,
    validCount,
    courses,
    sessionList,
    recurrenceBanner,
    topLevelDescription,
    title: titleProp,
    description: descriptionProp,
    confirmLabel: confirmLabelProp,
    submittingLabel: submittingLabelProp,
    backLabel: backLabelProp,
    footerNote,
    attendanceOnly = false,
}: LiveSessionPreviewDialogProps) {
    const { t, i18n } = useTranslation([
        'studyLibraryLiveSessionPreviewDialog',
        'studyLibraryOptions',
    ]);
    const STREAMING_OPTIONS = buildStreamingOptions(t);
    const title = titleProp ?? t('reviewAndConfirm');
    const description = descriptionProp ?? t('reviewAndConfirmDescription');
    const confirmLabel = confirmLabelProp ?? t('confirmAndCreate');
    const submittingLabel = submittingLabelProp ?? t('creating');
    const backLabel = backLabelProp ?? t('backToEdit');
    const totalSessions = sessions.length;
    const features = sessionFeatures ?? {};
    const notifyBy = notifications?.notifyBy ?? {};
    const notifySettings = notifications?.notifySettings ?? {};

    const channelLabels = [
        notifyBy.mail ? t('channels.email') : null,
        notifyBy.whatsapp ? t('channels.whatsapp') : null,
        notifyBy.push_notification ? t('channels.push') : null,
        notifyBy.system_notification ? t('channels.system') : null,
    ].filter(Boolean) as string[];

    const triggerLabels: string[] = [];
    if (notifySettings.onCreate) triggerLabels.push(t('triggers.onCreate'));
    // This dialog re-renders on every notification toggle (its props are
    // watch()ed), so guard against any malformed reminder entry (null / missing
    // `time`) reaching here — accessing `.time` on a bad element would throw
    // during render and trip the route-level "System Crashed" page.
    const beforeTimes = (notifySettings.beforeLiveTime ?? []).filter(
        (bt): bt is { time: string } => !!bt && typeof bt.time === 'string' && bt.time.length > 0
    );
    if (beforeTimes.length > 0) {
        triggerLabels.push(
            t('triggers.beforeLive', { times: beforeTimes.map((bt) => bt.time).join(', ') })
        );
    }
    if (notifySettings.onLive) triggerLabels.push(t('triggers.onLive'));
    if (notifySettings.onAttendance) triggerLabels.push(t('triggers.onAttendance'));

    const playbackLabel = (() => {
        const blocked = [
            features.allowRewind ? null : t('playback.rewind'),
            features.allowPause ? null : t('playback.pause'),
        ].filter(Boolean);
        return blocked.length === 0
            ? t('playback.unrestricted')
            : t('playback.blocked', { items: blocked.join(', ') });
    })();

    const showValidBadge = typeof validCount === 'number' && validCount < totalSessions;
    const missingCount =
        typeof validCount === 'number' ? Math.max(0, totalSessions - validCount) : 0;

    // RichTextEditor produces HTML even for empty content (e.g. "<p></p>"), so
    // strip tags before deciding whether a description is "really" present.
    const hasContent = (html?: string) => !!(html ?? '').replace(/<[^>]*>/g, '').trim();
    const showTopLevelDescription = hasContent(topLevelDescription);
    const perRowDescriptions = sessions
        .map((row, idx) => ({ idx, row, html: row.description ?? '' }))
        .filter(({ html }) => hasContent(html));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-[1200px] flex-col gap-0 p-0 sm:w-[95vw]">
                {/* Header */}
                <div className="flex flex-col gap-3 border-b border-neutral-200 px-6 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="flex size-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700">
                                <Lightning size={20} />
                            </div>
                            <div>
                                <DialogTitle className="text-lg font-semibold text-neutral-800">
                                    {title}
                                </DialogTitle>
                                <DialogDescription className="text-sm text-neutral-500">
                                    {description}
                                </DialogDescription>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge
                                variant="secondary"
                                className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700"
                            >
                                {t('sessionCount', { count: totalSessions })}
                            </Badge>
                            {showValidBadge && (
                                <Badge
                                    variant="outline"
                                    className="rounded-full px-3 py-1 text-xs font-normal text-neutral-500"
                                >
                                    {t('fullyFilledCount', { count: validCount })}
                                </Badge>
                            )}
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5">
                    {attendanceOnly && (
                        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3">
                            <EyeSlash size={18} className="mt-0.5 shrink-0 text-warning-700" />
                            <div>
                                <div className="text-sm font-semibold text-warning-800">
                                    {t('attendanceOnly.title')}
                                </div>
                                <div className="mt-0.5 text-xs text-warning-700">
                                    {t('attendanceOnly.description')}
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="grid gap-3 lg:grid-cols-3">
                        {/* Schedule */}
                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                <Globe size={14} />
                                {t('schedule')}
                            </div>
                            <dl className="mt-3 space-y-2 text-sm">
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-neutral-500">{t('timezone')}</dt>
                                    <dd className="font-medium text-neutral-800">
                                        {timeZone || '—'}
                                    </dd>
                                </div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-neutral-500">{t('access')}</dt>
                                    <dd className="font-medium capitalize text-neutral-800">
                                        {accessType || '—'}
                                    </dd>
                                </div>
                            </dl>
                        </div>

                        {/* Session features */}
                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                <UsersThreeIcon size={14} />
                                {t('sessionFeatures')}
                            </div>
                            <dl className="mt-3 space-y-2 text-sm">
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-neutral-500">{t('waitingRoom')}</dt>
                                    <dd className="font-medium text-neutral-800">
                                        {features.enableWaitingRoom
                                            ? t('waitingRoomOpensBefore', {
                                                  minutes: features.waitingRoomMinutes ?? '—',
                                              })
                                            : t('disabled')}
                                    </dd>
                                </div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-neutral-500">{t('playbackLabel')}</dt>
                                    <dd className="font-medium text-neutral-800">
                                        {playbackLabel}
                                    </dd>
                                </div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-neutral-500">{t('feedback')}</dt>
                                    <dd className="font-medium text-neutral-800">
                                        {features.enableFeedback
                                            ? t('defaultForm')
                                            : t('off')}
                                    </dd>
                                </div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <dt className="text-neutral-500">{t('recording')}</dt>
                                    <dd className="font-medium text-neutral-800">
                                        {features.recordSession ? t('on') : t('off')}
                                    </dd>
                                </div>
                            </dl>
                        </div>

                        {/* Notifications */}
                        <div className="rounded-lg border border-neutral-200 bg-white p-4">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                <BellRinging size={14} />
                                {t('notifications')}
                            </div>
                            <div className="mt-3 space-y-3 text-sm">
                                <div>
                                    <div className="text-xs text-neutral-500">{t('channelsLabel')}</div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {channelLabels.length === 0 ? (
                                            <span className="text-xs text-neutral-400">
                                                {t('none')}
                                            </span>
                                        ) : (
                                            channelLabels.map((c) => (
                                                <Badge
                                                    key={c}
                                                    variant="secondary"
                                                    className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-normal text-neutral-700"
                                                >
                                                    {c}
                                                </Badge>
                                            ))
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-neutral-500">{t('triggersLabel')}</div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {triggerLabels.length === 0 ? (
                                            <span className="text-xs text-neutral-400">
                                                {t('none')}
                                            </span>
                                        ) : (
                                            triggerLabels.map((t) => (
                                                <Badge
                                                    key={t}
                                                    variant="secondary"
                                                    className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-normal text-neutral-700"
                                                >
                                                    {t}
                                                </Badge>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {showTopLevelDescription && (
                        <div className="mt-5 rounded-lg border border-neutral-200 bg-white p-4">
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                <Article size={14} />
                                {t('description')}
                            </div>
                            <div
                                className="prose prose-sm max-w-none text-sm text-neutral-700"
                                dangerouslySetInnerHTML={{ __html: topLevelDescription ?? '' }}
                            />
                        </div>
                    )}

                    {recurrenceBanner && (
                        <div className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm font-semibold text-neutral-800">
                                    {recurrenceBanner.pattern}
                                </div>
                                {recurrenceBanner.totalLabel && (
                                    <span className="text-xs font-medium text-neutral-600">
                                        {recurrenceBanner.totalLabel}
                                    </span>
                                )}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-600">
                                {recurrenceBanner.days && recurrenceBanner.days.length > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-medium text-neutral-500">
                                            {t('daysLabel')}
                                        </span>
                                        <div className="flex flex-wrap gap-1">
                                            {recurrenceBanner.days.map((d) => (
                                                <span
                                                    key={d}
                                                    className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-700 ring-1 ring-neutral-300"
                                                >
                                                    {d}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {recurrenceBanner.until && (
                                    <span className="text-neutral-600">
                                        <span className="font-medium text-neutral-500">
                                            {t('endsLabel')}
                                        </span>{' '}
                                        {recurrenceBanner.until}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Sessions table */}
                    <div className="mt-5 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-neutral-800">
                            {recurrenceBanner
                                ? t('weeklySchedule')
                                : totalSessions === 1
                                  ? t('sessionToBeCreated')
                                  : t('sessionsToBeCreated')}
                        </h3>
                        <span className="text-xs text-neutral-500">
                            {recurrenceBanner
                                ? t('slotCount', { count: totalSessions })
                                : t('rowCount', { count: totalSessions })}
                        </span>
                    </div>
                    <div className="mt-2 overflow-hidden rounded-lg border border-neutral-200">
                        <div className="max-h-[360px] overflow-auto">
                            <Table className="min-w-[900px]">
                                <TableHeader className="sticky top-0 z-10 bg-neutral-50">
                                    <TableRow className="border-neutral-200">
                                        <TableHead className="w-10 text-[11px] uppercase tracking-wide text-neutral-500">
                                            #
                                        </TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-neutral-500">
                                            {t('table.title')}
                                        </TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-neutral-500">
                                            {t('table.subject')}
                                        </TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-neutral-500">
                                            {t('table.when')}
                                        </TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-neutral-500">
                                            {t('table.duration')}
                                        </TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-neutral-500">
                                            {t('table.platform')}
                                        </TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-neutral-500">
                                            {t('table.link')}
                                        </TableHead>
                                        <TableHead className="text-[11px] uppercase tracking-wide text-neutral-500">
                                            {t('table.batches')}
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sessions.map((row, idx) => {
                                        const platformLabel =
                                            STREAMING_OPTIONS.find((p) => p.value === row.platform)
                                                ?.label ??
                                            row.platform ??
                                            '—';
                                        const totalMins =
                                            Number(row.durationHours || '0') * 60 +
                                            Number(row.durationMinutes || '0');
                                        const durationLabel =
                                            totalMins >= 60
                                                ? t('durationHoursMinutes', {
                                                      hours: Math.floor(totalMins / 60),
                                                      minutes: totalMins % 60,
                                                  })
                                                : t('durationMinutes', { minutes: totalMins });
                                        const rowLevels = row.selectedLevels ?? [];
                                        const batchLabels = rowLevels.map((sl) => {
                                            const course = courses.find(
                                                (c) =>
                                                    c.courseId === sl.courseId &&
                                                    c.sessionId === sl.sessionId
                                            );
                                            const sessionEntry = sessionList.find(
                                                (s) => s.id === sl.sessionId
                                            );
                                            const levelName = course?.levels
                                                .find((l) => l.id === sl.levelId)
                                                ?.name?.trim();
                                            const courseName =
                                                course?.courseName?.trim() || t('courseFallback');
                                            const sessionName = sessionEntry?.name?.trim();
                                            const levelIsGeneric =
                                                !levelName || levelName.toLowerCase() === 'default';
                                            const pill = levelIsGeneric
                                                ? courseName
                                                : `${courseName} · ${levelName}`;
                                            const tooltip = [courseName, sessionName, levelName]
                                                .filter(Boolean)
                                                .join(' / ');
                                            return { pill, tooltip };
                                        });
                                        const formattedDate = (() => {
                                            if (!row.startDate) return '—';
                                            try {
                                                const d = new Date(
                                                    `${row.startDate}T${row.startTime || '00:00'}`
                                                );
                                                return d.toLocaleDateString(i18n.language, {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    year: 'numeric',
                                                });
                                            } catch {
                                                return row.startDate;
                                            }
                                        })();
                                        return (
                                            <TableRow
                                                key={idx}
                                                className="text-xs hover:bg-neutral-50"
                                            >
                                                <TableCell className="text-center text-neutral-500">
                                                    {idx + 1}
                                                </TableCell>
                                                <TableCell className="font-medium text-neutral-800">
                                                    {row.title || (
                                                        <span className="text-danger-500">
                                                            {t('emptyTitle')}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-neutral-600">
                                                    {row.subject || '—'}
                                                </TableCell>
                                                <TableCell className="text-neutral-600">
                                                    <div className="flex flex-col">
                                                        <span className="text-neutral-800">
                                                            {row.whenLabel ?? formattedDate}
                                                        </span>
                                                        <span className="text-[11px] text-neutral-500">
                                                            {row.whenLabel
                                                                ? row.whenSubLabel ?? ''
                                                                : row.startTime || '—'}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-neutral-600">
                                                    {durationLabel}
                                                </TableCell>
                                                <TableCell className="text-neutral-600">
                                                    {platformLabel}
                                                </TableCell>
                                                <TableCell className="max-w-[200px] truncate text-neutral-600">
                                                    {row.link ? (
                                                        <span title={row.link}>{row.link}</span>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </TableCell>
                                                <TableCell className="max-w-[260px]">
                                                    {batchLabels.length === 0 ? (
                                                        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
                                                            {t('noBatches')}
                                                        </span>
                                                    ) : (
                                                        <div className="flex flex-wrap gap-1">
                                                            {batchLabels.map((b, i) => (
                                                                <span
                                                                    key={`${rowLevels[i]!.courseId}-${rowLevels[i]!.sessionId}-${rowLevels[i]!.levelId}`}
                                                                    title={b.tooltip}
                                                                    className="inline-flex max-w-[180px] items-center truncate rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700"
                                                                >
                                                                    {b.pill}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {perRowDescriptions.length > 0 && (
                        <div className="mt-5">
                            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                <Article size={14} />
                                {perRowDescriptions.length === 1
                                    ? t('description')
                                    : t('perClassDescriptions')}
                            </div>
                            <div className="flex flex-col gap-2">
                                {perRowDescriptions.map(({ idx, row, html }) => (
                                    <div
                                        key={idx}
                                        className="rounded-lg border border-neutral-200 bg-white p-3"
                                    >
                                        {perRowDescriptions.length > 1 && (
                                            <div className="mb-1 text-[11px] font-medium text-neutral-500">
                                                #{idx + 1}
                                                {row.title?.trim() ? ` · ${row.title.trim()}` : ''}
                                            </div>
                                        )}
                                        <div
                                            className="prose prose-sm max-w-none text-sm text-neutral-700"
                                            dangerouslySetInnerHTML={{ __html: html }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {showValidBadge && missingCount > 0 && (
                        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            <Warning size={14} className="mt-0.5 shrink-0" />
                            <span>{t('missingFieldsWarning', { count: missingCount })}</span>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50/60 px-6 py-3">
                    <span className="text-xs text-neutral-500">
                        {footerNote ??
                            (recurrenceBanner
                                ? t('footerNote.recurring', { count: totalSessions })
                                : totalSessions === 1
                                  ? t('footerNote.single')
                                  : t('footerNote.multiple', { count: totalSessions }))}
                    </span>
                    <div className="flex gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            onClick={() => onOpenChange(false)}
                            disable={submitting}
                        >
                            {backLabel}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            disable={submitting}
                            onClick={() => {
                                void onConfirm();
                            }}
                        >
                            {submitting ? submittingLabel : confirmLabel}
                        </MyButton>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
