import { useQuery } from '@tanstack/react-query';
import { ArrowSquareOut, WarningCircle } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getAllProductPages } from '../../product-pages/-services/product-pages-service';
import { CatalogueSyncPanel } from '../../product-pages/-components/CatalogueSyncPanel';
import type { SiteCartSettings } from '../../-types/editor-types';

/**
 * Global Settings → Site cart (globalSettings.siteCart).
 *
 * One cart for the whole site: Courses page cards, course pages and learning
 * paths all add to it, and checkout is the chosen STORE product page's — one
 * payment for many courses, with that page's coupons, offers and gateway.
 * The store page must sell every course the site shows, which the catalogue
 * sync below takes care of. On only when switched on AND a store is chosen.
 */

interface SiteCartSettingsCardProps {
    value: SiteCartSettings | undefined;
    onChange: (next: SiteCartSettings) => void;
}

export const SiteCartSettingsCard = ({ value, onChange }: SiteCartSettingsCardProps) => {
    const instituteId = getCurrentInstituteId() || '';
    const enabled = !!value?.enabled;
    const code = (value?.storeProductPageCode || '').trim();
    const autoSync = value?.autoSync !== false;

    const setAutoSync = (on: boolean) => {
        // On is the default: drop the key rather than store `autoSync: true`.
        const rest: SiteCartSettings = { ...value };
        delete rest.autoSync;
        onChange(on ? rest : { ...rest, autoSync: false });
    };

    const {
        data: pages,
        isLoading,
        isError,
    } = useQuery({
        queryKey: ['PRODUCT_PAGES_FOR_CATALOGUE', instituteId],
        queryFn: () => getAllProductPages(instituteId),
        enabled: enabled && !!instituteId,
        staleTime: 60_000,
    });
    const list = Array.isArray(pages) ? pages : [];
    const store = list.find((p) => p.code === code);
    const storeMissing = !!code && !isLoading && !isError && !store;

    return (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center justify-between gap-3">
                <h4 className="font-medium text-neutral-700">Site cart</h4>
                <Switch
                    checked={enabled}
                    onCheckedChange={(c) => onChange({ ...value, enabled: c })}
                    aria-label="Site-wide cart"
                />
            </div>
            <p className="text-caption text-neutral-500">
                One cart across the whole site. Visitors collect courses from the Courses page,
                course pages and learning paths, then pay once through your store product page — its
                coupons, offers and payment gateway apply.
            </p>

            {enabled && (
                <div className="space-y-3">
                    <div>
                        <Label htmlFor="site-cart-store" className="text-xs">
                            Store product page
                        </Label>
                        <select
                            id="site-cart-store"
                            className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs"
                            value={store ? store.code : code}
                            onChange={(e) => {
                                const picked = list.find((p) => p.code === e.target.value);
                                onChange({
                                    ...value,
                                    enabled,
                                    storeProductPageCode: picked?.code || '',
                                    storeProductPageName: picked?.name || '',
                                });
                            }}
                        >
                            <option value="">
                                {isLoading ? 'Loading product pages…' : 'Choose the store page'}
                            </option>
                            {storeMissing && (
                                <option value={code}>
                                    {value?.storeProductPageName || code} (not found)
                                </option>
                            )}
                            {list.map((p) => (
                                <option key={p.id} value={p.code}>
                                    {p.name}
                                    {p.status !== 'ACTIVE'
                                        ? ` (${String(p.status).toLowerCase()})`
                                        : ''}
                                </option>
                            ))}
                        </select>
                        {!code && (
                            <p className="mt-1 flex items-center gap-1 text-caption text-warning-600">
                                <WarningCircle className="size-3.5 shrink-0" />
                                The cart stays off until a store page is chosen.
                            </p>
                        )}
                        {isError && (
                            <p className="mt-1 text-caption text-danger-600">
                                Could not load your product pages. Close and reopen Global Settings
                                to try again.
                            </p>
                        )}
                        {storeMissing && (
                            <p className="mt-1 text-caption text-danger-600">
                                This product page no longer exists, so checkout would fail. Choose
                                another.
                            </p>
                        )}
                        {store && store.status !== 'ACTIVE' && (
                            <p className="mt-1 text-caption text-warning-600">
                                This page is a draft. Its checkout works, but make it active before
                                you go live.
                            </p>
                        )}
                        {!isLoading && !isError && list.length === 0 && (
                            <p className="mt-1 text-caption text-neutral-500">
                                No product pages yet. Create one under Manage Pages → Product pages
                                (for example &ldquo;Store&rdquo;), then pick it here.
                            </p>
                        )}
                        <p className="mt-1 text-caption text-neutral-400">
                            Use a page made for this: the catalogue sync adds your catalogue courses
                            to it, each through its default invite link.
                        </p>
                    </div>

                    {store && (
                        <>
                            <div className="space-y-1">
                                <label
                                    htmlFor="site-cart-auto-sync"
                                    className="flex cursor-pointer items-start gap-2 text-caption text-neutral-600"
                                >
                                    <Checkbox
                                        id="site-cart-auto-sync"
                                        className="mt-0.5"
                                        checked={autoSync}
                                        onCheckedChange={(v) => setAutoSync(v === true)}
                                    />
                                    Keep the store in step with the catalogue
                                </label>
                                <p className="ms-6 text-caption text-neutral-400">
                                    Every few minutes, new course versions are added to the store
                                    and ones that leave the catalogue are switched off. Turn off to
                                    manage the store by hand.
                                </p>
                            </div>
                            <CatalogueSyncPanel
                                // A fresh panel per store page: another page's summary never lingers.
                                key={store.id}
                                productPageId={store.id}
                                instituteId={instituteId}
                                isStorePage
                                compact
                            />
                            <a
                                href={`/manage-pages/product-pages/editor/${encodeURIComponent(store.id)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-caption font-medium text-primary-500 hover:underline"
                            >
                                Open the store page <ArrowSquareOut className="size-3.5" />
                            </a>
                            <p className="text-caption text-neutral-400">
                                {autoSync
                                    ? 'New courses reach the store within a few minutes. Sync now to add them straight away.'
                                    : 'Run the sync again whenever you publish new courses, so the store can sell them.'}
                            </p>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
