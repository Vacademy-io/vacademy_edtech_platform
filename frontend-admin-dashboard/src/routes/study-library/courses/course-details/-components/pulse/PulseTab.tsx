import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/utils';
import RosterView from './RosterView';
import ContentMapView from './ContentMapView';
import LiveFeedView from './LiveFeedView';

type PulseView = 'ROSTER' | 'CONTENT_MAP' | 'FEED';

const buildViews = (t: TFunction): { value: PulseView; label: string }[] => [
    { value: 'ROSTER', label: t('roster') },
    { value: 'CONTENT_MAP', label: t('contentMap') },
    { value: 'FEED', label: t('liveFeed') },
];

export default function PulseTab({ packageSessionId }: { packageSessionId: string }) {
    const { t } = useTranslation('studyLibraryPulseTab');
    const batchId = (packageSessionId ?? '').split(',')[0] ?? '';
    const [view, setView] = useState<PulseView>('ROSTER');
    const VIEWS = buildViews(t);

    if (!batchId) {
        return (
            <div className="rounded-md bg-white p-6 text-center text-sm text-neutral-500 shadow-sm">
                {t('selectBatch')}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 p-1">
            {/* View switch */}
            <div className="inline-flex w-fit gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
                {VIEWS.map((v) => (
                    <button
                        key={v.value}
                        type="button"
                        onClick={() => setView(v.value)}
                        className={cn(
                            'rounded-md px-3.5 py-1.5 text-sm transition-colors',
                            view === v.value
                                ? 'bg-white font-semibold text-neutral-800 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                        )}
                    >
                        {v.label}
                    </button>
                ))}
            </div>

            {/* Each view owns its poll (query enabled only while mounted), so only the
                visible view hits the backend. */}
            {view === 'ROSTER' && <RosterView batchId={batchId} />}
            {view === 'CONTENT_MAP' && <ContentMapView batchId={batchId} active />}
            {view === 'FEED' && <LiveFeedView batchId={batchId} active />}
        </div>
    );
}
