import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    ACCESS_PASS_QUERY_KEYS,
    assignAccessPassSubOrg,
    getAccessPassSubOrgs,
    unassignAccessPassSubOrg,
} from '@/services/access-pass';

type RawSubOrg = Record<string, unknown>;

const pick = (o: RawSubOrg, keys: string[]): string | undefined => {
    for (const k of keys) {
        const v = o?.[k];
        if (typeof v === 'string' && v.trim()) return v;
    }
    return undefined;
};

const apiError = (e: unknown, fallback: string) =>
    (e as { response?: { data?: { ex?: string } } })?.response?.data?.ex ?? fallback;

/**
 * B2B pass: the sub-orgs holding it. Assigning links the pass's courses to the sub-org
 * now; courses added to the pass later reach every assigned sub-org through the sync.
 */
export function AccessPassSubOrgsPanel({ passId }: { passId: string }) {
    const { t } = useTranslation('manageAccessPasses');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId();
    const [selected, setSelected] = useState('');

    const { data: links = [], isLoading } = useQuery({
        queryKey: ACCESS_PASS_QUERY_KEYS.subOrgs(passId),
        queryFn: () => getAccessPassSubOrgs(passId),
    });
    const { data: rawSubOrgs } = useQuery({
        queryKey: ['sub-orgs-list', instituteId],
        queryFn: () => getSubOrgs(instituteId ?? undefined),
        enabled: !!instituteId,
    });

    const options = useMemo(() => {
        const list: RawSubOrg[] = Array.isArray(rawSubOrgs)
            ? rawSubOrgs
            : ((rawSubOrgs as { content?: RawSubOrg[] } | undefined)?.content ?? []);
        const linked = new Set(links.map((l) => l.sub_org_id));
        return list
            .map((o) => ({
                id: pick(o, ['sub_org_id', 'suborg_id', 'subOrgId', 'id']),
                name: pick(o, ['name', 'institute_name', 'instituteName', 'subOrgName']),
            }))
            .filter((o): o is { id: string; name: string | undefined } => !!o.id && !linked.has(o.id));
    }, [rawSubOrgs, links]);

    const onChanged = (next: unknown) => {
        queryClient.setQueryData(ACCESS_PASS_QUERY_KEYS.subOrgs(passId), next);
        queryClient.invalidateQueries({ queryKey: ACCESS_PASS_QUERY_KEYS.detail(passId) });
        queryClient.invalidateQueries({ queryKey: ACCESS_PASS_QUERY_KEYS.list });
    };

    const assign = useMutation({
        mutationFn: (subOrgId: string) => assignAccessPassSubOrg(passId, subOrgId),
        onSuccess: (next) => {
            setSelected('');
            onChanged(next);
            toast.success(t('subOrgs.assigned', 'Pass assigned. Its courses are now linked to the sub-org.'));
        },
        onError: (e) => toast.error(apiError(e, t('subOrgs.assignFailed', 'Could not assign the pass'))),
    });
    const unassign = useMutation({
        mutationFn: (subOrgId: string) => unassignAccessPassSubOrg(passId, subOrgId),
        onSuccess: (next) => {
            onChanged(next);
            toast.success(t('subOrgs.unassigned', 'Sub-org will no longer receive this pass’s new courses'));
        },
        onError: (e) => toast.error(apiError(e, t('subOrgs.unassignFailed', 'Could not unassign'))),
    });

    return (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
            <h3 className="font-medium">{t('subOrgs.title', 'Sub-organisations holding this pass')}</h3>
            <p className="text-xs text-neutral-500">
                {t(
                    'subOrgs.hint',
                    'The sub-org must already exist (Manage Sub-Orgs). Assigning links the pass’s courses to it, mirrors its learner links and gives its team access. Courses added to the pass later are pushed to every assigned sub-org.'
                )}
            </p>
            {isLoading ? (
                <p className="text-sm text-neutral-500">{t('common.loading', 'Loading…')}</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {links.map((l) => (
                        <li key={l.sub_org_id} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div className="flex flex-col">
                                <span>{l.sub_org_name ?? l.sub_org_id}</span>
                                <span className="text-xs text-neutral-500">
                                    {t('subOrgs.lastSynced', 'Last synced')}:{' '}
                                    {l.last_synced_at ? new Date(l.last_synced_at).toLocaleString() : '—'}
                                </span>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={unassign.isPending}
                                onClick={() => {
                                    if (
                                        window.confirm(
                                            t(
                                                'subOrgs.unassignConfirm',
                                                'Stop syncing this pass to the sub-org? Courses already linked stay with it.'
                                            )
                                        )
                                    ) {
                                        unassign.mutate(l.sub_org_id);
                                    }
                                }}
                            >
                                <Trash className="size-4" />
                            </Button>
                        </li>
                    ))}
                    {links.length === 0 && (
                        <li className="px-3 py-2 text-sm text-neutral-500">
                            {t('subOrgs.none', 'Not assigned to any sub-org yet')}
                        </li>
                    )}
                </ul>
            )}
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="flex-1">
                    <Select value={selected} onValueChange={setSelected}>
                        <SelectTrigger>
                            <SelectValue placeholder={t('subOrgs.pick', 'Choose a sub-org')} />
                        </SelectTrigger>
                        <SelectContent>
                            {options.map((o) => (
                                <SelectItem key={o.id} value={o.id}>
                                    {o.name ?? o.id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Button size="sm" disabled={!selected || assign.isPending} onClick={() => assign.mutate(selected)}>
                    {t('subOrgs.assign', 'Assign pass')}
                </Button>
            </div>
        </div>
    );
}
