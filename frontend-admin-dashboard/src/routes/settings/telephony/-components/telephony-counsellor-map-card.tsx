import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { IdentificationBadge, Trash, Plus } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import {
    fetchTelephonyConfig,
    fetchTelephonyProviders,
    fetchCounsellorEndpoints,
    fetchEndpointEligibleUsers,
    upsertCounsellorEndpoint,
    deleteCounsellorEndpoint,
    type TelephonyCounsellorEndpoint,
    type TelephonyEndpointUser,
} from '../-services/telephony-admin';

/**
 * Per-user extension/DID mapping for providers without a number pool (Airtel).
 * Hidden for pooled providers (Exotel uses the Numbers card instead). Pick a
 * person and enter the extension their provider gave them — outbound calls dial
 * from it, and inbound CDRs/recordings are attributed back through it.
 *
 * The picker offers counsellors AND admins. It used to offer only counsellors,
 * so an admin had no extension and every call they placed failed at origination
 * — including calls to learners from the LMS side-view, where there is no
 * counsellor in the flow at all.
 */
export function TelephonyCounsellorMapCard() {
    const instituteId = getCurrentInstituteId() ?? '';
    const queryClient = useQueryClient();

    const configQuery = useQuery({
        queryKey: ['telephony-config', instituteId],
        queryFn: () => fetchTelephonyConfig(instituteId),
        enabled: !!instituteId,
    });
    const providersQuery = useQuery({
        queryKey: ['telephony-providers'],
        queryFn: fetchTelephonyProviders,
    });

    const providerType = configQuery.data?.providerType ?? '';
    const provider = providersQuery.data?.find((p) => p.providerType === providerType);
    // Only no-pool outbound providers need a per-counsellor extension map.
    const needsMap =
        !!provider &&
        provider.capabilities.includes('OUTBOUND_CALL') &&
        !provider.capabilities.includes('NUMBER_POOL');

    // Phone-system roster, not a lead-routing one: counsellors + admins, never
    // hierarchy-scoped. An admin mapping extensions must see everyone who can dial.
    const eligibleUsersQuery = useQuery({
        queryKey: ['telephony-endpoint-eligible-users', instituteId],
        queryFn: () => fetchEndpointEligibleUsers(instituteId),
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });
    const eligibleUsers: TelephonyEndpointUser[] = useMemo(
        () => eligibleUsersQuery.data ?? [],
        [eligibleUsersQuery.data]
    );
    const usersLoading = eligibleUsersQuery.isLoading;
    const userById = useMemo(() => new Map(eligibleUsers.map((u) => [u.id, u])), [eligibleUsers]);

    const endpointsQuery = useQuery({
        queryKey: ['telephony-counsellor-endpoints', instituteId, providerType],
        queryFn: () => fetchCounsellorEndpoints(instituteId, providerType),
        enabled: !!instituteId && needsMap && !!providerType,
    });

    const [counsellorUserId, setCounsellorUserId] = useState('');
    const [extension, setExtension] = useState('');
    const [providerUserId, setProviderUserId] = useState('');
    const [did, setDid] = useState('');

    const resetForm = () => {
        setCounsellorUserId('');
        setExtension('');
        setProviderUserId('');
        setDid('');
    };

    const invalidate = () =>
        queryClient.invalidateQueries({
            queryKey: ['telephony-counsellor-endpoints', instituteId, providerType],
        });

    const saveMutation = useMutation({
        mutationFn: (input: TelephonyCounsellorEndpoint) =>
            upsertCounsellorEndpoint(instituteId, input),
        onSuccess: () => {
            toast.success('Counsellor mapping saved');
            resetForm();
            invalidate();
        },
        onError: () => toast.error('Failed to save mapping'),
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteCounsellorEndpoint(id),
        onSuccess: () => {
            toast.success('Mapping removed');
            invalidate();
        },
        onError: () => toast.error('Failed to remove mapping'),
    });

    // When someone with an existing mapping is picked, pre-fill the form.
    const onPickCounsellor = (id: string) => {
        setCounsellorUserId(id);
        const existing = endpointsQuery.data?.find((e) => e.counsellorUserId === id);
        setExtension(existing?.extension ?? '');
        setProviderUserId(existing?.providerUserId ?? '');
        setDid(existing?.did ?? '');
    };

    const onSave = () => {
        if (!counsellorUserId) {
            toast.error('Pick a counsellor or admin');
            return;
        }
        if (!extension.trim()) {
            toast.error('Enter their extension');
            return;
        }
        saveMutation.mutate({
            counsellorUserId,
            providerType,
            extension: extension.trim(),
            providerUserId: providerUserId.trim() || null,
            did: did.trim() || null,
            enabled: true,
        });
    };

    if (!needsMap) return null;

    const endpoints = endpointsQuery.data ?? [];

    return (
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
                <IdentificationBadge className="size-5 text-primary-600" />
                <div>
                    <h2 className="text-base font-semibold text-neutral-900">User extensions</h2>
                    <p className="text-sm text-neutral-500">
                        Map each counsellor or admin to the extension {provider?.displayName} gave
                        them. Calls dial from it, and recordings are matched back to the right
                        person. An admin needs one too before they can call a learner.
                    </p>
                </div>
            </div>

            {/* Existing mappings */}
            {endpoints.length > 0 ? (
                <div className="mb-4 divide-y divide-neutral-100 rounded-md border border-neutral-200">
                    {endpoints.map((e) => (
                        <div key={e.id} className="flex items-center justify-between px-3 py-2">
                            <div className="flex flex-col">
                                <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                                    {userById.get(e.counsellorUserId)?.fullName ??
                                        e.counsellorUserId}
                                    <RoleBadges roles={userById.get(e.counsellorUserId)?.roles} />
                                </span>
                                <span className="text-xs text-neutral-500">
                                    Ext {e.extension}
                                    {e.did ? ` · DID ${e.did}` : ''}
                                    {e.providerUserId ? ` · ${e.providerUserId}` : ''}
                                </span>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => e.id && deleteMutation.mutate(e.id)}
                                disabled={deleteMutation.isPending}
                                aria-label="Remove mapping"
                            >
                                <Trash className="size-4 text-danger-600" />
                            </Button>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="mb-4 text-sm text-neutral-500">
                    Nobody mapped yet — add someone below so they can place calls.
                </p>
            )}

            {/* Add / edit a mapping */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                    <Label>Counsellor or admin</Label>
                    <Select value={counsellorUserId} onValueChange={onPickCounsellor}>
                        <SelectTrigger className="h-10">
                            <SelectValue
                                placeholder={usersLoading ? 'Loading…' : 'Select a person'}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {eligibleUsers.map((u) => (
                                <SelectItem key={u.id} value={u.id}>
                                    <span className="flex items-center gap-1.5">
                                        {u.fullName}
                                        <RoleBadges roles={u.roles} />
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1.5">
                    <Label>Extension</Label>
                    <Input
                        value={extension}
                        onChange={(e) => setExtension(e.target.value)}
                        placeholder="e.g. 447"
                    />
                </div>

                <div className="space-y-1.5">
                    <Label>Caller-ID number / DID (optional)</Label>
                    <Input
                        value={did}
                        onChange={(e) => setDid(e.target.value)}
                        placeholder="The number the lead sees"
                    />
                </div>

                <div className="space-y-1.5">
                    <Label>Provider user id (optional)</Label>
                    <Input
                        value={providerUserId}
                        onChange={(e) => setProviderUserId(e.target.value)}
                        placeholder="e.g. SauravSN"
                    />
                    <p className="text-xs text-neutral-500">
                        Helps match recordings when a record carries the user id but not the
                        extension.
                    </p>
                </div>
            </div>

            <div className="mt-4 flex justify-end">
                <Button onClick={onSave} disabled={saveMutation.isPending}>
                    <Plus className="mr-1 size-4" />
                    {saveMutation.isPending ? 'Saving…' : 'Save mapping'}
                </Button>
            </div>
        </div>
    );
}

/**
 * Role chips next to a name — the list mixes counsellors and admins, so whoever
 * is mapping extensions can tell them apart at a glance. Only the two roles this
 * picker selects on are shown; any other role a user holds is noise here.
 */
function RoleBadges({ roles }: { roles?: string[] | null }) {
    if (!roles || roles.length === 0) return null;
    const shown: string[] = [];
    if (roles.includes('ADMIN')) shown.push('Admin');
    if (roles.includes('COUNSELLOR') || roles.includes('COUNSELOR')) shown.push('Counsellor');
    if (shown.length === 0) return null;
    return (
        <>
            {shown.map((label) => (
                <span
                    key={label}
                    className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600"
                >
                    {label}
                </span>
            ))}
        </>
    );
}
