/**
 * RoleAccessGrid — a role × view/edit checkbox grid. Reused for both the per-step and
 * per-field role-access editors.
 *
 * ADMIN / STUDENT / PARENT are always shown: they're the three the learner surface resolves
 * itself to, and ADMIN's row is informational only (an admin outranks the grid and always has
 * full access — the backend short-circuits on it before reading any of this).
 *
 * Any other INSTITUTE role can be added on top — a COUNSELLOR, a custom role — which is how a
 * non-admin staff member is given a step to work on. Rows are keyed by the role's NAME
 * (uppercased), because that is what the backend matches against the caller's JWT role names.
 */
import { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Plus, TrashSimple } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { MyButton } from '@/components/design-system/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    ONBOARDING_BUILTIN_ROLE_KEYS,
    type OnboardingAssignableRole,
    type OnboardingRoleAccess,
    type OnboardingRoleKey,
} from '../-services/onboarding-service';

const buildBuiltinLabels = (t: TFunction): Record<string, string> => ({
    ADMIN: t('roleLabels.admin'),
    STUDENT: t('roleLabels.student'),
    PARENT: t('roleLabels.parent'),
});

interface RoleAccessGridProps {
    value: OnboardingRoleAccess[];
    onChange: (next: OnboardingRoleAccess[]) => void;
    /** Compact mode for nesting inside a per-field row. */
    compact?: boolean;
    /**
     * Institute roles offered by the "Add role" picker. Omitted (or empty) hides the picker
     * entirely, leaving the original three-role grid — so a caller that hasn't loaded the
     * institute's roles degrades to the previous behaviour rather than to a broken control.
     */
    assignableRoles?: OnboardingAssignableRole[];
}

export function RoleAccessGrid({
    value,
    onChange,
    compact = false,
    assignableRoles = [],
}: RoleAccessGridProps) {
    const { t } = useTranslation('audienceManagerRoleAccessGrid');
    const builtinLabels = buildBuiltinLabels(t);
    const [pendingRole, setPendingRole] = useState('');

    const byRole = useMemo(
        () => new Map(value.map((r) => [String(r.role_key).toUpperCase(), r])),
        [value]
    );

    // Built-ins first and always present, then whatever extra roles this grid already carries,
    // in the order they were added.
    const shownRoles: string[] = useMemo(() => {
        const extras = value
            .map((r) => String(r.role_key).toUpperCase())
            .filter((k) => !ONBOARDING_BUILTIN_ROLE_KEYS.includes(k as 'ADMIN'));
        return [...ONBOARDING_BUILTIN_ROLE_KEYS, ...Array.from(new Set(extras))];
    }, [value]);

    const addableRoles = useMemo(
        () => assignableRoles.filter((r) => !shownRoles.includes(r.role_key)),
        [assignableRoles, shownRoles]
    );

    const labelFor = (role: string) =>
        builtinLabels[role] ?? assignableRoles.find((r) => r.role_key === role)?.label ?? role;

    const update = (role: OnboardingRoleKey, patch: Partial<OnboardingRoleAccess>) => {
        const key = String(role).toUpperCase();
        const existing = byRole.get(key) ?? { role_key: key, can_view: false, can_edit: false };
        const next = { ...existing, ...patch, role_key: key };
        const rest = value.filter((r) => String(r.role_key).toUpperCase() !== key);
        onChange([...rest, next]);
    };

    const addRole = () => {
        if (!pendingRole) return;
        // Starts at view-only: an added role is a deliberate grant, but edit rights should be a
        // second, explicit click rather than something an "Add" button hands out.
        update(pendingRole, { can_view: true, can_edit: false });
        setPendingRole('');
    };

    const removeRole = (role: string) => {
        onChange(value.filter((r) => String(r.role_key).toUpperCase() !== role));
    };

    return (
        <div className="flex flex-col gap-2.5">
            <div className={compact ? 'flex flex-wrap gap-4' : 'grid grid-cols-1 gap-3 sm:grid-cols-3'}>
                {shownRoles.map((role) => {
                    const entry = byRole.get(role) ?? {
                        role_key: role,
                        can_view: false,
                        can_edit: false,
                    };
                    const isBuiltin = ONBOARDING_BUILTIN_ROLE_KEYS.includes(role as 'ADMIN');
                    return (
                        <div
                            key={role}
                            className={
                                compact
                                    ? 'flex items-center gap-3 text-caption'
                                    : 'flex flex-col gap-1.5 rounded-md border border-neutral-200 p-2.5'
                            }
                        >
                            <span
                                className={
                                    compact
                                        ? 'flex items-center gap-1 font-medium text-neutral-700'
                                        : 'flex items-center gap-1 text-caption font-semibold text-neutral-700'
                                }
                            >
                                {labelFor(role)}
                                {!isBuiltin && (
                                    <button
                                        type="button"
                                        aria-label={t('removeRole', { role: labelFor(role) })}
                                        onClick={() => removeRole(role)}
                                        className="text-neutral-400 hover:text-danger-500"
                                    >
                                        <TrashSimple size={13} />
                                    </button>
                                )}
                            </span>
                            <label className="flex items-center gap-1.5">
                                <Checkbox
                                    checked={entry.can_view}
                                    onCheckedChange={(v) => update(role, { can_view: v === true })}
                                />
                                <span className="text-caption text-neutral-600">{t('actions.view')}</span>
                            </label>
                            <label className="flex items-center gap-1.5">
                                <Checkbox
                                    checked={entry.can_edit}
                                    onCheckedChange={(v) =>
                                        // Edit without view is meaningless — the field would be
                                        // filtered out of the form before it could be edited —
                                        // and the backend treats that combination as no access.
                                        update(role, {
                                            can_edit: v === true,
                                            ...(v === true ? { can_view: true } : {}),
                                        })
                                    }
                                />
                                <span className="text-caption text-neutral-600">{t('actions.edit')}</span>
                            </label>
                        </div>
                    );
                })}
            </div>

            {addableRoles.length > 0 && (
                <div className="flex items-center gap-2">
                    <Select value={pendingRole} onValueChange={setPendingRole}>
                        <SelectTrigger className="h-8 w-56 text-caption">
                            <SelectValue placeholder={t('addRolePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                            {addableRoles.map((role) => (
                                <SelectItem key={role.role_key} value={role.role_key}>
                                    {role.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        onClick={addRole}
                        disable={!pendingRole}
                    >
                        <Plus size={14} /> {t('addRoleButton')}
                    </MyButton>
                </div>
            )}
        </div>
    );
}
