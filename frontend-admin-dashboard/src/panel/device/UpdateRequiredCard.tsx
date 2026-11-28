/**
 * Phase 2: the sign-in card's `updateRequired` view (UPDATE_REQUIRED), in place of the QR.
 * Loaded only when that refusal is shown (refusedViews.ts).
 */
import { useTranslation } from 'react-i18next';
import { ArrowCircleUp } from '@phosphor-icons/react';
import { RefusedLayout } from './LicenceCard';
import { ensurePhase2Strings } from './phase2Strings';
import { UpdateControls } from './UpdateBar';
import { useUpdateState } from './updateOffer';

export interface UpdateRequiredCardProps {
    /** "Check again": retries the sign-in at once. */
    onRetry: () => void;
}

export function UpdateRequiredCard({ onRetry }: UpdateRequiredCardProps) {
    ensurePhase2Strings();
    const { t } = useTranslation('panel');
    const update = useUpdateState();
    return (
        <RefusedLayout
            icon={<ArrowCircleUp size={64} className="text-warning-500" aria-hidden />}
            title={t('update.requiredTitle')}
            body={t('update.requiredBody')}
            onRetry={onRetry}
        >
            {update.available && update.offer && update.phase !== 'none' ? (
                <UpdateControls centered className="w-full max-w-2xl" />
            ) : (
                <p className="max-w-2xl text-subtitle text-neutral-500">
                    {t('update.requiredNoUpdater')}
                </p>
            )}
        </RefusedLayout>
    );
}
