/**
 * Volt deck list for the panel's institute (replaces manage-volt.tsx, which is
 * router/editor-bound). GET presentation/get-all-presentation?instituteId, big
 * touch cards, search, and a banner to Resume or End a live session left open
 * by a crash, a reboot or a trip Home.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Broadcast, PresentationChart, Presentation } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { PanelConfirmDialog } from '../components/PanelConfirmDialog';
import { PanelEmpty, PanelError, PanelLoading } from '../components/PanelScreenState';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelTile } from '../components/PanelTile';
import { PanelTopBar } from '../components/PanelTopBar';
import { usePanelSession } from '../lib/session';
import { goBack, navigate } from '../router';
import {
    endSession,
    readActiveSession,
    subscribeActiveSession,
    type ActiveVoltSession,
} from './activeSession';
import { networkFirst } from '../offline/networkFirst';
import { listDecks, voltErrorMessage } from './voltApi';
import type { VoltDeckSummary } from './types';

export function voltDecksQueryKey(instituteId: string | null) {
    return ['panel', 'volt', 'decks', instituteId ?? ''] as const;
}

/** The stored live session, kept in sync with writes from anywhere in the app. */
export function useActiveVoltSession(): ActiveVoltSession | null {
    const [record, setRecord] = useState(readActiveSession);
    useEffect(() => subscribeActiveSession(() => setRecord(readActiveSession())), []);
    return record;
}

function slideCount(deck: VoltDeckSummary): number {
    return deck.added_slides_count ?? deck.added_slides?.length ?? 0;
}

function timeValue(value: string | null | undefined): number {
    const time = value ? new Date(value).getTime() : 0;
    return isNaN(time) ? 0 : time;
}

function formatDate(value: string | null | undefined): string | null {
    const time = timeValue(value);
    return time ? new Date(time).toLocaleDateString() : null;
}

export function ActiveSessionBanner({ record }: { record: ActiveVoltSession }) {
    const { t } = useTranslation('volt');
    const [confirmEnd, setConfirmEnd] = useState(false);

    const end = async () => {
        try {
            await endSession(record.sessionId);
            toast.success(t('live.ended'));
        } catch (error) {
            toast.error(t('live.endFailed'), { description: voltErrorMessage(error) });
            throw error;
        }
    };

    return (
        <section className="flex items-center justify-between rounded-lg border border-warning-300 bg-warning-50 p-6">
            <div className="flex min-w-0 items-center space-x-4">
                <Broadcast size={48} className="shrink-0 text-warning-600" aria-hidden />
                <div className="min-w-0 space-y-1">
                    <h2 className="text-h3 font-semibold text-neutral-800">{t('resume.title')}</h2>
                    <p className="truncate text-title text-neutral-600">
                        {t('resume.body', {
                            title: record.title || t('deck.untitled'),
                            code: record.inviteCode,
                        })}
                    </p>
                </div>
            </div>
            <div className="flex shrink-0 items-center space-x-4 pl-6">
                <MyButton
                    buttonType="secondary"
                    scale="large"
                    className="h-16 px-6"
                    onClick={() => setConfirmEnd(true)}
                >
                    {t('resume.end')}
                </MyButton>
                <MyButton
                    buttonType="primary"
                    scale="large"
                    className="h-16 px-8"
                    onClick={() =>
                        navigate('volt', {
                            view: 'live',
                            id: record.presentationId,
                            sid: record.sessionId,
                        })
                    }
                >
                    {t('resume.resume')}
                </MyButton>
            </div>
            <PanelConfirmDialog
                open={confirmEnd}
                onOpenChange={setConfirmEnd}
                title={t('present.endTitle')}
                description={t('present.endBody')}
                confirmLabel={t('present.end')}
                onConfirm={end}
            />
        </section>
    );
}

export function PanelDeckList() {
    const { t } = useTranslation('volt');
    const { instituteId } = usePanelSession();
    const activeSession = useActiveVoltSession();
    const [search, setSearch] = useState('');

    const query = useQuery({
        queryKey: voltDecksQueryKey(instituteId),
        queryFn: ({ signal }) =>
            networkFirst(`decks:${instituteId ?? ''}`, () => listDecks(instituteId ?? '', signal)),
        enabled: !!instituteId,
        staleTime: 60 * 1000,
    });

    const decks = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return (query.data ?? [])
            .filter((deck) => !needle || (deck.title || '').toLowerCase().indexOf(needle) >= 0)
            .slice()
            .sort(
                (a, b) =>
                    timeValue(b.updated_at || b.created_at) -
                    timeValue(a.updated_at || a.created_at)
            );
    }, [query.data, search]);

    const total = query.data?.length ?? 0;

    let body;
    if (!instituteId) {
        body = <PanelEmpty icon={Presentation} title={t('list.noInstitute')} />;
    } else if (query.isPending) {
        body = <PanelLoading label={t('list.loading')} className="py-24" />;
    } else if (query.isError) {
        body = (
            <PanelError
                title={t('list.errorTitle')}
                detail={voltErrorMessage(query.error)}
                onRetry={() => void query.refetch()}
                className="py-24"
            />
        );
    } else if (total === 0) {
        body = (
            <PanelEmpty
                icon={Presentation}
                title={t('list.emptyTitle')}
                description={t('list.emptyBody')}
                className="py-24"
            />
        );
    } else if (decks.length === 0) {
        body = <PanelEmpty title={t('list.noMatch', { search })} className="py-24" />;
    } else {
        body = (
            <div className="grid grid-cols-2 gap-6 xl:grid-cols-3 2xl:grid-cols-4">
                {decks.map((deck) => {
                    const count = slideCount(deck);
                    const updated = formatDate(deck.updated_at || deck.created_at);
                    return (
                        <PanelTile
                            key={deck.id}
                            icon={PresentationChart}
                            label={deck.title || t('deck.untitled')}
                            description={
                                updated
                                    ? t('list.cardMetaDated', { count, date: updated })
                                    : t('list.cardMeta', { count })
                            }
                            onClick={() => navigate('volt', { view: 'deck', id: deck.id })}
                        />
                    );
                })}
            </div>
        );
    }

    return (
        <PanelStage>
            <PanelTopBar title={t('list.title')} onBack={goBack} />
            <PanelStageBody className="p-8">
                <div className="mx-auto max-w-screen-2xl space-y-8">
                    {activeSession && <ActiveSessionBanner record={activeSession} />}
                    {total > 6 && (
                        <MyInput
                            inputType="search"
                            size="large"
                            input={search}
                            onChangeFunction={(event) => setSearch(event.target.value)}
                            inputPlaceholder={t('list.search')}
                            aria-label={t('list.search')}
                            className="h-16 text-h3 sm:w-full"
                        />
                    )}
                    {body}
                </div>
            </PanelStageBody>
        </PanelStage>
    );
}

export default PanelDeckList;
