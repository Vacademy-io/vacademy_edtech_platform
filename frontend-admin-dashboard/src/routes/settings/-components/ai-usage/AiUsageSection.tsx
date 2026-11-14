import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useDebounce } from 'use-debounce';
import * as XLSX from 'xlsx';
import { Sparkle, Users, MagnifyingGlass, DownloadSimple, Eye } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyTable } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { DateRangeFilter, type DateRangeResult } from '@/components/design-system/date-range-filter';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import {
    useUsageUsersQuery,
    useUsageSummaryQuery,
    fetchUsageUsers,
    fetchAllLogs,
    fetchAllSessions,
    fetchAllMessages,
    ddmmyyyyToMillis,
    type UsageDateRange,
    type UserUsageRow,
} from '../../-services/ai-usage-service';
import { LearnerActivityDialog, type SelectedLearner } from './LearnerActivityDialog';

const PAGE_SIZE = 20;
// Per-user usage is bounded (one row per member who used AI), so one big page
// pulls the whole filtered set for an export.
const EXPORT_PAGE_SIZE = 10000;

const formatRoles = (roles: string | null): string =>
    roles
        ? Array.from(new Set(roles.split(',').map((r) => r.trim()).filter(Boolean)))
              .map((r) => mapRoleToCustomName(r))
              .join(', ')
        : '';

const fileDate = (ms?: number): string => {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const prettyTool = (s: string | null): string =>
    s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '';

const senderLabel = (mt: string | null): string => {
    switch (mt) {
        case 'user':
            return i18next.t('settingsAiUsage:sender.learner');
        case 'assistant':
            return i18next.t('settingsAiUsage:sender.ai');
        case 'tool_call':
            return i18next.t('settingsAiUsage:sender.toolCall');
        case 'tool_result':
            return i18next.t('settingsAiUsage:sender.toolResult');
        default:
            return prettyTool(mt);
    }
};

const dateTime = (ms: number | null): string => (ms ? new Date(ms).toLocaleString() : '');

const defaultRange = (): UsageDateRange => {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { startDate: start.getTime(), endDate: now.getTime() };
};

function RoleChips({ roles }: { roles: string | null }) {
    if (!roles) return <span className="text-neutral-400">—</span>;
    const list = Array.from(new Set(roles.split(',').map((r) => r.trim()).filter(Boolean)));
    return (
        <div className="flex flex-wrap gap-1">
            {list.map((r) => (
                <span
                    key={r}
                    className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption text-neutral-600"
                >
                    {mapRoleToCustomName(r)}
                </span>
            ))}
        </div>
    );
}

export function AiUsageSection() {
    const { t } = useTranslation('settingsAiUsage');
    const [range, setRange] = useState<UsageDateRange>(defaultRange);
    const [roleTab, setRoleTab] = useState<string | null>(null); // null = All
    const [nameInput, setNameInput] = useState('');
    const [debouncedName] = useDebounce(nameInput, 300);
    const [page, setPage] = useState(0);
    const [selectedLearner, setSelectedLearner] = useState<SelectedLearner | null>(null);

    const summaryQ = useUsageSummaryQuery(range);
    const usersQ = useUsageUsersQuery(page, PAGE_SIZE, { ...range, role: roleTab, name: debouncedName });

    const onDateChange = (r: DateRangeResult | null) => {
        setPage(0);
        if (!r) {
            setRange(defaultRange());
            return;
        }
        setRange({
            startDate: ddmmyyyyToMillis(r.startDate),
            endDate: ddmmyyyyToMillis(r.endDate, true),
        });
    };

    const roleTabs = useMemo(
        () => (summaryQ.data ?? []).slice().sort((a, b) => b.totalCredits - a.totalCredits),
        [summaryQ.data]
    );

    // Export the currently-filtered data (role tab + name search + date range) as a
    // workbook: Summary, Activity Log, Chat Sessions and Chat Messages.
    const handleExport = async () => {
        const filters = { ...range, role: roleTab, name: debouncedName };
        const [usersData, logs, sessions, messages] = await Promise.all([
            fetchUsageUsers(0, EXPORT_PAGE_SIZE, filters),
            fetchAllLogs(filters),
            fetchAllSessions(filters),
            fetchAllMessages(filters),
        ]);

        const wb = XLSX.utils.book_new();

        // Sheet 1 — Summary (per member)
        const summaryHeader = [
            t('common.name'),
            t('common.email'),
            t('common.role'),
            t('common.creditsUsed'),
            t('common.requests'),
        ];
        const summaryBody = (usersData.content ?? []).map((u) => [
            u.name || u.userId,
            u.email || '',
            formatRoles(u.roles),
            Number(u.totalCredits.toFixed(2)),
            u.requestCount,
        ]);
        const summaryWs = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryBody]);
        summaryWs['!cols'] = [{ wch: 28 }, { wch: 32 }, { wch: 22 }, { wch: 14 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(wb, summaryWs, t('export.sheets.summary'));

        // Sheet 2 — Activity Log (every credit deduction across all tools)
        const logHeader = [
            t('export.headers.when'),
            t('common.name'),
            t('common.email'),
            t('common.role'),
            t('export.headers.tool'),
            t('export.headers.model'),
            t('export.headers.credits'),
            t('export.headers.detail'),
        ];
        const logBody = logs.map((l) => [
            dateTime(l.createdAt),
            l.name || l.userId,
            l.email || '',
            formatRoles(l.roles),
            prettyTool(l.requestType),
            l.model || '',
            Number(l.credits.toFixed(4)),
            l.description || '',
        ]);
        const logWs = XLSX.utils.aoa_to_sheet([logHeader, ...logBody]);
        logWs['!cols'] = [
            { wch: 20 }, { wch: 24 }, { wch: 30 }, { wch: 18 },
            { wch: 16 }, { wch: 26 }, { wch: 10 }, { wch: 40 },
        ];
        XLSX.utils.book_append_sheet(wb, logWs, t('export.sheets.activityLog'));

        // Sheet 3 — Chat Sessions (one row per Student-AI session)
        const sessionHeader = [
            t('export.headers.started'),
            t('export.headers.lastActive'),
            t('common.name'),
            t('common.email'),
            t('common.role'),
            t('export.headers.context'),
            t('export.headers.mode'),
            t('export.headers.status'),
            t('export.headers.messages'),
            t('export.headers.firstMessage'),
        ];
        const sessionBody = sessions.map((s) => [
            dateTime(s.createdAt),
            dateTime(s.lastActive),
            s.name || s.userId,
            s.email || '',
            formatRoles(s.roles),
            s.contextTitle || prettyTool(s.contextType),
            prettyTool(s.sessionMode),
            s.status || '',
            s.messageCount,
            s.preview || '',
        ]);
        const sessionWs = XLSX.utils.aoa_to_sheet([sessionHeader, ...sessionBody]);
        sessionWs['!cols'] = [
            { wch: 20 }, { wch: 20 }, { wch: 24 }, { wch: 30 }, { wch: 16 },
            { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 50 },
        ];
        XLSX.utils.book_append_sheet(wb, sessionWs, t('export.sheets.chatSessions'));

        // Sheet 4 — Chat Messages (every prompt + AI answer)
        const msgHeader = [
            t('export.headers.when'),
            t('common.name'),
            t('common.email'),
            t('export.headers.session'),
            t('export.headers.context'),
            t('export.headers.sender'),
            t('export.headers.message'),
        ];
        const msgBody = messages.map((m) => [
            dateTime(m.createdAt),
            m.name || m.userId,
            m.email || '',
            m.sessionId,
            m.contextTitle || prettyTool(m.contextType),
            senderLabel(m.messageType),
            m.content || '',
        ]);
        const msgWs = XLSX.utils.aoa_to_sheet([msgHeader, ...msgBody]);
        msgWs['!cols'] = [
            { wch: 20 }, { wch: 24 }, { wch: 30 }, { wch: 24 },
            { wch: 26 }, { wch: 12 }, { wch: 80 },
        ];
        XLSX.utils.book_append_sheet(wb, msgWs, t('export.sheets.chatMessages'));

        XLSX.writeFile(wb, `ai-credit-usage_${fileDate(range.startDate)}_${fileDate(range.endDate)}.xlsx`);
    };

    const userColumns: ColumnDef<UserUsageRow>[] = useMemo(
        () => [
            {
                accessorKey: 'name',
                header: t('common.name'),
                size: 260,
                cell: ({ row }) => (
                    <span
                        className="block truncate font-medium text-neutral-700"
                        title={row.original.name || row.original.userId}
                    >
                        {row.original.name || row.original.userId}
                    </span>
                ),
            },
            {
                accessorKey: 'email',
                header: t('common.email'),
                size: 460,
                cell: ({ row }) =>
                    row.original.email ? (
                        <span className="block truncate text-neutral-600" title={row.original.email}>
                            {row.original.email}
                        </span>
                    ) : (
                        <span className="text-neutral-400">—</span>
                    ),
            },
            {
                accessorKey: 'roles',
                header: t('common.role'),
                size: 200,
                cell: ({ row }) => <RoleChips roles={row.original.roles} />,
            },
            {
                accessorKey: 'totalCredits',
                header: t('common.creditsUsed'),
                size: 170,
                cell: ({ row }) => (
                    <span className="font-semibold text-neutral-800">
                        {row.original.totalCredits.toFixed(2)}
                    </span>
                ),
            },
            { accessorKey: 'requestCount', header: t('common.requests'), size: 150 },
            {
                id: 'actions',
                header: t('table.activity'),
                size: 160,
                cell: ({ row }) => (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() =>
                            setSelectedLearner({
                                userId: row.original.userId,
                                name: row.original.name || row.original.email || row.original.userId,
                                email: row.original.email,
                                roles: row.original.roles,
                                totalCredits: row.original.totalCredits,
                                requestCount: row.original.requestCount,
                            })
                        }
                    >
                        <Eye className="size-4" />
                        {t('table.viewLogs')}
                    </MyButton>
                ),
            },
        ],
        [t]
    );

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <Sparkle className="size-5 text-primary-500" weight="fill" />
                    <h3 className="text-h3 font-semibold text-neutral-700">{t('heading')}</h3>
                </div>
                <p className="text-body text-neutral-500">{t('description')}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Role sub-tabs */}
                <div className="flex flex-wrap items-center gap-2">
                    <RoleTabButton active={roleTab === null} onClick={() => { setRoleTab(null); setPage(0); }}>
                        <Users className="size-3.5" /> {t('roleTabs.all')}
                    </RoleTabButton>
                    {roleTabs.map((rs) => (
                        <RoleTabButton
                            key={rs.role}
                            active={roleTab === rs.role}
                            onClick={() => { setRoleTab(rs.role); setPage(0); }}
                        >
                            {mapRoleToCustomName(rs.role)}
                            <span className="rounded-full bg-neutral-100 px-1.5 text-caption text-neutral-500">
                                {rs.userCount}
                            </span>
                        </RoleTabButton>
                    ))}
                </div>
                <DateRangeFilter onChange={onDateChange} defaultFilter="7 Days" />
            </div>

            {/* Name search + export */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-full sm:w-80">
                    <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                    <MyInput
                        inputType="text"
                        inputPlaceholder={t('search.placeholder')}
                        input={nameInput}
                        onChangeFunction={(e) => {
                            setNameInput(e.target.value);
                            setPage(0);
                        }}
                        size="medium"
                        className="w-full pl-9 sm:w-80"
                    />
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="default"
                    onAsyncClick={handleExport}
                    loadingText={t('export.loading')}
                    disable={!usersQ.data || usersQ.data.total_elements === 0}
                >
                    <DownloadSimple className="size-4" />
                    {t('export.button')}
                </MyButton>
            </div>

            <MyTable<UserUsageRow>
                data={usersQ.data}
                columns={userColumns}
                isLoading={usersQ.isLoading}
                error={usersQ.error}
                currentPage={page}
            />
            {usersQ.data && usersQ.data.total_pages > 1 && (
                <MyPagination
                    currentPage={page}
                    totalPages={usersQ.data.total_pages}
                    onPageChange={setPage}
                />
            )}

            <LearnerActivityDialog
                learner={selectedLearner}
                range={range}
                onClose={() => setSelectedLearner(null)}
            />
        </div>
    );
}

function RoleTabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-body font-medium transition-colors',
                active
                    ? 'border-primary-500 bg-primary-50 text-primary-600'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-primary-200'
            )}
        >
            {children}
        </button>
    );
}
