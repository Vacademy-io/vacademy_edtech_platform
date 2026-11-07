import { useTranslation } from 'react-i18next';
import { ArrowCounterClockwise, CheckCircle, Clock, Robot } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Chip, KeyValue, SubHeading } from './engine-ui';
import { useCrmTaskAction } from '../-hooks/actions';
import { formatDateTime, safeParse } from '../-utils';
import type { EngagementAction } from '../-types';
import type { CrmTaskVariables } from '../-types/actions';

/** The brain's fields a person should see before approving, in this order. */
const FIELD_KEYS = ['statusKey', 'dueInHours', 'note', 'reason'] as const;

/**
 * B8: the inbox body of a CRM action task (follow-up, note, escalation, status change, AI call):
 * what will happen, the fields behind it, and Approve / Undo. Messages keep the draft + send flow.
 */
export function CrmTaskSection({ task, disabled }: { task: EngagementAction; disabled?: boolean }) {
    const { t } = useTranslation('engagementEnginesActions');
    const mutation = useCrmTaskAction();
    const vars = safeParse<CrmTaskVariables>(task.variablesJson, {});
    const fields = vars.action ?? {};
    const busy = disabled || mutation.isPending;

    const open = task.status === 'OPEN' || task.status === 'ACKED';
    const canApprove = task.kind === 'TASK' && open;
    const waiting = task.kind === 'SEND' && task.status === 'OPEN';
    const canUndo = task.status === 'DONE' && (task.outcome === 'ACCEPTED' || task.outcome === 'AUTO');
    const run = (verb: 'approve' | 'undo') => mutation.mutate({ taskId: task.id, verb });

    return (
        <div className="flex flex-col gap-3">
            <div>
                <SubHeading>{task.status === 'DONE' ? t('inbox.whatHappened') : t('inbox.whatWillHappen')}</SubHeading>
                <p className="whitespace-pre-wrap rounded-lg border border-neutral-100 bg-neutral-50 p-3 text-neutral-800">
                    <span className="text-body">{task.sentBody || task.draftBody || t('inbox.noDescription')}</span>
                </p>
                {FIELD_KEYS.some((k) => fields[k]) && (
                    <div className="mt-2">
                        {FIELD_KEYS.filter((k) => fields[k]).map((k) => (
                            <KeyValue key={k} label={t(`inbox.fields.${k}`)}>
                                {fields[k]}
                            </KeyValue>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                {task.outcome === 'AUTO' && (
                    <Chip icon={Robot} label={t('inbox.doneAuto')} className="bg-info-50 text-info-700" />
                )}
                {task.outcome === 'ACCEPTED' && task.status === 'DONE' && (
                    <Chip
                        icon={CheckCircle}
                        label={
                            vars.approvedByName
                                ? t('inbox.approvedBy', { name: vars.approvedByName })
                                : t('inbox.approved')
                        }
                        className="bg-success-50 text-success-700"
                    />
                )}
                {task.outcome === 'UNDONE' && <Chip icon={ArrowCounterClockwise} label={t('inbox.undone')} />}
                {waiting && (
                    <Chip
                        icon={Clock}
                        label={t('inbox.waitingUntil', { time: formatDateTime(task.scheduledFor) })}
                        className="bg-warning-50 text-warning-700"
                    />
                )}
            </div>

            {(canApprove || canUndo || waiting) && (
                <div className="flex flex-wrap items-center gap-2">
                    {canApprove && (
                        <MyButton buttonType="primary" scale="small" disable={busy} onClick={() => run('approve')}>
                            <CheckCircle className="me-1 size-3.5" /> {t('inbox.approve')}
                        </MyButton>
                    )}
                    {(canUndo || waiting) && (
                        <MyButton buttonType="secondary" scale="small" disable={busy} onClick={() => run('undo')}>
                            <ArrowCounterClockwise className="me-1 size-3.5" />{' '}
                            {waiting ? t('inbox.cancelCall') : t('inbox.undo')}
                        </MyButton>
                    )}
                </div>
            )}
        </div>
    );
}
