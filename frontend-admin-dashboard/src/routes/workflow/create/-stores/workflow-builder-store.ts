import { create } from 'zustand';
import {
    Node,
    Edge,
    Connection,
    addEdge,
    applyNodeChanges,
    applyEdgeChanges,
    NodeChange,
    EdgeChange,
} from 'reactflow';
import { v4 as uuidv4 } from 'uuid';

export interface ScheduleConfig {
    scheduleType: 'CRON' | 'INTERVAL';
    cronExpression: string;
    intervalMinutes: number;
    timezone: string;
    startDate: string;
    endDate: string;
}

export interface TriggerConfig {
    eventName: string;
    description: string;
    eventAppliedType: string;
    eventId?: string;
    /** Multiple event IDs for multi-select scope */
    eventIds?: string[];
    /** Execution-dedup settings (backend IdempotencySettings shape) — carried through from AI drafts. */
    idempotencyGenerationSetting?: unknown;
}

export interface WorkflowBuilderState {
    nodes: Node[];
    edges: Edge[];
    selectedNodeId: string | null;
    /** Set when editing an existing workflow — drives in-place update (PUT) vs create (POST). */
    editingWorkflowId: string | null;
    /** The persisted status of the workflow being edited — preserved so Test Run doesn't downgrade it to DRAFT. */
    editingWorkflowStatus: string | null;
    workflowName: string;
    workflowDescription: string;
    workflowType: 'SCHEDULED' | 'EVENT_DRIVEN';
    scheduleConfig: ScheduleConfig;
    triggerConfig: TriggerConfig;
    isDirty: boolean;
    isSaving: boolean;
    setupComplete: boolean;

    // Actions
    setNodes: (nodes: Node[]) => void;
    setEdges: (edges: Edge[]) => void;
    onNodesChange: (changes: NodeChange[]) => void;
    onEdgesChange: (changes: EdgeChange[]) => void;
    onConnect: (connection: Connection) => void;
    /** Returns the new node's id. */
    addNode: (type: string, name: string, position?: { x: number; y: number }) => string;
    removeNode: (nodeId: string) => void;
    selectNode: (nodeId: string | null) => void;
    updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
    updateNodeName: (nodeId: string, name: string) => void;
    setWorkflowName: (name: string) => void;
    setWorkflowDescription: (description: string) => void;
    setEditingWorkflowId: (id: string | null) => void;
    setEditingWorkflowStatus: (status: string | null) => void;
    setWorkflowType: (type: 'SCHEDULED' | 'EVENT_DRIVEN') => void;
    setScheduleConfig: (config: Partial<ScheduleConfig>) => void;
    setTriggerConfig: (config: Partial<TriggerConfig>) => void;
    setIsSaving: (saving: boolean) => void;
    setSetupComplete: (complete: boolean) => void;
    reset: () => void;
}

const defaultSchedule: ScheduleConfig = {
    scheduleType: 'CRON',
    cronExpression: '0 0 9 * * ?',
    intervalMinutes: 60,
    timezone: 'Asia/Kolkata',
    startDate: '',
    endDate: '',
};

const defaultTrigger: TriggerConfig = {
    eventName: '',
    description: '',
    eventAppliedType: '',
};

const initialState = {
    nodes: [] as Node[],
    edges: [] as Edge[],
    selectedNodeId: null as string | null,
    editingWorkflowId: null as string | null,
    editingWorkflowStatus: null as string | null,
    workflowName: '',
    workflowDescription: '',
    workflowType: 'SCHEDULED' as const,
    scheduleConfig: { ...defaultSchedule },
    triggerConfig: { ...defaultTrigger },
    isDirty: false,
    isSaving: false,
    setupComplete: false,
};

export const useWorkflowBuilderStore = create<WorkflowBuilderState>((set, get) => ({
    ...initialState,

    setNodes: (nodes) => set({ nodes, isDirty: true }),
    setEdges: (edges) => set({ edges, isDirty: true }),

    onNodesChange: (changes) =>
        set((state) => ({
            nodes: applyNodeChanges(changes, state.nodes),
            isDirty: true,
        })),

    onEdgesChange: (changes) =>
        set((state) => ({
            edges: applyEdgeChanges(changes, state.edges),
            isDirty: true,
        })),

    onConnect: (connection) =>
        set((state) => ({
            edges: addEdge(
                {
                    ...connection,
                    id: `edge-${uuidv4()}`,
                    type: 'smoothstep',
                    animated: true,
                },
                state.edges
            ),
            isDirty: true,
        })),

    addNode: (type, name, position) => {
        const id = `node-${uuidv4()}`;
        const nodeCount = get().nodes.length;
        const newNode: Node = {
            id,
            type: 'workflowNode',
            position: position ?? {
                x: 250 + (nodeCount % 3) * 300,
                y: 100 + Math.floor(nodeCount / 3) * 200,
            },
            data: {
                name,
                nodeType: type,
                config: {},
                isStartNode: type === 'TRIGGER' && nodeCount === 0,
                isEndNode: false,
            },
        };
        set((state) => ({
            nodes: [...state.nodes, newNode],
            isDirty: true,
        }));
        return id;
    },

    removeNode: (nodeId) =>
        set((state) => ({
            nodes: state.nodes.filter((n) => n.id !== nodeId),
            edges: state.edges.filter(
                (e) => e.source !== nodeId && e.target !== nodeId
            ),
            selectedNodeId:
                state.selectedNodeId === nodeId ? null : state.selectedNodeId,
            isDirty: true,
        })),

    selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

    updateNodeConfig: (nodeId, config) =>
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === nodeId
                    ? { ...n, data: { ...n.data, config } }
                    : n
            ),
            isDirty: true,
        })),

    updateNodeName: (nodeId, name) =>
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === nodeId
                    ? { ...n, data: { ...n.data, name } }
                    : n
            ),
            isDirty: true,
        })),

    setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),
    setWorkflowDescription: (description) =>
        set({ workflowDescription: description, isDirty: true }),
    setEditingWorkflowId: (id) => set({ editingWorkflowId: id }),
    setEditingWorkflowStatus: (status) => set({ editingWorkflowStatus: status }),
    setWorkflowType: (type) => set({ workflowType: type, isDirty: true }),
    setScheduleConfig: (config) =>
        set((state) => ({ scheduleConfig: { ...state.scheduleConfig, ...config }, isDirty: true })),
    setTriggerConfig: (config) =>
        set((state) => ({ triggerConfig: { ...state.triggerConfig, ...config }, isDirty: true })),
    setIsSaving: (saving) => set({ isSaving: saving }),
    setSetupComplete: (complete) => set({ setupComplete: complete }),
    reset: () => set({ ...initialState, scheduleConfig: { ...defaultSchedule }, triggerConfig: { ...defaultTrigger } }),
}));
