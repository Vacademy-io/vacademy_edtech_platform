import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    ArrowCounterClockwise,
    CircleNotch,
    MagnifyingGlass,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import { StatusChip } from '@/components/design-system/status-chips';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { useEditorStore } from '../../-stores/editor-store';
import type { CatalogueConfig } from '../../-types/editor-types';
import { translateSiteStrings } from '../../-services/ai-page-service';
import { baseLocaleOf, localesOf, type TranslationDictionary } from '../../-utils/catalogue-i18n';
import { languageName } from '../../-hooks/use-localized-editing';
import {
    batchForTranslation,
    collectSiteStringEntries,
    collectSiteStrings,
    isKeptAsBase,
    keepAsBase,
    mergeAiTranslations,
    setTranslation,
    type CardTextKind,
    type SiteStringLocation,
} from './site-strings';
import {
    dedupeLiveTexts,
    fetchCourseTexts,
    fetchFolderTexts,
    fetchProductPageTexts,
    type LiveTextGroup,
} from './translation-sources';

type Tab = 'site' | 'live' | 'other';

interface Row {
    source: string;
    group?: LiveTextGroup;
    /** Where a page text is shown (page › section › field). */
    location?: SiteStringLocation;
}

/** A course grid's card text, named in the builder's language. */
const cardTextName = (kind: CardTextKind, t: TFunction): string =>
    ({
        formatLabel: t('location.card.formatLabel', { defaultValue: 'Format label' }),
        buttonLabel: t('location.card.buttonLabel', { defaultValue: 'Button label' }),
        freeLabel: t('location.card.freeLabel', { defaultValue: 'Free label' }),
        courseDescription: t('location.card.courseDescription', {
            defaultValue: 'Course description',
        }),
        loadMore: t('location.card.loadMore', { defaultValue: 'Load more button' }),
        courseCount: t('location.card.courseCount', { defaultValue: 'Course count' }),
        gridHeading: t('location.card.gridHeading', { defaultValue: 'Grid heading' }),
        sortLabel: t('location.card.sortLabel', { defaultValue: 'Sort label' }),
    })[kind];

/** 'Home › Course Catalog › Format label · video', in the builder's language. */
const locationLabel = (location: SiteStringLocation, t: TFunction): string => {
    const area = {
        header: t('location.header', { defaultValue: 'Header' }),
        footer: t('location.footer', { defaultValue: 'Footer' }),
        pageTitle: t('location.pageTitle', { defaultValue: 'Page title' }),
        seo: t('location.seo', { defaultValue: 'Search engines (SEO)' }),
        settings: t('location.settings', { defaultValue: 'Site settings' }),
        page: undefined,
    }[location.area];
    const field = location.cardText
        ? [cardTextName(location.cardText, t), location.field].filter(Boolean).join(' · ')
        : location.field;
    const parts =
        location.area === 'header' || location.area === 'footer' || location.area === 'settings'
            ? [area, field]
            : [location.page, area, location.section, field];
    return parts.filter(Boolean).join(' › ');
};

interface AiRun {
    running: boolean;
    done: number;
    total: number;
    translated: number;
    failed: Array<{ source: string; reason: string }>;
    unchanged: string[];
    tooLong: string[];
    error?: string;
    /** The site the run translated (see currentSite). */
    site: CatalogueConfig | null;
}

const PAGE_SIZE = 50;

/** A text cut to fit a confirm prompt. */
const shortText = (text: string): string => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

/**
 * Which site the editor store holds. The store is shared by every site, and
 * originalConfig is replaced only when a site is loaded (setConfig), never by
 * an edit — so an AI result that comes back after the admin opened another
 * site can be told apart from one that still belongs here.
 */
const currentSite = () => useEditorStore.getState().originalConfig;

/**
 * Writes one language's dictionary from the LATEST store state (an AI batch
 * may land while the admin edits). Given `site` — currentSite() when the AI
 * request went out — it writes nothing once the store holds another site.
 * Returns whether it wrote.
 */
const writeDictionary = (
    locale: string,
    update: (dict: TranslationDictionary | undefined) => TranslationDictionary,
    site?: CatalogueConfig | null
): boolean => {
    const state = useEditorStore.getState();
    const config = state.config;
    if (!config) return false;
    if (site !== undefined && state.originalConfig !== site) return false;
    const i18n = config.globalSettings.i18n || {};
    const strings = i18n.strings || {};
    state.updateGlobalSettings({
        i18n: { ...i18n, strings: { ...strings, [locale]: update(strings[locale]) } },
    });
    return true;
};

const errorDetail = (err: unknown): string => {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof detail === 'string'
        ? detail
        : 'The AI translation did not go through. Please try again.';
};

/**
 * Every text of the site for one language: the page texts (sections, page SEO,
 * header and footer) and the live data the site shows (course names and
 * descriptions, levels, folders, product pages). Edit inline, filter what is
 * missing, translate the missing ones with AI, or mark brand names as staying
 * the same as the base language.
 */
export const TranslationsPanel = ({
    open,
    onOpenChange,
    initialLocale,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialLocale: string;
}) => {
    const config = useEditorStore((s) => s.config);
    const instituteId = getCurrentInstituteId();
    const i18n = config?.globalSettings?.i18n;
    const base = baseLocaleOf(i18n);
    const baseName = languageName(base);
    const targets = localesOf(i18n).slice(1);
    const [locale, setLocale] = useState(
        targets.some((l) => l.code === initialLocale)
            ? initialLocale
            : targets[0]?.code || initialLocale
    );
    const [tab, setTab] = useState<Tab>('site');
    const [missingOnly, setMissingOnly] = useState(true);
    const [search, setSearch] = useState('');
    const [visible, setVisible] = useState(PAGE_SIZE);
    const [run, setRun] = useState<AiRun | null>(null);
    const cancelRef = useRef(false);
    // Leaving the editor (browser Back, another site) unmounts the dialog
    // without onOpenChange(false): stop a running batch loop then too, or it
    // keeps sending (and paying for) the remaining batches.
    useEffect(
        () => () => {
            cancelRef.current = true;
        },
        []
    );

    const { t } = useTranslation('managePagesTranslationsPanel');
    const dict = i18n?.strings?.[locale];
    const siteEntries = useMemo(() => collectSiteStringEntries(config), [config]);
    const siteStrings = useMemo(() => siteEntries.map((e) => e.text), [siteEntries]);
    // Texts of hidden sections, unpublished pages and switched-off settings:
    // their translations are parked, not unused.
    const parkedStrings = useMemo(
        () => collectSiteStrings(config, { includeHidden: true }),
        [config]
    );

    // "Other entries" needs the live texts too: it lists what neither tab has.
    const liveEnabled = open && tab !== 'site' && !!instituteId;
    const courses = useQuery({
        queryKey: ['siteTranslations', 'courses', instituteId],
        queryFn: () => fetchCourseTexts(instituteId!),
        enabled: liveEnabled,
        staleTime: 5 * 60 * 1000,
    });
    const folders = useQuery({
        queryKey: ['siteTranslations', 'folders', instituteId],
        queryFn: () => fetchFolderTexts(instituteId!),
        enabled: liveEnabled,
        staleTime: 5 * 60 * 1000,
    });
    const productPages = useQuery({
        queryKey: ['siteTranslations', 'productPages', instituteId],
        queryFn: () => fetchProductPageTexts(instituteId!),
        enabled: liveEnabled,
        staleTime: 5 * 60 * 1000,
    });

    const siteRows: Row[] = useMemo(
        () => siteEntries.map((e) => ({ source: e.text, location: e.location })),
        [siteEntries]
    );
    const liveRows: Row[] = useMemo(() => {
        const inSite = new Set(siteStrings);
        return dedupeLiveTexts([
            ...(courses.data || []),
            ...(folders.data || []),
            ...(productPages.data || []),
        ]).filter((t) => !inSite.has(t.source));
    }, [siteStrings, courses.data, folders.data, productPages.data]);
    const liveLoading = courses.isLoading || folders.isLoading || productPages.isLoading;
    const liveErrors = [courses, folders, productPages].filter((q) => q.isError);
    // Without every live text, a course's translation would look unused:
    // list no other entries until all of them have loaded.
    const otherUnknown = !instituteId || liveErrors.length > 0;
    // Dictionary entries no tab lists: text added by hand, or left behind
    // after its page text changed. Kept editable, and Clear deletes them.
    const otherRows: Row[] = useMemo(() => {
        if (otherUnknown) return [];
        const listed = new Set([...parkedStrings, ...liveRows.map((r) => r.source)]);
        return Object.keys(dict || {})
            .filter((source) => !listed.has(source))
            .map((source) => ({ source }));
    }, [dict, parkedStrings, liveRows, otherUnknown]);

    const rows = tab === 'site' ? siteRows : tab === 'live' ? liveRows : otherRows;
    const isMissing = (source: string) => !dict || !dict[source];
    const missingCount = rows.filter((r) => isMissing(r.source)).length;
    // Every other entry is in the dictionary already: nothing to filter by.
    const filterMissing = missingOnly && tab !== 'other';
    const query = search.trim().toLowerCase();
    const shown = rows.filter(
        (r) =>
            (!filterMissing || isMissing(r.source)) &&
            (!query ||
                r.source.toLowerCase().includes(query) ||
                (dict?.[r.source] || '').toLowerCase().includes(query))
    );

    const translateMissing = async () => {
        const missing = rows.filter((r) => isMissing(r.source)).map((r) => r.source);
        if (missing.length === 0 || run?.running) return;
        const { batches, tooLong } = batchForTranslation(missing);
        const target = locale;
        const site = currentSite();
        cancelRef.current = false;
        const progress: AiRun = {
            running: true,
            done: 0,
            total: missing.length - tooLong.length,
            translated: 0,
            failed: [],
            unchanged: [],
            tooLong,
            site,
        };
        setRun({ ...progress });
        for (const batch of batches) {
            // Stopped (button, dialog closed, panel gone), or another site was
            // opened meanwhile — these texts are not that site's texts.
            if (cancelRef.current || currentSite() !== site) break;
            try {
                const res = await translateSiteStrings({
                    strings: batch,
                    target_locale: target,
                    source_locale: base,
                });
                let unchanged: string[] = [];
                let added = 0;
                const written = writeDictionary(
                    target,
                    (d) => {
                        // Only fill what is still missing: a translation the admin
                        // typed while this batch was running wins.
                        const stillMissing = Object.fromEntries(
                            Object.entries(res.translations || {}).filter(
                                ([source]) => !d?.[source]
                            )
                        );
                        const merged = mergeAiTranslations(d, stillMissing);
                        unchanged = merged.unchanged;
                        added = Object.entries(stillMissing).filter(
                            ([source, value]) => value.trim() !== '' && value !== source
                        ).length;
                        return merged.dict;
                    },
                    site
                );
                if (!written) {
                    progress.error =
                        'Another site was opened, so the translation stopped and its last batch was not saved.';
                    break;
                }
                progress.translated += added;
                progress.unchanged.push(...unchanged);
                progress.failed.push(...(res.failed || []));
            } catch (err) {
                // Stop at the first failure (no credits, network): retrying blindly would burn credits.
                progress.error = errorDetail(err);
                break;
            } finally {
                progress.done += batch.length;
                setRun({
                    ...progress,
                    failed: [...progress.failed],
                    unchanged: [...progress.unchanged],
                });
            }
        }
        setRun({
            ...progress,
            running: false,
            failed: [...progress.failed],
            unchanged: [...progress.unchanged],
        });
    };

    const keepUnchanged = () => {
        if (!run?.unchanged.length) return;
        writeDictionary(locale, (d) => keepAsBase(d, run.unchanged), run.site);
        setRun({ ...run, unchanged: [] });
    };

    const footer = (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {run?.running ? (
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => (cancelRef.current = true)}
                >
                    Stop after this batch
                </MyButton>
            ) : null}
            <MyButton
                buttonType="primary"
                scale="medium"
                className="gap-1"
                disable={!!run?.running || missingCount === 0 || targets.length === 0}
                onClick={translateMissing}
            >
                {run?.running ? (
                    <CircleNotch className="size-4 animate-spin" />
                ) : (
                    <Sparkle className="size-4" />
                )}
                {run?.running
                    ? `Translating ${run.done} of ${run.total}…`
                    : `Translate ${missingCount} missing with AI`}
            </MyButton>
        </div>
    );

    return (
        <MyDialog
            heading="Translations"
            open={open}
            onOpenChange={(o) => {
                if (!o) cancelRef.current = true;
                onOpenChange(o);
            }}
            dialogWidth="max-w-4xl"
            footer={footer}
            footerLeft={
                <p className="text-caption text-gray-500">
                    AI translation uses credits (about one per batch of 40 texts). Texts the AI
                    cannot translate safely are left for you.
                </p>
            }
        >
            {targets.length === 0 ? (
                <p className="text-sm text-gray-500">
                    Add a language under Global Settings → Languages first.
                </p>
            ) : (
                <div className="space-y-4">
                    <div className="flex flex-wrap items-end gap-3">
                        {targets.length > 1 && (
                            <div className="space-y-1">
                                <Label className="text-xs">Language</Label>
                                <MyDropdown
                                    currentValue={languageName(locale)}
                                    dropdownList={targets.map((l) => ({
                                        label: languageName(l.code, l.label),
                                        value: l.code,
                                    }))}
                                    handleChange={(v) => {
                                        setLocale(v);
                                        setRun(null);
                                    }}
                                />
                            </div>
                        )}
                        <Tabs
                            value={tab}
                            onValueChange={(v) => {
                                setTab(v as Tab);
                                setVisible(PAGE_SIZE);
                                setRun(null);
                            }}
                        >
                            <TabsList>
                                <TabsTrigger value="site">Page texts</TabsTrigger>
                                <TabsTrigger value="live">Courses, folders &amp; pages</TabsTrigger>
                                <TabsTrigger value="other">
                                    {t('tabs.other', { defaultValue: 'Other entries' })}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        {tab !== 'other' && (
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="translations-missing-only"
                                    checked={missingOnly}
                                    onCheckedChange={setMissingOnly}
                                />
                                <Label htmlFor="translations-missing-only" className="text-sm">
                                    Missing only
                                </Label>
                            </div>
                        )}
                        <div className="relative min-w-48 flex-1">
                            <MagnifyingGlass className="pointer-events-none absolute start-2 top-2.5 size-4 text-gray-400" />
                            <Input
                                className="ps-8"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search texts"
                                aria-label="Search texts"
                            />
                        </div>
                    </div>

                    <p className="text-sm text-gray-600">
                        {languageName(locale)}: {rows.length - missingCount} of {rows.length}{' '}
                        translated
                        {missingCount > 0 ? ` · ${missingCount} missing` : ''}
                    </p>

                    {tab === 'other' && (
                        <p className="text-caption text-gray-500">
                            {t('other.hint', {
                                defaultValue:
                                    "Translations not found on the site's pages, settings, courses, folders or product pages — left behind after a text changed, or added by hand. Some may still be used somewhere else, so check before you Clear them.",
                            })}
                        </p>
                    )}

                    {run && !run.running && (
                        <RunSummary
                            run={run}
                            baseName={baseName}
                            onKeepUnchanged={keepUnchanged}
                            onDismiss={() => setRun(null)}
                        />
                    )}

                    {tab !== 'site' && liveLoading ? (
                        <p className="flex items-center gap-2 text-sm text-gray-500">
                            <CircleNotch className="size-4 animate-spin" /> Loading courses, folders
                            and product pages…
                        </p>
                    ) : (
                        <>
                            {tab !== 'site' && liveErrors.length > 0 && (
                                <div className="flex items-center justify-between gap-2 rounded-md border border-warning-200 bg-warning-50 p-2 text-sm text-warning-700">
                                    <span>Some live data could not be loaded.</span>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => liveErrors.forEach((q) => void q.refetch())}
                                    >
                                        Retry
                                    </MyButton>
                                </div>
                            )}
                            {tab === 'other' && otherUnknown ? (
                                <p className="rounded-md border border-dashed border-neutral-200 p-6 text-center text-sm text-gray-500">
                                    {t('other.waiting', {
                                        defaultValue:
                                            'Other entries are listed only after courses, folders and product pages have loaded, so a translation still in use never looks unused.',
                                    })}
                                </p>
                            ) : shown.length === 0 ? (
                                <p className="rounded-md border border-dashed border-neutral-200 p-6 text-center text-sm text-gray-500">
                                    {rows.length === 0
                                        ? tab === 'site'
                                            ? 'No page texts yet.'
                                            : tab === 'live'
                                              ? 'No courses, folders or product pages found.'
                                              : t('other.empty', {
                                                    defaultValue:
                                                        'Every translation belongs to a page text, course, folder or page.',
                                                })
                                        : filterMissing && !query
                                          ? 'Everything here is translated.'
                                          : 'No texts match.'}
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {shown.slice(0, visible).map((row) => (
                                        <TranslationRow
                                            key={`${locale}:${row.source}`}
                                            row={row}
                                            location={
                                                row.location
                                                    ? locationLabel(row.location, t)
                                                    : undefined
                                            }
                                            locale={locale}
                                            baseLocale={base}
                                            baseName={baseName}
                                            translation={dict?.[row.source] || ''}
                                            kept={isKeptAsBase(dict, row.source)}
                                            confirmClear={
                                                tab === 'other'
                                                    ? t('other.confirmClear', {
                                                          defaultValue:
                                                              'Delete this translation? “{{text}}” was not found on the site, but it may still be used somewhere the builder cannot see.',
                                                          text: shortText(row.source),
                                                      })
                                                    : undefined
                                            }
                                        />
                                    ))}
                                </ul>
                            )}
                            {shown.length > visible && (
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                                >
                                    Show more ({shown.length - visible} left)
                                </MyButton>
                            )}
                        </>
                    )}
                </div>
            )}
        </MyDialog>
    );
};

const RunSummary = ({
    run,
    baseName,
    onKeepUnchanged,
    onDismiss,
}: {
    run: AiRun;
    baseName: string;
    onKeepUnchanged: () => void;
    onDismiss: () => void;
}) => (
    <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
            <p className="text-gray-700">
                Translated {run.translated} text{run.translated === 1 ? '' : 's'}.
                {run.failed.length > 0 && ` ${run.failed.length} could not be translated safely.`}
            </p>
            <MyButton buttonType="text" scale="small" onClick={onDismiss}>
                Dismiss
            </MyButton>
        </div>
        {run.error && (
            <p className="flex items-center gap-1 text-danger-600">
                <WarningCircle className="size-4 shrink-0" /> {run.error}
            </p>
        )}
        {run.unchanged.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-gray-600">
                    The AI left {run.unchanged.length} text{run.unchanged.length === 1 ? '' : 's'}{' '}
                    unchanged (often names or brands).
                </p>
                <MyButton buttonType="secondary" scale="small" onClick={onKeepUnchanged}>
                    Keep them in {baseName}
                </MyButton>
            </div>
        )}
        {run.tooLong.length > 0 && (
            <p className="text-gray-600">
                {run.tooLong.length} very long text{run.tooLong.length === 1 ? ' was' : 's were'}{' '}
                skipped — translate
                {run.tooLong.length === 1 ? ' it' : ' them'} by hand.
            </p>
        )}
        {run.failed.length > 0 && (
            <details>
                <summary className="cursor-pointer text-gray-600">
                    Show the texts that failed
                </summary>
                <ul className="mt-1 space-y-1">
                    {run.failed.slice(0, 50).map((f) => (
                        <li key={f.source} className="text-caption text-gray-500">
                            <span className="line-clamp-1 font-medium text-gray-700">
                                {f.source}
                            </span>{' '}
                            {f.reason}
                        </li>
                    ))}
                </ul>
            </details>
        )}
    </div>
);

const TranslationRow = ({
    row,
    location,
    locale,
    baseLocale,
    baseName,
    translation,
    kept,
    confirmClear,
}: {
    row: Row;
    location?: string;
    locale: string;
    baseLocale: string;
    baseName: string;
    translation: string;
    kept: boolean;
    /** Asked before Clear deletes the entry (Other entries). */
    confirmClear?: string;
}) => {
    const [draft, setDraft] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [rowError, setRowError] = useState<string | null>(null);
    const value = draft ?? translation;
    const looksLikeHtml = /<[a-z][^>]*>/i.test(row.source);

    const commit = () => {
        if (draft === null) return;
        const next = draft;
        setDraft(null);
        if (next === translation) return;
        // Typing the base text itself means "keep it as is".
        writeDictionary(locale, (d) =>
            next === row.source ? keepAsBase(d, [row.source]) : setTranslation(d, row.source, next)
        );
    };

    const translateAgain = async () => {
        setBusy(true);
        setRowError(null);
        const site = currentSite();
        try {
            const res = await translateSiteStrings({
                strings: [row.source],
                target_locale: locale,
                source_locale: baseLocale,
                skip_memory: true,
            });
            const out = res.translations?.[row.source];
            if (typeof out === 'string' && out.trim()) {
                writeDictionary(
                    locale,
                    (d) =>
                        out === row.source
                            ? keepAsBase(d, [row.source])
                            : setTranslation(d, row.source, out),
                    site
                );
            } else {
                setRowError(
                    res.failed?.[0]?.reason || 'The AI could not translate this text safely.'
                );
            }
        } catch (err) {
            setRowError(errorDetail(err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="space-y-2 rounded-md border border-neutral-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                    {row.group && (
                        <span className="text-caption font-medium uppercase text-gray-400">
                            {row.group}
                        </span>
                    )}
                    <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm text-gray-800">
                        {row.source}
                    </p>
                    {location && (
                        <p className="line-clamp-1 break-all text-caption text-gray-400">
                            {location}
                        </p>
                    )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {kept ? (
                        <StatusChip
                            text={`Same as ${baseName}`}
                            textSize="text-caption"
                            status="INFO"
                            showIcon={false}
                        />
                    ) : translation ? (
                        <StatusChip
                            text="Translated"
                            textSize="text-caption"
                            status="SUCCESS"
                            showIcon={false}
                        />
                    ) : (
                        <StatusChip
                            text="Missing"
                            textSize="text-caption"
                            status="WARNING"
                            showIcon={false}
                        />
                    )}
                </div>
            </div>
            <Textarea
                rows={looksLikeHtml || row.source.length > 120 ? 4 : 2}
                value={value}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                placeholder={`${languageName(locale)} translation`}
                aria-label={`${languageName(locale)} translation`}
                className="text-sm"
            />
            {looksLikeHtml && (
                <p className="text-caption text-gray-400">
                    Keep the &lt;tags&gt; exactly as they are; translate only the words.
                </p>
            )}
            {rowError && <p className="text-caption text-danger-600">{rowError}</p>}
            <div className="flex flex-wrap items-center gap-1">
                {!kept && (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        onClick={() => writeDictionary(locale, (d) => keepAsBase(d, [row.source]))}
                        title="Names and brands that read the same in every language"
                    >
                        Same as {baseName}
                    </MyButton>
                )}
                {(translation || kept) && (
                    <MyButton
                        buttonType="text"
                        scale="small"
                        className="gap-1"
                        onClick={() => {
                            if (confirmClear && !window.confirm(confirmClear)) return;
                            writeDictionary(locale, (d) => setTranslation(d, row.source, ''));
                        }}
                    >
                        <ArrowCounterClockwise className="size-3" /> Clear
                    </MyButton>
                )}
                <MyButton
                    buttonType="text"
                    scale="small"
                    className="gap-1"
                    disable={busy}
                    onClick={translateAgain}
                >
                    {busy ? (
                        <CircleNotch className="size-3 animate-spin" />
                    ) : (
                        <Sparkle className="size-3" />
                    )}
                    {translation && !kept ? 'Translate again with AI' : 'Translate with AI'}
                </MyButton>
            </div>
        </li>
    );
};
