import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import Papa from 'papaparse';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
    CheckCircle,
    DownloadSimple,
    FunnelSimple,
    Info,
    UserPlus,
    UsersThree,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { LiveSessionReport } from '../-services/utils';
import { AttendanceStatusCell } from '../-constants/reportTable';

/**
 * A public class mixes two kinds of people in one report: guests who filled the public
 * registration form (`EXTERNAL_USER`) and learners already in the institute who were scheduled
 * through a batch or added one by one (`BATCH` / `USER`). Admins could not tell them apart, so
 * they get their own tab each. The internal tab only appears when the class has internal
 * participants — a public class with no batch shows form registrations alone.
 */

type Group = 'external' | 'internal';
type TabKey = Group | 'attendance';
type StatusFilter = 'ALL' | 'PRESENT' | 'ABSENT' | 'UNMARKED';

const EXTERNAL_SOURCE = 'EXTERNAL_USER';
const PAGE_SIZE = 10;

interface ParticipantRow {
    index: number;
    name: string;
    phone: string;
    email: string;
    group: Group;
    batchLabel: string;
    registeredAt: string;
    attendanceStatus: string | null;
    source: LiveSessionReport;
}

const isExternal = (r: LiveSessionReport) => r.sourceType === EXTERNAL_SOURCE;

const normalizeStatus = (status: string | null): Exclude<StatusFilter, 'ALL'> => {
    const s = status ? status.toUpperCase() : '';
    return s === 'PRESENT' || s === 'ABSENT' ? s : 'UNMARKED';
};

const statusLabel = (status: string | null) => {
    const s = normalizeStatus(status);
    return s === 'PRESENT' ? 'Present' : s === 'ABSENT' ? 'Absent' : 'Unmarked';
};

const countStatuses = (rows: LiveSessionReport[]) => {
    let present = 0;
    let absent = 0;
    rows.forEach((r) => {
        const s = normalizeStatus(r.attendanceStatus);
        if (s === 'PRESENT') present += 1;
        else if (s === 'ABSENT') absent += 1;
    });
    return { present, absent, unmarked: rows.length - present - absent };
};

/** The API sends a timestamp as epoch millis or an ISO string depending on the serializer. */
const formatWhen = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : format(date, 'd MMM yyyy, h:mm a');
};

const toRows = (items: LiveSessionReport[]): ParticipantRow[] =>
    items.map((r, idx) => ({
        index: idx + 1,
        name: r.fullName ?? '',
        phone: r.mobileNumber ?? '',
        email: r.email ?? '',
        group: isExternal(r) ? 'external' : 'internal',
        batchLabel: r.batchName || (r.sourceType === 'USER' ? 'Added individually' : '—'),
        registeredAt: formatWhen(r.registeredAt),
        attendanceStatus: r.attendanceStatus,
        source: r,
    }));

const downloadCsv = (rows: Record<string, unknown>[], fileName: string) => {
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/** engagement_data.activenessState codes (plugin status), matching the other exports. */
const ACTIVENESS_STATE_LABELS: Record<number, string> = {
    2: 'Turned off by the learner',
    3: 'Phone/tablet — not measured',
    4: 'Camera blocked',
    5: 'No camera',
    6: 'Camera in use by another app',
    7: 'Device too slow',
    8: "Couldn't load",
    9: 'Camera stopped',
    10: 'Camera not allowed',
};

/** Same columns and active-points formula the attendance export has always used. */
const toAttendanceCsvRow = (item: LiveSessionReport, idx: number, typeLabel: string) => {
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
        '#': idx + 1,
        Name: item.fullName,
        Email: item.email || '',
        Status: statusLabel(item.attendanceStatus),
        Mode: item.statusType || '',
        'Duration (min)': duration,
        'Active Points': activePoints,
        'Talk Time (min)': talkTimeMin,
        'Talk Segments': engagement?.talks ?? '',
        'Raise Hands': engagement?.raisehand ?? '',
        Emojis: engagement?.emojis ?? '',
        Chats: engagement?.chats ?? '',
        'Poll Votes': engagement?.pollVotes ?? '',
        // Appended last so the columns existing exports already had keep their positions.
        Type: typeLabel,
        // Opt-in Vacademy Meet camera score; empty for classes without it.
        'Activeness %': engagement?.activeness ?? '',
        'On screen %': engagement?.activenessOnScreen ?? '',
        'Attention %': engagement?.activenessAttention ?? '',
        'Activeness status':
            typeof engagement?.activenessState === 'number' && engagement.activenessState !== 1
                ? ACTIVENESS_STATE_LABELS[engagement.activenessState] ?? ''
                : '',
    };
};

interface ColumnLabels {
    formSourceLabel: string;
    batchTerm: string;
    externalLabel: string;
    internalLabel: string;
}

const buildColumns = (
    kind: TabKey,
    t: TFunction,
    labels: ColumnLabels
): ColumnDef<ParticipantRow>[] => {
    const columns: ColumnDef<ParticipantRow>[] = [
        { accessorKey: 'index', header: t('srNo') },
        { accessorKey: 'name', header: 'Name' },
    ];
    if (kind !== 'attendance') {
        columns.push(
            { accessorKey: 'phone', header: 'Phone Number' },
            {
                accessorKey: 'email',
                header: 'Email',
                cell: ({ row }) => (
                    <span className="block max-w-56 truncate" title={row.original.email}>
                        {row.original.email}
                    </span>
                ),
            }
        );
    }
    if (kind === 'external') {
        columns.push(
            {
                id: 'registrationSource',
                header: 'Registration Source',
                cell: () => (
                    <Badge
                        variant="outline"
                        className="border-primary-200 bg-primary-50 font-normal text-primary-500"
                    >
                        {labels.formSourceLabel}
                    </Badge>
                ),
            },
            { accessorKey: 'registeredAt', header: 'Registration Date' }
        );
    }
    if (kind === 'internal') {
        columns.push(
            {
                accessorKey: 'batchLabel',
                header: `${labels.batchTerm} Name`,
                cell: ({ row }) => (
                    <Badge
                        variant="outline"
                        className="border-success-200 bg-success-50 font-normal text-success-700"
                    >
                        {row.original.batchLabel}
                    </Badge>
                ),
            },
            { accessorKey: 'registeredAt', header: 'Added On' }
        );
    }
    if (kind === 'attendance') {
        columns.push({
            id: 'type',
            header: 'Type',
            cell: ({ row }) =>
                row.original.group === 'external' ? (
                    <Badge
                        variant="outline"
                        className="border-primary-200 bg-primary-50 font-normal text-primary-500"
                    >
                        {labels.externalLabel}
                    </Badge>
                ) : (
                    <Badge
                        variant="outline"
                        className="border-success-200 bg-success-50 font-normal text-success-700"
                    >
                        {labels.internalLabel}
                    </Badge>
                ),
        });
    }
    columns.push({
        accessorKey: 'attendanceStatus',
        header: t('attendanceStatus'),
        cell: ({ row }) => <AttendanceStatusCell status={row.original.attendanceStatus} t={t} />,
    });
    return columns;
};

const StatusCounts = ({ rows }: { rows: LiveSessionReport[] }) => {
    const { present, absent, unmarked } = countStatuses(rows);
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
            <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-success-500" />
                Present: {present}
            </span>
            <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-danger-500" />
                Absent: {absent}
            </span>
            <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-neutral-400" />
                Unmarked: {unmarked}
            </span>
        </div>
    );
};

interface StatCardProps {
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    rows: LiveSessionReport[];
    active: boolean;
    onClick: () => void;
}

const StatCard = ({ icon, title, subtitle, rows, active, onClick }: StatCardProps) => (
    <button
        type="button"
        onClick={onClick}
        className={cn(
            'flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors',
            active
                ? 'border-primary-300 bg-primary-50'
                : 'border-neutral-200 bg-white hover:border-primary-200'
        )}
    >
        <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-500">
                {icon}
            </div>
            <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-neutral-800">{title}</div>
                <div className="text-xs text-neutral-500">{subtitle}</div>
            </div>
            <div className="text-2xl font-semibold text-neutral-800">{rows.length}</div>
        </div>
        <StatusCounts rows={rows} />
    </button>
);

interface SectionProps {
    tone: 'primary' | 'success' | 'neutral';
    icon: React.ReactNode;
    title: string;
    description: string;
    rows: ParticipantRow[];
    columns: ColumnDef<ParticipantRow>[];
    onExport: (rows: ParticipantRow[]) => void;
}

const BANNER_TONE: Record<SectionProps['tone'], { box: string; icon: string; title: string }> = {
    primary: {
        box: 'border-primary-200 bg-primary-50',
        icon: 'bg-primary-500 text-white',
        title: 'text-primary-500',
    },
    success: {
        box: 'border-success-200 bg-success-50',
        icon: 'bg-success-600 text-white',
        title: 'text-success-700',
    },
    neutral: {
        box: 'border-neutral-200 bg-neutral-50',
        icon: 'bg-neutral-500 text-white',
        title: 'text-neutral-700',
    },
};

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'ALL', label: 'All' },
    { value: 'PRESENT', label: 'Present' },
    { value: 'ABSENT', label: 'Absent' },
    { value: 'UNMARKED', label: 'Unmarked' },
];

const ParticipantSection = ({
    tone,
    icon,
    title,
    description,
    rows,
    columns,
    onExport,
}: SectionProps) => {
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
    const [page, setPage] = useState(0);
    const toneClasses = BANNER_TONE[tone];

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows
            .filter((r) =>
                statusFilter === 'ALL' ? true : normalizeStatus(r.attendanceStatus) === statusFilter
            )
            .filter((r) =>
                q ? [r.name, r.phone, r.email].some((v) => v.toLowerCase().includes(q)) : true
            )
            .map((r, idx) => ({ ...r, index: idx + 1 }));
    }, [rows, search, statusFilter]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages - 1);
    const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    return (
        <div className="flex flex-col gap-4">
            <div className={cn('flex items-start gap-3 rounded-lg border p-4', toneClasses.box)}>
                <div
                    className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-full',
                        toneClasses.icon
                    )}
                >
                    {icon}
                </div>
                <div>
                    <div className={cn('text-sm font-semibold', toneClasses.title)}>{title}</div>
                    <div className="text-sm text-neutral-600">{description}</div>
                </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-neutral-800">{title}</h3>
                    <Badge
                        variant="outline"
                        className="border-primary-200 bg-primary-50 font-normal text-primary-500"
                    >
                        {rows.length} Participants
                    </Badge>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <MyInput
                        inputType="text"
                        inputPlaceholder="Search by name, phone or email…"
                        input={search}
                        onChangeFunction={(e) => {
                            setSearch(e.target.value);
                            setPage(0);
                        }}
                        size="medium"
                        className="w-full sm:w-72"
                    />
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <MyButton
                                type="button"
                                scale="medium"
                                buttonType="secondary"
                                className="flex items-center gap-2"
                            >
                                <FunnelSimple size={16} />
                                {statusFilter === 'ALL'
                                    ? 'Filter'
                                    : STATUS_FILTERS.find((f) => f.value === statusFilter)?.label}
                            </MyButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuRadioGroup
                                value={statusFilter}
                                onValueChange={(v) => {
                                    setStatusFilter(v as StatusFilter);
                                    setPage(0);
                                }}
                            >
                                {STATUS_FILTERS.map((f) => (
                                    <DropdownMenuRadioItem key={f.value} value={f.value}>
                                        {f.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        className="flex items-center gap-2"
                        disabled={filtered.length === 0}
                        onClick={() => onExport(filtered)}
                    >
                        <DownloadSimple size={16} />
                        Export
                    </MyButton>
                </div>
            </div>

            {filtered.length === 0 ? (
                <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
                    {rows.length === 0
                        ? 'No participants yet.'
                        : 'No participants match your search or filter.'}
                </div>
            ) : (
                <>
                    <MyTable<ParticipantRow>
                        data={{
                            content: pageRows,
                            total_pages: totalPages,
                            page_no: currentPage,
                            page_size: PAGE_SIZE,
                            total_elements: filtered.length,
                            last: currentPage >= totalPages - 1,
                        }}
                        columns={columns}
                        isLoading={false}
                        error={null}
                        currentPage={currentPage}
                    />
                    {totalPages > 1 && (
                        <MyPagination
                            currentPage={currentPage}
                            totalPages={totalPages}
                            onPageChange={setPage}
                        />
                    )}
                </>
            )}
        </div>
    );
};

interface ParticipantDetailsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sessionId: string;
    accessLevel: string | undefined;
    report: LiveSessionReport[] | undefined;
    isLoading: boolean;
    error: Error | null;
}

const ParticipantDetailsBody = ({
    sessionId,
    accessLevel,
    report,
    isLoading,
    error,
}: Omit<ParticipantDetailsDialogProps, 'open' | 'onOpenChange'>) => {
    const { t } = useTranslation('studyLibraryLiveSessionReportTable');
    const liveSessionTerm = getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const batchesTerm = getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch);

    const all = useMemo(() => report ?? [], [report]);
    const external = useMemo(() => all.filter(isExternal), [all]);
    const internal = useMemo(() => all.filter((r) => !isExternal(r)), [all]);

    const isPublic = (accessLevel ?? '').toLowerCase() === 'public';
    // Private classes have no registration form; public ones only show the internal side
    // when a batch or learner is actually attached.
    const showExternal = isPublic || external.length > 0;
    const showInternal = internal.length > 0 || !isPublic;
    const showTotal = showExternal && showInternal;

    const [tab, setTab] = useState<TabKey>(showExternal ? 'external' : 'internal');

    const labels: ColumnLabels = {
        formSourceLabel: `${liveSessionTerm} Form`,
        batchTerm,
        externalLabel: 'External',
        internalLabel: 'Internal',
    };
    const externalTitle = 'Form Registrations (External Users)';
    const internalTitle = `${batchTerm} Members (Internal Users)`;

    const externalRows = useMemo(() => toRows(external), [external]);
    const internalRows = useMemo(() => toRows(internal), [internal]);
    const attendanceRows = useMemo(
        () => toRows([...(showExternal ? external : []), ...(showInternal ? internal : [])]),
        [external, internal, showExternal, showInternal]
    );

    const exportRegistrations = (rows: ParticipantRow[], group: Group) => {
        downloadCsv(
            rows.map((r) => ({
                '#': r.index,
                Name: r.name,
                Phone: r.phone,
                Email: r.email,
                ...(group === 'external'
                    ? {
                          'Registration Source': labels.formSourceLabel,
                          'Registration Date': r.registeredAt,
                      }
                    : { [`${batchTerm} Name`]: r.batchLabel, 'Added On': r.registeredAt }),
                Attendance: statusLabel(r.attendanceStatus),
            })),
            `${group === 'external' ? 'form_registrations' : 'internal_participants'}_session_${sessionId}.csv`
        );
        toast.success('Participants downloaded successfully.');
    };

    const exportAttendance = (rows: ParticipantRow[]) => {
        downloadCsv(
            rows.map((r, idx) =>
                toAttendanceCsvRow(
                    r.source,
                    idx,
                    r.group === 'external' ? labels.externalLabel : labels.internalLabel
                )
            ),
            `attendance_session_${sessionId}.csv`
        );
        toast.success('Attendance report downloaded successfully.');
    };

    if (isLoading) return <DashboardLoader />;
    if (error) {
        return (
            <div className="rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm text-danger-600">
                Could not load participants. Close this window and try again.
            </div>
        );
    }

    const cardCount = [showExternal, showInternal, showTotal].filter(Boolean).length;
    const triggerClass =
        'rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 text-sm font-medium text-neutral-500 !shadow-none data-[state=active]:border-primary-500 data-[state=active]:bg-transparent data-[state=active]:text-primary-500';

    return (
        <div className="flex flex-col gap-5">
            <p className="text-sm text-neutral-500">
                {showExternal && showInternal
                    ? `Form registrations, ${batchTerm.toLowerCase()} members and attendance for this ${liveSessionTerm.toLowerCase()}.`
                    : `Participants and attendance for this ${liveSessionTerm.toLowerCase()}.`}
            </p>

            <div
                className={cn(
                    'grid grid-cols-1 gap-4',
                    cardCount === 3 && 'md:grid-cols-3',
                    cardCount === 2 && 'md:grid-cols-2'
                )}
            >
                {showExternal && (
                    <StatCard
                        icon={<UserPlus size={20} />}
                        title="Form Registrations"
                        subtitle="(External Users)"
                        rows={external}
                        active={tab === 'external'}
                        onClick={() => setTab('external')}
                    />
                )}
                {showInternal && (
                    <StatCard
                        icon={<UsersThree size={20} />}
                        title={`${batchTerm} Members`}
                        subtitle="(Internal Users)"
                        rows={internal}
                        active={tab === 'internal'}
                        onClick={() => setTab('internal')}
                    />
                )}
                {showTotal && (
                    <StatCard
                        icon={<UsersThree size={20} />}
                        title="Total Participants"
                        subtitle="(External + Internal)"
                        rows={all}
                        active={tab === 'attendance'}
                        onClick={() => setTab('attendance')}
                    />
                )}
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
                <TabsList className="h-auto w-full justify-start gap-2 rounded-none border-b border-neutral-200 !bg-transparent p-0">
                    {showExternal && (
                        <TabsTrigger value="external" className={triggerClass}>
                            Form Registrations ({external.length})
                        </TabsTrigger>
                    )}
                    {showInternal && (
                        <TabsTrigger value="internal" className={triggerClass}>
                            {batchTerm} Members ({internal.length})
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="attendance" className={triggerClass}>
                        Attendance
                    </TabsTrigger>
                </TabsList>

                {showExternal && (
                    <TabsContent value="external" className="mt-4">
                        <ParticipantSection
                            tone="primary"
                            icon={<Info size={16} weight="bold" />}
                            title={externalTitle}
                            description={`People who registered through the ${liveSessionTerm.toLowerCase()} registration form. They are not part of any ${batchTerm.toLowerCase()}.`}
                            rows={externalRows}
                            columns={buildColumns('external', t, labels)}
                            onExport={(rows) => exportRegistrations(rows, 'external')}
                        />
                    </TabsContent>
                )}
                {showInternal && (
                    <TabsContent value="internal" className="mt-4">
                        <ParticipantSection
                            tone="success"
                            icon={<UsersThree size={16} weight="bold" />}
                            title={internalTitle}
                            description={`Learners already in your institute, scheduled for this ${liveSessionTerm.toLowerCase()} through their ${batchesTerm.toLowerCase()} or added individually.`}
                            rows={internalRows}
                            columns={buildColumns('internal', t, labels)}
                            onExport={(rows) => exportRegistrations(rows, 'internal')}
                        />
                    </TabsContent>
                )}
                <TabsContent value="attendance" className="mt-4">
                    <ParticipantSection
                        tone="neutral"
                        icon={<CheckCircle size={16} weight="bold" />}
                        title="Attendance"
                        description={
                            showTotal
                                ? 'Everyone in this session, external and internal, with their attendance.'
                                : 'Attendance of everyone in this session.'
                        }
                        rows={attendanceRows}
                        columns={buildColumns('attendance', t, labels).filter(
                            (c) => showTotal || c.id !== 'type'
                        )}
                        onExport={exportAttendance}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default function ParticipantDetailsDialog({
    open,
    onOpenChange,
    ...body
}: ParticipantDetailsDialogProps) {
    return (
        <MyDialog
            heading="Participant Details"
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-6xl"
        >
            {/* Radix unmounts the body on close, so tab/search/filter reset on every open. */}
            <ParticipantDetailsBody {...body} />
        </MyDialog>
    );
}
