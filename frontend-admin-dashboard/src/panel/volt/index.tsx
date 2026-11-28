/**
 * Volt on the panel (#/volt). Sub-views are query params of this one screen:
 *   (none)                      deck list for the institute
 *   view=deck&id=               one deck: load with progress, Present / Present live
 *   view=present&id=&slide=     local presenting (no session)
 *   view=live&id=&sid=          live session: waiting room → presenter → finished
 *
 * Signed-in only (PanelApp redirects before mounting). Lazy-loaded.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PanelEmpty, PanelError } from '../components/PanelScreenState';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelTopBar } from '../components/PanelTopBar';
import { registerBeforeSignOut } from '../lib/session';
import { goBack, navigate, usePanelRoute } from '../router';
import { endActiveVoltSession } from './activeSession';
import { PanelDeckList } from './PanelDeckList';
import { PanelDeckView, DeckLoading } from './PanelDeckView';
import { clearSceneCache } from './PanelSceneView';
import { PanelVoltLive } from './PanelVoltLive';
import { PanelVoltPresenter } from './PanelVoltPresenter';
import { useVoltDeck } from './useVoltDeck';
import { voltErrorMessage } from './voltApi';

// End an open live session while the token is still valid when the teacher
// signs out (same function reference each time, so re-imports do not stack).
registerBeforeSignOut(endActiveVoltSession);

function LocalPresent({ presentationId, slide }: { presentationId: string; slide: number }) {
    const { t } = useTranslation('volt');
    const { query: deckQuery, progress } = useVoltDeck(presentationId);
    const deck = deckQuery.data;

    if (!deck || deck.slides.length === 0) {
        return (
            <PanelStage>
                <PanelTopBar title={deck?.title || t('list.title')} onBack={goBack} />
                <PanelStageBody className="p-8">
                    {deckQuery.isPending ? (
                        <DeckLoading progress={progress} />
                    ) : deckQuery.isError ? (
                        <PanelError
                            title={t('deck.errorTitle')}
                            detail={voltErrorMessage(deckQuery.error)}
                            onRetry={() => void deckQuery.refetch()}
                            className="py-24"
                        />
                    ) : (
                        <PanelEmpty title={t('deck.emptyTitle')} className="py-24" />
                    )}
                </PanelStageBody>
            </PanelStage>
        );
    }

    return (
        <PanelVoltPresenter
            deck={deck}
            index={slide}
            onNavigate={(index) =>
                navigate(
                    'volt',
                    { view: 'present', id: presentationId, slide: String(index) },
                    { replace: true }
                )
            }
            onExit={goBack}
        />
    );
}

export default function VoltScreen() {
    const { params } = usePanelRoute();
    const view = params.view || 'list';
    const id = params.id || '';

    useEffect(() => () => clearSceneCache(), []);

    if (view === 'deck' && id) return <PanelDeckView presentationId={id} />;
    if (view === 'present' && id) {
        const slide = parseInt(params.slide || '0', 10);
        return <LocalPresent presentationId={id} slide={isNaN(slide) ? 0 : slide} />;
    }
    if (view === 'live' && id && params.sid) {
        return <PanelVoltLive presentationId={id} sessionId={params.sid} />;
    }
    return <PanelDeckList />;
}
