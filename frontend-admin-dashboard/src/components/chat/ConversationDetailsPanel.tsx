import type { ReactNode } from 'react';
import {
    ChatCircleDots,
    Flag,
    ShieldCheck,
    Trophy,
    UsersFour,
    UsersThree,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { ChatConversationResponse, ChatRulesResponse } from '@/services/chat/chatApi';

interface ConversationDetailsPanelProps {
    conversation: ChatConversationResponse;
    title: string;
    /** Community rules, when the open conversation is the community and they have loaded. */
    rules?: ChatRulesResponse | null;
    onEditRules?: () => void;
    onOpenLeaderboard?: () => void;
    onOpenReports: () => void;
}

const humanize = (v?: string) =>
    v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase().replace(/_/g, ' ') : '';

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-3 py-1">
            <dt className="shrink-0 text-neutral-500">
                <span className="text-caption">{label}</span>
            </dt>
            <dd className="min-w-0 break-words text-right text-neutral-800">
                <span className="text-caption">{children}</span>
            </dd>
        </div>
    );
}

function SectionTitle({ children }: { children: ReactNode }) {
    return (
        <h5 className="mb-1.5 font-semibold uppercase tracking-wide text-neutral-400">
            <span className="text-caption">{children}</span>
        </h5>
    );
}

/**
 * Right-hand context pane of the chat layout (wide screens only). Everything shown comes from the
 * conversation and rules the screen has already loaded — it makes no requests of its own.
 */
export function ConversationDetailsPanel({
    conversation,
    title,
    rules,
    onEditRules,
    onOpenLeaderboard,
    onOpenReports,
}: ConversationDetailsPanelProps) {
    const batch = getTerminology(ContentTerms.Batch, SystemTerms.Batch);
    const typeLabel =
        conversation.type === 'DIRECT'
            ? 'Direct message'
            : conversation.type === 'BATCH_GROUP'
              ? `${batch} group`
              : 'Community channel';
    const TypeIcon =
        conversation.type === 'COMMUNITY'
            ? UsersFour
            : conversation.type === 'BATCH_GROUP'
              ? UsersThree
              : ChatCircleDots;
    const posting = rules?.rules?.posting;
    const ackRequired = rules?.rules?.acknowledgement_required;

    return (
        <div className="flex h-full flex-col gap-5 overflow-y-auto p-4">
            <div className="flex flex-col items-center gap-2 text-center">
                <span
                    className={cn(
                        'flex size-12 items-center justify-center rounded-full',
                        conversation.type === 'COMMUNITY'
                            ? 'bg-primary-100 text-primary-600'
                            : conversation.type === 'BATCH_GROUP'
                              ? 'bg-info-50 text-info-600'
                              : 'bg-neutral-100 text-neutral-500'
                    )}
                >
                    <TypeIcon size={24} weight="duotone" />
                </span>
                <div className="min-w-0">
                    <p className="break-words font-semibold text-neutral-800">
                        <span className="text-body">{title}</span>
                    </p>
                    <p className="text-neutral-500">
                        <span className="text-caption">{typeLabel}</span>
                    </p>
                </div>
            </div>

            <div>
                <SectionTitle>About</SectionTitle>
                <dl className="divide-y divide-neutral-100">
                    <Row label="Type">{typeLabel}</Row>
                    {conversation.memberRole && (
                        <Row label="Your role">{humanize(conversation.memberRole)}</Row>
                    )}
                    <Row label="Posting">{conversation.canPost ? 'You can post' : 'Read-only'}</Row>
                    {conversation.type === 'COMMUNITY' && rules && (
                        <Row label="Guidelines">
                            {!ackRequired
                                ? 'No acceptance needed'
                                : rules.acknowledged
                                  ? 'Accepted'
                                  : 'Not accepted yet'}
                        </Row>
                    )}
                    {posting?.slow_mode_seconds ? (
                        <Row label="Slow mode">{`${posting.slow_mode_seconds}s`}</Row>
                    ) : null}
                </dl>
            </div>

            {(onEditRules || onOpenLeaderboard) && (
                <div>
                    <SectionTitle>Actions</SectionTitle>
                    <div className="flex flex-col gap-2">
                        {onOpenLeaderboard && (
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={onOpenLeaderboard}
                                className="w-full gap-1.5"
                            >
                                <Trophy size={16} weight="fill" />
                                Leaderboard
                            </MyButton>
                        )}
                        {onEditRules && (
                            <MyButton
                                buttonType="secondary"
                                scale="medium"
                                onClick={onEditRules}
                                className="w-full gap-1.5"
                            >
                                <ShieldCheck size={16} />
                                Edit rules
                            </MyButton>
                        )}
                    </div>
                </div>
            )}

            <div>
                <SectionTitle>Moderation</SectionTitle>
                <button
                    type="button"
                    onClick={onOpenReports}
                    className="flex w-full items-start gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-left transition-colors hover:border-primary-200 hover:bg-primary-50"
                >
                    <Flag size={16} weight="duotone" className="mt-0.5 shrink-0 text-danger-500" />
                    <span className="text-neutral-600">
                        <span className="text-caption">
                            Reported and auto-flagged messages are reviewed in Reports review.
                        </span>
                    </span>
                </button>
            </div>
        </div>
    );
}
