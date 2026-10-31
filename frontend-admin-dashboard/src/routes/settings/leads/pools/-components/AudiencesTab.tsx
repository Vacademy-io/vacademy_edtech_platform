/**
 * Manage which campaigns (audiences) belong to this pool.
 * Lists currently-attached campaigns and lets admin attach more from the
 * institute's full campaign list. Backend enforces "one campaign per pool".
 *
 * A campaign already attached to a DIFFERENT pool is kept out of the picker
 * entirely — attaching it would only earn a 400 from the backend. The pools
 * list endpoint hydrates every pool's audiences, so the ownership map costs
 * no extra request; the hidden ones are named below the list (with the pool
 * holding them) so an admin hunting for a missing campaign isn't left
 * guessing.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import MultiSelectAddList from './MultiSelectAddList';
import {
    handleFetchCampaignsList,
    type CampaignItem,
} from '@/routes/audience-manager/list/-services/get-campaigns-list';
import {
    CounselorPoolDTO,
    useAddAudiencesToPool,
    useCounselorPools,
    useInvalidatePool,
    useRemoveAudienceFromPool,
    useUpdateAudienceAssignOnIntake,
} from '@/services/counselor-pool';

interface AudiencesTabProps {
    pool: CounselorPoolDTO;
}

export default function AudiencesTab({ pool }: AudiencesTabProps) {
    // Reuse the existing campaign-list service from audience-manager. Pull a wide page
    // (size 500) so we get every campaign in the institute regardless of pagination.
    const instituteId = getCurrentInstituteId() ?? '';
    const campaignsQuery = handleFetchCampaignsList({
        institute_id: instituteId,
        page: 0,
        size: 500,
    });
    const { data: campaignsPage, isLoading } = useQuery(campaignsQuery);
    const allCampaigns: CampaignItem[] = useMemo(
        () => campaignsPage?.content ?? [],
        [campaignsPage]
    );

    // Every pool in the institute, each with its audiences — the source for
    // "who already owns this campaign".
    const { data: allPools, isLoading: poolsLoading } = useCounselorPools();

    const { mutateAsync: addAudiencesAsync } = useAddAudiencesToPool(pool.id);
    const { mutate: removeAudience, isPending: removing } = useRemoveAudienceFromPool(pool.id);
    const { mutate: updateAssignOnIntake, isPending: updatingAssignment } =
        useUpdateAudienceAssignOnIntake(pool.id);
    const invalidatePool = useInvalidatePool();

    // audience_id -> name of the OTHER pool holding it. This pool is skipped so
    // its own attachments stay governed by `attachedIds` (never stale).
    const ownedByOtherPool = useMemo(() => {
        const owners = new Map<string, string>();
        for (const p of allPools ?? []) {
            if (p.id === pool.id) continue;
            for (const a of p.audiences ?? []) owners.set(a.audience_id, p.name);
        }
        return owners;
    }, [allPools, pool.id]);

    const attachedIds = useMemo(
        () => new Set((pool.audiences ?? []).map((a) => a.audience_id)),
        [pool.audiences]
    );

    const attached = useMemo(
        () =>
            (pool.audiences ?? []).map((a) => ({
                audienceId: a.audience_id,
                campaignName:
                    allCampaigns.find((c) => c.id === a.audience_id)?.campaign_name ??
                    `(unknown — ${a.audience_id.slice(0, 8)}…)`,
                lastAssignedCounselorId: a.last_assigned_counselor_id,
                lastAssignedAt: a.last_assigned_at,
                // Absent on older rows = the default, assign at intake.
                assignOnIntake: a.assign_on_intake !== false,
            })),
        [pool.audiences, allCampaigns]
    );

    const available = useMemo(
        () =>
            allCampaigns.filter(
                (c) => c.id && !attachedIds.has(c.id) && !ownedByOtherPool.has(c.id)
            ),
        [allCampaigns, attachedIds, ownedByOtherPool]
    );

    const hiddenElsewhere = useMemo(
        () =>
            allCampaigns
                .filter((c) => c.id && ownedByOtherPool.has(c.id))
                .map((c) => ({
                    id: c.id!,
                    campaignName: c.campaign_name ?? '(unnamed campaign)',
                    poolName: ownedByOtherPool.get(c.id!)!,
                })),
        [allCampaigns, ownedByOtherPool]
    );

    // One atomic bulk attach. On failure the whole batch is rejected, so we keep
    // every checked id selected for retry; on success we clear them all.
    const handleAddAudiences = async (ids: string[]): Promise<string[]> => {
        try {
            await addAudiencesAsync(ids);
            toast.success(
                ids.length === 1 ? 'Campaign attached' : `${ids.length} campaigns attached`
            );
            return [];
        } catch (err) {
            // Someone may have attached one of these elsewhere since the list
            // loaded — refresh the ownership map so it stops being offered.
            invalidatePool();
            toast.error(extractError(err) ?? 'Failed to attach campaigns');
            return ids;
        }
    };

    const handleAssignOnIntakeChange = (audienceId: string, assignOnIntake: boolean) => {
        updateAssignOnIntake(
            { audienceId, assignOnIntake },
            {
                onSuccess: () =>
                    toast.success(
                        assignOnIntake
                            ? 'Leads will be assigned as soon as they arrive'
                            : 'Leads will be assigned only after the AI call'
                    ),
                onError: (err) =>
                    toast.error(extractError(err) ?? 'Failed to update assignment timing'),
            }
        );
    };

    const handleRemove = (audienceId: string, campaignName: string) => {
        if (!window.confirm(`Remove "${campaignName}" from this pool?`)) return;
        removeAudience(audienceId, {
            onSuccess: () => toast.success('Campaign detached'),
            onError: (err) => toast.error(extractError(err) ?? 'Failed to detach campaign'),
        });
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Add Campaign</CardTitle>
                    <CardDescription>
                        Attach a campaign to this pool. Leads submitted to that campaign will be
                        auto-routed using this pool&apos;s settings.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <MultiSelectAddList
                        items={available.map((c) => ({
                            id: c.id!,
                            label: c.campaign_name ?? '(unnamed campaign)',
                            sublabel: c.status,
                        }))}
                        loading={isLoading || poolsLoading}
                        onAdd={handleAddAudiences}
                        searchPlaceholder="Search campaigns…"
                        emptyText={
                            allCampaigns.length === 0
                                ? 'No campaigns in this institute yet.'
                                : 'No campaigns left to attach — the rest are already in a pool.'
                        }
                        itemNoun="campaign"
                    />
                    {hiddenElsewhere.length > 0 ? (
                        <details className="text-caption text-neutral-400">
                            <summary className="cursor-pointer hover:text-neutral-600">
                                {hiddenElsewhere.length} campaign
                                {hiddenElsewhere.length === 1 ? '' : 's'} hidden — already in
                                another pool
                            </summary>
                            <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pl-4">
                                {hiddenElsewhere.map((h) => (
                                    <li key={h.id} className="truncate">
                                        {h.campaignName} — in “{h.poolName}”
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-1 pl-4">
                                Remove it from that pool first to attach it here.
                            </p>
                        </details>
                    ) : (
                        <p className="text-caption text-neutral-400">
                            A campaign can belong to only one pool.
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Attached Campaigns ({attached.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {attached.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No campaigns attached yet.</p>
                    ) : (
                        <ul className="divide-y">
                            {attached.map((a) => (
                                <li
                                    key={a.audienceId}
                                    className="flex items-center justify-between py-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium">{a.campaignName}</p>
                                        {a.lastAssignedAt && (
                                            <p className="text-xs text-muted-foreground">
                                                Last assigned:{' '}
                                                {new Date(a.lastAssignedAt).toLocaleString()}
                                            </p>
                                        )}
                                        <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                                            {/* ON = the default (assign the moment a lead arrives); OFF = AI-first.
                                                Polarity matters: every existing list is ON, so the page reads
                                                "all normal" rather than "everything switched off". */}
                                            <Switch
                                                checked={a.assignOnIntake}
                                                disabled={updatingAssignment}
                                                onCheckedChange={(checked) =>
                                                    handleAssignOnIntakeChange(a.audienceId, checked)
                                                }
                                                aria-label="Auto-assign when a lead arrives"
                                            />
                                            <span>
                                                {a.assignOnIntake
                                                    ? 'Auto-assigns when a lead arrives'
                                                    : 'Off — AI-first: assigns only after the AI call qualifies the lead'}
                                            </span>
                                        </label>
                                    </div>
                                    <button
                                        type="button"
                                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                                        disabled={removing}
                                        onClick={() => handleRemove(a.audienceId, a.campaignName)}
                                    >
                                        Remove
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function extractError(err: unknown): string | undefined {
    return (
        (err as { response?: { data?: { ex?: string; message?: string } } })?.response?.data?.ex ??
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    );
}
