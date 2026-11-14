/**
 * The Start button for one class. hostActions decides what should happen; this
 * opens it at top level. A popup would be blocked after the wait Meet needs.
 */
import { useMemo, useState } from 'react';
import type { TodayClass } from '@/classroom-shared/apiTypes';
import {
    createHostActions,
    type HostActionResult,
    type HostProgress,
} from '@/classroom-shared/hostActions';
import { request } from '../lib/http';
import { useStrings } from '../strings';
import { ActionButton } from './ui';

type View =
    | { kind: 'idle' }
    | { kind: 'running'; progress?: HostProgress }
    | { kind: 'confirm-new-room'; scheduleId: string }
    | { kind: 'message'; text: string };

export function StartClass({
    item,
    instituteId,
    secondary,
}: {
    item: TodayClass;
    instituteId: string;
    secondary?: boolean;
}) {
    const s = useStrings();
    const [view, setView] = useState<View>({ kind: 'idle' });

    const actions = useMemo(
        () =>
            createHostActions(
                async (path, params) => {
                    const { status, data } = await request<unknown>(path, {
                        query: params,
                        bearer: true,
                        clientId: instituteId,
                    });
                    return { status, data };
                },
                { onProgress: (progress) => setView({ kind: 'running', progress }) }
            ),
        [instituteId]
    );

    const action = actions.resolveHostAction({
        sessionId: item.session_id,
        scheduleId: item.schedule_id,
        linkType: item.link_type,
        streamingType: item.streaming_type,
        externalLink: item.external_link,
    });

    const handle = (result: HostActionResult): void => {
        switch (result.kind) {
            // Back from the meeting can restore this page, so do not leave it on "Please wait".
            case 'open-url':
                setView({ kind: 'idle' });
                window.location.assign(result.url);
                return;
            case 'open-route':
                setView({ kind: 'idle' });
                window.location.assign(result.path);
                return;
            case 'meeting-ended':
                setView({ kind: 'confirm-new-room', scheduleId: result.scheduleId });
                return;
            case 'recreate-blocked':
                setView({ kind: 'message', text: result.message ?? s.recreateBlocked });
                return;
            case 'provisioning':
                setView({ kind: 'message', text: s.provisioningFailed });
                return;
            case 'no-url':
                setView({ kind: 'message', text: s.noJoinLink });
                return;
            case 'failed':
                setView({
                    kind: 'message',
                    text: result.status === null ? s.noConnection : s.startFailed,
                });
                return;
        }
    };

    if (!action) {
        return <p className="text-body text-muted-foreground">{s.noClassLink}</p>;
    }

    const start = () => {
        setView({ kind: 'running' });
        void action.run().then(handle);
    };

    if (view.kind === 'confirm-new-room') {
        return (
            <div className="flex flex-col gap-2" data-state="meeting-ended">
                <p className="text-subtitle text-foreground">{s.meetingEndedTitle}</p>
                <p className="text-body text-muted-foreground">{s.meetingEndedBody}</p>
                <ActionButton
                    onClick={() => {
                        setView({ kind: 'running' });
                        void actions.startBbb(view.scheduleId, true).then(handle);
                    }}
                >
                    {s.meetingEndedConfirm}
                </ActionButton>
                <ActionButton secondary onClick={() => setView({ kind: 'idle' })}>
                    {s.cancel}
                </ActionButton>
            </div>
        );
    }

    const running = view.kind === 'running';
    return (
        <div className="flex flex-col gap-2">
            <ActionButton secondary={secondary} disable={running} onClick={start}>
                {running ? s.working : s.start}
            </ActionButton>
            {running && view.progress && (
                <p role="status" className="text-body text-muted-foreground">
                    {view.progress === 'COHOST_SETTLING' ? s.settlingCohost : s.provisioningMeet}
                </p>
            )}
            {view.kind === 'message' && (
                <p role="alert" data-state="start-message" className="text-body text-danger-600">
                    {view.text}
                </p>
            )}
        </div>
    );
}
