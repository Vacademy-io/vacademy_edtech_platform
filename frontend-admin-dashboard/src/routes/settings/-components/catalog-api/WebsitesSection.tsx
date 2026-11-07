import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, CircleNotch, Globe, Plus, Warning } from '@phosphor-icons/react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { formatDate, formatRelative } from '@/lib/formatters';
import { apiKeyErrorMessage } from '../../-services/evaluation-api-keys';
import {
    CATALOG_WEBSITES_QUERY_KEY,
    MAX_HOST_LENGTH,
    addWebsite,
    fetchWebsites,
    normalizeWebsiteHost,
    removeWebsite,
    verifyWebsite,
    type CatalogWebsite,
    type WebsiteStatus,
} from '../../-services/catalog-api';
import { CopyField } from './CopyField';

const STATUS_CHIP: Record<WebsiteStatus, StatusType> = {
    VERIFIED: 'SUCCESS',
    PENDING: 'WARNING',
    REVOKED: 'DANGER',
};

/**
 * "Your websites": the hosts a publishable key works from. Add (a pasted URL is fine),
 * show the TXT record to create, verify now, remove. A row Vacademy revoked can only be
 * restored by support, so it has no actions.
 */
export function WebsitesSection({ instituteId }: { instituteId: string }) {
    const { t } = useTranslation('settingsIntegration');
    const queryClient = useQueryClient();
    const queryKey = [CATALOG_WEBSITES_QUERY_KEY, instituteId];

    const [addOpen, setAddOpen] = useState(false);
    const [hostInput, setHostInput] = useState('');
    const [hostError, setHostError] = useState<string | null>(null);
    // The website whose DNS instructions are open. The live list row wins, so a Verify
    // inside the dialog shows the new status; the stored copy covers a list refetch
    // that has not caught up with a just-added website yet.
    const [dnsTargetSnapshot, setDnsTarget] = useState<CatalogWebsite | null>(null);
    const [removeTarget, setRemoveTarget] = useState<CatalogWebsite | null>(null);

    const websitesQuery = useQuery({
        queryKey,
        queryFn: () => fetchWebsites(instituteId),
        enabled: Boolean(instituteId),
        staleTime: 60_000,
        retry: false,
    });
    const websites = websitesQuery.data ?? [];
    const dnsTarget = dnsTargetSnapshot
        ? websites.find((w) => w.id === dnsTargetSnapshot.id) ?? dnsTargetSnapshot
        : null;

    const replaceRow = (site: CatalogWebsite) =>
        queryClient.setQueryData<CatalogWebsite[]>(queryKey, (prev) => {
            const rows = prev ?? [];
            return rows.some((w) => w.id === site.id)
                ? rows.map((w) => (w.id === site.id ? site : w))
                : [...rows, site];
        });

    const addMutation = useMutation({
        mutationFn: (raw: string) => addWebsite(instituteId, raw),
        onSuccess: (site) => {
            replaceRow(site);
            setAddOpen(false);
            setHostInput('');
            setDnsTarget(site);
            toast.success(t('catalogApi.websites.toasts.added', { host: site.host }));
            void queryClient.invalidateQueries({ queryKey: [CATALOG_WEBSITES_QUERY_KEY] });
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('catalogApi.websites.toasts.addFailed'));
        },
    });

    const verifyMutation = useMutation({
        mutationFn: (websiteId: string) => verifyWebsite(instituteId, websiteId),
        onSuccess: (site) => {
            replaceRow(site);
            setDnsTarget((open) => (open?.id === site.id ? site : open));
            if (site.status === 'VERIFIED') {
                toast.success(t('catalogApi.websites.toasts.verified', { host: site.host }));
            } else {
                toast.warning(site.lastError ?? t('catalogApi.websites.toasts.notYet'));
            }
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('catalogApi.websites.toasts.verifyFailed'));
        },
    });
    const verifyingId = verifyMutation.isPending ? verifyMutation.variables ?? null : null;

    const removeMutation = useMutation({
        mutationFn: (websiteId: string) => removeWebsite(instituteId, websiteId),
        onSuccess: () => {
            toast.success(t('catalogApi.websites.toasts.removed'));
            setRemoveTarget(null);
            void queryClient.invalidateQueries({ queryKey: [CATALOG_WEBSITES_QUERY_KEY] });
        },
        onError: (err: unknown) => {
            toast.error(apiKeyErrorMessage(err) ?? t('catalogApi.websites.toasts.removeFailed'));
        },
    });

    const preview = normalizeWebsiteHost(hostInput);

    const submitAdd = () => {
        if (preview.error) {
            setHostError(t(`catalogApi.websites.addDialog.errors.${preview.error}`));
            return;
        }
        setHostError(null);
        addMutation.mutate(hostInput);
    };

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-800">
                        {t('catalogApi.websites.title')}
                    </p>
                    <p className="text-caption text-neutral-500">
                        {t('catalogApi.websites.description')}
                    </p>
                </div>
                {!websitesQuery.isLoading && !websitesQuery.error && (
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => {
                            setHostInput('');
                            setHostError(null);
                            setAddOpen(true);
                        }}
                    >
                        <Plus className="size-4" />
                        {t('catalogApi.websites.add')}
                    </MyButton>
                )}
            </div>

            {websitesQuery.isLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-neutral-500">
                    <CircleNotch className="size-4 animate-spin text-primary-500" />
                    {t('catalogApi.loading')}
                </div>
            ) : websitesQuery.error ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-100 bg-warning-50 p-3 text-sm text-warning-700">
                    <span>
                        {apiKeyErrorMessage(websitesQuery.error) ??
                            t('catalogApi.websites.loadError')}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => void websitesQuery.refetch()}
                    >
                        {t('catalogApi.retry')}
                    </MyButton>
                </div>
            ) : websites.length === 0 ? (
                <div className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-neutral-200 bg-neutral-50/50 px-4 py-6 text-center">
                    <Globe className="size-6 text-neutral-400" />
                    <p className="text-sm font-medium text-neutral-600">
                        {t('catalogApi.websites.emptyTitle')}
                    </p>
                    <p className="text-caption text-neutral-500">
                        {t('catalogApi.websites.emptyDescription')}
                    </p>
                </div>
            ) : (
                <ul className="flex flex-col divide-y rounded-lg border">
                    {websites.map((site) => (
                        <WebsiteRow
                            key={site.id}
                            site={site}
                            verifying={verifyingId === site.id}
                            onShowRecord={() => setDnsTarget(site)}
                            onVerify={() => verifyMutation.mutate(site.id)}
                            onRemove={() => setRemoveTarget(site)}
                        />
                    ))}
                </ul>
            )}

            {/* ── Add ── */}
            <MyDialog
                heading={t('catalogApi.websites.addDialog.heading')}
                open={addOpen}
                onOpenChange={(open) => {
                    if (!addMutation.isPending) setAddOpen(open);
                }}
                dialogWidth="max-w-lg"
                footer={
                    <div className="flex justify-end gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            disable={addMutation.isPending}
                            onClick={() => setAddOpen(false)}
                        >
                            {t('catalogApi.websites.addDialog.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable={addMutation.isPending}
                            onClick={submitAdd}
                        >
                            {addMutation.isPending && (
                                <CircleNotch className="size-4 animate-spin" />
                            )}
                            {t('catalogApi.websites.addDialog.submit')}
                        </MyButton>
                    </div>
                }
            >
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (!addMutation.isPending) submitAdd();
                    }}
                >
                    <MyInput
                        label={t('catalogApi.websites.addDialog.label')}
                        inputPlaceholder={t('catalogApi.websites.addDialog.placeholder')}
                        input={hostInput}
                        required
                        maxLength={MAX_HOST_LENGTH + 200}
                        className="sm:w-full"
                        error={hostError}
                        onChangeFunction={(e) => {
                            setHostInput(e.target.value);
                            setHostError(null);
                        }}
                    />
                    {preview.host && preview.host !== hostInput.trim() && (
                        <p className="text-caption text-neutral-600">
                            {t('catalogApi.websites.addDialog.preview', { host: preview.host })}
                        </p>
                    )}
                    <p className="text-caption text-neutral-500">
                        {t('catalogApi.websites.addDialog.hint')}
                    </p>
                </form>
            </MyDialog>

            {/* ── DNS instructions ── */}
            <MyDialog
                heading={t('catalogApi.websites.dns.heading', { host: dnsTarget?.host ?? '' })}
                open={Boolean(dnsTarget)}
                onOpenChange={(open) => {
                    if (!open) setDnsTarget(null);
                }}
                dialogWidth="max-w-xl"
                footer={
                    <div className="flex justify-end gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => setDnsTarget(null)}
                        >
                            {t('catalogApi.websites.dns.close')}
                        </MyButton>
                        {dnsTarget?.status === 'PENDING' && (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                disable={verifyingId === dnsTarget.id}
                                onClick={() => verifyMutation.mutate(dnsTarget.id)}
                            >
                                {verifyingId === dnsTarget.id && (
                                    <CircleNotch className="size-4 animate-spin" />
                                )}
                                {t('catalogApi.websites.verify')}
                            </MyButton>
                        )}
                    </div>
                }
            >
                {dnsTarget && <DnsInstructions site={dnsTarget} />}
            </MyDialog>

            {/* ── Remove ── */}
            <AlertDialog
                open={Boolean(removeTarget)}
                onOpenChange={(open) => {
                    if (!open && !removeMutation.isPending) setRemoveTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('catalogApi.websites.removeConfirm.title', {
                                host: removeTarget?.host ?? '',
                            })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('catalogApi.websites.removeConfirm.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removeMutation.isPending}>
                            {t('catalogApi.websites.removeConfirm.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={removeMutation.isPending}
                            onClick={(e) => {
                                e.preventDefault();
                                if (removeTarget) removeMutation.mutate(removeTarget.id);
                            }}
                            className="bg-danger-600 hover:bg-danger-700"
                        >
                            {removeMutation.isPending && (
                                <CircleNotch className="me-2 size-4 animate-spin" />
                            )}
                            {t('catalogApi.websites.removeConfirm.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}

function WebsiteRow({
    site,
    verifying,
    onShowRecord,
    onVerify,
    onRemove,
}: {
    site: CatalogWebsite;
    verifying: boolean;
    onShowRecord: () => void;
    onVerify: () => void;
    onRemove: () => void;
}) {
    const { t } = useTranslation('settingsIntegration');
    const revoked = site.status === 'REVOKED';
    const pending = site.status === 'PENDING';

    return (
        <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-all text-sm font-medium text-neutral-800">
                        {site.host}
                    </span>
                    <StatusChip
                        text={t(`catalogApi.websites.status.${site.status}`)}
                        textSize="text-caption"
                        status={STATUS_CHIP[site.status]}
                        showIcon={false}
                    />
                </div>
                {revoked ? (
                    <p className="text-caption text-danger-600">
                        {t('catalogApi.websites.revoked')}
                        {site.revokedReason && (
                            <span className="block text-neutral-500">
                                {t('catalogApi.websites.revokedReason', {
                                    reason: site.revokedReason,
                                })}
                            </span>
                        )}
                    </p>
                ) : site.status === 'VERIFIED' ? (
                    site.verifiedAt && (
                        <p className="text-caption text-neutral-500">
                            {t('catalogApi.websites.verifiedOn', {
                                date: formatDate(site.verifiedAt),
                            })}
                        </p>
                    )
                ) : (
                    <>
                        <p
                            className="text-caption text-neutral-500"
                            title={site.lastCheckedAt ?? undefined}
                        >
                            {site.lastCheckedAt
                                ? t('catalogApi.websites.lastChecked', {
                                      when: formatRelative(site.lastCheckedAt),
                                  })
                                : t('catalogApi.websites.waiting')}
                        </p>
                        {site.lastError && (
                            <p className="flex items-start gap-1 text-caption text-warning-700">
                                <Warning className="mt-0.5 size-3.5 shrink-0" />
                                <span>{site.lastError}</span>
                            </p>
                        )}
                    </>
                )}
            </div>
            {!revoked && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {pending && (
                        <>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={onShowRecord}
                            >
                                {t('catalogApi.websites.showRecord')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                disable={verifying}
                                onClick={onVerify}
                            >
                                {verifying && <CircleNotch className="size-3.5 animate-spin" />}
                                {t('catalogApi.websites.verify')}
                            </MyButton>
                        </>
                    )}
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        className="text-danger-600"
                        onClick={onRemove}
                    >
                        {t('catalogApi.websites.remove')}
                    </MyButton>
                </div>
            )}
        </li>
    );
}

function DnsInstructions({ site }: { site: CatalogWebsite }) {
    const { t } = useTranslation('settingsIntegration');

    if (site.status === 'VERIFIED') {
        return (
            <div className="flex items-start gap-2 rounded-md border border-success-200 bg-success-50 p-3 text-sm text-success-700">
                <CheckCircle className="mt-0.5 size-4 shrink-0" weight="fill" />
                <span>{t('catalogApi.websites.dns.verified')}</span>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="text-sm text-neutral-700">{t('catalogApi.websites.dns.intro')}</p>
            <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm text-neutral-600">
                <li>{t('catalogApi.websites.dns.step1')}</li>
                <li>{t('catalogApi.websites.dns.step2')}</li>
                <li>{t('catalogApi.websites.dns.step3')}</li>
            </ol>
            {site.dnsRecord ? (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <p className="text-caption font-medium text-neutral-600">
                            {t('catalogApi.websites.dns.type')}
                        </p>
                        <p className="font-mono text-xs text-neutral-800">{site.dnsRecord.type}</p>
                    </div>
                    <CopyField
                        label={t('catalogApi.websites.dns.name')}
                        value={site.dnsRecord.name}
                    />
                    <p className="text-caption text-neutral-500">
                        {t('catalogApi.websites.dns.nameHint')}
                    </p>
                    <CopyField
                        label={t('catalogApi.websites.dns.value')}
                        value={site.dnsRecord.value}
                    />
                </div>
            ) : (
                <p className="text-sm text-warning-700">{t('catalogApi.websites.dns.noRecord')}</p>
            )}
            {site.lastError && (
                <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                    <Warning className="mt-0.5 size-4 shrink-0" />
                    <span>{site.lastError}</span>
                </div>
            )}
        </div>
    );
}
