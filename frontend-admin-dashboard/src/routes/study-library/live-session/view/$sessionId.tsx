import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { BASE_URL } from '@/constants/urls';
import { getPublicUrl } from '@/services/upload_file';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';
import { getSessionBySessionId, getLiveSessionReport, getScheduleRecordings, syncRecordingsFromBbb, syncRecordingsToS3, syncGoogleRecordings, processRecording, getTranscriptionStatus, getZoomProvisionStatus, provisionZoomNow, type ZoomProvisionStatus } from '../-services/utils';
import type { SessionBySessionIdResponse, LiveSessionReport, MeetingRecording, RecordingTranscriptionStatus, TranscriptStatus, AssessmentArtifact } from '../-services/utils';
import { CreateAssessmentFromRecordingModal } from '../-components/CreateAssessmentFromRecordingModal';
import { TranscriptActionsDialog } from '../-components/TranscriptActionsDialog';
import { ToolCostConfirmDialog } from '@/components/common/ai-credits/ToolCostConfirmDialog';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { enqueueYoutubeUpload, getYoutubeDefaults } from '@/routes/settings/-services/youtube-integration-service';
import { AttendanceMarkingTable } from '../-components/AttendanceMarkingTable';
import { FeedbackStats } from './-components/FeedbackStats';
// Migrated from lucide-react to @phosphor-icons/react per design-system
// governance (`docs/design-system/06-governance.md` — banned-icon-library
// rule). Phosphor uses slightly different names for some glyphs, so
// `as`-aliases keep all existing usage sites untouched.
import {
    CalendarDots as CalendarRange,
    Timer,
    UsersThree as UsersRound,
    Link as Link2,
    MonitorPlay,
    WarningCircle,
    MapPin,
    PencilSimple as Edit,
    ArrowLeft,
    CheckCircle as CheckCircle2,
    Copy,
    FileText,
    ShareNetwork as Share2,
    List,
    Calendar as CalendarIcon,
    Users,
    VideoCamera as Video,
    Play,
    DownloadSimple as Download,
    Clock,
    ArrowsClockwise as RefreshCw,
    CloudArrowDown as CloudDownload,
    Warning as AlertTriangle,
    FileAudio,
    Translate as Languages,
    Sparkle,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { SessionCalendarView } from '../-components/session-calendar-view';
import { format, addMinutes, isAfter, isBefore, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { MyButton } from '@/components/design-system/button';
import { useLiveSessionStore } from '../schedule/-store/sessionIdstore';
import { useSessionDetailsStore } from '../-store/useSessionDetailsStore';
import { toast } from 'sonner';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '@/components/ui/pagination';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { StreamingPlatform } from '../-constants/enums';
import { useHostJoin } from '../-hooks/useHostJoin';
import { getSessionJoinLink } from '../-utils/live-sesstions';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    AssignedTeacherCard,
    AttendanceStatTiles,
    LinkedBatchesCard,
    SessionStatusChips,
} from './-components/SessionDetailCards';
import { hasAssignedTeacher } from '../-components/session-card-shell';
import { getTerminology, getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { AddRecordingToCourseCard } from '../-components/content-linking/AddRecordingToCourseCard';
import { ClassMaterialsCard } from '../-components/content-linking/ClassMaterialsCard';
import { RecordingDriveUploadAction } from '../-components/RecordingDriveUploadAction';
import type { DestinationBatch } from '../-components/content-linking/SessionContentDestinationPicker';

export const Route = createFileRoute('/study-library/live-session/view/$sessionId')({
    component: ViewLiveSession,
});

interface GroupedSchedule {
    date: string;
    sessions: Array<{
        time: string;
        duration: string | number;
        link: string;
        id: string;
        status?: 'live' | 'upcoming' | 'past';
        startDate?: Date;
        default_class_link?: string | null;
        defaultClassName?: string | null;
        learner_button_config?: {
            text: string;
            url: string;
            background_color: string;
            text_color: string;
            visible: boolean;
        } | null;
        recordings?: MeetingRecording[];
    }>;
}

function ViewLiveSession() {
    const { sessionId } = Route.useParams();
    const navigate = useNavigate();
    // Institute-level "LMS Connection" toggles gate the recording→course and
    // class-materials entry points on this page.
    const { settings: instituteLiveSessionSettings } = useLiveSessionSettings();
    const [sessionData, setSessionData] = useState<SessionBySessionIdResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
    const [coverUrl, setCoverUrl] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('calendar');
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const { setSessionId, setIsEdit } = useLiveSessionStore();
    const { setSessionDetails } = useSessionDetailsStore();
    const [attendanceData, setAttendanceData] = useState<LiveSessionReport[] | null>(null);
    const [attendanceLoading, setAttendanceLoading] = useState(false);
    const [selectedScheduleForAttendance, setSelectedScheduleForAttendance] = useState<string | null>(null);
    const [recordingUrls, setRecordingUrls] = useState<Record<string, string>>({});
    const [refreshedRecordings, setRefreshedRecordings] = useState<Record<string, MeetingRecording[]>>({});
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);

    const instituteId = getCurrentInstituteId() ?? '';
    const { data: youtubeDefaults } = useQuery({
        queryKey: ['youtube-defaults', instituteId],
        queryFn: () => getYoutubeDefaults(instituteId),
        enabled: !!instituteId,
    });
    const youtubeFeatureEnabled = youtubeDefaults?.featureEnabled ?? false;

    useEffect(() => {
        const fetchSessionDetails = async () => {
            try {
                setLoading(true);
                const data = await getSessionBySessionId(sessionId);
                setSessionData(data);
            } catch (err) {
                console.error('Error fetching session details:', err);
                setError('Failed to load session details');
            } finally {
                setLoading(false);
            }
        };

        fetchSessionDetails();
    }, [sessionId]);

    useEffect(() => {
        const fetchMediaUrls = async () => {
            if (sessionData?.schedule) {
                if (sessionData.schedule.thumbnail_file_id) {
                    try {
                        const url = await getPublicUrl(sessionData.schedule.thumbnail_file_id);
                        setThumbnailUrl(url);
                    } catch (e) {
                        console.error('Failed to load thumbnail url', e);
                    }
                }
                if (sessionData.schedule.cover_file_id) {
                    try {
                        const url = await getPublicUrl(sessionData.schedule.cover_file_id);
                        setCoverUrl(url);
                    } catch (e) {
                        console.error('Failed to load cover url', e);
                    }
                }
            }
        };
        fetchMediaUrls();
    }, [sessionData]);

    const isBbbSession = sessionData?.schedule?.link_type === StreamingPlatform.BBB
        || sessionData?.schedule?.link_type === 'BBB_MEETING';
    const isZoomSession = sessionData?.schedule?.link_type === StreamingPlatform.ZOOM
        || sessionData?.schedule?.link_type === 'zoom';
    const isMeetSession = sessionData?.schedule?.link_type === StreamingPlatform.MEET
        || sessionData?.schedule?.link_type === 'google meet'
        || sessionData?.schedule?.link_type === 'GOOGLE_MEET';

    // Zoom / Google Meet provisioning status — surfaces the otherwise-silent async
    // provisioning failures so the admin can re-create the meeting in one click.
    const { instituteDetails } = useInstituteDetailsStore();
    const [showAttendanceDetail, setShowAttendanceDetail] = useState(false);
    const [provision, setProvision] = useState<ZoomProvisionStatus | null>(null);
    const [provisioning, setProvisioning] = useState(false);
    const provisionedPlatform = isZoomSession ? 'Zoom' : 'Google Meet';
    const provisionedItem = isZoomSession ? 'Zoom meeting' : 'Google Meet link';
    const providerAccount = isZoomSession ? 'Zoom account' : 'Google account';

    const loadProvision = useCallback(async () => {
        if (!(isZoomSession || isMeetSession) || !sessionId) return;
        try {
            setProvision(await getZoomProvisionStatus(sessionId));
        } catch {
            /* status is advisory — ignore fetch errors */
        }
    }, [isZoomSession, isMeetSession, sessionId]);

    useEffect(() => {
        loadProvision();
    }, [loadProvision]);

    const handleProvisionNow = async () => {
        setProvisioning(true);
        try {
            const res = await provisionZoomNow(sessionId);
            setProvision(res);
            if (res.pending === 0) {
                toast.success(`${provisionedItem} provisioned.`);
            } else {
                toast.error(
                    `Still ${res.pending} not set up — check the ${providerAccount} is connected (Settings → Live Session → Test Connection).`
                );
            }
            try {
                setSessionData(await getSessionBySessionId(sessionId));
            } catch {
                /* refresh is best-effort */
            }
        } catch {
            toast.error(
                `Could not provision the ${provisionedPlatform} meeting. Check the ${providerAccount} credentials.`
            );
        } finally {
            setProvisioning(false);
        }
    };

    // Reusable provisioning badge — rendered in both the one-time and recurring views.
    // Google Meet only when we create its links (a stored account); a pasted Meet link has
    // no provider meeting on any row and would otherwise read as "N of N not set up".
    const showProvisionBadge =
        (isZoomSession || (isMeetSession && provision?.managed === true)) &&
        !!provision &&
        provision.total > 0;
    const provisionBadge =
        showProvisionBadge && provision ? (
            provision.pending > 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
                    <div className="flex items-center gap-2 text-xs text-warning-700">
                        <WarningCircle className="size-4 shrink-0" weight="fill" />
                        <span>
                            {provision.pending} of {provision.total} {provisionedItem}
                            {provision.total === 1 ? '' : 's'} not set up yet.
                        </span>
                    </div>
                    <button
                        onClick={handleProvisionNow}
                        disabled={provisioning}
                        className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                    >
                        {provisioning ? 'Provisioning…' : 'Provision now'}
                    </button>
                </div>
            ) : (
                <div className="flex items-center gap-2 text-xs text-success-600">
                    <CheckCircle2 className="size-4 shrink-0" weight="fill" />
                    {provisionedItem} ready
                </div>
            )
        ) : null;

    // Host entry points live in useHostJoin so this page and the list cards
    // cannot disagree about how a provider is started. Kept as local aliases so
    // the call sites below read unchanged.
    const { startBbb, startZoom, startMeet, startZoho } = useHostJoin();
    const handleJoinAsHost = useCallback(
        (scheduleId: string, recreate = false) => startBbb(scheduleId, recreate),
        [startBbb]
    );
    const handleZoomStartAsHost = useCallback(
        (scheduleId: string) => startZoom(sessionId, scheduleId),
        [startZoom, sessionId]
    );
    const handleMeetStartAsHost = useCallback(
        (scheduleId: string) => startMeet(scheduleId),
        [startMeet]
    );

    const handleEditSession = async () => {
        try {
            // If sessionData is already loaded, use it. Otherwise fetch it.
            const details = sessionData || (await getSessionBySessionId(sessionId));
            setSessionId(details.schedule.session_id);
            setSessionDetails(details);
            setIsEdit(true);
            navigate({ to: '/study-library/live-session/schedule/step1' });
        } catch (err) {
            console.error('Failed to load session for editing:', err);
            toast.error('Failed to load session for editing');
        }
    };

    const handleViewAttendance = useCallback(async (scheduleId: string) => {
        if (selectedScheduleForAttendance === scheduleId && attendanceData) {
            // Toggle off
            setSelectedScheduleForAttendance(null);
            setAttendanceData(null);
            return;
        }
        setSelectedScheduleForAttendance(scheduleId);
        setAttendanceLoading(true);
        try {
            const data = await getLiveSessionReport(
                sessionId,
                scheduleId,
                sessionData?.schedule?.access_type || 'private'
            );
            setAttendanceData(data);
        } catch (err) {
            console.error('Failed to fetch attendance:', err);
            toast.error('Failed to load attendance report');
        } finally {
            setAttendanceLoading(false);
        }
    }, [sessionId, sessionData, selectedScheduleForAttendance, attendanceData]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    // Group schedules by date for calendar view
    /**
     * Single source of truth for "which host entry point does this schedule
     * get?", so the list and calendar views of a recurring session cannot
     * disagree. Returns null for platforms we cannot host into (the caller
     * falls back to the participant join link).
     */
    /**
     * Live / Upcoming / Past for the header chip. Derived from the session's own
     * window rather than the list's tab, because this page is reachable by URL
     * and has no tab context.
     */
    const sessionTimeStatus = useMemo(() => {
        const schedule = sessionData?.schedule;
        if (!schedule?.start_time) return null;
        const start = new Date(schedule.start_time);
        const end = schedule.last_entry_time ? new Date(schedule.last_entry_time) : null;
        if (Number.isNaN(start.getTime())) return null;
        const now = new Date();
        if (now < start) return 'Upcoming';
        if (end && !Number.isNaN(end.getTime()) && now > end) return 'Past';
        return 'Live';
    }, [sessionData]);

    /** Duration lives on the occurrence, not the session. For a one-time class
     *  that is the only occurrence; for a recurring one they share a duration. */
    const sessionDurationMins = useMemo(() => {
        const first = sessionData?.schedule?.added_schedules?.[0];
        const raw = first?.duration;
        const mins = typeof raw === 'string' ? Number(raw) : raw;
        return typeof mins === 'number' && Number.isFinite(mins) && mins > 0 ? mins : null;
    }, [sessionData]);

    const instructorTerm = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);

    const resolveHostAction = useCallback(
        (session: { id: string; linkType?: string | null }) => {
            // The session-level link_type is the fallback for occurrences that
            // do not carry their own (ss.link_type is nullable).
            const linkType = session.linkType ?? sessionData?.schedule?.link_type;
            const norm = (linkType ?? '').trim().toLowerCase();
            if (isBbbSession || norm === 'bbb' || norm === 'bbb_meeting') {
                return () => startBbb(session.id);
            }
            if (norm === 'zoom' || norm === 'zoom_meeting') {
                return () => startZoom(sessionId, session.id);
            }
            if (norm === 'google meet' || norm === 'google_meet' || norm === 'googlemeet') {
                return () => startMeet(session.id);
            }
            if (norm === 'zoho' || norm === 'zoho_meeting') {
                return () => startZoho(session.id, sessionData?.schedule?.default_meet_link);
            }
            return null;
        },
        [isBbbSession, sessionId, sessionData, startBbb, startZoom, startMeet, startZoho]
    );

    const groupedSchedules = useMemo(() => {
        if (!sessionData?.schedule?.added_schedules) return [];

        const grouped = new Map<string, GroupedSchedule['sessions']>();

        sessionData.schedule.added_schedules.forEach((schedule) => {
            const date = schedule.meetingDate || '';
            if (!date) return;

            if (!grouped.has(date)) {
                grouped.set(date, []);
            }

            // Calculate status
            const now = new Date();
            // Assuming startTime is in HH:mm format and date is YYYY-MM-DD
            const startDateTime = new Date(`${date}T${schedule.startTime}`);
            const endDateTime = addMinutes(startDateTime, Number(schedule.duration));

            let status: 'live' | 'upcoming' | 'past' = 'past';
            if (isAfter(now, startDateTime) && isBefore(now, endDateTime)) {
                status = 'live';
            } else if (isBefore(now, startDateTime)) {
                status = 'upcoming';
            }

            let recordings: MeetingRecording[] = [];
            if (schedule.providerRecordingsJson) {
                try {
                    recordings = JSON.parse(schedule.providerRecordingsJson);
                } catch {
                    // ignore parse errors
                }
            }

            grouped.get(date)!.push({
                time: schedule.startTime,
                duration: schedule.duration,
                link: schedule.link,
                id: schedule.id,
                status,
                startDate: startDateTime,
                default_class_link: schedule.default_class_link,
                defaultClassName: schedule.default_class_name,
                learner_button_config: schedule.learner_button_config,
                recordings,
                // Per-schedule Zoom data so the UI can render "Start as Host" for
                // each Zoom schedule independently (admin opens host_url straight
                // into the meeting with no name/passcode prompts).
                linkType: (schedule as any).linkType ?? (schedule as any).link_type ?? null,
                providerHostUrl: (schedule as any).providerHostUrl ?? (schedule as any).provider_host_url ?? null,
            } as any);
        });

        // Convert to array and sort by date
        return Array.from(grouped.entries())
            .map(([date, sessions]) => ({
                date,
                sessions: sessions.sort((a, b) => a.time.localeCompare(b.time)),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [sessionData]);

    /**
     * Occurrences of a recurring session whose attendance can be opened: every
     * class that has STARTED, judged in the session's own timezone, newest first.
     *
     * Deliberately separate from the `status` above (browser clock, used by the
     * recording sync and host buttons). Waiting for `past` hid an offline class's
     * register until the class had ended, and an IST class viewed from London
     * turned `past` 4.5 hours late. Not opened before the start: saving notifies
     * the learner, so an early "absent" would land before the class even began.
     */
    const attendanceOccurrences = useMemo(() => {
        const tz = sessionData?.schedule?.timezone;
        const now = new Date();
        const startOf = (date: string, time: string): Date => {
            const local = `${date}T${time}`;
            if (tz) {
                try {
                    // An unknown zone string yields Invalid Date rather than throwing.
                    const zoned = fromZonedTime(local, tz);
                    if (!isNaN(zoned.getTime())) return zoned;
                } catch {
                    // Fall through to the browser's clock.
                }
            }
            return new Date(local);
        };
        let today = format(now, 'yyyy-MM-dd');
        if (tz) {
            try {
                today = formatInTimeZone(now, tz, 'yyyy-MM-dd');
            } catch {
                // Same fallback as above.
            }
        }
        return groupedSchedules
            .flatMap((day) =>
                day.sessions.map((s) => ({
                    id: s.id,
                    date: day.date,
                    time: s.time,
                    duration: s.duration,
                    start: startOf(day.date, s.time),
                    isToday: day.date === today,
                }))
            )
            .filter((occ) => !isNaN(occ.start.getTime()) && occ.start <= now)
            .sort((a, b) => b.start.getTime() - a.start.getTime());
    }, [groupedSchedules, sessionData]);
    const [showAllAttendanceDates, setShowAllAttendanceDates] = useState(false);
    /** First occurrence not yet started, for the empty-picker hint. */
    const nextAttendanceDate = useMemo(() => {
        const opened = new Set(attendanceOccurrences.map((o) => o.id));
        for (const day of groupedSchedules) {
            if (day.sessions.some((s) => !opened.has(s.id))) return day.date;
        }
        return null;
    }, [groupedSchedules, attendanceOccurrences]);

    /**
     * A one-time session has exactly one occurrence, so its attendance needs no
     * date picker — load it up front and let the tiles render with the page.
     * Worth the call even before the class runs: "Registered" is meaningful on
     * an upcoming session, which is the case the design shows.
     *
     * Recurring sessions keep the picker: there is no single occurrence to
     * summarise, and pre-fetching every date would be far more expensive.
     *
     * Recurrence is read off `sessionData` rather than the `isRecurring` const,
     * which is declared below the loading guards and so is out of reach here.
     */
    useEffect(() => {
        if (sessionData?.schedule?.recurrence_type === 'weekly') return;
        if (attendanceData || selectedScheduleForAttendance) return;
        const onlyScheduleId = groupedSchedules[0]?.sessions?.[0]?.id;
        if (!onlyScheduleId) return;
        void handleViewAttendance(onlyScheduleId);
    }, [
        sessionData,
        attendanceData,
        selectedScheduleForAttendance,
        groupedSchedules,
        handleViewAttendance,
    ]);

    /**
     * The occurrence a host would actually want to start right now: the one in
     * progress, else the next upcoming one. A recurring session has no single
     * meeting, which is why the details card offered no host entry point at all
     * and left the teacher holding only the participant join link.
     */
    /** The single occurrence of a one-time session, for the meeting strip. */
    const soleSession = useMemo(
        () => groupedSchedules.flatMap((day) => day.sessions)[0] ?? null,
        [groupedSchedules]
    );

    /** Link an admin can hand to a learner: whatever the session stored, else the
     *  same link the list cards build from access level + ids. */
    const shareableLink = useMemo(() => {
        const sch = sessionData?.schedule;
        if (!sch) return '';
        if (sch.join_link) return sch.join_link;
        if (sch.default_meet_link) return sch.default_meet_link;
        const scheduleId = sch.added_schedules?.[0]?.id ?? '';
        if (!scheduleId) return '';
        return getSessionJoinLink(
            {
                access_level: sch.access_type,
                session_id: sessionId,
                schedule_id: scheduleId,
            } as never,
            instituteDetails?.learner_portal_base_url ?? ''
        );
    }, [sessionData, sessionId, instituteDetails]);

    const currentOrNextSession = useMemo(() => {
        const all = groupedSchedules.flatMap((day) => day.sessions);
        const live = all.find((s) => s.status === 'live');
        if (live) return live;
        const upcoming = all
            .filter((s) => s.status === 'upcoming')
            .sort((a, b) => (a.startDate?.getTime() ?? 0) - (b.startDate?.getTime() ?? 0));
        return upcoming[0] ?? null;
    }, [groupedSchedules]);

    // Collect all recordings across all schedules
    const allRecordings = useMemo(() => {
        const recordings: Array<MeetingRecording & { date: string; scheduleId: string }> = [];
        groupedSchedules.forEach((day) => {
            day.sessions.forEach((session) => {
                // Prefer manually refreshed recordings over session-loaded ones
                const recs = refreshedRecordings[session.id] ?? session.recordings ?? [];
                recs.forEach((rec) => {
                    recordings.push({ ...rec, date: day.date, scheduleId: session.id });
                });
            });
        });
        return recordings;
    }, [groupedSchedules, refreshedRecordings]);

    // Track B — the live class's linked batches, pre-known from the session so
    // the teacher only picks Subject → Module → Chapter, never course/level/session.
    const contentLinkBatches = useMemo<DestinationBatch[]>(() => {
        const details = sessionData?.schedule?.package_session_details ?? [];
        return details.map((d) => ({
            packageSessionId: d.package_session_id,
            displayName: [d.package_name, d.level_name, d.session_name]
                .filter(Boolean)
                .join(' · '),
        }));
    }, [sessionData]);

    /** Batches on the session. Ids are the source of truth: the details
     *  array is an enrichment and can be empty while ids are populated. */
    const batchCount = Math.max(
        sessionData?.schedule?.package_session_ids?.length ?? 0,
        sessionData?.schedule?.package_session_details?.length ?? 0
    );

    /** Whether Class Materials shares the row with Attendance. When it does not,
     *  Attendance takes the full width rather than leaving a dead 2/5 gap. */
    const showClassMaterials =
        contentLinkBatches.length > 0 &&
        instituteLiveSessionSettings.lmsConnection.classMaterialsEnabled;

    // A single-schedule (non-recurring) session has one unambiguous scheduleId
    // to stamp on session-level materials; recurring sessions omit it.
    const soleScheduleId =
        groupedSchedules.length === 1 && groupedSchedules[0]?.sessions.length === 1
            ? groupedSchedules[0].sessions[0]!.id
            : undefined;

    // Resolve fileId to public URLs for recordings that have no playbackUrl
    useEffect(() => {
        const resolve = async () => {
            const toResolve = allRecordings.filter(
                (rec) => !rec.playbackUrl && !rec.downloadUrl && rec.fileId
            );
            if (toResolve.length === 0) return;

            const urls: Record<string, string> = {};
            for (const rec of toResolve) {
                try {
                    const url = await getPublicUrl(rec.fileId!);
                    urls[rec.fileId!] = url;
                } catch {
                    // ignore
                }
            }
            setRecordingUrls((prev) => ({ ...prev, ...urls }));
        };
        resolve();
    }, [allRecordings]);

    const formatDuration = (seconds: number) => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hrs > 0) return `${hrs}h ${mins}m`;
        return `${mins}m`;
    };

    const RECORDING_LABELS: Record<string, string> = {
        content: 'Presenter View',
        webcams: 'Webcam View',
        full: 'Full Recording',
        presentation: 'Presentation',
        video: 'Video',
    };

    // Sync from BBB: only available 2 hours after the earliest past session start time.
    const canShowSyncButton = useMemo(() => {
        const pastSessions = groupedSchedules.flatMap((day) =>
            day.sessions
                .filter((s) => s.status === 'past')
                .map((s) => {
                    try {
                        const dt = new Date(`${day.date}T${s.time ?? '00:00:00'}`);
                        return dt;
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean) as Date[]
        );
        if (pastSessions.length === 0) return false;
        const earliest = pastSessions.reduce((a, b) => (a < b ? a : b));
        const twoHoursAfter = new Date(earliest.getTime() + 2 * 60 * 60 * 1000);
        return new Date() >= twoHoursAfter;
    }, [groupedSchedules]);

    const handleSyncFromBbb = useCallback(async () => {
        const instituteId = sessionData?.schedule?.institute_id;
        if (!instituteId) return;
        setIsSyncing(true);
        try {
            const pastScheduleIds = groupedSchedules.flatMap((day) =>
                day.sessions.filter((s) => s.status === 'past').map((s) => s.id)
            );
            const uniqueIds = [...new Set(pastScheduleIds)];
            // Collect per-schedule results sequentially to avoid concurrent writes
            // to shared status/message variables (race condition with Promise.all).
            const results: Record<string, MeetingRecording[]> = {};
            let overallStatus = 'OK';
            let totalNew = 0;
            let totalFail = 0;
            let anySucceeded = false;
            let anyRecovering = false;
            let anyReprocessing = false;
            let anyNotFound = false;

            await Promise.all(
                uniqueIds.map(async (scheduleId) => {
                    try {
                        const result = await syncRecordingsFromBbb(scheduleId, instituteId);
                        results[scheduleId] = result.recordings;
                        anySucceeded = true;
                        // Severity ladder: BBB_OFFLINE > PARTIAL > REPROCESSING > RECOVERING > NOT_FOUND > OK
                        if (result.status === 'BBB_OFFLINE') overallStatus = 'BBB_OFFLINE';
                        else if (result.status === 'PARTIAL' && overallStatus !== 'BBB_OFFLINE')
                            overallStatus = 'PARTIAL';
                        if (result.status === 'REPROCESSING') anyReprocessing = true;
                        if (result.status === 'RECOVERING') anyRecovering = true;
                        if (result.status === 'NOT_FOUND') anyNotFound = true;
                        // Parse counts from the structured message to aggregate across schedules
                        const newMatch = result.message.match(/found (\d+) new/);
                        const failMatch = result.message.match(/(\d+) could not/);
                        if (newMatch) totalNew += parseInt(newMatch[1]!, 10);
                        if (failMatch) totalFail += parseInt(failMatch[1]!, 10);
                    } catch {
                        // Network/5xx — keep existing recordings for this schedule, don't alter status
                    }
                })
            );

            setRefreshedRecordings((prev) => ({ ...prev, ...results }));

            if (!anySucceeded) {
                // Every API call threw — network down or all 5xx
                toast.error('Sync failed. Recordings will appear automatically after the server processes them.');
            } else if (overallStatus === 'BBB_OFFLINE') {
                toast.warning('BBB server is currently offline. Recordings will appear once it\'s back online.');
            } else if (overallStatus === 'PARTIAL') {
                const msg = `Partially synced — ${totalNew} recording(s) synced, ${totalFail} could not be retrieved.`;
                toast.warning(msg);
            } else if (anyReprocessing) {
                toast.info(
                    'Recording is being re-uploaded from the meeting server. It should appear in 2–5 minutes — click Refresh to check.',
                    { duration: 8000 }
                );
            } else if (anyRecovering) {
                toast.info(
                    'Recording is being rebuilt on the meeting server. It should appear in about 10 minutes — click Refresh to check.',
                    { duration: 8000 }
                );
            } else if (totalNew > 0) {
                toast.success(`Sync complete — found ${totalNew} new recording(s).`);
            } else if (anyNotFound) {
                toast.warning('No recording was captured for this session.');
            } else {
                toast.success('Already up to date.');
            }
        } catch {
            toast.error('Sync failed. Recordings will appear automatically after the server processes them.');
        } finally {
            setIsSyncing(false);
        }
    }, [sessionData, groupedSchedules]);

    const handleRefreshRecordings = useCallback(async () => {
        const instituteId = sessionData?.schedule?.institute_id;
        if (!instituteId) return;
        setIsRefreshing(true);
        try {
            const allScheduleIds = groupedSchedules.flatMap((day) =>
                day.sessions.map((s) => s.id)
            );
            const uniqueIds = [...new Set(allScheduleIds)];
            const results: Record<string, MeetingRecording[]> = {};
            await Promise.all(
                uniqueIds.map(async (scheduleId) => {
                    try {
                        results[scheduleId] = await getScheduleRecordings(scheduleId, instituteId);
                    } catch {
                        // keep existing for this schedule on error
                    }
                })
            );
            setRefreshedRecordings((prev) => ({ ...prev, ...results }));
        } catch {
            toast.error('Failed to refresh recordings');
        } finally {
            setIsRefreshing(false);
        }
    }, [sessionData, groupedSchedules]);

    // "Save to library" — mirror a schedule's Zoom cloud recordings to Vacademy S3
    // so they survive Zoom's ~30-day auto-delete. Idempotent on the backend.
    const [syncingS3Schedules, setSyncingS3Schedules] = useState<Set<string>>(new Set());
    const handleSyncToS3 = useCallback(async (scheduleId: string) => {
        const instituteId = sessionData?.schedule?.institute_id;
        if (!instituteId || syncingS3Schedules.has(scheduleId)) return;
        setSyncingS3Schedules((prev) => new Set(prev).add(scheduleId));
        try {
            const result = await syncRecordingsToS3(scheduleId, instituteId);
            if (result?.recordings) {
                setRefreshedRecordings((prev) => ({ ...prev, [scheduleId]: result.recordings }));
            }
            toast.success('Saving recording to library — it will stay available after Zoom expiry.');
        } catch {
            toast.error('Could not save to library. Please try again.');
        } finally {
            setSyncingS3Schedules((prev) => {
                const next = new Set(prev);
                next.delete(scheduleId);
                return next;
            });
        }
    }, [sessionData, syncingS3Schedules]);

    // Google Meet: pull recordings on demand (bypasses the hourly poll). Google needs
    // ~10–30 min after a session ends to finish processing the Drive file.
    const handleSyncGoogleRecordings = useCallback(async () => {
        const instituteId = sessionData?.schedule?.institute_id;
        if (!instituteId) return;
        setIsSyncing(true);
        try {
            const pastScheduleIds = groupedSchedules.flatMap((day) =>
                day.sessions.filter((s) => s.status === 'past').map((s) => s.id)
            );
            const uniqueIds = [...new Set(pastScheduleIds)];
            const results: Record<string, MeetingRecording[]> = {};
            let totalNew = 0;
            let anySucceeded = false;
            await Promise.all(
                uniqueIds.map(async (scheduleId) => {
                    try {
                        const result = await syncGoogleRecordings(scheduleId, instituteId);
                        results[scheduleId] = result.recordings ?? [];
                        totalNew += result.synced ?? 0;
                        anySucceeded = true;
                    } catch {
                        // Network/5xx — keep existing recordings for this schedule.
                    }
                })
            );
            setRefreshedRecordings((prev) => ({ ...prev, ...results }));

            if (!anySucceeded) {
                toast.error('Sync failed. Recordings appear automatically once Google finishes processing.');
            } else if (totalNew > 0) {
                toast.success(`Sync complete — found ${totalNew} new recording(s).`);
            } else if (Object.values(results).some((r) => r.length > 0)) {
                toast.success('Recordings are up to date.');
            } else {
                toast.info(
                    'No recording is ready yet — Google can take 10–30 min after the session ends. Click Refresh to check again.',
                    { duration: 8000 }
                );
            }
        } catch {
            toast.error('Sync failed. Recordings appear automatically once Google finishes processing.');
        } finally {
            setIsSyncing(false);
        }
    }, [sessionData, groupedSchedules]);

    const uniqueNotifications = useMemo(() => {
        if (!sessionData?.notifications?.addedNotificationActions) return [];
        const seen = new Set();
        return sessionData.notifications.addedNotificationActions.filter((notification) => {
            if (!notification.notify) return false;

            // Create a unique key based on type and time of day (HH:mm)
            // We ignore the date/month/year to deduplicate recurring sessions at the same time
            let timeKey = 'no-time';
            if (notification.time) {
                const date = new Date(notification.time);
                timeKey = `${date.getHours()}:${date.getMinutes()}`;
            }
            const key = `${notification.type}-${timeKey}`;

            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }, [sessionData]);

    if (loading) {
        return (
            <LayoutContainer>
                <div className="mx-auto max-w-5xl space-y-6 p-6">
                    <div className="flex items-center justify-between">
                        <Skeleton className="h-8 w-32" />
                        <Skeleton className="h-10 w-32" />
                    </div>
                    <Skeleton className="h-12 w-1/2" />
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                        <div className="space-y-6 lg:col-span-2">
                            <Skeleton className="h-64 w-full rounded-xl" />
                            <Skeleton className="h-32 w-full rounded-xl" />
                        </div>
                        <div className="space-y-6">
                            <Skeleton className="h-48 w-full rounded-xl" />
                            <Skeleton className="h-32 w-full rounded-xl" />
                        </div>
                    </div>
                </div>
            </LayoutContainer>
        );
    }

    if (error || !sessionData) {
        return (
            <LayoutContainer>
                <div className="flex min-h-screen items-center justify-center">
                    <div className="text-center">
                        <h2 className="text-2xl font-bold text-destructive">Error</h2>
                        <p className="mt-2 text-muted-foreground">
                            {error || 'Session not found'}
                        </p>
                        <MyButton
                            onClick={() => navigate({ to: '/study-library/live-session' })}
                            className="mt-4"
                            buttonType="secondary"
                        >
                            Go Back to Sessions
                        </MyButton>
                    </div>
                </div>
            </LayoutContainer>
        );
    }

    const { schedule, notifications } = sessionData;
    const isRecurring = schedule.recurrence_type === 'weekly';

    /* Host action for a one-time session's single occurrence. Declared here
       because resolveHostAction and the render body both live below the
       loading guards. */
    const soleMeetingHostAction = soleSession
        ? resolveHostAction({
              id: soleSession.id,
              linkType: (soleSession as { linkType?: string | null }).linkType,
          })
        : null;

    return (
        <LayoutContainer className="overflow-x-clip">
            <div className="flex w-full min-w-0 flex-col gap-6 animate-in fade-in duration-500">
                {/* Header Section */}
                <div className="flex flex-col gap-2 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                        <button
                            onClick={() => navigate({ to: '/study-library/live-session' })}
                            className="group flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <div className="flex size-6 items-center justify-center rounded-full bg-secondary text-secondary-foreground transition-transform group-hover:-translate-x-1">
                                <ArrowLeft className="size-3" />
                            </div>
                            Back to Sessions
                        </button>
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-3">
                                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                                    {schedule.title}
                                </h1>
                                <SessionStatusChips
                                    timeStatus={sessionTimeStatus}
                                    accessType={schedule.access_type}
                                    isRecurring={isRecurring}
                                />
                            </div>
                            {schedule.subject && schedule.subject !== 'none' && (
                                <p className="text-base text-muted-foreground">
                                    Subject: <span className="font-medium text-foreground">{schedule.subject}</span>
                                </p>
                            )}
                        </div>
                    </div>
                    <MyButton onClick={handleEditSession} className="shrink-0 shadow-sm" scale="medium">
                        <Edit className="mr-2 size-4" />
                        Edit Session
                    </MyButton>
                </div>

                <div className="flex flex-col gap-6 lg:flex-row">
                    {/* Main Content Column */}
                    <div className="min-w-0 flex-1 space-y-6">
                        {/* Who teaches it and who attends it — the two questions
                            asked most often about a session, answered before the
                            scheduling detail. */}
                        <div
                            className={cn(
                                'grid gap-4',
                                // Only split the row when both cards are there;
                                // otherwise the survivor sits at half width with
                                // a hole beside it.
                                hasAssignedTeacher(sessionData?.instructors) &&
                                    batchCount > 0 &&
                                    'sm:grid-cols-2'
                            )}
                        >
                            <AssignedTeacherCard
                                instructors={sessionData?.instructors}
                                label={`Assigned ${instructorTerm}`}
                                unassignedLabel="Not assigned"
                                unknownLabel={`Unnamed ${instructorTerm.toLowerCase()}`}
                            />
                            {batchCount > 0 ? (
                                /* Counts off the ids, not the details: the rail
                                   card this replaced fell back to a bare count
                                   when the backend sent ids without details, and
                                   dropping that would blank the section out. */
                                <LinkedBatchesCard
                                    batches={schedule.package_session_details ?? []}
                                    label={`Associated ${batchesTerm}`}
                                    linkedLabel={`${batchCount} ${
                                        batchCount === 1
                                            ? batchesTerm.replace(/es$|s$/i, '')
                                            : batchesTerm
                                    } linked`.toLowerCase()}
                                />
                            ) : null}
                        </div>

                        {/* Session Details Card */}
                        <Card className="overflow-hidden border-border/60 shadow-sm transition-all hover:border-border/80">
                            <CardHeader className="bg-muted/40 px-6 py-4">
                                <CardTitle className="flex items-center gap-3 text-lg font-semibold">
                                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm">
                                        <MonitorPlay className="size-5" />
                                    </div>
                                    Session Overview
                                </CardTitle>
                                <CardDescription>All key details about this live session</CardDescription>
                            </CardHeader>
                            <Separator />
                            <CardContent className="grid gap-x-8 gap-y-6 p-6 sm:grid-cols-2 lg:grid-cols-3">
                                <InfoItem
                                    icon={<CalendarRange className="size-4 text-primary" />}
                                    label="Session Type"
                                    value={isRecurring ? 'Weekly Recurring' : 'One-Time Session'}
                                />
                                <InfoItem
                                    icon={<MapPin className="size-4 text-primary" />}
                                    label="Timezone"
                                    value={schedule.timezone || 'Not specified'}
                                />
                                <InfoItem
                                    icon={<Timer className="size-4 text-primary" />}
                                    label="Start Date & Time"
                                    value={format(new Date(schedule.start_time), 'PPP p')}
                                />
                                {schedule.last_entry_time && (
                                    <InfoItem
                                        icon={<Timer className="size-4 text-primary" />}
                                        label="Last Entry Time"
                                        value={format(new Date(schedule.last_entry_time), 'PPP p')}
                                    />
                                )}
                                {sessionDurationMins ? (
                                    <InfoItem
                                        icon={<Timer className="size-4 text-primary" />}
                                        label="Duration"
                                        value={`${sessionDurationMins} mins`}
                                    />
                                ) : null}
                                {isRecurring && schedule.session_end_date && (
                                    <InfoItem
                                        icon={<CalendarRange className="size-4 text-primary" />}
                                        label="End Date"
                                        value={format(new Date(schedule.session_end_date), 'PPP')}
                                    />
                                )}

                                <div className="space-y-4 pt-2 sm:col-span-2 lg:col-span-3">
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <InfoItem
                                            icon={<MonitorPlay className="size-4 text-primary" />}
                                            label="Platform"
                                            value={schedule.link_type || 'Other'}
                                        />
                                        <InfoItem
                                            icon={<UsersRound className="size-4 text-primary" />}
                                            label="Access Type"
                                            value={
                                                <span className="capitalize">{schedule.access_type}</span>
                                            }
                                        />
                                    </div>

                                    {/* Meeting strip.
                                        Replaces two full-width panels that printed
                                        the raw meeting and join URLs — the design
                                        asks for one compact row, and the URLs were
                                        the main source of this card's width.

                                        Previously the "start it" affordance here
                                        was BBB-only, so a Zoom/Meet/Zoho one-time
                                        class showed no way to start at all. It now
                                        goes through the shared resolver, same as
                                        the list cards. */}
                                    {!isRecurring && (
                                        <div className="mt-2 flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex min-w-0 items-center gap-3">
                                                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                                    <MonitorPlay className="size-5" />
                                                </span>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 font-semibold capitalize text-foreground">
                                                        {schedule.link_type || 'Meeting'}
                                                        {sessionTimeStatus === 'Live' ? (
                                                            <Badge className="bg-success-500 text-xs text-white hover:bg-success-500">
                                                                Live
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 flex-wrap items-center gap-2">
                                                {soleMeetingHostAction ? (
                                                    <MyButton
                                                        type="button"
                                                        buttonType="primary"
                                                        scale="medium"
                                                        className="sm:!min-w-0 sm:px-4"
                                                        onClick={soleMeetingHostAction}
                                                    >
                                                        <MonitorPlay className="mr-2 size-4" />
                                                        Start as Host
                                                    </MyButton>
                                                ) : null}
                                                {shareableLink ? (
                                                    <MyButton
                                                        type="button"
                                                        buttonType="secondary"
                                                        scale="medium"
                                                        className="sm:!min-w-0 sm:px-4"
                                                        onClick={() => copyToClipboard(shareableLink)}
                                                    >
                                                        <Link2 className="mr-2 size-4" />
                                                        Copy Join Link
                                                    </MyButton>
                                                ) : null}
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-4">
                                        {provisionBadge}

                                        {/*
                                          * Recurring sessions get a host entry point here too. Burying it in
                                          * the Scheduled Sessions calendar at the foot of the page meant a
                                          * teacher looking at this card saw no way to start her own class.
                                          */}
                                        {isRecurring &&
                                            currentOrNextSession &&
                                            (() => {
                                                const startAsHost = resolveHostAction(
                                                    currentOrNextSession as { id: string; linkType?: string | null }
                                                );
                                                if (!startAsHost) return null;
                                                const isLive = currentOrNextSession.status === 'live';
                                                return (
                                                    <div className="space-y-2">
                                                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                            <MonitorPlay className="size-3.5 text-primary" />
                                                            {isLive ? 'Class in progress' : 'Next class'}
                                                        </div>
                                                        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
                                                            <div className="flex flex-wrap items-center gap-3">
                                                                <div className="flex items-center gap-2 text-sm">
                                                                    <Timer className="size-4 text-primary" />
                                                                    <span className="font-medium">
                                                                        {currentOrNextSession.startDate
                                                                            ? `${format(currentOrNextSession.startDate, 'EEE, MMM d')} · `
                                                                            : ''}
                                                                        {currentOrNextSession.time}
                                                                    </span>
                                                                </div>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {currentOrNextSession.duration} mins
                                                                </span>
                                                                {isLive && (
                                                                    <Badge
                                                                        variant="default"
                                                                        className="bg-green-500 text-white text-xs"
                                                                    >
                                                                        Live
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <MyButton
                                                                onClick={startAsHost}
                                                                buttonType="primary"
                                                                scale="small"
                                                                type="button"
                                                                className="shrink-0"
                                                            >
                                                                Start as Host
                                                            </MyButton>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

                                        {isZoomSession && !isRecurring && groupedSchedules.length > 0 && (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                    <MonitorPlay className="size-3.5 text-primary" />
                                                    Zoom Meeting
                                                </div>
                                                {groupedSchedules.flatMap(day => day.sessions).map((session) => (
                                                    <div key={session.id} className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center gap-2 text-sm">
                                                                <Timer className="size-4 text-primary" />
                                                                <span className="font-medium">{session.time}</span>
                                                            </div>
                                                            <span className="text-xs text-muted-foreground">
                                                                {session.duration} mins
                                                            </span>
                                                            {session.status === 'live' && (
                                                                <Badge variant="default" className="bg-green-500 text-white text-xs">
                                                                    Live
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={() => handleZoomStartAsHost(session.id)}
                                                            className="text-xs font-medium text-primary hover:underline"
                                                        >
                                                            Start as Host →
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {isMeetSession && !isRecurring && groupedSchedules.length > 0 && (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                    <MonitorPlay className="size-3.5 text-primary" />
                                                    Google Meet
                                                </div>
                                                {groupedSchedules.flatMap(day => day.sessions).map((session) => (
                                                    <div key={session.id} className="flex items-center justify-between rounded-md border bg-muted/20 p-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex items-center gap-2 text-sm">
                                                                <Timer className="size-4 text-primary" />
                                                                <span className="font-medium">{session.time}</span>
                                                            </div>
                                                            <span className="text-xs text-muted-foreground">
                                                                {session.duration} mins
                                                            </span>
                                                            {session.status === 'live' && (
                                                                <Badge variant="default" className="bg-green-500 text-white text-xs">
                                                                    Live
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={() => handleMeetStartAsHost(session.id)}
                                                            className="text-xs font-medium text-primary hover:underline"
                                                        >
                                                            Start as Host →
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Description Card */}
                        {schedule.description_html &&
                            schedule.description_html.replace(/<[^>]*>/g, '').trim().length > 0 && (
                                <Card className="overflow-hidden border-border/60 shadow-sm">
                                    <CardHeader className="bg-muted/40 px-6 py-4">
                                        <CardTitle className="text-lg font-semibold">Description</CardTitle>
                                    </CardHeader>
                                    <Separator />
                                    <CardContent className="p-6">
                                        <div
                                            className="prose prose-sm max-w-none text-muted-foreground prose-headings:font-semibold prose-headings:text-foreground prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
                                            dangerouslySetInnerHTML={{ __html: schedule.description_html }}
                                        />
                                    </CardContent>
                                </Card>
                            )}

                        {/* Registration Fields */}
                        {notifications?.addedFields && notifications.addedFields.length > 0 && (
                            <Card className="overflow-hidden border-border/60 shadow-sm">
                                <CardHeader className="bg-muted/40 px-6 py-4">
                                    <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                                        <FileText className="size-5" />
                                        Registration Form Details
                                    </CardTitle>
                                </CardHeader>
                                <Separator />
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="bg-muted/50 hover:bg-muted/50">
                                                <TableHead className="pl-6 w-1/2">Field Label</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right pr-6">Required</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {notifications.addedFields.map((field) => (
                                                <TableRow key={field.id} className="hover:bg-muted/5">
                                                    <TableCell className="pl-6 font-medium text-foreground">
                                                        {field.label}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Badge variant="secondary" className="font-mono text-xs uppercase tracking-wider text-muted-foreground/80">
                                                            {field.type}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right pr-6">
                                                        {field.required ? (
                                                            <Badge variant="destructive" className="h-5 px-1.5 text-xs font-medium uppercase tracking-wider">
                                                                Required
                                                            </Badge>
                                                        ) : (
                                                            <span className="text-xs text-muted-foreground">Optional</span>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        )}

                        {/* Attendance and Class Materials sit side by side, as in
                            the design: both are summaries, and stacking them full
                            width is what left a tall empty band beside the rail. */}
                        <div className="flex flex-col gap-6">
                        {/* Attendance Section */}
                        <Card className="overflow-hidden border-border/60 shadow-sm">
                            <CardHeader className="bg-muted/40 px-6 py-4">
                                <CardTitle className="flex items-center gap-3 text-lg font-semibold">
                                    <div className="flex size-10 items-center justify-center rounded-xl bg-green-500/10 text-green-600 shadow-sm">
                                        <Users className="size-5" />
                                    </div>
                                    Attendance
                                </CardTitle>
                                <CardDescription>
                                    {isRecurring
                                        ? 'Select a session date to view attendance'
                                        : 'View attendance for this session'}
                                </CardDescription>
                            </CardHeader>
                            <Separator />
                            <CardContent className="p-5">
                                {isRecurring ? (
                                    <div className="space-y-3">
                                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                            {(showAllAttendanceDates
                                                ? attendanceOccurrences
                                                : attendanceOccurrences.slice(0, 12)
                                            ).map((occ) => {
                                                const isSelected = selectedScheduleForAttendance === occ.id;
                                                return (
                                                    <button
                                                        key={occ.id}
                                                        onClick={() => handleViewAttendance(occ.id)}
                                                        className={cn(
                                                            "flex items-center justify-between rounded-lg border p-3 text-left text-sm transition-all hover:bg-muted/50",
                                                            isSelected && "border-primary bg-primary/5"
                                                        )}
                                                    >
                                                        <div>
                                                            <div className="flex items-center gap-2 font-medium">
                                                                {format(parseISO(occ.date), 'MMM d, yyyy')}
                                                                {occ.isToday && (
                                                                    <Badge variant="secondary" className="text-xs">
                                                                        Today
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {occ.time} · {occ.duration} mins
                                                            </div>
                                                        </div>
                                                        <Users className="size-4 text-muted-foreground" />
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {attendanceOccurrences.length > 12 && (
                                            <button
                                                type="button"
                                                onClick={() => setShowAllAttendanceDates((v) => !v)}
                                                className="text-sm font-medium text-primary hover:underline"
                                            >
                                                {showAllAttendanceDates
                                                    ? 'Show recent dates only'
                                                    : `Show all ${attendanceOccurrences.length} dates`}
                                            </button>
                                        )}
                                        {attendanceOccurrences.length === 0 && (
                                            <p className="text-sm text-muted-foreground">
                                                {nextAttendanceDate
                                                    ? `Attendance opens when the first class starts (${format(parseISO(nextAttendanceDate), 'MMM d, yyyy')}).`
                                                    : 'No classes scheduled yet.'}
                                            </p>
                                        )}
                                    </div>
                                ) : null}

                                {/* Attendance Table */}
                                {attendanceLoading && (
                                    <div className="mt-4 flex items-center justify-center py-8">
                                        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                        <span className="ml-2 text-sm text-muted-foreground">Loading attendance...</span>
                                    </div>
                                )}
                                {attendanceData && !attendanceLoading && (
                                    <div className="mt-4 space-y-4">
                                        <AttendanceStatTiles
                                            registered={attendanceData.length}
                                            attended={
                                                attendanceData.filter(
                                                    (r) => r.attendanceStatus === 'PRESENT'
                                                ).length
                                            }
                                            labels={{
                                                registered: 'Registered',
                                                attended: 'Attended',
                                                rate: 'Attendance Rate',
                                                students: 'students',
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowAttendanceDetail((v) => !v)}
                                            className="text-sm font-medium text-primary hover:underline"
                                        >
                                            {showAttendanceDetail
                                                ? 'Hide detailed attendance'
                                                : 'Mark / view detailed attendance →'}
                                        </button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {showAttendanceDetail && attendanceData && !attendanceLoading ? (
                            <Card className="overflow-hidden border-border/60 shadow-sm">
                                <CardContent className="space-y-4 p-6">
                                    <FeedbackStats
                                        data={attendanceData}
                                        feedbackConfig={sessionData?.schedule?.feedback_config}
                                    />
                                    <AttendanceMarkingTable
                                        data={attendanceData}
                                        sessionId={sessionId}
                                        scheduleId={selectedScheduleForAttendance!}
                                        accessType={sessionData?.schedule?.access_type || 'private'}
                                        sessionTitle={sessionData?.schedule?.title}
                                        packageSessionDetails={
                                            sessionData?.schedule?.package_session_details
                                        }
                                        onSaved={async () => {
                                            if (selectedScheduleForAttendance) {
                                                const data = await getLiveSessionReport(
                                                    sessionId,
                                                    selectedScheduleForAttendance,
                                                    sessionData?.schedule?.access_type || 'private'
                                                );
                                                setAttendanceData(data);
                                            }
                                        }}
                                    />
                                </CardContent>
                            </Card>
                        ) : null}

                        {/* Class Materials — always visible, not tied to a recording */}
                        {showClassMaterials ? (
                            <div className="min-w-0">
                                <ClassMaterialsCard
                                    sessionId={sessionId}
                                    scheduleId={soleScheduleId}
                                    sessionTitle={sessionData?.schedule?.title}
                                    batches={contentLinkBatches}
                                />
                            </div>
                        ) : null}
                        </div>

                        {/* Recordings Section */}
                        {allRecordings.length > 0 ? (
                            <Card className="overflow-hidden border-border/60 shadow-sm">
                                <CardHeader className="bg-muted/40 px-6 py-4">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="flex items-center gap-3 text-lg font-semibold">
                                            <div className="flex size-10 items-center justify-center rounded-xl bg-red-500/10 text-red-600 shadow-sm">
                                                <Video className="size-5" />
                                            </div>
                                            Recordings
                                        </CardTitle>
                                        <div className="flex items-center gap-2">
                                            <Badge variant="secondary" className="px-3 py-1 text-xs font-medium">
                                                {allRecordings.length} recording{allRecordings.length !== 1 ? 's' : ''}
                                            </Badge>
                                            <button
                                                onClick={handleRefreshRecordings}
                                                disabled={isRefreshing}
                                                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                                                title="Refresh recordings"
                                            >
                                                <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
                                                Refresh
                                            </button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <Separator />
                                <CardContent className="space-y-3 p-4 sm:p-6">
                                    {allRecordings.map((rec, idx) => {
                                        const url =
                                            rec.playbackUrl ||
                                            (rec.fileId && recordingUrls[rec.fileId]) ||
                                            null;
                                        const onS3 =
                                            rec.recordingStorage === 'S3' ||
                                            (!!rec.fileId && !!rec.recordingStorage);
                                        const expiresInDays = rec.expiresAt
                                            ? Math.ceil(
                                                  (new Date(rec.expiresAt).getTime() - Date.now()) /
                                                      86_400_000
                                              )
                                            : null;
                                        const canSaveToLibrary =
                                            rec.recordingStorage === 'ZOOM_CLOUD' && !rec.fileId;
                                        // Meet recordings stay in the organiser's Drive until saved
                                        // (server download, or a manual upload as fallback).
                                        const needsDriveUpload =
                                            rec.recordingStorage === 'GOOGLE_DRIVE' && !rec.fileId;
                                        return (
                                            <div
                                                key={rec.recordingId || idx}
                                                className="flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/30"
                                            >
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                                                {/* Info column */}
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
                                                        <Play className="size-4" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-medium text-foreground">
                                                            {RECORDING_LABELS[rec.type ?? ''] ?? `Recording ${idx + 1}`}
                                                        </div>
                                                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                                            {isRecurring && (
                                                                <span className="whitespace-nowrap">
                                                                    {format(new Date(rec.date), 'MMM d, yyyy')}
                                                                </span>
                                                            )}
                                                            {rec.startTime && (
                                                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                                                    <Clock className="size-3" />
                                                                    {format(new Date(rec.startTime), 'p')}
                                                                </span>
                                                            )}
                                                            {rec.durationSeconds > 0 && (
                                                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                                                    <Timer className="size-3" />
                                                                    {formatDuration(rec.durationSeconds)}
                                                                </span>
                                                            )}
                                                            {onS3 ? (
                                                                <Badge
                                                                    variant="outline"
                                                                    className="border-green-200 bg-green-50 text-green-700"
                                                                >
                                                                    Saved to library
                                                                </Badge>
                                                            ) : rec.recordingStorage === 'ZOOM_CLOUD' ? (
                                                                <Badge
                                                                    variant="outline"
                                                                    className="border-amber-200 bg-amber-50 text-amber-700"
                                                                >
                                                                    Zoom Cloud
                                                                    {expiresInDays !== null
                                                                        ? ` · expires in ${Math.max(0, expiresInDays)}d`
                                                                        : ''}
                                                                </Badge>
                                                            ) : needsDriveUpload ? (
                                                                <Badge
                                                                    variant="outline"
                                                                    className="border-amber-200 bg-amber-50 text-amber-700"
                                                                >
                                                                    Google Drive
                                                                </Badge>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Actions — uniform monochrome ghost buttons. Wrap on narrow widths so nothing clips. */}
                                                <div className="flex flex-wrap items-center justify-start gap-1.5 sm:justify-end">
                                                    {!url ? (
                                                        <span className="text-xs text-muted-foreground">
                                                            {rec.fileId ? 'Loading…' : 'No URL available'}
                                                        </span>
                                                    ) : (
                                                        <>
                                                            <a
                                                                href={url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                                            >
                                                                <Play className="size-3" />
                                                                Play
                                                            </a>
                                                            <a
                                                                href={url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                                            >
                                                                <Download className="size-3" />
                                                                Download
                                                            </a>
                                                            {rec.passcode && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        navigator.clipboard
                                                                            .writeText(rec.passcode!)
                                                                            .then(() =>
                                                                                toast.success(
                                                                                    'Passcode copied'
                                                                                )
                                                                            )
                                                                            .catch(() =>
                                                                                toast.error(
                                                                                    'Could not copy'
                                                                                )
                                                                            );
                                                                    }}
                                                                    title={`Recording passcode: ${rec.passcode}. Click to copy in case Zoom prompts.`}
                                                                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                                                                >
                                                                    <Copy className="size-3" />
                                                                    Passcode
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                    {canSaveToLibrary && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleSyncToS3(rec.scheduleId)}
                                                            disabled={syncingS3Schedules.has(rec.scheduleId)}
                                                            title="Save this recording to the Vacademy library so it stays available after Zoom's ~30-day auto-delete"
                                                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                                                        >
                                                            <CloudDownload className="size-3" />
                                                            {syncingS3Schedules.has(rec.scheduleId)
                                                                ? 'Saving…'
                                                                : 'Save to library'}
                                                        </button>
                                                    )}
                                                    {needsDriveUpload && (
                                                        <RecordingDriveUploadAction
                                                            rec={rec}
                                                            onAttached={(scheduleId, recordings) =>
                                                                setRefreshedRecordings((prev) => ({
                                                                    ...prev,
                                                                    [scheduleId]: recordings,
                                                                }))
                                                            }
                                                        />
                                                    )}
                                                    <RecordingYoutubeAction
                                                        rec={rec}
                                                        featureEnabled={youtubeFeatureEnabled}
                                                    />
                                                    <RecordingTranscribeAction
                                                        rec={rec}
                                                        batches={
                                                            sessionData?.schedule
                                                                ?.package_session_details ?? undefined
                                                        }
                                                    />
                                                </div>
                                            </div>

                                                {contentLinkBatches.length > 0 &&
                                                    (instituteLiveSessionSettings.lmsConnection
                                                        .recordingAddToCourseEnabled ||
                                                        instituteLiveSessionSettings.lmsConnection
                                                            .autoUploadRecordingsEnabled) && (
                                                    <AddRecordingToCourseCard
                                                        sessionId={sessionId}
                                                        scheduleId={rec.scheduleId}
                                                        sessionTitle={sessionData?.schedule?.title}
                                                        recording={rec}
                                                        batches={contentLinkBatches}
                                                        needsSaveToLibraryFirst={canSaveToLibrary}
                                                        onSaveToLibrary={() =>
                                                            handleSyncToS3(rec.scheduleId)
                                                        }
                                                        showAddAction={
                                                            instituteLiveSessionSettings
                                                                .lmsConnection
                                                                .recordingAddToCourseEnabled
                                                        }
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </CardContent>
                            </Card>
                        ) : groupedSchedules.some((day) =>
                            day.sessions.some((s) => s.status === 'past')
                        ) && (
                            <Card className="overflow-hidden border-border/60 shadow-sm">
                                <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
                                    <div className="flex size-14 items-center justify-center rounded-xl bg-red-500/10 text-red-400">
                                        <Video className="size-7" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-foreground">No recordings yet</p>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            Recordings are usually ready 10–20 min after the session ends.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleRefreshRecordings}
                                            disabled={isRefreshing || isSyncing}
                                            className="flex items-center gap-2 rounded-md border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                                        >
                                            <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
                                            {isRefreshing ? 'Checking...' : 'Refresh'}
                                        </button>
                                        {isBbbSession && canShowSyncButton && (
                                            <button
                                                onClick={handleSyncFromBbb}
                                                disabled={isSyncing || isRefreshing}
                                                className="flex items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-4 py-2 text-xs font-medium text-orange-700 transition-colors hover:bg-orange-100 disabled:opacity-50"
                                            >
                                                <CloudDownload className={cn('size-3', isSyncing && 'animate-pulse')} />
                                                {isSyncing ? 'Syncing...' : 'Sync from Vacademy Meet Platform'}
                                            </button>
                                        )}
                                        {isMeetSession && (
                                            <button
                                                onClick={handleSyncGoogleRecordings}
                                                disabled={isSyncing || isRefreshing}
                                                className="flex items-center gap-2 rounded-md border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                                            >
                                                <CloudDownload className={cn('size-3', isSyncing && 'animate-pulse')} />
                                                {isSyncing ? 'Syncing…' : 'Sync recordings now'}
                                            </button>
                                        )}
                                    </div>
                                    {isBbbSession && canShowSyncButton && (
                                        <div className="flex items-start gap-1.5 rounded-md border border-orange-100 bg-orange-50/60 px-3 py-2 text-left text-xs text-orange-600">
                                            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                                            <span>
                                                Fetching recordings directly from the meeting server may temporarily
                                                increase its load. Use only if recordings haven&apos;t appeared after 2 hours.
                                            </span>
                                        </div>
                                    )}
                                    {isMeetSession && (
                                        <div className="flex items-start gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground">
                                            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                                            <span>
                                                Google Meet recordings are saved to the organizer&apos;s Google Drive and
                                                usually appear 10–30 min after the session ends.
                                            </span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {/* Calendar View for Recurring Sessions */}
                        {isRecurring && provisionBadge && (
                            <div className="mb-4">{provisionBadge}</div>
                        )}

                        {isRecurring && groupedSchedules.length > 0 && (
                            <Card className="overflow-hidden border-border/60 shadow-sm">
                                <CardHeader className="bg-muted/40 px-6 py-4">
                                    <div className="flex items-center justify-between">
                                        <CardTitle className="text-lg font-semibold">Scheduled Sessions</CardTitle>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-1 rounded-lg border bg-background p-1">
                                                <MyButton
                                                    onClick={() => setViewMode('list')}
                                                    buttonType="text"
                                                    scale="small"
                                                    className={cn(
                                                        "h-7 w-7 p-0 transition-all",
                                                        viewMode === 'list'
                                                            ? "bg-muted text-foreground shadow-sm"
                                                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                    )}
                                                    title="List View"
                                                >
                                                    <List className="size-4" />
                                                </MyButton>
                                                <MyButton
                                                    onClick={() => setViewMode('calendar')}
                                                    buttonType="text"
                                                    scale="small"
                                                    className={cn(
                                                        "h-7 w-7 p-0 transition-all",
                                                        viewMode === 'calendar'
                                                            ? "bg-muted text-foreground shadow-sm"
                                                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                    )}
                                                    title="Calendar View"
                                                >
                                                    <CalendarIcon className="size-4" />
                                                </MyButton>
                                            </div>
                                            <Badge variant="secondary" className="px-3 py-1 text-xs font-medium">
                                                {groupedSchedules.length} days
                                            </Badge>
                                        </div>
                                    </div>
                                </CardHeader>
                                <Separator />
                                <CardContent className="space-y-4 p-6">
                                    {viewMode === 'list' ? (
                                        <>
                                            <Accordion type="multiple" className="w-full">
                                                {groupedSchedules
                                                    .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                                                    .map((daySchedule) => (
                                                        <AccordionItem value={daySchedule.date} key={daySchedule.date} className="border-b last:border-0">
                                                            <AccordionTrigger className="hover:no-underline py-3">
                                                                <div className="flex flex-1 items-center justify-between mr-4">
                                                                    <h3 className="font-semibold text-foreground">
                                                                        {format(new Date(daySchedule.date), 'EEEE, MMMM d, yyyy')}
                                                                    </h3>
                                                                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
                                                                        {daySchedule.sessions.length} session{daySchedule.sessions.length !== 1 ? 's' : ''}
                                                                    </span>
                                                                </div>
                                                            </AccordionTrigger>
                                                            <AccordionContent>
                                                                <div className="space-y-4 pt-2">
                                                                    {/* Day Level Info */}
                                                                    {(() => {
                                                                        const firstSession = daySchedule.sessions[0];
                                                                        const defaultLink = firstSession?.default_class_link;
                                                                        const defaultClassName = firstSession?.defaultClassName;
                                                                        const learnerButton = firstSession?.learner_button_config;

                                                                        if (defaultLink || (learnerButton && learnerButton.visible)) {
                                                                            return (
                                                                                <div className="rounded-lg border border-blue-100 bg-gradient-to-br from-blue-50/50 to-white p-4 shadow-sm">
                                                                                    <div className="mb-2 flex items-center gap-2">
                                                                                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500 shadow-sm">
                                                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                                                                            </svg>
                                                                                        </div>
                                                                                        <h5 className="text-sm font-semibold text-gray-900">Default Class Information</h5>
                                                                                    </div>
                                                                                    <div className="space-y-2.5 text-sm">
                                                                                        {defaultClassName && (
                                                                                            <div className="flex items-start gap-2">
                                                                                                <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                                                                                </svg>
                                                                                                <div className="flex-1">
                                                                                                    <span className="font-medium text-gray-700">Class Name: </span>
                                                                                                    <span className="font-semibold text-gray-900">{defaultClassName}</span>
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                        {defaultLink && (
                                                                                            <div className="flex items-start gap-2">
                                                                                                <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                                                                                </svg>
                                                                                                <div className="flex-1">
                                                                                                    <span className="font-medium text-gray-700">Link: </span>
                                                                                                    <a
                                                                                                        href={defaultLink}
                                                                                                        target="_blank"
                                                                                                        rel="noopener noreferrer"
                                                                                                        className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700 hover:underline break-all"
                                                                                                    >
                                                                                                        {defaultLink}
                                                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                                                                        </svg>
                                                                                                    </a>
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                        {learnerButton && learnerButton.visible && (
                                                                                                <div className="flex items-start gap-2 pt-1">
                                                                                                <svg xmlns="http://www.w3.org/2000/svg" className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                                                                                                    </svg>
                                                                                                    <div className="flex-1">
                                                                                                    <span className="font-medium text-gray-700">Custom Button: </span>
                                                                                                        <span
                                                                                                            style={{
                                                                                                            backgroundColor: learnerButton.background_color,
                                                                                                                color: learnerButton.text_color,
                                                                                                            }}
                                                                                                            className="inline-block rounded-md px-2.5 py-1 text-xs font-semibold shadow-sm"
                                                                                                        >
                                                                                                        {learnerButton.text}
                                                                                                        </span>
                                                                                                    <span className="ml-2 text-xs text-gray-600 break-all">
                                                                                                        → {learnerButton.url}
                                                                                                        </span>
                                                                                                    </div>
                                                                                                </div>
                                                                                            )}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    })()}

                                                                    <div className="space-y-2">
                                                                        {daySchedule.sessions.map((session) => (
                                                                                <div
                                                                                    key={session.id}
                                                                                    className="rounded-md border bg-muted/30 p-3"
                                                                                >
                                                                                    {/* Session Time and Duration */}
                                                                                    <div className="flex items-center justify-between">
                                                                                        <div className="flex items-center gap-3">
                                                                                            <div className="flex items-center gap-2 text-sm">
                                                                                            <Timer className="size-4 text-primary" />
                                                                                            <span className="font-medium">{session.time}</span>
                                                                                            </div>
                                                                                            <span className="text-xs text-muted-foreground">
                                                                                            {session.duration} mins
                                                                                            </span>
                                                                                        </div>
                                                                                        {(() => {
                                                                                            const startAsHost = resolveHostAction(session as any);
                                                                                            return startAsHost ? (
                                                                                                <button
                                                                                                    onClick={startAsHost}
                                                                                                    className="text-xs font-medium text-primary hover:underline"
                                                                                                >
                                                                                                    Start as Host →
                                                                                                </button>
                                                                                            ) : (
                                                                                                <a
                                                                                                    href={session.link}
                                                                                                    target="_blank"
                                                                                                    rel="noopener noreferrer"
                                                                                                    className="text-xs font-medium text-primary hover:underline"
                                                                                                >
                                                                                                    Join →
                                                                                                </a>
                                                                                            );
                                                                                        })()}
                                                                                    </div>
                                                                                </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            </AccordionContent>
                                                        </AccordionItem>
                                                    ))}
                                            </Accordion>

                                            {groupedSchedules.length > itemsPerPage && (() => {
                                                const totalPages = Math.ceil(groupedSchedules.length / itemsPerPage);
                                                    // Build truncated page number list: 1 ... (current-1) current (current+1) ... last
                                                const getPageNumbers = (): (number | 'ellipsis')[] => {
                                                        const pages: (number | 'ellipsis')[] = [];
                                                        if (totalPages <= 7) {
                                                        for (let i = 1; i <= totalPages; i++) pages.push(i);
                                                            return pages;
                                                        }
                                                        // Always show first page
                                                        pages.push(1);
                                                        if (currentPage > 3) pages.push('ellipsis');
                                                        // Pages around current
                                                        const start = Math.max(2, currentPage - 1);
                                                    const end = Math.min(totalPages - 1, currentPage + 1);
                                                    for (let i = start; i <= end; i++) pages.push(i);
                                                    if (currentPage < totalPages - 2) pages.push('ellipsis');
                                                        // Always show last page
                                                        pages.push(totalPages);
                                                        return pages;
                                                    };
                                                    return (
                                                        <div className="mt-4 flex justify-center">
                                                            <Pagination>
                                                                <PaginationContent>
                                                                    <PaginationItem>
                                                                        <PaginationPrevious
                                                                            onClick={() =>
                                                                                setCurrentPage(
                                                                                    (p) =>
                                                                                        Math.max(
                                                                                            1,
                                                                                            p - 1
                                                                                        )
                                                                                )
                                                                            }
                                                                            className={
                                                                                currentPage === 1
                                                                                    ? 'pointer-events-none opacity-50'
                                                                                    : 'cursor-pointer'
                                                                            }
                                                                        />
                                                                    </PaginationItem>

                                                                {getPageNumbers().map((page, idx) =>
                                                                            page === 'ellipsis' ? (
                                                                        <PaginationItem key={`ellipsis-${idx}`}>
                                                                                    <PaginationEllipsis />
                                                                                </PaginationItem>
                                                                            ) : (
                                                                        <PaginationItem key={page}>
                                                                                    <PaginationLink
                                                                                isActive={currentPage === page}
                                                                                onClick={() => setCurrentPage(page)}
                                                                                        className="cursor-pointer"
                                                                                    >
                                                                                        {page}
                                                                                    </PaginationLink>
                                                                                </PaginationItem>
                                                                            )
                                                                    )}

                                                                    <PaginationItem>
                                                                        <PaginationNext
                                                                            onClick={() =>
                                                                            setCurrentPage((p) =>
                                                                                Math.min(totalPages, p + 1)
                                                                                )
                                                                            }
                                                                            className={
                                                                            currentPage === totalPages
                                                                                    ? 'pointer-events-none opacity-50'
                                                                                    : 'cursor-pointer'
                                                                            }
                                                                        />
                                                                    </PaginationItem>
                                                                </PaginationContent>
                                                            </Pagination>
                                                        </div>
                                                    );
                                                })()}
                                        </>
                                    ) : (
                                        <SessionCalendarView schedules={groupedSchedules} getHostAction={resolveHostAction} />
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    {/* Sidebar Column */}
                    <div className="w-full shrink-0 space-y-6 lg:sticky lg:top-24 lg:w-64 lg:self-start">
                        {/* Settings Card */}
                        <Card className="overflow-hidden border-border/60 shadow-sm">
                            <CardHeader className="bg-muted/40 px-6 py-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <CardTitle className="flex min-w-0 items-center gap-2 text-base font-semibold">
                                        <span className="truncate">Session Settings</span>
                                    </CardTitle>
                                    <button
                                        type="button"
                                        onClick={handleEditSession}
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-100"
                                    >
                                        <Edit className="size-3" />
                                        Edit
                                    </button>
                                </div>
                            </CardHeader>
                            <Separator />
                            <CardContent className="grid gap-4 p-6">
                                <SettingItem
                                    label="Waiting Room"
                                    value={
                                        schedule.waiting_room_time && Number(schedule.waiting_room_time) > 0
                                            ? `${schedule.waiting_room_time} mins before`
                                            : 'Disabled'
                                    }
                                />
                                <Separator />
                                <SettingItem
                                    label="Allow Rewind"
                                    value={schedule.allow_rewind ? 'Yes' : 'No'}
                                />
                                <Separator />
                                <SettingItem
                                    label="Allow Pause"
                                    value={schedule.allow_play_pause ? 'Yes' : 'No'}
                                />
                                <Separator />
                                <SettingItem
                                    label="Streaming Type"
                                    value={
                                        schedule.session_streaming_service_type === 'embed'
                                            ? 'Embed in App'
                                            : 'Redirect'
                                    }
                                />
                            </CardContent>
                        </Card>

                        {/* Notifications Card */}
                        {uniqueNotifications.length > 0 && (
                            <Card className="overflow-hidden border-border/60 shadow-sm">
                                <CardHeader className="bg-muted/40 px-6 py-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <CardTitle className="flex min-w-0 items-center gap-2 text-base font-semibold">
                                            <span className="truncate">Notifications</span>
                                        </CardTitle>
                                        <button
                                            type="button"
                                            onClick={handleEditSession}
                                            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-100"
                                        >
                                            <Edit className="size-3" />
                                            Edit
                                        </button>
                                    </div>
                                </CardHeader>
                                <Separator />
                                <CardContent className="space-y-3 p-6">
                                    {uniqueNotifications.map((notification: any, index: number) => (
                                        <div
                                            key={`${notification.type}-${index}`}
                                            className="group flex flex-col gap-3 rounded-lg border bg-card p-3 shadow-sm transition-all hover:bg-muted/40"
                                        >
                                            <div className="flex items-center justify-between">
                                                <Badge
                                                    variant="outline"
                                                    className="border-primary/20 bg-primary/5 text-xs font-semibold uppercase tracking-wider text-primary"
                                                >
                                                    {notification.type.replace(/_/g, ' ')}
                                                </Badge>
                                                {notification.time && (
                                                    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                                                        <Timer className="size-3" />
                                                        {format(new Date(notification.time), 'p')}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {notification.notifyBy.mail && (
                                                    <Badge variant="secondary" className="gap-1.5 px-2 py-0.5 text-xs font-medium">
                                                        <div className="size-1.5 rounded-full bg-blue-500" />
                                                        Email
                                                    </Badge>
                                                )}
                                                {notification.notifyBy.whatsapp && (
                                                    <Badge variant="secondary" className="gap-1.5 px-2 py-0.5 text-xs font-medium">
                                                        <div className="size-1.5 rounded-full bg-green-500" />
                                                        WhatsApp
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        )}

                        {/* Media Card */}
                        {(schedule.thumbnail_file_id || schedule.background_score_file_id || schedule.cover_file_id) && (
                            <Card className="overflow-hidden border-border/60 shadow-sm">
                                <CardHeader className="bg-muted/40 px-6 py-4">
                                    <CardTitle className="text-lg font-semibold">Media Files</CardTitle>
                                </CardHeader>
                                <Separator />
                                <CardContent className="space-y-6 p-6">


                                    {schedule.thumbnail_file_id && (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Thumbnail</span>
                                                <Badge variant="outline" className="text-xs text-green-600 border-green-200 bg-green-50">Attached</Badge>
                                            </div>
                                            {thumbnailUrl ? (
                                                <div className="group relative aspect-video w-full overflow-hidden rounded-md border bg-muted shadow-sm">
                                                    <img
                                                        src={thumbnailUrl}
                                                        alt="Session Thumbnail"
                                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                    />
                                                </div>
                                            ) : (
                                                <Skeleton className="aspect-video w-full rounded-md" />
                                            )}
                                        </div>
                                    )}

                                    {schedule.background_score_file_id && (
                                        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-green-200/50 dark:bg-green-800/50">
                                                <CheckCircle2 className="size-4" />
                                            </div>
                                            <div className="text-sm font-medium">Background music attached</div>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>

            </div>
        </LayoutContainer >
    );
}

// Helper Components
function InfoItem({
    icon,
    label,
    value,
    className,
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={`flex items-start gap-4 ${className} group`}>
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground/70 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                {icon}
            </div>
            <div className="flex-1 space-y-1">
                <div className="text-xs text-muted-foreground transition-colors">
                    {label}
                </div>
                <div className="text-sm font-medium text-foreground">{value}</div>
            </div>
        </div>
    );
}

function SettingItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 text-sm text-muted-foreground">{label}</span>
            <span className="shrink-0 text-right text-sm font-medium text-foreground">
                {value}
            </span>
        </div>
    );
}

/**
 * Per-recording YouTube action. Three states:
 *   - youtubeVideoUrl present → "Open on YouTube"
 *   - Recording has a fileId, no upload yet → "Upload to YouTube"
 *   - Recording still processing (no fileId yet) → render nothing
 *
 * Triggering an upload here is enough — the worker picks it up and the
 * Settings → YouTube page tracks the job. Once the worker finishes the
 * youtubeVideoUrl stamps onto the recording entry and the link replaces
 * the button on the next refresh.
 */
function RecordingYoutubeAction({
    rec,
    featureEnabled,
}: {
    rec: MeetingRecording & { scheduleId: string };
    featureEnabled: boolean;
}) {
    const [queued, setQueued] = useState(false);
    const { mutate, isPending } = useMutation({
        mutationFn: () =>
            enqueueYoutubeUpload({
                scheduleId: rec.scheduleId,
                recordingId: rec.recordingId,
                fileId: rec.fileId,
            }),
        onSuccess: () => {
            setQueued(true);
            toast.success('Queued for YouTube upload');
        },
        onError: (err: unknown) => {
            const msg =
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
                'Could not queue YouTube upload';
            toast.error(msg);
        },
    });

    if (rec.youtubeVideoUrl) {
        return (
            <a
                href={rec.youtubeVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                title="Open on YouTube"
            >
                <Video className="size-3" />
                YouTube
            </a>
        );
    }
    if (!rec.fileId) return null;
    if (!featureEnabled) return null;
    return (
        <button
            onClick={() => mutate()}
            disabled={isPending || queued}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            title="Upload this recording to your connected YouTube channel"
        >
            <CloudDownload className={cn('size-3', isPending && 'animate-pulse')} />
            {queued ? 'Queued' : isPending ? 'Queueing…' : 'Upload to YouTube'}
        </button>
    );
}

/**
 * Process-recording / transcription action — sibling of RecordingYoutubeAction.
 *
 * States:
 *   - no row     → "Process Recording" button (POST transcribe)
 *   - QUEUED     → disabled "Processing…" (poll every 30s)
 *   - RUNNING    → disabled "Processing…" (poll every 30s)
 *   - COMPLETED  → green "Transcript Ready" badge + "Create Assessment" button
 *                  (opens CreateAssessmentFromRecordingModal)
 *   - FAILED     → red badge + "Retry" button
 */
function RecordingTranscribeAction({
    rec,
    batches,
}: {
    rec: MeetingRecording & { scheduleId: string };
    batches?: Array<{
        package_session_id: string;
        package_name: string;
        level_name?: string;
        session_name?: string;
    }>;
}) {
    const [status, setStatus] = useState<TranscriptStatus | null>(rec.transcriptStatus ?? null);
    const [detectedLanguage, setDetectedLanguage] = useState<string | undefined>(rec.detectedLanguage);
    const [errorMessage, setErrorMessage] = useState<string | undefined>(rec.transcriptionError);
    const [assessmentModalOpen, setAssessmentModalOpen] = useState(false);
    const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);
    // When the teacher reuses a past paper from the Transcript dialog, we
    // stash the artifact here and pass it as `initialArtifact` so the
    // assessment modal opens straight into Preview state — skipping the
    // form + LLM call.
    const [reuseArtifact, setReuseArtifact] = useState<AssessmentArtifact | null>(null);
    const [sourceTextUrl, setSourceTextUrl] = useState<string | undefined>();
    const [englishTextUrl, setEnglishTextUrl] = useState<string | undefined>();
    // Cached LLM-generated study notes. Populated from the transcription
    // status response and refreshed whenever the user regenerates (the
    // dialog calls saveStudyNotes and returns the updated row).
    const [savedNotesMarkdown, setSavedNotesMarkdown] = useState<string | undefined>();
    const [savedNotesGeneratedAt, setSavedNotesGeneratedAt] = useState<string | undefined>();
    const [transcribeConfirmOpen, setTranscribeConfirmOpen] = useState(false);

    // Institute-level kill switch for the transcription feature. Defaults to
    // false (see `DEFAULT_LIVE_SESSION_SETTINGS.recordingTranscriptionEnabled`)
    // so transcription stays opt-in until an admin turns it on in
    // Settings → Live Session Settings → Recording Transcription.
    const { settings: liveSessionSettings } = useLiveSessionSettings();

    // Live "≈ N credits" preview for transcription, priced per audio-minute from
    // the recording's known duration. Read-only — nothing is deducted in Phase 1.
    const transcriptionPreview = useToolCostPreview('transcription', {
        duration_seconds: rec.durationSeconds,
    });

    const handleData = useCallback((data: RecordingTranscriptionStatus) => {
        setStatus(data.status);
        setDetectedLanguage(data.detectedLanguage ?? undefined);
        setErrorMessage(data.errorMessage ?? undefined);
        setSourceTextUrl(data.sourceTextUrl ?? undefined);
        setEnglishTextUrl(data.englishTextUrl ?? undefined);
        setSavedNotesMarkdown(data.savedNotesMarkdown ?? undefined);
        setSavedNotesGeneratedAt(data.savedNotesGeneratedAt ?? undefined);
    }, []);

    // Alert the user on the RUNNING → COMPLETED transition. Two channels:
    //   1. Sonner toast (only visible when the tab has focus).
    //   2. Web Notifications API (visible even when the tab is in the
    //      background or another app is foreground), best-effort.
    // We only fire on a real transition — not when the COMPLETED status
    // is loaded on initial mount — so the user isn't spammed every time
    // they re-open the page.
    const prevStatusRef = useRef<TranscriptStatus | null>(rec.transcriptStatus ?? null);
    useEffect(() => {
        const prev = prevStatusRef.current;
        prevStatusRef.current = status;
        if (status !== 'COMPLETED') return;
        if (prev !== 'QUEUED' && prev !== 'RUNNING') return;
        const labelTitle = 'Transcript ready';
        const labelBody = detectedLanguage
            ? `Your recording transcript (${detectedLanguage.toUpperCase()}) finished processing.`
            : 'Your recording transcript finished processing.';
        toast.success(`${labelTitle} — ${labelBody}`);
        // Web Notifications — request permission lazily on the first
        // transcript completion the user sees. If they decline once,
        // the browser remembers and we never re-prompt.
        if (typeof window !== 'undefined' && 'Notification' in window) {
            const fire = () => {
                try {
                    new Notification(labelTitle, {
                        body: labelBody,
                        icon: '/favicon.ico',
                        tag: `transcript-${rec.recordingId}`,
                    });
                } catch {
                    // Some browsers throw if the page is sandboxed —
                    // safe to swallow, the toast already fired.
                }
            };
            if (Notification.permission === 'granted') {
                fire();
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then((perm) => {
                    if (perm === 'granted') fire();
                });
            }
        }
    }, [status, detectedLanguage, rec.recordingId]);

    // Status lifecycle. The recordings-list payload's transcriptStatus can be
    // stale or null, so we ALWAYS fetch the live status once on mount — this is
    // what makes an in-progress job (or an already-finished transcript) surface
    // automatically, without the user having to click "Process Recording" to
    // find out. While a job is in flight we poll every 10s so the row
    // auto-advances QUEUED/RUNNING → COMPLETED/FAILED; polling halts on a
    // terminal state. We also re-check when the tab regains focus. The mount
    // fetch additionally loads the sourceTextUrl/englishTextUrl the list endpoint
    // omits (needed by the viewer modal).
    const polling = status === 'QUEUED' || status === 'RUNNING';
    useQuery({
        queryKey: ['recording-transcribe', rec.scheduleId, rec.recordingId],
        queryFn: async () => {
            const data = await getTranscriptionStatus(rec.scheduleId, rec.recordingId);
            handleData(data);
            return data;
        },
        enabled: true,
        refetchInterval: (query) => {
            const s = query.state.data?.status;
            return s === 'QUEUED' || s === 'RUNNING' ? 10_000 : false;
        },
        refetchOnWindowFocus: true,
    });

    const { mutate, isPending } = useMutation({
        mutationFn: () => processRecording(rec.scheduleId, rec.recordingId),
        onSuccess: (data) => {
            handleData(data);
            toast.success('Transcription started');
        },
        onError: (err: unknown) => {
            // Backend ErrorInfo is { url, ex, responseCode, date } — there is no
            // `message` field, and the gateway maps the service's 409 to HTTP 511,
            // so neither `response.data.message` nor `response.status === 409` ever
            // matched (every failure fell through to the generic "Could not start
            // transcription"). The human-readable reason lives in `ex`/`responseCode`,
            // formatted like: 409 CONFLICT "Transcription already in progress (status=RUNNING)".
            const data = (
                err as {
                    response?: { data?: { ex?: string; responseCode?: string; message?: string } };
                }
            )?.response?.data;
            const raw = data?.ex ?? data?.responseCode ?? data?.message;
            // Prefer the quoted reason; fall back to the raw string.
            const msg = raw?.match(/"([^"]+)"/)?.[1] ?? raw;
            // HTTP status is unreliable (511), so detect the "already in progress"
            // conflict from the message text itself.
            const alreadyRunning = /already in progress|CONFLICT/i.test(raw ?? '');
            if (alreadyRunning) {
                toast.info(msg ?? 'Transcription is already in progress');
            } else {
                toast.error(msg ?? 'Could not start transcription');
            }
        },
    });

    if (status === 'COMPLETED') {
        // Single entrypoint when transcript is ready — opens an actions
        // dialog where the teacher picks between generating an assessment
        // or generating study notes. Keeps the recording row uncluttered.
        return (
            <>
                <button
                    onClick={() => setTranscriptModalOpen(true)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-primary-300 bg-primary-50 px-2.5 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-100"
                    title="View transcript and choose a next action"
                >
                    <FileAudio className="size-3" />
                    Show Transcript
                </button>

                <TranscriptActionsDialog
                    open={transcriptModalOpen}
                    onOpenChange={setTranscriptModalOpen}
                    linkedBatches={batches}
                    scheduleId={rec.scheduleId}
                    recordingId={rec.recordingId}
                    sourceTextUrl={sourceTextUrl}
                    englishTextUrl={englishTextUrl}
                    detectedLanguage={detectedLanguage}
                    recordingTitle={rec.recordingId}
                    savedNotesMarkdown={savedNotesMarkdown}
                    savedNotesGeneratedAt={savedNotesGeneratedAt}
                    onSavedNotesChange={(markdown, generatedAt) => {
                        setSavedNotesMarkdown(markdown);
                        setSavedNotesGeneratedAt(generatedAt);
                    }}
                    onCreateAssessment={() => {
                        setReuseArtifact(null);
                        setTranscriptModalOpen(false);
                        setAssessmentModalOpen(true);
                    }}
                    onOpenArtifact={(artifact) => {
                        setReuseArtifact(artifact);
                        setAssessmentModalOpen(true);
                    }}
                />

                <CreateAssessmentFromRecordingModal
                    open={assessmentModalOpen}
                    onOpenChange={(next) => {
                        setAssessmentModalOpen(next);
                        if (!next) {
                            // Clear the reuse artifact on close so the next
                            // "Create Assessment" click lands in the empty
                            // form state, not Preview with stale data.
                            setReuseArtifact(null);
                        }
                    }}
                    scheduleId={rec.scheduleId}
                    recordingId={rec.recordingId}
                    detectedLanguage={detectedLanguage}
                    batches={batches}
                    sourceTextUrl={sourceTextUrl}
                    englishTextUrl={englishTextUrl}
                    initialArtifact={reuseArtifact}
                />
            </>
        );
    }

    if (status === 'FAILED') {
        return (
            <button
                onClick={() => mutate()}
                disabled={isPending}
                className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50"
                title={errorMessage ?? 'Transcription failed — click to retry'}
            >
                <AlertTriangle className="size-3" />
                Retry Transcription
            </button>
        );
    }

    const inFlight = polling || isPending;
    // Stage-specific label so the admin can see what's actually happening,
    // not just a generic spinner.
    const processingLabel =
        status === 'QUEUED' ? 'Queued…' : status === 'RUNNING' ? 'Transcribing…' : 'Processing…';

    // Hide the "Process Recording" entry point when the institute has the
    // transcription feature disabled. We only gate the *new-job* affordance —
    // the COMPLETED / FAILED / RUNNING / QUEUED branches above remain
    // reachable so existing transcripts stay viewable and in-flight jobs
    // keep polling regardless of the toggle.
    if (!liveSessionSettings.recordingTranscriptionEnabled) {
        return null;
    }

    // Above this estimated cost (or if the balance would go low) we confirm
    // before kicking off transcription. Preview-only in Phase 1 (no deduction).
    const TRANSCRIBE_CONFIRM_THRESHOLD = 20;
    const startTranscription = () => {
        const needsConfirm =
            (transcriptionPreview.credits != null &&
                transcriptionPreview.credits >= TRANSCRIBE_CONFIRM_THRESHOLD) ||
            transcriptionPreview.isLowBalanceAfter;
        if (needsConfirm) {
            setTranscribeConfirmOpen(true);
            return;
        }
        mutate();
    };

    return (
        <div className="flex flex-wrap items-center gap-2">
            <button
                onClick={startTranscription}
                disabled={inFlight}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
                title="Generate transcript (English + source language) and detect the audio language"
            >
                <FileAudio className={cn('size-3', inFlight && 'animate-pulse')} />
                <span>{inFlight ? processingLabel : 'Process Recording'}</span>
                {/* Cost folded INTO the button: "Process Recording │ ✨ ≈N credits".
                    Hidden while a job is in flight (it's a pre-run estimate);
                    turns amber when the balance wouldn't cover it. */}
                {!inFlight && rec.durationSeconds > 0 && (
                    <span
                        className={cn(
                            'ml-1 inline-flex items-center gap-0.5 border-l pl-2 font-semibold',
                            transcriptionPreview.sufficient === false
                                ? 'text-amber-700'
                                : 'text-purple-700'
                        )}
                    >
                        <Sparkle className="size-3" weight="fill" />≈{' '}
                        {transcriptionPreview.isLoading || transcriptionPreview.credits == null
                            ? '…'
                            : transcriptionPreview.credits}{' '}
                        credits
                    </span>
                )}
            </button>
            <ToolCostConfirmDialog
                open={transcribeConfirmOpen}
                onOpenChange={setTranscribeConfirmOpen}
                credits={transcriptionPreview.credits}
                currentBalance={transcriptionPreview.currentBalance}
                balanceAfter={transcriptionPreview.balanceAfter}
                sufficient={transcriptionPreview.sufficient}
                coverage={transcriptionPreview.coverage}
                heading="Process this recording?"
                confirmLabel="Process Recording"
                onConfirm={() => mutate()}
            />
        </div>
    );
}
