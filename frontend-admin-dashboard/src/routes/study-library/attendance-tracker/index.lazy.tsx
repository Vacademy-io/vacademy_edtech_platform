/* eslint-disable tailwindcss/no-custom-classname */
import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MyButton } from '@/components/design-system/button';
import { Eye, ArrowSquareOut, X, DownloadSimple, Warning, Check } from '@phosphor-icons/react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { SidebarProvider } from '@/components/ui/sidebar';
import { StudentSidebar } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-side-view';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import type { StudentTable } from '@/types/student-table-types';
import { Calendar } from '@/components/ui/calendar';
import { format, subDays, startOfDay } from 'date-fns';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getStudentAttendanceReport, StudentSchedule } from '../live-session/-services/utils';
import { useGetAttendance } from './-services/attendance';
import { MyPagination } from '@/components/design-system/pagination';
import { MyTable } from '@/components/design-system/table';
import type { ColumnDef, RowSelectionState, OnChangeFn } from '@tanstack/react-table';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { MyDialog } from '@/components/design-system/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

type ExportScope = 'both' | 'present' | 'absent';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';

import { CaretUpDown, CaretDownIcon } from '@phosphor-icons/react';
import { MyDropdown } from '@/components/common/students/enroll-manually/dropdownForPackageItems';
import { Checkbox } from '@/components/ui/checkbox';
import { useGetBatchesQuery } from '@/routes/manage-institute/batches/-services/get-batches';
import { useStudentFilters } from '@/routes/manage-students/students-list/-hooks/useStudentFilters';
import {
    BatchType,
    batchWithStudentDetails,
} from '@/routes/manage-institute/batches/-types/manage-batches-types';
import { DateRange } from 'react-day-picker';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { LIVE_SESSION_ALL_ATTENDANCE } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import type { AttendanceResponseType, ContentType } from './-services/attendance';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export const Route = createLazyFileRoute('/study-library/attendance-tracker/')({
    component: RouteComponent,
});

interface ClassAttendanceItem {
    id: string;
    className: string;
    date: string;
    time: string;
    // Anything not explicitly PRESENT is treated as Absent (no separate "Unmarked" state).
    status: 'Present' | 'Absent';
}

type ClassAttendanceData = {
    [key: string]: ClassAttendanceItem[];
};

// Batches without an active DEFAULT enroll invite have a null invite_code; appending it
// blindly renders "Batch name (null)" in the picker.
const batchLabel = (batch: BatchType): string =>
    batch.invite_code ? `${batch.batch_name} (${batch.invite_code})` : batch.batch_name;

const formatDurationMinutes = (mins: number | null | undefined, t: TFunction): string => {
    if (mins == null || mins <= 0) return '—';
    if (mins < 60) return t('duration.minutes', { count: mins });
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0
        ? t('duration.hoursOnly', { count: h })
        : t('duration.hoursMinutes', { hours: h, minutes: m });
};

// Convert a 24-hour "HH:mm[:ss]" time string into a 12-hour "h:mm AM/PM" label.
const formatTime12h = (time: string | null | undefined, t: TFunction): string => {
    if (!time) return '—';
    const [hStr, mStr = '00'] = time.split(':');
    const h = Number(hStr);
    if (Number.isNaN(h)) return time; // unexpected format → show as-is
    const period = h >= 12 ? t('time.pm') : t('time.am');
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${mStr.padStart(2, '0')} ${period}`;
};

interface AttendanceStudent {
    id: string; // studentId
    name: string;
    username?: string;
    batch: string; // resolved batch name or "All Batches"
    packageSessionId?: string;
    mobileNumber: string;
    email: string;
    attendedClasses: number;
    totalClasses: number;
    attendancePercentage: number;
    avgDurationMinutes: number | null;
}

// runtime generated from API. fallback empty.
const classAttendanceData: ClassAttendanceData = {};

// Columns for the per-learner session table shown in the View More dialog.
const buildSessionColumns = (t: TFunction): ColumnDef<ClassAttendanceItem>[] => [
    {
        id: 'className',
        accessorKey: 'className',
        size: 520,
        minSize: 240,
        maxSize: 640,
        header: t('sessionColumns.class'),
        cell: ({ row }) => (
            <span className="font-medium text-neutral-800">{row.original.className}</span>
        ),
    },
    {
        id: 'date',
        accessorKey: 'date',
        size: 160,
        minSize: 120,
        maxSize: 200,
        header: t('sessionColumns.date'),
        cell: ({ row }) => <span className="text-neutral-600">{row.original.date}</span>,
    },
    {
        id: 'time',
        accessorKey: 'time',
        size: 150,
        minSize: 100,
        maxSize: 180,
        header: t('sessionColumns.time'),
        cell: ({ row }) => (
            <span className="text-neutral-600">{formatTime12h(row.original.time, t)}</span>
        ),
    },
    {
        id: 'status',
        size: 160,
        minSize: 110,
        maxSize: 200,
        header: t('sessionColumns.status'),
        cell: ({ row }) => {
            const status = row.original.status;
            return (
                <span
                    className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                        status === 'Present'
                            ? 'bg-success-50 text-success-600'
                            : 'bg-danger-100 text-danger-600'
                    }`}
                >
                    {status === 'Present' ? t('status.present') : t('status.absent')}
                </span>
            );
        },
    },
];

// Attendance Modal Component
interface AttendanceModalProps {
    isOpen: boolean;
    onClose: () => void;
    student: AttendanceStudent | null;
    batchId: string;
    startDate?: Date;
    endDate?: Date;
}

const AttendanceModal = ({
    isOpen,
    onClose,
    student,
    batchId,
    startDate,
    endDate,
}: AttendanceModalProps) => {
    const { t } = useTranslation('studyLibraryAttendanceTrackerIndexLazy');
    const [loading, setLoading] = useState(false);
    const [studentClasses, setStudentClasses] = useState<ClassAttendanceItem[]>([]);
    const [overallAttendance, setOverallAttendance] = useState<number | null>(null);
    const sessionColumns = useMemo(() => buildSessionColumns(t), [t]);

    useEffect(() => {
        const showAttendance = async () => {
            if (!student || !isOpen) return;

            // 1️⃣ Reuse sessions that were already fetched with the batch call.
            const cached = classAttendanceData[student.id];
            if (cached && cached.length) {
                setStudentClasses(cached);
                setOverallAttendance(student.attendancePercentage);
                return; // no extra API call needed ✔️
            }

            // 2️⃣ Fallback – fetch from student-report endpoint.
            try {
                setLoading(true);
                const start = startDate ? format(startDate, 'yyyy-MM-dd') : '2020-01-01';
                const end = endDate
                    ? format(endDate, 'yyyy-MM-dd')
                    : format(new Date(), 'yyyy-MM-dd');

                const report = await getStudentAttendanceReport(
                    student.id,
                    batchId !== '' ? batchId : undefined,
                    start,
                    end
                );

                setOverallAttendance(Math.round(report.attendancePercentage));

                const transformed: ClassAttendanceItem[] = report.schedules.map(
                    (s: StudentSchedule) => ({
                        id: s.scheduleId,
                        className: s.sessionTitle,
                        date: s.meetingDate,
                        time: s.startTime,
                        status: s.attendanceStatus === 'PRESENT' ? 'Present' : 'Absent',
                    })
                );

                // cache for next time
                classAttendanceData[student.id] = transformed;
                setStudentClasses(transformed);
            } catch (err) {
                console.error('Failed to fetch attendance report', err);
            } finally {
                setLoading(false);
            }
        };

        showAttendance();
    }, [student, batchId, startDate, endDate, isOpen]);

    if (!student) return null;

    // Breakdown for the donut chart / legend. Colors are design-token CSS vars
    // (fed to recharts as SVG fill values).
    const totalSessions = studentClasses.length;
    const presentCount = studentClasses.filter((c) => c.status === 'Present').length;
    const absentCount = studentClasses.filter((c) => c.status === 'Absent').length;
    const chartData = [
        { name: 'Present', value: presentCount, color: 'hsl(var(--success-500))' },
        { name: 'Absent', value: absentCount, color: 'hsl(var(--danger-500))' },
    ];

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="flex max-h-[85vh] w-full flex-col sm:max-w-5xl">
                <div className="flex items-center justify-between border-b border-neutral-200 p-4">
                    <h2 className="text-lg font-semibold text-neutral-800">
                        {t('modal.classAttendanceTitle', { name: student.name })}
                    </h2>
                </div>

                <div className="flex flex-col gap-4 overflow-y-auto p-4">
                    {/* Overall Attendance — donut chart + breakdown */}
                    {loading ? (
                        <div className="flex h-40 items-center justify-center rounded-lg bg-primary-50 text-sm text-neutral-500">
                            {t('modal.loadingAttendance')}
                        </div>
                    ) : totalSessions === 0 ? null : (
                        <div className="flex flex-col items-center gap-6 rounded-lg bg-primary-50 p-4 sm:flex-row sm:justify-center sm:gap-12">
                            {/* Donut */}
                            <div className="relative size-40 shrink-0">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={chartData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={52}
                                            outerRadius={72}
                                            paddingAngle={totalSessions > 0 ? 2 : 0}
                                            dataKey="value"
                                            stroke="none"
                                        >
                                            {chartData.map((entry) => (
                                                <Cell key={entry.name} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip
                                            formatter={(value: number, name: string) => [
                                                t('modal.classCount', { count: value }),
                                                name === 'Present'
                                                    ? t('status.present')
                                                    : t('status.absent'),
                                            ]}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-3xl font-bold text-primary-500">
                                        {overallAttendance !== null ? `${overallAttendance}%` : '--'}
                                    </span>
                                    <span className="text-xs text-neutral-500">
                                        {t('modal.attendanceLabel')}
                                    </span>
                                </div>
                            </div>

                            {/* Legend / counts */}
                            <div className="flex w-full max-w-xs flex-col gap-2.5">
                                {chartData.map((entry) => (
                                    <div
                                        key={entry.name}
                                        className="flex items-center justify-between"
                                    >
                                        <div className="flex items-center gap-2">
                                            {/* data-driven chart color */}
                                            <span
                                                className="size-3 shrink-0 rounded-full"
                                                style={{ backgroundColor: entry.color }}
                                            />
                                            <span className="text-sm text-neutral-700">
                                                {entry.name === 'Present'
                                                    ? t('status.present')
                                                    : t('status.absent')}
                                            </span>
                                        </div>
                                        <span className="text-sm font-semibold text-neutral-800">
                                            {entry.value}
                                            <span className="ml-1 text-xs font-normal text-neutral-400">
                                                (
                                                {totalSessions
                                                    ? Math.round((entry.value / totalSessions) * 100)
                                                    : 0}
                                                %)
                                            </span>
                                        </span>
                                    </div>
                                ))}
                                <div className="mt-1 flex items-center justify-between border-t border-neutral-200 pt-2">
                                    <span className="text-sm font-medium text-neutral-700">
                                        {t('modal.totalClasses')}
                                    </span>
                                    <span className="text-sm font-semibold text-neutral-800">
                                        {totalSessions}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Class List */}
                    {!loading && studentClasses.length === 0 ? (
                        <p className="py-6 text-center text-sm text-neutral-500">
                            {t('modal.noSessions')}
                        </p>
                    ) : (
                        <MyTable<ClassAttendanceItem>
                            data={{
                                content: studentClasses,
                                total_pages: 1,
                                page_no: 0,
                                page_size: studentClasses.length || 10,
                                total_elements: studentClasses.length,
                                last: true,
                            }}
                            columns={sessionColumns}
                            isLoading={loading}
                            error={null}
                            currentPage={0}
                            scrollable
                        />
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

function RouteComponent() {
    return (
        <LayoutContainer>
            <AttendanceTrackerContent />
        </LayoutContainer>
    );
}

function AttendanceTrackerContent() {
    const { t } = useTranslation('studyLibraryAttendanceTrackerIndexLazy');
    const [startDate, setStartDate] = useState<Date | undefined>(subDays(new Date(), 7));
    const [endDate, setEndDate] = useState<Date | undefined>(new Date());
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLiveSessions, setSelectedLiveSessions] = useState<string[]>([]);
    const [attendanceFilter, setAttendanceFilter] = useState('All');
    const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({
        from: subDays(new Date(), 7),
        to: new Date(),
    });
    const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
    const { currentSession, sessionList, handleSessionChange } = useStudentFilters();
    const { data: batches } = useGetBatchesQuery({ sessionId: currentSession.id });
    const [page, setPage] = useState(0);
    // Row selection is tracked per page (keyed by TanStack row index), matching the
    // students-list MyTable pattern.
    const [rowSelections, setRowSelections] = useState<Record<number, RowSelectionState>>({});
    const [sortConfig, setSortConfig] = useState<{
        key: string | null;
        direction: 'asc' | 'desc';
    }>({
        key: null,
        direction: 'asc',
    });
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedAttendanceStudent, setSelectedAttendanceStudent] =
        useState<AttendanceStudent | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { setSelectedStudent: setSidebarStudent } = useStudentSidebar();

    // Extract batch options for dropdown
    const batchOptions = useMemo(() => {
        if (!batches || !Array.isArray(batches))
            return [{ label: t('filters.allBatches'), value: null }];

        const extractedBatches = batches.flatMap((batchData: batchWithStudentDetails) =>
            batchData.batches.map((batch: BatchType) => ({
                label: batchLabel(batch),
                value: batch.package_session_id,
            }))
        );

        return [{ label: t('filters.allBatches'), value: null }, ...extractedBatches];
    }, [batches, t]);

    // Map packageSessionId → { batchName, packageId, packageName } for fast lookup
    const batchInfoMap = useMemo(() => {
        const map = new Map<string, { batchName: string; packageId: string; packageName: string }>();
        if (batches && Array.isArray(batches)) {
            for (const batchData of batches as batchWithStudentDetails[]) {
                for (const batch of batchData.batches) {
                    map.set(batch.package_session_id, {
                        batchName: batchLabel(batch),
                        packageId: batchData.package_dto.id,
                        packageName: batchData.package_dto.package_name,
                    });
                }
            }
        }
        return map;
    }, [batches]);

    // Reset batch selection when session changes, and re-enable the one-shot auto-select below
    const hasAutoSelectedBatchRef = useRef(false);
    useEffect(() => {
        setSelectedBatchIds([]);
        hasAutoSelectedBatchRef.current = false;
    }, [currentSession.id]);

    // Select the first batch as default once per session load — never override an explicit
    // "All Batches" (empty) selection the user makes afterwards.
    useEffect(() => {
        if (hasAutoSelectedBatchRef.current) return;
        if (batchOptions.length > 1 && selectedBatchIds.length === 0) {
            const firstBatch = batchOptions[1];
            if (firstBatch && firstBatch.value) {
                setSelectedBatchIds([firstBatch.value]);
                hasAutoSelectedBatchRef.current = true;
            }
        }
    }, [batchOptions, selectedBatchIds]);

    // Selection for the current page + a per-page setter for MyTable.
    const currentPageSelection = rowSelections[page] || {};
    const handleRowSelectionChange: OnChangeFn<RowSelectionState> = (updater) => {
        setRowSelections((prev) => {
            const next = typeof updater === 'function' ? updater(prev[page] || {}) : updater;
            return { ...prev, [page]: next };
        });
    };
    const totalSelectedCount = Object.values(rowSelections).reduce(
        (count, sel) => count + Object.values(sel).filter(Boolean).length,
        0
    );

    // MyTable sortable headers call this via table meta.
    const handleSort = (columnId: string, direction: string) => {
        setSortConfig({
            key: columnId,
            direction: direction.toLowerCase() === 'desc' ? 'desc' : 'asc',
        });
    };

    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, [setNavHeading, t]);

    // Sync dateRange with individual date states for backwards compatibility
    useEffect(() => {
        setStartDate(dateRange.from);
        setEndDate(dateRange.to);
    }, [dateRange]);

    // Debounce search input so the API only fires after the user stops typing
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearchQuery(searchInput);
            setPage(0);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchInput]);

    // "All Batches" sends batch_ids: null, so this is the only thing scoping the report to
    // the current institute — never drop it.
    const instituteId = getInstituteId() ?? '';

    const filterRequest = useMemo(
        () => ({
            institute_id: instituteId,
            name: searchQuery,
            start_date: startDate ? format(startDate, 'yyyy-MM-dd') : '2020-01-01',
            end_date: endDate ? format(endDate, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd'),
            batch_ids: selectedBatchIds.length > 0 ? selectedBatchIds : null,
            live_session_ids: selectedLiveSessions.length > 0 ? selectedLiveSessions : null,
        }),
        [instituteId, searchQuery, startDate, endDate, selectedBatchIds, selectedLiveSessions]
    );

    // Use attendance service hook
    const {
        data: attendanceData,
        isLoading,
        error,
    } = useGetAttendance({
        pageNo: page,
        pageSize: 10,
        filterRequest,
    });

    // Fallback label for the Batch column when a learner's package_session can't be resolved.
    const selectedBatchLabel = useMemo(() => {
        if (selectedBatchIds.length !== 1) return t('filters.allBatches');
        const batch = batchOptions.find((opt) => opt.value === selectedBatchIds[0]);
        return batch?.label || t('filters.allBatches');
    }, [selectedBatchIds, batchOptions, t]);

    // Process attendance data to match current table structure
    const studentsData = useMemo(() => {
        if (!attendanceData?.pages) return [];

        const allStudents: AttendanceStudent[] = [];

        attendanceData.pages.forEach((pageData) => {
            console.log('pageData', pageData);
            if (pageData?.content) {
                const mappedStudents = pageData.content.map((student: ContentType) => {
                    const total = student.sessions.length;
                    const attended = student.sessions.filter(
                        (s) => s.attendanceStatus === 'PRESENT'
                    ).length;
                    const percent = student.attendancePercentage;

                    const sessionsWithDuration = student.sessions.filter(
                        (s) => typeof s.durationMinutes === 'number' && s.durationMinutes > 0
                    );
                    const avgDurationMinutes = sessionsWithDuration.length
                        ? Math.round(
                              sessionsWithDuration.reduce(
                                  (acc, s) => acc + (s.durationMinutes ?? 0),
                                  0
                              ) / sessionsWithDuration.length
                          )
                        : null;

                    // Store sessions for modal
                    classAttendanceData[student.studentId] = student.sessions.map((sess) => ({
                        id: sess.scheduleId,
                        className: sess.title,
                        date: sess.meetingDate,
                        time: sess.startTime,
                        status: sess.attendanceStatus === 'PRESENT' ? 'Present' : 'Absent',
                    }));

                    const batchInfo = student.packageSessionId
                        ? batchInfoMap.get(student.packageSessionId)
                        : null;

                    return {
                        id: student.studentId,
                        name: student.fullName,
                        username: student.instituteEnrollmentNumber || '',
                        batch: batchInfo?.batchName || selectedBatchLabel,
                        packageSessionId: student.packageSessionId,
                        mobileNumber: student.mobileNumber,
                        email: student.email,
                        attendedClasses: attended,
                        totalClasses: total,
                        attendancePercentage: percent,
                        avgDurationMinutes,
                    };
                });
                allStudents.push(...mappedStudents);
            }
        });

        return allStudents;
    }, [attendanceData, selectedBatchLabel, batchInfoMap]);

    // Client-side sort of the current page by learner name (server returns unsorted rows).
    const sortedStudents = useMemo(() => {
        if (!sortConfig.key) return studentsData;
        const sorted = [...studentsData].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
        );
        return sortConfig.direction === 'desc' ? sorted.reverse() : sorted;
    }, [studentsData, sortConfig]);

    // Function to clear all filters
    const clearFilters = () => {
        setStartDate(undefined);
        setEndDate(undefined);
        setDateRange({});
        setSearchQuery('');
        setSearchInput('');
        setSelectedBatchIds([]);
        setSelectedLiveSessions([]);
        setAttendanceFilter('All');
    };

    // Function to handle View More click (attendance details modal)
    const handleViewMoreClick = useCallback((student: AttendanceStudent) => {
        setSelectedAttendanceStudent(student);
        setIsModalOpen(true);
    }, []);

    // Function to handle student details view (eye icon in first column).
    // Populates the shared StudentSidebar context with a minimal StudentTable —
    // sub-components (StudentOverview etc.) refetch full details by user_id.
    const handleViewDetailsClick = useCallback((student: AttendanceStudent) => {
        const packageSessionId =
            student.packageSessionId ||
            (selectedBatchIds.length === 1 ? selectedBatchIds[0] : '') ||
            '';
        const resolvedPackageId = packageSessionId
            ? batchInfoMap.get(packageSessionId)?.packageId
            : undefined;

        const minimalStudent: StudentTable = {
            id: student.id,
            user_id: student.id,
            username: student.username || null,
            email: student.email,
            full_name: student.name,
            mobile_number: student.mobileNumber,
            institute_enrollment_id: student.username || '',
            institute_enrollment_number: student.username || '',
            package_session_id: packageSessionId,
            package_id: resolvedPackageId,
            status: 'ACTIVE',
            face_file_id: null,
            address_line: '',
            attendance_percent: student.attendancePercentage,
            referral_count: 0,
            region: null,
            city: '',
            pin_code: '',
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
            session_expiry_days: 0,
            institute_id: '',
            expiry_date: 0,
            parents_email: '',
            parents_mobile_number: '',
            parents_to_mother_email: '',
            parents_to_mother_mobile_number: '',
            destination_package_session_id: '',
            enroll_invite_id: '',
            payment_status: '',
            custom_fields: {},
        };
        // openOverlay:false → open the right-side drawer, not the full-screen profile overlay.
        setSidebarStudent(minimalStudent, { openOverlay: false });
        setIsSidebarOpen(true);
    }, [selectedBatchIds, batchInfoMap, setSidebarStudent]);

    // Column definitions for the MyTable-based attendance table.
    const attendanceColumns = useMemo<ColumnDef<AttendanceStudent>[]>(
        () => [
            {
                id: 'checkbox',
                size: 50,
                minSize: 50,
                maxSize: 50,
                enableResizing: false,
                enablePinning: true,
                header: ({ table }) => (
                    <Checkbox
                        checked={table.getIsAllRowsSelected()}
                        onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                        className="border-neutral-400 bg-white text-neutral-600 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
                    />
                ),
                cell: ({ row }) => (
                    <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(value) => row.toggleSelected(!!value)}
                        className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
                    />
                ),
            },
            {
                id: 'details',
                size: 72,
                minSize: 60,
                maxSize: 100,
                enablePinning: true,
                header: t('table.detailsHeader'),
                cell: ({ row }) => (
                    <button
                        className="text-neutral-500 hover:text-primary-500"
                        onClick={() => handleViewDetailsClick(row.original)}
                        aria-label={t('table.viewDetails')}
                    >
                        <ArrowSquareOut size={20} />
                    </button>
                ),
            },
            {
                id: 'full_name',
                accessorKey: 'name',
                size: 190,
                minSize: 150,
                maxSize: 320,
                enablePinning: true,
                header: (props) => {
                    const meta = props.table.options.meta as {
                        onSort?: (columnId: string, direction: string) => void;
                    };
                    return (
                        <MyDropdown
                            dropdownList={['ASC', 'DESC']}
                            onSelect={(value) => {
                                if (typeof value === 'string')
                                    meta.onSort?.('full_name', value);
                            }}
                        >
                            <button
                                type="button"
                                className="flex w-full items-center justify-between gap-1 text-neutral-700 hover:text-neutral-900 focus:outline-none"
                                aria-label={t('table.sortLearnerName')}
                            >
                                <span>{t('table.learnerName')}</span>
                                <CaretUpDown />
                            </button>
                        </MyDropdown>
                    );
                },
                cell: ({ row }) => (
                    <span className="font-medium text-neutral-800">{row.original.name}</span>
                ),
            },
            {
                accessorKey: 'username',
                size: 130,
                minSize: 100,
                maxSize: 220,
                header: t('table.username'),
                cell: ({ row }) => <span>{row.original.username || '—'}</span>,
            },
            {
                id: 'batch',
                accessorKey: 'batch',
                size: 200,
                minSize: 140,
                maxSize: 320,
                header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
                cell: ({ row }) => (
                    <span className="line-clamp-2" title={row.original.batch}>
                        {row.original.batch}
                    </span>
                ),
            },
            {
                accessorKey: 'mobileNumber',
                size: 150,
                minSize: 120,
                maxSize: 220,
                header: t('table.mobileNumber'),
                cell: ({ row }) => <span>{row.original.mobileNumber || '—'}</span>,
            },
            {
                accessorKey: 'email',
                size: 230,
                minSize: 160,
                maxSize: 340,
                header: t('table.email'),
                cell: ({ row }) => (
                    <span className="block truncate" title={row.original.email}>
                        {row.original.email || '—'}
                    </span>
                ),
            },
            {
                id: 'avgDuration',
                size: 120,
                minSize: 100,
                maxSize: 160,
                header: t('table.avgDuration'),
                cell: ({ row }) => (
                    <span>{formatDurationMinutes(row.original.avgDurationMinutes, t)}</span>
                ),
            },
            {
                id: 'attendance',
                size: 220,
                minSize: 180,
                maxSize: 300,
                header: t('table.liveClassesAttendance'),
                cell: ({ row }) => {
                    const student = row.original;
                    return (
                        <div className="flex flex-col">
                            <span>
                                {student.attendedClasses}/{student.totalClasses}{' '}
                                {t('table.attended')}
                            </span>
                            <div className="mt-1 flex items-center gap-3">
                                <button
                                    className="flex items-center gap-1 font-medium text-primary-500 hover:underline"
                                    onClick={() => handleViewMoreClick(student)}
                                >
                                    <Eye size={14} />
                                    {t('table.viewMore')}
                                </button>
                                <div className="h-4 w-px bg-neutral-300"></div>
                                <span
                                    className={`rounded-full px-2 py-0.5 font-medium ${
                                        student.attendancePercentage >= 75
                                            ? 'bg-success-50 text-success-600'
                                            : student.attendancePercentage >= 50
                                              ? 'bg-warning-50 text-warning-600'
                                              : 'bg-danger-50 text-danger-600'
                                    }`}
                                >
                                    {student.attendancePercentage}%
                                </span>
                            </div>
                        </div>
                    );
                },
            },
        ],
        [handleViewDetailsClick, handleViewMoreClick, t]
    );

    // Pagination helpers - with server-side pagination
    const totalPages = attendanceData?.pages?.[0]?.totalPages || 1;
    const totalElements = attendanceData?.pages?.[0]?.totalElements || 0;

    // Fetch all pages of attendance data for export
    const fetchAllAttendancePages = async (): Promise<ContentType[]> => {
        const allContent: ContentType[] = [];
        let currentPage = 0;
        let hasMore = true;
        const pageSize = 50;

        while (hasMore) {
            const response = await authenticatedAxiosInstance.post<AttendanceResponseType>(
                `${LIVE_SESSION_ALL_ATTENDANCE}?page=${currentPage}&size=${pageSize}`,
                filterRequest
            );
            const data = response.data;
            if (data?.content) {
                allContent.push(...data.content);
            }
            hasMore = !data?.last;
            currentPage++;
        }
        return allContent;
    };

    const downloadCsv = (csvString: string, filename: string) => {
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const [isExporting, setIsExporting] = useState(false);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);
    const [exportScope, setExportScope] = useState<ExportScope>('both');

    const exportAccountDetails = async (_sel: AttendanceStudent[]) => {
        setIsExporting(true);
        try {
            const allStudents = await fetchAllAttendancePages();
            const csvData = allStudents.map((student) => {
                const info = student.packageSessionId
                    ? batchInfoMap.get(student.packageSessionId)
                    : undefined;
                return {
                    [t('csv.name')]: student.fullName || '',
                    [t('csv.email')]: student.email || '',
                    [t('csv.mobileNumber')]: student.mobileNumber || '',
                    [t('csv.enrollmentNumber')]: student.instituteEnrollmentNumber || '',
                    // 'Batch': info?.batchName || '',
                    [t('csv.course')]: info?.packageName || '',
                    [t('csv.gender')]: student.gender || '',
                    [t('csv.enrollmentStatus')]: student.enrollmentStatus || '',
                };
            });
            const csv = Papa.unparse(csvData);
            downloadCsv(csv, `attendance_account_details_${format(new Date(), 'yyyy-MM-dd')}.csv`);
            toast.success(t('toasts.accountDetailsSuccess'));
        } catch (error) {
            console.error('Export failed:', error);
            toast.error(t('toasts.accountDetailsFailure'));
        } finally {
            setIsExporting(false);
        }
    };

    const exportFullData = async (scope: ExportScope = 'both') => {
        const includePresent = scope === 'both' || scope === 'present';
        const includeAbsent = scope === 'both' || scope === 'absent';
        setIsExporting(true);
        try {
            const allStudents = await fetchAllAttendancePages();

            const csvData = allStudents
                .map((student) => {
                    const total = student.sessions.length;
                    const attended = student.sessions.filter(
                        (s) => s.attendanceStatus === 'PRESENT'
                    ).length;
                    const missed = total - attended;

                    // Present CSV: only learners with ≥1 attended class.
                    // Absent CSV: only learners with ≥1 missed class.
                    // (A partially-attending learner appears in both; "Both" keeps everyone.)
                    if (scope === 'present' && attended === 0) return null;
                    if (scope === 'absent' && missed === 0) return null;

                    const sessionsWithDuration = student.sessions.filter(
                        (s) => typeof s.durationMinutes === 'number' && s.durationMinutes > 0
                    );
                    const avgDurationMinutes = sessionsWithDuration.length
                        ? Math.round(
                              sessionsWithDuration.reduce(
                                  (acc, s) => acc + (s.durationMinutes ?? 0),
                                  0
                              ) / sessionsWithDuration.length
                          )
                        : null;

                    const presentSessions = student.sessions
                        .filter((s) => s.attendanceStatus === 'PRESENT')
                        .map((s) => `${s.title} (${s.meetingDate})`)
                        .join(', ');

                    const absentSessions = student.sessions
                        .filter((s) => s.attendanceStatus !== 'PRESENT')
                        .map((s) => `${s.title} (${s.meetingDate})`)
                        .join(', ');

                    const info = student.packageSessionId
                        ? batchInfoMap.get(student.packageSessionId)
                        : undefined;

                    const row: Record<string, string> = {
                        [t('csv.name')]: student.fullName || '',
                        [t('csv.email')]: student.email || '',
                        [t('csv.mobileNumber')]: student.mobileNumber || '',
                        [t('csv.enrollmentNumber')]: student.instituteEnrollmentNumber || '',
                        // 'Batch': info?.batchName || '',
                        [t('csv.course')]: info?.packageName || '',
                        [t('csv.attendancePercent')]: `${student.attendancePercentage}%`,
                        [t('csv.classesAttended')]: `${attended}/${total}`,
                        [t('csv.avgDuration')]: formatDurationMinutes(avgDurationMinutes, t),
                    };
                    if (includePresent) row[t('status.present')] = presentSessions;
                    if (includeAbsent) row[t('status.absent')] = absentSessions;
                    return row;
                })
                .filter((row): row is Record<string, string> => row !== null);

            const csv = Papa.unparse(csvData);
            const scopeSuffix = scope === 'both' ? 'full' : scope;
            downloadCsv(
                csv,
                `attendance_${scopeSuffix}_report_${format(new Date(), 'yyyy-MM-dd')}.csv`
            );
            toast.success(t('toasts.fullDataSuccess'));
        } catch (error) {
            console.error('Export failed:', error);
            toast.error(t('toasts.fullDataFailure'));
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <>
                <Helmet>
                    <title>{t('pageTitle')}</title>
                    <meta name="description" content={t('pageDescription')} />
                </Helmet>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h1 className="text-xl font-semibold text-neutral-800 sm:text-2xl">
                                {t('pageTitle')}
                            </h1>
                            <p className="text-sm text-neutral-600 sm:text-base">
                                {t('pageDescription')}
                            </p>
                        </div>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            className="flex items-center gap-2"
                            disabled={isExporting || studentsData.length === 0}
                            onClick={() => setExportDialogOpen(true)}
                        >
                            {isExporting ? (
                                <>
                                    <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                    {t('exportButton.exporting')}
                                </>
                            ) : (
                                <>
                                    <DownloadSimple size={18} />
                                    {t('exportButton.export')}
                                </>
                            )}
                        </MyButton>
                    </div>

                    <div className="rounded-lg border border-neutral-200 bg-white p-4">
                        <div className="mb-4 flex flex-col gap-3">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-neutral-600">
                                        {getTerminology(
                                            ContentTerms.Session,
                                            SystemTerms.Session
                                        )}
                                    </span>
                                    <div className="w-full [&>*]:w-full">
                                        <MyDropdown
                                            currentValue={currentSession}
                                            dropdownList={sessionList}
                                            placeholder={t('filters.selectLabel', {
                                                term: getTerminology(
                                                    ContentTerms.Session,
                                                    SystemTerms.Session
                                                ),
                                            })}
                                            handleChange={handleSessionChange}
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-neutral-600">
                                        {t('filters.searchLabel')}
                                    </span>
                                    <div className="relative w-full">
                                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                            <Search className="size-4 text-neutral-500" />
                                        </div>
                                        <Input
                                            type="text"
                                            placeholder={t('filters.searchPlaceholder')}
                                            value={searchInput}
                                            onChange={(e) => setSearchInput(e.target.value)}
                                            className="h-9 w-full rounded-md border border-neutral-300 bg-white py-2 pl-10 pr-3 text-sm text-neutral-900 placeholder:text-neutral-500 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-neutral-600">
                                        {getTerminology(ContentTerms.Batch, SystemTerms.Batch)}
                                    </span>
                                    <BatchDropdown
                                        label={getTerminology(
                                            ContentTerms.Batch,
                                            SystemTerms.Batch
                                        )}
                                        options={batchOptions}
                                        selectedValues={selectedBatchIds}
                                        onChange={setSelectedBatchIds}
                                    />
                                </div>
                            </div>

                            {/* Quick date presets (chips) + global clear share one line */}
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <RangeDateFilter range={dateRange} onChange={setDateRange} />

                                {(searchInput ||
                                    startDate ||
                                    endDate ||
                                    selectedBatchIds.length > 0 ||
                                    selectedLiveSessions.length > 0 ||
                                    attendanceFilter !== 'All') && (
                                    <button
                                        onClick={clearFilters}
                                        className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-600 hover:bg-danger-100"
                                    >
                                        <X className="size-4" />
                                        {t('filters.clearFilters')}
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Students Count */}
                        <div className="flex items-center justify-between text-xs text-neutral-500">
                            <span>
                                {isLoading ? (
                                    t('studentsCount.loading')
                                ) : (
                                    <>
                                        {t('studentsCount.showing')}{' '}
                                        <span className="font-medium text-neutral-700">
                                            {studentsData.length}
                                        </span>
                                        {totalElements > studentsData.length && (
                                            <>
                                                {' '}
                                                {t('studentsCount.of')}{' '}
                                                <span className="font-medium text-neutral-700">
                                                    {totalElements}
                                                </span>
                                            </>
                                        )}{' '}
                                        {t('studentsCount.students', {
                                            count:
                                                totalElements > studentsData.length
                                                    ? totalElements
                                                    : studentsData.length,
                                        })}
                                    </>
                                )}
                            </span>
                        </div>
                    </div>

                    {/* Table Section */}
                    {error ? (
                        <div className="flex flex-col items-center rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-500">
                            <Warning size={40} weight="thin" className="mb-3 text-danger-300" />
                            <p className="text-lg font-medium text-danger-600">
                                {t('errors.title')}
                            </p>
                            <p className="mt-1 text-sm">{t('errors.description')}</p>
                        </div>
                    ) : !isLoading && sortedStudents.length === 0 ? (
                        <div className="flex flex-col items-center rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-500">
                            <Warning size={40} weight="thin" className="mb-3 text-neutral-300" />
                            <p className="text-lg font-medium">{t('empty.title')}</p>
                            <p className="mt-1 text-sm">{t('empty.description')}</p>
                            <button
                                className="mt-4 rounded-md bg-primary-50 px-4 py-2 text-sm font-medium text-primary-600 hover:bg-primary-100"
                                onClick={clearFilters}
                            >
                                {t('empty.clearAll')}
                            </button>
                        </div>
                    ) : (
                        <MyTable<AttendanceStudent>
                            data={{
                                content: sortedStudents,
                                total_pages: totalPages,
                                page_no: page,
                                page_size: 10,
                                total_elements: totalElements,
                                last: page >= totalPages - 1,
                            }}
                            columns={attendanceColumns}
                            isLoading={isLoading}
                            error={error}
                            onSort={handleSort}
                            rowSelection={currentPageSelection}
                            onRowSelectionChange={handleRowSelectionChange}
                            currentPage={page}
                            scrollable
                        />
                    )}

                    {/* Bulk actions + pagination */}
                    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                        {totalSelectedCount > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-4 text-neutral-600">
                                <div className="flex gap-1 text-sm">
                                    [{totalSelectedCount}]<span> {t('bulk.selected')}</span>
                                </div>

                                <div className="flex items-center gap-3">
                                    <MyButton
                                        buttonType="secondary"
                                        scale="medium"
                                        onClick={() => setRowSelections({})}
                                    >
                                        {t('bulk.reset')}
                                    </MyButton>

                                    <MyDropdown
                                        dropdownList={[
                                            t('bulk.exportAccountDetails'),
                                            t('bulk.exportData'),
                                        ]}
                                        onSelect={(value) => {
                                            if (value === t('bulk.exportAccountDetails')) {
                                                exportAccountDetails([]);
                                            } else if (value === t('bulk.exportData')) {
                                                exportFullData('both');
                                            }
                                        }}
                                    >
                                        <MyButton
                                            buttonType="primary"
                                            scale="medium"
                                            className="flex items-center gap-1"
                                        >
                                            {t('bulk.bulkActions')}
                                            <CaretUpDown />
                                        </MyButton>
                                    </MyDropdown>
                                </div>
                            </div>
                        )}

                        <MyPagination
                            currentPage={page}
                            totalPages={totalPages}
                            onPageChange={(p) => setPage(p)}
                        />
                    </div>
                </div>

                {/* Attendance details modal — sessions list for a single student */}
                <AttendanceModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    student={selectedAttendanceStudent}
                    batchId={selectedBatchIds.length === 1 ? selectedBatchIds[0] ?? '' : ''}
                    startDate={startDate}
                    endDate={endDate}
                />

                {/* Export scope chooser — present / absent / both */}
                <MyDialog
                    heading={t('exportDialog.heading')}
                    open={exportDialogOpen}
                    onOpenChange={setExportDialogOpen}
                    footer={
                        <>
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setExportDialogOpen(false)}
                            >
                                {t('exportDialog.cancel')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                disabled={isExporting}
                                onClick={() => {
                                    setExportDialogOpen(false);
                                    exportFullData(exportScope);
                                }}
                            >
                                {t('exportDialog.downloadCsv')}
                            </MyButton>
                        </>
                    }
                >
                    <div className="flex flex-col gap-3">
                        <p className="text-sm text-neutral-600">
                            {t('exportDialog.description')}
                        </p>
                        <RadioGroup
                            value={exportScope}
                            onValueChange={(v) => setExportScope(v as ExportScope)}
                            className="flex flex-col gap-2"
                        >
                            {(
                                [
                                    {
                                        value: 'both',
                                        label: t('exportDialog.scope.both.label'),
                                        desc: t('exportDialog.scope.both.desc'),
                                    },
                                    {
                                        value: 'present',
                                        label: t('exportDialog.scope.present.label'),
                                        desc: t('exportDialog.scope.present.desc'),
                                    },
                                    {
                                        value: 'absent',
                                        label: t('exportDialog.scope.absent.label'),
                                        desc: t('exportDialog.scope.absent.desc'),
                                    },
                                ] as Array<{ value: ExportScope; label: string; desc: string }>
                            ).map((opt) => (
                                <label
                                    key={opt.value}
                                    htmlFor={`export-${opt.value}`}
                                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                                        exportScope === opt.value
                                            ? 'border-primary-500 bg-primary-50'
                                            : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                                    }`}
                                >
                                    <RadioGroupItem
                                        value={opt.value}
                                        id={`export-${opt.value}`}
                                        className="mt-0.5"
                                    />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-neutral-800">
                                            {opt.label}
                                        </span>
                                        <span className="text-xs text-neutral-500">{opt.desc}</span>
                                    </div>
                                </label>
                            ))}
                        </RadioGroup>
                    </div>
                </MyDialog>

                {/* Shared StudentSidebar reused from manage-students/students-list */}
                <SidebarProvider
                    style={{ ['--sidebar-width' as string]: '565px' }}
                    defaultOpen={false}
                    open={isSidebarOpen}
                    onOpenChange={setIsSidebarOpen}
                >
                    <StudentSidebar isStudentList />
                </SidebarProvider>
        </>
    );
}

interface RangeDateFilterProps {
    range: { from?: Date; to?: Date };
    onChange: (r: { from?: Date; to?: Date }) => void;
}

type DatePresetKey = '1' | '3' | '5' | '7' | '15' | '30' | 'custom';

const buildDatePresets = (
    t: TFunction
): Array<{ key: DatePresetKey; label: string; days: number }> => [
    { key: '1', label: t('dateFilter.days', { count: 1 }), days: 1 },
    { key: '3', label: t('dateFilter.days', { count: 3 }), days: 3 },
    { key: '5', label: t('dateFilter.days', { count: 5 }), days: 5 },
    { key: '7', label: t('dateFilter.days', { count: 7 }), days: 7 },
    { key: '15', label: t('dateFilter.days', { count: 15 }), days: 15 },
    { key: '30', label: t('dateFilter.days', { count: 30 }), days: 30 },
];

function RangeDateFilter({ range, onChange }: RangeDateFilterProps) {
    const { t } = useTranslation('studyLibraryAttendanceTrackerIndexLazy');
    const { from, to } = range;
    const [open, setOpen] = useState(false);
    const DATE_PRESETS = useMemo(() => buildDatePresets(t), [t]);

    const activePreset: DatePresetKey = useMemo(() => {
        if (!from || !to) return 'custom';
        const today = startOfDay(new Date());
        if (startOfDay(to).getTime() !== today.getTime()) return 'custom';
        const diffDays = Math.round(
            (today.getTime() - startOfDay(from).getTime()) / (1000 * 60 * 60 * 24)
        );
        return DATE_PRESETS.find((p) => p.days === diffDays)?.key ?? 'custom';
    }, [from, to, DATE_PRESETS]);

    const hasCustomRange = activePreset === 'custom' && !!(from || to);

    const applyPreset = (days: number) => {
        onChange({ from: startOfDay(subDays(new Date(), days)), to: new Date() });
    };

    const chipBase =
        'rounded-full border px-3 py-1 text-xs font-medium transition whitespace-nowrap';
    const chipActive = 'border-primary-500 bg-primary-50 text-primary-600';
    const chipIdle =
        'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50';

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-neutral-600">{t('dateFilter.label')}</span>
            <div className="flex flex-wrap items-center gap-2">
                {DATE_PRESETS.map((preset) => (
                    <button
                        key={preset.key}
                        onClick={() => applyPreset(preset.days)}
                        className={`${chipBase} ${
                            activePreset === preset.key ? chipActive : chipIdle
                        }`}
                    >
                        {preset.label}
                    </button>
                ))}

                {/* Custom range — opens a calendar for arbitrary from/to selection */}
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <button
                            className={`${chipBase} inline-flex items-center gap-1 ${
                                hasCustomRange ? chipActive : chipIdle
                            }`}
                        >
                            <CalendarIcon className="size-3.5" />
                            {hasCustomRange && from && to
                                ? `${format(from, 'dd MMM')} – ${format(to, 'dd MMM')}`
                                : t('dateFilter.custom')}
                            <CaretDownIcon className="size-3" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-3" align="start">
                        <h4 className="mb-2 text-xs font-medium text-neutral-500">
                            {t('dateFilter.pickCustomRange')}
                        </h4>
                        <Calendar
                            mode="range"
                            selected={range as DateRange}
                            onSelect={(sel: { from?: Date; to?: Date } | undefined) =>
                                onChange(sel || {})
                            }
                        />
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}

interface BatchDropdownProps {
    label: string;
    options: Array<{ label: string; value: string | null }>;
    selectedValues: string[];
    onChange: (values: string[]) => void;
}

function BatchDropdown({ label, options, selectedValues, onChange }: BatchDropdownProps) {
    const { t } = useTranslation('studyLibraryAttendanceTrackerIndexLazy');
    const [batchSearch, setBatchSearch] = useState('');
    // Snapshot of which batches were selected when the dropdown opened. Ordering uses
    // this (not the live selection) so items don't jump around while you toggle them —
    // selected float to the top only on the next open.
    const [pinnedOrder, setPinnedOrder] = useState<string[]>([]);

    // Real batches only (drop the synthetic "All Batches" entry — it maps to "none selected").
    const batchOnly = useMemo(() => {
        const seen = new Set<string>();
        return options.filter((opt) => {
            if (opt.value === null) return false;
            const key = `${opt.value}::${opt.label}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }, [options]);

    const filteredOptions = useMemo(() => {
        const query = batchSearch.trim().toLowerCase();
        const base = query
            ? batchOnly.filter((opt) => opt.label.toLowerCase().includes(query))
            : batchOnly;
        // Batches selected at open-time float to the top (stable within each group);
        // toggling doesn't reorder mid-interaction.
        const selected = base.filter((o) => !!o.value && pinnedOrder.includes(o.value));
        const rest = base.filter((o) => !(o.value && pinnedOrder.includes(o.value)));
        return [...selected, ...rest];
    }, [batchOnly, batchSearch, pinnedOrder]);

    const triggerLabel = useMemo(() => {
        if (selectedValues.length === 0) return t('filters.allBatches');
        if (selectedValues.length === 1) {
            return (
                batchOnly.find((o) => o.value === selectedValues[0])?.label ||
                t('batchDropdown.batchesSelected', { count: 1 })
            );
        }
        return t('batchDropdown.batchesSelected', { count: selectedValues.length });
    }, [selectedValues, batchOnly, t]);

    const toggle = (value: string) => {
        onChange(
            selectedValues.includes(value)
                ? selectedValues.filter((v) => v !== value)
                : [...selectedValues, value]
        );
    };

    return (
        <div className="w-full">
            <Popover
                onOpenChange={(open) => {
                    if (open) setPinnedOrder(selectedValues);
                    else setBatchSearch('');
                }}
            >
                <PopoverTrigger asChild>
                    <button
                        className={`flex h-9 w-full items-center justify-between rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm ${selectedValues.length > 0 ? 'text-neutral-900' : 'text-neutral-500'
                            } focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500`}
                    >
                        <span className="truncate">{triggerLabel || label}</span>
                        <CaretDownIcon className="ml-2 size-4 shrink-0 text-neutral-500" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3" align="start">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <h4 className="text-xs font-medium text-neutral-500">{label}</h4>
                            {selectedValues.length > 0 && (
                                <button
                                    onClick={() => onChange([])}
                                    className="text-xs font-medium text-primary-600 hover:underline"
                                >
                                    {t('batchDropdown.clearCount', {
                                        count: selectedValues.length,
                                    })}
                                </button>
                            )}
                        </div>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
                            <input
                                type="text"
                                placeholder={t('batchDropdown.searchPlaceholder')}
                                value={batchSearch}
                                onChange={(e) => setBatchSearch(e.target.value)}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                name="batch-dropdown-search"
                                className="h-8 w-full rounded-md border border-neutral-200 bg-white pl-8 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                            />
                        </div>
                        <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                            {/* All Batches = clear selection */}
                            <button
                                onClick={() => onChange([])}
                                className={`flex w-full items-center rounded-md border px-3 py-2 text-left text-xs leading-5 ${selectedValues.length === 0
                                        ? 'border-primary-300 bg-primary-50 font-medium text-primary-600'
                                        : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
                                    }`}
                            >
                                {t('filters.allBatches')}
                            </button>
                            {filteredOptions.length > 0 ? (
                                filteredOptions.map((opt) => {
                                    const checked = !!opt.value && selectedValues.includes(opt.value);
                                    return (
                                        <button
                                            key={`${opt.value}::${opt.label}`}
                                            onClick={() => opt.value && toggle(opt.value)}
                                            title={opt.label}
                                            className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-xs leading-5 ${checked
                                                    ? 'border-primary-300 bg-primary-50'
                                                    : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
                                                }`}
                                        >
                                            <span
                                                className={`mt-px flex size-4 shrink-0 items-center justify-center rounded border ${checked
                                                        ? 'border-primary-500 bg-primary-500 text-white'
                                                        : 'border-neutral-300 bg-white'
                                                    }`}
                                            >
                                                {checked && <Check size={12} weight="bold" />}
                                            </span>
                                            <span
                                                className={`block w-full ${checked ? 'font-medium text-primary-700' : 'text-neutral-700'
                                                    }`}
                                            >
                                                {opt.label}
                                            </span>
                                        </button>
                                    );
                                })
                            ) : (
                                <p className="py-2 text-center text-xs text-neutral-400">
                                    {t('batchDropdown.noBatchesFound')}
                                </p>
                            )}
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}
