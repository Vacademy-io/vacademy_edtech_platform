import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { AutomationRunsStrip } from '@/components/shared/crm-enhance/group-summary-strips';
import { useEffect, useState } from 'react';
import {
    getWorkflowsByStatusQuery,
    WORKFLOW_STATUSES,
    type WorkflowStatus,
} from '@/services/workflow-service';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { WorkflowCard } from './workflow-card';
import { Workflow } from '@/types/workflow/workflow-types';
import { Input } from '@/components/ui/input';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Plus } from '@phosphor-icons/react';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

/** `null` = no status filter, i.e. show every lifecycle status. */
type StatusFilter = WorkflowStatus | null;

function buildStatusLabels(t: TFunction): Record<WorkflowStatus, string> {
    return {
        ACTIVE: t('statusLabels.active'),
        DRAFT: t('statusLabels.draft'),
        INACTIVE: t('statusLabels.inactive'),
    };
}

export function WorkflowListPage() {
    const { t } = useTranslation('workflowListPage');
    const STATUS_LABELS = buildStatusLabels(t);
    const navigate = useNavigate();
    const { setNavHeading } = useNavHeadingStore();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());

    const [searchTerm, setSearchTerm] = useState('');
    const [selectedType, setSelectedType] = useState<string | null>(null);
    const [selectedStatus, setSelectedStatus] = useState<StatusFilter>(null);

    // Status is filtered server-side (the list endpoint only returns workflows whose status is
    // in the payload), so this drives the request rather than a client-side .filter().
    const {
        data: workflows,
        isLoading,
        error,
    } = useQuery(
        getWorkflowsByStatusQuery(
            instituteDetails?.id || '',
            selectedStatus ? [selectedStatus] : WORKFLOW_STATUSES
        )
    );

    // A count on each status button. Same request as the "All"
    // view (shared cache), so it costs at most one call and only when switched on.
    const allWorkflows = useQuery({
        ...getWorkflowsByStatusQuery(instituteDetails?.id || '', WORKFLOW_STATUSES),
        enabled: !!instituteDetails?.id,
    });
    const statusCount = (status: StatusFilter) => {
        if (!allWorkflows.data) return null;
        const list = allWorkflows.data as Workflow[];
        const n = status ? list.filter((w) => w.status === status).length : list.length;
        return <span className="ml-1.5 tabular-nums opacity-80">{n}</span>;
    };

    useEffect(() => {
        setNavHeading(
            <div className="flex w-full items-center justify-between">
                <h1 className="text-2xl font-semibold">{t('heading')}</h1>
            </div>
        );
    }, [setNavHeading, t]);

    // Only take over the whole page on the first load — switching the status filter refetches,
    // and swapping the filter chips out for a full-page loader would make them jump.
    if (isLoading && !workflows) {
        return <DashboardLoader />;
    }

    if (error) {
        return (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                <div className="text-center">
                    <p className="text-lg font-medium text-red-600">{t('loadFailed.title')}</p>
                    <p className="mt-2 text-sm text-neutral-500">
                        {t('loadFailed.hint')}
                    </p>
                </div>
                <Button onClick={() => window.location.reload()}>{t('retry')}</Button>
            </div>
        );
    }

    // Filter workflows based on search term and selected type
    const filteredWorkflows = workflows?.filter((workflow: Workflow) => {
        // description is nullable on the wire (drafts often have none) — guard both.
        const matchesSearch =
            (workflow.name ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (workflow.description ?? '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = !selectedType || workflow.workflow_type === selectedType;
        return matchesSearch && matchesType;
    });

    // Get unique workflow types for filter
    const workflowTypes = Array.from(
        new Set(workflows?.map((w: Workflow) => w.workflow_type) || [])
    );

    const formatWorkflowType = (type: string) => {
        // Convert EVENT_DRIVEN to "Event Driven", SCHEDULED to "Scheduled", etc.
        return type
            .split('_')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    };

    return (
        <div className="container mx-auto p-6">
            {/* Admins: last 30 days of runs, from the Automation Dashboard. */}
            <AutomationRunsStrip className="mb-6" />
            {/* Header Section */}
            <div className="mb-8 flex flex-col gap-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-neutral-800">
                            {selectedStatus ? t('statusHeading', { status: STATUS_LABELS[selectedStatus] }) : t('heading')}
                        </h1>
                        <p className="mt-1 text-neutral-600">
                            {t('foundCount', { count: filteredWorkflows?.length || 0 })}
                        </p>
                    </div>
                    <Button
                        onClick={() => {
                            navigate({ to: '/workflow/create' });
                        }}
                        className="flex items-center gap-2"
                    >
                        <Plus size={20} weight="bold" />
                        {t('createWorkflow')}
                    </Button>
                </div>

                {/* Search and Filter Section */}
                <div className="flex flex-wrap items-center gap-4">
                    <div className="relative max-w-md flex-1">
                        <MagnifyingGlass
                            className="absolute start-3 top-1/2 -translate-y-1/2 text-neutral-400"
                            size={20}
                        />
                        <Input
                            type="text"
                            placeholder={t('searchPlaceholder')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="ps-10"
                        />
                    </div>

                    {/* Status Filter */}
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-neutral-600">{t('status')}</span>
                        <div className="flex gap-2">
                            <Button
                                variant={selectedStatus === null ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => setSelectedStatus(null)}
                            >
                                {t('all')}
                                {statusCount(null)}
                            </Button>
                            {WORKFLOW_STATUSES.map((status) => (
                                <Button
                                    key={status}
                                    variant={selectedStatus === status ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setSelectedStatus(status)}
                                >
                                    {STATUS_LABELS[status]}
                                    {statusCount(status)}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Type Filter */}
                    {workflowTypes.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-neutral-600">{t('filterByType')}</span>
                            <div className="flex gap-2">
                                <Button
                                    variant={selectedType === null ? 'default' : 'outline'}
                                    size="sm"
                                    onClick={() => setSelectedType(null)}
                                >
                                    {t('all')}
                                </Button>
                                {workflowTypes.map((type) => (
                                    <Button
                                        key={type}
                                        variant={selectedType === type ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setSelectedType(type)}
                                    >
                                        {formatWorkflowType(type)}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Workflows Grid */}
            {!filteredWorkflows || filteredWorkflows.length === 0 ? (
                <div className="flex h-[50vh] flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50">
                    <div className="max-w-md text-center">
                        <p className="mb-2 text-lg font-medium text-neutral-500">
                            {searchTerm || selectedType || selectedStatus
                                ? t('empty.filteredTitle')
                                : t('empty.noneTitle')}
                        </p>
                        <p className="text-sm text-neutral-400">
                            {searchTerm || selectedType || selectedStatus
                                ? t('empty.filteredHint')
                                : t('empty.noneHint')}
                        </p>
                        {!searchTerm && !selectedType && !selectedStatus && (
                            <Button
                                onClick={() => {
                                    navigate({ to: '/workflow/create' });
                                }}
                                className="mt-4"
                            >
                                <Plus size={20} weight="bold" className="me-2" />
                                {t('createFirstWorkflow')}
                            </Button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {filteredWorkflows.map((workflow: Workflow) => (
                        <WorkflowCard key={workflow.id} workflow={workflow} />
                    ))}
                </div>
            )}
        </div>
    );
}
