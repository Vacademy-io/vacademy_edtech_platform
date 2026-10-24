import type { TFunction } from 'i18next';
import type {
    ActionStatus,
    ChannelKey,
    EngineLanguage,
    EngineStatus,
    ProposalStatus,
} from '../-types';

// StatusChip variants live in @/components/design-system/utils (getStatusChipColor). We map to
// simple semantic tones the badge component understands; keep the label human-friendly.
type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

// NOTE: these were plain module-scope constants (ENGINE_STATUS_META etc.) before this i18n pass.
// They are now `buildXxx(t)` factories per the admin i18n rollout convention (module-scope label
// data must be built from a caller-supplied `t`, not baked in at import time). Every consumer of
// the old constants (currently: index.lazy.tsx, $engineId.lazy.tsx, inbox/index.lazy.tsx,
// create/index.lazy.tsx, -components/TemplateNegotiation.tsx) still calls these as plain
// module-scope objects and needs a follow-up pass to call `buildXxx(t)` from a `useTranslation()`
// in the consuming component — that is out of scope for this batch (constants/hooks/services/
// types/utils only).

export const buildEngineStatusMeta = (
    t: TFunction
): Record<EngineStatus, { label: string; tone: Tone }> => ({
    DRAFT: { label: t('engineStatus.draft'), tone: 'neutral' },
    TEMPLATES_PENDING: { label: t('engineStatus.templatesPending'), tone: 'warning' },
    DRY_RUN: { label: t('engineStatus.dryRun'), tone: 'info' },
    ACTIVE: { label: t('engineStatus.active'), tone: 'success' },
    PAUSED: { label: t('engineStatus.paused'), tone: 'warning' },
    ARCHIVED: { label: t('engineStatus.archived'), tone: 'neutral' },
});

export const buildActionStatusMeta = (
    t: TFunction
): Record<ActionStatus, { label: string; tone: Tone }> => ({
    OPEN: { label: t('actionStatus.open'), tone: 'info' },
    ACKED: { label: t('actionStatus.acked'), tone: 'info' },
    DISPATCHING: { label: t('actionStatus.dispatching'), tone: 'warning' },
    SENT: { label: t('actionStatus.sent'), tone: 'success' },
    FAILED: { label: t('actionStatus.failed'), tone: 'danger' },
    DONE: { label: t('actionStatus.done'), tone: 'success' },
    DISMISSED: { label: t('actionStatus.dismissed'), tone: 'neutral' },
    EXPIRED: { label: t('actionStatus.expired'), tone: 'neutral' },
    SIMULATED: { label: t('actionStatus.simulated'), tone: 'neutral' },
});

export const buildProposalStatusMeta = (
    t: TFunction
): Record<ProposalStatus, { label: string; tone: Tone }> => ({
    AI_PROPOSED: { label: t('proposalStatus.aiProposed'), tone: 'info' },
    USER_REVIEW: { label: t('proposalStatus.userReview'), tone: 'warning' },
    USER_APPROVED: { label: t('proposalStatus.userApproved'), tone: 'info' },
    SUBMITTED: { label: t('proposalStatus.submitted'), tone: 'warning' },
    META_PENDING: { label: t('proposalStatus.metaPending'), tone: 'warning' },
    META_APPROVED: { label: t('proposalStatus.metaApproved'), tone: 'success' },
    META_REJECTED: { label: t('proposalStatus.metaRejected'), tone: 'danger' },
    META_RECATEGORISED: { label: t('proposalStatus.metaRecategorised'), tone: 'warning' },
    SUPERSEDED: { label: t('proposalStatus.superseded'), tone: 'neutral' },
    WITHDRAWN: { label: t('proposalStatus.withdrawn'), tone: 'neutral' },
});

export const buildLanguageOptions = (
    t: TFunction
): { label: string; value: EngineLanguage }[] => [
    { label: t('language.english'), value: 'en' },
    { label: t('language.hindi'), value: 'hi' },
    { label: t('language.hinglish'), value: 'hinglish' },
];

export const buildChannelMeta = (
    t: TFunction
): Record<ChannelKey, { label: string; supportsAuto: boolean; supportsAutoReply: boolean }> => ({
    WHATSAPP: { label: t('channel.whatsapp'), supportsAuto: true, supportsAutoReply: true },
    EMAIL: { label: t('channel.email'), supportsAuto: true, supportsAutoReply: false },
    IN_APP: { label: t('channel.inApp'), supportsAuto: true, supportsAutoReply: false },
    AI_CALL: { label: t('channel.aiCall'), supportsAuto: false, supportsAutoReply: false },
});

export const CHANNEL_ORDER: ChannelKey[] = ['WHATSAPP', 'EMAIL', 'IN_APP', 'AI_CALL'];

export const buildTemplateCategoryOptions = (
    t: TFunction
): { label: string; value: string }[] => [
    { label: t('templateCategory.marketing'), value: 'MARKETING' },
    { label: t('templateCategory.utility'), value: 'UTILITY' },
    { label: t('templateCategory.authentication'), value: 'AUTHENTICATION' },
];

/** Statuses that count as usable/live for the activation gate (mirrors backend findApproved). */
export const APPROVED_PROPOSAL_STATUSES: ProposalStatus[] = ['META_APPROVED', 'META_RECATEGORISED'];

/** Which engine statuses the UI lets you move to from a given status. Mirrors backend transition(). */
export const NEXT_STATUSES: Partial<Record<EngineStatus, EngineStatus[]>> = {
    // The backend archives from any state; a draft that will never go live must be archivable.
    DRAFT: ['DRY_RUN', 'ACTIVE', 'ARCHIVED'],
    TEMPLATES_PENDING: ['DRY_RUN', 'ACTIVE', 'ARCHIVED'],
    DRY_RUN: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
    ACTIVE: ['PAUSED'],
    PAUSED: ['ACTIVE', 'ARCHIVED'],
};
