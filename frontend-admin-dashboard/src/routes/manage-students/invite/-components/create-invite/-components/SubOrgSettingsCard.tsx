import { UseFormReturn } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FormField, FormItem, FormLabel, FormControl } from '@/components/ui/form';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { getAllRoles } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';

interface SubOrgSettingsCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const ADMIN_PERMISSION_OPTIONS = ['FULL', 'CREATE_COURSE'] as const;

/**
 * Sub-org settings for an invite link, mirroring the Create Sub-Org modal.
 * When enabled and the invite targets a sub-org-associated batch, enrolling
 * provisions a sub-org whose admin gets these auth roles / permissions / seat
 * cap. Persisted to setting_json.setting.SUB_ORG_SETTING.
 */
const SubOrgSettingsCard = ({ form }: SubOrgSettingsCardProps) => {
    const { t } = useTranslation('manageStudentsSubOrgSettingsCard');
    const enabled = form.watch('subOrgSettings.enabled');
    const authRoles = form.watch('subOrgSettings.authRoles') ?? [];
    const allowedTeamRoles = form.watch('subOrgSettings.allowedTeamRoles') ?? [];
    const adminPermissions = form.watch('subOrgSettings.adminPermissions') ?? [];

    const { data: rolesList = [] } = useQuery<{ id: string; name: string }[]>({
        queryKey: ['roles'],
        queryFn: getAllRoles,
        staleTime: 1000 * 60 * 5,
        enabled: !!enabled,
    });

    const toggleInArray = (
        fieldName:
            | 'subOrgSettings.authRoles'
            | 'subOrgSettings.allowedTeamRoles'
            | 'subOrgSettings.adminPermissions',
        current: string[],
        value: string,
        checked: boolean
    ) => {
        const next = checked
            ? Array.from(new Set([...current, value]))
            : current.filter((v) => v !== value);
        form.setValue(fieldName, next, { shouldDirty: true });
    };

    return (
        <Card className="rounded-sm bg-neutral-50/50 shadow-none">
            <CardHeader className="border-b bg-neutral-100/50 p-4">
                <CardTitle className="text-base font-semibold text-neutral-800">
                    {t('title')}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 p-4">
                <FormField
                    control={form.control}
                    name="subOrgSettings.enabled"
                    render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                                <FormLabel className="text-sm font-semibold">
                                    {t('toggle.label')}
                                </FormLabel>
                                <p className="text-xs text-neutral-500">{t('toggle.description')}</p>
                            </div>
                            <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                        </FormItem>
                    )}
                />

                {enabled && (
                    <div className="space-y-6">
                        {/* Admin auth roles */}
                        <div className="space-y-2">
                            <FormLabel className="text-sm font-semibold">
                                {t('authRoles.label')}
                            </FormLabel>
                            <p className="text-xs text-neutral-500">{t('authRoles.description')}</p>
                            <div className="flex flex-wrap gap-2 rounded-md border bg-white p-2">
                                {rolesList.map((role) => (
                                    <label
                                        key={role.id}
                                        className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-neutral-100"
                                    >
                                        <Checkbox
                                            checked={authRoles.includes(role.name)}
                                            onCheckedChange={(checked) =>
                                                toggleInArray(
                                                    'subOrgSettings.authRoles',
                                                    authRoles,
                                                    role.name,
                                                    checked === true
                                                )
                                            }
                                        />
                                        {role.name}
                                    </label>
                                ))}
                                {rolesList.length === 0 && (
                                    <span className="text-xs text-neutral-400">
                                        {t('common.noRolesFound')}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Allowed team roles */}
                        <div className="space-y-2">
                            <FormLabel className="text-sm font-semibold">
                                {t('allowedTeamRoles.label')}
                            </FormLabel>
                            <p className="text-xs text-neutral-500">
                                {t('allowedTeamRoles.description')}
                            </p>
                            <div className="flex flex-wrap gap-2 rounded-md border bg-white p-2">
                                {rolesList.map((role) => (
                                    <label
                                        key={role.id}
                                        className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-neutral-100"
                                    >
                                        <Checkbox
                                            checked={allowedTeamRoles.includes(role.name)}
                                            onCheckedChange={(checked) =>
                                                toggleInArray(
                                                    'subOrgSettings.allowedTeamRoles',
                                                    allowedTeamRoles,
                                                    role.name,
                                                    checked === true
                                                )
                                            }
                                        />
                                        {role.name}
                                    </label>
                                ))}
                                {rolesList.length === 0 && (
                                    <span className="text-xs text-neutral-400">
                                        {t('common.noRolesFound')}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Admin permissions */}
                        <div className="space-y-2">
                            <FormLabel className="text-sm font-semibold">
                                {t('adminPermissions.label')}
                            </FormLabel>
                            <p className="text-xs text-neutral-500">
                                {t('adminPermissions.description')}
                            </p>
                            <div className="flex flex-wrap gap-2 rounded-md border bg-white p-2">
                                {ADMIN_PERMISSION_OPTIONS.map((perm) => (
                                    <label
                                        key={perm}
                                        className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-neutral-100"
                                    >
                                        <Checkbox
                                            checked={adminPermissions.includes(perm)}
                                            onCheckedChange={(checked) =>
                                                toggleInArray(
                                                    'subOrgSettings.adminPermissions',
                                                    adminPermissions,
                                                    perm,
                                                    checked === true
                                                )
                                            }
                                        />
                                        {t(`adminPermissions.options.${perm}`)}
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Seat limit */}
                        <FormField
                            control={form.control}
                            name="subOrgSettings.memberCount"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-sm font-semibold">
                                        {t('seatLimit.label')}
                                    </FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            min={1}
                                            placeholder={t('seatLimit.placeholder')}
                                            value={field.value ?? ''}
                                            onChange={(e) =>
                                                field.onChange(
                                                    e.target.value === ''
                                                        ? null
                                                        : Number(e.target.value)
                                                )
                                            }
                                        />
                                    </FormControl>
                                    <p className="text-xs text-neutral-500">
                                        {t('seatLimit.description')}
                                    </p>
                                </FormItem>
                            )}
                        />
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default SubOrgSettingsCard;
