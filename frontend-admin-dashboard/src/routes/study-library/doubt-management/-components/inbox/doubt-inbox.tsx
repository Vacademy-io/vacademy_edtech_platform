import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ChatsCircle } from '@phosphor-icons/react';
import { useDoubtTable } from '../../-hooks/useDoubtTable';
import { useGetDoubtById } from '../../-services/get-doubt-by-id';
import { InboxList } from './inbox-list';
import { ConversationPane } from './conversation-pane';

/**
 * Split-pane "support inbox" for doubts/queries: list on the left, the selected doubt's full
 * conversation + inline reply on the right. Replaces the old table+dialog flow. On mobile it shows
 * the list, then swaps to the conversation (with a back button) when a doubt is selected.
 *
 * @param initialDoubtId When present (deep link from a doubt-notification email/alert, ?doubtId=X),
 *        the inbox opens that specific doubt instead of defaulting to the newest one. If the doubt
 *        isn't on the loaded page it's fetched by id and shown at the top of the list.
 */
export const DoubtInbox = ({ initialDoubtId }: { initialDoubtId?: string }) => {
    const { t } = useTranslation('studyLibraryDoubtInbox');
    const { doubts, currentPage, setCurrentPage, isLoading, error, refetch, userDetailsRecord } =
        useDoubtTable();
    const pageList = doubts?.content ?? [];
    const [selectedId, setSelectedId] = useState<string | null>(initialDoubtId ?? null);

    // Apply the deep link exactly once (the first time we see a doubtId), so a later manual
    // selection isn't yanked back to the deep-linked doubt on re-render.
    const deepLinkApplied = useRef(false);
    useEffect(() => {
        if (initialDoubtId && !deepLinkApplied.current) {
            deepLinkApplied.current = true;
            setSelectedId(initialDoubtId);
        }
    }, [initialDoubtId]);

    // Fetch the deep-linked doubt only when it isn't already on the loaded page.
    const deepLinkInPage = !!initialDoubtId && pageList.some((d) => d.id === initialDoubtId);
    const { data: deepLinkedDoubt, isFetched: deepLinkFetched } = useGetDoubtById(initialDoubtId, {
        enabled: !!initialDoubtId && !deepLinkInPage && !isLoading,
    });

    // The deep link resolved to nothing (deleted/unknown id → 404 → null). Release the hold so the
    // selection logic falls back to the newest doubt instead of leaving an empty conversation pane.
    const deepLinkMissing =
        !!initialDoubtId && !deepLinkInPage && deepLinkFetched && !deepLinkedDoubt;

    // Show the fetched deep-linked doubt at the top of the list when it isn't in the page already.
    const list =
        deepLinkedDoubt && !pageList.some((d) => d.id === deepLinkedDoubt.id)
            ? [deepLinkedDoubt, ...pageList]
            : pageList;

    // Keep a valid selection: default to the first doubt; repoint/clear when the current selection
    // disappears after a refetch, filter change, or page change. The deep-linked doubt is preserved
    // even while its by-id fetch is in flight (so we don't flash the newest doubt then jump).
    useEffect(() => {
        // While a valid deep link is still resolving, keep holding its id so we don't flash the
        // newest doubt then jump. Once it resolves missing (deepLinkMissing), stop holding.
        const holdDeepLink = selectedId === initialDoubtId && !deepLinkMissing;
        if (list.length === 0) {
            if (selectedId !== null && !holdDeepLink) setSelectedId(null);
            return;
        }
        if (!selectedId) {
            setSelectedId(list[0]!.id);
            return;
        }
        if (!list.some((d) => d.id === selectedId) && !holdDeepLink) {
            setSelectedId(list[0]!.id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doubts, deepLinkedDoubt, deepLinkMissing]);

    const selected = list.find((d) => d.id === selectedId) ?? null;

    return (
        <div className="flex h-[calc(100dvh-13rem)] min-h-0 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"> {/* design-lint-ignore: viewport-relative inbox height has no spacing token */}
            <div
                className={cn(
                    'flex w-full flex-col border-r border-neutral-200 sm:w-80 sm:shrink-0',
                    selected && 'hidden sm:flex'
                )}
            >
                <InboxList
                    list={list}
                    isLoading={isLoading}
                    error={error}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    userDetailsRecord={userDetailsRecord}
                    page={doubts}
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                />
            </div>
            <div className={cn('min-w-0 flex-1 flex-col', selected ? 'flex' : 'hidden sm:flex')}>
                {selected ? (
                    <ConversationPane
                        doubt={selected}
                        refetch={refetch}
                        learnerName={userDetailsRecord[selected.user_id]?.name}
                        onBack={() => setSelectedId(null)}
                    />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-neutral-400">
                        <ChatsCircle size={40} weight="duotone" className="text-neutral-300" />
                        <p className="text-sm">{t('selectADoubt')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};
