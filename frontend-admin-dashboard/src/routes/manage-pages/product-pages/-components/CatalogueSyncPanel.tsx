import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowsClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { cn } from '@/lib/utils';
import { getProductPage, syncProductPageCatalogue } from '../-services/product-pages-service';
import type { ProductPageResponse } from '../-types/product-page-types';
import { fetchStoreSites, useStoreSites } from '../-hooks/use-store-sites';
import {
    describeSyncReason,
    groupSyncItemsByReason,
    listCourseNames,
    parseSyncResponse,
    syncSummaryLine,
    type CatalogueSyncResult,
    type SyncReasonGroup,
} from '../-utils/catalogue-sync';

/**
 * "Sync all catalogue courses": one server call that adds every course version
 * published to the catalogue which this product page does not sell yet, so a
 * site-cart store page can check out anything the Courses page shows. The
 * server saves straight away; the caller re-seeds its rows from the result.
 */

interface CatalogueSyncPanelProps {
    productPageId: string;
    instituteId: string;
    /** The editor has unsaved changes. Syncing then would be overwritten by the next Save, so it waits. */
    isDirty?: boolean;
    /** The page as it is after the sync — from the response, or refetched when the response carried none. */
    onSynced?: (page: ProductPageResponse) => void;
    /** Told when a sync starts and ends, so the caller can lock its course rows meanwhile. */
    onRunningChange?: (running: boolean) => void;
    /**
     * A site's store page, which should sell exactly what the Courses page
     * shows: "switch off" then starts ticked. Leave it out and pass
     * `productPageCode` to have the panel look it up in the sites' settings
     * when a sync starts (or read it from the sites list's cache before then).
     */
    isStorePage?: boolean;
    productPageCode?: string | null;
    /** Tighter copy for the site settings card. */
    compact?: boolean;
}

const errorText = (e: unknown) => {
    const data = (e as { response?: { data?: { ex?: string; message?: string } } })?.response?.data;
    return data?.ex || data?.message || 'The sync did not finish. Please try again.';
};

const RELOAD_FAILED =
    'The sync finished, but the updated course list could not be loaded. Reload this page before you save — saving now would undo the sync.';

const ReasonList = ({ title, groups }: { title: string; groups: SyncReasonGroup[] }) => (
    <div>
        <p className="text-caption font-medium text-neutral-700">{title}</p>
        <ul className="ms-4 mt-0.5 list-disc space-y-1 text-caption text-neutral-600">
            {groups.map((g) => {
                const text = describeSyncReason(g.reason);
                return (
                    <li key={g.reason}>
                        <span className="font-medium text-neutral-700">{text.label}</span> — {g.count}
                        {g.names.length > 0 && `: ${listCourseNames(g.names)}`}
                        {text.hint && <span className="block text-neutral-500">{text.hint}</span>}
                    </li>
                );
            })}
        </ul>
    </div>
);

export const CatalogueSyncPanel = ({
    productPageId,
    instituteId,
    isDirty = false,
    onSynced,
    onRunningChange,
    isStorePage,
    productPageCode,
    compact = false,
}: CatalogueSyncPanelProps) => {
    const queryClient = useQueryClient();
    // Finding out whether this is a store page loads every site's whole
    // catalogue JSON, so it happens only when a sync starts. Until then the
    // panel goes by what the sites list already cached (null = not known).
    const lookUp = isStorePage === undefined;
    const storeSites = useStoreSites(instituteId, lookUp ? productPageCode : null, {
        fetch: false,
    });
    const storePage = isStorePage ?? !!storeSites?.length;
    // The admin's own tick wins; until then the default follows the kind of
    // page (which may only be known once a sync has started).
    const [deactivateChoice, setDeactivateChoice] = useState<boolean | null>(null);
    const deactivateMissing = deactivateChoice ?? storePage;
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [checking, setChecking] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<CatalogueSyncResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const blocked = isDirty || !productPageId || !instituteId;
    // The props as they are now, for a sync start that resumes after the
    // store-page lookup.
    const latest = useRef({ blocked, productPageId, instituteId });
    latest.current = { blocked, productPageId, instituteId };

    const startSync = async () => {
        let store = storePage;
        // An untouched box takes its default from the kind of page: find out now.
        if (deactivateChoice === null && lookUp && (productPageCode || '').trim()) {
            setChecking(true);
            try {
                const sites = await fetchStoreSites(queryClient, instituteId, productPageCode);
                store = sites.length > 0;
            } catch {
                // The sites did not load: keep what the cache said (unticked
                // when nothing was cached, so the sync then only adds).
            } finally {
                setChecking(false);
            }
            // The course rows stay editable during the lookup. A row edited
            // meanwhile would be lost to the sync's rows, and a page the editor
            // moved to was not the one looked up, so the dialog waits for the
            // next click ("Save your changes first" shows meanwhile).
            const now = latest.current;
            const moved = now.productPageId !== productPageId || now.instituteId !== instituteId;
            if (now.blocked || moved) return;
        }
        // Settle the default now, so the dialog's wording and the sync agree
        // even if the sites' settings change while it is open.
        setDeactivateChoice((choice) => choice ?? store);
        setConfirmOpen(true);
    };

    const run = async () => {
        setConfirmOpen(false);
        // Unsaved edits since the dialog opened: saving them later would undo the sync.
        if (latest.current.blocked) return;
        setRunning(true);
        onRunningChange?.(true);
        setError(null);
        setResult(null);
        try {
            let parsed: CatalogueSyncResult;
            try {
                parsed = parseSyncResponse(
                    await syncProductPageCatalogue(productPageId, instituteId, { deactivateMissing })
                );
            } catch (e) {
                setError(errorText(e));
                return;
            }
            let page: ProductPageResponse;
            try {
                page = parsed.page ?? (await getProductPage(productPageId));
                if (!page?.id) throw new Error('No product page in the response');
            } catch {
                // Saved on the server, but the fresh page never arrived. Drop a
                // cached copy no screen is showing, so the editor fetches anew when
                // it next opens; an open editor's copy is refetched in the
                // background instead (removing it would blank the editor).
                const key = ['productPage', productPageId];
                queryClient.removeQueries({ queryKey: key, exact: true, type: 'inactive' });
                queryClient.invalidateQueries({ queryKey: key, exact: true });
                setError(RELOAD_FAILED);
                return;
            }
            // The product page editor seeds its rows from this cache entry once
            // per visit. Left at the pre-sync page, reopening the editor would
            // show — and on Save write back — the rows from before the sync.
            queryClient.setQueryData(['productPage', productPageId], page);
            setResult(parsed);
            onSynced?.(page);
            // Canvas previews and pickers that show this page's courses.
            queryClient.invalidateQueries({ queryKey: ['PP_OFFER_PREVIEW'] });
            queryClient.invalidateQueries({ queryKey: ['PRODUCT_PAGES_FOR_CATALOGUE', instituteId] });
        } finally {
            setRunning(false);
            onRunningChange?.(false);
        }
    };

    const switchedOffByReason = result ? groupSyncItemsByReason(result.deactivatedMappings) : [];
    const skippedByReason = result ? groupSyncItemsByReason(result.skipped) : [];

    return (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-800">Catalogue courses</p>
                    <p className="mt-0.5 text-caption text-neutral-500">
                        {compact
                            ? 'Adds every course version on your Courses page that the store page does not sell yet.'
                            : 'Adds every course version published to your catalogue that this page does not sell yet, after the courses already here. Each one sells through its default invite, at that invite’s price. Saved at once.'}
                    </p>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    disable={blocked || running || checking}
                    onClick={startSync}
                >
                    <ArrowsClockwise
                        className={cn('size-3.5', (running || checking) && 'animate-spin')}
                    />
                    {running ? 'Syncing…' : 'Sync all catalogue courses'}
                </MyButton>
            </div>

            <div className="space-y-1">
                <label className="flex cursor-pointer items-start gap-2 text-caption text-neutral-600">
                    <Checkbox
                        className="mt-0.5"
                        checked={deactivateMissing}
                        onCheckedChange={(v) => setDeactivateChoice(v === true)}
                        disabled={running}
                    />
                    Also switch off courses on this page that are not published to your catalogue (including any
                    that never were) or can no longer be sold
                </label>
                <p className="ms-6 text-caption text-neutral-400">
                    {storePage
                        ? 'Ticked by default on a store page: it should sell exactly what your Courses page shows.'
                        : storeSites === null
                          ? 'Ticked by default if this is a site’s store page (checked when you sync): a store page should sell exactly what your Courses page shows.'
                          : 'Unticked by default here: courses this page sells that are not on your Courses page would be switched off.'}
                </p>
            </div>

            {isDirty && (
                <p className="flex items-center gap-1.5 text-caption text-warning-600">
                    <WarningCircle className="size-3.5 shrink-0" />
                    Save your changes first. The sync updates this page on the server, and saving the unsaved edits
                    afterwards would undo it.
                </p>
            )}

            {error && (
                <p role="alert" className="flex items-start gap-1.5 text-caption text-danger-600">
                    <WarningCircle className="mt-0.5 size-3.5 shrink-0" />
                    {error}
                </p>
            )}

            {result && !error && (
                <div className="space-y-2 rounded-md border border-success-200 bg-success-50 p-3" aria-live="polite">
                    <p className="flex items-center gap-1.5 text-caption font-semibold text-success-700">
                        <CheckCircle className="size-3.5 shrink-0" weight="fill" />
                        {syncSummaryLine(result)}
                    </p>
                    {switchedOffByReason.length > 0 && <ReasonList title="Switched off:" groups={switchedOffByReason} />}
                    {skippedByReason.length > 0 && <ReasonList title="Not added:" groups={skippedByReason} />}
                    {result.warnings.length > 0 && (
                        <div className="rounded border border-warning-200 bg-warning-50 p-2">
                            {result.warnings.map((w) => (
                                <p key={w} className="flex items-start gap-1.5 text-caption text-warning-700">
                                    <WarningCircle className="mt-0.5 size-3.5 shrink-0" />
                                    {w}
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Sync the catalogue into this product page?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Every course version published to your catalogue that this page does not sell yet is
                            added after the existing courses.
                            {deactivateMissing
                                ? ' Courses on this page that are not published to your catalogue — including any that never were — or that can no longer be sold (a closed invite link, or an inactive payment option or plan) are switched off.'
                                : ' Courses already on this page stay as they are.'}{' '}
                            This is saved straight away — on a live page, visitors see the change at once. You can
                            still reorder or remove courses afterwards.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={run} disabled={blocked}>
                            Sync now
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};
