import { useState, useMemo, useCallback, useEffect, Fragment } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import {
    CheckCircle,
    XCircle,
    MinusCircle,
    CaretDown,
    CaretUp,
    Clock,
    ChatCircle,
    Microphone,
    ArrowUp,
    ArrowDown,
    HandWaving,
    Smiley,
    ChartBar,
    Eye,
    DownloadSimple,
    UsersThree,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import Papa from 'papaparse';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { ManageColumnsPopover } from '@/components/shared/leads/manage-columns-popover';
import {
    useLeadColumnPrefs,
    type LeadColumnToggle,
} from '@/components/shared/leads/use-lead-column-prefs';
import { getSystemFieldsFromStorage } from '@/components/design-system/utils/constants/system-field-columns';
import type { LiveSessionReport, SessionCustomFieldValue } from '../-services/utils';
import {
    adminMarkAttendance,
    getSessionCustomFieldValues,
    getSessionLearnerFields,
} from '../-services/utils';

interface EngagementData {
    chats?: number;
    talks?: number;
    talkTime?: number;
    raisehand?: number;
    emojis?: number;
    pollVotes?: number;
    // Written during the class by the opt-in Vacademy Meet activeness plugin
    // (on-device camera score); BBB's own counters above arrive after it ends.
    activeness?: number;
    activenessOnScreen?: number;
    activenessAttention?: number;
    activenessSeconds?: number;
    activenessAwayCount?: number;
    /** Why there is no (current) score: 2 turned off, 3 phone/tablet, 4 camera blocked, … (1 = measured). */
    activenessState?: number;
}

const BBB_COUNTERS = ['chats', 'talks', 'talkTime', 'raisehand', 'emojis', 'pollVotes'] as const;

/** BBB's engagement counters are present (not just the activeness score). */
const hasBbbCounters = (e: EngagementData | null): e is EngagementData =>
    !!e && BBB_COUNTERS.some((k) => typeof e[k] === 'number');

interface AttendanceMarkingTableProps {
    data: LiveSessionReport[];
    sessionId: string;
    scheduleId: string;
    accessType: string;
    sessionTitle?: string;
    packageSessionDetails?: Array<{
        package_session_id: string;
        package_name: string;
        level_name?: string;
    }> | null;
    onSaved?: () => void;
    /**
     * Receives this table's CSV export, so another button on the same screen (the Attendance
     * Report dialog's own CSV button) downloads exactly the columns picked here.
     */
    exportCsvRef?: MutableRefObject<(() => void) | null>;
}

type SortField = 'status' | 'duration' | 'activePoints' | 'activeness';
type SortDir = 'asc' | 'desc';

/**
 * Vacademy Meet reports exact seconds; Zoom only whole minutes. Show "4m 50s"
 * when we have the real figure, and plain minutes when that is all the provider
 * gave — the minutes column is a floor, so "4 min" can be anything up to 4m59s.
 */
const formatAttendedDuration = (
    t: TFunction,
    mins: number | null,
    secs?: number | null
): string => {
    if (secs != null) {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        if (m === 0) return t('durationSeconds', { count: s });
        return s === 0 ? t('durationMinutesShort', { count: m }) : t('durationMinutesAndSeconds', { m, s });
    }
    return mins != null ? t('durationMinutes', { count: mins }) : '--';
};

function parseEngagement(json: string | null): EngagementData | null {
    if (!json) return null;
    try {
        const parsed = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

const activenessOf = (student: LiveSessionReport): number | null => {
    const v = parseEngagement(student.engagementData)?.activeness;
    return typeof v === 'number' ? v : null;
};

/** The reason code when it explains something (not 1 = measured). */
const activenessStateOf = (student: LiveSessionReport): number | null => {
    const v = parseEngagement(student.engagementData)?.activenessState;
    return typeof v === 'number' && v !== 1 ? v : null;
};

function getActivenessBadgeColor(value: number) {
    if (value >= 70) return 'border-green-200 bg-green-50 text-green-700';
    if (value >= 40) return 'border-yellow-200 bg-yellow-50 text-yellow-700';
    return 'border-red-200 bg-red-50 text-red-600';
}

/** "On screen 79% · Attention 78% · camera on 5m 52s · stepped away 4×" — missing parts left out. */
function activenessSummary(t: TFunction, e: EngagementData): string {
    const parts: string[] = [];
    if (typeof e.activenessOnScreen === 'number') parts.push(t('activeness.onScreen', { value: e.activenessOnScreen }));
    if (typeof e.activenessAttention === 'number') parts.push(t('activeness.attention', { value: e.activenessAttention }));
    if (typeof e.activenessSeconds === 'number') {
        parts.push(t('activeness.tracked', { value: formatAttendedDuration(t, null, e.activenessSeconds) }));
    }
    if (typeof e.activenessAwayCount === 'number') parts.push(t('activeness.away', { count: e.activenessAwayCount }));
    if (typeof e.activenessState === 'number' && e.activenessState !== 1) {
        parts.push(t(`activenessState.${e.activenessState}`, { defaultValue: '' }));
    }
    return parts.filter(Boolean).join(' · ');
}

/**
 * Active Points formula:
 *   - Duration weight: 1 point per minute attended
 *   - Talk time: 2 points per minute of talk
 *   - Talk segments: 0.5 point per segment (shows frequency of participation)
 *   - Raise hand: 3 points each (active engagement signal)
 *   - Emojis: 1 point each
 *   - Chats: 1.5 points each
 *   - Poll votes: 2 points each
 *
 * Result is rounded to nearest integer.
 */
function computeActivePoints(student: LiveSessionReport): number | null {
    const duration = student.providerTotalDurationMinutes;
    // The activeness score lands in the same JSON during the class; on its own it
    // is not BBB engagement, so it must not read as "0 points, Low".
    const parsed = parseEngagement(student.engagementData);
    const engagement = hasBbbCounters(parsed) ? parsed : null;

    if (duration == null && !engagement) return null;

    let score = 0;
    if (duration != null) score += duration * 1;
    if (engagement) {
        score += ((engagement.talkTime ?? 0) / 60) * 2;
        score += (engagement.talks ?? 0) * 0.5;
        score += (engagement.raisehand ?? 0) * 3;
        score += (engagement.emojis ?? 0) * 1;
        score += (engagement.chats ?? 0) * 1.5;
        score += (engagement.pollVotes ?? 0) * 2;
    }
    return Math.round(score);
}

/** The API sends a timestamp as epoch millis or an ISO string depending on the serializer. */
const formatWhen = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined || value === '') return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : format(date, 'd MMM yyyy, h:mm a');
};

/** Date of birth as a calendar date — a bare "YYYY-MM-DD" is read as local, not UTC midnight. */
const formatDateOnly = (value: string | null | undefined): string => {
    if (!value) return '';
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    const date = ymd ? new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])) : new Date(value);
    return Number.isNaN(date.getTime()) ? value : format(date, 'd MMM yyyy');
};

const prettifyKey = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());

/** Per-user Manage Column choice for this table, shared by every class. */
const COLUMN_PREFS_KEY = 'live-session-attendance-columns';
/**
 * New columns start hidden so the table looks as it did before Manage Column existed.
 * Custom-field and feedback columns are not listed, so they start visible (as they always were).
 */
const DEFAULT_HIDDEN_COLUMNS = [
    'phone',
    'username',
    'gender',
    'dateOfBirth',
    'enrollmentNumber',
    'batch',
    'course',
    'registeredAt',
    'fatherName',
    'motherName',
    'parentsMobile',
    'parentsEmail',
    'motherMobile',
    'motherEmail',
    'address',
    'city',
    'region',
    'pinCode',
    'country',
    'linkedInstitute',
    'talkTime',
    'talkSegments',
    'raiseHands',
    'emojis',
    'chats',
    'pollVotes',
];

/** Everything a cell or CSV value needs for one row, worked out once per render. */
interface RowContext {
    student: LiveSessionReport;
    status: string;
    engagement: EngagementData | null;
    activePoints: number | null;
    activeness: number | null;
    activenessState: number | null;
}

type CsvValue = string | number;

interface AttendanceColumn {
    id: string;
    label: string;
    group: string;
    /** Always shown (row identity / the marking control). */
    locked?: boolean;
    sortField?: SortField;
    thClassName?: string;
    tdClassName?: string;
    render: (row: RowContext) => ReactNode;
    /** CSV header → value pairs this column adds; one column may add several (Activeness). */
    csv: (row: RowContext) => Array<[string, CsvValue]>;
}

const EMPTY_CELL = <span className="text-gray-300">--</span>;
const textCell = (value: string | number | null | undefined): ReactNode =>
    value === null || value === undefined || value === '' ? EMPTY_CELL : value;

function getActivePointsBadge(t: TFunction, points: number | null) {
    if (points == null) return null;
    if (points >= 80) return { label: t('activePoints.high'), color: 'border-green-200 bg-green-50 text-green-700' };
    if (points >= 30) return { label: t('activePoints.medium'), color: 'border-yellow-200 bg-yellow-50 text-yellow-700' };
    return { label: t('activePoints.low'), color: 'border-red-200 bg-red-50 text-red-600' };
}

export function AttendanceMarkingTable({
    data,
    sessionId,
    scheduleId,
    sessionTitle,
    packageSessionDetails,
    onSaved,
    exportCsvRef,
}: AttendanceMarkingTableProps) {
    const { t } = useTranslation('studyLibraryLiveSessionAttendanceMarkingTable');
    const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [sortField, setSortField] = useState<SortField | null>(null);
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const { hiddenColumns, toggleColumn, resetColumns } = useLeadColumnPrefs(
        COLUMN_PREFS_KEY,
        DEFAULT_HIDDEN_COLUMNS
    );

    // Public-form answers of guests, keyed by guest id (= studentId for guests).
    const [cfData, setCfData] = useState<Record<string, SessionCustomFieldValue[]>>({});
    // Institute custom-field answers of enrolled learners, keyed by user id.
    const [learnerCfData, setLearnerCfData] = useState<Record<string, SessionCustomFieldValue[]>>({});
    // Profile fields of enrolled learners (USERNAME, CITY, …), keyed by user id.
    const [learnerSysData, setLearnerSysData] = useState<Record<string, Record<string, string>>>({});

    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        getSessionCustomFieldValues(sessionId).then((res) => {
            if (!cancelled) setCfData(res);
        });
        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    // A stable key, so saving attendance (which refetches the same people) doesn't refetch this.
    const learnerIdsKey = useMemo(
        () =>
            data
                .filter((s) => s.studentId && s.sourceType !== 'EXTERNAL_USER')
                .map((s) => s.studentId)
                .sort()
                .join(','),
        [data]
    );

    useEffect(() => {
        if (!sessionId || !learnerIdsKey) {
            setLearnerCfData({});
            setLearnerSysData({});
            return;
        }
        let cancelled = false;
        getSessionLearnerFields(sessionId, learnerIdsKey.split(',')).then((res) => {
            if (cancelled) return;
            setLearnerCfData(res.custom_fields);
            setLearnerSysData(res.system_fields);
        });
        return () => {
            cancelled = true;
        };
    }, [sessionId, learnerIdsKey]);

    // Unique custom fields across guests and learners, guests' form order first.
    const customFieldColumns = useMemo(() => {
        // Skip only fields already shown as standard columns (Name, Email). Match by
        // fieldName (case-insensitive exact match) — NOT by substring on fieldKey,
        // because keys like "name_of_the_school_inst_..." would incorrectly match "name".
        const SKIP_NAMES = ['full name', 'name', 'email'];
        const fieldMap = new Map<string, string>(); // fieldKey → fieldName
        [cfData, learnerCfData].forEach((source) => {
            Object.values(source).forEach((fields) => {
                fields.forEach((f) => {
                    const nameLC = (f.fieldName || '').toLowerCase();
                    if (!SKIP_NAMES.includes(nameLC) && f.fieldName && f.fieldKey && !fieldMap.has(f.fieldKey)) {
                        fieldMap.set(f.fieldKey, f.fieldName);
                    }
                });
            });
        });
        return Array.from(fieldMap.entries()).map(([key, name]) => ({ key, name }));
    }, [cfData, learnerCfData]);

    // Guests whose studentId doesn't match a registration are found by their form email.
    // Every guest registration with that email is kept, in order — the first one that
    // answered a field wins, as before.
    const guestFieldsByEmail = useMemo(() => {
        const map = new Map<string, SessionCustomFieldValue[][]>();
        Object.values(cfData).forEach((fields) => {
            if (!fields.length || !fields[0]?.guestId) return;
            const emails = new Set(
                fields
                    .filter((f) => f.fieldKey?.toLowerCase().includes('email') && f.customFieldValue)
                    .map((f) => f.customFieldValue as string)
            );
            emails.forEach((email) => {
                const list = map.get(email);
                if (list) list.push(fields);
                else map.set(email, [fields]);
            });
        });
        return map;
    }, [cfData]);

    // Extract unique feedback keys
    const feedbackColumns = useMemo(() => {
        const columns = new Set<string>();
        data.forEach((student) => {
            if (student.feedbackDetails) {
                try {
                    const parsed = JSON.parse(student.feedbackDetails);
                    Object.keys(parsed).forEach((k) => columns.add(k));
                } catch (e) {
                    // ignore JSON parse errors
                }
            }
        });
        return Array.from(columns);
    }, [data]);

    // undefined = no answer for this key; '' = answered with null. An object answer is shown as
    // JSON (rendering the raw object would crash the table).
    const getFeedbackValue = useCallback(
        (student: LiveSessionReport, key: string): string | undefined => {
            if (!student.feedbackDetails) return undefined;
            try {
                const parsed = JSON.parse(student.feedbackDetails);
                const value = parsed?.[key];
                if (value === undefined) return undefined;
                if (value === null) return '';
                return typeof value === 'object' ? JSON.stringify(value) : String(value);
            } catch {
                return undefined;
            }
        },
        []
    );

    // Custom field value for a participant: guest answers, then learner answers, then the
    // guest found by email.
    const getCfValue = useCallback(
        (student: LiveSessionReport, fieldKey: string): string => {
            for (const fields of [cfData[student.studentId], learnerCfData[student.studentId]]) {
                const match = fields?.find((f) => f.fieldKey === fieldKey);
                if (match?.customFieldValue) return match.customFieldValue;
            }
            const guests = student.email ? guestFieldsByEmail.get(student.email) : undefined;
            for (const fields of guests ?? []) {
                const match = fields.find((f) => f.fieldKey === fieldKey);
                if (match?.customFieldValue) return match.customFieldValue;
            }
            return '';
        },
        [cfData, learnerCfData, guestFieldsByEmail]
    );

    const dirtyCount = Object.keys(statusOverrides).length;

    const getOriginalStatus = useCallback(
        (student: LiveSessionReport) => {
            const raw = student.attendanceStatus?.toUpperCase();
            if (raw === 'PRESENT') return 'PRESENT';
            if (raw === 'ABSENT') return 'ABSENT';
            return 'UNMARKED';
        },
        []
    );

    const getStatus = useCallback(
        (student: LiveSessionReport): string => {
            // Read once into a const so the undefined check narrows it (an indexed read
            // like statusOverrides[id] stays `string | undefined` under the strict config).
            const override = statusOverrides[student.studentId];
            return override !== undefined ? override : getOriginalStatus(student);
        },
        [statusOverrides, getOriginalStatus]
    );

    const setStudentStatus = useCallback(
        (student: LiveSessionReport, newStatus: string) => {
            const originalStatus = getOriginalStatus(student);

            setStatusOverrides((prev) => {
                const next = { ...prev };
                if (newStatus === originalStatus) {
                    delete next[student.studentId];
                } else {
                    next[student.studentId] = newStatus;
                }
                return next;
            });
        },
        [getOriginalStatus]
    );

    const toggleExpand = useCallback((studentId: string) => {
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(studentId)) {
                next.delete(studentId);
            } else {
                next.add(studentId);
            }
            return next;
        });
    }, []);

    const handleSort = useCallback(
        (field: SortField) => {
            if (sortField === field) {
                setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
            } else {
                setSortField(field);
                setSortDir('desc');
            }
        },
        [sortField]
    );

    // Sorted data
    const sortedData = useMemo(() => {
        if (!sortField) return data;

        const sorted = [...data].sort((a, b) => {
            let aVal: number;
            let bVal: number;

            switch (sortField) {
                case 'status': {
                    const statusOrder: Record<string, number> = { PRESENT: 2, ABSENT: 1, UNMARKED: 0 };
                    aVal = statusOrder[getStatus(a) ?? 'UNMARKED'] ?? 0;
                    bVal = statusOrder[getStatus(b) ?? 'UNMARKED'] ?? 0;
                    break;
                }
                case 'duration': {
                    aVal = a.providerTotalDurationMinutes ?? -1;
                    bVal = b.providerTotalDurationMinutes ?? -1;
                    break;
                }
                case 'activePoints': {
                    aVal = computeActivePoints(a) ?? -1;
                    bVal = computeActivePoints(b) ?? -1;
                    break;
                }
                case 'activeness': {
                    aVal = activenessOf(a) ?? -1;
                    bVal = activenessOf(b) ?? -1;
                    break;
                }
                default:
                    return 0;
            }

            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });

        return sorted;
    }, [data, sortField, sortDir, getStatus]);

    const rows = useMemo<RowContext[]>(
        () =>
            sortedData.map((student) => ({
                student,
                status: getStatus(student),
                engagement: parseEngagement(student.engagementData),
                activePoints: computeActivePoints(student),
                activeness: activenessOf(student),
                activenessState: activenessStateOf(student),
            })),
        [sortedData, getStatus]
    );

    const { presentCount, absentCount, unmarkedCount } = useMemo(() => {
        let present = 0;
        let absent = 0;
        let unmarked = 0;
        for (const s of data) {
            const status = getStatus(s);
            if (status === 'PRESENT') present++;
            else if (status === 'ABSENT') absent++;
            else unmarked++;
        }
        return { presentCount: present, absentCount: absent, unmarkedCount: unmarked };
    }, [data, getStatus]);

    // The column only appears for classes that had the activeness score on.
    const showActiveness = useMemo(
        () => data.some((s) => activenessOf(s) !== null || activenessStateOf(s) !== null),
        [data]
    );

    // Talk time, raise hands, … only exist for classes where BBB sent its counters.
    const showBbbCounters = useMemo(
        () => data.some((s) => hasBbbCounters(parseEngagement(s.engagementData))),
        [data]
    );

    const courseValue = useMemo(
        () =>
            packageSessionDetails && packageSessionDetails.length > 0
                ? packageSessionDetails
                      .map((d) => d.package_name)
                      .filter(Boolean)
                      .join(' | ')
                : '',
        [packageSessionDetails]
    );

    // Every column the table can show, in table order. Manage Column lists them grouped;
    // the table and the CSV both use only the ticked ones.
    const allColumns = useMemo<AttendanceColumn[]>(() => {
        const systemGroup = t('columnGroups.system');
        const customGroup = t('columnGroups.custom');
        const feedbackGroup = t('columnGroups.feedback');
        const activityGroup = t('columnGroups.activity');
        const statusLabel = (status: string) =>
            status === 'PRESENT'
                ? t('status.present')
                : status === 'ABSENT'
                  ? t('status.absent')
                  : t('status.unmarked');
        const text = (
            id: string,
            label: string,
            value: (s: LiveSessionReport) => string | null | undefined,
            opts: { group?: string; csvHeader?: string; csvEmpty?: string } = {}
        ): AttendanceColumn => ({
            id,
            label,
            group: opts.group ?? systemGroup,
            tdClassName: 'text-gray-500',
            render: ({ student }) => textCell(value(student)),
            csv: ({ student }) => [[opts.csvHeader ?? label, value(student) || (opts.csvEmpty ?? '')]],
        });
        // Institute system fields as set in Settings: its own name for a field, and fields it
        // turned off there are not offered. No settings cached → every field, default names.
        const systemFieldSettings = new Map(getSystemFieldsFromStorage().map((f) => [f.key, f]));
        const systemLabel = (key: string, fallback: string) => {
            const f = systemFieldSettings.get(key);
            return f?.customValue || f?.defaultValue || fallback;
        };
        const systemOffered = (key: string) => systemFieldSettings.get(key)?.visibility !== false;
        const system = (
            id: string,
            key: string,
            fallbackLabel: string,
            value: (s: LiveSessionReport) => string | null | undefined
        ): AttendanceColumn[] => (systemOffered(key) ? [text(id, systemLabel(key, fallbackLabel), value)] : []);
        const profile = (s: LiveSessionReport, key: string) => learnerSysData[s.studentId]?.[key];
        const counter = (
            id: string,
            label: string,
            csvHeader: string,
            value: (e: EngagementData) => number | undefined
        ): AttendanceColumn => ({
            id,
            label,
            group: activityGroup,
            tdClassName: 'text-gray-600',
            render: ({ engagement }) => textCell(engagement ? value(engagement) : null),
            csv: ({ engagement }) => [[csvHeader, (engagement ? value(engagement) : undefined) ?? '']],
        });

        const cols: AttendanceColumn[] = [
            {
                id: 'name',
                label: t('columns.name'),
                group: systemGroup,
                locked: true,
                tdClassName: 'font-medium',
                render: ({ student }) => student.fullName,
                csv: ({ student }) => [[t('csv.name'), student.fullName ?? '']],
            },
            {
                id: 'status',
                label: t('columns.status'),
                group: systemGroup,
                locked: true,
                sortField: 'status',
                thClassName: 'w-[120px]',
                render: ({ student, status }) => (
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setStudentStatus(student, status === 'PRESENT' ? 'UNMARKED' : 'PRESENT')}
                            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                status === 'PRESENT'
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                    : 'bg-gray-50 text-gray-400 hover:bg-green-50 hover:text-green-600'
                            }`}
                        >
                            <CheckCircle size={14} weight={status === 'PRESENT' ? 'fill' : 'regular'} />
                            P
                        </button>
                        <button
                            type="button"
                            onClick={() => setStudentStatus(student, status === 'ABSENT' ? 'UNMARKED' : 'ABSENT')}
                            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                status === 'ABSENT'
                                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                                    : 'bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-600'
                            }`}
                        >
                            <XCircle size={14} weight={status === 'ABSENT' ? 'fill' : 'regular'} />
                            A
                        </button>
                        {status === 'UNMARKED' && (
                            <span className="ms-1 text-[10px] text-gray-400">{t('status.unmarked')}</span>
                        )}
                    </div>
                ),
                csv: ({ status }) => [[t('csv.status'), statusLabel(status)]],
            },
            // Email is a column the table always had — never dropped by a Settings toggle.
            text('email', systemLabel('EMAIL', t('columns.email')), (s) => s.email, {
                csvHeader: t('csv.email'),
            }),
            ...system('phone', 'MOBILE_NUMBER', t('columns.phone'), (s) => s.mobileNumber),
            ...system('username', 'USERNAME', t('columns.username'), (s) => profile(s, 'USERNAME')),
            ...system('gender', 'GENDER', t('columns.gender'), (s) => s.gender),
            ...system('dateOfBirth', 'DATE_OF_BIRTH', t('columns.dateOfBirth'), (s) =>
                formatDateOnly(s.dateOfBirth)
            ),
            ...system(
                'enrollmentNumber',
                'INSTITUTE_ENROLLMENT_ID',
                t('columns.enrollmentNumber'),
                (s) => s.instituteEnrollmentNumber
            ),
            text('batch', t('columns.batch'), (s) => s.batchName, { csvHeader: t('csv.batch') }),
            text('course', t('columns.course'), () => courseValue, { csvHeader: t('csv.course') }),
            text('registeredAt', t('columns.registeredAt'), (s) => formatWhen(s.registeredAt)),
            ...system('fatherName', 'FATHER_NAME', t('columns.fatherName'), (s) => profile(s, 'FATHER_NAME')),
            ...system('motherName', 'MOTHER_NAME', t('columns.motherName'), (s) => profile(s, 'MOTHER_NAME')),
            ...system('parentsMobile', 'PARENTS_MOBILE_NUMBER', t('columns.parentsMobile'), (s) =>
                profile(s, 'PARENTS_MOBILE_NUMBER')
            ),
            ...system('parentsEmail', 'PARENTS_EMAIL', t('columns.parentsEmail'), (s) =>
                profile(s, 'PARENTS_EMAIL')
            ),
            ...system('motherMobile', 'PARENTS_TO_MOTHER_MOBILE_NUMBER', t('columns.motherMobile'), (s) =>
                profile(s, 'PARENTS_TO_MOTHER_MOBILE_NUMBER')
            ),
            ...system('motherEmail', 'PARENTS_TO_MOTHER_EMAIL', t('columns.motherEmail'), (s) =>
                profile(s, 'PARENTS_TO_MOTHER_EMAIL')
            ),
            ...system('address', 'ADDRESS_LINE', t('columns.address'), (s) => profile(s, 'ADDRESS_LINE')),
            ...system('city', 'CITY', t('columns.city'), (s) => profile(s, 'CITY')),
            ...system('region', 'REGION', t('columns.region'), (s) => profile(s, 'REGION')),
            ...system('pinCode', 'PIN_CODE', t('columns.pinCode'), (s) => profile(s, 'PIN_CODE')),
            ...system('country', 'COUNTRY', t('columns.country'), (s) => profile(s, 'COUNTRY')),
            ...system('linkedInstitute', 'LINKED_INSTITUTE_NAME', t('columns.linkedInstitute'), (s) =>
                profile(s, 'LINKED_INSTITUTE_NAME')
            ),
        ];

        customFieldColumns.forEach((cf) => {
            // "-" for no answer, as the CSV always had.
            cols.push(
                text(`cf:${cf.key}`, cf.name, (s) => getCfValue(s, cf.key), {
                    group: customGroup,
                    csvEmpty: '-',
                })
            );
        });

        feedbackColumns.forEach((fbCol) => {
            const name = prettifyKey(fbCol);
            cols.push({
                id: `fb:${fbCol}`,
                label: name,
                group: feedbackGroup,
                thClassName: 'text-purple-600 bg-purple-50/50',
                tdClassName: 'text-gray-500 bg-purple-50/20',
                render: ({ student }) => textCell(getFeedbackValue(student, fbCol)),
                // "-" for no answer, as the CSV always had.
                csv: ({ student }) => [
                    [t('csv.feedbackColumn', { column: name }), getFeedbackValue(student, fbCol) ?? '-'],
                ],
            });
        });

        cols.push(
            {
                id: 'duration',
                label: t('columns.duration'),
                group: activityGroup,
                sortField: 'duration',
                thClassName: 'w-[100px]',
                tdClassName: 'text-gray-600',
                render: ({ student }) =>
                    student.providerTotalDurationMinutes != null ? (
                        <span className="flex items-center gap-1">
                            <Clock size={14} className="text-gray-400" />
                            {formatAttendedDuration(
                                t,
                                student.providerTotalDurationMinutes,
                                student.providerTotalDurationSeconds
                            )}
                        </span>
                    ) : (
                        EMPTY_CELL
                    ),
                csv: ({ student }) => [[t('csv.durationMin'), student.providerTotalDurationMinutes ?? '']],
            },
            {
                id: 'activePoints',
                label: t('columns.activePoints'),
                group: activityGroup,
                sortField: 'activePoints',
                thClassName: 'w-[120px]',
                render: ({ activePoints }) => {
                    const pointsBadge = getActivePointsBadge(t, activePoints);
                    return activePoints != null && pointsBadge ? (
                        <span className="flex items-center gap-1.5">
                            <span className="font-medium text-gray-700">{activePoints}</span>
                            <Badge variant="outline" className={`text-[10px] ${pointsBadge.color}`}>
                                {pointsBadge.label}
                            </Badge>
                        </span>
                    ) : (
                        EMPTY_CELL
                    );
                },
                csv: ({ activePoints }) => [[t('csv.activePoints'), activePoints ?? '']],
            }
        );

        if (showActiveness) {
            cols.push({
                id: 'activeness',
                label: t('columns.activeness'),
                group: activityGroup,
                sortField: 'activeness',
                thClassName: 'w-28',
                render: ({ activeness, activenessState, engagement }) =>
                    activeness != null && engagement ? (
                        <Badge
                            variant="outline"
                            className={`text-xs ${getActivenessBadgeColor(activeness)}`}
                            title={activenessSummary(t, engagement)}
                        >
                            {activeness}%
                        </Badge>
                    ) : activenessState !== null ? (
                        <Badge
                            variant="outline"
                            className="border-gray-200 bg-gray-50 text-xs text-gray-600"
                            title={t(`activenessState.${activenessState}`, { defaultValue: '' })}
                        >
                            {t(`activenessStateShort.${activenessState}`, { defaultValue: '' })}
                        </Badge>
                    ) : (
                        EMPTY_CELL
                    ),
                csv: ({ engagement, activenessState }) => [
                    [t('csv.activeness'), engagement?.activeness ?? ''],
                    [t('csv.activenessOnScreen'), engagement?.activenessOnScreen ?? ''],
                    [t('csv.activenessAttention'), engagement?.activenessAttention ?? ''],
                    [
                        t('csv.activenessMinutes'),
                        typeof engagement?.activenessSeconds === 'number'
                            ? Math.round(engagement.activenessSeconds / 60)
                            : '',
                    ],
                    [t('csv.activenessAwayCount'), engagement?.activenessAwayCount ?? ''],
                    [
                        t('csv.activenessStatus'),
                        activenessState !== null
                            ? t(`activenessState.${activenessState}`, { defaultValue: '' })
                            : '',
                    ],
                ],
            });
        }

        if (showBbbCounters) {
            cols.push(
                counter('talkTime', t('columns.talkTime'), t('csv.talkTimeMin'), (e) =>
                    e.talkTime ? Math.round(e.talkTime / 60) : undefined
                ),
                counter(
                    'talkSegments',
                    t('columns.talkSegments'),
                    t('csv.talkSegments'),
                    (e) => e.talks
                ),
                counter(
                    'raiseHands',
                    t('columns.raiseHands'),
                    t('csv.raiseHands'),
                    (e) => e.raisehand
                ),
                counter('emojis', t('columns.emojis'), t('csv.emojis'), (e) => e.emojis),
                counter('chats', t('columns.chats'), t('csv.chats'), (e) => e.chats),
                counter('pollVotes', t('columns.pollVotes'), t('csv.pollVotes'), (e) => e.pollVotes)
            );
        }

        cols.push({
            id: 'mode',
            label: t('columns.mode'),
            group: activityGroup,
            thClassName: 'w-[80px]',
            render: ({ student }) =>
                student.statusType ? (
                    <Badge
                        variant="outline"
                        className={`text-[10px] ${
                            student.statusType === 'ONLINE'
                                ? 'border-blue-200 bg-blue-50 text-blue-600'
                                : 'border-gray-200 bg-gray-50 text-gray-500'
                        }`}
                    >
                        {student.statusType}
                    </Badge>
                ) : null,
            csv: ({ student }) => [[t('csv.mode'), student.statusType || '']],
        });

        return cols;
    }, [
        t,
        setStudentStatus,
        courseValue,
        learnerSysData,
        customFieldColumns,
        feedbackColumns,
        getCfValue,
        getFeedbackValue,
        showActiveness,
        showBbbCounters,
    ]);

    const visibleColumns = useMemo(
        () => allColumns.filter((c) => c.locked || !hiddenColumns.has(c.id)),
        [allColumns, hiddenColumns]
    );

    const columnToggles = useMemo<LeadColumnToggle[]>(
        () =>
            allColumns.map((c) => ({ id: c.id, label: c.label, group: c.group, locked: c.locked })),
        [allColumns]
    );

    const handleSave = async () => {
        if (dirtyCount === 0) return;
        setSaving(true);
        try {
            const entries = Object.entries(statusOverrides).map(([studentId, status]) => {
                const student = data.find((s) => s.studentId === studentId);
                // Only form guests are EXTERNAL_USER. enrollmentStatus is null for
                // individually added learners too, so keying on it saved their marks
                // as guests — and the report (which reads USER rows) showed Unmarked.
                const isGuest = student?.sourceType
                    ? student.sourceType === 'EXTERNAL_USER'
                    : !student?.enrollmentStatus;
                return {
                    userSourceId: studentId,
                    userSourceType: isGuest ? 'EXTERNAL_USER' : 'USER',
                    status,
                };
            });

            await adminMarkAttendance({ sessionId, scheduleId, entries });
            toast.success(t('toast.saved', { count: entries.length }));
            setStatusOverrides({});
            onSaved?.();
        } catch (err) {
            console.error('Failed to save attendance:', err);
            toast.error(t('toast.saveFailed'));
        } finally {
            setSaving(false);
        }
    };

    // The CSV holds exactly the columns ticked in Manage Column, in table order.
    const handleExportCSV = useCallback(() => {
        const csvData = rows.map((row, idx) => {
            const record: Record<string, CsvValue> = { [t('csv.number')]: idx + 1 };
            visibleColumns.forEach((col) => {
                col.csv(row).forEach(([header, value]) => {
                    // A custom field named like a system column ("Gender") must not overwrite it.
                    const key = header in record ? `${header} (${col.group})` : header;
                    record[key] = value;
                });
            });
            return record;
        });
        const csv = Papa.unparse(csvData);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const filename = sessionTitle
            ? `attendance_${sessionTitle.replace(/[^a-zA-Z0-9]/g, '_')}.csv`
            : `attendance_${sessionId}.csv`;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(t('toast.csvDownloaded'));
    }, [rows, visibleColumns, sessionId, sessionTitle, t]);

    useEffect(() => {
        if (!exportCsvRef) return;
        exportCsvRef.current = handleExportCSV;
        return () => {
            exportCsvRef.current = null;
        };
    }, [exportCsvRef, handleExportCSV]);

    const hasEngagementOrDuration = (student: LiveSessionReport) => {
        return student.providerTotalDurationMinutes || student.engagementData;
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) {
            return <ArrowDown size={12} className="text-gray-300" />;
        }
        return sortDir === 'asc' ? (
            <ArrowUp size={12} className="text-gray-700" />
        ) : (
            <ArrowDown size={12} className="text-gray-700" />
        );
    };

    // An empty report means nobody resolves to this class (batch deleted or
    // emptied, no individual learners, no guests). Say so — a header row with
    // "Total: 0" over an empty table reads as a broken page.
    if (data.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center">
                <UsersThree size={28} className="text-gray-400" />
                <div className="text-sm font-medium text-gray-700">{t('emptyTitle')}</div>
                <p className="max-w-md text-xs text-gray-500">{t('emptyHint')}</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Summary */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-4">
                    <span className="font-medium">{t('title')}</span>
                    <span className="flex items-center gap-1 text-green-600">
                        <span className="h-2 w-2 rounded-full bg-green-500" />
                        {t('summary.present', { count: presentCount })}
                    </span>
                    <span className="flex items-center gap-1 text-red-500">
                        <span className="h-2 w-2 rounded-full bg-red-500" />
                        {t('summary.absent', { count: absentCount })}
                    </span>
                    <span className="flex items-center gap-1 text-gray-400">
                        <span className="h-2 w-2 rounded-full bg-gray-300" />
                        {t('summary.unmarked', { count: unmarkedCount })}
                    </span>
                    <span className="text-gray-500">{t('summary.total', { count: data.length })}</span>
                </div>
                <div className="flex items-center gap-2">
                    <ManageColumnsPopover
                        columns={columnToggles}
                        hiddenColumns={hiddenColumns}
                        onToggle={toggleColumn}
                        onReset={resetColumns}
                        triggerClassName="h-8 text-xs"
                    />
                    <button
                        type="button"
                        onClick={handleExportCSV}
                        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
                    >
                        <DownloadSimple size={14} />
                        {t('exportCsv')}
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="max-h-[400px] overflow-auto rounded-md border">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                        <tr className="border-b text-left text-xs font-medium text-gray-500">
                            <th className="px-3 py-2 w-[50px]">#</th>
                            {visibleColumns.map((col) => (
                                <th key={col.id} className={`px-3 py-2 ${col.thClassName ?? ''}`}>
                                    {col.sortField ? (
                                        <button
                                            type="button"
                                            onClick={() => col.sortField && handleSort(col.sortField)}
                                            className="flex items-center gap-1 hover:text-gray-700"
                                        >
                                            {col.label} <SortIcon field={col.sortField} />
                                        </button>
                                    ) : (
                                        col.label
                                    )}
                                </th>
                            ))}
                            <th className="px-3 py-2 w-[40px]"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => {
                            const { student, engagement, activeness } = row;
                            const isDirty = statusOverrides[student.studentId] !== undefined;
                            const isExpanded = expandedRows.has(student.studentId);
                            const canExpand = hasEngagementOrDuration(student);

                            return (
                                <Fragment key={student.studentId}>
                                    <tr
                                        className={`border-b transition-colors ${isDirty ? 'bg-yellow-50' : 'hover:bg-gray-50'}`}
                                    >
                                        <td className="px-3 py-2 text-gray-500">{index + 1}</td>
                                        {visibleColumns.map((col) => (
                                            <td key={col.id} className={`px-3 py-2 ${col.tdClassName ?? ''}`}>
                                                {col.render(row)}
                                            </td>
                                        ))}
                                        <td className="px-3 py-2">
                                            {canExpand && (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleExpand(student.studentId)}
                                                    className="text-gray-400 hover:text-gray-600"
                                                >
                                                    {isExpanded ? (
                                                        <CaretUp size={16} />
                                                    ) : (
                                                        <CaretDown size={16} />
                                                    )}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    {isExpanded && canExpand && (
                                        <tr key={`${student.studentId}-detail`} className="border-b bg-gray-50">
                                            <td colSpan={visibleColumns.length + 2} className="px-6 py-3">
                                                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
                                                    {student.providerTotalDurationMinutes != null && (
                                                        <span className="flex items-center gap-1">
                                                            <Clock size={14} className="text-gray-400" />
                                                            {t('detail.duration', {
                                                                value: formatAttendedDuration(
                                                                    t,
                                                                    student.providerTotalDurationMinutes,
                                                                    student.providerTotalDurationSeconds
                                                                ),
                                                            })}
                                                        </span>
                                                    )}
                                                    {activeness != null && engagement && (
                                                        <span className="flex items-center gap-1">
                                                            <Eye size={14} className="text-green-500" />
                                                            {t('activeness.detail', {
                                                                value: activeness,
                                                                summary: activenessSummary(t, engagement),
                                                            })}
                                                        </span>
                                                    )}
                                                    {engagement && (
                                                        <>
                                                            {engagement.talkTime != null && engagement.talkTime > 0 && (
                                                                <span className="flex items-center gap-1">
                                                                    <Microphone size={14} className="text-blue-400" />
                                                                    {t('detail.talkTime', {
                                                                        count: Math.round(engagement.talkTime / 60),
                                                                    })}
                                                                </span>
                                                            )}
                                                            {engagement.talks != null && engagement.talks > 0 && (
                                                                <span className="flex items-center gap-1">
                                                                    <Microphone size={14} className="text-gray-400" />
                                                                    {t('detail.talkSegments', { count: engagement.talks })}
                                                                </span>
                                                            )}
                                                            {engagement.raisehand != null && engagement.raisehand > 0 && (
                                                                <span className="flex items-center gap-1">
                                                                    <HandWaving size={14} className="text-yellow-500" />
                                                                    {t('detail.raiseHands', { count: engagement.raisehand })}
                                                                </span>
                                                            )}
                                                            {engagement.emojis != null && engagement.emojis > 0 && (
                                                                <span className="flex items-center gap-1">
                                                                    <Smiley size={14} className="text-orange-400" />
                                                                    {t('detail.emojis', { count: engagement.emojis })}
                                                                </span>
                                                            )}
                                                            {engagement.chats != null && engagement.chats > 0 && (
                                                                <span className="flex items-center gap-1">
                                                                    <ChatCircle size={14} className="text-purple-400" />
                                                                    {t('detail.chats', { count: engagement.chats })}
                                                                </span>
                                                            )}
                                                            {engagement.pollVotes != null && engagement.pollVotes > 0 && (
                                                                <span className="flex items-center gap-1">
                                                                    <ChartBar size={14} className="text-teal-400" />
                                                                    {t('detail.pollVotes', { count: engagement.pollVotes })}
                                                                </span>
                                                            )}
                                                        </>
                                                    )}
                                                    {!student.providerTotalDurationMinutes && !engagement && (
                                                        <span className="text-gray-400 italic">
                                                            {t('detail.noEngagementData')}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Save button */}
            {dirtyCount > 0 && (
                <div className="flex items-center gap-3">
                    <MyButton buttonType="primary" onClick={handleSave} disabled={saving}>
                        {saving ? t('saving') : t('saveAttendance', { count: dirtyCount })}
                    </MyButton>
                    <button
                        type="button"
                        onClick={() => setStatusOverrides({})}
                        className="text-sm text-gray-500 hover:text-gray-700"
                    >
                        {t('discardChanges')}
                    </button>
                </div>
            )}
        </div>
    );
}
