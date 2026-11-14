import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Sparkle,
    Check,
    CheckCircle,
    PaperPlaneRight,
    Robot,
    User as UserIcon,
    CircleNotch,
    SidebarSimple,
    PencilSimple,
    Stop,
    Clock,
    WarningCircle,
    UsersThree,
} from '@phosphor-icons/react';
import type { StageRow } from './-utils/stage-rows';
import { cn } from '@/lib/utils';
import { AIContentPlayer } from '@/components/ai-video-player/AIContentPlayer';
import type {
    AssistTurn,
    DecisionAnswer,
    DecisionRequest,
} from '../../-services/video-generation';
import { buildGateMeta, gateTitle } from './-utils/decision-copy';
import { NarrationDecision } from './gates/NarrationDecision';
import { ShotPlanDecision } from './gates/ShotPlanDecision';
import { VisualCastingDecision } from './gates/VisualCastingDecision';
import { CreativeConceptDecision } from './gates/CreativeConceptDecision';
import { ContactSheetDecision } from './gates/ContactSheetDecision';
import { AssetRequestDecision } from './gates/AssetRequestDecision';
import { CastDecision } from './gates/CastDecision';
import { DailiesDecision } from './gates/DailiesDecision';
import { StyleframeDecision } from './gates/StyleframeDecision';

interface AssistChatProps {
    /** The original prompt — rendered as the opening user message. */
    prompt: string;
    /** The decision currently awaiting the user, or null between gates / in Auto mode. */
    pending: DecisionRequest | null;
    /** Resolved turns, oldest → newest. */
    transcript: AssistTurn[];
    /** True while the next leg is opening (disables cards). */
    isSubmitting?: boolean;
    /** Latest status line ("Filming shot 3/8…") shown as a live agent bubble. */
    statusMessage?: string;
    /** Live pipeline progress (drives the status bubble's bar + counter). */
    percentage?: number;
    shotsCompleted?: number;
    shotsTotal?: number;
    /** Production-schedule rows (same as the diagram) shown live in the chat. */
    stages?: StageRow[];
    /** True when the video is rendered — shows the completion card + player. */
    isComplete?: boolean;
    /** Completion player inputs. */
    timelineUrl?: string;
    audioUrl?: string;
    wordsUrl?: string;
    orientation?: 'landscape' | 'portrait';
    onSubmit: (answer: DecisionAnswer) => void;
    /** Opens the production-diagram drawer (optional detail view). */
    onShowProgress?: () => void;
    /** Stops an in-flight generation. */
    onAbort?: () => void;
    /** Opens the full editor for the finished video. */
    onEdit?: () => void;
    /** Institute API key — used by the visual-casting card's stock re-search. */
    apiKey?: string;
    vimMode?: boolean;
    /** Post-completion conversational editor: "redo shot 3 — bigger headline". */
    onPostEdit?: (text: string) => void;
    /** Save this video's dialogue cast for reuse (storybook/drama runs only). */
    onSaveCast?: () => void;
    postEdits?: PostEditItem[];
    /** Bumped after a post-edit lands — reloads the completion player. */
    playerReloadKey?: number;
}

/** One post-completion edit exchange (user request → agent outcome). */
export interface PostEditItem {
    id: string;
    request: string;
    reply: string;
    busy?: boolean;
}

function Bubble({ side, children }: { side: 'agent' | 'user'; children: ReactNode }) {
    const isAgent = side === 'agent';
    return (
        <div className={cn('flex gap-2.5', isAgent ? 'justify-start' : 'justify-end')}>
            {isAgent && (
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
                    <Robot className="size-4 text-violet-600" />
                </span>
            )}
            <div
                className={cn(
                    'max-w-md rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                    isAgent
                        ? 'rounded-tl-sm bg-muted text-foreground'
                        : 'rounded-tr-sm bg-violet-600 text-white'
                )}
            >
                {children}
            </div>
            {!isAgent && (
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-600/10">
                    <UserIcon className="size-4 text-violet-600" />
                </span>
            )}
        </div>
    );
}

/** One production-schedule row in the live status bubble. */
function StageLine({ row }: { row: StageRow }) {
    const icon =
        row.state === 'wrapped' ? (
            <CheckCircle weight="fill" className="size-3.5 shrink-0 text-emerald-600" />
        ) : row.state === 'in_production' ? (
            <CircleNotch className="size-3.5 shrink-0 animate-spin text-violet-600" />
        ) : row.state === 'cut' || row.state === 'reshoot' ? (
            <WarningCircle
                weight="fill"
                className={cn('size-3.5 shrink-0', row.state === 'cut' ? 'text-rose-600' : 'text-amber-600')}
            />
        ) : (
            <Clock className="size-3.5 shrink-0 text-muted-foreground/40" />
        );
    return (
        <li className="flex items-center gap-2">
            {icon}
            <span className={row.state === 'scheduled' ? 'text-muted-foreground' : 'text-foreground'}>
                {row.label}
            </span>
            {row.detail && (
                <span className="ml-auto tabular-nums text-muted-foreground">{row.detail}</span>
            )}
        </li>
    );
}

/** Live "we're working on it" bubble: sub-status + production schedule + bar. */
function StatusBubble({
    message,
    percentage,
    shotsCompleted,
    shotsTotal,
    stages,
}: {
    message?: string;
    percentage?: number;
    shotsCompleted?: number;
    shotsTotal?: number;
    stages?: StageRow[];
}) {
    const { t } = useTranslation('videoApiStudioAssistChat');
    const pct = Math.max(0, Math.min(100, Math.round(percentage ?? 0)));
    return (
        <div className="flex gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
                <Robot className="size-4 text-violet-600" />
            </span>
            <div className="w-full max-w-md rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                    <CircleNotch className="size-4 shrink-0 animate-spin text-violet-600" />
                    <span className="truncate">{message || t('statusBubble.workingOnIt')}</span>
                </div>

                {stages && stages.length > 0 && (
                    <ul className="mt-2.5 space-y-1.5 border-t pt-2.5 text-xs">
                        {stages.map((row) => (
                            <StageLine key={row.id} row={row} />
                        ))}
                    </ul>
                )}

                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-violet-100 dark:bg-violet-900/30">
                    {/* Dynamic width — sanctioned inline style for a live value. */}
                    <div
                        className="h-full rounded-full bg-violet-600 transition-all"
                        style={{ width: `${pct}%` }}
                    />
                </div>
                {typeof shotsTotal === 'number' && shotsTotal > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                        {t('statusBubble.shotProgress', {
                            completed: Math.min(shotsCompleted ?? 0, shotsTotal),
                            total: shotsTotal,
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Generic card for gates without a bespoke editor (creative_concept, future). */
function GenericDecision({
    decision,
    isSubmitting,
    onSubmit,
}: {
    decision: DecisionRequest;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
}) {
    const { t } = useTranslation('videoApiStudioAssistChat');
    const concept = decision.payload?.concept as Record<string, unknown> | undefined;
    return (
        <div className="rounded-xl border bg-white p-4 shadow-sm dark:bg-card">
            {concept && (
                <dl className="mb-3 space-y-1.5 text-xs">
                    {Object.entries(concept).map(([k, v]) =>
                        v ? (
                            <div key={k} className="flex gap-2">
                                <dt className="shrink-0 font-medium capitalize text-muted-foreground">
                                    {k.replace(/_/g, ' ')}:
                                </dt>
                                <dd className="text-foreground">{String(v)}</dd>
                            </div>
                        ) : null
                    )}
                </dl>
            )}
            {decision.options.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                    {decision.options.map((o) => (
                        <Button
                            key={o.option_id}
                            variant="outline"
                            size="sm"
                            disabled={isSubmitting}
                            onClick={() => onSubmit({ kind: 'choose_option', option_id: o.option_id })}
                        >
                            {o.label}
                            {o.is_recommended && <span className="ml-1 text-xs text-violet-600">★</span>}
                        </Button>
                    ))}
                </div>
            )}
            <div className="flex items-center justify-between gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => onSubmit({ kind: 'auto' })}
                    className="gap-1.5 text-muted-foreground"
                >
                    <Sparkle className="size-3.5" />
                    {t('genericDecision.letAiDecide')}
                </Button>
                <Button
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => onSubmit({ kind: 'accept_recommended' })}
                    className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                >
                    <Check className="size-4" />
                    {t('genericDecision.approve')}
                </Button>
            </div>
        </div>
    );
}

function DecisionCard({
    decision,
    prompt,
    isSubmitting,
    onSubmit,
    apiKey,
}: {
    decision: DecisionRequest;
    prompt: string;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
    apiKey?: string;
}) {
    switch (decision.gate_type) {
        case 'creative_concept':
            return (
                <CreativeConceptDecision
                    decision={decision}
                    isSubmitting={isSubmitting}
                    onSubmit={onSubmit}
                />
            );
        case 'contact_sheet':
            return (
                <ContactSheetDecision
                    decision={decision}
                    isSubmitting={isSubmitting}
                    onSubmit={onSubmit}
                />
            );
        case 'asset_request':
            return (
                <AssetRequestDecision
                    decision={decision}
                    isSubmitting={isSubmitting}
                    onSubmit={onSubmit}
                />
            );
        case 'cast':
            return (
                <CastDecision
                    decision={decision}
                    isSubmitting={isSubmitting}
                    onSubmit={onSubmit}
                />
            );
        case 'dailies':
            return (
                <DailiesDecision
                    decision={decision}
                    isSubmitting={isSubmitting}
                    onSubmit={onSubmit}
                />
            );
        case 'narration':
            return (
                <NarrationDecision
                    decision={decision}
                    prompt={prompt}
                    isSubmitting={isSubmitting}
                    onSubmit={onSubmit}
                />
            );
        case 'shot_plan':
            return <ShotPlanDecision decision={decision} isSubmitting={isSubmitting} onSubmit={onSubmit} />;
        case 'styleframe':
            return (
                <StyleframeDecision
                    decision={decision}
                    isSubmitting={isSubmitting}
                    onSubmit={onSubmit}
                />
            );
        case 'visual_casting':
            return (
                <VisualCastingDecision
                    decision={decision}
                    isSubmitting={isSubmitting}
                    onSubmit={onSubmit}
                    apiKey={apiKey}
                />
            );
        default:
            return <GenericDecision decision={decision} isSubmitting={isSubmitting} onSubmit={onSubmit} />;
    }
}

/** The finished video, shown inline as the final turn of the conversation. */
function CompletionCard({
    timelineUrl,
    audioUrl,
    wordsUrl,
    orientation,
    onEdit,
    onShowProgress,
    onSaveCast,
    reloadKey,
}: {
    timelineUrl?: string;
    audioUrl?: string;
    wordsUrl?: string;
    orientation?: 'landscape' | 'portrait';
    onEdit?: () => void;
    onShowProgress?: () => void;
    /** Present only when this run generated dialogue scenes — saves the cast. */
    onSaveCast?: () => void;
    /** Bumped after a post-completion edit — remounts the player and busts
     *  the timeline fetch cache so the updated frame shows. */
    reloadKey?: number;
}) {
    const { t } = useTranslation('videoApiStudioAssistChat');
    const isPortrait = orientation === 'portrait';
    const effectiveTimelineUrl =
        timelineUrl && reloadKey
            ? `${timelineUrl}${timelineUrl.includes('?') ? '&' : '?'}v=${reloadKey}`
            : timelineUrl;
    return (
        <div className="space-y-3">
            <Bubble side="agent">
                <span className="flex items-center gap-2 font-medium text-foreground">
                    <CheckCircle weight="fill" className="size-4 text-emerald-600" />
                    {t('completion.videoReady')}
                </span>
            </Bubble>
            <div className="overflow-hidden rounded-xl border bg-black shadow-sm">
                {effectiveTimelineUrl ? (
                    <div className={cn('mx-auto', isPortrait ? 'max-w-xs' : 'w-full')}>
                        <AIContentPlayer
                            key={reloadKey ?? 0}
                            timelineUrl={effectiveTimelineUrl}
                            audioUrl={audioUrl}
                            wordsUrl={wordsUrl}
                            width={isPortrait ? 1080 : 1920}
                            height={isPortrait ? 1920 : 1080}
                        />
                    </div>
                ) : (
                    <div className="p-8 text-center text-sm text-white/70">{t('completion.preparingPreview')}</div>
                )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {onEdit && (
                    <Button
                        size="sm"
                        onClick={onEdit}
                        className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                    >
                        <PencilSimple className="size-4" />
                        {t('completion.editVideo')}
                    </Button>
                )}
                {onShowProgress && (
                    <Button variant="outline" size="sm" onClick={onShowProgress} className="gap-1.5">
                        <SidebarSimple className="size-3.5" />
                        {t('completion.detailsAndDownload')}
                    </Button>
                )}
                {onSaveCast && (
                    <Button variant="outline" size="sm" onClick={onSaveCast} className="gap-1.5">
                        <UsersThree className="size-3.5" />
                        {t('completion.saveCast')}
                    </Button>
                )}
            </div>
        </div>
    );
}

/**
 * The single conversation surface for the studio — used in BOTH Auto and Assist
 * modes for the entire generation lifecycle. While working it streams status
 * bubbles; in Assist it adds decision cards at gates; when done it shows the
 * finished video inline. The production diagram is an optional drawer behind
 * "Show progress".
 */
export function AssistChat({
    prompt,
    pending,
    transcript,
    isSubmitting,
    statusMessage,
    percentage,
    shotsCompleted,
    shotsTotal,
    stages,
    isComplete,
    timelineUrl,
    audioUrl,
    wordsUrl,
    orientation,
    onSubmit,
    onShowProgress,
    onAbort,
    onEdit,
    apiKey,
    onPostEdit,
    onSaveCast,
    postEdits,
    playerReloadKey,
}: AssistChatProps) {
    const { t } = useTranslation('videoApiStudioAssistChat');
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const [steer, setSteer] = useState('');

    const postEditBusy = (postEdits ?? []).some((p) => p.busy);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [
        pending?.decision_id,
        transcript.length,
        isSubmitting,
        statusMessage,
        isComplete,
        postEdits?.length,
        postEditBusy,
    ]);

    const sendSteer = () => {
        const text = steer.trim();
        if (!text) return;
        // Post-completion: the same box becomes the conversational editor.
        if (isComplete) {
            if (!onPostEdit || postEditBusy) return;
            setSteer('');
            onPostEdit(text);
            return;
        }
        if (!pending) return;
        setSteer('');
        onSubmit({ kind: 'freeform', text });
    };

    const working = !pending && !isComplete;

    return (
        <div className="mx-auto flex size-full max-w-3xl flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                        <Sparkle className="size-4 text-violet-600" />
                    </span>
                    <div className="text-sm font-semibold text-foreground">{t('header.title')}</div>
                </div>
                <div className="flex items-center gap-2">
                    {working && onAbort && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onAbort}
                            className="gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        >
                            <Stop className="size-3.5" />
                            {t('header.stop')}
                        </Button>
                    )}
                    {onShowProgress && (
                        <Button variant="outline" size="sm" onClick={onShowProgress} className="gap-1.5">
                            <SidebarSimple className="size-3.5" />
                            {t('header.showProgress')}
                        </Button>
                    )}
                </div>
            </div>

            {/* Conversation */}
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <Bubble side="user">{prompt}</Bubble>

                {transcript.map((turn) => (
                    <div key={turn.decision_id} className="space-y-2">
                        <Bubble side="agent">{turn.prompt}</Bubble>
                        <Bubble side="user">{turn.answer_summary}</Bubble>
                    </div>
                ))}

                {pending ? (
                    <div className="space-y-3">
                        <Bubble side="agent">
                            <div className="font-medium">{gateTitle(pending.gate_type, t)}</div>
                            <div className="mt-0.5 text-muted-foreground">{pending.prompt}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground/70">
                                {buildGateMeta(t)[pending.gate_type]?.blurb}
                            </div>
                        </Bubble>
                        <DecisionCard
                            decision={pending}
                            prompt={prompt}
                            isSubmitting={isSubmitting}
                            onSubmit={onSubmit}
                            apiKey={apiKey}
                        />
                    </div>
                ) : isComplete ? (
                    <>
                        <CompletionCard
                            timelineUrl={timelineUrl}
                            audioUrl={audioUrl}
                            wordsUrl={wordsUrl}
                            orientation={orientation}
                            onEdit={onEdit}
                            onShowProgress={onShowProgress}
                            onSaveCast={onSaveCast}
                            reloadKey={playerReloadKey}
                        />
                        {(postEdits ?? []).map((p) => (
                            <div key={p.id} className="space-y-2">
                                <Bubble side="user">{p.request}</Bubble>
                                <Bubble side="agent">
                                    {p.busy ? (
                                        <span className="flex items-center gap-2 text-muted-foreground">
                                            <CircleNotch className="size-3.5 animate-spin" />
                                            {t('postEdit.updating')}
                                        </span>
                                    ) : (
                                        p.reply
                                    )}
                                </Bubble>
                            </div>
                        ))}
                    </>
                ) : (
                    <StatusBubble
                        message={statusMessage}
                        percentage={percentage}
                        shotsCompleted={shotsCompleted}
                        shotsTotal={shotsTotal}
                        stages={stages}
                    />
                )}

                <div ref={bottomRef} />
            </div>

            {/* Free-form input: steering while a gate is pending; the
                conversational editor once the video is complete. */}
            {(!isComplete || onPostEdit) && (
                <div className="border-t px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Input
                            value={steer}
                            disabled={
                                isComplete ? postEditBusy : !pending || isSubmitting
                            }
                            onChange={(e) => setSteer(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    sendSteer();
                                }
                            }}
                            placeholder={
                                isComplete
                                    ? t('input.placeholderEdit')
                                    : pending
                                      ? t('input.placeholderSteer')
                                      : t('input.placeholderWorking')
                            }
                            className="h-9"
                        />
                        <Button
                            size="sm"
                            disabled={
                                !steer.trim() ||
                                (isComplete ? postEditBusy : !pending || isSubmitting)
                            }
                            onClick={sendSteer}
                            className="gap-1.5"
                        >
                            <PaperPlaneRight className="size-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
