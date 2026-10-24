import {
    SquaresFour,
    BookOpen,
    TrendUp,
    Trophy,
    Wallet,
    Package,
    Target,
    ClipboardText,
    Key,
    Tag,
    Folder,
    FileText,
    ClockCounterClockwise,
    Bell,
    IdentificationCard,
    Buildings,
    Users,
    Path,
    Robot,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import type { StudentSideViewTabId } from '@/types/display-settings';

/** i18next namespace for this file's translated section labels. */
const NAV_GROUPS_NS = 'manageStudentsNavGroups';

/**
 * Section → group registry, per Vacademy design handoff
 * `LearnerProfile.jsx` SECTIONS + GROUP_ORDER.
 *
 * Used by the grouped left-rail navigation mode (208px sidebar with
 * uppercase group labels). The horizontal-tabs mode reads only the icon
 * and label, ignoring the group field.
 *
 * Each section answers ONE counsellor question; groups bundle questions
 * by mental model so the right tab is obvious without remembering names.
 */
export type SectionGroup =
    | 'Snapshot'
    | 'Learning'
    | 'Finance'
    | 'CRM'
    | 'Account'
    | 'Records';

/** Order groups render in the rail (top → bottom). */
export const GROUP_ORDER: SectionGroup[] = [
    'Snapshot',
    'Learning',
    'Finance',
    'CRM',
    'Account',
    'Records',
];

/**
 * Group → feature-module mapping. A client tenant can disable a whole
 * module via display-settings; when off, the whole group + its sections
 * disappear from the rail.
 *
 * Snapshot is always on (it has the Overview which is the entry surface).
 */
export const GROUP_TO_MODULE: Record<
    SectionGroup,
    'learning' | 'finance' | 'crm' | 'account' | 'records' | null
> = {
    Snapshot: null,
    Learning: 'learning',
    Finance: 'finance',
    CRM: 'crm',
    Account: 'account',
    Records: 'records',
};

/** Per-section metadata for the rail rendering. */
export interface SectionMeta {
    id: StudentSideViewTabId | 'subOrg';
    label: string;
    icon: PhosphorIcon;
    group: SectionGroup;
}

/**
 * Section registry. Order within a group is the display order.
 * Maps the existing 16+ tab IDs to the handoff's 14 sections plus the
 * 3 extras we carry on the side-view today (notifications, membership,
 * subOrg) — placed in the most natural group.
 */
export const SECTION_REGISTRY: readonly SectionMeta[] = [
    // Snapshot — the dashboard entry surface.
    { id: 'overview', label: 'Overview', icon: SquaresFour, group: 'Snapshot' },

    // Learning — "Are they progressing?"
    { id: 'courses', label: 'Courses', icon: BookOpen, group: 'Learning' },
    { id: 'learningProgress', label: 'Progress', icon: TrendUp, group: 'Learning' },
    { id: 'testRecord', label: 'Tests', icon: Trophy, group: 'Learning' },

    // Finance — "Are they paid up?"
    { id: 'paymentHistory', label: 'Payment History', icon: Wallet, group: 'Finance' },
    { id: 'enrollDeroll', label: 'Enrol / Deroll', icon: Package, group: 'Finance' },
    { id: 'membership', label: 'Membership', icon: IdentificationCard, group: 'Finance' },

    // CRM — "What's the next touch?"
    { id: 'lead', label: 'Lead Profile', icon: Target, group: 'CRM' },
    { id: 'enquiry', label: 'Enquiry', icon: ClipboardText, group: 'CRM' },
    { id: 'application', label: 'Application', icon: ClipboardText, group: 'CRM' },
    { id: 'notifications', label: 'Communication', icon: Bell, group: 'CRM' },

    // Account — "Who has access? What do we have on file?"
    // Guardian sits here (not CRM) — its feature toggle (useParentSettings) is
    // independent of the lead system, and the overlay's CRM module flag is
    // wired to leadSettings.enabled, which would incorrectly hide it there.
    { id: 'portalAccess', label: 'Portal Access', icon: Key, group: 'Account' },
    { id: 'userTagging', label: 'User Tagging', icon: Tag, group: 'Account' },
    { id: 'badges', label: 'Badges', icon: Trophy, group: 'Account' },
    { id: 'files', label: 'Files', icon: Folder, group: 'Account' },
    { id: 'parent', label: 'Guardian', icon: Users, group: 'Account' },
    // Onboarding sits here too, for the same reason as Guardian — its feature
    // toggle (useOnboardingSettings) is independent of the lead system, and
    // the overlay's CRM module flag is wired to leadSettings.enabled, which
    // would incorrectly couple onboarding visibility to leads being enabled.
    { id: 'onboarding', label: 'Onboarding', icon: Path, group: 'Account' },
    { id: 'subOrg', label: 'Sub-Org', icon: Buildings, group: 'Account' },

    // Records — "What's the audit trail?"
    { id: 'reports', label: 'Reports', icon: FileText, group: 'Records' },
    { id: 'fullHistory', label: 'Full History', icon: ClockCounterClockwise, group: 'Records' },
    // Automations that ran FOR this person (with a Retry per run). Sits in
    // Records because it answers the same audit-trail question as Full
    // History — what happened to this learner, and did it work?
    { id: 'workflows', label: 'Workflows', icon: Robot, group: 'Records' },
] as const;

/**
 * Translated view of {@link SECTION_REGISTRY} for UI rendering.
 *
 * `SECTION_REGISTRY` itself stays a static, English-labelled constant so
 * call sites that only need the `id`/`icon`/`group` fields for matching or
 * routing (e.g. filtering visible tab IDs) don't need a `t` in scope at all.
 * Consumers that actually render `label` text (currently just
 * `GroupedNavRail`) should call this instead, passing their own `t` from
 * `useTranslation('manageStudentsNavGroups')`.
 *
 * Only `label` is swapped for the translated string — `id`, `icon`, and
 * `group` (used for active-tab matching, module gating, and grouping) are
 * copied through untouched.
 */
export function buildSectionRegistry(t: TFunction): readonly SectionMeta[] {
    return SECTION_REGISTRY.map((section) => ({
        ...section,
        label: t(`sections.${section.id}`, { ns: NAV_GROUPS_NS, defaultValue: section.label }),
    }));
}
