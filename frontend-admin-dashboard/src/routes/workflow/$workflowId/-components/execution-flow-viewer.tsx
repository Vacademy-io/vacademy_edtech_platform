import { useMemo, useCallback } from 'react';
import ReactFlow, { Background, Controls, MiniMap, Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getExecutionLogsQuery, getWorkflowForEditing } from '@/services/workflow-service';
import { ExecutionFlowNode } from './execution-flow-node';
import { ExecutionTimeline } from './execution-timeline';
import { NodeLogPopover } from './node-log-popover';
import { useExecutionViewerStore } from '../-stores/execution-viewer-store';
import { WorkflowBuilderDTO } from '@/types/workflow/workflow-types';

const nodeTypes = { executionNode: ExecutionFlowNode };

/** Auto-layout nodes vertically when saved positions are all zero/missing */
function autoLayout(
    nodes: WorkflowBuilderDTO['nodes'],
    edges: WorkflowBuilderDTO['edges']
) {
    // Check if positions are meaningful (not all at 0,0)
    const hasPositions = nodes.some(
        (n) => (n.position_x != null && n.position_x !== 0) || (n.position_y != null && n.position_y !== 0)
    );
    if (hasPositions) return nodes;

    // Build adjacency: find root nodes (no incoming edges), then BFS layers
    const incomingMap = new Map<string, string[]>();
    const outgoingMap = new Map<string, string[]>();
    for (const e of edges ?? []) {
        if (!incomingMap.has(e.target_node_id)) incomingMap.set(e.target_node_id, []);
        incomingMap.get(e.target_node_id)!.push(e.source_node_id);
        if (!outgoingMap.has(e.source_node_id)) outgoingMap.set(e.source_node_id, []);
        outgoingMap.get(e.source_node_id)!.push(e.target_node_id);
    }

    const roots = nodes.filter((n) => !incomingMap.has(n.id) || incomingMap.get(n.id)!.length === 0);
    if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]!);

    // BFS to assign layers
    const layerMap = new Map<string, number>();
    const queue = roots.map((r) => ({ id: r.id, layer: 0 }));
    const visited = new Set<string>();

    while (queue.length > 0) {
        const { id, layer } = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        layerMap.set(id, layer);
        for (const child of outgoingMap.get(id) ?? []) {
            if (!visited.has(child)) {
                queue.push({ id: child, layer: layer + 1 });
            }
        }
    }

    // Assign unvisited nodes to their own layers
    for (const n of nodes) {
        if (!layerMap.has(n.id)) {
            layerMap.set(n.id, (layerMap.size > 0 ? Math.max(...layerMap.values()) + 1 : 0));
        }
    }

    // Group by layer, position within each layer
    const layers = new Map<number, string[]>();
    for (const [id, layer] of layerMap) {
        if (!layers.has(layer)) layers.set(layer, []);
        layers.get(layer)!.push(id);
    }

    const NODE_WIDTH = 220;
    const NODE_HEIGHT = 120;
    const posMap = new Map<string, { x: number; y: number }>();

    for (const [layer, ids] of layers) {
        const totalWidth = ids.length * NODE_WIDTH;
        const startX = -totalWidth / 2 + NODE_WIDTH / 2;
        ids.forEach((id, i) => {
            posMap.set(id, { x: startX + i * NODE_WIDTH, y: layer * NODE_HEIGHT });
        });
    }

    return nodes.map((n) => ({
        ...n,
        position_x: posMap.get(n.id)?.x ?? 0,
        position_y: posMap.get(n.id)?.y ?? 0,
    }));
}

interface Props {
    workflowId: string;
    executionId: string;
}

export function ExecutionFlowViewer({ workflowId, executionId }: Props) {
    const { t } = useTranslation('workflowExecutionFlowViewer');
    const { executionLogs, nodeStatusMap, selectedNodeId, setExecution, selectNode } =
        useExecutionViewerStore();

    // Fetch workflow graph
    const { data: workflowData } = useQuery({
        queryKey: ['WORKFLOW_EDIT', workflowId],
        queryFn: async () => {
            const resp = await getWorkflowForEditing(workflowId);
            return resp as WorkflowBuilderDTO;
        },
        staleTime: 300_000,
    });

    // Fetch execution logs
    const { data: logs } = useQuery({
        ...getExecutionLogsQuery(executionId),
        enabled: !!executionId,
    });

    // Update store when logs arrive
    useMemo(() => {
        if (logs && executionId) {
            setExecution(executionId, logs);
        }
    }, [logs, executionId, setExecution]);

    // Build ReactFlow nodes from workflow graph + execution status
    const { nodes, edges } = useMemo(() => {
        if (!workflowData?.nodes) return { nodes: [], edges: [] };

        // Auto-layout if positions are all 0/null
        const laidOutNodes = autoLayout(workflowData.nodes, workflowData.edges ?? []);

        const rfNodes: Node[] = laidOutNodes.map((n) => {
            const log = nodeStatusMap[n.id];
            return {
                id: n.id,
                type: 'executionNode',
                position: { x: n.position_x ?? 0, y: n.position_y ?? 0 },
                data: {
                    name: n.name,
                    nodeType: n.node_type,
                    executionStatus: log?.status ?? null,
                    executionTimeMs: log?.execution_time_ms ?? null,
                    hasError: !!log?.error_message,
                },
            };
        });

        const rfEdges: Edge[] = (workflowData.edges ?? []).map((e) => ({
            id: e.id,
            source: e.source_node_id,
            target: e.target_node_id,
            label: e.label ?? '',
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#94a3b8' },
        }));

        return { nodes: rfNodes, edges: rfEdges };
    }, [workflowData, nodeStatusMap]);

    const onNodeClick = useCallback(
        (_: React.MouseEvent, node: Node) => {
            selectNode(node.id === selectedNodeId ? null : node.id);
        },
        [selectNode, selectedNodeId]
    );

    const selectedLog = selectedNodeId ? nodeStatusMap[selectedNodeId] ?? null : null;

    if (!workflowData) {
        return <div className="flex items-center justify-center h-64 text-muted-foreground">{t('loadingWorkflow')}</div>;
    }

    return (
        <div className="space-y-3">
            <div className="flex gap-3" style={{ height: 450 }}>
                {/* ReactFlow canvas — takes remaining space */}
                <div className="relative flex-1 border rounded-lg overflow-hidden">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodeClick={onNodeClick}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        fitView
                        fitViewOptions={{ padding: 0.3 }}
                    >
                        <Background />
                        <Controls />
                        <MiniMap />
                    </ReactFlow>
                </div>

                {/* Side panel for selected node log — fixed width, scrollable */}
                {selectedLog && (
                    <div className="w-80 shrink-0">
                        <NodeLogPopover log={selectedLog} onClose={() => selectNode(null)} />
                    </div>
                )}
            </div>

            {/* Timeline */}
            {executionLogs.length > 0 && (
                <ExecutionTimeline
                    logs={executionLogs}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={selectNode}
                />
            )}
        </div>
    );
}
