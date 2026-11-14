/**
 * Phase 2: app update UI (direct build only; see updateOffer.ts).
 *
 *   <UpdateBar placement="signin" | "pair" />  "Update ready — Install", signed out only.
 *                                              Renders nothing while a session exists, in a
 *                                              meeting, or in a build without the updater.
 *
 * The `updateRequired` view (UPDATE_REQUIRED) is UpdateRequiredCard.tsx, loaded only
 * when that refusal is shown.
 */
import { useTranslation } from 'react-i18next';
import { ArrowCircleUp } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { usePanelSession } from '../lib/session';
import { isMeetingOpen } from './activity';
import { ensurePhase2Strings } from './phase2Strings';
import { installUpdate, useUpdateState } from './updateOffer';

export interface UpdateBarProps {
    placement: 'signin' | 'pair';
}

/** Progress, Install and the permission hint. Null when there is nothing to show. */
export function UpdateControls({
    centered,
    className,
}: {
    centered?: boolean;
    className?: string;
}) {
    ensurePhase2Strings();
    const { t } = useTranslation('panel');
    const { isSignedIn } = usePanelSession();
    const update = useUpdateState();
    const offer = update.offer;
    if (isSignedIn || !update.available || !offer || isMeetingOpen()) return null;
    if (update.phase === 'none') return null;
    if (update.phase === 'downloading') {
        return (
            <p
                className={cn('text-center text-subtitle text-neutral-500', className)}
                role="status"
            >
                {update.progress === null
                    ? t('update.downloadingNoProgress')
                    : t('update.downloading', { progress: update.progress })}
            </p>
        );
    }
    return (
        <div
            className={cn(
                'flex items-center rounded-lg border border-primary-200 bg-primary-50 p-4',
                centered ? 'justify-center' : 'justify-between',
                className
            )}
        >
            <div className="flex min-w-0 items-center space-x-3 text-left">
                <ArrowCircleUp size={40} className="shrink-0 text-primary-500" aria-hidden />
                <div className="min-w-0">
                    <p className="text-title font-semibold text-neutral-800">{t('update.ready')}</p>
                    <p className="text-subtitle text-neutral-600">
                        {update.phase === 'needsPermission'
                            ? t('update.needsPermission')
                            : t('update.readyBody', { version: offer.version_name })}
                    </p>
                </div>
            </div>
            <div className="shrink-0 pl-4">
                <MyButton
                    buttonType="primary"
                    scale="large"
                    className="h-16 px-8"
                    disable={update.phase === 'installing'}
                    onClick={() => void installUpdate()}
                >
                    {update.phase === 'installing' ? t('update.installing') : t('update.install')}
                </MyButton>
            </div>
        </div>
    );
}

export function UpdateBar({ placement }: UpdateBarProps) {
    return (
        <UpdateControls
            className={placement === 'pair' ? 'mx-auto mt-6 w-full max-w-3xl' : 'mt-4 w-full'}
        />
    );
}
