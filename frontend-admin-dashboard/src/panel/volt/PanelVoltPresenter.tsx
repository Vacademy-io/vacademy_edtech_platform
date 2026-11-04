/**
 * Full-stage slide presenter for local Present and Present live.
 *
 * Forked from ActualPresentationDisplay.tsx, not imported: the SSE (119-240)
 * lives in usePanelVoltSession/presenterSse, the optimistic move (285-337) is
 * `onNavigate` → usePanelVoltSession.move. Dropped: RecommendationsSidePanel,
 * QuickQuestionFAB, audio/transcript props, SessionExcalidrawOverlay and the
 * per-participant join/leave toasts (spam on a classroom screen).
 *
 * Added for panels: large edge tap zones, horizontal swipe (≥ 80 px), keys
 * ArrowLeft/Right, PageUp/PageDown, Space (Shift+Space back) for remotes and
 * clickers, and a tap-to-enlarge join QR. Slides render as static canvases
 * (PanelSceneView), so a touch can never pan or zoom a slide off-centre.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
    CaretLeft,
    CaretRight,
    House,
    QrCode,
    Stop,
    Users,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import type { QuizSlideData } from '@/components/common/slides/utils/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PanelConfirmDialog } from '../components/PanelConfirmDialog';
import { navigate } from '../router';
import { PanelFullscreenButton, PanelStage } from '../components/PanelStage';
import { PanelResponseOverlay } from './PanelResponseOverlay';
import { PanelSceneView } from './PanelSceneView';
import { QuizSlideView } from './QuizSlideView';
import { JoinDetails, JoinQr, participantName } from './PanelWaitingRoom';
import { SseStatusChip } from './SseStatusChip';
import { toAppSlide } from './useVoltDeck';
import type { PresenterSseStatus } from './presenterSse';
import type { PanelDeck, PanelSlide, VoltParticipant } from './types';

const SWIPE_MIN_PX = 80;
const CLICK_SUPPRESS_MS = 400;

export interface PresenterLiveProps {
    sessionId: string;
    inviteCode: string;
    participants: VoltParticipant[];
    sseStatus: PresenterSseStatus;
    onReconnect: () => void;
    slideStartTimestamp: number | null;
    defaultSecondsForQuestion: number;
    /** added_question from the session's slide list (real option ids) for a slide id. */
    addedQuestionFor: (slideId: string) => unknown;
    /** Finish the session (called after the teacher confirms). */
    onEnd: () => Promise<void>;
}

export interface PanelVoltPresenterProps {
    deck: PanelDeck;
    index: number;
    onNavigate: (index: number) => void;
    /** Local mode only: leave the presenter. */
    onExit?: () => void;
    live?: PresenterLiveProps;
}

function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element || !element.tagName) return false;
    const tag = element.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
}

function anyDialogOpen(): boolean {
    return !!document.querySelector('[role="dialog"], [role="alertdialog"]');
}

function SlideBody({ slide, prefetch }: { slide: PanelSlide; prefetch: PanelSlide[] }) {
    const { t } = useTranslation('volt');
    if ((slide.kind === 'quiz' || slide.kind === 'feedback') && slide.question) {
        return <QuizSlideView kind={slide.kind} question={slide.question} />;
    }
    if (slide.kind === 'scene' && slide.scene) {
        return (
            <PanelSceneView
                scene={slide.scene}
                cacheKey={slide.id}
                prefetch={prefetch
                    .filter((item) => item.kind === 'scene' && item.scene)
                    .map((item) => ({ cacheKey: item.id, scene: item.scene! }))}
            />
        );
    }
    return (
        <div className="flex size-full flex-col items-center justify-center space-y-4 rounded-md bg-card text-center">
            <WarningCircle size={64} className="text-warning-500" aria-hidden />
            <p className="text-h2 text-neutral-700">{t('slide.failedTitle')}</p>
            <p className="text-title text-neutral-500">{t('slide.failedBody')}</p>
        </div>
    );
}

export function PanelVoltPresenter({
    deck,
    index,
    onNavigate,
    onExit,
    live,
}: PanelVoltPresenterProps) {
    const { t } = useTranslation('volt');
    const total = deck.slides.length;
    const safeIndex = Math.max(0, Math.min(index, total - 1));
    const slide = deck.slides[safeIndex];
    const [qrOpen, setQrOpen] = useState(false);
    const [peopleOpen, setPeopleOpen] = useState(false);
    const [confirmEnd, setConfirmEnd] = useState(false);
    const swipeRef = useRef<{ x: number; y: number; id: number } | null>(null);
    const suppressClickUntil = useRef(0);

    const canPrev = safeIndex > 0;
    const canNext = safeIndex < total - 1;

    const go = useCallback(
        (delta: number) => {
            const next = safeIndex + delta;
            if (next < 0 || next >= total) return;
            onNavigate(next);
        },
        [safeIndex, total, onNavigate]
    );

    // Keyboard, remotes and clickers.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
            if (isTypingTarget(event.target) || anyDialogOpen()) return;
            let delta = 0;
            switch (event.key) {
                case 'ArrowRight':
                case 'PageDown':
                    delta = 1;
                    break;
                case 'ArrowLeft':
                case 'PageUp':
                    delta = -1;
                    break;
                case ' ':
                case 'Spacebar':
                    delta = event.shiftKey ? -1 : 1;
                    break;
                default:
                    return;
            }
            event.preventDefault();
            go(delta);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go]);

    // Horizontal swipe anywhere on the slide area. The area is `touch-pan-y`: a
    // vertical drag still scrolls a long quiz (the browser cancels the pointer),
    // a horizontal one reaches us as pointer events.
    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (!event.isPrimary) return;
        swipeRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    };
    const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
        const start = swipeRef.current;
        swipeRef.current = null;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
            suppressClickUntil.current = Date.now() + CLICK_SUPPRESS_MS;
            go(dx < 0 ? 1 : -1);
        }
    };
    const edgeTap = (delta: number) => {
        if (Date.now() < suppressClickUntil.current) return;
        go(delta);
    };

    /** Blur after a tap so a later Space from a clicker is not also a button press. */
    const press = (action: () => void) => (event: { currentTarget: HTMLElement }) => {
        event.currentTarget.blur();
        action();
    };

    const prefetch = useMemo(
        () =>
            [deck.slides[safeIndex + 1], deck.slides[safeIndex - 1]].filter(
                (item): item is PanelSlide => !!item
            ),
        [deck.slides, safeIndex]
    );

    const isQuestion = !!slide && (slide.kind === 'quiz' || slide.kind === 'feedback');
    const appSlide = useMemo(() => (slide ? toAppSlide(slide) : null), [slide]);

    return (
        <PanelStage className="bg-muted">
            <div
                className="relative min-h-0 flex-1 touch-pan-y p-4"
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                    swipeRef.current = null;
                }}
            >
                <div className="absolute inset-0 p-4">
                    {slide ? <SlideBody slide={slide} prefetch={prefetch} /> : null}
                </div>

                {live && isQuestion && appSlide && (
                    <div className="pointer-events-none absolute inset-0 z-10">
                        <PanelResponseOverlay
                            key={appSlide.id}
                            sessionId={live.sessionId}
                            slideData={appSlide as QuizSlideData}
                            slideStartTimestamp={live.slideStartTimestamp}
                            defaultSecondsForQuestion={live.defaultSecondsForQuestion}
                            addedQuestion={live.addedQuestionFor(appSlide.id)}
                        />
                    </div>
                )}

                {/* Edge tap zones: a sixth of the width each, full height. */}
                <MyButton
                    buttonType="text"
                    scale="large"
                    layoutVariant="icon"
                    className={cn(
                        'absolute bottom-0 left-0 top-0 z-20 h-full w-1/6 rounded-none text-neutral-400 opacity-60 active:bg-neutral-900/10',
                        !canPrev && 'invisible'
                    )}
                    aria-label={t('present.previous')}
                    onClick={press(() => edgeTap(-1))}
                >
                    <CaretLeft size={64} aria-hidden />
                </MyButton>
                <MyButton
                    buttonType="text"
                    scale="large"
                    layoutVariant="icon"
                    className={cn(
                        'absolute bottom-0 right-0 top-0 z-20 h-full w-1/6 rounded-none text-neutral-400 opacity-60 active:bg-neutral-900/10',
                        !canNext && 'invisible'
                    )}
                    aria-label={t('present.next')}
                    onClick={press(() => edgeTap(1))}
                >
                    <CaretRight size={64} aria-hidden />
                </MyButton>
            </div>

            <footer className="flex min-h-24 shrink-0 items-center justify-between border-t border-border bg-card px-6 py-2">
                <div className="flex min-w-0 flex-1 items-center space-x-4">
                    {live ? (
                        <>
                            {/* Leave without ending the class (immersive mode hides system
                                Back): the stored session + Resume banner bring the teacher
                                back; usePanelVoltSession resumes on remount. */}
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-5 sm:min-w-0"
                                aria-label={t('present.leaveKeepRunning')}
                                onClick={press(() => {
                                    toast.info(t('present.stillRunning'));
                                    navigate('home');
                                })}
                            >
                                <span className="flex items-center space-x-3">
                                    <House size={32} aria-hidden />
                                    {/* Icon-only on a 960 px TV footer (aria-label says it all). */}
                                    <span className="hidden lg:inline">{t('present.home')}</span>
                                </span>
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-5 sm:min-w-0"
                                onClick={press(() => setQrOpen(true))}
                                aria-label={t('present.showJoin')}
                            >
                                <span className="flex items-center space-x-3">
                                    <QrCode size={32} aria-hidden />
                                    <span className="font-mono text-h3 font-semibold tracking-widest">
                                        {live.inviteCode}
                                    </span>
                                </span>
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-5 sm:min-w-0"
                                onClick={press(() => setPeopleOpen(true))}
                                aria-label={t('present.showParticipants')}
                            >
                                <span className="flex items-center space-x-3">
                                    <Users size={32} aria-hidden />
                                    <span className="text-h3 font-semibold tabular-nums">
                                        {live.participants.length}
                                    </span>
                                </span>
                            </MyButton>
                        </>
                    ) : (
                        <MyButton
                            buttonType="secondary"
                            scale="large"
                            className="h-16 px-6 sm:min-w-0"
                            onClick={press(() => onExit?.())}
                        >
                            <span className="flex items-center space-x-3">
                                <X size={28} aria-hidden />
                                <span>{t('present.exit')}</span>
                            </span>
                        </MyButton>
                    )}
                </div>

                <div className="flex shrink-0 items-center space-x-4 px-4">
                    <MyButton
                        buttonType="secondary"
                        layoutVariant="icon"
                        scale="large"
                        className="size-16"
                        disabled={!canPrev}
                        aria-label={t('present.previous')}
                        onClick={press(() => go(-1))}
                    >
                        <CaretLeft size={36} aria-hidden />
                    </MyButton>
                    <span
                        className="min-w-24 text-center text-h2 font-semibold tabular-nums text-neutral-800"
                        aria-live="polite"
                    >
                        {t('present.counter', { current: safeIndex + 1, total })}
                    </span>
                    <MyButton
                        buttonType="secondary"
                        layoutVariant="icon"
                        scale="large"
                        className="size-16"
                        disabled={!canNext}
                        aria-label={t('present.next')}
                        onClick={press(() => go(1))}
                    >
                        <CaretRight size={36} aria-hidden />
                    </MyButton>
                </div>

                <div className="flex min-w-0 flex-1 items-center justify-end space-x-4">
                    {live && (
                        <div className="shrink-0">
                            <SseStatusChip
                                status={live.sseStatus}
                                onReconnect={live.onReconnect}
                                compact
                            />
                        </div>
                    )}
                    <PanelFullscreenButton className="shrink-0" />
                    {live && (
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            className="h-16 shrink-0 px-6 sm:min-w-0"
                            aria-label={t('present.end')}
                            onClick={press(() => setConfirmEnd(true))}
                        >
                            <span className="flex items-center space-x-3">
                                <Stop size={28} weight="fill" aria-hidden />
                                <span className="hidden xl:inline">{t('present.end')}</span>
                            </span>
                        </MyButton>
                    )}
                </div>
            </footer>

            {live && (
                <>
                    <Dialog open={qrOpen} onOpenChange={setQrOpen}>
                        <DialogContent className="w-11/12 max-w-5xl p-8">
                            <DialogHeader>
                                <DialogTitle className="text-h2 font-semibold text-neutral-800">
                                    {t('join.title')}
                                </DialogTitle>
                                <DialogDescription className="sr-only">
                                    {t('join.instructions')}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid grid-cols-2 items-center gap-8 pt-4">
                                <JoinQr inviteCode={live.inviteCode} className="h-96" />
                                <JoinDetails inviteCode={live.inviteCode} />
                            </div>
                            <DialogFooter className="pt-6">
                                <MyButton
                                    buttonType="secondary"
                                    scale="large"
                                    className="h-16 px-8"
                                    onClick={() => setQrOpen(false)}
                                >
                                    {t('responses.close')}
                                </MyButton>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <Dialog open={peopleOpen} onOpenChange={setPeopleOpen}>
                        <DialogContent className="w-11/12 max-w-4xl p-8">
                            <DialogHeader>
                                <DialogTitle className="text-h2 font-semibold text-neutral-800">
                                    {t('waiting.joinedCount', { count: live.participants.length })}
                                </DialogTitle>
                                <DialogDescription className="sr-only">
                                    {t('present.showParticipants')}
                                </DialogDescription>
                            </DialogHeader>
                            {live.participants.length === 0 ? (
                                <p className="pt-4 text-title text-neutral-500">
                                    {t('waiting.nobodyYet')}
                                </p>
                            ) : (
                                <ul className="grid max-h-96 grid-cols-3 gap-3 overflow-y-auto pt-4">
                                    {live.participants.map((participant, i) => (
                                        <li
                                            key={participant.user_id || participant.username || i}
                                            className="truncate rounded-md bg-muted px-3 py-2 text-title text-neutral-700"
                                        >
                                            {participantName(participant)}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <DialogFooter className="pt-6">
                                <MyButton
                                    buttonType="secondary"
                                    scale="large"
                                    className="h-16 px-8"
                                    onClick={() => setPeopleOpen(false)}
                                >
                                    {t('responses.close')}
                                </MyButton>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    <PanelConfirmDialog
                        open={confirmEnd}
                        onOpenChange={setConfirmEnd}
                        title={t('present.endTitle')}
                        description={t('present.endBody')}
                        confirmLabel={t('present.end')}
                        onConfirm={live.onEnd}
                    />
                </>
            )}
        </PanelStage>
    );
}

export default PanelVoltPresenter;
