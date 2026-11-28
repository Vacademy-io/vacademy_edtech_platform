import { create } from 'zustand';
import {
    Node,
    Edge,
    NodeChange,
    EdgeChange,
    Connection,
    applyNodeChanges,
    applyEdgeChanges,
    addEdge,
} from 'reactflow';
import { v4 as uuid } from 'uuid';
import {
    ChatbotFlowDTO,
    ChatbotFlowNodeDTO,
    ChatbotFlowEdgeDTO,
    ChatbotFlowSettings,
    ChatbotNodeType,
    CRM_LEAD_CHECK_BRANCHES,
    NODE_TYPE_REGISTRY,
} from '@/types/chatbot-flow/chatbot-flow-types';

interface ChatbotFlowBuilderState {
    // Flow metadata
    flowId: string | null;
    flowName: string;
    flowDescription: string;
    channelType: string;
    flowStatus: string;
    instituteId: string;
    /** Flow-level settings — notification emails for chatbot hand-overs live here. */
    flowSettings: ChatbotFlowSettings;

    // React Flow state
    nodes: Node[];
    edges: Edge[];
    selectedNodeId: string | null;

    // UI state
    isDirty: boolean;
    isSaving: boolean;

    // Actions
    setNodes: (nodes: Node[]) => void;
    setEdges: (edges: Edge[]) => void;
    onNodesChange: (changes: NodeChange[]) => void;
    onEdgesChange: (changes: EdgeChange[]) => void;
    onConnect: (connection: Connection) => void;
    addNode: (type: ChatbotNodeType, position?: { x: number; y: number }) => void;
    removeNode: (nodeId: string) => void;
    selectNode: (nodeId: string | null) => void;
    updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
    updateNodeName: (nodeId: string, name: string) => void;
    updateEdgeLabel: (edgeId: string, label: string, conditionConfig?: Record<string, unknown>) => void;

    // Flow metadata actions
    setFlowName: (name: string) => void;
    setFlowDescription: (desc: string) => void;
    setChannelType: (type: string) => void;
    setInstituteId: (id: string) => void;
    setFlowSettings: (settings: ChatbotFlowSettings) => void;

    // Persistence
    loadFlow: (dto: ChatbotFlowDTO) => void;
    toDTO: () => ChatbotFlowDTO;
    reset: () => void;
    setIsSaving: (saving: boolean) => void;
}

export const useChatbotFlowStore = create<ChatbotFlowBuilderState>((set, get) => ({
    flowId: null,
    flowName: 'New Flow',
    flowDescription: '',
    channelType: 'WHATSAPP_COMBOT',
    flowStatus: 'DRAFT',
    instituteId: '',
    flowSettings: {},
    nodes: [],
    edges: [],
    selectedNodeId: null,
    isDirty: false,
    isSaving: false,

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
        set((state) => {
            // If connecting from a CONDITION node's branch handle, auto-set branch label + conditionConfig
            let label: string | undefined;
            let conditionConfig: Record<string, unknown> | undefined;

            if (connection.sourceHandle && connection.sourceHandle.startsWith('branch_')) {
                const sourceNode = state.nodes.find((n) => n.id === connection.source);
                if (sourceNode?.data?.nodeType === 'CONDITION') {
                    const branches = (sourceNode.data.config?.branches as Array<{ id: string; label: string }>) || [];
                    const branch = branches.find((b) => b.id === connection.sourceHandle);
                    if (branch) {
                        label = branch.label || connection.sourceHandle;
                        conditionConfig = { branchId: branch.id };
                    }
                }
            } else if (connection.sourceHandle) {
                // CRM_LEAD_CHECK: fixed NEW / EXISTING outputs, same branchId contract as CONDITION
                const sourceNode = state.nodes.find((n) => n.id === connection.source);
                if (sourceNode?.data?.nodeType === 'CRM_LEAD_CHECK') {
                    const branch = CRM_LEAD_CHECK_BRANCHES.find(
                        (b) => b.id === connection.sourceHandle
                    );
                    if (branch) {
                        label = branch.label;
                        conditionConfig = { branchId: branch.id };
                    }
                }
            }

            return {
                edges: addEdge(
                    {
                        ...connection,
                        id: `edge-${uuid()}`,
                        type: 'chatbotEdge',
                        animated: true,
                        label,
                        data: conditionConfig ? { conditionConfig } : undefined,
                    },
                    state.edges
                ),
                isDirty: true,
            };
        }),

    addNode: (type, position) => {
        const info = NODE_TYPE_REGISTRY.find((n) => n.type === type);
        if (!info) return;

        const newNode: Node = {
            id: `node-${uuid()}`,
            type: 'chatbotNode',
            position: position || { x: 250, y: get().nodes.length * 150 + 50 },
            data: {
                nodeType: type,
                name: info.label,
                config: { ...info.defaultConfig },
                color: info.color,
                icon: info.icon,
            },
        };

        set((state) => ({
            nodes: [...state.nodes, newNode],
            isDirty: true,
        }));
    },

    removeNode: (nodeId) =>
        set((state) => ({
            nodes: state.nodes.filter((n) => n.id !== nodeId),
            edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
            selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
            isDirty: true,
        })),

    selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

    updateNodeConfig: (nodeId, config) =>
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, config } } : n
            ),
            isDirty: true,
        })),

    updateNodeName: (nodeId, name) =>
        set((state) => ({
            nodes: state.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, name } } : n
            ),
            isDirty: true,
        })),

    updateEdgeLabel: (edgeId, label, conditionConfig) =>
        set((state) => ({
            edges: state.edges.map((e) =>
                e.id === edgeId
                    ? {
                          ...e,
                          label: label || undefined,
                          data: {
                              ...e.data,
                              conditionConfig: conditionConfig || {
                                  ...(e.data?.conditionConfig || {}),
                                  branchId: label,
                                  label,
                              },
                          },
                      }
                    : e
            ),
            isDirty: true,
        })),

    setFlowName: (name) => set({ flowName: name, isDirty: true }),
    setFlowDescription: (desc) => set({ flowDescription: desc, isDirty: true }),
    setChannelType: (type) => set({ channelType: type, isDirty: true }),
    setInstituteId: (id) => set({ instituteId: id }),
    setFlowSettings: (settings) => set({ flowSettings: settings, isDirty: true }),
    setIsSaving: (saving) => set({ isSaving: saving }),

    loadFlow: (dto) => {
        const nodes: Node[] = (dto.nodes || []).map((n) => {
            const info = NODE_TYPE_REGISTRY.find((r) => r.type === n.nodeType);
            return {
                id: n.id,
                type: 'chatbotNode',
                position: { x: n.positionX, y: n.positionY },
                data: {
                    nodeType: n.nodeType,
                    name: n.name,
                    config: n.config || {},
                    color: info?.color || '#6b7280',
                    icon: info?.icon || '📦',
                },
            };
        });

        const edges: Edge[] = (dto.edges || []).map((e) => ({
            id: e.id,
            source: e.sourceNodeId,
            target: e.targetNodeId,
            // Restore sourceHandle from conditionConfig.branchId for CONDITION node branch handles
            sourceHandle: (e.conditionConfig as Record<string, unknown>)?.branchId as string || undefined,
            label: e.conditionLabel || undefined,
            data: { conditionConfig: e.conditionConfig },
            type: 'chatbotEdge',
            animated: true,
        }));

        set({
            flowId: dto.id || null,
            flowName: dto.name,
            flowDescription: dto.description || '',
            channelType: dto.channelType,
            flowStatus: dto.status,
            instituteId: dto.instituteId,
            flowSettings: dto.settings || {},
            nodes,
            edges,
            selectedNodeId: null,
            isDirty: false,
        });
    },

    toDTO: () => {
        const state = get();
        const nodes: ChatbotFlowNodeDTO[] = state.nodes.map((n) => ({
            id: n.id,
            nodeType: n.data.nodeType as ChatbotNodeType,
            name: n.data.name || n.data.nodeType,
            config: n.data.config || {},
            positionX: n.position.x,
            positionY: n.position.y,
        }));

        const edges: ChatbotFlowEdgeDTO[] = state.edges.map((e) => ({
            id: e.id,
            sourceNodeId: e.source,
            targetNodeId: e.target,
            conditionLabel: (e.label as string) || undefined,
            conditionConfig: e.sourceHandle
                ? { ...(e.data?.conditionConfig || {}), branchId: e.sourceHandle }
                : e.data?.conditionConfig,
            sortOrder: 0,
        }));

        return {
            id: state.flowId || undefined,
            instituteId: state.instituteId,
            name: state.flowName,
            description: state.flowDescription,
            channelType: state.channelType,
            status: state.flowStatus as ChatbotFlowDTO['status'],
            settings: state.flowSettings,
            nodes,
            edges,
        };
    },

    reset: () =>
        set({
            flowId: null,
            flowName: 'New Flow',
            flowDescription: '',
            channelType: 'WHATSAPP_COMBOT',
            flowStatus: 'DRAFT',
            flowSettings: {},
            nodes: [],
            edges: [],
            selectedNodeId: null,
            isDirty: false,
            isSaving: false,
        }),
}));
