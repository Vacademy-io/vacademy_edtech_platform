import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactFlow, {
    Background,
    Controls,
    MarkerType,
    MiniMap,
    ReactFlowProvider,
    addEdge,
    useEdgesState,
    useNodesState,
    type Connection,
    type Edge,
    type EdgeChange,
    type Node,
    type NodeChange,
    type NodeTypes,
    type OnConnectStartParams,
    type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Plus, Trash, PencilSimple, UsersThree, User, Info, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import {
    addTeamMember,
    createTeam,
    deleteTeam,
    fetchTeamChart,
    listTeams,
    removeTeamMember,
    updateTeam,
    updateTeamMember,
    type OrgChartNode,
    type OrgTeam,
} from '../-services/org-team-services';
import { fetchEligibleOrgUsers, type InstituteUser } from '../-services/institute-users-service';
import { AddPersonDialog } from './AddPersonDialog';
import { EditPersonDialog } from './EditPersonDialog';
import PersonFlowNode, { type PersonNodeData } from './PersonFlowNode';
import { layoutTopDown } from './org-chart-layout';

interface Props {
    instituteId: string;
}

const HINT_DISMISSED_KEY = 'org-chart-hint-dismissed';
const SIDEBAR_DRAG_MIME = 'application/x-vacademy-org-user';

const nodeTypes: NodeTypes = { person: PersonFlowNode };
const defaultEdgeOptions = {
    type: 'smoothstep' as const,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    style: { strokeWidth: 1.5 },
};

/**
 * Org Chart tab. Hybrid model:
 *   - flat list of teams (no sub-teams), selected via the top dropdown
 *   - inside each team, a user-to-user reporting tree via parent_user_id
 *
 * The canvas is a react-flow surface. Each person is a card with a top
 * (target) and bottom (source) handle. Users connect bottom→top to set
 * "reports to". Dropping a user from the left sidebar onto an empty area
 * adds them as a root; dropping onto a card adds them as that card's
 * report. Cards stay where they're placed; first paint uses dagre to
 * auto-arrange top-down.
 */
export function OrgChartCanvas({ instituteId }: Props) {
    return (
        <ReactFlowProvider>
            <Canvas instituteId={instituteId} />
        </ReactFlowProvider>
    );
}

function Canvas({ instituteId }: Props) {
    const { t } = useTranslation('manageInstituteOrgChartCanvas');
    const queryClient = useQueryClient();
    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [editingNode, setEditingNode] = useState<OrgChartNode | null>(null);
    const [newTeamOpen, setNewTeamOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);
    const [hintDismissed, setHintDismissed] = useState(false);
    const [sidebarSearch, setSidebarSearch] = useState('');

    // React-flow state.
    const [nodes, setNodes, onNodesChange] = useNodesState<PersonNodeData>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const flowWrapperRef = useRef<HTMLDivElement | null>(null);
    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

    useEffect(() => {
        setHintDismissed(localStorage.getItem(HINT_DISMISSED_KEY) === '1');
    }, []);

    const teamsQuery = useQuery({
        queryKey: ['org-teams', instituteId],
        enabled: !!instituteId,
        queryFn: () => listTeams(instituteId),
    });

    const usersQuery = useQuery({
        queryKey: ['eligible-org-users', instituteId],
        enabled: !!instituteId,
        queryFn: () => fetchEligibleOrgUsers(instituteId),
        staleTime: 60_000,
    });

    useEffect(() => {
        const teams = teamsQuery.data ?? [];
        if (teams.length === 0) {
            if (selectedTeamId !== null) setSelectedTeamId(null);
            return;
        }
        const firstTeam = teams[0];
        // `teams.length > 0` is guarded above so firstTeam IS defined; the
        // explicit truthy check keeps `noUncheckedIndexedAccess` happy.
        if (firstTeam && (!selectedTeamId || !teams.some((t) => t.id === selectedTeamId))) {
            setSelectedTeamId(firstTeam.id);
        }
    }, [teamsQuery.data, selectedTeamId]);

    const chartQuery = useQuery({
        queryKey: ['org-team-chart', selectedTeamId],
        enabled: !!selectedTeamId,
        queryFn: () => fetchTeamChart(selectedTeamId!),
    });

    const userById = useMemo(() => {
        const m = new Map<string, InstituteUser>();
        (usersQuery.data ?? []).forEach((u) => m.set(u.id, u));
        return m;
    }, [usersQuery.data]);

    const selectedTeam = (teamsQuery.data ?? []).find((t) => t.id === selectedTeamId) ?? null;

    // Flat lookup of every member in the current team (chart -> flat).
    const peopleByUserId = useMemo(() => {
        const out = new Map<string, OrgChartNode>();
        const walk = (n: OrgChartNode) => {
            out.set(n.user_id, n);
            n.children?.forEach(walk);
        };
        (chartQuery.data ?? []).forEach(walk);
        return out;
    }, [chartQuery.data]);

    const placedUserIdsInTeam = useMemo(
        () => new Set(peopleByUserId.keys()),
        [peopleByUserId]
    );

    // For the EditPersonDialog's "Reports to" picker.
    const peopleInTeam = useMemo(() => {
        const out: { mappingId: string; userId: string; name: string; depth: number }[] = [];
        const walk = (n: OrgChartNode, depth: number) => {
            const u = userById.get(n.user_id);
            out.push({
                mappingId: n.mapping_id,
                userId: n.user_id,
                name: u?.full_name || t('unnamedUser', { id: n.user_id.slice(0, 6) }),
                depth,
            });
            n.children?.forEach((c) => walk(c, depth + 1));
        };
        (chartQuery.data ?? []).forEach((n) => walk(n, 0));
        return out;
    }, [chartQuery.data, userById, t]);

    // ── Mutations ────────────────────────────────────────────────

    const moveMutation = useMutation({
        mutationFn: ({
            mappingId,
            parentUserId,
        }: {
            mappingId: string;
            parentUserId: string | null;
        }) =>
            updateTeamMember(selectedTeamId!, mappingId, {
                change_parent: true,
                parent_user_id: parentUserId,
            }),
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['org-team-chart', selectedTeamId] });
            const target = vars.parentUserId
                ? userById.get(vars.parentUserId)?.full_name ?? t('toast.thatManager')
                : t('toast.topOfTeam');
            toast.success(t('toast.movedUnder', { target }));
        },
        onError: (e) => {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.couldNotMove'));
            queryClient.invalidateQueries({ queryKey: ['org-team-chart', selectedTeamId] });
        },
    });

    const addMutation = useMutation({
        mutationFn: ({
            userId,
            parentUserId,
        }: {
            userId: string;
            parentUserId: string | null;
        }) =>
            addTeamMember(selectedTeamId!, {
                user_id: userId,
                parent_user_id: parentUserId,
            }),
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['org-team-chart', selectedTeamId] });
            queryClient.invalidateQueries({ queryKey: ['org-teams', instituteId] });
            const addedName = userById.get(vars.userId)?.full_name ?? t('toast.thisPerson');
            const target = vars.parentUserId
                ? userById.get(vars.parentUserId)?.full_name ?? t('toast.theirManager')
                : t('toast.topOfTeam');
            toast.success(t('toast.addedUnder', { name: addedName, target }));
        },
        onError: (e) => {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.couldNotAdd'));
        },
    });

    const removeMutation = useMutation({
        mutationFn: (mappingId: string) => removeTeamMember(selectedTeamId!, mappingId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['org-team-chart', selectedTeamId] });
            queryClient.invalidateQueries({ queryKey: ['org-teams', instituteId] });
            toast.success(t('toast.removedFromTeam'));
        },
        onError: () => toast.error(t('toast.couldNotRemove')),
    });

    const deleteTeamMutation = useMutation({
        mutationFn: (teamId: string) => deleteTeam(teamId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['org-teams', instituteId] });
            toast.success(t('toast.teamDeleted'));
        },
        onError: (e) => {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.couldNotDeleteTeam'));
        },
    });

    // ── Callbacks closing over latest mutation handles ───────────
    // These MUST be stable identities; otherwise the data-sync useEffect
    // below re-runs every render and rebuilds rfNodes with fresh dagre
    // positions, fighting react-flow's internal state and making just-added
    // cards flicker and vanish. Refs hold the latest values; the callbacks
    // are created once.

    const ctxRef = useRef({
        userById,
        selectedTeamName: selectedTeam?.name ?? t('toast.thisTeam'),
        removeMutate: removeMutation.mutate,
        t,
    });
    ctxRef.current = {
        userById,
        selectedTeamName: selectedTeam?.name ?? t('toast.thisTeam'),
        removeMutate: removeMutation.mutate,
        t,
    };

    const handleEdit = useCallback((n: OrgChartNode) => setEditingNode(n), []);
    const handleRemove = useCallback((n: OrgChartNode) => {
        const { userById: ub, selectedTeamName, removeMutate, t: tt } = ctxRef.current;
        const u = ub.get(n.user_id);
        const name = u?.full_name || tt('toast.thisPerson');
        if (
            window.confirm(
                tt('confirm.removePerson', { name, teamName: selectedTeamName })
            )
        ) {
            removeMutate(n.mapping_id);
        }
    }, []);

    // ── Sync chart data → react-flow nodes + edges ───────────────

    useEffect(() => {
        const chart = chartQuery.data;
        if (!chart || chart.length === 0) {
            setNodes([]);
            setEdges([]);
            return;
        }
        const allNodes: OrgChartNode[] = [];
        const walk = (n: OrgChartNode) => {
            allNodes.push(n);
            n.children?.forEach(walk);
        };
        chart.forEach(walk);

        const rfNodes: Node<PersonNodeData>[] = allNodes.map((n) => ({
            id: n.mapping_id,
            type: 'person',
            position: { x: 0, y: 0 },
            data: {
                node: n,
                user: userById.get(n.user_id),
                onEdit: handleEdit,
                onRemove: handleRemove,
            },
        }));

        const mappingByUserId = new Map<string, string>();
        allNodes.forEach((n) => mappingByUserId.set(n.user_id, n.mapping_id));

        const rfEdges: Edge[] = [];
        for (const n of allNodes) {
            if (!n.parent_user_id) continue;
            const sourceMappingId = mappingByUserId.get(n.parent_user_id);
            if (!sourceMappingId) continue;
            rfEdges.push({
                id: `e:${sourceMappingId}->${n.mapping_id}`,
                source: sourceMappingId,
                target: n.mapping_id,
                ...defaultEdgeOptions,
            });
        }

        setNodes(layoutTopDown(rfNodes, rfEdges));
        setEdges(rfEdges);
        // rfInstance can be null on the very first sync (before onInit). The
        // separate fit-view effect below handles that case.
    }, [chartQuery.data, userById, handleEdit, handleRemove, setNodes, setEdges]);

    // Fit the viewport whenever the node count goes from 0 → N (first paint
    // for this team) or whenever the team changes. Without this, the first
    // add after an empty team would leave the viewport on a position that
    // doesn't contain the new card.
    useEffect(() => {
        if (!rfInstance) return;
        if (nodes.length === 0) return;
        // Two frames: one for react-flow to commit the new nodes, one for
        // it to measure them so fitView lands accurately.
        const id = requestAnimationFrame(() => {
            requestAnimationFrame(() =>
                rfInstance.fitView({ padding: 0.15, duration: 200 })
            );
        });
        return () => cancelAnimationFrame(id);
    }, [rfInstance, nodes.length, selectedTeamId]);

    // ── React-flow event handlers ────────────────────────────────

    // Connect: bottom-of-A → top-of-B means "B reports to A".
    const onConnect = useCallback(
        (conn: Connection) => {
            if (!conn.source || !conn.target || conn.source === conn.target) return;
            const sourceNode = nodes.find((n) => n.id === conn.source);
            const targetNode = nodes.find((n) => n.id === conn.target);
            if (!sourceNode || !targetNode) return;
            const newParentUserId = sourceNode.data.node.user_id;
            moveMutation.mutate({ mappingId: conn.target, parentUserId: newParentUserId });
            // Optimistic: show the edge while the mutation is in flight; the
            // chart refetch on success or error will rewrite it from truth.
            setEdges((eds) => addEdge({ ...conn, ...defaultEdgeOptions }, eds));
        },
        [nodes, moveMutation, setEdges]
    );

    // Connection start on the SOURCE handle, dragged into empty space:
    // react-flow's "connect to nothing" fires onConnectEnd with no target.
    // We use it to surface a hint, but no mutation runs (no clear semantic).
    const connectStartRef = useRef<OnConnectStartParams | null>(null);
    const onConnectStart = useCallback(
        (_e: unknown, params: OnConnectStartParams) => {
            connectStartRef.current = params;
        },
        []
    );
    const onConnectEnd = useCallback(() => {
        connectStartRef.current = null;
    }, []);

    // Node removed via keyboard (Delete / Backspace on a selected card) =
    // "remove from team". Confirm once, then run the same mutation the
    // trash icon does. We don't propagate the visual remove to react-flow;
    // the chart refetch on success rebuilds nodes from data.
    const onNodesChangeIntercept = useCallback(
        (changes: NodeChange[]) => {
            const removals = changes.filter((c) => c.type === 'remove') as Array<{
                type: 'remove';
                id: string;
            }>;
            if (removals.length > 0) {
                const ctx = ctxRef.current;
                for (const r of removals) {
                    const n = rfInstance?.getNode(r.id);
                    const userId = (n?.data as PersonNodeData | undefined)?.node.user_id;
                    const personName =
                        (userId && ctx.userById.get(userId)?.full_name) || ctx.t('toast.thisPerson');
                    if (
                        window.confirm(
                            ctx.t('confirm.removePerson', {
                                name: personName,
                                teamName: ctx.selectedTeamName,
                            })
                        )
                    ) {
                        ctx.removeMutate(r.id);
                    }
                }
                const nonRemovals = changes.filter((c) => c.type !== 'remove');
                if (nonRemovals.length > 0) onNodesChange(nonRemovals);
                return;
            }
            onNodesChange(changes);
        },
        [onNodesChange, rfInstance]
    );

    // Edges removed = "person no longer reports to X". Set parent to null.
    const onEdgesChangeIntercept = useCallback(
        (changes: EdgeChange[]) => {
            const removals = changes.filter((c) => c.type === 'remove') as Array<{
                type: 'remove';
                id: string;
            }>;
            if (removals.length > 0) {
                for (const r of removals) {
                    const edge = edges.find((e) => e.id === r.id);
                    if (edge?.target) {
                        moveMutation.mutate({
                            mappingId: edge.target,
                            parentUserId: null,
                        });
                    }
                }
            }
            onEdgesChange(changes);
        },
        [edges, moveMutation, onEdgesChange]
    );

    // Sidebar drop: figure out where the user landed and dispatch.
    const onDrop = useCallback(
        (event: React.DragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const userId = event.dataTransfer.getData(SIDEBAR_DRAG_MIME);
            if (!userId) return;
            if (placedUserIdsInTeam.has(userId)) {
                toast.error(t('toast.alreadyInTeamError'));
                return;
            }
            // Find which (if any) react-flow node is under the cursor.
            const target = event.target as HTMLElement | null;
            const nodeEl = target?.closest('.react-flow__node');
            const targetMappingId = nodeEl?.getAttribute('data-id') ?? null;
            const parentUserId = targetMappingId
                ? nodes.find((n) => n.id === targetMappingId)?.data.node.user_id ?? null
                : null;
            addMutation.mutate({ userId, parentUserId });
        },
        [placedUserIdsInTeam, nodes, addMutation]
    );

    const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }, []);

    const isTeamLoading = teamsQuery.isLoading;
    const teams = teamsQuery.data ?? [];

    // ── First-time, empty institute ─────────────────────────────

    if (!isTeamLoading && teams.length === 0) {
        return (
            <>
                <NoTeamsHero onCreate={() => setNewTeamOpen(true)} />
                <NewTeamDialog
                    open={newTeamOpen}
                    onOpenChange={setNewTeamOpen}
                    instituteId={instituteId}
                    onCreated={(team) => {
                        // Optimistically write the new team into the cache
                        // BEFORE setSelectedTeamId, otherwise the auto-select
                        // useEffect sees the stale list, fails the
                        // teams.some(...) check, and snaps the selection
                        // back to teams[0] — the "have to create twice"
                        // bug. Background invalidate then refreshes
                        // member_count etc. from the server.
                        queryClient.setQueryData<OrgTeam[]>(
                            ['org-teams', instituteId],
                            (old) => (old ? [...old, team] : [team])
                        );
                        setSelectedTeamId(team.id);
                        queryClient.invalidateQueries({ queryKey: ['org-teams', instituteId] });
                    }}
                />
            </>
        );
    }

    return (
        <div className="flex h-full flex-col">
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2">
                <span className="text-caption font-medium text-neutral-500">{t('header.showingTeam')}</span>
                <select
                    className="min-w-44 rounded-md border border-neutral-300 px-3 py-1.5 text-body"
                    value={selectedTeamId ?? ''}
                    onChange={(e) => setSelectedTeamId(e.target.value || null)}
                >
                    {teams.map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.name} ({t.member_count})
                        </option>
                    ))}
                </select>

                {selectedTeam && (
                    <>
                        <button
                            type="button"
                            onClick={() => setRenameOpen(true)}
                            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-caption text-neutral-600 hover:bg-neutral-50 hover:text-neutral-800"
                            title={t('header.renameTooltip')}
                        >
                            <PencilSimple size={12} /> {t('header.rename')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (
                                    window.confirm(
                                        t('confirm.deleteTeam', {
                                            name: selectedTeam.name,
                                            count: selectedTeam.member_count,
                                        })
                                    )
                                ) {
                                    deleteTeamMutation.mutate(selectedTeam.id);
                                }
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-caption text-danger-600 hover:bg-danger-50"
                            title={t('header.deleteTeamTooltip')}
                        >
                            <Trash size={12} /> {t('header.deleteTeam')}
                        </button>
                    </>
                )}

                <div className="ml-auto flex items-center gap-2">
                    <MyButton buttonType="secondary" scale="small" onClick={() => setNewTeamOpen(true)}>
                        <Plus size={14} className="me-1" /> {t('header.newTeam')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        onClick={() => setAddOpen(true)}
                        disable={!selectedTeamId}
                    >
                        <Plus size={14} className="me-1" /> {t('header.addPerson')}
                    </MyButton>
                </div>
            </div>

            {/* ── Help banner (dismissible) ──────────────────────── */}
            {!hintDismissed && (
                <div className="flex items-start gap-2 border-b border-info-100 bg-primary-50 px-3 py-2 text-subtitle text-primary-800">
                    <Info size={16} className="mt-0.5 shrink-0 text-primary-600" />
                    <div className="flex-1">
                        {t('banner.help')}
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            localStorage.setItem(HINT_DISMISSED_KEY, '1');
                            setHintDismissed(true);
                        }}
                        className="rounded p-0.5 hover:bg-primary-100"
                        aria-label={t('banner.dismiss')}
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* ── Two-pane body: sidebar + react-flow canvas ─────── */}
            <div className="flex min-h-0 flex-1">
                {selectedTeamId && (
                    <UserSidebar
                        users={usersQuery.data ?? []}
                        placedUserIdsInTeam={placedUserIdsInTeam}
                        search={sidebarSearch}
                        onSearchChange={setSidebarSearch}
                        isLoading={usersQuery.isLoading}
                    />
                )}

                <div
                    ref={flowWrapperRef}
                    className="relative min-h-0 flex-1 bg-neutral-50"
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                >
                    {/* Always mount ReactFlow once a team is selected so it
                        doesn't lose its viewport state across the
                        empty → first-add transition. Overlays sit on top
                        when loading / errored / empty. */}
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChangeIntercept}
                        onEdgesChange={onEdgesChangeIntercept}
                        onConnect={onConnect}
                        onConnectStart={onConnectStart}
                        onConnectEnd={onConnectEnd}
                        nodeTypes={nodeTypes}
                        defaultEdgeOptions={defaultEdgeOptions}
                        onInit={setRfInstance}
                        fitView
                        fitViewOptions={{ padding: 0.15 }}
                        deleteKeyCode={['Backspace', 'Delete']}
                        connectionRadius={28}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background gap={20} size={1} />
                        <Controls showInteractive={false} />
                        <MiniMap
                            pannable
                            zoomable
                            ariaLabel={t('canvas.minimapLabel')}
                            nodeColor="hsl(var(--primary-400))"
                            nodeStrokeColor="hsl(var(--primary-600))"
                            maskColor="hsl(var(--neutral-200) / 0.6)"
                            className="!bottom-3 !right-3 rounded-md border border-neutral-200 shadow-sm"
                        />
                    </ReactFlow>

                    {chartQuery.isLoading && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-50/80 text-subtitle text-neutral-500">
                            {t('canvas.loadingTeam', { name: selectedTeam?.name ?? '' })}
                        </div>
                    )}
                    {chartQuery.isError && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-subtitle text-danger-600">
                            {t('canvas.loadError')}
                        </div>
                    )}
                    {!chartQuery.isLoading &&
                        !chartQuery.isError &&
                        (chartQuery.data ?? []).length === 0 && (
                            // pointer-events-none on the outer so that drag
                            // events pass through to the wrapper's onDrop /
                            // onDragOver below. Without this the overlay
                            // silently swallows the first drop on an empty
                            // team — the "have to drag twice" bug.
                            // The inner block re-enables pointer events so
                            // the "+ Add the first person" button still
                            // works.
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-50/80">
                                <div className="pointer-events-auto">
                                    <EmptyTeam
                                        teamName={selectedTeam?.name ?? t('toast.thisTeam')}
                                        onAdd={() => setAddOpen(true)}
                                    />
                                </div>
                            </div>
                        )}
                </div>
            </div>

            {/* ── Dialogs ────────────────────────────────────────── */}
            <NewTeamDialog
                open={newTeamOpen}
                onOpenChange={setNewTeamOpen}
                instituteId={instituteId}
                onCreated={(team) => {
                    queryClient.setQueryData<OrgTeam[]>(
                        ['org-teams', instituteId],
                        (old) => (old ? [...old, team] : [team])
                    );
                    setSelectedTeamId(team.id);
                    queryClient.invalidateQueries({ queryKey: ['org-teams', instituteId] });
                }}
            />
            {selectedTeam && (
                <RenameTeamDialog
                    open={renameOpen}
                    onOpenChange={setRenameOpen}
                    team={selectedTeam}
                    onRenamed={() => {
                        queryClient.invalidateQueries({ queryKey: ['org-teams', instituteId] });
                    }}
                />
            )}
            {selectedTeamId && (
                <AddPersonDialog
                    open={addOpen}
                    onOpenChange={setAddOpen}
                    teamId={selectedTeamId}
                    teamName={selectedTeam?.name ?? t('toast.thisTeam')}
                    eligibleUsers={(usersQuery.data ?? []).filter(
                        (u) => !placedUserIdsInTeam.has(u.id)
                    )}
                    peopleInTeam={peopleInTeam}
                    onAdded={() => {
                        queryClient.invalidateQueries({ queryKey: ['org-team-chart', selectedTeamId] });
                        queryClient.invalidateQueries({ queryKey: ['org-teams', instituteId] });
                    }}
                />
            )}
            {selectedTeamId && editingNode && (
                <EditPersonDialog
                    open={!!editingNode}
                    onOpenChange={(o) => {
                        if (!o) setEditingNode(null);
                    }}
                    teamId={selectedTeamId}
                    node={editingNode}
                    name={
                        userById.get(editingNode.user_id)?.full_name ||
                        t('unnamedUser', { id: editingNode.user_id.slice(0, 6) })
                    }
                    peopleInTeam={peopleInTeam}
                    onSaved={() => {
                        queryClient.invalidateQueries({ queryKey: ['org-team-chart', selectedTeamId] });
                    }}
                />
            )}
        </div>
    );
}

// ─── Left sidebar of all institute users (drag source) ─────────

function UserSidebar({
    users,
    placedUserIdsInTeam,
    search,
    onSearchChange,
    isLoading,
}: {
    users: InstituteUser[];
    placedUserIdsInTeam: Set<string>;
    search: string;
    onSearchChange: (s: string) => void;
    isLoading: boolean;
}) {
    const { t } = useTranslation('manageInstituteOrgChartCanvas');
    const q = search.trim().toLowerCase();
    const filtered = q
        ? users.filter(
              (u) =>
                  u.full_name.toLowerCase().includes(q) ||
                  (u.email ?? '').toLowerCase().includes(q)
          )
        : users;

    return (
        <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-200 bg-white">
            <div className="border-b border-neutral-100 p-3">
                <div className="mb-2 text-caption font-medium text-neutral-500">
                    {t('sidebar.heading')}
                </div>
                <input
                    className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-body"
                    placeholder={t('sidebar.searchPlaceholder')}
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
                {isLoading ? (
                    <div className="p-4 text-caption text-neutral-500">{t('sidebar.loadingUsers')}</div>
                ) : filtered.length === 0 ? (
                    <div className="p-4 text-caption text-neutral-500">
                        {users.length === 0
                            ? t('sidebar.noUsers')
                            : t('sidebar.noMatches')}
                    </div>
                ) : (
                    <ul className="divide-y divide-neutral-100">
                        {filtered.map((u) => {
                            const alreadyInTeam = placedUserIdsInTeam.has(u.id);
                            return (
                                <li
                                    key={u.id}
                                    draggable={!alreadyInTeam}
                                    onDragStart={(e) => {
                                        if (alreadyInTeam) {
                                            e.preventDefault();
                                            return;
                                        }
                                        e.dataTransfer.effectAllowed = 'copy';
                                        e.dataTransfer.setData(SIDEBAR_DRAG_MIME, u.id);
                                        // Also set text/plain so browsers
                                        // that demand it (Firefox) initiate.
                                        e.dataTransfer.setData('text/plain', u.id);
                                    }}
                                    className={cn(
                                        'flex items-center gap-2 px-3 py-2',
                                        alreadyInTeam
                                            ? 'cursor-not-allowed opacity-50'
                                            : 'cursor-grab hover:bg-primary-50 active:cursor-grabbing'
                                    )}
                                    title={
                                        alreadyInTeam
                                            ? t('sidebar.alreadyInTeamTooltip')
                                            : t('sidebar.dragToAddTooltip')
                                    }
                                >
                                    <SidebarAvatar name={u.full_name} />
                                    <div className="min-w-0 flex-1 leading-tight">
                                        <div className="truncate text-body font-medium text-neutral-900">
                                            {u.full_name || t('sidebar.unnamed')}
                                        </div>
                                        <div className="truncate text-caption text-neutral-500">
                                            {u.email ?? (u.roles ?? [])[0] ?? ''}
                                        </div>
                                    </div>
                                    {alreadyInTeam && (
                                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-caption text-neutral-500">
                                            {t('sidebar.alreadyInTeamBadge')}
                                        </span>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </aside>
    );
}

function SidebarAvatar({ name }: { name: string }) {
    const initial = (name || '?').trim().slice(0, 1).toUpperCase();
    return (
        <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-h4 font-semibold text-primary-700"
            aria-hidden="true"
        >
            {initial || <User size={16} />}
        </div>
    );
}

// ─── Empty states ───────────────────────────────────────────────

function NoTeamsHero({ onCreate }: { onCreate: () => void }) {
    const { t } = useTranslation('manageInstituteOrgChartCanvas');
    return (
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 p-12 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-primary-50">
                <UsersThree size={28} className="text-primary-600" />
            </div>
            <h2 className="text-h2 font-medium text-neutral-900">{t('emptyStates.noTeamsTitle')}</h2>
            <p className="max-w-md text-subtitle text-neutral-500">
                {t('emptyStates.noTeamsBody')}
            </p>
            <MyButton buttonType="primary" onClick={onCreate}>
                {t('emptyStates.newTeamCta')}
            </MyButton>
        </div>
    );
}

function EmptyTeam({ teamName, onAdd }: { teamName: string; onAdd: () => void }) {
    const { t } = useTranslation('manageInstituteOrgChartCanvas');
    return (
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary-50">
                <UsersThree size={22} className="text-primary-600" />
            </div>
            <h2 className="text-h3 font-medium text-neutral-900">{t('emptyStates.emptyTeamTitle', { teamName })}</h2>
            <p className="text-subtitle text-neutral-500">
                {t('emptyStates.emptyTeamBody')}
            </p>
            <MyButton buttonType="primary" onClick={onAdd}>
                {t('emptyStates.addFirstPersonCta')}
            </MyButton>
        </div>
    );
}

// ─── Light-weight inline dialogs (rename / new team) ────────────

function NewTeamDialog({
    open,
    onOpenChange,
    instituteId,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    instituteId: string;
    onCreated: (team: OrgTeam) => void;
}) {
    const { t } = useTranslation('manageInstituteOrgChartCanvas');
    const [name, setName] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            setName('');
            setSubmitting(false);
        }
    }, [open]);

    async function handleCreate() {
        if (!name.trim()) {
            toast.error(t('toast.giveTeamName'));
            return;
        }
        setSubmitting(true);
        try {
            const team = await createTeam({ institute_id: instituteId, name: name.trim() });
            toast.success(t('toast.teamCreated', { name: team.name }));
            onCreated(team);
            onOpenChange(false);
        } catch (e) {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.couldNotCreateTeam'));
        } finally {
            setSubmitting(false);
        }
    }

    if (!open) return null;
    return (
        <Modal title={t('dialogs.newTeam.title')} onClose={() => onOpenChange(false)}>
            <div className="space-y-3">
                <label className="block text-caption font-medium text-neutral-700">{t('dialogs.newTeam.label')}</label>
                <input
                    autoFocus
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body"
                    placeholder={t('dialogs.newTeam.placeholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                />
            </div>
            <div className="mt-4 flex justify-end gap-2">
                <MyButton buttonType="secondary" onClick={() => onOpenChange(false)} disable={submitting}>
                    {t('dialogs.newTeam.cancel')}
                </MyButton>
                <MyButton buttonType="primary" onClick={handleCreate} disable={submitting}>
                    {submitting ? t('dialogs.newTeam.creating') : t('dialogs.newTeam.create')}
                </MyButton>
            </div>
        </Modal>
    );
}

function RenameTeamDialog({
    open,
    onOpenChange,
    team,
    onRenamed,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    team: OrgTeam;
    onRenamed: () => void;
}) {
    const { t } = useTranslation('manageInstituteOrgChartCanvas');
    const [name, setName] = useState(team.name);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (open) {
            setName(team.name);
            setSubmitting(false);
        }
    }, [open, team]);

    async function handleSave() {
        if (!name.trim()) {
            toast.error(t('toast.giveTeamName'));
            return;
        }
        setSubmitting(true);
        try {
            await updateTeam(team.id, { name: name.trim() });
            toast.success(t('toast.renamed'));
            onRenamed();
            onOpenChange(false);
        } catch (e) {
            const msg = (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex;
            toast.error(msg ?? t('toast.couldNotRenameTeam'));
        } finally {
            setSubmitting(false);
        }
    }

    if (!open) return null;
    return (
        <Modal title={t('dialogs.renameTeam.title', { name: team.name })} onClose={() => onOpenChange(false)}>
            <div className="space-y-3">
                <label className="block text-caption font-medium text-neutral-700">{t('dialogs.renameTeam.label')}</label>
                <input
                    autoFocus
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                />
            </div>
            <div className="mt-4 flex justify-end gap-2">
                <MyButton buttonType="secondary" onClick={() => onOpenChange(false)} disable={submitting}>
                    {t('dialogs.renameTeam.cancel')}
                </MyButton>
                <MyButton buttonType="primary" onClick={handleSave} disable={submitting}>
                    {submitting ? t('dialogs.renameTeam.saving') : t('dialogs.renameTeam.save')}
                </MyButton>
            </div>
        </Modal>
    );
}

function Modal({
    title,
    onClose,
    children,
}: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const { t } = useTranslation('manageInstituteOrgChartCanvas');
    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-h3 font-medium text-neutral-900">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                        aria-label={t('dialogs.close')}
                    >
                        <X size={16} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
