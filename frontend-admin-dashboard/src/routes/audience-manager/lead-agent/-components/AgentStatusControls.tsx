import { useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StatusChip } from '@/components/design-system/status-chips';
import { Switch } from '@/components/ui/switch';
import type { AgentStatus, LeadAgent } from '../-types';
import { useSetAgentStatus } from '../-hooks/use-lead-agent';
import { AutomationWarning } from './AgentFormSections';

export const AgentStatusChip = ({ status }: { status: AgentStatus }) => (
    <StatusChip
        text={status === 'ACTIVE' ? 'Active' : status === 'PAUSED' ? 'Paused' : 'Archived'}
        status={status === 'ACTIVE' ? 'SUCCESS' : status === 'PAUSED' ? 'WARNING' : 'INFO'}
        textSize="text-caption"
        showIcon={false}
    />
);

/** "Turn on" asks first: delivered leads run the list's automations straight away. */
export function TurnOnDialog({
    open,
    onOpenChange,
    agent,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    agent: LeadAgent;
}) {
    const setStatus = useSetAgentStatus();
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Turn on {agent.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        It will find and research organisations now, and deliver up to{' '}
                        {agent.daily_quota} leads a day into{' '}
                        {agent.audience_name ? `“${agent.audience_name}”` : 'its lead list'} inside
                        the delivery window.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AutomationWarning />
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={setStatus.isPending}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        disabled={setStatus.isPending}
                        onClick={(e) => {
                            e.preventDefault();
                            setStatus.mutate(
                                { agentId: agent.id, status: 'ACTIVE' },
                                { onSuccess: () => onOpenChange(false) }
                            );
                        }}
                    >
                        {setStatus.isPending ? 'Turning on…' : 'Turn on'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/** On / off switch: pausing is immediate, turning on goes through TurnOnDialog. */
export function AgentStatusSwitch({ agent }: { agent: LeadAgent }) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const setStatus = useSetAgentStatus();
    const on = agent.status === 'ACTIVE';
    if (agent.status === 'ARCHIVED') return <AgentStatusChip status="ARCHIVED" />;
    return (
        <div className="flex items-center gap-2">
            <Switch
                checked={on}
                disabled={setStatus.isPending}
                onCheckedChange={(next) => {
                    if (next) setConfirmOpen(true);
                    else setStatus.mutate({ agentId: agent.id, status: 'PAUSED' });
                }}
                aria-label={on ? `Pause ${agent.name}` : `Turn on ${agent.name}`}
            />
            <AgentStatusChip status={agent.status} />
            <TurnOnDialog open={confirmOpen} onOpenChange={setConfirmOpen} agent={agent} />
        </div>
    );
}

/** Online dot + text for the extension workers. */
export const WorkersOnline = ({ count }: { count: number | undefined }) => {
    if (count === undefined) return null;
    const online = count > 0;
    return (
        <span className="inline-flex items-center gap-2 text-caption text-neutral-600">
            <span
                className={
                    online
                        ? 'size-2 rounded-full bg-success-500'
                        : 'size-2 rounded-full bg-neutral-300'
                }
                aria-hidden
            />
            {online
                ? `${count} ${count === 1 ? 'computer' : 'computers'} online`
                : 'No extension online'}
        </span>
    );
};
