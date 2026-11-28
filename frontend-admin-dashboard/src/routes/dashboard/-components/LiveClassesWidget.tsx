import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { Plus, PencilSimpleLine, DownloadSimple, VideoCamera } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useDashboardUpcomingSessions } from '../-hooks/useDashboardSources';
import { useLiveSessionStore } from '@/routes/study-library/live-session/schedule/-store/sessionIdstore';
import {
    getSessionBySessionId,
    LiveSession,
    LiveSessionReport,
    UpcomingSessionDay,
} from '@/routes/study-library/live-session/-services/utils';
import {
    deleteLiveSession,
    createLiveSessionStep2,
} from '@/routes/study-library/live-session/schedule/-services/utils';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import {
    fetchSessionDetails,
    SessionDetailsResponse,
} from '@/routes/study-library/live-session/-hooks/useSessionDetails';
import { useLiveSessionReport } from '@/routes/study-library/live-session/-hooks/useLiveSessionReport';
import {
    buildRegistrationColumns,
    REGISTRATION_WIDTH,
    RegistrationTableData,
} from '@/routes/study-library/live-session/-constants/reportTable';
import { MyTable } from '@/components/design-system/table';
import { MyDialog } from '@/components/design-system/dialog';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { DotsThreeVertical } from '@phosphor-icons/react';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
    buildReportColumns,
    REPORT_WIDTH,
    ReportTableData,
} from '@/routes/study-library/live-session/-constants/reportTable';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import EditLiveLinkDialog from './EditLiveLinkDialog';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface LiveClassesWidgetProps {
    instituteId: string;
}

const LiveClassesWidget: React.FC<LiveClassesWidgetProps> = ({ instituteId }) => {
    const { t } = useTranslation('dashboardLiveClassesWidget');
    // Column headers are translated, so the definitions are built from the
    // report-table namespace (same pattern as live-session-card).
    const { t: tReportTable } = useTranslation('studyLibraryLiveSessionReportTable');
    const registrationColumns = buildRegistrationColumns(tReportTable);
    const reportColumns = buildReportColumns(tReportTable);
    const navigate = useNavigate();
    // Shared with the KPI band's "classes today" so the list is fetched once per load.
    const { data: upcomingData } = useDashboardUpcomingSessions(instituteId);
    const queryClient = useQueryClient();
    const {
        mutateAsync: fetchReport,
        data: reportData,
        isPending: reportLoading,
        error: reportError,
    } = useLiveSessionReport();

    // State and handlers for two-tab participant details dialog
    const [selectedTab, setSelectedTab] = React.useState<string>('Registration');
    const [isRegistrationExporting, setIsRegistrationExporting] = React.useState<boolean>(false);
    const [isAttendanceExporting, setIsAttendanceExporting] = React.useState<boolean>(false);

    const handleTabChange = (value: string) => {
        setSelectedTab(value);
    };

    const convertToRegistrationTableData = (data: LiveSessionReport[]): RegistrationTableData[] =>
        data.map((item, idx) => ({
            index: idx + 1,
            username: item.fullName,
            phoneNumber: item.mobileNumber,
            email: item.email,
        }));

    const tableData = {
        content: reportData ? convertToRegistrationTableData(reportData) : [],
        total_pages: 0,
        page_no: 0,
        page_size: 10,
        total_elements: 0,
        last: true,
    };

    const convertToAttendanceTableData = (data: LiveSessionReport[]): ReportTableData[] =>
        data.map((item, idx) => ({
            index: idx + 1,
            username: item.fullName,
            attendanceStatus: item.attendanceStatus,
        }));

    const tableAttendanceData = {
        content: reportData ? convertToAttendanceTableData(reportData) : [],
        total_pages: 0,
        page_no: 0,
        page_size: 10,
        total_elements: 0,
        last: true,
    };

    const handleExportRegistration = () => {
        setIsRegistrationExporting(true);
        const csv = Papa.unparse(tableData.content);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute(
            'download',
            `registrations_session_${activeDetails?.sessionId || ''}.csv`
        );
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setIsRegistrationExporting(false);
        toast.success(t('csvExport.registrationsDownloaded'));
    };

    const handleExportAttendance = () => {
        setIsAttendanceExporting(true);
        const csvData = tableAttendanceData.content.map((item) => ({
            index: item.index,
            username: item.username,
            attendanceStatus:
                item.attendanceStatus === 'PRESENT'
                    ? t('csvExport.attendanceStatus.present')
                    : item.attendanceStatus === 'ABSENT'
                      ? t('csvExport.attendanceStatus.absent')
                      : t('csvExport.attendanceStatus.unmarked'),
        }));
        const csv = Papa.unparse(csvData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `attendance_session_${activeDetails?.sessionId || ''}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setIsAttendanceExporting(false);
        toast.success(t('csvExport.attendanceDownloaded'));
    };

    const [dialogOpen, setDialogOpen] = React.useState(false);
    const [activeDetails, setActiveDetails] = React.useState<SessionDetailsResponse | null>(null);
    const sessions: LiveSession[] = upcomingData ? upcomingData.flatMap((day) => day.sessions) : [];
    const sessionsToShow = sessions.slice(0, 2);
    const remainingCount = sessions.length > 2 ? sessions.length - 2 : 0;
    const { clearSessionId, clearStep1Data } = useLiveSessionStore();

    // Delete confirmation state
    const [openDeleteDialog, setOpenDeleteDialog] = React.useState(false);
    const [currentSession, setCurrentSession] = React.useState<LiveSession | null>(null);

    // Dialog state for editing link
    const [editLinkDialogOpen, setEditLinkDialogOpen] = React.useState(false);
    const [sessionToEdit, setSessionToEdit] = React.useState<LiveSession | null>(null);

    // Dropdown delete item -> open simple confirm
    const handleDeleteClick = (session: LiveSession, e: React.MouseEvent) => {
        e.stopPropagation();
        setCurrentSession(session);
        setOpenDeleteDialog(true);
    };

    const handleViewRegistrations = async (session: LiveSession) => {
        try {
            const details = await fetchSessionDetails(session.schedule_id);
            setActiveDetails(details);
            await fetchReport({
                sessionId: session.session_id,
                scheduleId: session.schedule_id,
                accessType: session.access_level,
            });
            setDialogOpen(true);
        } catch (error) {
            console.error('Error loading registration details:', error);
        }
    };

    const handleAdd = () => {
        clearSessionId();
        clearStep1Data();
        navigate({ to: '/study-library/live-session/schedule/step1' });
    };

    // Override handleEdit to open the edit link dialog
    const handleEdit = (session: LiveSession) => {
        setSessionToEdit(session);
        setEditLinkDialogOpen(true);
    };

    // Handler for link update
    const handleUpdateLink = async (newLink: string) => {
        if (!sessionToEdit) return;
        try {
            // Fetch full session details to get schedule info
            const details = await getSessionBySessionId(sessionToEdit.session_id);
            const schedule = details.schedule;
            // Call step2 API to update join_link
            await createLiveSessionStep2({
                session_id: sessionToEdit.session_id,
                access_type: schedule.access_type,
                package_session_ids: schedule.package_session_ids,
                deleted_package_session_ids: [],
                join_link: newLink,
                added_notification_actions: [],
                updated_notification_actions: [],
                deleted_notification_action_ids: [],
                added_fields: [],
                updated_fields: [],
                deleted_field_ids: [],
            });
            // Optimistically update upcoming sessions cache so the widget shows the new link immediately
            queryClient.setQueryData<UpcomingSessionDay[]>(
                ['upcomingSessions', instituteId],
                (oldData) => {
                    if (!oldData) return oldData;
                    return oldData.map((day: UpcomingSessionDay) => ({
                        ...day,
                        sessions: day.sessions.map((sess: LiveSession) =>
                            sess.session_id === sessionToEdit.session_id
                                ? { ...sess, meeting_link: newLink }
                                : sess
                        ),
                    }));
                }
            );
            setEditLinkDialogOpen(false);
            setSessionToEdit(null);
        } catch (error) {
            console.error('Error updating live class link:', error);
        }
    };

    const handleDelete = async (e: React.MouseEvent, type: 'session' | 'schedule') => {
        e.stopPropagation();
        if (currentSession) {
            try {
                await deleteLiveSession([currentSession.session_id], type);
                queryClient.invalidateQueries({ queryKey: ['liveSessions', instituteId] });
                queryClient.invalidateQueries({ queryKey: ['upcomingSessions', instituteId] });
                setOpenDeleteDialog(false);
                setCurrentSession(null);
            } catch (error) {
                console.error('Error deleting session:', error);
            }
        }
    };

    return (
        <Card className="w-full bg-white shadow-sm">
            <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <span className="flex size-7 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                            <VideoCamera size={14} weight="duotone" />
                        </span>
                        <div className="min-w-0">
                            <CardTitle className="text-sm font-semibold">
                                {getTerminologyPlural(
                                    ContentTerms.LiveSession,
                                    SystemTerms.LiveSession
                                )}
                            </CardTitle>
                            <CardDescription className="line-clamp-1 text-2xs text-neutral-500 sm:text-xs">
                                {sessions.length > 0
                                    ? t('header.upcomingSessionsCount', { count: sessions.length })
                                    : t('header.noUpcomingSessions')}
                            </CardDescription>
                        </div>
                    </div>
                    <MyButton
                        type="button"
                        scale="medium"
                        layoutVariant="default"
                        buttonType="secondary"
                        onClick={handleAdd}
                        className="shrink-0 text-xs sm:text-sm"
                    >
                        <Plus size={14} className="mr-1" />
                        {t('header.addButton')}
                    </MyButton>
                </div>
            </CardHeader>
            <div className="flex flex-col gap-2 p-4 pt-2">
                <div className="flex flex-1 flex-col gap-2">
                    {sessionsToShow.length === 0 && (
                        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-200 bg-neutral-50/50 py-6 text-center">
                            <VideoCamera
                                size={20}
                                weight="duotone"
                                className="text-neutral-300"
                            />
                            <div className="text-2xs text-neutral-500">
                                {t('emptyState.noSessionsScheduledYet', {
                                    term: getTerminologyPlural(
                                        ContentTerms.LiveSession,
                                        SystemTerms.LiveSession
                                    ).toLowerCase(),
                                })}
                            </div>
                        </div>
                    )}
                    {sessionsToShow.map((session) => {
                        const time = format(
                            new Date(`${session.meeting_date}T${session.start_time}`),
                            'h:mm a'
                        );
                        return (
                            <div
                                key={session.session_id}
                                className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 transition-colors hover:border-primary-200"
                            >
                                {/* Header row with time and dropdown */}
                                <div className="flex items-start justify-between">
                                    <div className="flex flex-col">
                                        <span className="text-2xs uppercase tracking-wide text-neutral-500">
                                            {t('sessionCard.upcomingLabel')}
                                        </span>
                                        <span className="text-base font-semibold text-primary-600">
                                            {time}
                                        </span>
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button className="text-neutral-500 hover:text-neutral-700">
                                                <DotsThreeVertical
                                                    size={16}
                                                    className="sm:size-5"
                                                />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                                onClick={(e) => handleDeleteClick(session, e)}
                                            >
                                                {t('sessionCard.deleteSession')}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleViewRegistrations(session);
                                                }}
                                            >
                                                {t('sessionCard.viewParticipantDetails')}
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>

                                {/* Title */}
                                <div className="mb-1">
                                    <span className="text-xs font-medium sm:text-sm">
                                        {session.title}
                                    </span>
                                </div>

                                {/* Link input row */}
                                <div className="flex items-center gap-1 sm:gap-2">
                                    <input
                                        className="min-w-0 flex-1 rounded border bg-gray-50 px-2 py-1 text-xs sm:text-sm"
                                        value={session.meeting_link}
                                        readOnly
                                    />
                                    <button
                                        onClick={() => handleEdit(session)}
                                        className="shrink-0 text-neutral-500 hover:text-neutral-700"
                                    >
                                        <PencilSimpleLine size={14} className="sm:size-4" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    {remainingCount > 0 && (
                        <div className="self-start text-xs text-neutral-500">
                            {t('moreCount', { count: remainingCount })}
                        </div>
                    )}
                </div>
            </div>

            {/* Participant details dialog */}
            <MyDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                heading={t('participantDialog.heading')}
                className="w-dialog-xl"
            >
                <div className="flex h-full flex-col gap-3 p-2 text-sm sm:p-4">
                    <div className="mt-2 h-full rounded-lg sm:mt-4">
                        <Tabs value={selectedTab} onValueChange={handleTabChange}>
                            <div className="flex flex-row justify-between">
                                <TabsList className="inline-flex h-auto justify-start gap-2 rounded-none border-b !bg-transparent p-0 sm:gap-4">
                                    <TabsTrigger
                                        key={'Registration'}
                                        value={'Registration'}
                                        className={`flex gap-1 rounded-none px-4 py-2 text-xs !shadow-none sm:gap-1.5 sm:px-8 sm:text-sm lg:px-12 ${
                                            selectedTab === 'Registration'
                                                ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                                : 'border-none bg-transparent'
                                        }`}
                                    >
                                        {t('participantDialog.tabs.registeredUsers')}
                                    </TabsTrigger>
                                    <TabsTrigger
                                        key={'Attendance'}
                                        value={'Attendance'}
                                        className={`flex gap-1 rounded-none px-4 py-2 text-xs !shadow-none sm:gap-1.5 sm:px-8 sm:text-sm lg:px-12 ${
                                            selectedTab === 'Attendance'
                                                ? 'rounded-t-sm border !border-b-0 border-primary-200 !bg-primary-50'
                                                : 'border-none bg-transparent'
                                        }`}
                                    >
                                        {t('participantDialog.tabs.attendance')}
                                    </TabsTrigger>
                                </TabsList>
                            </div>

                            <TabsContent value={'Registration'} className="space-y-2 sm:space-y-4">
                                {reportLoading ? (
                                    <DashboardLoader />
                                ) : (
                                    <>
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <h3 className="mb-1 text-base font-semibold sm:mb-2 sm:text-lg">
                                                {t('participantDialog.registration.title')}
                                            </h3>
                                            <MyButton
                                                type="button"
                                                scale="large"
                                                buttonType="secondary"
                                                className="flex w-full items-center justify-center font-medium sm:w-auto"
                                                onClick={handleExportRegistration}
                                            >
                                                {isRegistrationExporting ? (
                                                    <DashboardLoader />
                                                ) : (
                                                    <>
                                                        <DownloadSimple
                                                            size={16}
                                                            className="mr-1 sm:mr-2 sm:size-5"
                                                        />
                                                        {t('participantDialog.registration.exportButton')}
                                                    </>
                                                )}
                                            </MyButton>
                                        </div>
                                        <MyTable<RegistrationTableData>
                                            data={tableData}
                                            columns={registrationColumns}
                                            isLoading={reportLoading}
                                            error={reportError as Error | null}
                                            columnWidths={REGISTRATION_WIDTH}
                                            currentPage={1}
                                            className={`!h-[60vh] !w-full sm:!h-[70%]` /* design-lint-ignore: viewport-relative table height inside dialog tab, no fixed-size token fits a scrollable table area */}
                                        />
                                    </>
                                )}
                            </TabsContent>
                            <TabsContent value={'Attendance'} className="space-y-2 sm:space-y-4">
                                {reportLoading ? (
                                    <DashboardLoader />
                                ) : (
                                    <>
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <h3 className="mb-1 text-base font-semibold sm:mb-2 sm:text-lg">
                                                {t('participantDialog.attendance.title')}
                                            </h3>
                                            <MyButton
                                                type="button"
                                                scale="large"
                                                buttonType="secondary"
                                                className="flex w-full items-center justify-center font-medium sm:w-auto"
                                                onClick={handleExportAttendance}
                                            >
                                                {isAttendanceExporting ? (
                                                    <DashboardLoader />
                                                ) : (
                                                    <>
                                                        <DownloadSimple
                                                            size={16}
                                                            className="mr-1 sm:mr-2 sm:size-5"
                                                        />
                                                        {t('participantDialog.attendance.exportButton')}
                                                    </>
                                                )}
                                            </MyButton>
                                        </div>
                                        <MyTable<ReportTableData>
                                            data={tableAttendanceData}
                                            columns={reportColumns}
                                            isLoading={reportLoading}
                                            error={reportError as Error | null}
                                            columnWidths={REPORT_WIDTH}
                                            currentPage={1}
                                            className={`!h-[60vh] !w-full sm:!h-[70%]` /* design-lint-ignore: viewport-relative table height inside dialog tab, no fixed-size token fits a scrollable table area */}
                                        />
                                    </>
                                )}
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>
            </MyDialog>

            {/* Confirm delete dialog */}
            <MyDialog
                heading={t('deleteDialog.heading')}
                open={openDeleteDialog}
                onOpenChange={() => setOpenDeleteDialog(!openDeleteDialog)}
                className="w-dialog-md max-w-md sm:w-fit sm:max-w-4xl"
            >
                <div className="flex h-full flex-col gap-3 p-3 sm:p-4">
                    <div className="text-sm sm:text-lg">
                        {t('deleteDialog.confirmMessage')}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <MyButton
                            onClick={(e) => {
                                handleDelete(e, 'session');
                            }}
                            className="w-full sm:w-auto"
                        >
                            {t('deleteDialog.yes')}
                        </MyButton>
                        <MyButton
                            onClick={(e) => {
                                handleDelete(e, 'schedule');
                            }}
                            className="w-full sm:w-auto"
                        >
                            {t('deleteDialog.no')}
                        </MyButton>
                    </div>
                </div>
            </MyDialog>

            <EditLiveLinkDialog
                open={editLinkDialogOpen}
                onOpenChange={setEditLinkDialogOpen}
                currentLink={sessionToEdit?.meeting_link || ''}
                onUpdate={handleUpdateLink}
            />
        </Card>
    );
};

export default LiveClassesWidget;
