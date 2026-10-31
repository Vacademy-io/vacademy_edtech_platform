/**
 * CRM → Calling → Call Queue.
 *
 * AI calls do not all dial the moment they are asked for — a bulk campaign or a
 * workflow burst queues, and calls go out as capacity frees up. This page is where
 * that becomes visible: what is waiting, roughly how long it will take, what is on a
 * call right now, and what can be called off.
 *
 * Its own route rather than a tab on Call Log, because the two answer opposite
 * questions: Call Log is what already happened, this is what has not happened yet.
 * Hidden by default — the sidebar sub-item ships in SUB_ITEMS_HIDDEN_BY_DEFAULT, so an
 * institute admin opts into it from Display Settings → Sidebar.
 */
import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { ListNumbers } from '@phosphor-icons/react';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import CallQueuePanel from './-components/CallQueuePanel';

export const Route = createLazyFileRoute('/calling/call-queue/')({
    component: CallQueuePage,
});

function CallQueuePage() {
    const instituteId = getCurrentInstituteId() ?? '';
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading('Call Queue');
    }, [setNavHeading]);

    return (
        <LayoutContainer>
            <Helmet>
                <title>Call Queue</title>
            </Helmet>
            <div className="flex flex-col gap-5 p-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                            <ListNumbers size={20} weight="duotone" />
                        </span>
                        <div>
                            <h1 className="text-h3 font-semibold text-neutral-900">Call Queue</h1>
                            <p className="max-w-2xl text-body text-neutral-500">
                                AI calls waiting to go out, and the ones on a call right now. Calls
                                leave the queue automatically — cancel any you no longer want
                                placed.
                            </p>
                        </div>
                    </div>
                    <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-caption text-neutral-600">
                        Refreshes every 10 s
                    </span>
                </div>

                {!instituteId ? (
                    <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-700">
                        Pick an institute to view its call queue.
                    </div>
                ) : (
                    <CallQueuePanel instituteId={instituteId} />
                )}
            </div>
        </LayoutContainer>
    );
}
