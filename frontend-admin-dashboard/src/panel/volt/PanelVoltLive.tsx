/**
 * Present live: waiting room → presenter → finished (+ leaderboard), over ONE
 * presenter SSE owned by usePanelVoltSession. Route: #/volt?view=live&id=&sid=.
 * The session was created by PanelDeckView before navigating here, so this
 * screen only ever resumes (safe on remount, Home-and-back and app restart).
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle, Trophy, XCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { SessionLeaderboardModal } from '@/components/common/slides/components/SessionLeaderboardModal';
import { PanelEmpty, PanelError, PanelLoading } from '../components/PanelScreenState';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelTopBar } from '../components/PanelTopBar';
import { useActivityLog } from '../device/activityLog';
import { goBack, navigate } from '../router';
import { DeckLoading } from './PanelDeckView';
import { PanelVoltPresenter } from './PanelVoltPresenter';
import { PanelWaitingRoom } from './PanelWaitingRoom';
import { toAppSlide, useVoltDeck } from './useVoltDeck';
import { usePanelVoltSession } from './usePanelVoltSession';
import { voltErrorMessage } from './voltApi';

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <PanelStage>
            <PanelTopBar title={title} onBack={goBack} />
            <PanelStageBody className="p-8">{children}</PanelStageBody>
        </PanelStage>
    );
}

export function PanelVoltLive({
    presentationId,
    sessionId,
}: {
    presentationId: string;
    sessionId: string;
}) {
    const { t } = useTranslation('volt');
    const { query: deckQuery, progress } = useVoltDeck(presentationId);
    const live = usePanelVoltSession(sessionId);
    const [leaderboardOpen, setLeaderboardOpen] = useState(true);
    /** Cancelling from the waiting room: skip the "ended" screen on the way out. */
    const [leaving, setLeaving] = useState(false);
    const deck = deckQuery.data;
    const title = deck?.title || live.record?.title || t('list.title');
    const loadedTitle = deck?.title || live.record?.title;
    useActivityLog(
        loadedTitle
            ? {
                  kind: 'DECK_LIVE',
                  ref_id: presentationId,
                  parent_id: sessionId,
                  title: loadedTitle,
              }
            : null
    );

    const backToDeck = useCallback(
        () => navigate('volt', { view: 'deck', id: presentationId }, { replace: true }),
        [presentationId]
    );

    const end = useCallback(async () => {
        try {
            await live.end();
        } catch (error) {
            toast.error(t('live.endFailed'), { description: voltErrorMessage(error) });
            throw error;
        }
    }, [live, t]);

    const addedQuestionFor = useCallback(
        (slideId: string) =>
            live.session?.slides?.added_slides?.find((slide) => slide.id === slideId)
                ?.added_question ?? null,
        [live.session]
    );

    if (leaving) {
        return (
            <Frame title={title}>
                <PanelLoading label={t('live.ending')} className="py-24" />
            </Frame>
        );
    }

    if (live.phase === 'lost') {
        return (
            <Frame title={title}>
                <PanelEmpty
                    icon={XCircle}
                    title={t('live.lostTitle')}
                    description={t('live.lostBody')}
                    action={
                        <MyButton
                            buttonType="primary"
                            scale="large"
                            className="h-16 px-8"
                            onClick={backToDeck}
                        >
                            {t('live.backToDeck')}
                        </MyButton>
                    }
                    className="py-24"
                />
            </Frame>
        );
    }

    if (live.phase === 'error') {
        return (
            <Frame title={title}>
                <PanelError
                    title={t('live.checkFailed')}
                    detail={live.errorDetail}
                    onRetry={live.retry}
                    className="py-24"
                />
            </Frame>
        );
    }

    if (live.phase === 'finished') {
        const showBoard = live.record?.showLeaderboard !== false;
        return (
            <Frame title={title}>
                <PanelEmpty
                    icon={CheckCircle}
                    title={t('live.endedTitle')}
                    description={t('live.endedBody')}
                    action={
                        <div className="flex items-center space-x-4">
                            {showBoard && (
                                <MyButton
                                    buttonType="secondary"
                                    scale="large"
                                    className="h-16 px-8"
                                    onClick={() => setLeaderboardOpen(true)}
                                >
                                    <span className="flex items-center space-x-3">
                                        <Trophy size={28} aria-hidden />
                                        <span>{t('live.showLeaderboard')}</span>
                                    </span>
                                </MyButton>
                            )}
                            <MyButton
                                buttonType="primary"
                                scale="large"
                                className="h-16 px-8"
                                onClick={backToDeck}
                            >
                                {t('live.backToDeck')}
                            </MyButton>
                        </div>
                    }
                    className="py-24"
                />
                {showBoard && (
                    <SessionLeaderboardModal
                        isOpen={leaderboardOpen}
                        onClose={() => setLeaderboardOpen(false)}
                        sessionId={sessionId}
                        slides={(deck?.slides ?? []).map(toAppSlide)}
                    />
                )}
            </Frame>
        );
    }

    if (deckQuery.isError) {
        return (
            <Frame title={title}>
                <PanelError
                    title={t('deck.errorTitle')}
                    detail={voltErrorMessage(deckQuery.error)}
                    onRetry={() => void deckQuery.refetch()}
                    className="py-24"
                />
            </Frame>
        );
    }

    if (live.phase === 'checking' || !deck) {
        return (
            <Frame title={title}>
                {deckQuery.isPending ? (
                    <DeckLoading progress={progress} />
                ) : (
                    <PanelLoading label={t('live.checking')} className="py-24" />
                )}
            </Frame>
        );
    }

    if (deck.slides.length === 0) {
        return (
            <Frame title={title}>
                <PanelEmpty title={t('deck.emptyTitle')} className="py-24" />
            </Frame>
        );
    }

    const inviteCode = live.session?.invite_code || live.record?.inviteCode || '';

    if (live.phase === 'waiting') {
        return (
            <PanelWaitingRoom
                title={title}
                inviteCode={inviteCode}
                participants={live.participants}
                sseStatus={live.sseStatus}
                onReconnect={live.reconnect}
                onStart={() => live.start(deck.slides[0]?.order ?? 0)}
                onCancelSession={async () => {
                    setLeaving(true);
                    try {
                        await end();
                    } catch (error) {
                        setLeaving(false);
                        throw error;
                    }
                    backToDeck();
                }}
            />
        );
    }

    return (
        <PanelVoltPresenter
            deck={deck}
            index={live.slideIndex}
            onNavigate={(index) => {
                const slide = deck.slides[index];
                if (slide) live.move(index, slide.order);
            }}
            live={{
                sessionId,
                inviteCode,
                participants: live.participants,
                sseStatus: live.sseStatus,
                onReconnect: live.reconnect,
                slideStartTimestamp: live.slideStartTimestamp,
                defaultSecondsForQuestion:
                    live.session?.default_seconds_for_question ??
                    live.record?.defaultSecondsForQuestion ??
                    0,
                addedQuestionFor,
                onEnd: end,
            }}
        />
    );
}

export default PanelVoltLive;
