/**
 * One deck: loads every slide (with progress), previews the first slide and
 * offers Present (local, no session) and Present live (creates a session).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Broadcast, CircleNotch, Play, Presentation, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { PanelEmpty, PanelError } from '../components/PanelScreenState';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelTopBar } from '../components/PanelTopBar';
import { goBack, navigate } from '../router';
import { createLiveSession } from './activeSession';
import { LiveSessionDialog } from './LiveSessionDialog';
import { ActiveSessionBanner, useActiveVoltSession } from './PanelDeckList';
import { PanelSceneView } from './PanelSceneView';
import { QuizSlideView } from './QuizSlideView';
import { useVoltDeck } from './useVoltDeck';
import { voltErrorMessage } from './voltApi';
import type { DeckLoadProgress, PanelSlide } from './types';

/** Loading state with real progress (Excalidraw slide files fetched / total). */
export function DeckLoading({ progress }: { progress: DeckLoadProgress | null }) {
    const { t } = useTranslation('volt');
    const percent =
        progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
        <div className="flex w-full flex-col items-center justify-center space-y-6 p-8 py-24 text-center">
            <CircleNotch size={64} className="animate-spin text-primary-500" aria-hidden />
            <p className="text-h3 text-neutral-700" role="status">
                {progress && progress.total > 0
                    ? t('deck.loadingProgress', { done: progress.done, total: progress.total })
                    : t('deck.loading')}
            </p>
            <Progress value={percent} className="h-4 w-full max-w-xl !bg-muted" />
        </div>
    );
}

function SlidePreview({ slide }: { slide: PanelSlide }) {
    if ((slide.kind === 'quiz' || slide.kind === 'feedback') && slide.question) {
        return <QuizSlideView kind={slide.kind} question={slide.question} />;
    }
    if (slide.kind === 'scene' && slide.scene) {
        return <PanelSceneView scene={slide.scene} cacheKey={`preview-${slide.id}`} />;
    }
    return (
        <div className="flex size-full items-center justify-center rounded-md bg-card">
            <WarningCircle size={64} className="text-warning-500" aria-hidden />
        </div>
    );
}

export function PanelDeckView({ presentationId }: { presentationId: string }) {
    const { t } = useTranslation('volt');
    const { query: deckQuery, progress } = useVoltDeck(presentationId);
    const activeSession = useActiveVoltSession();
    const [liveOpen, setLiveOpen] = useState(false);
    const deck = deckQuery.data;
    const first = deck?.slides[0];

    const startLive = async (options: Parameters<typeof createLiveSession>[2]) => {
        try {
            const record = await createLiveSession(presentationId, deck?.title || '', options);
            setLiveOpen(false);
            navigate('volt', { view: 'live', id: presentationId, sid: record.sessionId });
        } catch (error) {
            toast.error(t('live.createFailed'), { description: voltErrorMessage(error) });
        }
    };

    let body;
    if (deckQuery.isPending) {
        body = <DeckLoading progress={progress} />;
    } else if (deckQuery.isError) {
        body = (
            <PanelError
                title={t('deck.errorTitle')}
                detail={voltErrorMessage(deckQuery.error)}
                onRetry={() => void deckQuery.refetch()}
                className="py-24"
            />
        );
    } else if (!deck || !first) {
        body = (
            <PanelEmpty
                icon={Presentation}
                title={t('deck.emptyTitle')}
                description={t('deck.emptyBody')}
                className="py-24"
            />
        );
    } else {
        const otherLive = activeSession && activeSession.presentationId !== presentationId;
        const thisLive = activeSession && activeSession.presentationId === presentationId;
        body = (
            <div className="space-y-8">
                {activeSession && <ActiveSessionBanner record={activeSession} />}
                <div className="grid grid-cols-5 gap-10">
                    <div className="col-span-3 h-96 rounded-lg border border-border bg-muted p-4">
                        <SlidePreview slide={first} />
                    </div>
                    <div className="col-span-2 flex flex-col justify-between space-y-6">
                        <div className="space-y-3">
                            <h2 className="text-h1 font-semibold text-neutral-800">
                                {deck.title || t('deck.untitled')}
                            </h2>
                            <p className="text-h3 text-neutral-600">
                                {t('deck.slideCount', { count: deck.slides.length })}
                            </p>
                            {deck.failedCount > 0 && (
                                <p className="flex items-center space-x-2 text-title text-warning-600">
                                    <WarningCircle size={28} aria-hidden />
                                    <span>{t('deck.someFailed', { count: deck.failedCount })}</span>
                                </p>
                            )}
                        </div>
                        <div className="space-y-4">
                            <MyButton
                                buttonType="primary"
                                scale="large"
                                className="h-16 w-full px-8"
                                onClick={() =>
                                    navigate('volt', { view: 'present', id: presentationId })
                                }
                            >
                                <span className="flex items-center justify-center space-x-3">
                                    <Play size={28} weight="fill" aria-hidden />
                                    <span>{t('deck.present')}</span>
                                </span>
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 w-full px-8"
                                disabled={!!otherLive}
                                onClick={() => {
                                    if (thisLive && activeSession) {
                                        navigate('volt', {
                                            view: 'live',
                                            id: presentationId,
                                            sid: activeSession.sessionId,
                                        });
                                    } else {
                                        setLiveOpen(true);
                                    }
                                }}
                            >
                                <span className="flex items-center justify-center space-x-3">
                                    <Broadcast size={28} aria-hidden />
                                    <span>
                                        {thisLive ? t('resume.resume') : t('deck.presentLive')}
                                    </span>
                                </span>
                            </MyButton>
                            <p className="text-title text-neutral-500">
                                {otherLive ? t('deck.otherLiveHint') : t('deck.presentLiveHint')}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <PanelStage>
            <PanelTopBar title={deck?.title || t('list.title')} onBack={goBack} />
            <PanelStageBody className="p-8">
                <div className="mx-auto max-w-screen-2xl">{body}</div>
            </PanelStageBody>
            <LiveSessionDialog open={liveOpen} onOpenChange={setLiveOpen} onConfirm={startLive} />
        </PanelStage>
    );
}

export default PanelDeckView;
