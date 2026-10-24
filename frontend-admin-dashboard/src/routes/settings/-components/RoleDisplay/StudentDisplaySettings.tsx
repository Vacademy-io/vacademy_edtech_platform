import React, { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
    ArrowUp,
    ArrowDown,
    Check,
    CaretDown,
    CaretLeft,
    CaretRight,
    CircleNotch,
    FilePdf,
    SquaresFour,
    SignIn,
    GraduationCap,
    BellSimple,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { downloadTutorialGuidePdf } from '@/routes/settings/-utils/tutorial-guide';
import {
    SettingsPageShell,
    SettingsSectionsLayout,
    type SettingsSectionGroup,
} from '@/components/settings/shell';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    getLearnerTourOptions,
    LEARNER_TOUR_KEYS,
    type StudentDisplaySettingsData,
    type StudentCourseDetailsTabId,
    type StudentAllCoursesTabId,
    type StudentAllCoursesSettings,
    type StudentAllCoursesCustomTab,
    type StudentAllCoursesCustomTabType,
    type OutlineMode,
    type StudentDefaultProvider,
    type PasswordStrategy,
    type PasswordDelivery,
    type StudentAuthPresentation,
    type SlidesSidebarNavigation,
    type ContentCardImageFit,
    type EnrolledCourseLayout,
    type FeedbackTrigger,
    type StudentDashboardWidgetConfig,
    RETIRED_WIDGET_IDS,
    WIDGET_LABELS,
} from '@/types/student-display-settings';
import { Checkbox } from '@/components/ui/checkbox';
import { MultiSelect } from '@/components/design-system/multi-select';
import { cn } from '@/lib/utils';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useQuery } from '@tanstack/react-query';
import { getInstituteId } from '@/constants/helper';
import { getAllProductPages } from '@/routes/manage-pages/product-pages/-services/product-pages-service';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    fetchStudentDisplaySettingsForEdit,
    saveStudentDisplaySettings,
} from '@/services/student-display-settings';
import MaxActiveSessionsSetting from './MaxActiveSessionsSetting';
import { UsernameStrategyFields } from './UsernameStrategyFields';

/**
 * The widget rows this screen renders: retired ids filtered out (the learner
 * dashboard reads none of them, so their toggles did nothing), rest sorted by
 * order. Both the list and moveWidget go through here so the "move up/down"
 * indices always refer to the rows the admin can actually see.
 */
function widgetRows(widgets: StudentDashboardWidgetConfig[]): StudentDashboardWidgetConfig[] {
    return widgets
        .filter((w) => !RETIRED_WIDGET_IDS.has(w.id))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function getStudentDisplaySections(t: TFunction): SettingsSectionGroup[] {
    return [
        {
            sections: [
                { id: 'grp-layout', label: t('sections.layoutNav'), icon: SquaresFour },
                { id: 'grp-account', label: t('sections.loginAccount'), icon: SignIn },
                { id: 'grp-learning', label: t('sections.learningExperience'), icon: GraduationCap },
                {
                    id: 'grp-notifications',
                    label: t('sections.notificationsRedirect'),
                    icon: BellSimple,
                },
            ],
        },
    ];
}

export default function StudentDisplaySettings(): JSX.Element {
    const { t } = useTranslation('settingsStudentDisplay');
    const navigate = useNavigate();
    const STUDENT_DISPLAY_SECTIONS = getStudentDisplaySections(t);
    // Precomputed labels for the tab/sub-tab list renderers below: those loops
    // use `t` as the loop variable name for the tab item (matching the
    // surrounding helper functions), which shadows the translate function, so
    // the strings they need are resolved here instead of via inline t() calls.
    const tCommonLabel = t('common.label');
    const tCommonRoute = t('common.route');
    const tCommonVisible = t('common.visible');
    const tCommonRemove = t('common.remove');
    const tSidebarRemoveTab = t('sidebar.removeTab');
    const tSidebarSubTabs = t('sidebar.subTabs');
    const tSidebarAddSubTab = t('sidebar.addSubTab');
    const [settings, setSettings] = useState<StudentDisplaySettingsData | null>(null);
    const [saving, setSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [downloadingGuide, setDownloadingGuide] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);

    // Snapshot of the last loaded/saved state for the Discard button in the
    // sticky unsaved-changes bar.
    const pristineSettingsRef = useRef<StudentDisplaySettingsData | null>(null);

    useEffect(() => {
        // Always read the server copy here: this screen saves the whole blob
        // back, so editing a stale cached copy would silently revert anything
        // changed since (another admin, or a direct fix). On failure settings
        // stay null, so nothing can be saved over the real values.
        fetchStudentDisplaySettingsForEdit()
            .then((s) => {
                setSettings(s);
                pristineSettingsRef.current = s;
            })
            .catch(() => {
                setSettings(null);
                setLoadFailed(true);
            });
    }, []);

    const update = <K extends keyof StudentDisplaySettingsData>(
        key: K,
        value: StudentDisplaySettingsData[K]
    ) => {
        setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
        setHasChanges(true);
    };

    const { instituteDetails } = useInstituteDetailsStore();
    const courseTagOptions = Array.from(new Set(instituteDetails?.tags ?? [])).map((tag) => ({
        label: tag,
        value: tag,
    }));

    // Course picker: every course the institute has a batch of, once each.
    const courseOptions = Array.from(
        new Map(
            (instituteDetails?.batches_for_sessions ?? [])
                .filter((b) => b?.package_dto?.id)
                .map((b) => [
                    b.package_dto.id,
                    { label: b.package_dto.package_name || b.package_dto.id, value: b.package_dto.id },
                ])
        ).values()
    ).sort((a, b) => a.label.localeCompare(b.label));

    const needsProductPages = (settings?.allCourses.customTabs ?? []).some(
        (tab) => tab.type === 'PRODUCT_PAGES'
    );
    const productPagesQuery = useQuery({
        queryKey: ['student-display-custom-tab-product-pages', getInstituteId()],
        queryFn: () => getAllProductPages(getInstituteId() ?? ''),
        enabled: needsProductPages && !!getInstituteId(),
        staleTime: 5 * 60 * 1000,
    });
    const productPageOptions = (productPagesQuery.data ?? [])
        .filter((page) => page.status === 'ACTIVE')
        .map((page) => ({ label: page.name || page.code, value: page.code }));

    const CUSTOM_TAB_TYPES: StudentAllCoursesCustomTabType[] = [
        'LIVE_SESSIONS',
        'FREE_COURSES',
        'COURSES',
        'PRODUCT_PAGES',
        'TAG',
    ];

    /** Mirrors the learner app: a tab it would hide is flagged here. */
    const isCustomTabIncomplete = (tab: StudentAllCoursesCustomTab) => {
        if (!tab.label.trim()) return true;
        switch (tab.type ?? 'TAG') {
            case 'TAG':
                return tab.tags.length === 0;
            case 'COURSES':
                return (tab.courseIds ?? []).length === 0;
            case 'PRODUCT_PAGES':
                return (tab.productPages ?? []).length === 0;
            default:
                return false;
        }
    };

    // Built-in and custom Courses-page tabs share one `order` sequence, so
    // they are listed and reordered together even though they are stored apart.
    const sortedCourseTabs = (allCourses: StudentAllCoursesSettings) =>
        [
            ...allCourses.tabs.map((tab) => ({ ...tab, isCustom: false as const })),
            ...(allCourses.customTabs ?? []).map((tab) => ({ ...tab, isCustom: true as const })),
        ].sort((a, b) => (a.order || 0) - (b.order || 0));

    const moveCourseTab = (targetId: string, direction: 'up' | 'down') => {
        if (!settings) return;
        const all = settings.allCourses;
        const sorted = sortedCourseTabs(all);
        const idx = sorted.findIndex((tab) => tab.id === targetId);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return;
        // Renumber densely first: legacy blobs can carry duplicate orders.
        const orderById = new Map(sorted.map((tab, i) => [tab.id, i + 1]));
        orderById.set(sorted[idx]!.id, swapIdx + 1);
        orderById.set(sorted[swapIdx]!.id, idx + 1);
        update('allCourses', {
            ...all,
            tabs: all.tabs.map((tab) => ({ ...tab, order: orderById.get(tab.id) ?? tab.order })),
            customTabs: (all.customTabs ?? []).map((tab) => ({
                ...tab,
                order: orderById.get(tab.id) ?? tab.order,
            })),
        });
    };

    const updateCustomCourseTab = (
        id: string,
        patch: Partial<NonNullable<StudentAllCoursesSettings['customTabs']>[number]>
    ) => {
        if (!settings) return;
        update('allCourses', {
            ...settings.allCourses,
            customTabs: (settings.allCourses.customTabs ?? []).map((tab) =>
                tab.id === id ? { ...tab, ...patch } : tab
            ),
        });
    };

    const addCustomCourseTab = () => {
        if (!settings) return;
        const all = settings.allCourses;
        const maxOrder = sortedCourseTabs(all).reduce((m, tab) => Math.max(m, tab.order || 0), 0);
        update('allCourses', {
            ...all,
            customTabs: [
                ...(all.customTabs ?? []),
                {
                    id: `custom-${Date.now()}`,
                    label: '',
                    type: 'LIVE_SESSIONS',
                    tags: [],
                    courseIds: [],
                    productPages: [],
                    order: maxOrder + 1,
                    visible: true,
                },
            ],
        });
    };

    const removeCustomCourseTab = (id: string) => {
        if (!settings) return;
        update('allCourses', {
            ...settings.allCourses,
            customTabs: (settings.allCourses.customTabs ?? []).filter((tab) => tab.id !== id),
        });
    };

    const onSave = async () => {
        if (!settings) return;
        setSaving(true);
        try {
            await saveStudentDisplaySettings(settings);
            pristineSettingsRef.current = settings;
            setHasChanges(false);
        } finally {
            setSaving(false);
        }
    };

    const discardChanges = () => {
        if (!pristineSettingsRef.current) return;
        setSettings(pristineSettingsRef.current);
        setHasChanges(false);
    };

    // Helpers for custom tabs/sub-tabs and widgets
    const addCustomTab = () => {
        if (!settings) return;
        const nextOrder = (settings.sidebar.tabs?.length || 0) + 1;
        const newTab = {
            id: `custom-tab-${Date.now()}`,
            label: t('sidebar.defaultTabLabel'),
            route: '/',
            order: nextOrder,
            visible: true,
            isCustom: true,
            subTabs: [] as Array<{
                id: string;
                label?: string;
                route: string;
                order: number;
                visible: boolean;
            }>,
        };
        update('sidebar', { ...settings.sidebar, tabs: [...settings.sidebar.tabs, newTab] });
    };

    const removeTab = (tabId: string) => {
        if (!settings) return;
        const tab = settings.sidebar.tabs.find((t) => t.id === tabId);
        if (!tab?.isCustom) return; // Only allow removing custom tabs
        update('sidebar', {
            ...settings.sidebar,
            tabs: settings.sidebar.tabs.filter((t) => t.id !== tabId),
        });
    };

    const updateTabField = (
        tabId: string,
        field: 'label' | 'route' | 'order' | 'visible',
        value: string | number | boolean
    ) => {
        if (!settings) return;
        const tabs = settings.sidebar.tabs.map((t) =>
            t.id === tabId ? { ...t, [field]: value } : t
        );
        update('sidebar', { ...settings.sidebar, tabs });
    };

    const addSubTab = (tabId: string) => {
        if (!settings) return;
        const tabs = settings.sidebar.tabs.map((tb) => {
            if (tb.id !== tabId) return tb;
            const nextOrder = ((tb.subTabs?.length || 0) + 1) as number;
            const sub = {
                id: `custom-sub-${Date.now()}`,
                label: t('sidebar.defaultSubTabLabel'),
                route: '/',
                order: nextOrder,
                visible: true,
            };
            return { ...tb, subTabs: [...(tb.subTabs || []), sub] };
        });
        update('sidebar', { ...settings.sidebar, tabs });
    };

    const removeSubTab = (tabId: string, subId: string) => {
        if (!settings) return;
        const tabs = settings.sidebar.tabs.map((t) => {
            if (t.id !== tabId) return t;
            // Allow removal for custom subs we created (id starts with custom-sub-)
            const filtered = (t.subTabs || []).filter(
                (s) => s.id !== subId || !s.id.startsWith('custom-sub-')
            );
            return { ...t, subTabs: filtered };
        });
        update('sidebar', { ...settings.sidebar, tabs });
    };

    const addCustomWidget = () => {
        if (!settings) return;
        const nextOrder = (settings.dashboard.widgets?.length || 0) + 1;
        const custom = {
            id: 'custom' as const,
            title: t('widgets.defaultTitle'),
            subTitle: '',
            link: '/',
            order: nextOrder,
            visible: true,
            isCustom: true,
        };
        update('dashboard', { widgets: [...settings.dashboard.widgets, custom] });
    };

    const removeWidgetAt = (index: number) => {
        if (!settings) return;
        const list = [...settings.dashboard.widgets];
        const item = list[index];
        if (item?.id !== 'custom' && !item?.isCustom) return; // only custom widgets
        list.splice(index, 1);
        update('dashboard', { widgets: list });
    };

    // Move sidebar tab up/down
    const moveTab = (tabId: string, direction: 'up' | 'down') => {
        if (!settings) return;
        const sorted = [...settings.sidebar.tabs].sort((a, b) => (a.order || 0) - (b.order || 0));
        const idx = sorted.findIndex((t) => t.id === tabId);
        if (idx < 0) return;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= sorted.length) return;
        const current = sorted[idx]!;
        const swap = sorted[swapIdx]!;
        const tabs = settings.sidebar.tabs.map((t) => {
            if (t.id === current.id) return { ...t, order: swap.order };
            if (t.id === swap.id) return { ...t, order: current.order };
            return t;
        });
        update('sidebar', { ...settings.sidebar, tabs });
    };

    // Move sub-tab up/down
    const moveSubTab = (tabId: string, subId: string, direction: 'up' | 'down') => {
        if (!settings) return;
        const tabs = settings.sidebar.tabs.map((t) => {
            if (t.id !== tabId) return t;
            const sorted = [...(t.subTabs || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
            const idx = sorted.findIndex((s) => s.id === subId);
            if (idx < 0) return t;
            const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
            if (swapIdx < 0 || swapIdx >= sorted.length) return t;
            const current = sorted[idx]!;
            const swap = sorted[swapIdx]!;
            return {
                ...t,
                subTabs: (t.subTabs || []).map((s) => {
                    if (s.id === current.id) return { ...s, order: swap.order };
                    if (s.id === swap.id) return { ...s, order: current.order };
                    return s;
                }),
            };
        });
        update('sidebar', { ...settings.sidebar, tabs });
    };

    // Move widget up/down
    const moveWidget = (widgetIdx: number, direction: 'up' | 'down') => {
        if (!settings) return;
        // Same filtered+sorted list the UI renders, so the swap target is the
        // row directly above/below on screen — a hidden retired entry must not
        // silently absorb the move.
        const sorted = widgetRows(settings.dashboard.widgets);
        const swapIdx = direction === 'up' ? widgetIdx - 1 : widgetIdx + 1;
        if (swapIdx < 0 || swapIdx >= sorted.length) return;
        const current = sorted[widgetIdx]!;
        const swap = sorted[swapIdx]!;
        // Identity match: two custom widgets share id 'custom', so matching on
        // id+order could swap the wrong pair.
        const widgets = settings.dashboard.widgets.map((w) => {
            if (w === current) return { ...w, order: swap.order };
            if (w === swap) return { ...w, order: current.order };
            return w;
        });
        update('dashboard', { widgets });
    };

    // Generic swap for simple tab arrays
    const swapTabOrder = <T extends { id: string; order: number }>(
        items: T[],
        targetId: string,
        direction: 'up' | 'down'
    ): T[] => {
        const sorted = [...items].sort((a, b) => (a.order || 0) - (b.order || 0));
        const idx = sorted.findIndex((t) => t.id === targetId);
        if (idx < 0) return items;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= sorted.length) return items;
        const current = sorted[idx]!;
        const swap = sorted[swapIdx]!;
        return items.map((t) => {
            if (t.id === current.id) return { ...t, order: swap.order };
            if (t.id === swap.id) return { ...t, order: current.order };
            return t;
        });
    };

    if (!settings) {
        return (
            <div className={cn('p-4 text-sm', loadFailed && 'text-danger-600')}>
                {loadFailed ? t('loadError') : t('loading')}
            </div>
        );
    }

    return (
        <SettingsPageShell
            title={t('page.title')}
            description={t('page.description')}
            maxWidth="max-w-7xl"
        >
            {/* Save is handled by the sticky UnsavedChangesBar at the bottom of
                the viewport, so the redundant top + bottom buttons that used
                to live here have been removed. */}
            <SettingsSectionsLayout groups={STUDENT_DISPLAY_SECTIONS}>
            <section id="grp-layout" className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('sidebar.cardTitle')}</CardTitle>
                    <CardDescription>
                        {t('sidebar.cardDescription')}
                    </CardDescription>
                </CardHeader>
                <div className="space-y-3 p-4 pt-0">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.sidebar.visible}
                            onCheckedChange={(v) =>
                                update('sidebar', { ...settings.sidebar, visible: v })
                            }
                        />
                        <Label>{t('sidebar.visibleLabel')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            // Undefined means "not saved yet", which the learner app
                            // reads as on — so the switch must show on for it too.
                            checked={settings.sidebar.appLinks !== false}
                            onCheckedChange={(v) =>
                                update('sidebar', { ...settings.sidebar, appLinks: v })
                            }
                        />
                        <div>
                            <Label>{t('sidebar.appLinksLabel')}</Label>
                            <p className="text-caption text-neutral-500">
                                {t('sidebar.appLinksHelp')}
                            </p>
                        </div>
                    </div>
                    <div className="mb-3 flex items-center gap-2">
                        <Button type="button" onClick={addCustomTab} size="sm" variant="secondary">
                            {t('sidebar.addCustomTab')}
                        </Button>
                    </div>
                    <div className="space-y-2">
                        {(() => {
                            const sortedTabs = settings.sidebar.tabs
                                .slice()
                                .sort((a, b) => (a.order || 0) - (b.order || 0));
                            return sortedTabs.map((t, tabIdx) => (
                                <div key={t.id} className="space-y-2 rounded border p-2">
                                    <div className="flex items-center gap-2">
                                        <div className="flex flex-col items-center gap-0.5">
                                            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={tabIdx === 0} onClick={() => moveTab(t.id, 'up')}>
                                                <ArrowUp className="h-3 w-3" />
                                            </Button>
                                            <span className="text-xs text-muted-foreground">{tabIdx + 1}</span>
                                            <Button variant="ghost" size="icon" className="h-6 w-6" disabled={tabIdx === sortedTabs.length - 1} onClick={() => moveTab(t.id, 'down')}>
                                                <ArrowDown className="h-3 w-3" />
                                            </Button>
                                        </div>
                                        <div className="flex flex-1 flex-wrap items-center gap-2">
                                            <div className="grow text-xs font-medium">{t.id}</div>
                                            <Label className="text-xs">{tCommonLabel}</Label>
                                            <Input className="h-8 w-40" value={t.label || ''} onChange={(e) => updateTabField(t.id, 'label', e.target.value)} />
                                            <Label className="text-xs">{tCommonRoute}</Label>
                                            <Input className="h-8 w-56" value={t.route || ''} onChange={(e) => updateTabField(t.id, 'route', e.target.value)} />
                                            <Label className="text-xs">{tCommonVisible}</Label>
                                            <Switch checked={t.visible} onCheckedChange={(v) => updateTabField(t.id, 'visible', v)} />
                                            {t.isCustom && (
                                                <Button type="button" size="sm" variant="destructive" onClick={() => removeTab(t.id)}>
                                                    {tSidebarRemoveTab}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="ml-8 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <div className="text-2xs font-medium text-neutral-600">{tSidebarSubTabs}</div>
                                            <Button type="button" size="sm" variant="secondary" onClick={() => addSubTab(t.id)}>{tSidebarAddSubTab}</Button>
                                        </div>
                                        {(() => {
                                            const sortedSubs = (t.subTabs || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
                                            return sortedSubs.map((s, subIdx) => (
                                                <div key={s.id} className="flex items-center gap-2 rounded border p-2">
                                                    <div className="flex flex-col items-center gap-0.5">
                                                        <Button variant="ghost" size="icon" className="h-5 w-5" disabled={subIdx === 0} onClick={() => moveSubTab(t.id, s.id, 'up')}>
                                                            <ArrowUp className="h-3 w-3" />
                                                        </Button>
                                                        <span className="text-2xs text-muted-foreground">{subIdx + 1}</span>
                                                        <Button variant="ghost" size="icon" className="h-5 w-5" disabled={subIdx === sortedSubs.length - 1} onClick={() => moveSubTab(t.id, s.id, 'down')}>
                                                            <ArrowDown className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                    <div className="flex flex-1 flex-wrap items-center gap-2">
                                                        <div className="grow text-2xs font-medium">{s.id}</div>
                                                        <Label className="text-xs">{tCommonLabel}</Label>
                                                        <Input className="h-8 w-36" value={s.label || ''} onChange={(e) => {
                                                            const tabs = settings.sidebar.tabs.map((tab) => {
                                                                if (tab.id !== t.id) return tab;
                                                                const subTabs = (tab.subTabs || []).map((sub) => sub.id === s.id ? { ...sub, label: e.target.value } : sub);
                                                                return { ...tab, subTabs };
                                                            });
                                                            update('sidebar', { ...settings.sidebar, tabs });
                                                        }} />
                                                        <Label className="text-xs">{tCommonRoute}</Label>
                                                        <Input className="h-8 w-56" value={s.route} onChange={(e) => {
                                                            const tabs = settings.sidebar.tabs.map((tab) => {
                                                                if (tab.id !== t.id) return tab;
                                                                const subTabs = (tab.subTabs || []).map((sub) => sub.id === s.id ? { ...sub, route: e.target.value } : sub);
                                                                return { ...tab, subTabs };
                                                            });
                                                            update('sidebar', { ...settings.sidebar, tabs });
                                                        }} />
                                                        <Label className="text-xs">{tCommonVisible}</Label>
                                                        <Switch checked={s.visible} onCheckedChange={(v) => {
                                                            const tabs = settings.sidebar.tabs.map((tab) => {
                                                                if (tab.id !== t.id) return tab;
                                                                const subTabs = (tab.subTabs || []).map((sub) => sub.id === s.id ? { ...sub, visible: v } : sub);
                                                                return { ...tab, subTabs };
                                                            });
                                                            update('sidebar', { ...settings.sidebar, tabs });
                                                        }} />
                                                        {s.id.startsWith('custom-sub-') && (
                                                            <Button type="button" size="sm" variant="destructive" onClick={() => removeSubTab(t.id, s.id)}>{tCommonRemove}</Button>
                                                        )}
                                                    </div>
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('ui.cardTitle')}</CardTitle>
                    <CardDescription>{t('ui.cardDescription')}</CardDescription>
                </CardHeader>
                {/* The theme-skin picker moved to Settings > Appearance, which now
                    owns every "how the learner app looks" control (skin, corner
                    style, density, surface style) in one THEME_SETTING blob.
                    This card is kept as a signpost rather than deleted so admins
                    who know where it used to live can find it. The legacy
                    ui.type value is still READ by the learner app as a fallback
                    for institutes saved before the move — see resolveUiSkin. */}
                <div className="space-y-2 p-4 pt-0">
                    <p className="text-xs text-neutral-500">{t('ui.movedToAppearance')}</p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            navigate({
                                to: '/settings',
                                search: { selectedTab: 'appearance' },
                            })
                        }
                    >
                        {t('ui.openAppearance')}
                    </Button>
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('widgets.cardTitle')}</CardTitle>
                    <CardDescription>{t('widgets.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    <div className="mb-3 flex items-center gap-2">
                        <Button
                            type="button"
                            onClick={addCustomWidget}
                            size="sm"
                            variant="secondary"
                        >
                            {t('widgets.addCustom')}
                        </Button>
                    </div>
                    {(() => {
                        const sorted = widgetRows(settings.dashboard.widgets);
                        return sorted.map((w, idx) => {
                            // Find the original index in the unsorted array for updates
                            const origIdx = settings.dashboard.widgets.indexOf(w);
                            return (
                                <div
                                    key={`${w.id}-${w.title ?? ''}-${origIdx}`}
                                    className="flex items-center gap-2 rounded border p-2"
                                >
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0} onClick={() => moveWidget(idx, 'up')}>
                                            <ArrowUp className="h-3 w-3" />
                                        </Button>
                                        <span className="text-xs text-muted-foreground">{idx + 1}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === sorted.length - 1} onClick={() => moveWidget(idx, 'down')}>
                                            <ArrowDown className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="flex flex-1 flex-wrap items-center gap-2">
                                        <div className="grow text-xs font-medium">
                                            {WIDGET_LABELS[w.id] ?? w.id}
                                            {w.isCustom && w.title ? `: ${w.title}` : ''}
                                        </div>
                                        {w.id === 'custom' && (
                                            <>
                                                <Label className="text-xs">{t('common.title')}</Label>
                                                <Input className="h-8 w-40" value={w.title || ''} onChange={(e) => {
                                                    const widgets = settings.dashboard.widgets.map((x, i) => i === origIdx ? { ...x, title: e.target.value } : x);
                                                    update('dashboard', { widgets });
                                                }} />
                                                <Label className="text-xs">{t('widgets.subTitle')}</Label>
                                                <Input className="h-8 w-48" value={w.subTitle || ''} onChange={(e) => {
                                                    const widgets = settings.dashboard.widgets.map((x, i) => i === origIdx ? { ...x, subTitle: e.target.value } : x);
                                                    update('dashboard', { widgets });
                                                }} />
                                                <Label className="text-xs">{t('common.link')}</Label>
                                                <Input className="h-8 w-56" placeholder={t('widgets.linkPlaceholder')} value={w.link || ''} onChange={(e) => {
                                                    const widgets = settings.dashboard.widgets.map((x, i) => i === origIdx ? { ...x, link: e.target.value } : x);
                                                    update('dashboard', { widgets });
                                                }} />
                                            </>
                                        )}
                                        <Label className="text-xs">{t('common.visible')}</Label>
                                        <Switch
                                            checked={w.visible}
                                            onCheckedChange={(v) => {
                                                const widgets = settings.dashboard.widgets.map((x, i) => i === origIdx ? { ...x, visible: v } : x);
                                                update('dashboard', { widgets });
                                            }}
                                        />
                                        {(w.id === 'custom' || w.isCustom) && (
                                            <Button type="button" size="sm" variant="destructive" onClick={() => removeWidgetAt(origIdx)}>{t('common.remove')}</Button>
                                        )}
                                    </div>
                                </div>
                            );
                        });
                    })()}
                </div>
            </Card>
            </section>

            <section id="grp-account" className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('loginSignup.cardTitle')}</CardTitle>
                    <CardDescription>{t('loginSignup.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    <div className="flex items-center gap-2 pb-2 border-b">
                        <Switch
                            checked={settings.signup.enabled ?? true}
                            onCheckedChange={(v) =>
                                update('signup', { ...settings.signup, enabled: v })
                            }
                        />
                        <Label className="text-xs font-semibold">{t('loginSignup.signupEnabled')}</Label>
                        <span className="text-2xs text-muted-foreground">
                            {t('loginSignup.masterToggleHint')}
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        {(['google', 'github', 'usernamePassword', 'emailOtp'] as const).map(
                            (p) => (
                                <div key={p} className="flex items-center gap-2">
                                    <Switch
                                        checked={settings.signup.providers[p]}
                                        onCheckedChange={(v) =>
                                            update('signup', {
                                                ...settings.signup,
                                                providers: { ...settings.signup.providers, [p]: v },
                                            })
                                        }
                                    />
                                    <Label className="text-xs">{p}</Label>
                                </div>
                            )
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Label className="text-xs">{t('loginSignup.defaultProvider')}</Label>
                        <Select
                            value={settings.signup.providers.defaultProvider}
                            onValueChange={(v: string) =>
                                update('signup', {
                                    ...settings.signup,
                                    providers: {
                                        ...settings.signup.providers,
                                        defaultProvider: v as StudentDefaultProvider,
                                    },
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-40 text-xs">
                                <SelectValue placeholder={t('loginSignup.selectProvider')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="google">google</SelectItem>
                                <SelectItem value="github">github</SelectItem>
                                <SelectItem value="usernamePassword">usernamePassword</SelectItem>
                                <SelectItem value="emailOtp">emailOtp</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {/* Username / Password strategies */}
                    <UsernameStrategyFields
                        signup={settings.signup}
                        onChange={(signup) => update('signup', signup)}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                        <Label className="text-xs">{t('loginSignup.passwordStrategy')}</Label>
                        <Select
                            value={settings.signup.passwordStrategy}
                            onValueChange={(v) =>
                                update('signup', {
                                    ...settings.signup,
                                    passwordStrategy: v as PasswordStrategy,
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-48 text-xs">
                                <SelectValue placeholder={t('loginSignup.selectStrategy')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="manual">manual</SelectItem>
                                <SelectItem value="autoRandom">autoRandom</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Label className="text-xs">{t('loginSignup.passwordDelivery')}</Label>
                        <Select
                            value={settings.signup.passwordDelivery}
                            onValueChange={(v) =>
                                update('signup', {
                                    ...settings.signup,
                                    passwordDelivery: v as PasswordDelivery,
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-48 text-xs">
                                <SelectValue placeholder={t('loginSignup.selectDeliveryMethod')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="showOnScreen">showOnScreen</SelectItem>
                                <SelectItem value="sendEmail">sendEmail</SelectItem>
                                <SelectItem value="none">none</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <Label className="text-xs">{t('loginSignup.catalogueHeaderAuth')}</Label>
                        <Select
                            value={settings.signup.presentation ?? 'page'}
                            onValueChange={(v) =>
                                update('signup', {
                                    ...settings.signup,
                                    presentation: v as StudentAuthPresentation,
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-48 text-xs">
                                <SelectValue placeholder={t('loginSignup.selectPresentation')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="page">{t('loginSignup.presentationPage')}</SelectItem>
                                <SelectItem value="modal">{t('loginSignup.presentationModal')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </Card>

            <MaxActiveSessionsSetting />
            </section>

            <section id="grp-learning" className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('courseSettings.cardTitle')}</CardTitle>
                    <CardDescription>{t('courseSettings.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-3 p-4 pt-0">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.courseSettings.quiz.moveOnlyOnCorrectAnswer}
                            onCheckedChange={(v) =>
                                update('courseSettings', {
                                    ...settings.courseSettings,
                                    quiz: {
                                        ...settings.courseSettings.quiz,
                                        moveOnlyOnCorrectAnswer: v,
                                    },
                                })
                            }
                        />
                        <Label className="text-xs">{t('courseSettings.moveOnlyOnCorrect')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.courseSettings.quiz.celebrateOnQuizComplete}
                            onCheckedChange={(v) =>
                                update('courseSettings', {
                                    ...settings.courseSettings,
                                    quiz: {
                                        ...settings.courseSettings.quiz,
                                        celebrateOnQuizComplete: v,
                                    },
                                })
                            }
                        />
                        <Label className="text-xs">{t('courseSettings.celebrateOnComplete')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.courseSettings.quiz.showReportAndCorrectAnswers}
                            onCheckedChange={(v) =>
                                update('courseSettings', {
                                    ...settings.courseSettings,
                                    quiz: {
                                        ...settings.courseSettings.quiz,
                                        showReportAndCorrectAnswers: v,
                                    },
                                })
                            }
                        />
                        <Label className="text-xs">{t('courseSettings.showReportAndAnswers')}</Label>
                    </div>
                    <p className="pt-2 text-xs font-semibold text-neutral-600">
                        {t('courseSettings.assignmentHeading')}
                    </p>
                    {(['hideAttemptsAllowed', 'hideRepeatedTitle'] as const).map((key) => (
                        <div key={key} className="flex items-center gap-2">
                            <Switch
                                checked={settings.courseSettings.assignment[key]}
                                onCheckedChange={(v) =>
                                    update('courseSettings', {
                                        ...settings.courseSettings,
                                        assignment: {
                                            ...settings.courseSettings.assignment,
                                            [key]: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">{t(`courseSettings.${key}`)}</Label>
                        </div>
                    ))}
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('permissions.cardTitle')}</CardTitle>
                    <CardDescription>{t('permissions.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    {(
                        [
                            'canViewProfile',
                            'canEditProfile',
                            'canDeleteProfile',
                            'canViewFiles',
                            'canViewReports',
                        ] as const
                    ).map((k) => (
                        <div key={k} className="flex items-center gap-2">
                            <Switch
                                checked={settings.permissions[k]}
                                onCheckedChange={(v) =>
                                    update('permissions', { ...settings.permissions, [k]: v })
                                }
                            />
                            <Label className="text-xs">{k}</Label>
                        </div>
                    ))}
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('profilePage.cardTitle')}</CardTitle>
                    <CardDescription>{t('profilePage.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.profile.showMembershipStatus}
                            onCheckedChange={(v) =>
                                update('profile', {
                                    ...settings.profile,
                                    showMembershipStatus: v,
                                })
                            }
                        />
                        <Label className="text-xs">
                            {t('profilePage.showMembershipStatus')}
                        </Label>
                    </div>
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('courseDetails.cardTitle')}</CardTitle>
                    <CardDescription>{t('courseDetails.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-3 p-4 pt-0">
                    {/* Page layout for learners who already own the course. Sits
                        first because "Content structure only" overrides most of
                        what follows for those learners. */}
                    <EnrolledLayoutPicker
                        value={settings.courseDetails.enrolledLayout ?? 'full'}
                        onChange={(v) =>
                            update('courseDetails', {
                                ...settings.courseDetails,
                                enrolledLayout: v,
                            })
                        }
                    />

                    {/* Card artwork fit. Sits with the layout because it only
                        affects the Content Structure cards that layout shows. */}
                    <div className="space-y-1 pb-4 border-b">
                        <Label className="text-sm font-semibold">
                            {t('courseDetails.contentCardArtwork')}
                        </Label>
                        <p className="max-w-prose text-xs text-muted-foreground">
                            {t('courseDetails.contentCardArtworkHint')}
                        </p>
                        <Select
                            value={settings.courseDetails.contentCardImageFit ?? 'cover'}
                            onValueChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    contentCardImageFit: v as ContentCardImageFit,
                                })
                            }
                        >
                            <SelectTrigger className="mt-1 w-full max-w-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cover">
                                    {t('courseDetails.fitFill')}
                                </SelectItem>
                                <SelectItem value="contain">
                                    {t('courseDetails.fitContain')}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Tri-state in storage (unset = follow the page layout).
                        The switch shows the value in effect, so saving pins
                        whatever the admin can see. */}
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={
                                settings.courseDetails.chapterOpensFirstSlide ??
                                (settings.courseDetails.enrolledLayout ?? 'full') ===
                                    'contentOnly'
                            }
                            onCheckedChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    chapterOpensFirstSlide: v,
                                })
                            }
                        />
                        <Label className="text-xs">
                            {t('courseDetails.chapterOpensFirstSlide')}
                        </Label>
                    </div>

                    {/* Tabs visibility */}
                    <div className="space-y-2">
                        {(() => {
                            const sorted = settings.courseDetails.tabs.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
                            return sorted.map((t, idx) => (
                                <div key={t.id} className="flex items-center gap-2 rounded border p-2">
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0} onClick={() => update('courseDetails', { ...settings.courseDetails, tabs: swapTabOrder(settings.courseDetails.tabs, t.id, 'up') })}>
                                            <ArrowUp className="h-3 w-3" />
                                        </Button>
                                        <span className="text-xs text-muted-foreground">{idx + 1}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === sorted.length - 1} onClick={() => update('courseDetails', { ...settings.courseDetails, tabs: swapTabOrder(settings.courseDetails.tabs, t.id, 'down') })}>
                                            <ArrowDown className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="grow text-xs font-medium">{t.id}</div>
                                    <Label className="text-xs">{tCommonVisible}</Label>
                                    <Switch checked={t.visible} onCheckedChange={(v) => {
                                        const tabs = settings.courseDetails.tabs.map((x) => x.id === t.id ? { ...x, visible: v } : x);
                                        update('courseDetails', { ...settings.courseDetails, tabs });
                                    }} />
                                </div>
                            ));
                        })()}
                    </div>

                    {/* Default tab select */}
                    <div className="flex items-center gap-2">
                        <Label className="text-xs">{t('common.defaultTab')}</Label>
                        <Select
                            value={settings.courseDetails.defaultTab}
                            onValueChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    defaultTab: v as StudentCourseDetailsTabId,
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-48 text-xs">
                                <SelectValue placeholder={t('common.selectDefaultTab')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="OUTLINE">OUTLINE</SelectItem>
                                <SelectItem value="CONTENT_STRUCTURE">CONTENT_STRUCTURE</SelectItem>
                                <SelectItem value="TEACHERS">TEACHERS</SelectItem>
                                <SelectItem value="ASSESSMENTS">ASSESSMENTS</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Outline mode select */}
                    <div className="flex items-center gap-2">
                        <Label className="text-xs">{t('courseDetails.outlineMode')}</Label>
                        <Select
                            value={settings.courseDetails.outlineMode}
                            onValueChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    outlineMode: v as OutlineMode,
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-48 text-xs">
                                <SelectValue placeholder={t('courseDetails.selectMode')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="expanded">expanded</SelectItem>
                                <SelectItem value="collapsed">collapsed</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Ratings & Reviews */}
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.courseDetails.ratingsAndReviewsVisible}
                            onCheckedChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    ratingsAndReviewsVisible: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('courseDetails.ratingsReviewsVisible')}</Label>
                    </div>

                    {/* Hide author name on the course-details Course Overview panel */}
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.courseDetails.hideAuthorName ?? false}
                            onCheckedChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    hideAuthorName: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('courseDetails.hideAuthorName')}</Label>
                    </div>

                    {/* Off (default): the course page still shows the first author with
                        the profile the admin wrote (photo, subtitle, bio). On: the whole
                        roster. Learners never see email addresses either way. */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={settings.courseDetails.showInstructors ?? false}
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        showInstructors: v,
                                    })
                                }
                            />
                            <Label className="text-xs">{t('courseDetails.showTeachers')}</Label>
                        </div>
                        <p className="max-w-prose text-xs text-muted-foreground">
                            {t('courseDetails.showTeachersHint')}
                        </p>
                    </div>

                    {/* General visibility toggles */}
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.courseDetails.showCourseConfiguration}
                            onCheckedChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    showCourseConfiguration: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('courseDetails.showCourseConfiguration')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.courseDetails.hideTags ?? false}
                            onCheckedChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    hideTags: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('courseDetails.hideTags')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.courseDetails.showCourseContentPrefixes}
                            onCheckedChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    showCourseContentPrefixes: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('courseDetails.showCourseContentPrefixes')}</Label>
                    </div>

                    {/* Course Overview / Slides View */}
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={settings.courseDetails.courseOverview.visible}
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        courseOverview: {
                                            ...settings.courseDetails.courseOverview,
                                            visible: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">{t('courseDetails.courseOverviewVisible')}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={settings.courseDetails.courseOverview.showSlidesData}
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        courseOverview: {
                                            ...settings.courseDetails.courseOverview,
                                            showSlidesData: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">{t('courseDetails.showSlidesData')}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={settings.courseDetails.slidesView.showLearningPath}
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        slidesView: {
                                            ...settings.courseDetails.slidesView,
                                            showLearningPath: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">{t('courseDetails.showLearningPath')}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={settings.courseDetails.slidesView.feedbackVisible}
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        slidesView: {
                                            ...settings.courseDetails.slidesView,
                                            feedbackVisible: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">{t('courseDetails.feedbackVisible')}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={
                                    settings.courseDetails.slidesView.chapterCompleteCta ??
                                    settings.courseDetails.slidesView.sidebarNavigation ===
                                        'hidden'
                                }
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        slidesView: {
                                            ...settings.courseDetails.slidesView,
                                            chapterCompleteCta: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">
                                {t('courseDetails.chapterCompleteBar')}
                            </Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={
                                    settings.courseDetails.slidesView.feedbackInSlideNav ??
                                    settings.courseDetails.slidesView.sidebarNavigation !==
                                        'hidden'
                                }
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        slidesView: {
                                            ...settings.courseDetails.slidesView,
                                            feedbackInSlideNav: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">
                                {t('courseDetails.includeFeedbackInNav')}
                            </Label>
                        </div>
                        {/* Tri-state in storage (unset = follow the sidebar mode,
                            i.e. shown only in the sidebar-less viewer). The
                            switch renders the value actually in effect, so
                            saving pins whatever the admin can see. */}
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={
                                    settings.courseDetails.slidesView.manualCompletion ??
                                    settings.courseDetails.slidesView.sidebarNavigation ===
                                        'hidden'
                                }
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        slidesView: {
                                            ...settings.courseDetails.slidesView,
                                            manualCompletion: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">
                                {t('courseDetails.markCompleteButton')}
                            </Label>
                        </div>
                        {/* Tri-state in storage (unset = follow the sidebar mode),
                            but a switch can only show two. It renders the value
                            that is actually in effect, so saving simply pins
                            whatever the admin can see. */}
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={
                                    settings.courseDetails.slidesView.collapseSidebarOnOpen ??
                                    settings.courseDetails.slidesView.sidebarNavigation ===
                                        'hidden'
                                }
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        slidesView: {
                                            ...settings.courseDetails.slidesView,
                                            collapseSidebarOnOpen: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">
                                {t('courseDetails.collapseAppSidebar')}
                            </Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                checked={settings.courseDetails.slidesView.canAskDoubt}
                                onCheckedChange={(v) =>
                                    update('courseDetails', {
                                        ...settings.courseDetails,
                                        slidesView: {
                                            ...settings.courseDetails.slidesView,
                                            canAskDoubt: v,
                                        },
                                    })
                                }
                            />
                            <Label className="text-xs">{t('courseDetails.canAskDoubt')}</Label>
                        </div>
                    </div>

                    {/* When the feedback slide is offered. Asking after every
                        chapter suits a short course and fatigues a long one, so
                        the cadence is the institute's call. */}
                    <div className="flex items-center gap-2">
                        <Label className="text-xs">{t('courseDetails.askFeedbackAfter')}</Label>
                        <Select
                            value={settings.courseDetails.slidesView.feedbackTrigger ?? 'CHAPTER'}
                            onValueChange={(v) =>
                                update('courseDetails', {
                                    ...settings.courseDetails,
                                    slidesView: {
                                        ...settings.courseDetails.slidesView,
                                        feedbackTrigger: v as FeedbackTrigger,
                                    },
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-56 text-xs">
                                <SelectValue placeholder={t('courseDetails.selectWhen')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="CHAPTER">{t('courseDetails.everyChapter')}</SelectItem>
                                <SelectItem value="MODULE">{t('courseDetails.everyModule')}</SelectItem>
                                <SelectItem value="SUBJECT">{t('courseDetails.everySubject')}</SelectItem>
                                <SelectItem value="COURSE">{t('courseDetails.courseCompletionOnly')}</SelectItem>
                                <SelectItem value="NEVER">{t('courseDetails.neverButtonOnly')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* ── Sidebar content navigation picker ─────────────────
                        Two visual options for how the learner navigates inside
                        the slide viewer. The cards double as a live preview so
                        the admin can see at a glance what each mode looks like
                        without switching accounts to test. */}
                    <SidebarNavigationPicker
                        value={
                            settings.courseDetails.slidesView.sidebarNavigation ??
                            'breadcrumb'
                        }
                        onChange={(v) =>
                            update('courseDetails', {
                                ...settings.courseDetails,
                                slidesView: {
                                    ...settings.courseDetails.slidesView,
                                    sidebarNavigation: v,
                                },
                            })
                        }
                    />
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('allCourses.cardTitle')}</CardTitle>
                    <CardDescription>{t('allCourses.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-3 p-4 pt-0">
                    {/* Tabs visibility — built-in and custom, in one order */}
                    <div className="space-y-2">
                        {sortedCourseTabs(settings.allCourses).map((tab, idx, sorted) => (
                            <div key={tab.id} className="flex items-start gap-2 rounded border p-2">
                                <div className="flex flex-col items-center gap-0.5">
                                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0} onClick={() => moveCourseTab(tab.id, 'up')}>
                                        <ArrowUp className="h-3 w-3" />
                                    </Button>
                                    <span className="text-xs text-muted-foreground">{idx + 1}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === sorted.length - 1} onClick={() => moveCourseTab(tab.id, 'down')}>
                                        <ArrowDown className="h-3 w-3" />
                                    </Button>
                                </div>
                                {tab.isCustom ? (
                                    <div className="flex flex-1 flex-col gap-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Label className="text-xs">{tCommonLabel}</Label>
                                            <Input
                                                className="h-8 w-48"
                                                value={tab.label}
                                                placeholder={t('allCourses.customTabLabelPlaceholder')}
                                                onChange={(e) => updateCustomCourseTab(tab.id, { label: e.target.value })}
                                            />
                                            <div className="grow" />
                                            <Label className="text-xs">{tCommonVisible}</Label>
                                            <Switch checked={tab.visible} onCheckedChange={(v) => updateCustomCourseTab(tab.id, { visible: v })} />
                                            <Button type="button" size="sm" variant="destructive" onClick={() => removeCustomCourseTab(tab.id)}>
                                                {tCommonRemove}
                                            </Button>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Label className="text-xs">{t('allCourses.customTabType')}</Label>
                                            <Select
                                                value={tab.type ?? 'TAG'}
                                                onValueChange={(v) =>
                                                    updateCustomCourseTab(tab.id, { type: v as StudentAllCoursesCustomTabType })
                                                }
                                            >
                                                <SelectTrigger className="h-8 w-64 text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {CUSTOM_TAB_TYPES.map((type) => (
                                                        <SelectItem key={type} value={type}>
                                                            {t(`allCourses.customTabTypes.${type}`)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            {(tab.type ?? 'TAG') === 'TAG' && (
                                                <>
                                                    <Label className="text-xs">{t('allCourses.customTabTags')}</Label>
                                                    <MultiSelect
                                                        // Keep saved tags pickable even if no course carries them any more.
                                                        options={[
                                                            ...courseTagOptions,
                                                            ...tab.tags
                                                                .filter((tag) => !courseTagOptions.some((o) => o.value === tag))
                                                                .map((tag) => ({ label: tag, value: tag })),
                                                        ]}
                                                        selected={tab.tags}
                                                        onChange={(tags) => updateCustomCourseTab(tab.id, { tags })}
                                                        placeholder={t('allCourses.customTabTagsPlaceholder')}
                                                        className="max-w-md"
                                                    />
                                                </>
                                            )}
                                            {tab.type === 'COURSES' && (
                                                <>
                                                    <Label className="text-xs">{t('allCourses.customTabCourses')}</Label>
                                                    <MultiSelect
                                                        options={[
                                                            ...courseOptions,
                                                            ...(tab.courseIds ?? [])
                                                                .filter((id) => !courseOptions.some((o) => o.value === id))
                                                                .map((id) => ({ label: id, value: id })),
                                                        ]}
                                                        selected={tab.courseIds ?? []}
                                                        onChange={(courseIds) => updateCustomCourseTab(tab.id, { courseIds })}
                                                        placeholder={t('allCourses.customTabCoursesPlaceholder')}
                                                        className="max-w-md"
                                                    />
                                                </>
                                            )}
                                            {tab.type === 'PRODUCT_PAGES' && (
                                                <>
                                                    <Label className="text-xs">{t('allCourses.customTabProductPages')}</Label>
                                                    <MultiSelect
                                                        options={[
                                                            ...productPageOptions,
                                                            ...(tab.productPages ?? [])
                                                                .filter((p) => !productPageOptions.some((o) => o.value === p.code))
                                                                .map((p) => ({ label: p.name, value: p.code })),
                                                        ]}
                                                        selected={(tab.productPages ?? []).map((p) => p.code)}
                                                        onChange={(codes) =>
                                                            updateCustomCourseTab(tab.id, {
                                                                productPages: codes.map((code) => ({
                                                                    code,
                                                                    name:
                                                                        productPageOptions.find((o) => o.value === code)?.label ??
                                                                        (tab.productPages ?? []).find((p) => p.code === code)?.name ??
                                                                        code,
                                                                })),
                                                            })
                                                        }
                                                        placeholder={
                                                            productPagesQuery.isLoading
                                                                ? t('loading')
                                                                : t('allCourses.customTabProductPagesPlaceholder')
                                                        }
                                                        className="max-w-md"
                                                    />
                                                </>
                                            )}
                                            <p className="text-xs text-muted-foreground">
                                                {t(`allCourses.customTabTypeHints.${tab.type ?? 'TAG'}`)}
                                            </p>
                                            {isCustomTabIncomplete(tab) && (
                                                <p className="text-xs text-warning-600">{t('allCourses.customTabIncomplete')}</p>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-1 items-center gap-2 self-center">
                                        <div className="grow text-xs font-medium">{tab.id}</div>
                                        <Label className="text-xs">{tCommonVisible}</Label>
                                        <Switch checked={tab.visible} onCheckedChange={(v) => {
                                            const tabs = settings.allCourses.tabs.map((x) => x.id === tab.id ? { ...x, visible: v } : x);
                                            update('allCourses', { ...settings.allCourses, tabs });
                                        }} />
                                    </div>
                                )}
                            </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={addCustomCourseTab}>
                            {t('allCourses.addCustomTab')}
                        </Button>
                        {courseTagOptions.length === 0 &&
                            (settings.allCourses.customTabs ?? []).some((tab) => (tab.type ?? 'TAG') === 'TAG') && (
                            <p className="text-xs text-muted-foreground">{t('allCourses.customTabNoTags')}</p>
                        )}
                    </div>

                    {/* Default tab select */}
                    <div className="flex items-center gap-2">
                        <Label className="text-xs">{t('common.defaultTab')}</Label>
                        <Select
                            value={settings.allCourses.defaultTab}
                            onValueChange={(v) =>
                                update('allCourses', {
                                    ...settings.allCourses,
                                    defaultTab: v as StudentAllCoursesTabId,
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-48 text-xs">
                                <SelectValue placeholder={t('common.selectDefaultTab')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="InProgress">InProgress</SelectItem>
                                <SelectItem value="Completed">Completed</SelectItem>
                                <SelectItem value="AllCourses">AllCourses</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Hide instructor name on each course card in the list */}
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.allCourses.hideInstructorName ?? false}
                            onCheckedChange={(v) =>
                                update('allCourses', {
                                    ...settings.allCourses,
                                    hideInstructorName: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('allCourses.hideInstructorName')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label className="text-xs">{t('allCourses.pageSize')}</Label>
                        <Select
                            value={String(settings.allCourses.pageSize ?? 10)}
                            onValueChange={(v) =>
                                update('allCourses', {
                                    ...settings.allCourses,
                                    pageSize: Number(v),
                                })
                            }
                        >
                            <SelectTrigger className="h-8 w-24 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {[10, 20, 30, 50].map((n) => (
                                    <SelectItem key={n} value={String(n)}>
                                        {n}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.allCourses.showAllEnrolledOnDashboard ?? false}
                            onCheckedChange={(v) =>
                                update('allCourses', {
                                    ...settings.allCourses,
                                    showAllEnrolledOnDashboard: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('allCourses.showAllEnrolledOnDashboard')}</Label>
                    </div>
                </div>
            </Card>

            {/* The Certificates card lived here as a second copy of the enable
                flag and completion threshold, editable on a different page from
                the certificate template. The two could disagree, and only this
                copy was honoured by the learner app. Certificate Settings is now
                the single source of truth — enablement, threshold, template and
                numbering, plus per-course overrides. */}

            <Card>
                <CardHeader>
                    <CardTitle>{t('liveClasses.cardTitle')}</CardTitle>
                    <CardDescription>
                        {t('liveClasses.cardDescription')}
                    </CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.liveClasses.showPastSessions}
                            onCheckedChange={(v) =>
                                update('liveClasses', {
                                    ...settings.liveClasses,
                                    showPastSessions: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('liveClasses.showPastSessions')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.liveClasses.showRecordings}
                            disabled={!settings.liveClasses.showPastSessions}
                            onCheckedChange={(v) =>
                                update('liveClasses', {
                                    ...settings.liveClasses,
                                    showRecordings: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('liveClasses.showRecordings')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.liveClasses.showAttendance}
                            disabled={!settings.liveClasses.showPastSessions}
                            onCheckedChange={(v) =>
                                update('liveClasses', {
                                    ...settings.liveClasses,
                                    showAttendance: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('liveClasses.showAttendance')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.liveClasses.showActivityStats}
                            disabled={!settings.liveClasses.showPastSessions}
                            onCheckedChange={(v) =>
                                update('liveClasses', {
                                    ...settings.liveClasses,
                                    showActivityStats: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('liveClasses.showActivityStats')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.liveClasses.showClassMaterials}
                            disabled={!settings.liveClasses.showPastSessions}
                            onCheckedChange={(v) =>
                                update('liveClasses', {
                                    ...settings.liveClasses,
                                    showClassMaterials: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('liveClasses.showClassMaterials')}</Label>
                    </div>
                    {/* Independent of Past Sessions: also governs the live/upcoming list. */}
                    <div className="flex items-start gap-2 border-t pt-3">
                        <Switch
                            checked={settings.liveClasses.showUnassignedPublicSessions}
                            onCheckedChange={(v) =>
                                update('liveClasses', {
                                    ...settings.liveClasses,
                                    showUnassignedPublicSessions: v,
                                })
                            }
                        />
                        <div className="space-y-0.5">
                            <Label className="text-xs">
                                {t('liveClasses.showUnassignedPublicSessions')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('liveClasses.showUnassignedPublicSessionsHint')}
                            </p>
                        </div>
                    </div>
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('tutorials.cardTitle')}</CardTitle>
                    <CardDescription>
                        {t('tutorials.cardDescription', {
                            learnerPlural: getTerminologyPlural(
                                RoleTerms.Learner,
                                SystemTerms.Learner
                            ).toLowerCase(),
                        })}
                    </CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.tutorials.enabled}
                            onCheckedChange={(v) =>
                                update('tutorials', {
                                    ...settings.tutorials,
                                    enabled: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('tutorials.enableGuided')}</Label>
                    </div>
                    {settings.tutorials.enabled && (
                        <div className="space-y-2 border-t pt-3">
                            <div className="text-xs font-medium text-muted-foreground">
                                {t('tutorials.availableTours')}
                            </div>
                            {getLearnerTourOptions().map((tour) => (
                                <div key={tour.key} className="flex items-start gap-2">
                                    <Checkbox
                                        id={`tour-${tour.key}`}
                                        checked={settings.tutorials.enabledTours.includes(tour.key)}
                                        onCheckedChange={(checked) => {
                                            const next = new Set(settings.tutorials.enabledTours);
                                            if (checked) next.add(tour.key);
                                            else next.delete(tour.key);
                                            update('tutorials', {
                                                ...settings.tutorials,
                                                // Keep canonical registry order regardless of click order
                                                enabledTours: LEARNER_TOUR_KEYS.filter((k) =>
                                                    next.has(k)
                                                ),
                                            });
                                        }}
                                    />
                                    <div className="grid gap-0.5">
                                        <Label
                                            htmlFor={`tour-${tour.key}`}
                                            className="text-xs font-medium"
                                        >
                                            {tour.label}
                                        </Label>
                                        <p className="text-xs text-muted-foreground">
                                            {tour.description}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {settings.tutorials.enabled && (
                        <div className="space-y-3 border-t pt-3">
                            <div className="flex items-center gap-2">
                                <Switch
                                    checked={settings.tutorials.pdfGuideEnabled}
                                    onCheckedChange={(v) =>
                                        update('tutorials', {
                                            ...settings.tutorials,
                                            pdfGuideEnabled: v,
                                        })
                                    }
                                />
                                <div className="grid gap-0.5">
                                    <Label className="text-xs">{t('tutorials.pdfGuideLabel')}</Label>
                                    <p className="text-xs text-muted-foreground">
                                        {t('tutorials.pdfGuideHint', {
                                            learnerPlural: getTerminologyPlural(
                                                RoleTerms.Learner,
                                                SystemTerms.Learner
                                            ).toLowerCase(),
                                        })}
                                    </p>
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={
                                    downloadingGuide ||
                                    settings.tutorials.enabledTours.length === 0
                                }
                                onClick={async () => {
                                    setDownloadingGuide(true);
                                    try {
                                        await downloadTutorialGuidePdf(
                                            settings.tutorials.enabledTours
                                        );
                                    } catch (error) {
                                        console.error(
                                            'Error downloading tutorial guide PDF:',
                                            error
                                        );
                                        toast.error(t('tutorials.pdfGuideError'));
                                    } finally {
                                        setDownloadingGuide(false);
                                    }
                                }}
                                className="gap-2"
                            >
                                {downloadingGuide ? (
                                    <CircleNotch className="size-4 animate-spin" />
                                ) : (
                                    <FilePdf className="size-4" />
                                )}
                                {downloadingGuide
                                    ? t('tutorials.generating')
                                    : t('tutorials.downloadGuideButton')}
                            </Button>
                        </div>
                    )}
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('concentration.cardTitle')}</CardTitle>
                    <CardDescription>
                        {t('concentration.cardDescription', {
                            learnerPlural: getTerminologyPlural(
                                RoleTerms.Learner,
                                SystemTerms.Learner
                            ).toLowerCase(),
                        })}
                    </CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.concentration.enabled}
                            onCheckedChange={(v) =>
                                update('concentration', {
                                    ...settings.concentration,
                                    enabled: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('concentration.enableFocusCheck')}</Label>
                    </div>
                    {settings.concentration.enabled && (
                        <div className="flex flex-wrap items-end gap-4 border-t pt-3">
                            <div className="space-y-1">
                                <Label className="text-xs">
                                    {t('concentration.minMinutes')}
                                </Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={120}
                                    className="h-8 w-24"
                                    value={settings.concentration.frequency.min_minutes}
                                    onChange={(e) => {
                                        // The learner app picks a random gap in
                                        // [min, max]; an inverted range silently
                                        // reverses it, so drag max along instead.
                                        const min = Number(e.target.value) || 1;
                                        update('concentration', {
                                            ...settings.concentration,
                                            frequency: {
                                                min_minutes: min,
                                                max_minutes: Math.max(
                                                    min,
                                                    settings.concentration.frequency.max_minutes
                                                ),
                                            },
                                        });
                                    }}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">
                                    {t('concentration.maxMinutes')}
                                </Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={120}
                                    className="h-8 w-24"
                                    value={settings.concentration.frequency.max_minutes}
                                    onChange={(e) => {
                                        const max = Number(e.target.value) || 1;
                                        update('concentration', {
                                            ...settings.concentration,
                                            frequency: {
                                                min_minutes: Math.min(
                                                    max,
                                                    settings.concentration.frequency.min_minutes
                                                ),
                                                max_minutes: max,
                                            },
                                        });
                                    }}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t('concentration.frequencyHint')}
                            </p>
                        </div>
                    )}
                </div>
            </Card>
            </section>

            <section id="grp-notifications" className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('notifications.cardTitle')}</CardTitle>
                    <CardDescription>{t('notifications.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.notifications.allowSystemAlerts}
                            onCheckedChange={(v) =>
                                update('notifications', {
                                    ...settings.notifications,
                                    allowSystemAlerts: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('notifications.allowSystemAlerts')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.notifications.allowDashboardPins}
                            onCheckedChange={(v) =>
                                update('notifications', {
                                    ...settings.notifications,
                                    allowDashboardPins: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('notifications.allowDashboardPins')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.notifications.allowBatchStream}
                            onCheckedChange={(v) =>
                                update('notifications', {
                                    ...settings.notifications,
                                    allowBatchStream: v,
                                })
                            }
                        />
                        <Label className="text-xs">{t('notifications.allowBatchStream')}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            checked={settings.notifications.allowAppOverlays}
                            onCheckedChange={(v) =>
                                update('notifications', {
                                    ...settings.notifications,
                                    allowAppOverlays: v,
                                })
                            }
                        />
                        <div>
                            <Label className="text-xs">{t('notifications.allowAppOverlays')}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t('notifications.appOverlaysHint')}
                            </p>
                        </div>
                    </div>
                </div>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('postLoginRedirect.cardTitle')}</CardTitle>
                    <CardDescription>{t('postLoginRedirect.cardDescription')}</CardDescription>
                </CardHeader>
                <div className="space-y-2 p-4 pt-0">
                    <Input
                        className="h-8 w-80"
                        value={settings.postLoginRedirectRoute}
                        onChange={(e) => update('postLoginRedirectRoute', e.target.value)}
                    />
                </div>
            </Card>
            </section>
            </SettingsSectionsLayout>

            <UnsavedChangesBar
                dirty={hasChanges}
                saving={saving}
                onSave={onSave}
                onDiscard={discardChanges}
            />
        </SettingsPageShell>
    );
}

// ── Enrolled course-details layout picker ───────────────────────────────────
// What a learner sees on their own course page (the /study-library one they
// land on after enrolling). The catalogue and the shopper-facing course page
// are separate screens this never touches, so a buyer still gets the
// description and price they need to decide.
function EnrolledLayoutPicker({
    value,
    onChange,
}: {
    value: EnrolledCourseLayout;
    onChange: (v: EnrolledCourseLayout) => void;
}): JSX.Element {
    const { t } = useTranslation('settingsStudentDisplay');
    return (
        <div className="pb-4 border-b">
            <div className="text-sm font-semibold">{t('enrolledLayout.title')}</div>
            <p className="text-xs text-muted-foreground max-w-prose">
                {t('enrolledLayout.hint')}
            </p>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <NavOptionCard
                    selected={value === 'full'}
                    onSelect={() => onChange('full')}
                    title={t('enrolledLayout.fullTitle')}
                    badge={t('enrolledLayout.fullBadge')}
                    description={<>{t('enrolledLayout.fullDescription')}</>}
                    preview={<FullLayoutPreview />}
                />
                <NavOptionCard
                    selected={value === 'contentOnly'}
                    onSelect={() => onChange('contentOnly')}
                    title={t('enrolledLayout.contentOnlyTitle')}
                    badge={t('enrolledLayout.contentOnlyBadge')}
                    description={
                        <Trans i18nKey="settingsStudentDisplay:enrolledLayout.contentOnlyDescription">
                            Just the title and the <strong>Content Structure</strong> card. No
                            description, tags, banner, highlights or right-hand card. Opening
                            the card drills <strong>Subject → Module → Chapter</strong> as
                            large cards, then the slides open in the viewer. The tab, outline
                            and overview settings below stop applying to enrolled learners.
                        </Trans>
                    }
                    preview={<ContentOnlyLayoutPreview />}
                />
            </div>
        </div>
    );
}

// Mock of today's page: two columns, marketing copy left, stats card right.
function FullLayoutPreview(): JSX.Element {
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 overflow-hidden p-2">
            <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                    <div className="flex gap-1">
                        <span className="h-2 w-6 rounded-full bg-primary-200" />
                        <span className="h-2 w-8 rounded-full bg-primary-200" />
                    </div>
                    <div className="h-2.5 w-4/5 rounded bg-neutral-300" />
                    <div className="h-1.5 w-full rounded bg-neutral-200" />
                    <div className="h-1.5 w-3/4 rounded bg-neutral-200" />
                    <div className="mt-2 h-10 rounded border border-neutral-200 bg-white" />
                </div>
                <div className="space-y-1 rounded border border-neutral-200 bg-white p-1.5">
                    <div className="h-1.5 w-full rounded bg-neutral-200" />
                    <div className="h-1.5 w-2/3 rounded bg-neutral-200" />
                    <div className="h-1.5 w-3/4 rounded bg-neutral-200" />
                    <div className="h-1.5 w-1/2 rounded bg-neutral-200" />
                </div>
            </div>
        </div>
    );
}

// Mock of the focused page: title + a single card of large content tiles.
function ContentOnlyLayoutPreview(): JSX.Element {
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 overflow-hidden p-2">
            <div className="h-2.5 w-1/2 rounded bg-neutral-300" />
            <div className="mt-2 rounded border border-neutral-200 bg-white p-1.5">
                <div className="mb-1.5 h-1.5 w-1/3 rounded bg-neutral-300" />
                <div className="grid grid-cols-3 gap-1.5">
                    {[0, 1, 2].map((i) => (
                        <div
                            key={i}
                            className="space-y-1 rounded border border-neutral-200 p-1"
                        >
                            <div className="h-6 rounded bg-neutral-100" />
                            <div className="h-1.5 w-4/5 rounded bg-neutral-200" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Sidebar content navigation picker ───────────────────────────────────────
// Two mutually-exclusive modes for the slide viewer sidebar. Rendered as a
// pair of radio-style cards, each containing a tiny live mock of how the
// learner's sidebar will look. The mocks are pure markup (no data fetches)
// so the admin sees the outcome before saving.
function SidebarNavigationPicker({
    value,
    onChange,
}: {
    value: SlidesSidebarNavigation;
    onChange: (v: SlidesSidebarNavigation) => void;
}): JSX.Element {
    const { t } = useTranslation('settingsStudentDisplay');
    return (
        <div className="mt-4 border-t pt-4">
            <div className="mb-1 flex items-baseline justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t('sidebarNav.title')}</div>
                    <p className="max-w-prose text-xs text-muted-foreground">
                        {t('sidebarNav.hint')}
                    </p>
                </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <NavOptionCard
                    selected={value === 'breadcrumb'}
                    onSelect={() => onChange('breadcrumb')}
                    title={t('sidebarNav.breadcrumbTitle')}
                    badge={t('sidebarNav.breadcrumbBadge')}
                    description={
                        <Trans i18nKey="settingsStudentDisplay:sidebarNav.breadcrumbDescription">
                            Sidebar lists <strong>only the current chapter&apos;s slides</strong>.
                            To jump to another module or subject, the learner taps the breadcrumb
                            at the top and picks from a dropdown. Best when courses are small or
                            you want learners focused on the current chapter.
                        </Trans>
                    }
                    preview={<BreadcrumbModePreview />}
                />
                <NavOptionCard
                    selected={value === 'ancestors'}
                    onSelect={() => onChange('ancestors')}
                    title={t('sidebarNav.treeTitle')}
                    badge={t('sidebarNav.treeBadge')}
                    description={
                        <Trans i18nKey="settingsStudentDisplay:sidebarNav.treeDescription">
                            Sidebar shows the <strong>entire Subject → Module → Chapter → Slide tree</strong>.
                            Learners can scan, expand and jump to any slide without leaving the
                            viewer. The breadcrumb becomes a passive label. Best for longer
                            courses where side-by-side discovery matters.
                        </Trans>
                    }
                    preview={<TreeModePreview />}
                />
                <NavOptionCard
                    selected={value === 'lessons'}
                    onSelect={() => onChange('lessons')}
                    title={t('sidebarNav.lessonsTitle')}
                    badge={t('sidebarNav.lessonsBadge')}
                    description={
                        <Trans i18nKey="settingsStudentDisplay:sidebarNav.lessonsDescription">
                            The whole course as a <strong>flat list of lessons</strong>, each
                            with a thumbnail, a full two-line title and its length. Chapters
                            become headings rather than toggles, so nothing has to be expanded,
                            and a course-wide progress bar sits at the top. Best for courses
                            learners work through in order.
                        </Trans>
                    }
                    preview={<LessonListModePreview />}
                />
                <NavOptionCard
                    selected={value === 'hidden'}
                    onSelect={() => onChange('hidden')}
                    title={t('sidebarNav.hiddenTitle')}
                    badge={t('sidebarNav.hiddenBadge')}
                    description={
                        <Trans i18nKey="settingsStudentDisplay:sidebarNav.hiddenDescription">
                            The viewer shows <strong>only the slide</strong>. Learners move with
                            the <strong>Previous / Next</strong> buttons above the content, which
                            roll over into the next or previous chapter at the edges. Best when
                            you want a single, guided path with nothing to browse past.
                        </Trans>
                    }
                    preview={<NoSidebarModePreview />}
                />
            </div>
        </div>
    );
}
function NavOptionCard({
    selected,
    onSelect,
    title,
    badge,
    description,
    preview,
}: {
    selected: boolean;
    onSelect: () => void;
    title: string;
    badge?: string;
    description: React.ReactNode;
    preview: React.ReactNode;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={`relative text-left rounded-lg border-2 p-3 transition-all focus:outline-none focus:ring-2 focus:ring-primary-300 ${
                selected
                    ? 'border-primary-400 bg-primary-50/50 shadow-sm'
                    : 'border-neutral-200 bg-white hover:border-neutral-300'
            }`}
        >
            {selected && (
                <span className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-500 text-white shadow-sm">
                    <Check className="h-3 w-3" />
                </span>
            )}
            <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">{title}</div>
                {badge && (
                    <span className="text-2xs font-medium uppercase tracking-wider text-primary-600 bg-primary-100 rounded-full px-1.5 py-0.5">
                        {badge}
                    </span>
                )}
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {description}
            </p>
            <div className="mt-3">{preview}</div>
        </button>
    );
}

// Mock of the legacy view: breadcrumb with a dropdown arrow + a flat slide list.
function BreadcrumbModePreview(): JSX.Element {
    const { t } = useTranslation('settingsStudentDisplay');
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 overflow-hidden">
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-neutral-200 text-2xs text-neutral-600 bg-white">
                <span className="flex items-center gap-0.5 rounded px-1 py-0.5 bg-neutral-100">
                    S1 <CaretDown className="h-2.5 w-2.5" />
                </span>
                <CaretRight className="h-2.5 w-2.5 text-neutral-400" />
                <span className="flex items-center gap-0.5 rounded px-1 py-0.5 bg-neutral-100">
                    M1 <CaretDown className="h-2.5 w-2.5" />
                </span>
                <CaretRight className="h-2.5 w-2.5 text-neutral-400" />
                <span className="font-semibold text-neutral-800">C1</span>
            </div>
            <div className="p-2 space-y-1">
                <MockSlideRow label={t('preview.introVideo')} active />
                <MockSlideRow label={t('preview.readingNote')} />
                <MockSlideRow label={t('preview.practiceQuiz')} />
            </div>
        </div>
    );
}

// Mock of the sidebar-less view: just the slide, with Prev/Next above it.
function NoSidebarModePreview(): JSX.Element {
    const { t } = useTranslation('settingsStudentDisplay');
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 overflow-hidden">
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-neutral-200 bg-white">
                <span className="truncate text-2xs font-semibold text-neutral-800">
                    {t('preview.integerLine')}
                </span>
                <span className="ms-auto flex items-center gap-1">
                    <span className="flex items-center gap-0.5 rounded border border-neutral-200 px-1 py-0.5 text-2xs text-neutral-600">
                        <CaretLeft className="h-2 w-2" /> {t('preview.prev')}
                    </span>
                    <span className="text-2xs text-neutral-400">2 / 6</span>
                    <span className="flex items-center gap-0.5 rounded border border-neutral-200 px-1 py-0.5 text-2xs text-neutral-600">
                        {t('preview.next')} <CaretRight className="h-2 w-2" />
                    </span>
                </span>
            </div>
            <div className="space-y-1 p-2">
                <div className="h-8 rounded bg-neutral-200/70" />
                <div className="h-1.5 w-4/5 rounded bg-neutral-200" />
                <div className="h-1.5 w-3/5 rounded bg-neutral-200" />
            </div>
        </div>
    );
}

// Mock of the tree view: nested subjects/modules/chapters/slides with chevrons.
function TreeModePreview(): JSX.Element {
    const { t } = useTranslation('settingsStudentDisplay');
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 overflow-hidden">
            <div className="px-2 py-1.5 border-b border-neutral-200 text-2xs text-neutral-500 bg-white font-medium tracking-wide uppercase">
                {t('preview.courseContent')}
            </div>
            <div className="py-1">
                <MockTreeRow indent={0} chevron="down" label={t('preview.algebra')} bold />
                <MockTreeRow indent={1} chevron="down" label={t('preview.numbers')} />
                <MockTreeRow indent={2} chevron="right" label={t('preview.basics')} />
                <MockTreeRow indent={2} chevron="down" label={t('preview.integers')} activeAncestor />
                <MockSlideRow label={t('preview.integerLine')} depth={3} />
                <MockSlideRow label={t('preview.practiceSet')} depth={3} active />
                <MockTreeRow indent={1} chevron="right" label={t('preview.fractions')} muted />
                <MockTreeRow indent={0} chevron="right" label={t('preview.geometry')} muted />
            </div>
        </div>
    );
}

// Mock of the lesson list: a progress line, chapter headings and thumbnail rows.
function LessonListModePreview(): JSX.Element {
    const { t } = useTranslation('settingsStudentDisplay');
    return (
        <div className="overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
            <div className="border-b border-neutral-200 bg-white px-2 py-1.5">
                <div className="text-2xs font-medium text-neutral-600">{t('preview.completedCount')}</div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-neutral-200">
                    <div className="h-full w-1/6 rounded-full bg-primary-400" />
                </div>
            </div>
            <div className="py-1">
                <div className="px-2 pb-0.5 pt-1.5 text-2xs font-semibold text-neutral-800">
                    {t('preview.basics')}
                </div>
                <MockLessonRow label={t('preview.welcomeToCourse')} meta={t('preview.minutesShort', { count: 9 })} tone="bg-blue-100" done />
                <MockLessonRow label={t('preview.howNumbersBehave')} meta={t('preview.minutesShort', { count: 4 })} tone="bg-amber-100" />
                <div className="px-2 pb-0.5 pt-2 text-2xs font-semibold text-neutral-800">
                    {t('preview.integers')}
                </div>
                <MockLessonRow label={t('preview.theIntegerLine')} meta={t('preview.minutesShort', { count: 12 })} tone="bg-blue-100" active />
                <MockLessonRow label={t('preview.practiceSet')} meta={t('preview.questionsCount', { count: 6 })} tone="bg-teal-100" />
            </div>
        </div>
    );
}

function MockLessonRow({
    label,
    meta,
    tone,
    active,
    done,
}: {
    label: string;
    meta: string;
    tone: string;
    active?: boolean;
    done?: boolean;
}): JSX.Element {
    return (
        <div
            className={`flex items-center gap-1.5 border-s-2 px-2 py-1 ${
                active ? 'border-primary-500 bg-primary-50' : 'border-transparent'
            }`}
        >
            <span className={`h-4 w-6 shrink-0 rounded-sm ${done ? 'bg-success-200' : tone}`} />
            <span className="min-w-0 flex-1">
                <span
                    className={`block truncate text-2xs ${
                        active
                            ? 'font-semibold text-primary-700'
                            : done
                              ? 'text-neutral-400'
                              : 'text-neutral-700'
                    }`}
                >
                    {label}
                </span>
                <span className="block text-2xs text-neutral-400">{meta}</span>
            </span>
        </div>
    );
}
function MockSlideRow({
    label,
    active,
    depth = 0,
}: {
    label: string;
    active?: boolean;
    depth?: number;
}): JSX.Element {
    return (
        <div
            style={{ paddingLeft: `${depth * 10 + 8}px` }}
            className={`flex items-center gap-1.5 px-2 py-1 text-2xs rounded ${
                active
                    ? 'bg-primary-100 text-primary-700 font-semibold'
                    : 'text-neutral-600'
            }`}
        >
            <span
                className={`h-1.5 w-1.5 rounded-full ${
                    active ? 'bg-primary-500' : 'bg-neutral-300'
                }`}
            />
            <span className="truncate">{label}</span>
        </div>
    );
}

function MockTreeRow({
    indent,
    chevron,
    label,
    bold,
    muted,
    activeAncestor,
}: {
    indent: number;
    chevron: 'down' | 'right';
    label: string;
    bold?: boolean;
    muted?: boolean;
    activeAncestor?: boolean;
}): JSX.Element {
    const Icon = chevron === 'down' ? CaretDown : CaretRight;
    return (
        <div
            style={{ paddingLeft: `${indent * 10 + 4}px` }}
            className={`flex items-center gap-1 px-2 py-1 text-2xs ${
                muted
                    ? 'text-neutral-400'
                    : activeAncestor
                    ? 'text-primary-700 bg-primary-50/60 font-semibold'
                    : bold
                    ? 'text-neutral-800 font-semibold'
                    : 'text-neutral-700'
            }`}
        >
            <Icon className="h-2.5 w-2.5 flex-shrink-0" />
            <span className="truncate">{label}</span>
        </div>
    );
}
