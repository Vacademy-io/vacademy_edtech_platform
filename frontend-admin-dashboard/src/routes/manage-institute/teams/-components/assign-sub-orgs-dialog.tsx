/**
 * Assign channel partners to an existing team member, straight from the institute
 * Teams list.
 *
 * Previously the only way to link somebody to a partner was to open that partner's own
 * Team tab and "Add Member" — which routes through auth-service's invite endpoint and can
 * email a colleague who already has an account. This dialog uses the dedicated assign
 * endpoint instead, so granting access is silent.
 *
 * Saving diffs the selection against what the person already has: newly ticked partners
 * are assigned, unticked ones are removed. Untouched partners are left completely alone,
 * so this never disturbs a grant made elsewhere.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { MultiSelectFilter } from '@/components/shared/leads/multi-select-filter';
import {
    assignUserToSubOrg,
    listAccessibleSubOrgs,
    removeSubOrgTeamMember,
} from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface AssignSubOrgsDialogProps {
    userId: string;
    userName?: string | null;
    /** Partners this person is already individually linked to (not role-derived). */
    currentSubOrgIds: string[];
    onClose: () => void;
    refetchData: () => void;
}

export function AssignSubOrgsDialog({
    userId,
    userName,
    currentSubOrgIds,
    onClose,
    refetchData,
}: AssignSubOrgsDialogProps) {
    const { t } = useTranslation('manageInstituteAssignSubOrgsDialog');
    const term = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const termPlural = getTerminologyPlural(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const instituteId = getCurrentInstituteId();
    const queryClient = useQueryClient();

    const [selected, setSelected] = useState<string[]>(currentSubOrgIds);
    // Re-seed if the dialog is reopened for a different person without unmounting.
    useEffect(() => setSelected(currentSubOrgIds), [currentSubOrgIds]);

    const { data: subOrgs, isLoading } = useQuery({
        queryKey: ['ACCESSIBLE_SUB_ORGS', instituteId],
        queryFn: () => listAccessibleSubOrgs(instituteId!),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    const options = useMemo(
        () =>
            (subOrgs ?? [])
                .map((so) => ({ value: so.id, label: so.name || so.id }))
                .sort((a, b) => a.label.localeCompare(b.label)),
        [subOrgs]
    );

    const nameById = useMemo(() => new Map(options.map((o) => [o.value, o.label])), [options]);

    const added = selected.filter((id) => !currentSubOrgIds.includes(id));
    const removed = currentSubOrgIds.filter((id) => !selected.includes(id));
    const dirty = added.length > 0 || removed.length > 0;

    const save = useMutation({
        mutationFn: async () => {
            if (!instituteId) throw new Error('No institute selected');
            // Sequential on purpose: each call writes access rows for the same user, and a
            // partial failure should stop rather than race a half-applied set.
            for (const subOrgId of added) {
                await assignUserToSubOrg({
                    sub_org_id: subOrgId,
                    institute_id: instituteId,
                    user_id: userId,
                });
            }
            for (const subOrgId of removed) {
                await removeSubOrgTeamMember({
                    sub_org_id: subOrgId,
                    institute_id: instituteId,
                    user_id: userId,
                    mode: 'HARD',
                });
            }
        },
        onSuccess: () => {
            const parts: string[] = [];
            if (added.length) parts.push(t('toast.assigned', { count: added.length }));
            if (removed.length) parts.push(t('toast.removed', { count: removed.length }));
            toast.success(
                t('toast.summary', {
                    name: userName || t('defaultMemberName'),
                    parts: parts.join(', '),
                    subOrgPlural: termPlural.toLowerCase(),
                })
            );
            // The Sub-Orgs column reads this cache; refresh so the chips update immediately.
            queryClient.invalidateQueries({ queryKey: ['SUB_ORG_USER_LINKS', instituteId] });
            refetchData();
            onClose();
        },
        onError: (err: unknown) => {
            const e = err as { response?: { data?: { message?: string; ex?: string } } };
            toast.error(
                e?.response?.data?.message ||
                    e?.response?.data?.ex ||
                    t('toast.updateFailed', { subOrgPlural: termPlural.toLowerCase() })
            );
        },
    });

    return (
        <DialogContent className="sm:max-w-lg">
            <DialogHeader>
                <DialogTitle>
                    {t('title', { subOrgPlural: termPlural, name: userName || t('defaultMemberLabel') })}
                </DialogTitle>
            </DialogHeader>

            {isLoading ? (
                <DashboardLoader />
            ) : options.length === 0 ? (
                <p className="py-4 text-center text-caption text-neutral-500">
                    {t('noneExist', { subOrgPlural: termPlural.toLowerCase() })}
                </p>
            ) : (
                <div className="space-y-3 py-2">
                    <p className="text-caption text-neutral-500">
                        {t('grantsAccessDescription', { subOrg: term.toLowerCase() })}
                    </p>
                    <MultiSelectFilter
                        label={t('selectLabel', { subOrgPlural: termPlural.toLowerCase() })}
                        options={options}
                        selected={selected}
                        onChange={setSelected}
                        placeholder={t('searchPlaceholder', { subOrgPlural: termPlural.toLowerCase() })}
                        widthClass="w-full"
                    />
                    {selected.length === 0 ? (
                        <p className="text-caption text-neutral-500">
                            {t('noneSelected', { subOrg: term.toLowerCase() })}
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-1.5">
                            {selected.map((id) => (
                                <span
                                    key={id}
                                    className="rounded-full bg-primary-100 px-2 py-0.5 text-caption text-primary-700"
                                >
                                    {nameById.get(id) ?? id}
                                </span>
                            ))}
                        </div>
                    )}
                    {dirty && (
                        <p className="rounded-md bg-primary-50 px-3 py-2 text-caption text-neutral-600">
                            {added.length > 0 && <>{t('adding', { count: added.length })} </>}
                            {removed.length > 0 && <>{t('removing', { count: removed.length })}</>}
                        </p>
                    )}
                </div>
            )}

            <div className="flex justify-end gap-2">
                <MyButton buttonType="secondary" scale="small" onClick={onClose}>
                    {t('actions.cancel')}
                </MyButton>
                <MyButton
                    scale="small"
                    disable={!dirty || save.isPending}
                    onClick={() => save.mutate()}
                >
                    {save.isPending ? t('actions.saving') : t('actions.save')}
                </MyButton>
            </div>
        </DialogContent>
    );
}

export default AssignSubOrgsDialog;
