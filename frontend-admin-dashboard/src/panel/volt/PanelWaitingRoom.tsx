/**
 * Lobby before a live session starts: a large QR + join code students can read
 * from the back of the room, the live participant count and names (no per-join
 * toasts), Start and Cancel.
 *
 * Replaces components/SessionWaitingRoom.tsx (220 px qr-code-styling QR, its
 * own EventSource). Participants come from the ONE presenter SSE owned by
 * usePanelVoltSession, so this component opens no connection of its own.
 */
import { useState } from 'react';
import QRCode from 'react-qr-code';
import { useTranslation } from 'react-i18next';
import { Play, Users, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { ENGAGE_DOMAIN } from '../config';
import { PanelConfirmDialog } from '../components/PanelConfirmDialog';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelTopBar } from '../components/PanelTopBar';
import { goBack } from '../router';
import { SseStatusChip } from './SseStatusChip';
import type { PresenterSseStatus } from './presenterSse';
import type { VoltParticipant } from './types';

const MAX_NAMES = 36;

export function inviteUrl(inviteCode: string): string {
    return `https://${ENGAGE_DOMAIN}/${inviteCode}`;
}

export function participantName(participant: VoltParticipant): string {
    return participant.name || participant.username || participant.email || '';
}

/** White box + QR. The quiet zone must stay white in any theme for scanners. */
export function JoinQr({ inviteCode, className }: { inviteCode: string; className?: string }) {
    return (
        <div
            className={cn(
                'flex items-center justify-center rounded-lg bg-white p-6 shadow-sm',
                className
            )}
        >
            {/* viewBox + size-full: the QR contain-fits whatever box it is given. */}
            <QRCode value={inviteUrl(inviteCode)} size={256} level="M" className="size-full" />
        </div>
    );
}

/** Join instructions: domain/link and the big code. */
export function JoinDetails({ inviteCode }: { inviteCode: string }) {
    const { t } = useTranslation('volt');
    return (
        <div className="space-y-4">
            <p className="text-h3 text-neutral-600">{t('join.instructions')}</p>
            <p className="break-all text-h2 font-semibold text-neutral-800">
                {`${ENGAGE_DOMAIN}/${inviteCode}`}
            </p>
            <div className="space-y-1 pt-2">
                <p className="text-title text-neutral-500">{t('join.codeLabel')}</p>
                {/* 10-foot: the code must be readable from the back row, so it is far
                    larger than text-h1 (Tailwind's rem scale; like the panel's rem type
                    tokens it grows with html.panel-root). */}
                <p className="font-mono text-6xl font-bold tracking-widest text-primary-500">
                    {inviteCode}
                </p>
            </div>
        </div>
    );
}

export interface PanelWaitingRoomProps {
    title: string;
    inviteCode: string;
    participants: VoltParticipant[];
    sseStatus: PresenterSseStatus;
    onReconnect: () => void;
    onStart: () => Promise<void>;
    /** Ends the session on the server; the caller navigates away. */
    onCancelSession: () => Promise<void>;
}

export function PanelWaitingRoom({
    title,
    inviteCode,
    participants,
    sseStatus,
    onReconnect,
    onStart,
    onCancelSession,
}: PanelWaitingRoomProps) {
    const { t } = useTranslation('volt');
    const [confirmCancel, setConfirmCancel] = useState(false);
    const shown = participants.slice(0, MAX_NAMES);
    const extra = participants.length - shown.length;

    return (
        <PanelStage>
            <PanelTopBar
                title={title || t('waiting.title')}
                onBack={goBack}
                actions={<SseStatusChip status={sseStatus} onReconnect={onReconnect} />}
            />
            <PanelStageBody className="p-8">
                <div className="grid h-full min-h-0 grid-cols-2 gap-10">
                    <JoinQr inviteCode={inviteCode} className="h-full min-h-0" />

                    {/* Start/Cancel stay pinned at the bottom: the name list scrolls on its
                        own (a 30-40 student class used to push Start below the fold). On a
                        short TV screen the details + list scroll as one block above them. */}
                    <div className="flex min-h-0 flex-col">
                        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                            <div className="shrink-0">
                                <JoinDetails inviteCode={inviteCode} />
                            </div>

                            <div className="mt-6 flex min-h-40 flex-1 flex-col border-t border-border pt-6">
                                <p className="flex shrink-0 items-center space-x-3 text-h2 font-semibold text-neutral-800">
                                    <Users size={36} aria-hidden />
                                    <span role="status">
                                        {t('waiting.joinedCount', { count: participants.length })}
                                    </span>
                                </p>
                                {participants.length === 0 ? (
                                    <p className="mt-3 shrink-0 text-title text-neutral-500">
                                        {t('waiting.nobodyYet')}
                                    </p>
                                ) : (
                                    <ul className="mt-3 grid min-h-0 flex-1 grid-cols-3 content-start gap-3 overflow-y-auto">
                                        {shown.map((participant, index) => (
                                            <li
                                                key={
                                                    participant.user_id ||
                                                    participant.username ||
                                                    index
                                                }
                                                className="truncate rounded-md bg-muted px-3 py-2 text-title text-neutral-700"
                                            >
                                                {participantName(participant)}
                                            </li>
                                        ))}
                                        {extra > 0 && (
                                            <li className="px-3 py-2 text-title text-neutral-500">
                                                {t('waiting.more', { count: extra })}
                                            </li>
                                        )}
                                    </ul>
                                )}
                            </div>
                        </div>

                        <div className="mt-6 grid shrink-0 grid-cols-2 gap-4">
                            <MyButton
                                buttonType="primary"
                                scale="large"
                                className="h-16 w-full px-6 sm:min-w-0"
                                onAsyncClick={onStart}
                            >
                                <span className="flex items-center space-x-3">
                                    <Play size={28} weight="fill" aria-hidden />
                                    <span>{t('waiting.start')}</span>
                                </span>
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 w-full px-6 sm:min-w-0"
                                onClick={() => setConfirmCancel(true)}
                            >
                                <span className="flex items-center space-x-3">
                                    <X size={28} aria-hidden />
                                    <span>{t('waiting.cancel')}</span>
                                </span>
                            </MyButton>
                        </div>
                    </div>
                </div>
            </PanelStageBody>

            <PanelConfirmDialog
                open={confirmCancel}
                onOpenChange={setConfirmCancel}
                title={t('waiting.cancelTitle')}
                description={t('waiting.cancelBody')}
                confirmLabel={t('waiting.cancelConfirm')}
                onConfirm={onCancelSession}
            />
        </PanelStage>
    );
}

export default PanelWaitingRoom;
