import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from '@phosphor-icons/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_USER_ROLES_COUNT } from '@/constants/urls';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import type {
    LiveSessionRoleVisibilityRule,
    LiveSessionVisibilityMode,
} from '@/services/live-session-settings';

interface RoleCount {
    role_name: string;
    user_count: number;
}

interface LiveSessionVisibilityCardProps {
    instituteId: string;
    value: Record<string, LiveSessionRoleVisibilityRule>;
    onChange: (next: Record<string, LiveSessionRoleVisibilityRule>) => void;
}

const MODES: LiveSessionVisibilityMode[] = ['ALL', 'OWN', 'SPECIFIC_ROLES'];

/**
 * Per-role live-session visibility (see LIVE_SESSION_SETTING.roleVisibility).
 *
 * Roles come from `/user-roles-count`, which reports the roles this institute
 * actually uses — including custom ones. A fixed list would silently omit
 * every custom role an admin created, and those are exactly the roles someone
 * setting up a visibility rule is most likely to reach for.
 *
 * STUDENT is excluded: these rules govern the admin-side session lists, which
 * learners never see. Restricting STUDENT here would do nothing except invite
 * an admin to think it gated the learner app.
 */
export function LiveSessionVisibilityCard({
    instituteId,
    value,
    onChange,
}: LiveSessionVisibilityCardProps) {
    const { t } = useTranslation('settingsLiveSession');
    const [roles, setRoles] = useState<string[]>([]);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (!instituteId) return;
        (async () => {
            try {
                const response = await authenticatedAxiosInstance.get<RoleCount[]>(
                    GET_USER_ROLES_COUNT,
                    { params: { instituteId } }
                );
                if (cancelled) return;
                const names = (response.data ?? [])
                    .map((r) => r.role_name)
                    .filter((name): name is string => !!name && name !== 'STUDENT')
                    .map((name) => name.toUpperCase());
                setRoles(Array.from(new Set(names)).sort());
                setLoadFailed(false);
            } catch {
                if (!cancelled) setLoadFailed(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [instituteId]);

    // Roles that can appear inside a SPECIFIC_ROLES selection. The role being
    // configured is included on purpose: "teachers see other teachers' classes"
    // is a normal thing to want.
    const selectableRoles = useMemo(() => roles, [roles]);

    const ruleFor = (role: string): LiveSessionRoleVisibilityRule =>
        value[role] ?? { mode: 'ALL', roles: [] };

    const setMode = (role: string, mode: LiveSessionVisibilityMode) => {
        const next = { ...value };
        if (mode === 'ALL') {
            // Deleting rather than storing {mode:'ALL'} keeps the saved blob
            // free of no-op entries, and ALL is what an absent rule means.
            delete next[role];
        } else {
            next[role] = { mode, roles: mode === 'SPECIFIC_ROLES' ? ruleFor(role).roles : [] };
        }
        onChange(next);
    };

    const toggleVisibleRole = (role: string, target: string, checked: boolean) => {
        const current = ruleFor(role);
        const selected = new Set(current.roles ?? []);
        if (checked) selected.add(target);
        else selected.delete(target);
        onChange({ ...value, [role]: { mode: 'SPECIFIC_ROLES', roles: Array.from(selected) } });
    };

    return (
        <Card className="border-neutral-200 shadow-none">
            <CardHeader className="flex-row items-start gap-3 space-y-0 p-5 pb-4">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                    <Eye size={18} />
                </div>
                <div className="flex-1">
                    <CardTitle className="text-base">{t('visibility.title')}</CardTitle>
                    <CardDescription>{t('visibility.description')}</CardDescription>
                </div>
            </CardHeader>
            <CardContent className="border-t border-neutral-100 p-5">
                {loadFailed ? (
                    <p className="text-sm text-danger-600">{t('visibility.loadFailed')}</p>
                ) : roles.length === 0 ? (
                    <p className="text-sm text-neutral-500">{t('visibility.empty')}</p>
                ) : (
                    <div className="flex flex-col">
                        {roles.map((role, index) => {
                            const rule = ruleFor(role);
                            const selectedCount = rule.roles?.length ?? 0;
                            return (
                                <div key={role}>
                                    {index > 0 && <Separator />}
                                    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="text-sm font-medium text-neutral-800">
                                            {mapRoleToCustomName(role)}
                                        </div>
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                            <Select
                                                value={rule.mode}
                                                onValueChange={(v) =>
                                                    setMode(role, v as LiveSessionVisibilityMode)
                                                }
                                            >
                                                <SelectTrigger className="w-full sm:w-72">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {MODES.map((mode) => (
                                                        <SelectItem key={mode} value={mode}>
                                                            {mode === 'ALL'
                                                                ? t('visibility.modeAll')
                                                                : mode === 'OWN'
                                                                  ? t('visibility.modeOwn')
                                                                  : t(
                                                                        'visibility.modeSpecificRoles'
                                                                    )}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>

                                            {rule.mode === 'SPECIFIC_ROLES' && (
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            className="w-full sm:w-56"
                                                        >
                                                            {selectedCount === 0
                                                                ? t('visibility.selectRoles')
                                                                : t('visibility.selectedRoles', {
                                                                      count: selectedCount,
                                                                  })}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-64 p-3">
                                                        <div className="flex flex-col gap-2">
                                                            {selectableRoles.map((target) => (
                                                                <label
                                                                    key={target}
                                                                    className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700"
                                                                >
                                                                    <Checkbox
                                                                        checked={(
                                                                            rule.roles ?? []
                                                                        ).includes(target)}
                                                                        onCheckedChange={(c) =>
                                                                            toggleVisibleRole(
                                                                                role,
                                                                                target,
                                                                                c === true
                                                                            )
                                                                        }
                                                                    />
                                                                    {mapRoleToCustomName(target)}
                                                                </label>
                                                            ))}
                                                        </div>
                                                    </PopoverContent>
                                                </Popover>
                                            )}
                                        </div>
                                    </div>
                                    {rule.mode === 'SPECIFIC_ROLES' && selectedCount === 0 && (
                                        <p className="pb-3 text-xs text-warning-600">
                                            {t('visibility.noRolesSelected')}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                        <p className="pt-2 text-xs text-neutral-500">
                            {t('visibility.multiRoleNote')}
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
