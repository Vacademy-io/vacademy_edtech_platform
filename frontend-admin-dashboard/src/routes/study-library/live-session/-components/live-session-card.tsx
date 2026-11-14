/* eslint-disable @typescript-eslint/no-unused-vars */
import {
    ArrowSquareOut,
    CalendarBlank,
    VideoCamera,
    Clock,
    Copy,
    DotsThree,
    GlobeHemisphereWest,
    PencilSimple,
    QrCode,
    Trash,
    UsersThree,
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
import { LiveSession } from '../schedule/-services/utils';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useCallback, useMemo, useRef, useState } from 'react';
import { fetchSessionDetails, SessionDetailsResponse } from '../-hooks/useSessionDetails';
import { useLiveSessionReport } from '../-hooks/useLiveSessionReport';
import { useLiveSessionStore } from '../schedule/-store/sessionIdstore';
import { useNavigate } from '@tanstack/react-router';
import { useSessionDetailsStore } from '../-store/useSessionDetailsStore';
import { DraftSession, getSessionBySessionId } from '../-services/utils';
import ParticipantDetailsDialog from './participant-details-dialog';
import DeleteSessionDialog from './delete-session-dialog';
import {
    describeTimeUntilStart,
    getSessionJoinLink,
    isHostWindowOpen,
} from '../-utils/live-sesstions';
import { useHostJoin } from '../-hooks/useHostJoin';
import { UtmLinkMenuItem } from '@/components/common/utm/utm-link-menu-item';
import { UtmBuilderDialog } from '@/components/common/utm/utm-builder-dialog';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
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
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { useServerTime } from '@/hooks/use-server-time';

interface LiveSessionCardProps {
    session: LiveSession;
    isDraft?: boolean;
    /** Resolved once per page by the list, so avatars cost one lookup, not one per card. */
    avatarUrlByFileId?: Record<string, string>;
}

export default function LiveSessionCard({
    session,
    isDraft = false,
    avatarUrlByFileId,
}: LiveSessionCardProps) {
    const { t: tCard } = useTranslation('studyLibraryLiveSessionCard');
    const [openDialog, setOpenDialog] = useState<boolean>(false);
    const [openDeleteDialog, setOpenDeleteDialog] = useState<boolean>(false);
    const [openUtmDialog, setOpenUtmDialog] = useState<boolean>(false);
    const [openQrDialog, setOpenQrDialog] = useState<boolean>(false);
    const [confirmEarlyStart, setConfirmEarlyStart] = useState<boolean>(false);

    const [scheduledSessionDetails, setScheduleSessionDetails] =
        useState<SessionDetailsResponse | null>(null);
    const { instituteDetails } = useInstituteDetailsStore();

    // Use server time hook for accurate time reference
    const { getUserTimezone } = useServerTime();

    const normalizeTime = (t: string) => {
        if (t.includes('T')) {
            const afterT = t.split('T')[1] || t;
            return afterT.replace(/[+-]\d{2}:\d{2}$|Z$/, '');
        }
        return t.replace(/[+-]\d{2}:\d{2}$|Z$/, '');
    };

    const getSessionTimeInfo = useCallback(() => {
        const sessionTimezone = session.timezone || 'Asia/Kolkata';
        const userTimezone = getUserTimezone();

        const sessionStartString = `${session.meeting_date}T${normalizeTime(session.start_time)}`;
        const sessionEndString = `${session.meeting_date}T${normalizeTime(session.last_entry_time)}`;

        const sessionStartTime = fromZonedTime(sessionStartString, sessionTimezone);
        const sessionEndTime = fromZonedTime(sessionEndString, sessionTimezone);

        // Format times for display
        const sessionTimeFormatted = formatInTimeZone(
            sessionStartTime,
            sessionTimezone,
            'yyyy-dd-MM h:mm a'
        );
        const localTimeFormatted = formatInTimeZone(
            sessionStartTime,
            userTimezone,
            'yyyy-dd-MM h:mm a'
        );
        const sessionEndTimeFormatted = formatInTimeZone(sessionEndTime, sessionTimezone, 'h:mm a');
        const localEndTimeFormatted = formatInTimeZone(sessionEndTime, userTimezone, 'h:mm a');

        // Card-facing labels. The card used to print the date and time ONLY when
        // the session's timezone differed from the viewer's — so for the common
        // case (both Asia/Kolkata) a session card showed no date or time at all.
        const dateLabel = formatInTimeZone(sessionStartTime, sessionTimezone, 'EEE, dd MMM yyyy');
        const timeRangeLabel = `${formatInTimeZone(sessionStartTime, sessionTimezone, 'h:mm a')} – ${sessionEndTimeFormatted}`;

        return {
            sessionTimezone,
            userTimezone,
            // Absolute instants, for the "can I start this now?" gate. The
            // formatted strings above are zone-local and cannot be compared.
            startInstant: sessionStartTime,
            endInstant: sessionEndTime,
            sessionTimeFormatted,
            localTimeFormatted,
            sessionEndTimeFormatted,
            localEndTimeFormatted,
            dateLabel,
            timeRangeLabel,
            isLocalTime: sessionTimezone === userTimezone,
        };
    }, [session, getUserTimezone]);

    const timeInfo = getSessionTimeInfo();
    // Use mutateAsync to ensure data is fetched before opening dialog
    const {
        mutateAsync: fetchReportAsync,
        data: reportResponse,
        isPending,
        error,
    } = useLiveSessionReport();

    const joinLink = getSessionJoinLink(session, instituteDetails?.learner_portal_base_url ?? '');
    const liveSessionTerm = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const teacherTerm = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
    const batchNames = (session.package_session_details ?? [])
        .map((d) => `${d.level_name} ${d.package_name}`.trim())
        .filter(Boolean);

    /**
     * The card's primary button.
     *
     * Opening the session page is NOT worth a button — clicking the card
     * already does that. So the slot goes to the thing you cannot otherwise do
     * from the list: start the class. It only appears inside the session's host
     * window (its own waiting-room lead, else 15 minutes) because on BBB and
     * Zoom "start" genuinely creates the meeting room.
     */
    const { resolveHostAction } = useHostJoin();
    const hostAction = useMemo(
        () =>
            resolveHostAction({
                sessionId: session.session_id,
                scheduleId: session.schedule_id,
                linkType: session.link_type,
                meetingLink: session.meeting_link,
                defaultClassLink: session.default_class_link,
            }),
        [resolveHostAction, session]
    );
    const hostWindowOpen = isHostWindowOpen(
        timeInfo.startInstant,
        timeInfo.endInstant,
        session.waiting_room_time
    );

    /**
     * Starting a BBB/Zoom class really does create the meeting room, so doing it
     * days early is a mistake worth catching — but hiding the button was worse:
     * it left the list with no way to start a class at all. So the button is
     * always here, and only the early case has to answer for itself.
     *
     * An external link opens a URL and creates nothing, so it never prompts.
     */
    const timeUntilStart = describeTimeUntilStart(timeInfo.startInstant);
    const runHostAction = async () => {
        if (!hostAction) return;
        if (hostAction.kind === 'host' && !hostWindowOpen) {
            setConfirmEarlyStart(true);
            return;
        }
        await hostAction.run();
    };

    const navigate = useNavigate();
    const { setSessionId, setIsEdit } = useLiveSessionStore();
    const { setSessionDetails } = useSessionDetailsStore();

    const handleEditSession = async () => {
        try {
            const details = await getSessionBySessionId(session?.session_id || '');
            setSessionId(details.sessionId);
            setSessionDetails(details);
            setIsEdit(true);
            console.log('Session Details:', details);
            navigate({ to: `/study-library/live-session/schedule/step1` });
        } catch (error) {
            console.error('Failed to fetch session details:', error);
        }
    };

    const handleDeleteSuccess = () => {
        // Close the confirmation dialog automatically
        setOpenDeleteDialog(false);
    };

    // Fetch details and report, then open dialog
    const handleOpenDialog = async () => {
        try {
            const details = await fetchSessionDetails(session.schedule_id);
            setScheduleSessionDetails(details);
            await fetchReportAsync({
                sessionId: session.session_id,
                scheduleId: session.schedule_id,
                accessType: session.access_level,
            });
            setOpenDialog(true);
        } catch (err) {
            console.error('Error loading participant details:', err);
        }
    };

    const handleOpenDeleteDialog = () => {
        setOpenDeleteDialog(!openDeleteDialog);
    };
    const cardRef = useRef<HTMLDivElement>(null);

    // MyDialog portals to document.body, but Radix re-bubbles synthetic events
    // through the React tree — so clicks on the dialog's X button, header,
    // footer, or backdrop would otherwise fire this handler and navigate away.
    // Guard by checking the click's DOM target actually lives inside the card.
    const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current?.contains(e.target as Node)) return;
        navigate({
            to: '/study-library/live-session/view/$sessionId',
            params: { sessionId: session?.session_id || '' },
        });
    };

    return (
        <>
            <SessionCardShell cardRef={cardRef} onClick={handleCardClick}>
                <SessionCardHeading
                    title={session.title}
                    subtitle={session.subject || session.defaultClassName || null}
                    badge={<AccessBadge accessLevel={session.access_level} />}
                    actions={
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="secondary"
                                    layoutVariant="icon"
                                    aria-label={tCard('actions.viewDetails')}
                                >
                                    <DotsThree size={20} weight="bold" />
                                </MyButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem
                                    className="cursor-pointer gap-2"
                                    onClick={() => setOpenQrDialog(true)}
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
                                {/* Private sessions hand out an embed link that
                                    only an already-enrolled learner can open —
                                    there is no campaign traffic to attribute, so
                                    the builder is offered on public registration
                                    links only. */}
                                <UtmLinkMenuItem
                                    hidden={session.access_level === 'private' || !joinLink}
                                    onSelect={() => setOpenUtmDialog(true)}
                                />
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className="cursor-pointer gap-2"
                                    onClick={handleOpenDialog}
                                >
                                    <UsersThree size={16} />
                                    {tCard('actions.viewParticipants')}
                                </DropdownMenuItem>
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
                                    {tCard('actions.viewDetails')}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="cursor-pointer gap-2"
                                    onClick={handleEditSession}
                                >
                                    <PencilSimple size={16} />
                                    {tCard('actions.editSession', { term: liveSessionTerm })}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className="cursor-pointer gap-2 text-danger-600 focus:text-danger-600"
                                    onClick={handleOpenDeleteDialog}
                                >
                                    <Trash size={16} />
                                    {tCard('actions.deleteSession', { term: liveSessionTerm })}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    }
                />

                <SessionMetaRow>
                    <SessionMetaItem
                        icon={<CalendarBlank size={16} />}
                        tone="primary"
                        value={timeInfo.dateLabel}
                    />
                    <SessionMetaItem
                        icon={<Clock size={16} />}
                        tone="info"
                        value={timeInfo.timeRangeLabel}
                    />
                    <SessionMetaItem
                        icon={<GlobeHemisphereWest size={16} />}
                        tone="success"
                        value={timeInfo.sessionTimezone}
                    />
                    <SessionMetaDivider />
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
                            label={teacherTerm}
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
                                label={batchesTerm}
                                moreLabel={(count) => tCard('batches.more', { count })}
                                lessLabel={tCard('batches.less')}
                            />
                        ) : null}
                    </div>
                    <div
                        className="flex shrink-0 items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {hostAction ? (
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="primary"
                                className="w-full sm:w-auto sm:!min-w-0 sm:px-5"
                                onAsyncClick={runHostAction}
                            >
                                {hostAction.kind === 'host' ? (
                                    <>
                                        <VideoCamera size={16} weight="fill" className="mr-2" />
                                        {tCard('actions.startAsHost')}
                                    </>
                                ) : (
                                    <>
                                        <ArrowSquareOut size={16} className="mr-2" />
                                        {tCard('actions.openClassLink')}
                                    </>
                                )}
                            </MyButton>
                        ) : (
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                className="w-full sm:w-auto sm:!min-w-0 sm:px-5"
                                onClick={() => {
                                    navigate({
                                        to: '/study-library/live-session/view/$sessionId',
                                        params: { sessionId: session?.session_id || '' },
                                    });
                                }}
                            >
                                <ArrowSquareOut size={16} className="mr-2" />
                                {tCard('actions.openSession')}
                            </MyButton>
                        )}
                    </div>
                </SessionCardFooter>
            </SessionCardShell>
            <ParticipantDetailsDialog
                open={openDialog}
                onOpenChange={setOpenDialog}
                sessionId={session.session_id}
                accessLevel={session.access_level}
                report={reportResponse}
                isLoading={isPending}
                error={error as Error | null}
            />
            <UtmBuilderDialog
                open={openUtmDialog}
                onOpenChange={setOpenUtmDialog}
                baseUrl={joinLink}
                sourceType="LIVE_SESSION"
                entityName={session.title}
            />
            <DeleteSessionDialog
                open={openDeleteDialog}
                onOpenChange={setOpenDeleteDialog}
                sessionId={session.session_id}
                scheduleId={session.schedule_id}
                isRecurring={session.recurrence_type !== 'once'}
                onSuccess={handleDeleteSuccess}
            />
            <AlertDialog open={confirmEarlyStart} onOpenChange={setConfirmEarlyStart}>
                <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{tCard('earlyStart.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {timeUntilStart
                                ? tCard('earlyStart.bodyWithTime', { time: timeUntilStart })
                                : tCard('earlyStart.body')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{tCard('earlyStart.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={async () => {
                                setConfirmEarlyStart(false);
                                await hostAction?.run();
                            }}
                        >
                            {tCard('earlyStart.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <SessionQrDialog
                open={openQrDialog}
                onOpenChange={setOpenQrDialog}
                joinLink={joinLink}
                sessionId={session.session_id}
                heading={tCard('qrHeading')}
                accessLevel={session.access_level}
            />
        </>
    );
}
