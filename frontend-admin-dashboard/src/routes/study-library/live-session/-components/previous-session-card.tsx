import { LiveSession } from '../schedule/-services/utils';
import React, { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import {
    ArrowSquareOut,
    CalendarBlank,
    ClipboardText,
    Clock,
    DotsThree,
    DownloadSimple,
    FilmSlate,
    GlobeHemisphereWest,
    Trash,
} from '@phosphor-icons/react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MyDialog } from '@/components/design-system/dialog';
import { fetchSessionDetails, SessionDetailsResponse } from '../-hooks/useSessionDetails';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { useLiveSessionReport } from '../-hooks/useLiveSessionReport';
import { AttendanceMarkingTable } from './AttendanceMarkingTable';
import {
    attendanceReportColumnsWithCheckbox,
    AttendanceReportTableData,
    ATTENDANCE_REPORT_WIDTH,
} from '../-constants/attendance-report-with-checkbox';
import { LiveSessionReport } from '../-services/utils';
import { MyPieChart } from '@/components/design-system/charts/MyPieChart';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { formatMeetingDate, formatTimeRange } from '../-utils/live-sesstions';
import {
    AccessBadge,
    SessionBatches,
    SessionCardFooter,
    SessionCardHeading,
    SessionCardShell,
    SessionMetaItem,
    SessionMetaRow,
    SessionTeacher,
} from './session-card-shell';
import { AttendanceBulkActions } from './attendance-bulk-actions';
import DeletePastSessionDialog from './delete-past-session-dialog';
import { SendMessageDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-message-dialog';
import { SendEmailDialog } from '@/routes/manage-students/students-list/-components/students-list/student-list-section/bulk-actions/send-email-dialog';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import { StudentTable } from '@/types/student-table-types';
import { BulkActionInfo } from '@/routes/manage-students/students-list/-types/bulk-actions-types';

interface PreviousSessionCardProps {
    session: LiveSession;
    /** Resolved once per page by the list, so avatars cost one lookup, not one per card. */
    avatarUrlByFileId?: Record<string, string>;
    /** Display Settings → Live Class Actions; resolved once by the list for the viewer's role. */
    canDelete?: boolean;
}

export default function PreviousSessionCard({
    session,
    avatarUrlByFileId,
    canDelete = false,
}: PreviousSessionCardProps) {
    const { t } = useTranslation('studyLibraryPreviousSessionCard');
    const { t: tCard } = useTranslation('studyLibraryLiveSessionCard');
    const [openDialog, setOpenDialog] = useState<boolean>(false);
    const [openDeleteDialog, setOpenDeleteDialog] = useState<boolean>(false);
    const [scheduledSessionDetails, setScheduleSessionDetails] =
        useState<SessionDetailsResponse | null>(null);
    const [isAttendanceExporting, setIsAttendanceExporting] = useState<boolean>(false);
    const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
    const [selectedStudents, setSelectedStudents] = useState<StudentTable[]>([]);
    // using Sonner toast for notifications
    const navigate = useNavigate();

    const { mutate: fetchReport, data: reportResponse, isPending, error } = useLiveSessionReport();
    const { openBulkSendMessageDialog, openBulkSendEmailDialog } = useDialogStore();

    const fetchSessionDetail = async () => {
        const response = await fetchSessionDetails(session.schedule_id);
        setScheduleSessionDetails(response);
        fetchReport({
            sessionId: session.session_id,
            scheduleId: session.schedule_id,
            accessType: session.access_level,
        });
    };
    const handleOpenDialog = () => {
        fetchSessionDetail();
        setOpenDialog(!openDialog);
    };

    const attendanceSummary = useMemo(() => {
        if (!reportResponse) {
            return { present: 0, absent: 0, unmarked: 0, total: 0 };
        }
        const present = reportResponse.filter((r) => r.attendanceStatus === 'PRESENT').length;
        const absent = reportResponse.filter((r) => r.attendanceStatus === 'ABSENT').length;
        const total = reportResponse.length;
        const unmarked = total - present - absent;
        return { present, absent, unmarked, total };
    }, [reportResponse]);

    const pieChartData = [
        { name: 'Present', value: attendanceSummary.present },
        { name: 'Absent', value: attendanceSummary.absent },
        { name: 'Unmarked', value: attendanceSummary.unmarked },
    ];

    const convertToReportTableData = (data: LiveSessionReport[]): AttendanceReportTableData[] => {
        return data.map((item, idx) => ({
            index: idx + 1,
            username: item.fullName,
            attendanceStatus: item.attendanceStatus,
            studentId: item.studentId,
            isSelected: selectedStudentIds.includes(item.studentId),
        }));
    };

    const tableData = {
        content: reportResponse ? convertToReportTableData(reportResponse) : [],
        total_pages: 0,
        page_no: 0,
        page_size: 10,
        total_elements: 0,
        last: true,
    };

    // Calculate selection states
    const isAllSelected = reportResponse
        ? selectedStudentIds.length === reportResponse.length
        : false;
    const isIndeterminate =
        selectedStudentIds.length > 0 && selectedStudentIds.length < (reportResponse?.length || 0);

    const handleExportPastAttendance = () => {
        setIsAttendanceExporting(true);
        // const batchValue = session.package_session_details && session.package_session_details.length > 0
        //     ? session.package_session_details.map((d) => d.level_name).filter(Boolean).join(' | ')
        //     : '';
        const courseValue =
            session.package_session_details && session.package_session_details.length > 0
                ? session.package_session_details
                      .map((d) => d.package_name)
                      .filter(Boolean)
                      .join(' | ')
                : '';
        // Activeness columns only for classes that had the opt-in camera score on.
        const withActiveness = (reportResponse || []).some((item) =>
            /"activeness(State)?"/.test(item.engagementData ?? '')
        );
        const csvData = (reportResponse || []).map((item, idx) => {
            const engagement = item.engagementData
                ? (() => {
                      try {
                          return JSON.parse(item.engagementData);
                      } catch {
                          return null;
                      }
                  })()
                : null;
            const duration = item.providerTotalDurationMinutes ?? '';
            const talkTimeMin = engagement?.talkTime ? Math.round(engagement.talkTime / 60) : '';
            const talks = engagement?.talks ?? '';
            const raiseHands = engagement?.raisehand ?? '';
            const emojis = engagement?.emojis ?? '';
            const chats = engagement?.chats ?? '';
            const pollVotes = engagement?.pollVotes ?? '';

            // The activeness score shares this JSON; on its own it is not BBB engagement.
            const hasBbbCounters =
                !!engagement &&
                ['chats', 'talks', 'talkTime', 'raisehand', 'emojis', 'pollVotes'].some(
                    (k) => typeof engagement[k] === 'number'
                );
            let activePoints: number | string = '';
            if (duration !== '' || hasBbbCounters) {
                let score = 0;
                if (typeof duration === 'number') score += duration;
                if (hasBbbCounters) {
                    score += ((engagement.talkTime ?? 0) / 60) * 2;
                    score += (engagement.talks ?? 0) * 0.5;
                    score += (engagement.raisehand ?? 0) * 3;
                    score += (engagement.emojis ?? 0) * 1;
                    score += (engagement.chats ?? 0) * 1.5;
                    score += (engagement.pollVotes ?? 0) * 2;
                }
                activePoints = Math.round(score);
            }

            return {
                [t('csv.number')]: idx + 1,
                [t('csv.name')]: item.fullName,
                [t('csv.email')]: item.email || '',
                // [t('csv.batch')]: batchValue,
                [t('csv.course')]: courseValue,
                [t('csv.status')]:
                    item.attendanceStatus === 'PRESENT'
                        ? t('status.present')
                        : item.attendanceStatus === 'ABSENT'
                          ? t('status.absent')
                          : t('status.unmarked'),
                [t('csv.mode')]: item.statusType || '',
                [t('csv.durationMin')]: duration,
                [t('csv.activePoints')]: activePoints,
                [t('csv.talkTimeMin')]: talkTimeMin,
                [t('csv.talkSegments')]: talks,
                [t('csv.raiseHands')]: raiseHands,
                [t('csv.emojis')]: emojis,
                [t('csv.chats')]: chats,
                [t('csv.pollVotes')]: pollVotes,
                ...(withActiveness
                    ? {
                          [t('csv.activeness')]: engagement?.activeness ?? '',
                          [t('csv.activenessOnScreen')]: engagement?.activenessOnScreen ?? '',
                          [t('csv.activenessAttention')]: engagement?.activenessAttention ?? '',
                          [t('csv.activenessStatus')]:
                              typeof engagement?.activenessState === 'number' && engagement.activenessState !== 1
                                  ? t(`activenessState.${engagement.activenessState}`, { defaultValue: '' })
                                  : '',
                      }
                    : {}),
            };
        });
        const csv = Papa.unparse(csvData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `past_attendance_session_${session.session_id}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setIsAttendanceExporting(false);
        toast.success(t('toast.attendanceDownloaded'));
    };

    // Convert LiveSessionReport to StudentTable format
    const convertToStudentTable = (reportData: LiveSessionReport[]): StudentTable[] => {
        return reportData.map((report) => ({
            id: report.studentId,
            username: report.instituteEnrollmentNumber || null,
            user_id: report.studentId,
            email: report.email,
            full_name: report.fullName,
            address_line: '',
            region: null,
            city: '',
            pin_code: '',
            mobile_number: report.mobileNumber,
            date_of_birth: '',
            gender: '',
            fathers_name: '',
            mothers_name: '',
            father_mobile_number: '',
            father_email: '',
            mother_mobile_number: '',
            mother_email: '',
            linked_institute_name: null,
            created_at: '',
            updated_at: '',
            package_session_id: '',
            institute_enrollment_id: report.instituteEnrollmentNumber || '',
            status: 'ACTIVE' as const,
            session_expiry_days: 0,
            institute_id: '',
            country: '',
            expiry_date: 0,
            face_file_id: null,
            parents_email: '',
            parents_mobile_number: '',
            parents_to_mother_email: '',
            parents_to_mother_mobile_number: '',
            destination_package_session_id: '',
            enroll_invite_id: '',
            payment_status: '',
            attendance_percent: 0,
            referral_count: 0,
            custom_fields: {},
        }));
    };

    // Checkbox selection handlers
    const handleSelectStudent = (studentId: string, isSelected: boolean) => {
        if (isSelected) {
            setSelectedStudentIds((prev) => [...prev, studentId]);
        } else {
            setSelectedStudentIds((prev) => prev.filter((id) => id !== studentId));
        }
    };

    const handleSelectAll = () => {
        if (!reportResponse) return;
        const allIds = reportResponse.map((report) => report.studentId);
        setSelectedStudentIds(allIds);
    };

    const handleClearAll = () => {
        setSelectedStudentIds([]);
    };

    const handleSendWhatsApp = () => {
        if (selectedStudents.length === 0) {
            toast.error(t('toast.selectAtLeastOneStudent'));
            return;
        }

        const bulkActionInfo: BulkActionInfo = {
            selectedStudentIds,
            selectedStudents,
            displayText: t('studentsCount', { count: selectedStudents.length }),
        };

        openBulkSendMessageDialog(bulkActionInfo);
    };

    const handleSendEmail = () => {
        if (selectedStudents.length === 0) {
            toast.error(t('toast.selectAtLeastOneStudent'));
            return;
        }

        // Store session ID and schedule ID for attendance context
        localStorage.setItem('currentSessionId', session.session_id);
        localStorage.setItem('currentScheduleId', session.schedule_id);
        console.log('📋 Stored session ID for attendance context:', session.session_id);
        console.log('📋 Stored schedule ID for attendance context:', session.schedule_id);

        const bulkActionInfo: BulkActionInfo = {
            selectedStudentIds,
            selectedStudents,
            displayText: t('studentsCount', { count: selectedStudents.length }),
        };

        openBulkSendEmailDialog(bulkActionInfo);
    };

    // Update selected students when selectedStudentIds changes
    React.useEffect(() => {
        if (reportResponse) {
            const studentTableData = convertToStudentTable(reportResponse);
            const filtered = studentTableData.filter((student) =>
                selectedStudentIds.includes(student.user_id)
            );
            setSelectedStudents(filtered);
        }
    }, [selectedStudentIds, reportResponse]);

    // Focus management for dialog
    React.useEffect(() => {
        if (openDialog && reportResponse && reportResponse.length > 0) {
            // Small delay to ensure the table is rendered
            setTimeout(() => {
                const firstCheckbox = document.querySelector('[role="checkbox"]') as HTMLElement;
                if (firstCheckbox) {
                    firstCheckbox.focus();
                }
            }, 100);
        }
    }, [openDialog, reportResponse]);

    const duration = useMemo(() => {
        if (
            !scheduledSessionDetails?.scheduleStartTime ||
            !scheduledSessionDetails?.scheduleLastEntryTime
        ) {
            return '';
        }

        try {
            const startTime = new Date(`1970-01-01T${scheduledSessionDetails.scheduleStartTime}`);
            const endTime = new Date(`1970-01-01T${scheduledSessionDetails.scheduleLastEntryTime}`);

            if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
                return '';
            }

            const diffMs = endTime.getTime() - startTime.getTime();

            if (diffMs < 0) return '';

            const hours = Math.floor(diffMs / 3600000);
            const minutes = Math.round((diffMs % 3600000) / 60000);

            const parts = [];
            if (hours > 0) {
                parts.push(`${hours} hr`);
            }
            if (minutes > 0) {
                parts.push(`${minutes} min`);
            }
            return parts.join(' ');
        } catch (error) {
            return '';
        }
    }, [scheduledSessionDetails]);

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

    const dateLabel = formatMeetingDate(session.meeting_date);
    const timeRangeLabel = formatTimeRange(session.start_time, session.last_entry_time);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);
    const teacherTerm = getTerminology(RoleTerms.Teacher, SystemTerms.Teacher);
    const liveSessionTerm = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const batchNames = (session.package_session_details ?? [])
        .map((d) => `${d.level_name} ${d.package_name}`.trim())
        .filter(Boolean);
    const goToSession = () =>
        navigate({
            to: '/study-library/live-session/view/$sessionId',
            params: { sessionId: session?.session_id || '' },
        });

    return (
        <SessionCardShell cardRef={cardRef} onClick={handleCardClick}>
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
                                aria-label={t('actions.viewDetails', {
                                    term: getTerminology(
                                        ContentTerms.LiveSession,
                                        SystemTerms.LiveSession
                                    ),
                                })}
                            >
                                <DotsThree size={20} weight="bold" />
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                                className="cursor-pointer gap-2"
                                onClick={goToSession}
                            >
                                <ArrowSquareOut size={16} />
                                {t('actions.viewDetails', {
                                    term: getTerminology(
                                        ContentTerms.LiveSession,
                                        SystemTerms.LiveSession
                                    ),
                                })}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                className="cursor-pointer gap-2"
                                onClick={goToSession}
                            >
                                <FilmSlate size={16} />
                                {t('actions.viewRecordings')}
                            </DropdownMenuItem>
                            {canDelete && session.schedule_id ? (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        className="cursor-pointer gap-2 text-danger-600 focus:text-danger-600"
                                        onClick={() => setOpenDeleteDialog(true)}
                                    >
                                        <Trash size={16} />
                                        {tCard('actions.deleteSession', { term: liveSessionTerm })}
                                    </DropdownMenuItem>
                                </>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                }
            />

            <SessionMetaRow>
                <SessionMetaItem
                    icon={<CalendarBlank size={16} />}
                    tone="primary"
                    value={dateLabel ?? session.meeting_date}
                />
                <SessionMetaItem
                    icon={<Clock size={16} />}
                    tone="info"
                    value={timeRangeLabel ?? session.start_time}
                />
                {session.timezone ? (
                    <SessionMetaItem
                        icon={<GlobeHemisphereWest size={16} />}
                        tone="success"
                        value={session.timezone}
                    />
                ) : null}
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
                    className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center"
                    onClick={(e) => e.stopPropagation()}
                >
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        className="w-full sm:w-auto sm:!min-w-0 sm:px-4"
                        onClick={handleOpenDialog}
                    >
                        <ClipboardText size={16} className="mr-2" />
                        {t('actions.viewAttendanceReport')}
                    </MyButton>
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="primary"
                        className="w-full sm:w-auto sm:!min-w-0 sm:px-5"
                        onClick={goToSession}
                    >
                        <ArrowSquareOut size={16} className="mr-2" />
                        {tCard('actions.openSession')}
                    </MyButton>
                </div>
            </SessionCardFooter>

            {/* Attendance Report Dialog */}
            <MyDialog
                heading={t('dialog.heading')}
                open={openDialog}
                onOpenChange={handleOpenDialog}
                className="w-[95vw] max-w-4xl sm:w-[80vw]"
            >
                <div className="flex flex-col gap-3 p-4 text-sm">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-xl font-bold">{scheduledSessionDetails?.title}</h2>
                            <p className="text-neutral-500">
                                {scheduledSessionDetails?.meetingDate}{' '}
                                {scheduledSessionDetails?.scheduleStartTime}
                            </p>
                        </div>
                    </div>

                    {/* Basic Details */}
                    <div className="rounded-lg">
                        <h3 className="mb-1 font-semibold">{t('dialog.basicClassDetails')}</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2">
                            <div className="flex gap-2">
                                <span className="font-bold">{t('dialog.session')}</span>
                                <span>
                                    {scheduledSessionDetails?.accessLevel === 'private'
                                        ? t('dialog.paidMembers')
                                        : t('dialog.openSession')}
                                </span>
                            </div>
                            <div className="flex gap-2">
                                <span className="font-bold">{t('dialog.occurrence')}</span>
                                <span>{scheduledSessionDetails?.recurrenceType}</span>
                            </div>
                            <div className="flex gap-2">
                                <span className="font-bold">{t('dialog.type')}</span>
                                <span>{scheduledSessionDetails?.accessLevel}</span>
                            </div>
                            <div className="flex gap-2">
                                <span className="font-bold">{t('dialog.duration')}</span>
                                <span>{duration}</span>
                            </div>
                        </div>
                    </div>

                    {/* Description */}
                    <div className="rounded-lg">
                        <h3 className="mb-1 text-lg font-semibold">{t('dialog.description')}</h3>
                        <div className="prose prose-sm max-w-none text-neutral-600">
                            {scheduledSessionDetails?.descriptionHtml ? (
                                <div
                                    dangerouslySetInnerHTML={{
                                        __html: scheduledSessionDetails?.descriptionHtml,
                                    }}
                                />
                            ) : (
                                t('dialog.noDescriptionAvailable')
                            )}
                        </div>
                    </div>

                    {/* Insights & Attendance */}
                    <div className="rounded-lg">
                        <h3 className="mb-2 text-lg font-semibold">
                            {t('dialog.participantsInsights')}
                        </h3>
                        <div className="flex flex-col items-center justify-center gap-4 rounded-md bg-neutral-100 p-4 sm:flex-row">
                            <div className="flex w-full flex-col items-center justify-center gap-3 sm:w-1/2">
                                <MyPieChart data={pieChartData} />
                                <div className="text-lg font-semibold">
                                    {t('dialog.totalParticipants', {
                                        count: attendanceSummary.total,
                                    })}
                                </div>
                            </div>
                            <div className="flex w-full flex-col gap-4 sm:w-1/2">
                                <div className="flex flex-col gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="size-4 rounded-full bg-success-400"></div>
                                        <div className="flex items-center gap-2 text-black">
                                            <span className="font-medium">
                                                {t('dialog.attendees')}
                                            </span>
                                            <span className="font-semibold text-success-600">
                                                {attendanceSummary.present}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="size-4 rounded-full bg-success-200"></div>
                                        <div className="flex items-center gap-2 text-black">
                                            <span className="font-medium">
                                                {t('dialog.notAttendees')}
                                            </span>
                                            <span className="font-semibold text-red-600">
                                                {attendanceSummary.absent}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-lg p-3">
                                    <div className="text-left">
                                        <div className="text-sm font-medium text-neutral-600">
                                            {t('dialog.attendancePercentage')}
                                        </div>
                                        <div className="text-xl font-bold text-primary-500">
                                            {attendanceSummary.total > 0
                                                ? (
                                                      (attendanceSummary.present /
                                                          attendanceSummary.total) *
                                                      100
                                                  ).toFixed(2)
                                                : '0.00'}
                                            %
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 rounded-lg">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-lg font-semibold">{t('dialog.attendance')}</h3>
                            <div className="flex items-center gap-2">
                                {/* Bulk Actions */}
                                {reportResponse && reportResponse.length > 0 && (
                                    <AttendanceBulkActions
                                        selectedCount={selectedStudentIds.length}
                                        selectedStudentIds={selectedStudentIds}
                                        selectedStudents={selectedStudents}
                                        onReset={handleClearAll}
                                        onSendWhatsApp={handleSendWhatsApp}
                                        onSendEmail={handleSendEmail}
                                    />
                                )}
                                <MyButton
                                    type="button"
                                    scale="medium"
                                    buttonType="primary"
                                    className="flex items-center"
                                    onClick={handleExportPastAttendance}
                                >
                                    {isAttendanceExporting ? (
                                        <>
                                            <div className="mr-2 size-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                                            <span>{t('actions.exporting')}</span>
                                        </>
                                    ) : (
                                        <>
                                            <DownloadSimple size={20} className="mr-2" />
                                            {t('actions.csv')}
                                        </>
                                    )}
                                </MyButton>
                            </div>
                        </div>

                        {reportResponse ? (
                            <AttendanceMarkingTable
                                data={reportResponse}
                                sessionId={session.session_id}
                                scheduleId={session.schedule_id}
                                accessType={session.access_level}
                                packageSessionDetails={session.package_session_details}
                                onSaved={() => {
                                    fetchReport({
                                        sessionId: session.session_id,
                                        scheduleId: session.schedule_id,
                                        accessType: session.access_level,
                                    });
                                }}
                            />
                        ) : isPending ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="border-primary size-6 animate-spin rounded-full border-2 border-t-transparent" />
                            </div>
                        ) : null}
                    </div>
                </div>
            </MyDialog>

            {canDelete && session.schedule_id ? (
                <DeletePastSessionDialog
                    open={openDeleteDialog}
                    onOpenChange={setOpenDeleteDialog}
                    scheduleId={session.schedule_id}
                    title={session.title}
                    dateLabel={dateLabel ?? session.meeting_date}
                    timeRangeLabel={timeRangeLabel ?? session.start_time}
                    isRecurring={session.recurrence_type !== 'once'}
                    term={liveSessionTerm}
                />
            ) : null}

            {/* Bulk Action Dialogs */}
            <SendMessageDialog />
            <SendEmailDialog />
        </SessionCardShell>
    );
}
