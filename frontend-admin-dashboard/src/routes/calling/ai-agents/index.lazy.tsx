/**
 * CRM → Calling → AI Agents.
 *
 * The home for the institute's Vacademy AI personas: what exists today, what
 * each one sounds like, and the create/edit flow. Saving here also registers the
 * agent as a campaign server-side, so workflows and the IVR can pick it by name.
 */
import { AiAgentsEnhancedHeader } from './-components/AiAgentsEnhancedHeader';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowsClockwise,
    CaretDown,
    Copy,
    FlowArrow,
    GearSix,
    MagnifyingGlass,
    PencilSimple,
    Play,
    Plus,
    Robot,
    Sparkle,
    SpinnerGap,
    Stop,
    Trash,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { AiAgentEditorDialog } from './-components/ai-agent-editor-dialog';
import { UseCaseGallery } from './-components/use-case-gallery';
import { UseCaseWizardDialog } from './-components/use-case-wizard-dialog';
import type { AgentUseCase } from './-constants/use-cases';
import {
    blankAgent,
    deleteAgent,
    fetchAgents,
    voicePreviewUrl,
    DEFAULT_SAMPLE_TEXT,
    type AiAgent,
} from './-services/ai-agents';

export const Route = createLazyFileRoute('/calling/ai-agents/')({
    component: AiAgentsPage,
});

type StatusFilter = 'ALL' | 'ENABLED' | 'DISABLED';
type DirectionFilter = 'ALL' | 'OUTBOUND' | 'INBOUND' | 'BOTH';

const DIRECTION_LABEL: Record<string, string> = {
    OUTBOUND: 'Outbound',
    INBOUND: 'Inbound',
    BOTH: 'Inbound + outbound',
};

/**
 * First readable sentence of a prompt. Real prompts are markdown — headings,
 * rules, bold, code fences — which renders as literal "#" and "____" noise in a
 * one-line preview, so strip the syntax and take the first prose we find.
 */
function promptPreview(text?: string): string {
    if (!text) return '';
    for (const rawLine of text.split('\n')) {
        const line = rawLine
            .replace(/^\s*#{1,6}\s*/, '') // headings
            .replace(/^\s*[-*+]\s+/, '') // bullets
            .replace(/^\s*\d+[.)]\s+/, '') // numbered list
            .replace(/^\s*>\s?/, '') // quotes
            .replace(/[*_`]+/g, '') // emphasis / code
            .replace(/^[-=_—\s]+$/, '') // rules and dividers
            .trim();
        if (line.length > 2) return line;
    }
    return '';
}

function AgentCard({
    agent,
    onEdit,
    onDuplicate,
    onDelete,
    isPreviewing,
    previewLoading,
    onTogglePreview,
}: {
    agent: AiAgent;
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    isPreviewing: boolean;
    previewLoading: boolean;
    onTogglePreview: () => void;
}) {
    const enabled = agent.enabled !== false;
    const direction = agent.direction ?? 'OUTBOUND';
    const preview =
        agent.openingLine?.trim() ||
        promptPreview(agent.systemPrompt) ||
        'No opening line yet — this agent will fall back to the platform default.';
    return (
        <Card className="flex flex-col gap-3 rounded-xl border-neutral-200 p-4 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-start justify-between gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                    <Robot size={16} weight="duotone" />
                </span>
                <p className="min-w-0 flex-1 truncate text-subtitle font-semibold text-neutral-700">
                    {agent.name || 'Untitled agent'}
                </p>
                <StatusChip
                    text={enabled ? 'Active' : 'Disabled'}
                    textSize="text-caption"
                    status={enabled ? 'SUCCESS' : 'INFO'}
                    showIcon={false}
                />
            </div>

            {/* Meta wraps instead of truncating — "voice shubh · max 6 min" was
                the half that always got cut off, and it is the useful half. */}
            <p className="text-caption text-neutral-500">
                {DIRECTION_LABEL[direction] ?? direction} · {agent.language ?? 'hinglish'} · voice{' '}
                {agent.voice ?? 'priya'}
                {agent.maxCallMinutes ? ` · max ${agent.maxCallMinutes} min` : ''}
            </p>

            <p className="line-clamp-2 min-h-8 rounded-lg bg-neutral-50 px-3 py-2 text-body text-neutral-600">
                {preview}
            </p>

            <div className="flex flex-wrap items-center gap-1.5">
                {(agent.extractionQuestions ?? []).length > 0 && (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption text-neutral-600">
                        {agent.extractionQuestions?.length} question
                        {agent.extractionQuestions?.length === 1 ? '' : 's'}
                    </span>
                )}
                {(agent.handoffNumbers ?? []).length > 0 && (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption text-neutral-600">
                        handoff ready
                    </span>
                )}
                {agent.bookingPageId && (
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-caption text-neutral-600">
                        auto-books meetings
                    </span>
                )}
            </div>

            {/* MyButton's medium scale carries sm:min-w-36, so four of them
                overflow a grid card. The two text actions flex down to fit and
                the two destructive-ish ones become fixed 36px icon buttons. */}
            <div className="mt-auto flex items-center gap-2 border-t border-neutral-100 pt-3">
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    className="min-w-0 flex-1 gap-1 px-2 sm:!min-w-0"
                    disable={previewLoading}
                    onClick={onTogglePreview}
                >
                    {previewLoading ? (
                        <SpinnerGap className="size-4 shrink-0 animate-spin" />
                    ) : isPreviewing ? (
                        <Stop className="size-4 shrink-0" />
                    ) : (
                        <Play className="size-4 shrink-0" />
                    )}
                    <span className="truncate">{isPreviewing ? 'Stop' : 'Hear voice'}</span>
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    className="min-w-0 flex-1 gap-1 px-2 sm:!min-w-0"
                    onClick={onEdit}
                >
                    <PencilSimple className="size-4 shrink-0" />
                    <span className="truncate">Edit</span>
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="medium"
                    className="shrink-0"
                    onClick={onDuplicate}
                    aria-label={`Duplicate ${agent.name}`}
                >
                    <Copy className="size-4" />
                </MyButton>
                <MyButton
                    buttonType="secondary"
                    layoutVariant="icon"
                    scale="medium"
                    className="shrink-0"
                    onClick={onDelete}
                    aria-label={`Delete ${agent.name}`}
                >
                    <Trash className="size-4 text-danger-600" />
                </MyButton>
            </div>
        </Card>
    );
}

function AiAgentsPage() {
    const instituteId = getCurrentInstituteId() ?? '';
    const queryClient = useQueryClient();
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading('AI Agents');
    }, [setNavHeading]);

    const agentsQuery = useQuery({
        queryKey: ['ai-agents', instituteId],
        queryFn: () => fetchAgents(instituteId),
        enabled: !!instituteId,
    });

    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<StatusFilter>('ALL');
    const [direction, setDirection] = useState<DirectionFilter>('ALL');
    const [editing, setEditing] = useState<AiAgent | null>(null);
    const [pendingDelete, setPendingDelete] = useState<AiAgent | null>(null);
    // Use-case flow: pick a template → answer a few questions → the wizard hands
    // back a populated draft, which opens in the normal editor for review.
    const [pickedUseCase, setPickedUseCase] = useState<AgentUseCase | null>(null);
    const [galleryOpen, setGalleryOpen] = useState(false);

    // One preview at a time, keyed by agent id (blank id = never previewed).
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const stopPreview = () => {
        audioRef.current?.pause();
        audioRef.current = null;
        setPreviewId(null);
        setPreviewState('idle');
    };

    // Never leave a sample playing after the page unmounts.
    useEffect(() => () => audioRef.current?.pause(), []);

    const togglePreview = (agent: AiAgent) => {
        if (previewId === agent.id) {
            stopPreview();
            return;
        }
        stopPreview();
        const audio = new Audio(voicePreviewUrl(agent, agent.openingLine || DEFAULT_SAMPLE_TEXT));
        audioRef.current = audio;
        setPreviewId(agent.id ?? null);
        setPreviewState('loading');
        audio.onplaying = () => setPreviewState('playing');
        audio.onended = stopPreview;
        audio.onerror = () => {
            stopPreview();
            toast.error('Could not synthesize the sample — try again in a moment');
        };
        void audio.play().catch(() => {
            stopPreview();
            toast.error('Could not play the sample');
        });
    };

    const deleteMutation = useMutation({
        mutationFn: (agentId: string) => deleteAgent(agentId, instituteId),
        onSuccess: () => {
            toast.success('Agent deleted');
            setPendingDelete(null);
            queryClient.invalidateQueries({ queryKey: ['ai-agents', instituteId] });
            queryClient.invalidateQueries({
                queryKey: ['ai-calling-campaign-options', instituteId],
            });
        },
        onError: () => toast.error('Failed to delete agent'),
    });

    const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return agents.filter((a) => {
            if (status === 'ENABLED' && a.enabled === false) return false;
            if (status === 'DISABLED' && a.enabled !== false) return false;
            if (direction !== 'ALL' && (a.direction ?? 'OUTBOUND') !== direction) return false;
            if (!q) return true;
            return [a.name, a.openingLine, a.systemPrompt, a.voice, a.language]
                .filter(Boolean)
                .some((v) => (v as string).toLowerCase().includes(q));
        });
    }, [agents, search, status, direction]);

    const activeCount = agents.filter((a) => a.enabled !== false).length;

    const openNew = () => setEditing(blankAgent(instituteId));
    const openEdit = (a: AiAgent) => setEditing({ ...blankAgent(instituteId), ...a });
    // Duplicating drops the id so the save creates a fresh registry row.
    const openDuplicate = (a: AiAgent) =>
        setEditing({ ...blankAgent(instituteId), ...a, id: undefined, name: `${a.name} (copy)` });

    return (
        <LayoutContainer>
            <Helmet>
                <title>AI Agents</title>
            </Helmet>
            <div className="flex flex-col gap-5 p-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                            <Robot size={20} weight="duotone" />
                        </span>
                        <div>
                            <h1 className="text-h3 font-semibold text-neutral-900">AI Agents</h1>
                            <p className="max-w-2xl text-body text-neutral-500">
                                The personas our AI caller speaks with — prompt, opening line,
                                language, voice and what each call should find out. Every saved
                                agent is available to workflows, campaigns and the IVR.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Link to="/settings" search={{ selectedTab: 'aiCalling' }}>
                            <MyButton buttonType="secondary" scale="medium">
                                <GearSix className="mr-1 size-4" /> AI calling settings
                            </MyButton>
                        </Link>
                        {agents.length > 0 && (
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setGalleryOpen(true)}
                            >
                                <Sparkle className="mr-1 size-4" /> From a use case
                            </MyButton>
                        )}
                        <MyButton buttonType="primary" scale="medium" onClick={openNew}>
                            <Plus className="mr-1 size-4" /> New agent
                        </MyButton>
                    </div>
                </div>

                {/* Summary header. */}
                <AiAgentsEnhancedHeader total={agents.length} active={activeCount} />

                {!agentsQuery.isLoading && !agentsQuery.isError && agents.length > 0 && (
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="relative w-full sm:w-72">
                            <MagnifyingGlass className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                            <Input
                                value={search}
                                placeholder="Search agents, prompts, voices…"
                                className="pl-9"
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
                            <SelectTrigger className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All statuses</SelectItem>
                                <SelectItem value="ENABLED">Active</SelectItem>
                                <SelectItem value="DISABLED">Disabled</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select
                            value={direction}
                            onValueChange={(v) => setDirection(v as DirectionFilter)}
                        >
                            <SelectTrigger className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">All directions</SelectItem>
                                <SelectItem value="OUTBOUND">Outbound</SelectItem>
                                <SelectItem value="INBOUND">Inbound</SelectItem>
                                <SelectItem value="BOTH">Both</SelectItem>
                            </SelectContent>
                        </Select>
                        <span className="text-caption text-neutral-500">
                            {visible.length} of {agents.length} · {activeCount} active
                        </span>
                    </div>
                )}

                {agentsQuery.isLoading && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {[0, 1, 2].map((i) => (
                            <Skeleton key={i} className="h-48 w-full rounded-lg" />
                        ))}
                    </div>
                )}

                {agentsQuery.isError && (
                    <Card className="flex flex-col items-center gap-3 p-8 text-center">
                        <p className="text-body text-danger-600">Could not load AI agents.</p>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => agentsQuery.refetch()}
                        >
                            <ArrowsClockwise className="mr-1 size-4" /> Try again
                        </MyButton>
                    </Card>
                )}

                {/* No agents yet: the gallery IS the empty state — picking a use
                    case is a far better first step than a blank prompt box. */}
                {!agentsQuery.isLoading && !agentsQuery.isError && agents.length === 0 && (
                    <div className="flex flex-col gap-4">
                        <Card className="flex flex-col items-center gap-2 p-8 text-center">
                            <Robot className="size-10 text-neutral-300" />
                            <p className="text-subtitle font-medium text-neutral-600">
                                No agents yet
                            </p>
                            <p className="max-w-lg text-body text-neutral-500">
                                Start from one of the use cases below, or build one from scratch if
                                you already know exactly what you want it to say.
                            </p>
                            <MyButton buttonType="secondary" scale="medium" onClick={openNew}>
                                <Plus className="mr-1 size-4" /> Start from scratch
                            </MyButton>
                        </Card>
                        <UseCaseGallery onPick={setPickedUseCase} />
                    </div>
                )}

                {!agentsQuery.isLoading && agents.length > 0 && visible.length === 0 && (
                    <Card className="p-8 text-center text-body text-neutral-500">
                        No agents match these filters.
                    </Card>
                )}

                {visible.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {visible.map((a) => (
                            <AgentCard
                                key={a.id ?? a.name}
                                agent={a}
                                onEdit={() => openEdit(a)}
                                onDuplicate={() => openDuplicate(a)}
                                onDelete={() => setPendingDelete(a)}
                                isPreviewing={previewId === a.id && previewState === 'playing'}
                                previewLoading={previewId === a.id && previewState === 'loading'}
                                onTogglePreview={() => togglePreview(a)}
                            />
                        ))}
                    </div>
                )}

                {/* With agents already set up the gallery stays out of the way,
                    one click from adding the next kind of agent. */}
                {!agentsQuery.isLoading && !agentsQuery.isError && agents.length > 0 && (
                    <Collapsible open={galleryOpen} onOpenChange={setGalleryOpen}>
                        <CollapsibleTrigger asChild>
                            <button
                                type="button"
                                className="flex w-full items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
                            >
                                <Sparkle className="size-4 text-primary-500" />
                                <span className="text-body font-medium text-neutral-700">
                                    Add an agent from a use case
                                </span>
                                <span className="hidden text-caption text-neutral-500 sm:inline">
                                    doubt solving · mentoring · parent updates · admissions · fees
                                </span>
                                <CaretDown
                                    className={cn(
                                        'ml-auto size-4 text-neutral-400 transition-transform',
                                        galleryOpen && 'rotate-180'
                                    )}
                                />
                            </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-4">
                            <UseCaseGallery onPick={setPickedUseCase} title="" subtitle="" />
                        </CollapsibleContent>
                    </Collapsible>
                )}

                {/* Where saved agents are used — reference only. */}
                {!agentsQuery.isLoading && !agentsQuery.isError && agents.length > 0 && (
                    <Card className="flex flex-col gap-3 rounded-xl border-neutral-200 p-4 shadow-sm">
                        <div className="flex items-center gap-2">
                            <FlowArrow size={16} className="text-neutral-500" />
                            <h3 className="text-subtitle font-semibold text-neutral-800">
                                Use an agent in a workflow
                            </h3>
                        </div>
                        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body text-neutral-600">
                            <li>
                                The workflow &ldquo;AI call&rdquo; step, bulk AI calls and the IVR
                                &ldquo;Talk to AI agent&rdquo; step pick agents from this page by
                                name.
                            </li>
                            <li>Disabled agents stay saved but cannot be picked.</li>
                            <li>
                                The call result comes back to the workflow as{' '}
                                <code className="rounded bg-neutral-100 px-1 text-caption">
                                    callOutcome
                                </code>
                                ,{' '}
                                <code className="rounded bg-neutral-100 px-1 text-caption">
                                    callDisposition
                                </code>{' '}
                                and{' '}
                                <code className="rounded bg-neutral-100 px-1 text-caption">
                                    callAnswers
                                </code>{' '}
                                for the next steps.
                            </li>
                        </ul>
                    </Card>
                )}
            </div>

            <UseCaseWizardDialog
                useCase={pickedUseCase}
                open={!!pickedUseCase}
                onOpenChange={(open) => !open && setPickedUseCase(null)}
                onDrafted={(draft) => {
                    setPickedUseCase(null);
                    setEditing(draft);
                }}
            />

            <AiAgentEditorDialog
                agent={editing}
                open={!!editing}
                onOpenChange={(open) => !open && setEditing(null)}
            />

            <AlertDialog
                open={!!pendingDelete}
                onOpenChange={(open) => !open && setPendingDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The agent is removed from the registry and from the campaigns list, so
                            any workflow or IVR step still pointing at it will stop working. This
                            can&apos;t be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteMutation.isPending}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-700"
                            disabled={deleteMutation.isPending}
                            onClick={(e) => {
                                e.preventDefault();
                                if (pendingDelete?.id) deleteMutation.mutate(pendingDelete.id);
                            }}
                        >
                            {deleteMutation.isPending ? 'Deleting…' : 'Delete agent'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </LayoutContainer>
    );
}
