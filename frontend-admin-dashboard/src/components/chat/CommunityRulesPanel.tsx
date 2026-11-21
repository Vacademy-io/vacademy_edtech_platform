import { CheckCircle, Info, PencilSimple, ShieldCheck, SpinnerGap } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import type { ChatRulesResponse } from '@/services/chat/chatApi';

interface CommunityRulesPanelProps {
    rules: ChatRulesResponse;
    isAcknowledging: boolean;
    onAcknowledge: () => void;
    onEdit?: () => void;
}

/**
 * Read-only view of the community rules. When acknowledgement is required and
 * not yet given, the Accept button is the gate the composer sits behind.
 */
export function CommunityRulesPanel({
    rules,
    isAcknowledging,
    onAcknowledge,
    onEdit,
}: CommunityRulesPanelProps) {
    const dto = rules.rules;
    const guidelines = dto?.guidelines;
    const posting = dto?.posting;
    const ackRequired = dto?.acknowledgement_required;
    const needsAccept = ackRequired && !rules.acknowledged;

    return (
        <div className="mx-4 mt-3 shrink-0 rounded-xl border border-success-100 bg-success-50 px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <ShieldCheck size={18} weight="duotone" className="text-success-600" />
                    <span className="text-sm font-semibold text-neutral-800">
                        {guidelines?.title || 'Community Guidelines'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {rules.acknowledged && (
                        <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-success-600">
                            <CheckCircle size={14} weight="fill" /> Accepted
                        </span>
                    )}
                    {rules.canEdit && onEdit && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onEdit}
                            className="h-7 gap-1 bg-white px-2 text-xs"
                        >
                            <PencilSimple size={13} /> Edit Rules
                        </Button>
                    )}
                </div>
            </div>

            {guidelines?.items && guidelines.items.length > 0 ? (
                <ul className="ml-1 space-y-1">
                    {guidelines.items.map((item, i) => (
                        <li
                            key={i}
                            className="flex items-start gap-2 text-xs leading-relaxed text-neutral-700"
                        >
                            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-neutral-400" />
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-neutral-500">
                    No specific guidelines have been published yet.
                </p>
            )}

            {posting && (posting.slow_mode_seconds || posting.new_member_readonly_minutes) ? (
                <div className="mt-2 flex flex-wrap gap-2 text-caption text-neutral-500">
                    {posting.slow_mode_seconds ? (
                        <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5">
                            <Info size={11} /> Slow mode: {posting.slow_mode_seconds}s
                        </span>
                    ) : null}
                    {posting.new_member_readonly_minutes ? (
                        <span className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5">
                            <Info size={11} /> New members read-only for{' '}
                            {posting.new_member_readonly_minutes} min
                        </span>
                    ) : null}
                </div>
            ) : null}

            {needsAccept && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-success-200 bg-white px-3 py-2">
                    <span className="text-xs text-neutral-600">
                        Accept the guidelines to post in this community.
                    </span>
                    <Button
                        size="sm"
                        disabled={isAcknowledging}
                        onClick={onAcknowledge}
                        className="bg-primary-500 text-white hover:opacity-90"
                    >
                        {isAcknowledging ? (
                            <SpinnerGap size={14} className="animate-spin" />
                        ) : (
                            'Accept'
                        )}
                    </Button>
                </div>
            )}
        </div>
    );
}
