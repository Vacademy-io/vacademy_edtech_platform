import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    getAllRoles,
    type CustomRole,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { SettingsPageShell } from '@/components/settings/shell';
import SlideDownloadCard from './RoleDisplay/SlideDownloadCard';
import SlideContentProtectionCard from './RoleDisplay/SlideContentProtectionCard';
import OfflineAccessSettings from './OfflineAccessSettings';

/**
 * Dedicated "Content Protection" settings tab. Consolidates the per-role
 * Download Permissions + Copy & Screen Protection controls (previously buried
 * inside each role's Display Settings panel) behind a single role selector, so
 * an admin configures every role's slide download/protection in one place.
 *
 * Both cards edit only the selected role's column of the shared
 * SLIDE_DOWNLOAD_PERMISSION_SETTING / SLIDE_CONTENT_PROTECTION_SETTING blobs.
 */

// Roles offered directly. `key` is the canonical stored role key; `label` is the
// dropdown label; `cardLabel` is the (plural) noun used in each card's copy.
function buildSystemRoles(t: TFunction) {
    return [
        { key: 'ADMIN', label: t('roles.admin.label'), cardLabel: t('roles.admin.cardLabel') },
        { key: 'TEACHER', label: t('roles.teacher.label'), cardLabel: t('roles.teacher.cardLabel') },
        { key: 'LEARNER', label: t('roles.learner.label'), cardLabel: t('roles.learner.cardLabel') },
    ];
}

// System roles already covered above (or not configured here) — excluded from
// the custom-role list so the dropdown doesn't show duplicates.
const SYSTEM_ROLE_NAMES = new Set([
    'ADMIN',
    'TEACHER',
    'STUDENT',
    'LEARNER',
    'EVALUATOR',
    'CONTENT CREATOR',
    'ASSESSMENT CREATOR',
]);

interface ContentProtectionSettingsProps {
    /** Rendered inside the quick-access popup rather than the full /settings page. */
    embedded?: boolean;
}

export default function ContentProtectionSettings({
    embedded = false,
}: ContentProtectionSettingsProps = {}) {
    const { t } = useTranslation('settingsContentProtection');
    const [selectedKey, setSelectedKey] = useState<string>('ADMIN');

    const { data: customRoles } = useQuery({
        queryKey: ['custom-roles'],
        queryFn: getAllRoles,
    });

    const systemRoles = buildSystemRoles(t);

    const customRoleEntries = (customRoles || [])
        .filter((r: CustomRole) => !SYSTEM_ROLE_NAMES.has(r.name.toUpperCase()))
        .map((r: CustomRole) => ({
            key: r.name.toUpperCase(),
            label: r.name,
            cardLabel: r.name,
        }));

    const roleOptions = [...systemRoles, ...customRoleEntries];
    const selected = roleOptions.find((r) => r.key === selectedKey) ?? systemRoles[0];

    return (
        <SettingsPageShell
            title={t('header.title')}
            description={t('header.description')}
            maxWidth="max-w-3xl"
            embedded={embedded}
            actions={
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-neutral-700">
                        {t('actions.roleLabel')}
                    </span>
                    <Select value={selectedKey} onValueChange={setSelectedKey}>
                        <SelectTrigger className="h-9 w-48">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {roleOptions.map((opt) => (
                                <SelectItem key={opt.key} value={opt.key}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            }
        >
            <div className="space-y-6">
                {/* keyed on role so the cards fully reset when the role changes */}
                <SlideDownloadCard
                    key={`dl-${selected.key}`}
                    roleKey={selected.key}
                    roleLabel={selected.cardLabel}
                />
                <SlideContentProtectionCard
                    key={`cp-${selected.key}`}
                    roleKey={selected.key}
                    roleLabel={selected.cardLabel}
                />
                {/* Institute-wide (not per-role) offline download controls. */}
                <OfflineAccessSettings />
            </div>
        </SettingsPageShell>
    );
}
