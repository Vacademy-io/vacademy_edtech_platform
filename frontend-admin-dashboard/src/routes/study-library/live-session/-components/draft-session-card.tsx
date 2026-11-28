import { useTranslation } from 'react-i18next';
import {
    ArrowSquareOut,
    CalendarBlank,
    Clock,
    Copy,
    DotsThree,
    PencilSimple,
    QrCode,
    SignIn,
    Trash,
    VideoCamera,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { copyToClipboard } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-utils/helper';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { DraftSession, getSessionBySessionId } from '../-services/utils';
import { useLiveSessionStore } from '../schedule/-store/sessionIdstore';
import { useNavigate } from '@tanstack/react-router';
import { useSessionDetailsStore } from '../-store/useSessionDetailsStore';

import { useState, useEffect } from 'react';
import DeleteSessionDialog from './delete-session-dialog';
import type { SessionBySessionIdResponse } from '../-services/utils';
import { getSessionJoinLink, formatMeetingDate, formatClockTime } from '../-utils/live-sesstions';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    AccessBadge,
    hasAssignedTeacher,
    SessionBatches,
    SessionCardFooter,
    SessionCardHeading,
    SessionCardShell,
    SessionMetaDivider,
    SessionMetaItem,
    SessionMetaRow,
    SessionTeacher,
} from './session-card-shell';
import SessionQrDialog from './session-qr-dialog';

interface DraftSessionCardProps {
    session: DraftSession;
    /** Resolved once per page by the list, so avatars cost one lookup, not one per card. */
    avatarUrlByFileId?: Record<string, string>;
}

export default function DraftSessionCard({ session, avatarUrlByFileId }: DraftSessionCardProps) {
    const { t } = useTranslation('studyLibraryLiveSessionDraftSessionCard');
    const { t: tCard } = useTranslation('studyLibraryLiveSessionCard');
    // Local state for fetched session details
    const [scheduleInfo, setScheduleInfo] = useState<SessionBySessionIdResponse['schedule'] | null>(
        null
    );
    const { instituteDetails } = useInstituteDetailsStore();

    const joinLink = getSessionJoinLink(session, instituteDetails?.learner_portal_base_url ?? '');
    // Fetch detailed session info for draft to get accurate date/time
    useEffect(() => {
        getSessionBySessionId(session.session_id)
            .then((res) => setScheduleInfo(res.schedule))
            .catch((err) => console.error('Failed to fetch draft session details:', err));
    }, [session.session_id]);
    const batchNames = (session.package_session_details ?? [])
        .map((d) => `${d.level_name} ${d.package_name}`.trim())
        .filter(Boolean);
    const displayDate = formatMeetingDate(scheduleInfo?.meeting_date ?? session.meeting_date);
    const displayTime = formatClockTime(scheduleInfo?.start_time ?? session.start_time);
    const displayLastEntry = formatClockTime(
        scheduleInfo?.last_entry_time ?? session.last_entry_time
    );

    const navigate = useNavigate();
    const { setSessionId } = useLiveSessionStore();
    const { setSessionDetails } = useSessionDetailsStore();
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [qrDialogOpen, setQrDialogOpen] = useState(false);

    const handleEditSession = async () => {
        try {
            const details = await getSessionBySessionId(session?.session_id || '');
            setSessionId(details.sessionId);
            setSessionDetails(details);
            console.log('Session Details:', details);
            navigate({ to: `/study-library/live-session/schedule/step1` });
        } catch (error) {
            console.error('Failed to fetch session details:', error);
        }
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Always open the delete dialog, it will handle recurring vs non-recurring logic
        setDeleteDialogOpen(true);
    };

    const handleDeleteSuccess = () => {
        setDeleteDialogOpen(false);
    };

    const handleCardClick = () => {
        navigate({
            to: '/study-library/live-session/view/$sessionId',
            params: { sessionId: session?.session_id || '' },
        });
    };

    return (
        <SessionCardShell onClick={handleCardClick}>
            <SessionCardHeading
                title={session.title}
                subtitle={session.subject || null}
                badge={<AccessBadge accessLevel={session.access_level} />}
                actions={
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                layoutVariant="icon"
                                aria-label={t('viewDetails')}
                            >
                                <DotsThree size={20} weight="bold" />
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                                className="cursor-pointer gap-2"
                                onClick={() => setQrDialogOpen(true)}
                            >
                                <QrCode size={16} />
                                {tCard('actions.generateQrCode')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer gap-2"
                                onClick={() => copyToClipboard(joinLink)}
                            >
                                <Copy size={16} />
                                {tCard('actions.copyJoinLink')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="cursor-pointer gap-2"
                                onClick={() => {
                                    navigate({
                                        to: '/study-library/live-session/view/$sessionId',
                                        params: { sessionId: session?.session_id || '' },
                                    });
                                }}
                            >
                                <ArrowSquareOut size={16} />
                                {t('viewDetails')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer gap-2"
                                onClick={handleEditSession}
                            >
                                <PencilSimple size={16} />
                                {t('editLiveSession')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="cursor-pointer gap-2 text-danger-600 focus:text-danger-600"
                                onClick={handleDelete}
                            >
                                <Trash size={16} />
                                {t('deleteLiveSession')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                }
            />

            <SessionMetaRow>
                <SessionMetaItem
                    icon={<CalendarBlank size={16} />}
                    tone="primary"
                    label={tCard('meta.date')}
                    value={displayDate ?? t('notAvailable')}
                />
                <SessionMetaItem
                    icon={<Clock size={16} />}
                    tone="info"
                    label={tCard('meta.time')}
                    value={displayTime ?? t('notAvailable')}
                />
                <SessionMetaItem
                    icon={<SignIn size={16} />}
                    tone="danger"
                    label={tCard('meta.lastEntry')}
                    value={displayLastEntry ?? t('notAvailable')}
                />
                <SessionMetaItem
                    icon={<VideoCamera size={16} />}
                    tone="warning"
                    label={tCard('meta.meetingType')}
                    value={<span className="capitalize">{session.recurrence_type}</span>}
                />
            </SessionMetaRow>

            <SessionCardFooter>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-8 gap-y-3">
                    <SessionTeacher
                        instructors={session.instructors}
                        label={getTerminology(RoleTerms.Teacher, SystemTerms.Teacher)}
                        unassignedLabel={tCard('meta.teacherUnassigned')}
                        unknownLabel={tCard('meta.teacherUnknown')}
                        avatarUrlByFileId={avatarUrlByFileId}
                    />
                    {hasAssignedTeacher(session.instructors) && batchNames.length ? (
                        <SessionMetaDivider />
                    ) : null}
                    {batchNames.length ? (
                        <SessionBatches
                            batches={batchNames}
                            maxVisible={2}
                            label={getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch)}
                            moreLabel={(count) => tCard('batches.more', { count })}
                            lessLabel={tCard('batches.less')}
                        />
                    ) : null}
                </div>
                <div
                    className="flex shrink-0 items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                >
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="primary"
                        className="w-full sm:w-auto sm:!min-w-0 sm:px-5"
                        onClick={handleEditSession}
                    >
                        <PencilSimple size={16} className="mr-2" />
                        {t('editLiveSession')}
                    </MyButton>
                </div>
            </SessionCardFooter>
            <DeleteSessionDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
                sessionId={session.session_id}
                scheduleId={scheduleInfo?.schedule_id || undefined}
                isRecurring={session.recurrence_type !== 'once'}
                onSuccess={handleDeleteSuccess}
            />
            <SessionQrDialog
                open={qrDialogOpen}
                onOpenChange={setQrDialogOpen}
                joinLink={joinLink}
                sessionId={session.session_id}
                heading={tCard('qrHeading')}
            />
        </SessionCardShell>
    );
}
