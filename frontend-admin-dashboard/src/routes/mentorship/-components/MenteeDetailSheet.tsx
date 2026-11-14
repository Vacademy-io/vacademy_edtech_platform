import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
    BookOpenText,
    CalendarCheck,
    CalendarPlus,
    ChatCircle,
    EnvelopeSimple,
    NotePencil,
    Phone,
    PushPin,
    VideoCamera,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { createDirectConversation, describeDirectChatError } from '@/services/chat/chatApi';
import { reportApiError } from '@/lib/report-api-error';
import { useLearnerPackagesQuery } from '@/routes/manage-students/students-list/-services/getLearnerPackages';
import { useChatEnabled } from '@/hooks/use-chat-enabled';
import { CHAT_SETTINGS_LINK, messageActionTitle } from '../-utils/chat-availability';
import { useCreateNote, useMenteeCalls, useStudentTimeline } from '../-hooks/use-mentorship';
import { MentorAvatar } from './MentorAvatar';
import { ScheduleSessionDialog } from './ScheduleSessionDialog';
import type { MenteeDTO, MentorDTO } from '../-types/mentorship-types';

function fmt(v: string | number | null | undefined, locale: string): string {
    if (v == null) return '';
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(locale);
}

interface MenteeDetailSheetProps {
    mentee: MenteeDTO | null;
    instituteId: string | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The mentor this mentee belongs to — lets "Schedule 1:1" skip the mentor picker. */
    mentor?: MentorDTO | null;
    /** True when the viewer is the mentor themselves rather than an admin. */
    asMentor?: boolean;
    /** The viewing mentor's own booking slug, for the mentor-side schedule flow. */
    mentorSlug?: string | null;
}

/**
 * One learner's mentorship context, as a side panel.
 *
 * A side sheet rather than a modal on purpose: an admin scanning a mentor's student
 * table opens several in a row, and a sheet keeps the table visible behind it so they
 * never lose their place. Everything here is read from data the platform already
 * holds — course progress, the shared activity timeline, and booked calls.
 */
export function MenteeDetailSheet({
    mentee,
    instituteId,
    open,
    onOpenChange,
    mentor,
    asMentor = false,
    mentorSlug,
}: MenteeDetailSheetProps) {
    const { t, i18n } = useTranslation('mentorshipMenteeDetailSheet');
    const navigate = useNavigate();
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [messaging, setMessaging] = useState(false);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    // In-App Messages is off until an institute switches it on. The admin looking at
    // this panel is exactly who can turn it on, so the blocker is named rather than
    // the action quietly disappearing.
    const chat = useChatEnabled();

    const studentUserId = mentee?.student_user_id;
    const timeline = useStudentTimeline(open ? studentUserId : undefined);
    const calls = useMenteeCalls(open ? instituteId : undefined, open ? studentUserId : undefined);
    const createNote = useCreateNote();
    // The mentee's in-progress courses — gives the mentor real learning context.
    const learning = useLearnerPackagesQuery({
        instituteId: instituteId ?? '',
        userId: open ? (studentUserId ?? '') : '',
        type: 'PROGRESS',
        page: 0,
        size: 5,
    });

    const addNote = async () => {
        if (!note.trim() || !studentUserId) return;
        setSaving(true);
        try {
            await createNote.mutateAsync({ studentUserId, title: note.trim() });
            setNote('');
            toast.success(t('toast.noteAdded'));
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'add-mentee-note' },
                extra: { studentUserId },
                fallbackMessage: t('toast.addNoteFailed'),
            });
        } finally {
            setSaving(false);
        }
    };

    const message = async () => {
        if (!studentUserId || !mentee) return;
        setMessaging(true);
        try {
            const conv = await createDirectConversation({
                targetUserId: studentUserId,
                targetUserName: mentee.name ?? undefined,
                targetUserRole: 'STUDENT',
            });
            navigate({ to: '/chat', search: { conversationId: conv.id } });
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'open-mentee-chat' },
                extra: { studentUserId },
                // A 403 here is permanent (chat off, or a role pair the institute
                // forbids) — "try again" would be a lie.
                fallbackMessage: describeDirectChatError(error, t('toast.chatOpenFailed')),
            });
        } finally {
            setMessaging(false);
        }
    };

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent
                    side="right"
                    className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg"
                >
                    {mentee && (
                        <>
                            <SheetHeader className="space-y-0 border-b border-neutral-200 p-6 text-left">
                                <div className="flex items-start gap-3">
                                    <MentorAvatar
                                        fileId={mentee.profile_pic_file_id}
                                        name={mentee.name}
                                        className="size-12 shrink-0 text-body"
                                    />
                                    <div className="flex min-w-0 flex-col gap-0.5">
                                        <SheetTitle className="truncate text-title font-semibold text-neutral-700">
                                            {mentee.name || mentee.student_user_id}
                                        </SheetTitle>
                                        <SheetDescription className="flex flex-col gap-0.5">
                                            {mentee.email && (
                                                <span className="flex min-w-0 items-center gap-1.5 text-caption text-neutral-500">
                                                    <EnvelopeSimple size={12} className="shrink-0" />
                                                    <span className="truncate">{mentee.email}</span>
                                                </span>
                                            )}
                                            {mentee.mobile_number && (
                                                <span className="flex items-center gap-1.5 text-caption text-neutral-500">
                                                    <Phone size={12} className="shrink-0" />
                                                    {mentee.mobile_number}
                                                </span>
                                            )}
                                        </SheetDescription>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2 pt-4">
                                    <MyButton
                                        type="button"
                                        buttonType="primary"
                                        scale="small"
                                        onClick={() => setScheduleOpen(true)}
                                        title={t('schedule.buttonTitle')}
                                    >
                                        <CalendarPlus size={16} /> {t('schedule.button')}
                                    </MyButton>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={message}
                                        disable={!chat.enabled || messaging}
                                        title={messageActionTitle(chat.enabled)}
                                    >
                                        <ChatCircle size={16} /> {t('message.button')}
                                    </MyButton>
                                </div>
                                {!chat.enabled && !chat.isLoading && (
                                    <p className="pt-2 text-caption text-neutral-500">
                                        {t('message.off')}{' '}
                                        <Link
                                            {...CHAT_SETTINGS_LINK}
                                            className="font-medium text-primary-600 hover:text-primary-700"
                                        >
                                            {t('message.turnOn')}
                                        </Link>{' '}
                                        {t('message.offSuffix')}
                                    </p>
                                )}
                            </SheetHeader>

                            <div className="flex flex-col gap-6 p-6">
                                <section className="flex flex-col gap-3">
                                    <div className="flex items-center gap-1.5">
                                        <BookOpenText size={16} className="text-neutral-400" />
                                        <span className="text-body font-semibold text-neutral-700">
                                            {t('sections.learning')}
                                        </span>
                                    </div>
                                    {learning.isLoading ? (
                                        <Skeleton className="h-12 w-full rounded-md" />
                                    ) : (learning.data?.content?.length ?? 0) === 0 ? (
                                        <span className="text-caption text-neutral-400">
                                            {t('learning.empty')}
                                        </span>
                                    ) : (
                                        <div className="flex flex-col gap-3">
                                            {(learning.data?.content ?? []).map((c) => {
                                                const pct = Math.min(
                                                    Math.max(c.percentage_completed ?? 0, 0),
                                                    100
                                                );
                                                return (
                                                    <div
                                                        key={c.package_session_id ?? c.id}
                                                        className="flex flex-col gap-1"
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="text-body text-neutral-700">
                                                                {c.package_name}
                                                            </span>
                                                            <span className="text-caption tabular-nums text-neutral-500">
                                                                {Math.round(pct)}%
                                                            </span>
                                                        </div>
                                                        <Progress value={pct} className="h-1.5" />
                                                        {c.level_name && (
                                                            <span className="text-caption text-neutral-400">
                                                                {c.level_name}
                                                            </span>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </section>

                                <section className="flex flex-col gap-3">
                                    <div className="flex items-center gap-1.5">
                                        <CalendarCheck size={16} className="text-neutral-400" />
                                        <span className="text-body font-semibold text-neutral-700">
                                            {t('sections.scheduledCalls')}
                                        </span>
                                    </div>
                                    {calls.isLoading ? (
                                        <Skeleton className="h-12 w-full rounded-md" />
                                    ) : (calls.data?.length ?? 0) === 0 ? (
                                        <span className="text-caption text-neutral-400">
                                            {t('calls.empty')}
                                        </span>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {(calls.data ?? []).map((c) => (
                                                <div
                                                    key={c.id}
                                                    className="flex items-center justify-between gap-2 rounded-md border border-neutral-100 p-3"
                                                >
                                                    <div className="flex min-w-0 flex-col">
                                                        <span className="truncate text-body text-neutral-700">
                                                            {c.booking_page_title || t('calls.defaultTitle')}
                                                        </span>
                                                        <span className="text-caption text-neutral-400">
                                                            {fmt(c.scheduled_start_utc, i18n.language)} ·{' '}
                                                            {c.status}
                                                        </span>
                                                    </div>
                                                    {c.meet_link && (
                                                        <a
                                                            href={c.meet_link}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="flex shrink-0 items-center gap-1 text-caption text-primary-600 hover:text-primary-700"
                                                        >
                                                            <VideoCamera size={14} /> {t('calls.join')}
                                                        </a>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>

                                <section className="flex flex-col gap-3">
                                    <div className="flex items-center gap-1.5">
                                        <NotePencil size={16} className="text-neutral-400" />
                                        <span className="text-body font-semibold text-neutral-700">
                                            {t('sections.notes')}
                                        </span>
                                    </div>
                                    <p className="-mt-2 text-caption text-neutral-400">
                                        {t('notes.sharedHint')}
                                    </p>
                                    <div className="flex items-end gap-2">
                                        <div className="flex-1">
                                            <MyInput
                                                input={note}
                                                onChangeFunction={(
                                                    e: React.ChangeEvent<HTMLInputElement>
                                                ) => setNote(e.target.value)}
                                                inputType="text"
                                                inputPlaceholder={t('notes.addPlaceholder')}
                                                label={t('notes.label')}
                                                className="sm:w-full"
                                            />
                                        </div>
                                        <MyButton
                                            type="button"
                                            buttonType="primary"
                                            scale="medium"
                                            onClick={addNote}
                                            disable={saving || !note.trim()}
                                        >
                                            {t('notes.add')}
                                        </MyButton>
                                    </div>
                                    {timeline.isLoading ? (
                                        <Skeleton className="h-12 w-full rounded-md" />
                                    ) : (timeline.data?.length ?? 0) === 0 ? (
                                        <span className="text-caption text-neutral-400">
                                            {t('notes.empty')}
                                        </span>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {(timeline.data ?? []).map((ev) => (
                                                <div
                                                    key={ev.id}
                                                    className="rounded-md border border-neutral-100 p-3"
                                                >
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-body text-neutral-700">
                                                            {ev.title}
                                                        </span>
                                                        {ev.is_pinned && (
                                                            <PushPin
                                                                size={14}
                                                                weight="fill"
                                                                className="text-primary-500"
                                                            />
                                                        )}
                                                    </div>
                                                    {ev.description && (
                                                        <p className="text-caption text-neutral-500">
                                                            {ev.description}
                                                        </p>
                                                    )}
                                                    <span className="text-caption text-neutral-400">
                                                        {ev.actor_name ? `${ev.actor_name} · ` : ''}
                                                        {fmt(ev.created_at, i18n.language)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </div>
                        </>
                    )}
                </SheetContent>
            </Sheet>

            {mentee && (
                <ScheduleSessionDialog
                    instituteId={instituteId}
                    open={scheduleOpen}
                    onOpenChange={setScheduleOpen}
                    asMentor={asMentor}
                    mentor={mentor}
                    mentorSlug={mentorSlug}
                    student={{ user_id: mentee.student_user_id, name: mentee.name }}
                />
            )}
        </>
    );
}
