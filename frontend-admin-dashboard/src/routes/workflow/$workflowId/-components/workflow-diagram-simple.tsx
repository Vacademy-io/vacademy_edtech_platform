import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AutomationDiagram, NodeType, WorkflowNode } from '@/types/workflow/workflow-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Minus, Plus, ArrowsOut } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { Route } from '../index';
import { formatISODateTimeReadable } from '@/helpers/formatISOTime';

interface WorkflowDiagramSimpleProps {
    diagram: AutomationDiagram;
    instituteId?: string;
}

const getNodeTypeColor = (type: NodeType): string => {
    const colors = {
        TRIGGER: 'border-green-500 bg-green-50 hover:bg-green-100',
        ACTION: 'border-blue-500 bg-blue-50 hover:bg-blue-100',
        DECISION: 'border-yellow-500 bg-yellow-50 hover:bg-yellow-100',
        EMAIL: 'border-purple-500 bg-purple-50 hover:bg-purple-100',
        NOTIFICATION: 'border-indigo-500 bg-indigo-50 hover:bg-indigo-100',
        DATABASE: 'border-red-500 bg-red-50 hover:bg-red-100',
        WEBHOOK: 'border-orange-500 bg-orange-50 hover:bg-orange-100',
        UNKNOWN: 'border-gray-500 bg-gray-50 hover:bg-gray-100',
    };
    return colors[type] || colors.UNKNOWN;
};

const getNodeBadgeColor = (type: NodeType): string => {
    const colors = {
        TRIGGER: 'bg-green-100 text-green-800 border-green-500',
        ACTION: 'bg-blue-100 text-blue-800 border-blue-500',
        DECISION: 'bg-yellow-100 text-yellow-800 border-yellow-500',
        EMAIL: 'bg-purple-100 text-purple-800 border-purple-500',
        NOTIFICATION: 'bg-indigo-100 text-indigo-800 border-indigo-500',
        DATABASE: 'bg-red-100 text-red-800 border-red-500',
        WEBHOOK: 'bg-orange-100 text-orange-800 border-orange-500',
        UNKNOWN: 'bg-gray-100 text-gray-800 border-gray-500',
    };
    return colors[type] || colors.UNKNOWN;
};

const getNodeIcon = (type: NodeType): string => {
    const icons = {
        TRIGGER: '⚡',
        ACTION: '⚙️',
        DECISION: '🔀',
        EMAIL: '📧',
        NOTIFICATION: '🔔',
        DATABASE: '💾',
        WEBHOOK: '🔗',
        UNKNOWN: '❓',
    };
    return icons[type] || icons.UNKNOWN;
};

export function WorkflowDiagramSimple({
    diagram,
    instituteId: passedInstituteId,
}: WorkflowDiagramSimpleProps) {
    const { t } = useTranslation('workflowDiagramSimple');
    const [selectedNode, setSelectedNode] = useState<WorkflowNode | null>(null);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [startPan, setStartPan] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const { workflowId } = Route.useParams();

    // Execution filters state
    const toInputValue = (d: Date) => {
        // YYYY-MM-DDTHH:MM
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
            d.getMinutes()
        )}`;
    };
    // Convert a datetime-local string (no timezone) to ISO UTC string preserving displayed fields as GMT
    const dateTimeLocalToIsoZ = (val: string): string => {
        // Accept forms like YYYY-MM-DDTHH:MM or with seconds/millis, append Z if missing
        if (!val) return '';
        // If already ends with Z, trust it
        if (/Z$/i.test(val)) return val;
        // If has seconds
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(val)) {
            return `${val}Z`;
        }
        // Default add :00.000Z seconds and millis
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(val)) {
            return `${val}:00.000Z`;
        }
        // Fallback to Date parse then toISOString (last resort)
        try {
            return new Date(val).toISOString();
        } catch {
            return '';
        }
    };
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const initialStartInput = toInputValue(weekAgo);
    const initialEndInput = toInputValue(now);
    const [startInput, setStartInput] = useState<string>(initialStartInput);
    const [endInput, setEndInput] = useState<string>(initialEndInput);
    const [appliedStart, setAppliedStart] = useState<string>(
        dateTimeLocalToIsoZ(initialStartInput)
    );
    const [appliedEnd, setAppliedEnd] = useState<string>(dateTimeLocalToIsoZ(initialEndInput));
    const [pageNo, setPageNo] = useState<number>(0);
    const [pageSize] = useState<number>(10);

    // Get current institute id directly from token/local selection without extra queries
    // Lazy import to avoid circulars
    const getCurrentInstituteId = (() => {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require('@/lib/auth/instituteUtils');
            return mod.getCurrentInstituteId as () => string | undefined;
        } catch {
            return () => undefined;
        }
    })();
    const instituteId = passedInstituteId || getCurrentInstituteId() || '';

    type WorkflowExecution = {
        id: string;
        idempotency_key: string;
        status: string;
        error_message: string | null;
        started_at: string | null;
        completed_at: string | null;
        created_at: string;
        updated_at: string;
        workflow_id: string;
        workflow_name: string;
        workflow_schedule_id?: string;
    };

    type WorkflowExecutionListResponse = {
        content: WorkflowExecution[];
        page_number: number;
        page_size: number;
        total_elements: number;
        total_pages: number;
        last: boolean;
        first: boolean;
    };

    const fetchWorkflowExecutions = async (): Promise<WorkflowExecutionListResponse> => {
        const url = `${BASE_URL}/admin-core-service/v1/workflow-execution/list?pageNo=${pageNo}&pageSize=${pageSize}`;
        const body = {
            institute_id: instituteId,
            workflow_ids: [workflowId],
            sort_columns: { startedAt: 'desc' },
            start_date: appliedStart,
            end_date: appliedEnd,
        } as const;
        const response = await authenticatedAxiosInstance<WorkflowExecutionListResponse>({
            method: 'POST',
            url,
            data: body,
            headers: { 'Content-Type': 'application/json', accept: '*/*' },
        });
        return response.data;
    };

    const {
        data: executions,
        isLoading: isExecLoading,
        isError: isExecError,
        error: execError,
        refetch: refetchExecutions,
    } = useQuery<WorkflowExecutionListResponse, Error>({
        queryKey: [
            'WORKFLOW_EXECUTIONS',
            instituteId,
            workflowId,
            appliedStart,
            appliedEnd,
            pageNo,
            pageSize,
        ],
        queryFn: fetchWorkflowExecutions,
        enabled: Boolean(instituteId && workflowId && appliedStart && appliedEnd),
        staleTime: 60_000,
    });

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) {
            // Left mouse button
            setIsPanning(true);
            setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            setPan({
                x: e.clientX - startPan.x,
                y: e.clientY - startPan.y,
            });
        }
    };

    const handleMouseUp = () => {
        setIsPanning(false);
    };

    const handleZoomIn = () => {
        setZoom((prev) => Math.min(prev + 0.1, 2));
    };

    const handleZoomOut = () => {
        setZoom((prev) => Math.max(prev - 0.1, 0.5));
    };

    const handleResetView = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    if (!diagram || diagram.nodes.length === 0) {
        return (
            <div className="flex h-[50vh] flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50">
                <p className="text-lg font-medium text-neutral-500">
                    {t('emptyState.title')}
                </p>
                <p className="text-sm text-neutral-400">
                    {t('emptyState.description')}
                </p>
            </div>
        );
    }

    // Create a map of edges for connections
    const edgeMap = new Map<string, { targetId: string; label: string }[]>();
    diagram.edges.forEach((edge) => {
        if (!edgeMap.has(edge.sourceNodeId)) {
            edgeMap.set(edge.sourceNodeId, []);
        }
        edgeMap.get(edge.sourceNodeId)!.push({
            targetId: edge.targetNodeId,
            label: edge.label,
        });
    });

    // Calculate positions for horizontal layout
    const nodeWidth = 280;
    const nodeHeight = 150;
    const horizontalGap = 200;
    // const verticalGap = 50; // reserved for future vertical layout

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-neutral-800">{t('title')}</h2>
                    <p className="text-sm text-neutral-600">
                        {t('nodeCount', { count: diagram.nodes.length })},{' '}
                        {t('connectionCount', { count: diagram.edges.length })}
                    </p>
                </div>

                {/* Zoom Controls */}
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={handleZoomOut}>
                        <Minus size={16} weight="bold" />
                    </Button>
                    <span className="text-sm font-medium text-neutral-600">
                        {Math.round(zoom * 100)}%
                    </span>
                    <Button variant="outline" size="sm" onClick={handleZoomIn}>
                        <Plus size={16} weight="bold" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleResetView}>
                        <ArrowsOut size={16} weight="bold" />
                    </Button>
                </div>
            </div>

            {/* Canvas Container */}
            <div
                ref={containerRef}
                className="relative h-[600px] overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50"
                style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                <svg
                    className="pointer-events-none absolute left-0 top-0"
                    width={diagram.nodes.length * (nodeWidth + horizontalGap) + 100}
                    height="800"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: '0 0',
                    }}
                >
                    {/* Background grid pattern */}
                    <defs>
                        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                            <circle cx="1" cy="1" r="1" fill="#e5e7eb" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />

                    {/* Draw connections */}
                    {diagram.edges.map((edge, edgeIndex) => {
                        const sourceIndex = diagram.nodes.findIndex(
                            (n) => n.id === edge.sourceNodeId
                        );
                        const targetIndex = diagram.nodes.findIndex(
                            (n) => n.id === edge.targetNodeId
                        );

                        if (sourceIndex === -1 || targetIndex === -1) {
                            console.warn('Edge with missing node:', edge);
                            return null;
                        }

                        const sourceX = 50 + sourceIndex * (nodeWidth + horizontalGap) + nodeWidth;
                        const sourceY = 50 + nodeHeight / 2;
                        const targetX = 50 + targetIndex * (nodeWidth + horizontalGap);
                        const targetY = 50 + nodeHeight / 2;

                        const midX = (sourceX + targetX) / 2;

                        // Add some vertical offset if source and target are the same Y position
                        const yOffset = Math.abs(targetIndex - sourceIndex) > 3 ? 30 : 0;

                        return (
                            <g key={`${edge.id}-${edgeIndex}`}>
                                {/* Curved path */}
                                <path
                                    d={`M ${sourceX} ${sourceY} C ${midX} ${sourceY + yOffset}, ${midX} ${targetY + yOffset}, ${targetX} ${targetY}`}
                                    stroke="#94a3b8"
                                    strokeWidth="2"
                                    fill="none"
                                    markerEnd="url(#arrowhead)"
                                    style={{ pointerEvents: 'none' }}
                                />
                                {/* Label background */}
                                <rect
                                    x={midX - 30}
                                    y={sourceY + yOffset - 18}
                                    width="60"
                                    height="16"
                                    fill="white"
                                    rx="4"
                                    opacity="0.9"
                                />
                                {/* Label */}
                                <text
                                    x={midX}
                                    y={sourceY + yOffset - 8}
                                    textAnchor="middle"
                                    fill="#475569"
                                    fontSize="11"
                                    fontWeight="500"
                                    className="pointer-events-none"
                                >
                                    {edge.label}
                                </text>
                            </g>
                        );
                    })}

                    {/* Arrow marker definition */}
                    <defs>
                        <marker
                            id="arrowhead"
                            markerWidth="10"
                            markerHeight="10"
                            refX="9"
                            refY="3"
                            orient="auto"
                        >
                            <polygon points="0 0, 10 3, 0 6" fill="#94a3b8" />
                        </marker>
                    </defs>
                </svg>

                {/* Nodes */}
                <div
                    className="absolute left-0 top-0"
                    style={{
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: '0 0',
                        width: `${diagram.nodes.length * (nodeWidth + horizontalGap) + 100}px`,
                        height: '800px',
                    }}
                >
                    {diagram.nodes.map((node, index) => {
                        const x = 50 + index * (nodeWidth + horizontalGap);
                        const y = 50;

                        return (
                            <div
                                key={node.id}
                                className={cn(
                                    'absolute cursor-pointer rounded-lg border-2 p-4 shadow-md transition-all hover:shadow-lg',
                                    getNodeTypeColor(node.type)
                                )}
                                style={{
                                    left: `${x}px`,
                                    top: `${y}px`,
                                    width: `${nodeWidth}px`,
                                    minHeight: `${nodeHeight}px`,
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedNode(node);
                                }}
                            >
                                <div className="flex items-start gap-3">
                                    <span className="text-3xl">{getNodeIcon(node.type)}</span>
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-neutral-900">
                                            {node.title}
                                        </h3>
                                        <Badge variant="outline" className="mt-1 text-xs">
                                            {node.type}
                                        </Badge>
                                        {node.description && (
                                            <p className="mt-2 line-clamp-3 text-xs text-neutral-600">
                                                {node.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Instructions */}
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-xs text-neutral-600">
                    <strong>💡 {t('tip.label')}</strong> {t('tip.description')}
                </p>
            </div>

            {/* Executions Section */}
            <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-neutral-800">
                            {t('executions.title')}
                        </h3>
                        <p className="text-sm text-neutral-600">
                            {t('executions.count', { count: executions?.total_elements ?? 0 })}
                        </p>
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex min-w-[240px] flex-col gap-1">
                        <Label htmlFor="startDateTime">{t('filters.startDateTime')}</Label>
                        <Input
                            id="startDateTime"
                            type="datetime-local"
                            value={startInput}
                            onChange={(e) => setStartInput(e.target.value)}
                        />
                    </div>
                    <div className="flex min-w-[240px] flex-col gap-1">
                        <Label htmlFor="endDateTime">{t('filters.endDateTime')}</Label>
                        <Input
                            id="endDateTime"
                            type="datetime-local"
                            value={endInput}
                            onChange={(e) => setEndInput(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="default"
                            onClick={() => {
                                // Convert inputs to ISO Z (GMT) preserving entered fields
                                const startIso = dateTimeLocalToIsoZ(startInput);
                                const endIso = dateTimeLocalToIsoZ(endInput);
                                setAppliedStart(startIso);
                                setAppliedEnd(endIso);
                                setPageNo(0);
                                void refetchExecutions();
                            }}
                        >
                            {t('filters.search')}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => {
                                const s = toInputValue(weekAgo);
                                const e = toInputValue(now);
                                setStartInput(s);
                                setEndInput(e);
                                setAppliedStart(dateTimeLocalToIsoZ(s));
                                setAppliedEnd(dateTimeLocalToIsoZ(e));
                                setPageNo(0);
                                void refetchExecutions();
                            }}
                        >
                            {t('filters.reset')}
                        </Button>
                    </div>
                </div>
                <p className="text-xs text-neutral-500">
                    {t('filters.timezoneNote')}
                </p>

                {/* Results */}
                <div className="rounded-md border border-neutral-200">
                    <div className="grid grid-cols-12 gap-2 border-b border-neutral-200 bg-neutral-50 p-2 text-xs font-medium text-neutral-600">
                        <div className="col-span-3">{t('table.started')}</div>
                        <div className="col-span-3">{t('table.completed')}</div>
                        <div className="col-span-2">{t('table.status')}</div>
                        <div className="col-span-4">{t('table.idempotencyKey')}</div>
                    </div>
                    {isExecLoading && (
                        <div className="p-4 text-sm text-neutral-500">{t('table.loading')}</div>
                    )}
                    {isExecError && (
                        <div className="p-4 text-sm text-red-600">
                            {execError instanceof Error
                                ? execError.message
                                : t('table.loadFailed')}
                        </div>
                    )}
                    {!isExecLoading && !isExecError && (executions?.content?.length ?? 0) === 0 && (
                        <div className="p-4 text-sm text-neutral-500">
                            {t('table.empty')}
                        </div>
                    )}
                    {!isExecLoading && !isExecError && (executions?.content?.length ?? 0) > 0 && (
                        <div className="divide-y divide-neutral-200">
                            {executions!.content.map((ex: WorkflowExecution) => (
                                <div key={ex.id} className="grid grid-cols-12 gap-2 p-3 text-sm">
                                    <div className="col-span-3 text-neutral-800">
                                        {ex.started_at
                                            ? formatISODateTimeReadable(ex.started_at)
                                            : '—'}
                                    </div>
                                    <div className="col-span-3 text-neutral-800">
                                        {ex.completed_at
                                            ? formatISODateTimeReadable(ex.completed_at)
                                            : '—'}
                                    </div>
                                    <div className="col-span-2">
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                'text-xs',
                                                ex.status === 'COMPLETED'
                                                    ? 'border-green-500 bg-green-50 text-green-700'
                                                    : ex.status === 'FAILED'
                                                      ? 'border-red-500 bg-red-50 text-red-700'
                                                      : 'border-neutral-400 bg-neutral-50 text-neutral-700'
                                            )}
                                        >
                                            {ex.status}
                                        </Badge>
                                    </div>
                                    <div className="col-span-4 break-words text-neutral-700">
                                        {ex.idempotency_key}
                                        {ex.error_message && (
                                            <div className="mt-1 text-xs text-red-600">
                                                {ex.error_message}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {executions && executions.total_pages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                        <span className="text-xs text-neutral-500">
                            {t('pagination.pageOf', {
                                page: executions.page_number + 1,
                                total: executions.total_pages,
                            })}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={executions.first || pageNo === 0}
                                onClick={() => setPageNo((p) => Math.max(0, p - 1))}
                            >
                                {t('pagination.previous')}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={executions.last}
                                onClick={() => setPageNo((p) => p + 1)}
                            >
                                {t('pagination.next')}
                            </Button>
                        </div>
                    </div>
                )}
            </div>

            {/* Node Details Modal */}
            <Dialog open={!!selectedNode} onOpenChange={() => setSelectedNode(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-3">
                            <span className="text-2xl">
                                {selectedNode && getNodeIcon(selectedNode.type)}
                            </span>
                            {selectedNode?.title}
                            {selectedNode && (
                                <Badge className={getNodeBadgeColor(selectedNode.type)}>
                                    {selectedNode.type}
                                </Badge>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    {selectedNode && (
                        <div className="space-y-4">
                            {selectedNode.description && (
                                <div>
                                    <span className="text-sm font-medium text-neutral-700">
                                        {t('nodeDetails.description')}
                                    </span>
                                    <p className="mt-1 text-sm text-neutral-600">
                                        {selectedNode.description}
                                    </p>
                                </div>
                            )}

                            {selectedNode.details &&
                                Object.keys(selectedNode.details).length > 0 && (
                                    <div>
                                        <span className="text-sm font-medium text-neutral-700">
                                            {t('nodeDetails.configuration')}
                                        </span>
                                        <div className="mt-2 max-h-96 space-y-2 overflow-auto rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                                            {Object.entries(selectedNode.details).map(
                                                ([key, value]) => (
                                                    <div key={key} className="space-y-1">
                                                        <p className="text-sm font-medium text-neutral-700">
                                                            {key}:
                                                        </p>
                                                        <DetailValue value={value} />
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

/**
 * Render one configuration detail. The values the diagram endpoint returns are already
 * human-readable, so raw JSON.stringify was actively unhelpful: a list of audience names
 * came out as `["JEE Leads"]` and a variable mapping as a brace-wrapped blob. Lists become
 * lines and key/value maps become rows; only genuinely unexpected shapes fall back to JSON.
 */
function DetailValue({ value }: { value: unknown }) {
    if (Array.isArray(value)) {
        return (
            <ul className="space-y-1 rounded bg-white p-2">
                {value.map((v, i) => (
                    <li key={i} className="text-xs text-neutral-700">
                        • {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </li>
                ))}
            </ul>
        );
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        return (
            <div className="divide-y divide-neutral-100 rounded bg-white">
                {entries.map(([k, v]) => (
                    <div key={k} className="flex gap-2 px-2 py-1.5 text-xs">
                        <span className="min-w-24 shrink-0 text-neutral-500">{k}</span>
                        <span className="break-all font-medium text-neutral-700">
                            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                        </span>
                    </div>
                ))}
            </div>
        );
    }
    return (
        <p className="break-words rounded bg-white p-2 text-xs text-neutral-700">{String(value)}</p>
    );
}
