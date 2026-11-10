/**
 * Phase 2: the sign-in card's `licence` view (LICENCE_REQUIRED) and the layout the three
 * refused views share (licence, awaiting, updateRequired). Loaded only when a refusal is
 * shown (refusedViews.ts); the GRACE chip, shown on the plain card, is LicenceGraceChip.tsx.
 *
 * A refused view keeps the whiteboard (SignInCard renders it below), rechecks on its own
 * every 5 minutes (signInFlow), and rechecks at once on "Check again" or when a sync says
 * the room can sign in again.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Certificate } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type { PanelRoomLicenceState } from '@/classroom-shared/apiTypes';
import { ensurePhase2Strings } from './phase2Strings';
import { useDeviceRecord } from './store';
import { syncNow, useSyncSnapshot, type PanelSyncSnapshot } from './syncLoop';

export interface LicenceCardProps {
    /** "Check again": retries the sign-in at once. */
    onRetry: () => void;
}

const CAN_SIGN_IN: PanelRoomLicenceState[] = ['LICENSED', 'GRACE', 'UNMANAGED'];

/** Calls onRetry after a new sync answer that says the refusal is over. */
export function useRecheckOnSync(
    resolved: (snapshot: PanelSyncSnapshot) => boolean,
    onRetry: () => void
): void {
    const sync = useSyncSnapshot();
    const seen = useRef(sync.lastSyncAt);
    const latest = useRef({ resolved, onRetry });
    latest.current = { resolved, onRetry };
    useEffect(() => {
        if (sync.lastSyncAt === seen.current) return;
        seen.current = sync.lastSyncAt;
        if (latest.current.resolved(sync)) latest.current.onRetry();
    }, [sync]);
}

export function RefusedLayout({
    icon,
    title,
    body,
    onRetry,
    children,
}: {
    icon: ReactNode;
    title: string;
    body: string;
    onRetry: () => void;
    children?: ReactNode;
}) {
    ensurePhase2Strings();
    const { t } = useTranslation('panel');
    return (
        <div className="flex flex-col items-center space-y-4 p-8 text-center" role="status">
            {icon}
            <h2 className="text-h2 font-semibold text-neutral-800">{title}</h2>
            <p className="max-w-2xl text-title text-neutral-600">{body}</p>
            {children}
            <div className="pt-2">
                <MyButton
                    buttonType="primary"
                    scale="large"
                    className="h-16 px-8"
                    onClick={() => {
                        onRetry();
                        syncNow();
                    }}
                >
                    {t('licence.checkAgain')}
                </MyButton>
            </div>
        </div>
    );
}

export function LicenceCard({ onRetry }: LicenceCardProps) {
    ensurePhase2Strings();
    const { t } = useTranslation('panel');
    const device = useDeviceRecord();
    const { licence } = useSyncSnapshot();
    useRecheckOnSync(
        (sync) =>
            !sync.licence || !sync.licence.enforced || CAN_SIGN_IN.indexOf(sync.licence.state) >= 0,
        onRetry
    );
    const expired = licence?.state === 'EXPIRED';
    const room = device?.room_name;
    return (
        <RefusedLayout
            icon={<Certificate size={64} className="text-warning-500" aria-hidden />}
            title={expired ? t('licence.expiredTitle') : t('licence.title')}
            body={
                expired
                    ? t('licence.expiredBody')
                    : room
                      ? t('licence.body', { room })
                      : t('licence.bodyNoRoom')
            }
            onRetry={onRetry}
        />
    );
}
