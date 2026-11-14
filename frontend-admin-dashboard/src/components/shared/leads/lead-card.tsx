import { useTranslation } from 'react-i18next';
import { Phone, Megaphone, CalendarBlank, Robot, NotePencil } from '@phosphor-icons/react';
import { TatStatusBadge } from '@/components/shared/tat-status-badge';
import { CallPickerPopover } from './call-picker-popover';
import { cn } from '@/lib/utils';
import type { LeadProfileSummary } from '@/hooks/use-lead-profiles';
import type { LeadCardVM } from './lead-view-model';
import type { LeadActionHandlers } from './lead-actions';
import { LeadAvatar } from './lead-avatar';
import { LeadStageChip } from './lead-stage-chip';
import { LeadScoreBar } from './lead-score-bar';
import { LeadCounsellor } from './lead-counsellor';
import { LeadActionsMenu } from './lead-actions-menu';

/**
 * LeadCard — the "Deals Pipeline"-style card rendered inside board columns.
 * Pure presentational: no hooks, no fetching. The parent resolves the profile
 * from the cached batch and passes it in.
 */

interface LeadCardProps {
    vm: LeadCardVM;
    profile?: LeadProfileSummary;
    showScore: boolean;
    showOps: boolean;
    actions: LeadActionHandlers;
}

/** Follow-up due as "5 Oct, 4:30 pm"; the backend sends UTC without a zone marker. */
const dueText = (iso?: string | null) => {
    if (!iso) return null;
    const normalized = /Z$|[+-]\d{2}:?\d{2}$/i.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
    });
};

/**
 * Board card: stage + SLA badge on top, phone first, score bar with the next
 * follow-up, a quick-action row (call / AI call / note) and owner + submitted date.
 */
export function LeadCard({ vm, profile, showScore, showOps, actions }: LeadCardProps) {
    const { t } = useTranslation('crmPages');
    const callGate = actions.onCallLead && actions.canCall ? actions.canCall(vm) : null;
    const aiGateFn = actions.canAiCall ?? actions.canCall;
    const aiGate = actions.onAiCallLead && aiGateFn ? aiGateFn(vm) : null;
    const due = dueText(vm.followUpDueAt);
    const stop = (e: React.MouseEvent) => e.stopPropagation();
    const quick =
        'inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-neutral-200 bg-white text-xs text-neutral-600 transition hover:border-primary-300 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-50';
    return (
        <div
            onClick={() => actions.onOpenDetails(vm)}
            className="group cursor-pointer rounded-lg border border-neutral-200 bg-white p-3 shadow-sm transition-all hover:border-primary-200 hover:shadow"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {showOps && (
                        <LeadStageChip
                            tier={profile?.lead_tier}
                            conversionStatus={profile?.conversion_status}
                        />
                    )}
                    <TatStatusBadge
                        tatOverdue={vm.tatOverdue}
                        tatDueSoon={vm.tatDueSoon}
                        followUpOverdue={vm.followUpOverdue}
                    />
                </div>
                <LeadActionsMenu
                    vm={vm}
                    currentTier={profile?.lead_tier}
                    showOps={showOps}
                    actions={actions}
                    className="-mr-1 -mt-1"
                />
            </div>

            <div className="mt-2 flex items-center gap-2">
                <LeadAvatar name={vm.name} size="sm" />
                <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900">{vm.name}</p>
                    {vm.phone !== '-' && (
                        <p className="truncate text-xs font-medium tabular-nums text-neutral-700">
                            {vm.phone}
                        </p>
                    )}
                    {vm.email !== '-' && vm.email !== vm.name && (
                        <p className="truncate text-xs text-neutral-500" title={vm.email}>
                            {vm.email}
                        </p>
                    )}
                </div>
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 truncate text-xs text-neutral-500">
                <Megaphone className="size-3 shrink-0 text-neutral-400" />
                <span className="truncate">{vm.audience}</span>
            </p>

            {(showScore && profile) || due ? (
                <div className="mt-2 flex items-center gap-2">
                    {showScore && profile && (
                        <div className="min-w-0 flex-1">
                            <LeadScoreBar score={profile.best_score} />
                        </div>
                    )}
                    {due && (
                        <span
                            className={cn(
                                'flex shrink-0 items-center gap-1 text-xs',
                                vm.followUpOverdue
                                    ? 'font-semibold text-danger-600'
                                    : 'text-neutral-500'
                            )}
                            title={t('leadCard.nextFollowUp')}
                        >
                            <CalendarBlank className="size-3" />
                            {due}
                        </span>
                    )}
                </div>
            ) : null}

            <div className="mt-2.5 flex gap-1.5" onClick={stop}>
                {callGate && (
                    <CallPickerPopover
                        leadUserId={vm.userId}
                        disabled={!callGate.allowed}
                        disabledReason={callGate.reason}
                        onConfirm={(preferredNumberId) =>
                            actions.onCallLead?.(vm, preferredNumberId)
                        }
                        trigger={
                            <button
                                type="button"
                                className={quick}
                                disabled={!callGate.allowed}
                                title={
                                    callGate.allowed
                                        ? t('leadCard.callTitle')
                                        : callGate.reason ?? t('leadCard.callTitle')
                                }
                                onClick={stop}
                            >
                                <Phone weight="fill" className="size-3.5" />
                                {t('leadCard.call')}
                            </button>
                        }
                    />
                )}
                {aiGate && (
                    <button
                        type="button"
                        className={quick}
                        disabled={!aiGate.allowed}
                        title={
                            aiGate.allowed
                                ? t('leadCard.aiTitle')
                                : aiGate.reason ?? t('leadCard.aiTitle')
                        }
                        onClick={(e) => {
                            stop(e);
                            if (aiGate.allowed) actions.onAiCallLead?.(vm);
                        }}
                    >
                        <Robot weight="fill" className="size-3.5" />
                        {t('leadCard.ai')}
                    </button>
                )}
                {actions.onAddNote && vm.userId && (
                    <button
                        type="button"
                        className={quick}
                        title={t('leadCard.noteTitle')}
                        onClick={(e) => {
                            stop(e);
                            actions.onAddNote?.(vm.userId!, vm.name, vm.responseId);
                        }}
                    >
                        <NotePencil className="size-3.5" />
                        {t('leadCard.note')}
                    </button>
                )}
            </div>

            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-neutral-100 pt-2">
                {showOps && vm.userId ? (
                    <LeadCounsellor
                        counsellorName={profile?.assigned_counselor_name}
                        counsellorId={profile?.assigned_counselor_id}
                        onAssign={
                            actions.onAssignCounsellor
                                ? () => actions.onAssignCounsellor!(vm.userId!, vm.name)
                                : undefined
                        }
                    />
                ) : (
                    <span />
                )}
                <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-400">
                    {vm.submittedDisplay}
                </span>
            </div>
        </div>
    );
}
