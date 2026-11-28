/**
 * Phase 2: the sign-in card's `awaiting` view (AWAITING_APPROVAL), for a panel an
 * installer set up that the school has not approved yet. Rechecks as soon as a sync
 * reports the device approved.
 */
import { useTranslation } from 'react-i18next';
import { Hourglass } from '@phosphor-icons/react';
import { RefusedLayout, useRecheckOnSync } from './LicenceCard';
import { ensurePhase2Strings } from './phase2Strings';
import { useDeviceRecord } from './store';

export interface AwaitingCardProps {
    /** "Check again": retries the sign-in at once. */
    onRetry: () => void;
}

export function AwaitingCard({ onRetry }: AwaitingCardProps) {
    ensurePhase2Strings();
    const { t } = useTranslation('panel');
    const device = useDeviceRecord();
    useRecheckOnSync((sync) => sync.approvalState === 'APPROVED', onRetry);
    const school = device?.institute_name;
    return (
        <RefusedLayout
            icon={<Hourglass size={64} className="text-primary-500" aria-hidden />}
            title={t('approval.title')}
            body={school ? t('approval.body', { school }) : t('approval.bodyNoSchool')}
            onRetry={onRetry}
        />
    );
}
