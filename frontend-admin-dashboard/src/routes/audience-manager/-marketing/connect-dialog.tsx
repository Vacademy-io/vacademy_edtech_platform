/**
 * After OAuth: lists the ad accounts / Pages / Instagram accounts / Business Profile
 * locations the signed-in login can reach and connects the ones the admin ticks. The
 * server re-fetches the options on select, so only external ids are sent.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WarningCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatusPill } from '@/components/shared/crm-enhance/screen-header';
import { cn } from '@/lib/utils';
import { marketingErrorMessage } from './marketing-api';
import { useConnectOptions, useSelectConnectOptions } from './use-marketing';
import { PlatformIcon, providerLabel } from './platform-meta';
import type {
    ConnectOption,
    MarketingPlatform,
    MarketingProvider,
    SelectConnectOptionsResponse,
} from './types';

function optionPlatform(
    option: ConnectOption,
    provider: MarketingProvider | null
): MarketingPlatform {
    switch (option.kind) {
        case 'FACEBOOK_PAGE':
            return 'FACEBOOK';
        case 'INSTAGRAM':
            return 'INSTAGRAM';
        case 'GBP_LOCATION':
            return 'GOOGLE_BUSINESS';
        default:
            return provider === 'META_ADS' || provider === 'META_SOCIAL' ? 'META' : 'GOOGLE';
    }
}

export interface ConnectAccountsDialogProps {
    /** Authorised OAuth session (mkt_session); the dialog loads nothing without it. */
    sessionKey: string | null;
    /** Provider from the return URL; the options response's provider wins once loaded. */
    provider: MarketingProvider | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called after a successful connect, before the dialog closes. */
    onDone?: (result: SelectConnectOptionsResponse) => void;
}

export function ConnectAccountsDialog({
    sessionKey,
    provider,
    open,
    onOpenChange,
    onDone,
}: ConnectAccountsDialogProps) {
    const { t } = useTranslation('marketing');
    const optionsQuery = useConnectOptions(sessionKey, open);
    const select = useSelectConnectOptions();
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const data = optionsQuery.data;
    const effectiveProvider = data?.provider ?? provider;
    const options = useMemo(() => data?.options ?? [], [data]);
    const selectable = useMemo(() => options.filter((o) => o.selectable), [options]);

    // Pre-tick everything selectable once the options arrive, including accounts that are
    // already connected: select re-binds them to this sign-in, stores a fresh Page token
    // and clears a RECONNECT_NEEDED / ERROR status (it is idempotent). The Reconnect
    // buttons land here, so leaving them unticked would make reconnect a no-op.
    useEffect(() => {
        if (!data) return;
        setSelected(new Set(data.options.filter((o) => o.selectable).map((o) => o.external_id)));
    }, [data]);

    const toggle = (externalId: string, checked: boolean) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(externalId);
            else next.delete(externalId);
            return next;
        });

    const allSelected =
        selectable.length > 0 && selectable.every((o) => selected.has(o.external_id));
    const toggleAll = () =>
        setSelected(allSelected ? new Set() : new Set(selectable.map((o) => o.external_id)));

    const connect = () => {
        if (!sessionKey || selected.size === 0) return;
        select.mutate(
            { sessionKey, externalIds: Array.from(selected) },
            {
                onSuccess: (result) => {
                    onDone?.(result);
                    onOpenChange(false);
                },
            }
        );
    };

    const heading = effectiveProvider
        ? t('connect.dialogTitle', { provider: providerLabel(effectiveProvider, t) })
        : t('connect.dialogTitleGeneric');

    const canConnect = !!data && selected.size > 0 && !select.isPending;
    // Every ticked option is already connected: this is a reconnect, so say so.
    const reconnectOnly =
        selected.size > 0 &&
        options.every((o) => !selected.has(o.external_id) || o.already_connected);

    return (
        <MyDialog
            heading={heading}
            open={open}
            onOpenChange={(next) => {
                if (!select.isPending) onOpenChange(next);
            }}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                        disable={select.isPending}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={connect}
                        disable={!canConnect}
                    >
                        {select.isPending
                            ? t('connect.connecting')
                            : reconnectOnly
                              ? t('connect.reconnectSelected', { count: selected.size })
                              : t('connect.connectSelected', { count: selected.size })}
                    </MyButton>
                </>
            }
        >
            {!sessionKey ? (
                <p className="text-body text-neutral-600">{t('connect.noSession')}</p>
            ) : optionsQuery.isLoading ? (
                <div className="flex flex-col gap-3" aria-busy="true">
                    <span className="sr-only">{t('connect.loadingOptions')}</span>
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="flex items-center gap-3">
                            <Skeleton className="size-4 rounded-sm" />
                            <Skeleton className="size-8 rounded-md" />
                            <div className="flex flex-1 flex-col gap-1">
                                <Skeleton className="h-4 w-1/2" />
                                <Skeleton className="h-3 w-1/3" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : optionsQuery.isError ? (
                <Alert variant="destructive">
                    <WarningCircle size={18} />
                    <AlertTitle>{t('connect.loadFailed')}</AlertTitle>
                    <AlertDescription className="text-body">
                        {marketingErrorMessage(optionsQuery.error, t('connect.loadFailedHint'))}
                    </AlertDescription>
                </Alert>
            ) : options.length === 0 ? (
                <div className="flex flex-col gap-1">
                    <p className="text-subtitle font-semibold text-neutral-700">
                        {t('connect.noOptions')}
                    </p>
                    <p className="text-body text-neutral-500">{t('connect.noOptionsHint')}</p>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                        <p className="text-caption text-neutral-500">
                            {data?.account_name
                                ? t('connect.signedInAs', { name: data.account_name })
                                : t('connect.chooseHint')}
                        </p>
                        {selectable.length > 1 && (
                            <MyButton buttonType="text" scale="small" onClick={toggleAll}>
                                {allSelected ? t('connect.clearAll') : t('connect.selectAll')}
                            </MyButton>
                        )}
                    </div>
                    <ul className="flex flex-col divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                        {options.map((option) => {
                            const id = `mkt-opt-${option.kind}-${option.external_id}`;
                            const checked = selected.has(option.external_id);
                            return (
                                <li key={`${option.kind}:${option.external_id}`}>
                                    <label
                                        htmlFor={id}
                                        className={cn(
                                            'flex items-start gap-3 px-3 py-2.5',
                                            option.selectable
                                                ? 'cursor-pointer hover:bg-neutral-50'
                                                : 'cursor-not-allowed opacity-70'
                                        )}
                                    >
                                        <Checkbox
                                            id={id}
                                            className="mt-2"
                                            checked={checked}
                                            disabled={!option.selectable || select.isPending}
                                            onCheckedChange={(v) =>
                                                toggle(option.external_id, v === true)
                                            }
                                        />
                                        <PlatformIcon
                                            platform={optionPlatform(option, effectiveProvider)}
                                            size="md"
                                        />
                                        <span className="flex min-w-0 flex-1 flex-col">
                                            <span className="flex flex-wrap items-center gap-2">
                                                <span className="truncate text-body font-medium text-neutral-800">
                                                    {option.name || option.external_id}
                                                </span>
                                                {option.already_connected && (
                                                    <StatusPill
                                                        tone="success"
                                                        className="text-caption"
                                                    >
                                                        {checked
                                                            ? t('connect.willRefresh')
                                                            : t('connect.alreadyConnected')}
                                                    </StatusPill>
                                                )}
                                            </span>
                                            {option.subtitle && (
                                                <span className="truncate text-caption text-neutral-500">
                                                    {option.subtitle}
                                                </span>
                                            )}
                                            {option.warning && (
                                                <span className="mt-0.5 flex items-center gap-1 text-caption text-warning-700">
                                                    <WarningCircle size={14} className="shrink-0" />
                                                    {option.warning}
                                                </span>
                                            )}
                                        </span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                    {selectable.length === 0 && (
                        <p className="text-caption text-warning-700">
                            {t('connect.noneSelectable')}
                        </p>
                    )}
                </div>
            )}
        </MyDialog>
    );
}
