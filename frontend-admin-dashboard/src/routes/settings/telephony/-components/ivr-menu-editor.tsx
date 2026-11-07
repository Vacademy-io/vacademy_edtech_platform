import { useEffect, useState, type ReactNode } from 'react';
import {
    Plus,
    Trash,
    ArrowRight,
    GearSix,
    GitBranch,
    GridNine,
    PhoneIncoming,
    PhoneTransfer,
    PhoneX,
    Robot,
    SpeakerHigh,
    Voicemail,
    type Icon,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDropdown } from '@/components/design-system/dropdown';
import { MyDialog } from '@/components/design-system/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { MultiSelect } from '@/components/design-system/multi-select';
import { useLeadCounsellorOptions } from '@/hooks/use-lead-counsellor-options';
import { useAiAgentOptions } from '@/hooks/use-ai-agent-options';
import { cn } from '@/lib/utils';
import {
    type IvrMenuDTO,
    type IvrNodeDTO,
    type IvrNodeType,
    IVR_NODE_TYPE_LABELS,
} from '../-services/ivr-admin';

interface IvrMenuEditorProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    /** The menu to edit, or null to create a new one. */
    initialMenu: IvrMenuDTO | null;
    onSave: (menu: IvrMenuDTO) => void;
    saving: boolean;
}

const NODE_TYPE_OPTIONS: { label: string; value: IvrNodeType }[] = (
    Object.keys(IVR_NODE_TYPE_LABELS) as IvrNodeType[]
).map((t) => ({ label: IVR_NODE_TYPE_LABELS[t], value: t }));

const PROMPT_LABEL: Record<IvrNodeType, string> = {
    PLAY: 'Message to play',
    GATHER: 'Menu prompt (e.g. “Press 1 for sales, 2 for support”)',
    DIAL: 'Message before connecting (optional)',
    VOICEMAIL: 'Voicemail greeting',
    HANGUP: 'Goodbye message (optional)',
    AI_AGENT: 'Message before the AI assistant joins (optional)',
};

/** Icon shown in each step header and in the Call flow preview. */
const NODE_TYPE_ICON: Record<IvrNodeType, Icon> = {
    PLAY: SpeakerHigh,
    GATHER: GridNine,
    DIAL: PhoneTransfer,
    VOICEMAIL: Voicemail,
    HANGUP: PhoneX,
    AI_AGENT: Robot,
};

function blankMenu(instituteId: string): IvrMenuDTO {
    return {
        id: null,
        instituteId,
        name: '',
        dialedNumber: '',
        rootNodeId: null,
        enabled: true,
        nodes: [],
    };
}

function newNode(type: IvrNodeType): IvrNodeDTO {
    return {
        id: crypto.randomUUID(),
        nodeType: type,
        label: '',
        promptText: '',
        promptAudioId: null,
        digitMap: {},
        dialTargets: [],
        nextNodeId: null,
        timeoutSeconds: 6,
        maxRetries: 2,
    };
}

function nodeDisplay(node: IvrNodeDTO, index: number): string {
    const name = node.label?.trim() || IVR_NODE_TYPE_LABELS[node.nodeType];
    return `${index + 1}. ${name}`;
}

export function IvrMenuEditor({
    open,
    onOpenChange,
    instituteId,
    initialMenu,
    onSave,
    saving,
}: IvrMenuEditorProps) {
    const [draft, setDraft] = useState<IvrMenuDTO>(() => blankMenu(instituteId));

    // Reset the working copy whenever the dialog opens (new vs edit).
    useEffect(() => {
        if (open) {
            setDraft(
                initialMenu
                    ? JSON.parse(JSON.stringify(initialMenu))
                    : blankMenu(instituteId)
            );
        }
    }, [open, initialMenu, instituteId]);

    // Routing CONFIG picker — assignable mode so an ADMIN who also holds the
    // COUNSELLOR role can route IVR keys to any counsellor, not just their hierarchy.
    const { options: counsellorRaw } = useLeadCounsellorOptions({ assignable: true });
    const counsellorOptions = counsellorRaw.map((c) => ({ label: c.full_name, value: c.id }));

    const { agents } = useAiAgentOptions();
    const agentOptions = agents.map((a) => ({ label: a.name, value: a.id }));
    const agentNameFor = (id?: string | null): string =>
        agents.find((a) => a.id === id)?.name ?? '';

    const nodes = draft.nodes;
    const refOptions = nodes.map((n, i) => ({ label: nodeDisplay(n, i), value: n.id }));
    const displayFor = (id?: string | null): string => {
        const idx = nodes.findIndex((n) => n.id === id);
        return idx >= 0 ? nodeDisplay(nodes[idx]!, idx) : '';
    };

    const patchNode = (id: string, patch: Partial<IvrNodeDTO>) =>
        setDraft((d) => ({
            ...d,
            nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        }));

    const addNode = (type: IvrNodeType) =>
        setDraft((d) => {
            const node = newNode(type);
            return {
                ...d,
                nodes: [...d.nodes, node],
                rootNodeId: d.rootNodeId ?? node.id,
            };
        });

    const removeNode = (id: string) =>
        setDraft((d) => {
            const remaining = d.nodes.filter((n) => n.id !== id);
            return {
                ...d,
                rootNodeId:
                    d.rootNodeId === id ? (remaining[0]?.id ?? null) : d.rootNodeId,
                nodes: remaining.map((n) => ({
                    ...n,
                    nextNodeId: n.nextNodeId === id ? null : n.nextNodeId,
                    digitMap: Object.fromEntries(
                        Object.entries(n.digitMap ?? {}).filter(([, t]) => t !== id)
                    ),
                })),
            };
        });

    const setGatherOption = (
        node: IvrNodeDTO,
        oldDigit: string,
        digit: string,
        target: string
    ) => {
        const next: Record<string, string> = {};
        for (const [d, t] of Object.entries(node.digitMap ?? {})) {
            if (d === oldDigit) continue;
            next[d] = t;
        }
        if (digit.trim()) next[digit.trim()] = target;
        patchNode(node.id, { digitMap: next });
    };

    const handleSave = () => {
        if (!draft.name.trim()) {
            toast.error('Give the menu a name');
            return;
        }
        if (draft.nodes.length === 0) {
            toast.error('Add at least one step');
            return;
        }
        if (!draft.rootNodeId) {
            toast.error('Pick the step the call starts at');
            return;
        }
        if (draft.nodes.some((n) => n.nodeType === 'AI_AGENT' && !n.aiAgentId)) {
            toast.error('Pick an AI agent for the “Talk to AI agent” step');
            return;
        }
        const cleaned: IvrMenuDTO = {
            ...draft,
            name: draft.name.trim(),
            dialedNumber: draft.dialedNumber?.trim() ? draft.dialedNumber.trim() : null,
            nodes: draft.nodes.map((n) => ({
                ...n,
                label: n.label?.trim() || null,
                promptText: n.promptText?.trim() || null,
                dialTargets: (n.dialTargets ?? []).map((s) => s.trim()).filter(Boolean),
                digitMap: Object.fromEntries(
                    Object.entries(n.digitMap ?? {}).filter(([d, t]) => d.trim() && t)
                ),
            })),
        };
        onSave(cleaned);
    };

    return (
        <MyDialog
            heading={initialMenu ? 'Edit IVR menu' : 'New IVR menu'}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-6xl"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={handleSave}
                        disable={saving}
                    >
                        {saving ? 'Saving…' : 'Save menu'}
                    </MyButton>
                </>
            }
        >
            <div className="grid gap-6 lg:grid-cols-5">
                <div className="flex min-w-0 flex-col gap-5 lg:col-span-3">
                    {/* Menu-level fields */}
                    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4">
                        <h3 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
                            <GearSix className="text-primary-500" />
                            Menu
                        </h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <MyInput
                                label="Menu name"
                                inputType="text"
                                required
                                inputPlaceholder="e.g. Main reception"
                                input={draft.name}
                                onChangeFunction={(e) =>
                                    setDraft((d) => ({ ...d, name: e.target.value }))
                                }
                                className="sm:w-full"
                            />
                            <MyInput
                                label="Phone number (optional)"
                                inputType="text"
                                inputPlaceholder="Leave blank for default"
                                input={draft.dialedNumber ?? ''}
                                onChangeFunction={(e) =>
                                    setDraft((d) => ({ ...d, dialedNumber: e.target.value }))
                                }
                                className="sm:w-full"
                            />
                        </div>

                        <p className="text-caption text-neutral-500">
                            Numbers that aren’t set to a specific menu use the menu left blank (your
                            default).
                        </p>

                        {/* Start step */}
                        {nodes.length > 0 && (
                            <div className="flex flex-col gap-1">
                                <Label className="text-subtitle font-regular">Call starts at</Label>
                                <MyDropdown
                                    placeholder="Pick the first step"
                                    currentValue={displayFor(draft.rootNodeId)}
                                    dropdownList={refOptions}
                                    handleChange={(v) => setDraft((d) => ({ ...d, rootNodeId: v }))}
                                    className="w-full sm:w-64"
                                />
                            </div>
                        )}

                        <div className="flex items-center gap-3">
                            <Switch
                                id="ivr-menu-enabled"
                                checked={draft.enabled ?? true}
                                onCheckedChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
                            />
                            <Label
                                htmlFor="ivr-menu-enabled"
                                className="cursor-pointer text-subtitle font-regular"
                            >
                                Enabled
                            </Label>
                        </div>
                    </section>

                    {/* Steps */}
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="text-subtitle font-semibold text-neutral-700">Steps</h3>
                            <MyDropdown
                                placeholder="Add step"
                                currentValue=""
                                dropdownList={NODE_TYPE_OPTIONS}
                                handleChange={(v) => addNode(v as IvrNodeType)}
                                className="w-40"
                            />
                        </div>

                        {nodes.length === 0 && (
                            <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-body text-neutral-500">
                                No steps yet. Add a step (e.g. a Menu that asks the caller to press
                                1 or 2) to start building your call flow.
                            </div>
                        )}

                        {nodes.map((node, index) => {
                            const TypeIcon = NODE_TYPE_ICON[node.nodeType];
                            const isStart = draft.rootNodeId === node.id;
                            return (
                                <div
                                    key={node.id}
                                    className={cn(
                                        'flex flex-col gap-3 rounded-lg border p-4',
                                        isStart
                                            ? 'border-primary-300 bg-primary-50'
                                            : 'border-neutral-200'
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-100 text-primary-500">
                                                <TypeIcon className="size-4" />
                                            </span>
                                            <span className="truncate text-subtitle font-semibold text-neutral-700">
                                                Step {index + 1}
                                                {node.label?.trim()
                                                    ? ` · ${node.label.trim()}`
                                                    : ''}
                                            </span>
                                            {isStart && (
                                                <span className="shrink-0 rounded-sm bg-primary-100 px-2 py-0.5 text-caption font-semibold text-primary-500">
                                                    start
                                                </span>
                                            )}
                                        </div>
                                        <MyButton
                                            buttonType="secondary"
                                            layoutVariant="icon"
                                            scale="small"
                                            onClick={() => removeNode(node.id)}
                                            aria-label={`Remove step ${index + 1}`}
                                        >
                                            <Trash className="text-danger-600" />
                                        </MyButton>
                                    </div>

                                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                                        <div className="flex flex-col gap-1">
                                            <Label className="text-subtitle font-regular">
                                                Type
                                            </Label>
                                            <MyDropdown
                                                currentValue={IVR_NODE_TYPE_LABELS[node.nodeType]}
                                                dropdownList={NODE_TYPE_OPTIONS}
                                                handleChange={(v) =>
                                                    patchNode(node.id, {
                                                        nodeType: v as IvrNodeType,
                                                    })
                                                }
                                                className="w-56"
                                            />
                                        </div>
                                        <MyInput
                                            label="Label (optional)"
                                            inputType="text"
                                            inputPlaceholder="e.g. Sales option"
                                            input={node.label ?? ''}
                                            onChangeFunction={(e) =>
                                                patchNode(node.id, { label: e.target.value })
                                            }
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1">
                                        <Label className="text-subtitle font-regular">
                                            {PROMPT_LABEL[node.nodeType]}
                                        </Label>
                                        <Textarea
                                            value={node.promptText ?? ''}
                                            onChange={(e) =>
                                                patchNode(node.id, { promptText: e.target.value })
                                            }
                                            placeholder="What the caller hears…"
                                            className="min-h-16"
                                        />
                                    </div>

                                    {/* GATHER: digit → step routing */}
                                    {node.nodeType === 'GATHER' && (
                                        <div className="flex flex-col gap-2">
                                            <Label className="text-subtitle font-regular">
                                                Key presses
                                            </Label>
                                            {Object.entries(node.digitMap ?? {}).map(
                                                ([digit, target]) => (
                                                    <div
                                                        key={digit}
                                                        className="flex items-center gap-2"
                                                    >
                                                        <span className="text-body text-neutral-500">
                                                            Press
                                                        </span>
                                                        <MyInput
                                                            inputType="text"
                                                            input={digit}
                                                            inputPlaceholder="1"
                                                            onChangeFunction={(e) =>
                                                                setGatherOption(
                                                                    node,
                                                                    digit,
                                                                    e.target.value
                                                                        .replace(/[^0-9*#]/g, '')
                                                                        .slice(0, 1),
                                                                    target
                                                                )
                                                            }
                                                            className="!w-16"
                                                        />
                                                        <ArrowRight className="shrink-0 text-neutral-400" />
                                                        <MyDropdown
                                                            placeholder="Go to step"
                                                            currentValue={displayFor(target)}
                                                            dropdownList={refOptions.filter(
                                                                (o) => o.value !== node.id
                                                            )}
                                                            handleChange={(v) =>
                                                                setGatherOption(
                                                                    node,
                                                                    digit,
                                                                    digit,
                                                                    v
                                                                )
                                                            }
                                                            className="w-56"
                                                        />
                                                        <MyButton
                                                            buttonType="secondary"
                                                            layoutVariant="icon"
                                                            scale="small"
                                                            onClick={() => {
                                                                const next = {
                                                                    ...(node.digitMap ?? {}),
                                                                };
                                                                delete next[digit];
                                                                patchNode(node.id, {
                                                                    digitMap: next,
                                                                });
                                                            }}
                                                        >
                                                            <Trash className="text-neutral-400" />
                                                        </MyButton>
                                                    </div>
                                                )
                                            )}
                                            <MyButton
                                                buttonType="text"
                                                scale="small"
                                                onClick={() => {
                                                    const used = new Set(
                                                        Object.keys(node.digitMap ?? {})
                                                    );
                                                    const free =
                                                        [
                                                            '1',
                                                            '2',
                                                            '3',
                                                            '4',
                                                            '5',
                                                            '6',
                                                            '7',
                                                            '8',
                                                            '9',
                                                            '0',
                                                        ].find((d) => !used.has(d)) ?? '';
                                                    patchNode(node.id, {
                                                        digitMap: {
                                                            ...(node.digitMap ?? {}),
                                                            [free]: '',
                                                        },
                                                    });
                                                }}
                                            >
                                                <Plus className="mr-1" /> Add key press
                                            </MyButton>
                                        </div>
                                    )}

                                    {/* DIAL: numbers to ring */}
                                    {node.nodeType === 'DIAL' && (
                                        <div className="flex flex-col gap-2">
                                            <Label className="text-subtitle font-regular">
                                                Numbers to ring
                                            </Label>
                                            {(node.dialTargets ?? []).map((num, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <MyInput
                                                        inputType="text"
                                                        input={num}
                                                        inputPlaceholder="+9198XXXXXXXX"
                                                        onChangeFunction={(e) => {
                                                            const next = [
                                                                ...(node.dialTargets ?? []),
                                                            ];
                                                            next[i] = e.target.value;
                                                            patchNode(node.id, {
                                                                dialTargets: next,
                                                            });
                                                        }}
                                                    />
                                                    <MyButton
                                                        buttonType="secondary"
                                                        layoutVariant="icon"
                                                        scale="small"
                                                        onClick={() => {
                                                            const next = [
                                                                ...(node.dialTargets ?? []),
                                                            ];
                                                            next.splice(i, 1);
                                                            patchNode(node.id, {
                                                                dialTargets: next,
                                                            });
                                                        }}
                                                    >
                                                        <Trash className="text-neutral-400" />
                                                    </MyButton>
                                                </div>
                                            ))}
                                            <MyButton
                                                buttonType="text"
                                                scale="small"
                                                onClick={() =>
                                                    patchNode(node.id, {
                                                        dialTargets: [
                                                            ...(node.dialTargets ?? []),
                                                            '',
                                                        ],
                                                    })
                                                }
                                            >
                                                <Plus className="mr-1" /> Add number
                                            </MyButton>

                                            <Label className="text-subtitle font-regular">
                                                Or ring team members
                                            </Label>
                                            <MultiSelect
                                                options={counsellorOptions}
                                                selected={node.dialUserIds ?? []}
                                                onChange={(ids) =>
                                                    patchNode(node.id, { dialUserIds: ids })
                                                }
                                                placeholder="Pick team members to ring"
                                            />

                                            <Label className="text-subtitle font-regular">
                                                Ring for (seconds)
                                            </Label>
                                            <MyInput
                                                inputType="text"
                                                input={
                                                    node.timeoutSeconds != null
                                                        ? String(node.timeoutSeconds)
                                                        : ''
                                                }
                                                inputPlaceholder="30"
                                                onChangeFunction={(e) => {
                                                    const digits = e.target.value.replace(
                                                        /[^0-9]/g,
                                                        ''
                                                    );
                                                    patchNode(node.id, {
                                                        timeoutSeconds: digits
                                                            ? parseInt(digits, 10)
                                                            : null,
                                                    });
                                                }}
                                                className="w-32"
                                            />

                                            <Label className="text-subtitle font-regular">
                                                If no one answers, go to
                                            </Label>
                                            <MyDropdown
                                                placeholder="Next step (another number, or voicemail)"
                                                currentValue={displayFor(node.nextNodeId)}
                                                dropdownList={refOptions.filter(
                                                    (o) => o.value !== node.id
                                                )}
                                                handleChange={(v) =>
                                                    patchNode(node.id, { nextNodeId: v })
                                                }
                                                className="w-64"
                                            />
                                            <p className="text-caption text-neutral-500">
                                                The numbers above ring together. If nobody picks up
                                                within the ring time, the call goes to this step —
                                                point it at another Dial step to try the next
                                                person, or a Voicemail step to take a message.
                                            </p>
                                        </div>
                                    )}

                                    {/* AI_AGENT: which agent takes the call */}
                                    {node.nodeType === 'AI_AGENT' && (
                                        <div className="flex flex-col gap-1">
                                            <Label className="text-subtitle font-regular">
                                                AI agent
                                            </Label>
                                            <MyDropdown
                                                placeholder={
                                                    agentOptions.length
                                                        ? 'Pick the AI agent'
                                                        : 'No AI agents yet — create one in AI Calling settings'
                                                }
                                                currentValue={agentNameFor(node.aiAgentId)}
                                                dropdownList={agentOptions}
                                                handleChange={(v) =>
                                                    patchNode(node.id, { aiAgentId: v })
                                                }
                                                className="w-64"
                                            />
                                            <p className="text-caption text-neutral-500">
                                                The caller talks to this AI assistant. If the caller
                                                asks for a person, the call is transferred to the
                                                agent’s handoff number.
                                            </p>
                                        </div>
                                    )}

                                    {/* PLAY: where to go next */}
                                    {node.nodeType === 'PLAY' && (
                                        <div className="flex flex-col gap-1">
                                            <Label className="text-subtitle font-regular">
                                                After the message, go to
                                            </Label>
                                            <MyDropdown
                                                placeholder="Next step (or hang up)"
                                                currentValue={displayFor(node.nextNodeId)}
                                                dropdownList={refOptions.filter(
                                                    (o) => o.value !== node.id
                                                )}
                                                handleChange={(v) =>
                                                    patchNode(node.id, { nextNodeId: v })
                                                }
                                                className="w-64"
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Live preview of the tree, derived from the draft only */}
                <aside className="min-w-0 lg:sticky lg:top-0 lg:col-span-2 lg:self-start">
                    <IvrFlowPreview menu={draft} agentNameFor={agentNameFor} />
                </aside>
            </div>
        </MyDialog>
    );
}

/** One box in the Call flow preview. */
function FlowNode({
    icon: NodeIcon,
    title,
    subtitle,
    highlight,
}: {
    icon: Icon;
    title: string;
    subtitle: string;
    highlight?: boolean;
}) {
    return (
        <div
            className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2',
                highlight ? 'border-primary-300 bg-primary-50' : 'border-neutral-200 bg-white'
            )}
        >
            <NodeIcon className="mt-0.5 size-4 shrink-0 text-primary-500" />
            <div className="flex min-w-0 flex-col">
                <span className="truncate text-body font-semibold text-neutral-800">{title}</span>
                <span className="text-caption text-neutral-500">{subtitle}</span>
            </div>
        </div>
    );
}

/**
 * Read-only tree of the menu being edited: "Call comes in" → the start step →
 * one branch per key press (Menu) or per next step (Play / Connect). Derived
 * purely from the in-memory draft on every render — nothing is fetched or
 * saved here. A step already drawn is shown once and referenced after that,
 * which also stops loops (step 3 → step 1) from recursing forever.
 */
function IvrFlowPreview({
    menu,
    agentNameFor,
}: {
    menu: IvrMenuDTO;
    agentNameFor: (id?: string | null) => string;
}) {
    const nodes = menu.nodes;
    const indexById = new Map(nodes.map((n, i) => [n.id, i]));
    const drawn = new Set<string>();

    const subtitleFor = (node: IvrNodeDTO): string => {
        const type = IVR_NODE_TYPE_LABELS[node.nodeType];
        if (node.nodeType === 'GATHER') {
            const keys = Object.keys(node.digitMap ?? {}).length;
            return `${type} · ${keys} ${keys === 1 ? 'key' : 'keys'}`;
        }
        if (node.nodeType === 'AI_AGENT') {
            const agent = agentNameFor(node.aiAgentId);
            return agent ? `${type} · ${agent}` : type;
        }
        if (node.nodeType === 'DIAL' && node.timeoutSeconds != null) {
            return `${type} · rings ${node.timeoutSeconds}s`;
        }
        return type;
    };

    const renderBranch = (key: string, edge: string, targetId?: string | null): ReactNode => {
        const index = targetId ? indexById.get(targetId) : undefined;
        const target = index !== undefined ? nodes[index] : undefined;
        return (
            <li key={key} className="flex flex-col gap-1.5">
                <span className="text-caption font-semibold text-neutral-500">{edge}</span>
                {target && index !== undefined ? (
                    renderNode(target, index)
                ) : (
                    <span className="text-caption text-neutral-400">Pick a step</span>
                )}
            </li>
        );
    };

    const renderNode = (node: IvrNodeDTO, index: number): ReactNode => {
        const title = nodeDisplay(node, index);
        if (drawn.has(node.id)) {
            return (
                <span className="flex items-center gap-1 text-caption text-neutral-500">
                    <ArrowRight className="size-3 shrink-0" />
                    Goes to {title} (shown above)
                </span>
            );
        }
        drawn.add(node.id);

        const branches: ReactNode[] = [];
        if (node.nodeType === 'GATHER') {
            Object.entries(node.digitMap ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .forEach(([digit, target]) =>
                    branches.push(renderBranch(`key-${digit}`, `Press ${digit}`, target))
                );
        } else if (node.nodeType === 'DIAL' && node.nextNodeId) {
            branches.push(renderBranch('next', 'If no one answers', node.nextNodeId));
        } else if (node.nodeType === 'PLAY' && node.nextNodeId) {
            branches.push(renderBranch('next', 'Then', node.nextNodeId));
        }

        return (
            <div className="flex flex-col gap-2">
                <FlowNode
                    icon={NODE_TYPE_ICON[node.nodeType]}
                    title={title}
                    subtitle={subtitleFor(node)}
                    highlight={node.id === menu.rootNodeId}
                />
                {branches.length > 0 && (
                    <ul className="ml-2 flex flex-col gap-3 border-l-2 border-neutral-200 pl-4">
                        {branches}
                    </ul>
                )}
            </div>
        );
    };

    const rootIndex = menu.rootNodeId ? indexById.get(menu.rootNodeId) : undefined;
    const rootNode = rootIndex !== undefined ? nodes[rootIndex] : undefined;
    const tree = rootNode && rootIndex !== undefined ? renderNode(rootNode, rootIndex) : null;
    // Counted after the tree is built, so `drawn` holds every reachable step.
    const unreached = nodes.filter((n) => !drawn.has(n.id)).length;

    return (
        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center gap-2">
                <GitBranch className="text-primary-500" />
                <h3 className="text-subtitle font-semibold text-neutral-700">Call flow</h3>
                <span className="text-caption text-neutral-400">updates as you edit</span>
            </div>

            {nodes.length === 0 ? (
                <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-center">
                    <GitBranch className="size-6 text-neutral-400" />
                    <span className="text-body font-semibold text-neutral-600">
                        Your flow appears here
                    </span>
                    <span className="text-caption text-neutral-500">
                        Add the first step on the left.
                    </span>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <FlowNode
                        icon={PhoneIncoming}
                        title="Call comes in"
                        subtitle={
                            menu.dialedNumber?.trim()
                                ? menu.dialedNumber.trim()
                                : 'Any number without its own menu'
                        }
                    />
                    <div className="ml-4 h-3 border-l-2 border-neutral-200" />
                    {tree ?? (
                        <span className="text-caption text-neutral-500">
                            Pick the step the call starts at.
                        </span>
                    )}
                    {unreached > 0 && (
                        <p className="mt-2 text-caption text-warning-600">
                            {unreached} {unreached === 1 ? 'step isn’t' : 'steps aren’t'} reached
                            from the start yet.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
