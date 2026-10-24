import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlanRowFilter, visibleSectionGroups } from './plan-rows';
import type { RoleDisplayPanelProps } from './panel-props';
import { applyRoleConstraints } from '@/lib/display-settings/role-constraints';
import { useTranslation } from 'react-i18next';
import { useNamingSettingsVersion } from '@/hooks/useNamingSettingsVersion';
import type { TFunction } from 'i18next';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getSidebarItemsData } from '@/components/common/layout-container/sidebar/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import type { DisplaySettingsData } from '@/types/display-settings';
import { TEACHER_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';
import { getDisplaySettingsWithFallback, saveDisplaySettings } from '@/services/display-settings';
import { StudentSideViewSettingsCard } from './StudentSideViewSettingsCard';
import { LearnerListColumnsCard } from './LearnerListColumnsCard';
import { ListCustomFieldControlsCard } from './ListCustomFieldControlsCard';
import { StudentManagementActionsCard } from './StudentManagementActionsCard';
import { AssessmentActionsCard } from './AssessmentActionsCard';
import { LiveClassActionsCard } from './LiveClassActionsCard';
import { LeadActionsCard } from './LeadActionsCard';
import { TeamRoleVisibilityCard } from './TeamRoleVisibilityCard';
import { getDefaultTeacherDisplaySettings } from '@/constants/display-settings/teacher-defaults';
import {
    DEFAULT_HIDDEN_COURSE_DETAILS_TABS,
    OFFLINE_GATED_COURSE_DETAILS_TABS,
} from '@/constants/display-settings/course-details-tabs';
import { useOfflineAccessEnabled } from '@/routes/settings/-hooks/use-offline-access-enabled';
import { toast } from 'sonner';
import {
    ArrowUp,
    ArrowDown,
    DotsSixVertical,
    BookOpen,
    SquaresFour,
    UsersThree,
    ShieldCheck,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import AudienceAccessCard from './AudienceAccessCard';
import CallNumberVisibilityCard from './CallNumberVisibilityCard';
import SubOrgModuleCard from './SubOrgModuleCard';
import {
    SettingsSectionsLayout,
    type SettingsSectionGroup,
} from '@/components/settings/shell';
import type {
    CourseListTabId,
    CourseDetailsTabId,
    CourseContentTypeSettings,
    CourseCreationSettings,
    StudentSideViewSettings,
    StudentSideViewVisibilityKey,
    StudentSideViewTabId,
    LearnerManagementSettings,
} from '@/types/display-settings';

import type { SidebarCategory } from '@/types/layout-container/layout-container-types';
function getTeacherDisplaySections(t: TFunction): SettingsSectionGroup[] {
    return [
        {
            sections: [
                {
                    id: 'grp-courses',
                    label: t('sections.coursesAndPermissions'),
                    icon: BookOpen,
                },
                { id: 'grp-layout', label: t('sections.layoutAndNavigation'), icon: SquaresFour },
                { id: 'grp-learners', label: t('sections.contentAndLearners'), icon: UsersThree },
                { id: 'grp-access', label: t('sections.dashboardAndAccess'), icon: ShieldCheck },
            ],
        },
    ];
}

const COURSE_CREATION_DEFAULTS: CourseCreationSettings = {
    // Teachers can create courses by default → the toggle reads ON unless turned off.
    showCreateCourse: true,
    showCreateCourseWithAI: false,
    requirePackageSelectionForNewChapter: true,
    showAdvancedSettings: true,
    limitToSingleLevel: false,
};

const STUDENT_SIDE_VIEW_DEFAULTS: StudentSideViewSettings = {
    overviewTab: true,
    testTab: true,
    progressTab: true,
    coursesTab: true,
    notificationTab: false,
    allowResendMessage: false,
    membershipTab: false,
    paymentHistoryTab: true,
    userTaggingTab: false,
    badgesTab: true,
    fileTab: false,
    portalAccessTab: false,
    reportsTab: false,
    enrollDerollTab: false,
    enquiryTab: false,
    applicationTab: false,
    leadTab: false,
    fullHistoryTab: false,
    workflowsTab: false,
    parentTab: false,
    onboardingTab: false,
};

function getStudentSideViewOptions(
    t: TFunction
): Array<{
    key: StudentSideViewVisibilityKey;
    label: string;
    defaultValue: boolean;
}> {
    return [
        {
            key: 'overviewTab',
            label: t('studentSideViewOptions.overviewTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.overviewTab,
        },
        {
            key: 'coursesTab',
            label: t('studentSideViewOptions.coursesTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.coursesTab,
        },
        {
            key: 'testTab',
            label: t('studentSideViewOptions.testTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.testTab,
        },
        {
            key: 'progressTab',
            label: t('studentSideViewOptions.progressTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.progressTab,
        },
        {
            key: 'notificationTab',
            label: t('studentSideViewOptions.notificationTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.notificationTab,
        },
        {
            key: 'membershipTab',
            label: t('studentSideViewOptions.membershipTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.membershipTab,
        },
        {
            key: 'paymentHistoryTab',
            label: t('studentSideViewOptions.paymentHistoryTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.paymentHistoryTab,
        },
        {
            key: 'userTaggingTab',
            label: t('studentSideViewOptions.userTaggingTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.userTaggingTab,
        },
        {
            key: 'badgesTab',
            label: t('studentSideViewOptions.badgesTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.badgesTab,
        },
        {
            key: 'fileTab',
            label: t('studentSideViewOptions.fileTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.fileTab,
        },
        {
            key: 'portalAccessTab',
            label: t('studentSideViewOptions.portalAccessTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.portalAccessTab,
        },
        {
            key: 'reportsTab',
            label: t('studentSideViewOptions.reportsTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.reportsTab,
        },
        {
            key: 'enrollDerollTab',
            label: t('studentSideViewOptions.enrollDerollTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.enrollDerollTab,
        },
        {
            key: 'enquiryTab',
            label: t('studentSideViewOptions.enquiryTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.enquiryTab,
        },
        {
            key: 'applicationTab',
            label: t('studentSideViewOptions.applicationTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.applicationTab,
        },
        {
            key: 'leadTab',
            label: t('studentSideViewOptions.leadTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.leadTab,
        },
        {
            key: 'fullHistoryTab',
            label: t('studentSideViewOptions.fullHistoryTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.fullHistoryTab ?? false,
        },
        {
            key: 'workflowsTab',
            label: t('studentSideViewOptions.workflowsTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.workflowsTab ?? false,
        },
        {
            key: 'parentTab',
            label: t('studentSideViewOptions.parentTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.parentTab ?? false,
        },
        {
            key: 'onboardingTab',
            label: t('studentSideViewOptions.onboardingTab'),
            defaultValue: STUDENT_SIDE_VIEW_DEFAULTS.onboardingTab ?? false,
        },
    ];
}

const LEARNER_MANAGEMENT_DEFAULTS: LearnerManagementSettings = {
    allowPortalAccess: true,
    allowViewPassword: true,
    allowSendResetPasswordMail: true,
    showApprovalToggle: false,
    allowEditCredentials: false,
    // Permanent delete of payments & invoices — OFF by default for every role.
    allowDeletePayments: false,
    // Admin discounts on enroll, bulk assign and invoices — opt-in for non-admin roles.
    canApplyDiscounts: false,
};

function getLearnerManagementOptions(
    t: TFunction
): Array<{
    key: keyof LearnerManagementSettings;
    label: string;
    defaultValue: boolean;
}> {
    return [
        {
            key: 'allowPortalAccess',
            label: t('learnerManagementOptions.allowPortalAccess'),
            defaultValue: LEARNER_MANAGEMENT_DEFAULTS.allowPortalAccess,
        },
        {
            key: 'allowViewPassword',
            label: t('learnerManagementOptions.allowViewPassword'),
            defaultValue: LEARNER_MANAGEMENT_DEFAULTS.allowViewPassword,
        },
        {
            key: 'allowEditCredentials',
            label: t('learnerManagementOptions.allowEditCredentials'),
            defaultValue: LEARNER_MANAGEMENT_DEFAULTS.allowEditCredentials ?? false,
        },
        {
            key: 'allowSendResetPasswordMail',
            label: t('learnerManagementOptions.allowSendResetPasswordMail'),
            defaultValue: LEARNER_MANAGEMENT_DEFAULTS.allowSendResetPasswordMail,
        },
        {
            key: 'showApprovalToggle',
            label: t('learnerManagementOptions.showApprovalToggle'),
            defaultValue: LEARNER_MANAGEMENT_DEFAULTS.showApprovalToggle,
        },
        {
            key: 'allowDeletePayments',
            label: t('learnerManagementOptions.allowDeletePayments'),
            defaultValue: LEARNER_MANAGEMENT_DEFAULTS.allowDeletePayments ?? false,
        },
        {
            key: 'canApplyDiscounts',
            label: t('learnerManagementOptions.canApplyDiscounts'),
            defaultValue: LEARNER_MANAGEMENT_DEFAULTS.canApplyDiscounts ?? false,
        },
    ];
}

export default function TeacherDisplaySettings({ onDirtyChange }: RoleDisplayPanelProps = {}) {
    const { t } = useTranslation('settingsTeacherDisplay');
    // Built-in tab names come from getSidebarItemsData(), which resolves them
    // through the i18next singleton and through the institute's naming settings.
    // Neither is available while modules are being evaluated, so this has to be
    // read during render — a value captured at module scope is simply blank, and
    // that is what left every Tab Name / Label box in this editor empty.
    //
    // `ready` flips when the sidebar catalog lands and `namingVersion` bumps on a
    // rename or a language switch; between them the memo can never hold on to
    // stale labels, and the lookup stays off the per-keystroke render path (it
    // re-reads localStorage once per built-in entry).
    const { ready: sidebarCatalogReady } = useTranslation('sidebar');
    const namingVersion = useNamingSettingsVersion();
    const sidebarItems = useMemo(
        () => getSidebarItemsData(),
        [sidebarCatalogReady, namingVersion]
    );
    const TEACHER_DISPLAY_SECTIONS = getTeacherDisplaySections(t);
    const STUDENT_SIDE_VIEW_OPTIONS = getStudentSideViewOptions(t);
    const LEARNER_MANAGEMENT_OPTIONS = getLearnerManagementOptions(t);
    const [settings, setSettings] = useState<DisplaySettingsData | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Surface unsaved state to the page header so "Copy to other roles" can block
    // on it — copying while dirty would send the last saved settings, not what the
    // admin is looking at.
    useEffect(() => {
        onDirtyChange?.(hasChanges);
    }, [hasChanges, onDirtyChange]);
    const [activeCategory, setActiveCategory] = useState<SidebarCategory>('CRM');

    // Master switch behind the Downloads course-details tab: off locks that row
    // to hidden here, matching what the course page renders.
    const offlineAccessEnabled = useOfflineAccessEnabled();

    // Snapshot of the last loaded/saved state for the Discard button in the
    // sticky unsaved-changes bar.
    const pristineSettingsRef = useRef<DisplaySettingsData | null>(null);

    useEffect(() => {
        const run = async () => {
            const s = await getDisplaySettingsWithFallback(TEACHER_DISPLAY_SETTINGS_KEY);
            // Enforce constraint: teacher should never be able to view settings tab
            s.sidebar = s.sidebar
                .filter((t) => t.id !== 'settings')
                .map((t) => ({ ...t, visible: t.id === 'settings' ? false : t.visible }));
            setSettings(s);
            pristineSettingsRef.current = s;
        };
        run();
    }, []);

    // Institute plan: rows outside it are not rendered (stored values untouched).
    const planRows = usePlanRowFilter();

    const updateSettings = (updater: (prev: DisplaySettingsData) => DisplaySettingsData) => {
        setSettings((prev) => {
            if (!prev) return prev;
            const next = updater(prev);
            setHasChanges(true);
            return next;
        });
    };

    const addCustomTab = () => {
        if (!settings) return;
        const maxOrder = Math.max(0, ...settings.sidebar.map((tab) => tab.order));
        const newTab = {
            id: `custom-${Date.now()}`,
            label: t('sidebarTabs.newCustomTabLabel'),
            route: '/',
            order: maxOrder + 1,
            visible: true,
            subTabs: [],
            isCustom: true,
            category: activeCategory,
        } as DisplaySettingsData['sidebar'][number];
        updateSettings((prev) => ({ ...prev, sidebar: [...prev.sidebar, newTab] }));
    };

    const addSubTab = (parentId: string) => {
        if (!settings) return;
        const newSubTabLabel = t('sidebarTabs.newCustomSubTabLabel');
        updateSettings((prev) => ({
            ...prev,
            sidebar: prev.sidebar.map((tab) => {
                if (tab.id !== parentId) return tab;
                const nextOrder = ((tab.subTabs?.length || 0) + 1) as number;
                const sub = {
                    id: `custom-sub-${Date.now()}`,
                    label: newSubTabLabel,
                    route: '/',
                    order: nextOrder,
                    visible: true,
                };
                return { ...tab, subTabs: [...(tab.subTabs || []), sub] };
            }),
        }));
    };

    const removeCustomTab = (tabId: string) => {
        if (!settings) return;
        const t = settings.sidebar.find((x) => x.id === tabId);
        if (!t?.isCustom) return;
        updateSettings((prev) => ({
            ...prev,
            sidebar: prev.sidebar.filter((x) => x.id !== tabId),
        }));
    };

    const removeCustomSubTab = (parentId: string, subId: string) => {
        if (!settings) return;
        updateSettings((prev) => ({
            ...prev,
            sidebar: prev.sidebar.map((t) => {
                if (t.id !== parentId) return t;
                const filtered = (t.subTabs || []).filter(
                    (s) => s.id !== subId || !s.id.startsWith('custom-sub-')
                );
                return { ...t, subTabs: filtered };
            }),
        }));
    };

    // Generic move helper: swaps order of two adjacent items in a sorted list
    const swapOrder = <T extends { order?: number }>(
        items: T[],
        getId: (item: T) => string,
        targetId: string,
        direction: 'up' | 'down',
        // Rows not rendered (outside the plan) are skipped so they keep their order.
        isMovable: (item: T) => boolean = () => true
    ): T[] => {
        const sorted = [...items].filter(isMovable).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const idx = sorted.findIndex((item) => getId(item) === targetId);
        if (idx < 0) return items;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= sorted.length) return items;
        const current = sorted[idx]!;
        const swap = sorted[swapIdx]!;
        return items.map((item) => {
            if (getId(item) === getId(current)) return { ...item, order: swap.order };
            if (getId(item) === getId(swap)) return { ...item, order: current.order };
            return item;
        });
    };

    const moveCourseListTab = (id: string, direction: 'up' | 'down') => {
        updateSettings((prev) => ({
            ...prev,
            courseList: {
                ...prev.courseList,
                tabs: swapOrder(prev.courseList?.tabs || [], (t) => t.id, id, direction),
                defaultTab: prev.courseList?.defaultTab || 'AllCourses',
            },
        }));
    };

    const moveCourseDetailsTab = (id: string, direction: 'up' | 'down') => {
        updateSettings((prev) => ({
            ...prev,
            courseDetails: {
                ...prev.courseDetails,
                tabs: swapOrder(prev.courseDetails?.tabs || [], (t) => t.id, id, direction),
                defaultTab: prev.courseDetails?.defaultTab || 'OUTLINE',
            },
        }));
    };

    const moveSidebarCategory = (id: string, direction: 'up' | 'down') => {
        updateSettings((prev) => {
            const currentCats = prev.sidebarCategories || [
                { id: 'CRM' as const, visible: true, default: true, order: 0 },
                { id: 'LMS' as const, visible: true, default: false, order: 1 },
                { id: 'AI' as const, visible: true, default: false, order: 2 },
            ];
            return {
                ...prev,
                sidebarCategories: swapOrder(currentCats, (c) => c.id, id, direction, (c) =>
                    planRows.category(c.id, prev.sidebar)
                ),
            };
        });
    };

    const moveWidget = (id: string, direction: 'up' | 'down') => {
        updateSettings((prev) => ({
            ...prev,
            dashboard: {
                widgets: swapOrder(prev.dashboard.widgets, (w) => w.id, id, direction, (w) =>
                    planRows.widget(w.id)
                ),
            },
        }));
    };

    const moveTab = (tabId: string, direction: 'up' | 'down') => {
        updateSettings((prev) => {
            const categoryTabs = prev.sidebar
                .filter((t) => {
                    const baseItem = sidebarItems.find((i) => i.id === t.id);
                    const cat = baseItem?.category || t.category || 'CRM';
                    return cat === activeCategory && planRows.tab(t.id);
                })
                .sort((a, b) => a.order - b.order);

            const idx = categoryTabs.findIndex((t) => t.id === tabId);
            if (idx < 0) return prev;
            const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
            if (swapIdx < 0 || swapIdx >= categoryTabs.length) return prev;

            const currentTab = categoryTabs[idx]!;
            const swapTab = categoryTabs[swapIdx]!;

            return {
                ...prev,
                sidebar: prev.sidebar.map((t) => {
                    if (t.id === currentTab.id) return { ...t, order: swapTab.order };
                    if (t.id === swapTab.id) return { ...t, order: currentTab.order };
                    return t;
                }),
            };
        });
    };

    const moveSubTab = (parentId: string, subId: string, direction: 'up' | 'down') => {
        updateSettings((prev) => ({
            ...prev,
            sidebar: prev.sidebar.map((t) => {
                if (t.id !== parentId) return t;
                const sorted = [...(t.subTabs || [])]
                    .filter((s) => planRows.subTab(t.id, s.id))
                    .sort((a, b) => a.order - b.order);
                const idx = sorted.findIndex((s) => s.id === subId);
                if (idx < 0) return t;
                const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
                if (swapIdx < 0 || swapIdx >= sorted.length) return t;

                const currentSub = sorted[idx]!;
                const swapSub = sorted[swapIdx]!;

                return {
                    ...t,
                    subTabs: (t.subTabs || []).map((s) => {
                        if (s.id === currentSub.id) return { ...s, order: swapSub.order };
                        if (s.id === swapSub.id) return { ...s, order: currentSub.order };
                        return s;
                    }),
                };
            }),
        }));
    };

    const save = async () => {
        if (!settings) return;
        setIsSaving(true);
        try {
            // Shared with the "copy to other roles" action, so a rule added here
            // applies however these settings are written.
            const fixed: DisplaySettingsData = applyRoleConstraints(settings, 'teacher');
            await saveDisplaySettings(TEACHER_DISPLAY_SETTINGS_KEY, fixed);
            // Reflect the persisted (constrained) version locally so future
            // discards return to the same baseline.
            setSettings(fixed);
            pristineSettingsRef.current = fixed;
            setHasChanges(false);
            toast.success(t('toast.saveSuccess'));
        } catch (e) {
            toast.error(t('toast.saveFailed'));
        } finally {
            setIsSaving(false);
        }
    };

    const discardChanges = () => {
        if (!pristineSettingsRef.current) return;
        setSettings(pristineSettingsRef.current);
        setHasChanges(false);
    };

    if (!settings) return <div className="p-2">{t('loading')}</div>;

    return (
        <>
            <SettingsSectionsLayout
                groups={visibleSectionGroups(TEACHER_DISPLAY_SECTIONS, planRows)}
                toolbar={
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setSettings(getDefaultTeacherDisplaySettings())}
                    >
                        {t('resetToDefaults')}
                    </MyButton>
                }
            >
            <section id="grp-courses" className="space-y-6">
            {/* LMS course cards: hidden with lms.courses off (plan-rows.ts). */}
            {planRows.card('courseCards') && (
            <>
            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.coursePage.title')}</CardTitle>
                    <CardDescription>{t('cards.coursePage.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(
                        [
                            ['viewInviteLinks', t('cards.coursePage.options.viewInviteLinks')],
                            [
                                'viewShortInviteLinks',
                                t('cards.coursePage.options.viewShortInviteLinks'),
                            ],
                            [
                                'viewCourseConfiguration',
                                t('cards.coursePage.options.viewCourseConfiguration'),
                            ],
                            [
                                'viewCourseOverviewItem',
                                t('cards.coursePage.options.viewCourseOverviewItem'),
                            ],
                            [
                                'viewContentNumbering',
                                t('cards.coursePage.options.viewContentNumbering'),
                            ],
                            [
                                'allowViewSlidesInReadOnly',
                                t('cards.coursePage.options.allowViewSlidesInReadOnly'),
                            ],
                            ['showAddSubject', t('cards.coursePage.options.showAddSubject')],
                            ['showAddModule', t('cards.coursePage.options.showAddModule')],
                            ['showAddChapter', t('cards.coursePage.options.showAddChapter')],
                            ['showAddSlide', t('cards.coursePage.options.showAddSlide')],
                            [
                                'showLearnerProgressReport',
                                t('cards.coursePage.options.showLearnerProgressReport'),
                            ],
                        ] as const
                    ).map(([key, label]) => (
                        <div
                            key={key}
                            className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
                        >
                            <div className="text-sm font-medium text-neutral-800">{label}</div>
                            <Switch
                                checked={settings.coursePage?.[key] !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        coursePage: {
                                            ...prev.coursePage,
                                            viewInviteLinks:
                                                prev.coursePage?.viewInviteLinks ?? true,
                                            viewShortInviteLinks:
                                                prev.coursePage?.viewShortInviteLinks ?? false,
                                            viewCourseConfiguration:
                                                prev.coursePage?.viewCourseConfiguration ?? true,
                                            viewCourseOverviewItem:
                                                prev.coursePage?.viewCourseOverviewItem ?? true,
                                            viewContentNumbering:
                                                prev.coursePage?.viewContentNumbering ?? true,
                                            allowViewSlidesInReadOnly:
                                                prev.coursePage?.allowViewSlidesInReadOnly ?? true,
                                            directEditPublishedCourse:
                                                prev.coursePage?.directEditPublishedCourse ?? false,
                                            canEditCourseStructure:
                                                prev.coursePage?.canEditCourseStructure ?? false,
                                            canDeleteCourseStructure:
                                                prev.coursePage?.canDeleteCourseStructure ?? false,
                                            showAdvancedCourseIds:
                                                prev.coursePage?.showAdvancedCourseIds ?? false,
                                            showBulkUpload:
                                                prev.coursePage?.showBulkUpload ?? false,
                                            showAddSubject:
                                                prev.coursePage?.showAddSubject ?? true,
                                            showAddModule:
                                                prev.coursePage?.showAddModule ?? true,
                                            showAddChapter:
                                                prev.coursePage?.showAddChapter ?? true,
                                            showAddSlide:
                                                prev.coursePage?.showAddSlide ?? true,
                                            [key]: checked,
                                        },
                                    }))
                                }
                            />
                        </div>
                    ))}
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">
                            {t('cards.coursePage.showAdvancedCourseIds')}
                        </div>
                        <Switch
                            checked={settings.coursePage?.showAdvancedCourseIds === true}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    coursePage: {
                                        ...prev.coursePage,
                                        viewInviteLinks: prev.coursePage?.viewInviteLinks ?? true,
                                        viewShortInviteLinks:
                                            prev.coursePage?.viewShortInviteLinks ?? false,
                                        viewCourseConfiguration:
                                            prev.coursePage?.viewCourseConfiguration ?? true,
                                        viewCourseOverviewItem:
                                            prev.coursePage?.viewCourseOverviewItem ?? true,
                                        viewContentNumbering:
                                            prev.coursePage?.viewContentNumbering ?? true,
                                        allowViewSlidesInReadOnly:
                                            prev.coursePage?.allowViewSlidesInReadOnly ?? true,
                                        directEditPublishedCourse:
                                            prev.coursePage?.directEditPublishedCourse ?? false,
                                        canEditCourseStructure:
                                            prev.coursePage?.canEditCourseStructure ?? false,
                                        canDeleteCourseStructure:
                                            prev.coursePage?.canDeleteCourseStructure ?? false,
                                        showBulkUpload:
                                            prev.coursePage?.showBulkUpload ?? false,
                                        showAddSubject: prev.coursePage?.showAddSubject ?? true,
                                        showAddModule: prev.coursePage?.showAddModule ?? true,
                                        showAddChapter: prev.coursePage?.showAddChapter ?? true,
                                        showAddSlide: prev.coursePage?.showAddSlide ?? true,
                                        showAdvancedCourseIds: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.coursePermission.title')}</CardTitle>
                    <CardDescription>{t('cards.coursePermission.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">
                            {t('cards.coursePermission.directEdit')}
                        </div>
                        <Switch
                            checked={settings.coursePage?.directEditPublishedCourse === true}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    coursePage: {
                                        ...prev.coursePage,
                                        viewInviteLinks: prev.coursePage?.viewInviteLinks ?? true,
                                        viewShortInviteLinks:
                                            prev.coursePage?.viewShortInviteLinks ?? false,
                                        viewCourseConfiguration:
                                            prev.coursePage?.viewCourseConfiguration ?? true,
                                        viewCourseOverviewItem:
                                            prev.coursePage?.viewCourseOverviewItem ?? true,
                                        viewContentNumbering:
                                            prev.coursePage?.viewContentNumbering ?? true,
                                        allowViewSlidesInReadOnly:
                                            prev.coursePage?.allowViewSlidesInReadOnly ?? true,
                                        canEditCourseStructure:
                                            prev.coursePage?.canEditCourseStructure ?? false,
                                        canDeleteCourseStructure:
                                            prev.coursePage?.canDeleteCourseStructure ?? false,
                                        showAdvancedCourseIds:
                                            prev.coursePage?.showAdvancedCourseIds ?? false,
                                        showBulkUpload:
                                            prev.coursePage?.showBulkUpload ?? false,
                                        showAddSubject: prev.coursePage?.showAddSubject ?? true,
                                        showAddModule: prev.coursePage?.showAddModule ?? true,
                                        showAddChapter: prev.coursePage?.showAddChapter ?? true,
                                        showAddSlide: prev.coursePage?.showAddSlide ?? true,
                                        directEditPublishedCourse: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">
                            {t('cards.coursePermission.requireCourseApproval')}
                        </div>
                        <Switch
                            checked={settings.coursePage?.requireCourseApproval !== false}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    coursePage: {
                                        ...prev.coursePage,
                                        viewInviteLinks: prev.coursePage?.viewInviteLinks ?? true,
                                        viewShortInviteLinks:
                                            prev.coursePage?.viewShortInviteLinks ?? false,
                                        viewCourseConfiguration:
                                            prev.coursePage?.viewCourseConfiguration ?? true,
                                        viewCourseOverviewItem:
                                            prev.coursePage?.viewCourseOverviewItem ?? true,
                                        viewContentNumbering:
                                            prev.coursePage?.viewContentNumbering ?? true,
                                        allowViewSlidesInReadOnly:
                                            prev.coursePage?.allowViewSlidesInReadOnly ?? true,
                                        directEditPublishedCourse:
                                            prev.coursePage?.directEditPublishedCourse ?? false,
                                        canEditCourseStructure:
                                            prev.coursePage?.canEditCourseStructure ?? false,
                                        canDeleteCourseStructure:
                                            prev.coursePage?.canDeleteCourseStructure ?? false,
                                        showAdvancedCourseIds:
                                            prev.coursePage?.showAdvancedCourseIds ?? false,
                                        showBulkUpload:
                                            prev.coursePage?.showBulkUpload ?? false,
                                        showAddSubject: prev.coursePage?.showAddSubject ?? true,
                                        showAddModule: prev.coursePage?.showAddModule ?? true,
                                        showAddChapter: prev.coursePage?.showAddChapter ?? true,
                                        showAddSlide: prev.coursePage?.showAddSlide ?? true,
                                        requireCourseApproval: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                    {(
                        [
                            ['showCopyTo', t('cards.coursePermission.options.showCopyTo')],
                            ['showMoveTo', t('cards.coursePermission.options.showMoveTo')],
                            ['showDelete', t('cards.coursePermission.options.showDelete')],
                        ] as const
                    ).map(([key, label]) => (
                        <div
                            key={key}
                            className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
                        >
                            <div className="text-sm font-medium text-neutral-800">{label}</div>
                            <Switch
                                checked={settings.slideView?.[key] !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        slideView: {
                                            showCopyTo: prev.slideView?.showCopyTo ?? true,
                                            showMoveTo: prev.slideView?.showMoveTo ?? true,
                                            showDelete: prev.slideView?.showDelete ?? true,
                                            showAddVideoQuestion:
                                                prev.slideView?.showAddVideoQuestion ?? true,
                                            showConvertToSplitScreen:
                                                prev.slideView?.showConvertToSplitScreen ?? true,
                                            [key]: checked,
                                        },
                                    }))
                                }
                            />
                        </div>
                    ))}
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">{t('cards.coursePermission.editStructure')}</div>
                        <Switch
                            checked={settings.coursePage?.canEditCourseStructure === true}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    coursePage: {
                                        ...prev.coursePage,
                                        viewInviteLinks: prev.coursePage?.viewInviteLinks ?? true,
                                        viewShortInviteLinks:
                                            prev.coursePage?.viewShortInviteLinks ?? false,
                                        viewCourseConfiguration:
                                            prev.coursePage?.viewCourseConfiguration ?? true,
                                        viewCourseOverviewItem:
                                            prev.coursePage?.viewCourseOverviewItem ?? true,
                                        viewContentNumbering:
                                            prev.coursePage?.viewContentNumbering ?? true,
                                        allowViewSlidesInReadOnly:
                                            prev.coursePage?.allowViewSlidesInReadOnly ?? true,
                                        directEditPublishedCourse:
                                            prev.coursePage?.directEditPublishedCourse ?? false,
                                        canDeleteCourseStructure:
                                            prev.coursePage?.canDeleteCourseStructure ?? false,
                                        showAdvancedCourseIds:
                                            prev.coursePage?.showAdvancedCourseIds ?? false,
                                        showBulkUpload:
                                            prev.coursePage?.showBulkUpload ?? false,
                                        showAddSubject: prev.coursePage?.showAddSubject ?? true,
                                        showAddModule: prev.coursePage?.showAddModule ?? true,
                                        showAddChapter: prev.coursePage?.showAddChapter ?? true,
                                        showAddSlide: prev.coursePage?.showAddSlide ?? true,
                                        canEditCourseStructure: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">{t('cards.coursePermission.deleteStructure')}</div>
                        <Switch
                            checked={settings.coursePage?.canDeleteCourseStructure === true}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    coursePage: {
                                        ...prev.coursePage,
                                        viewInviteLinks: prev.coursePage?.viewInviteLinks ?? true,
                                        viewShortInviteLinks:
                                            prev.coursePage?.viewShortInviteLinks ?? false,
                                        viewCourseConfiguration:
                                            prev.coursePage?.viewCourseConfiguration ?? true,
                                        viewCourseOverviewItem:
                                            prev.coursePage?.viewCourseOverviewItem ?? true,
                                        viewContentNumbering:
                                            prev.coursePage?.viewContentNumbering ?? true,
                                        allowViewSlidesInReadOnly:
                                            prev.coursePage?.allowViewSlidesInReadOnly ?? true,
                                        directEditPublishedCourse:
                                            prev.coursePage?.directEditPublishedCourse ?? false,
                                        canEditCourseStructure:
                                            prev.coursePage?.canEditCourseStructure ?? false,
                                        showAdvancedCourseIds:
                                            prev.coursePage?.showAdvancedCourseIds ?? false,
                                        showBulkUpload:
                                            prev.coursePage?.showBulkUpload ?? false,
                                        showAddSubject: prev.coursePage?.showAddSubject ?? true,
                                        showAddModule: prev.coursePage?.showAddModule ?? true,
                                        showAddChapter: prev.coursePage?.showAddChapter ?? true,
                                        showAddSlide: prev.coursePage?.showAddSlide ?? true,
                                        canDeleteCourseStructure: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">
                            {t('cards.coursePermission.showBulkUpload')}
                        </div>
                        <Switch
                            checked={settings.coursePage?.showBulkUpload === true}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    coursePage: {
                                        ...prev.coursePage,
                                        viewInviteLinks: prev.coursePage?.viewInviteLinks ?? true,
                                        viewShortInviteLinks:
                                            prev.coursePage?.viewShortInviteLinks ?? false,
                                        viewCourseConfiguration:
                                            prev.coursePage?.viewCourseConfiguration ?? true,
                                        viewCourseOverviewItem:
                                            prev.coursePage?.viewCourseOverviewItem ?? true,
                                        viewContentNumbering:
                                            prev.coursePage?.viewContentNumbering ?? true,
                                        allowViewSlidesInReadOnly:
                                            prev.coursePage?.allowViewSlidesInReadOnly ?? true,
                                        directEditPublishedCourse:
                                            prev.coursePage?.directEditPublishedCourse ?? false,
                                        canEditCourseStructure:
                                            prev.coursePage?.canEditCourseStructure ?? false,
                                        canDeleteCourseStructure:
                                            prev.coursePage?.canDeleteCourseStructure ?? false,
                                        showAdvancedCourseIds:
                                            prev.coursePage?.showAdvancedCourseIds ?? false,
                                        showAddSubject: prev.coursePage?.showAddSubject ?? true,
                                        showAddModule: prev.coursePage?.showAddModule ?? true,
                                        showAddChapter: prev.coursePage?.showAddChapter ?? true,
                                        showAddSlide: prev.coursePage?.showAddSlide ?? true,
                                        showBulkUpload: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">{t('cards.coursePermission.deleteCourse')}</div>
                        <Switch
                            checked={settings.authoredCoursesCard?.showDelete !== false}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    authoredCoursesCard: {
                                        showCopyToEdit:
                                            prev.authoredCoursesCard?.showCopyToEdit ?? false,
                                        showDelete: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.authoredCoursesCard.title')}</CardTitle>
                    <CardDescription>{t('cards.authoredCoursesCard.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">{t('cards.authoredCoursesCard.showCopyToEdit')}</div>
                        <Switch
                            checked={settings.authoredCoursesCard?.showCopyToEdit !== false}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    authoredCoursesCard: {
                                        showCopyToEdit: checked,
                                        showDelete:
                                            prev.authoredCoursesCard?.showDelete ?? false,
                                    },
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.courseListCard.title')}</CardTitle>
                    <CardDescription>{t('cards.courseListCard.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">{t('cards.courseListCard.showEnrolledStudentCount')}</div>
                        <Switch
                            checked={
                                settings.courseListCard?.showEnrolledStudentCount === true
                            }
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    courseListCard: {
                                        showEnrolledStudentCount: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.courseCreation.title')}</CardTitle>
                    <CardDescription>{t('cards.courseCreation.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">
                            {t('cards.courseCreation.showCreateCourse')}
                        </div>
                        <Switch
                            checked={settings.courseCreation?.showCreateCourse ?? true}
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    courseCreation: {
                                        showCreateCourse: checked,
                                        showCreateCourseWithAI:
                                            prev.courseCreation?.showCreateCourseWithAI ??
                                            COURSE_CREATION_DEFAULTS.showCreateCourseWithAI,
                                        requirePackageSelectionForNewChapter:
                                            prev.courseCreation
                                                ?.requirePackageSelectionForNewChapter ??
                                            COURSE_CREATION_DEFAULTS.requirePackageSelectionForNewChapter,
                                        showAdvancedSettings:
                                            prev.courseCreation?.showAdvancedSettings ??
                                            COURSE_CREATION_DEFAULTS.showAdvancedSettings,
                                        limitToSingleLevel:
                                            prev.courseCreation?.limitToSingleLevel ??
                                            COURSE_CREATION_DEFAULTS.limitToSingleLevel,
                                    },
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">{t('cards.courseCreation.showCreateCourseWithAI')}</div>
                        <Switch
                            checked={
                                settings.courseCreation?.showCreateCourseWithAI ??
                                COURSE_CREATION_DEFAULTS.showCreateCourseWithAI
                            }
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    courseCreation: {
                                        showCreateCourse: prev.courseCreation?.showCreateCourse,
                                        showCreateCourseWithAI: checked,
                                        requirePackageSelectionForNewChapter:
                                            prev.courseCreation
                                                ?.requirePackageSelectionForNewChapter ??
                                            COURSE_CREATION_DEFAULTS.requirePackageSelectionForNewChapter,
                                        showAdvancedSettings:
                                            prev.courseCreation?.showAdvancedSettings ??
                                            COURSE_CREATION_DEFAULTS.showAdvancedSettings,
                                        limitToSingleLevel:
                                            prev.courseCreation?.limitToSingleLevel ??
                                            COURSE_CREATION_DEFAULTS.limitToSingleLevel,
                                    },
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">
                            {t('cards.courseCreation.requirePackageSelectionForNewChapter')}
                        </div>
                        <Switch
                            checked={
                                settings.courseCreation?.requirePackageSelectionForNewChapter ??
                                COURSE_CREATION_DEFAULTS.requirePackageSelectionForNewChapter
                            }
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    courseCreation: {
                                        showCreateCourse: prev.courseCreation?.showCreateCourse,
                                        showCreateCourseWithAI:
                                            prev.courseCreation?.showCreateCourseWithAI ??
                                            COURSE_CREATION_DEFAULTS.showCreateCourseWithAI,
                                        requirePackageSelectionForNewChapter: checked,
                                        showAdvancedSettings:
                                            prev.courseCreation?.showAdvancedSettings ??
                                            COURSE_CREATION_DEFAULTS.showAdvancedSettings,
                                        limitToSingleLevel:
                                            prev.courseCreation?.limitToSingleLevel ??
                                            COURSE_CREATION_DEFAULTS.limitToSingleLevel,
                                    },
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">{t('cards.courseCreation.showAdvancedSettings')}</div>
                        <Switch
                            checked={
                                settings.courseCreation?.showAdvancedSettings ??
                                COURSE_CREATION_DEFAULTS.showAdvancedSettings
                            }
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    courseCreation: {
                                        showCreateCourse: prev.courseCreation?.showCreateCourse,
                                        showCreateCourseWithAI:
                                            prev.courseCreation?.showCreateCourseWithAI ??
                                            COURSE_CREATION_DEFAULTS.showCreateCourseWithAI,
                                        requirePackageSelectionForNewChapter:
                                            prev.courseCreation
                                                ?.requirePackageSelectionForNewChapter ??
                                            COURSE_CREATION_DEFAULTS.requirePackageSelectionForNewChapter,
                                        showAdvancedSettings: checked,
                                        limitToSingleLevel:
                                            prev.courseCreation?.limitToSingleLevel ??
                                            COURSE_CREATION_DEFAULTS.limitToSingleLevel,
                                    },
                                }))
                            }
                        />
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                        <div className="text-sm font-medium text-neutral-800">{t('cards.courseCreation.limitToSingleLevel')}</div>
                        <Switch
                            checked={
                                settings.courseCreation?.limitToSingleLevel ??
                                COURSE_CREATION_DEFAULTS.limitToSingleLevel
                            }
                            onCheckedChange={(checked) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    courseCreation: {
                                        showCreateCourse: prev.courseCreation?.showCreateCourse,
                                        showCreateCourseWithAI:
                                            prev.courseCreation?.showCreateCourseWithAI ??
                                            COURSE_CREATION_DEFAULTS.showCreateCourseWithAI,
                                        requirePackageSelectionForNewChapter:
                                            prev.courseCreation
                                                ?.requirePackageSelectionForNewChapter ??
                                            COURSE_CREATION_DEFAULTS.requirePackageSelectionForNewChapter,
                                        showAdvancedSettings:
                                            prev.courseCreation?.showAdvancedSettings ??
                                            COURSE_CREATION_DEFAULTS.showAdvancedSettings,
                                        limitToSingleLevel: checked,
                                    },
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.courseListTabs.title')}</CardTitle>
                    <CardDescription>{t('cards.courseListTabs.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(() => {
                        const allIds: CourseListTabId[] = [
                            'AllCourses',
                            'AuthoredCourses',
                            'CourseApproval',
                            'CourseInReview',
                        ];
                        const sorted = allIds
                            .map((id) => {
                                const cfg = settings.courseList?.tabs.find((t) => t.id === id) || {
                                    id,
                                    order: 0,
                                    visible: true,
                                };
                                return cfg;
                            })
                            .sort((a, b) => a.order - b.order);

                        return sorted.map((cfg, idx) => {
                            const id = cfg.id as CourseListTabId;
                            // The tab that belongs to the OTHER role stays hidden; the
                            // review/approval tab for this role is a normal toggle so an
                            // institute that does not use the approval flow can hide it
                            // (Neeraj, 2026-09-19).
                            const isForcedHidden = id === 'CourseApproval';
                            const disabledToggle = isForcedHidden;
                            const enforcedVisible = isForcedHidden ? false : cfg.visible;
                            return (
                                <div
                                    key={id}
                                    className="flex items-center gap-3 rounded border p-3"
                                >
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0}
                                            onClick={() => moveCourseListTab(id, 'up')}>
                                            <ArrowUp className="h-3 w-3" />
                                        </Button>
                                        <span className="text-xs text-muted-foreground">{idx + 1}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === sorted.length - 1}
                                            onClick={() => moveCourseListTab(id, 'down')}>
                                            <ArrowDown className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="flex-1 text-sm font-medium">{id}</div>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={enforcedVisible}
                                            disabled={disabledToggle}
                                            onCheckedChange={(checked) =>
                                                updateSettings((prev) => ({
                                                    ...prev,
                                                    courseList: {
                                                        tabs: (prev.courseList?.tabs || []).map((t) =>
                                                            t.id === id ? { ...t, visible: checked } : t
                                                        ),
                                                        defaultTab:
                                                            prev.courseList?.defaultTab ||
                                                            'AuthoredCourses',
                                                    },
                                                }))
                                            }
                                        />
                                        <span className="text-sm">{t('common.visible')}</span>
                                    </div>
                                    <div>
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="radio"
                                                name="teacher-course-list-default"
                                                checked={settings.courseList?.defaultTab === id}
                                                onChange={() =>
                                                    updateSettings((prev) => ({
                                                        ...prev,
                                                        courseList: {
                                                            tabs: prev.courseList?.tabs || [],
                                                            defaultTab: id,
                                                        },
                                                    }))
                                                }
                                                disabled={isForcedHidden}
                                            />
                                            {t('common.default')}
                                        </label>
                                    </div>
                                </div>
                            );
                        });
                    })()}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.courseDetailsTabs.title')}</CardTitle>
                    <CardDescription>{t('cards.courseDetailsTabs.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(() => {
                        const allIds: CourseDetailsTabId[] = [
                            'OUTLINE',
                            'CONTENT_STRUCTURE',
                            'LEARNER',
                            'TEACHER',
                            'ASSESSMENT',
                            'QUIZ_RESULTS',
                            'LIVE_SESSION',
                            'PLANNING',
                            'ACTIVITY',
                            'PULSE',
                            'REPORTS',
                            'CERTIFICATES',
                            'DOWNLOADS',
                            'TUTOR_MODE',
                            'AI_KNOWLEDGE',
                        ];
                        // Tabs that stay OFF unless explicitly enabled per role.
                        const hiddenByDefault = DEFAULT_HIDDEN_COURSE_DETAILS_TABS;
                        const sorted = allIds
                            .map((id) => {
                                const cfg = settings.courseDetails?.tabs.find((t) => t.id === id) || {
                                    id,
                                    order: 0,
                                    visible: !hiddenByDefault.has(id),
                                };
                                return cfg;
                            })
                            .sort((a, b) => a.order - b.order);

                        return sorted.map((cfg, idx) => {
                            const id = cfg.id as CourseDetailsTabId;
                            // Offline access off → this tab is dead on the course
                            // page, so show it as off and locked rather than
                            // rewriting the role's stored preference.
                            const offlineLocked =
                                OFFLINE_GATED_COURSE_DETAILS_TABS.has(id) && !offlineAccessEnabled;
                            return (
                                <div
                                    key={id}
                                    className="flex items-center gap-3 rounded border p-3"
                                >
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0}
                                            onClick={() => moveCourseDetailsTab(id, 'up')}>
                                            <ArrowUp className="h-3 w-3" />
                                        </Button>
                                        <span className="text-xs text-muted-foreground">{idx + 1}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === sorted.length - 1}
                                            onClick={() => moveCourseDetailsTab(id, 'down')}>
                                            <ArrowDown className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium">
                                            {id.replace('_', ' ')}
                                        </div>
                                        {offlineLocked && (
                                            <div className="text-caption text-neutral-500">
                                                {t('cards.courseDetailsTabs.offlineLockedHint')}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={offlineLocked ? false : cfg.visible}
                                            disabled={offlineLocked}
                                            onCheckedChange={(checked) =>
                                                updateSettings((prev) => {
                                                    const prevTabs = prev.courseDetails?.tabs || [];
                                                    const exists = prevTabs.some((t) => t.id === id);
                                                    const orderForId: Record<string, number> = {
                                                        OUTLINE: 1,
                                                        CONTENT_STRUCTURE: 2,
                                                        LEARNER: 3,
                                                        TEACHER: 4,
                                                        ASSESSMENT: 5,
                                                        // See admin-defaults.ts: 5.5 avoids
                                                        // colliding with saved orders.
                                                        QUIZ_RESULTS: 5.5,
                                                        LIVE_SESSION: 6,
                                                        PLANNING: 7,
                                                        ACTIVITY: 8,
                                                        PULSE: 9,
                                                        REPORTS: 10,
                                                        CERTIFICATES: 11,
                                                        DOWNLOADS: 12,
                                                        TUTOR_MODE: 13.5,
                                                        AI_KNOWLEDGE: 13.6,
                                                    };
                                                    const tabs = exists
                                                        ? prevTabs.map((t) =>
                                                              t.id === id
                                                                  ? { ...t, visible: checked }
                                                                  : t
                                                          )
                                                        : [
                                                              ...prevTabs,
                                                              {
                                                                  id,
                                                                  order: orderForId[id] ?? 99,
                                                                  visible: checked,
                                                              },
                                                          ];
                                                    return {
                                                        ...prev,
                                                        courseDetails: {
                                                            tabs,
                                                            defaultTab:
                                                                prev.courseDetails?.defaultTab ||
                                                                'CONTENT_STRUCTURE',
                                                        },
                                                    };
                                                })
                                            }
                                        />
                                        <span className="text-sm">{t('common.visible')}</span>
                                    </div>
                                    <div>
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="radio"
                                                name="teacher-course-details-default"
                                                checked={settings.courseDetails?.defaultTab === id}
                                                disabled={offlineLocked}
                                                onChange={() =>
                                                    updateSettings((prev) => ({
                                                        ...prev,
                                                        courseDetails: {
                                                            tabs: prev.courseDetails?.tabs || [],
                                                            defaultTab: id,
                                                        },
                                                    }))
                                                }
                                            />
                                            {t('common.default')}
                                        </label>
                                    </div>
                                </div>
                            );
                        });
                    })()}
                </CardContent>
            </Card>
            </>
            )}
            {planRows.card('assessmentActions') && (
                <AssessmentActionsCard
                    settings={settings.assessmentPage}
                    onChange={(next) =>
                        updateSettings((prev) => ({ ...prev, assessmentPage: next }))
                    }
                />
            )}
            {planRows.card('liveClassActions') && (
                <LiveClassActionsCard
                    settings={settings.liveClassActions}
                    onChange={(next) =>
                        updateSettings((prev) => ({ ...prev, liveClassActions: next }))
                    }
                    defaultAllowDeletePastSessions={false}
                />
            )}
            {planRows.card('leadActions') && (
                <LeadActionsCard
                    settings={settings.leadActions}
                    onChange={(next) =>
                        updateSettings((prev) => ({ ...prev, leadActions: next }))
                    }
                />
            )}
            </section>

            <section id="grp-layout" className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.uiOptions.title')}</CardTitle>
                    <CardDescription>{t('cards.uiOptions.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                            <div className="text-sm font-medium text-neutral-800">{t('cards.uiOptions.showSupportButton')}</div>
                            <Switch
                                checked={settings.ui?.showSupportButton !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        ui: { ...prev.ui, showSupportButton: checked },
                                    }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                            <div className="text-sm font-medium text-neutral-800">{t('cards.uiOptions.showSidebar')}</div>
                            <Switch
                                checked={settings.ui?.showSidebar !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        ui: {
                                            showSupportButton: true,
                                            ...prev.ui,
                                            showSidebar: checked,
                                        },
                                    }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                            <div className="text-sm font-medium text-neutral-800">{t('cards.uiOptions.showAiCredits')}</div>
                            <Switch
                                checked={settings.ui?.showAiCredits !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        ui: {
                                            showSupportButton: true,
                                            ...prev.ui,
                                            showAiCredits: checked,
                                        },
                                    }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                            <div className="text-sm font-medium text-neutral-800">{t('cards.uiOptions.showStatus')}</div>
                            <Switch
                                checked={settings.ui?.showStatus !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        ui: {
                                            showSupportButton: true,
                                            ...prev.ui,
                                            showStatus: checked,
                                        },
                                    }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                            <div>
                                <div className="text-sm font-medium text-neutral-800">
                                    {t('cards.uiOptions.showSettings')}
                                </div>
                                <div className="text-xs text-neutral-500">
                                    {t('cards.uiOptions.showSettingsHint')}
                                </div>
                            </div>
                            <Switch
                                checked={settings.ui?.showSettings !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        ui: {
                                            showSupportButton: true,
                                            ...prev.ui,
                                            showSettings: checked,
                                        },
                                    }))
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0">
                            <div>
                                <div className="text-sm font-medium text-neutral-800">
                                    {t('cards.uiOptions.showAssistDock')}
                                </div>
                                <div className="text-xs text-neutral-500">
                                    {t('cards.uiOptions.showAssistDockHint')}
                                </div>
                            </div>
                            <Switch
                                checked={settings.ui?.showAssistDock === true}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        ui: {
                                            showSupportButton: true,
                                            ...prev.ui,
                                            showAssistDock: checked,
                                        },
                                    }))
                                }
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.sidebarCategories.title')}</CardTitle>
                    <CardDescription>{t('cards.sidebarCategories.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(() => {
                        const categories = settings.sidebarCategories || [
                            { id: 'CRM' as const, visible: true, default: true, order: 0 },
                            { id: 'LMS' as const, visible: true, default: false, order: 1 },
                            { id: 'AI' as const, visible: true, default: false, order: 2 },
                        ];
                        const sorted = categories
                            .filter((c) => planRows.category(c.id, settings.sidebar))
                            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

                        return sorted.map((cfg, idx) => {
                            const id = cfg.id;
                            return (
                                <div
                                    key={id}
                                    className="flex items-center gap-3 rounded border p-3"
                                >
                                    <div className="flex flex-col items-center gap-0.5">
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0}
                                            onClick={() => moveSidebarCategory(id, 'up')}>
                                            <ArrowUp className="h-3 w-3" />
                                        </Button>
                                        <span className="text-xs text-muted-foreground">{idx + 1}</span>
                                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === sorted.length - 1}
                                            onClick={() => moveSidebarCategory(id, 'down')}>
                                            <ArrowDown className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="flex-1 text-sm font-medium">
                                        {id === 'AI' ? t('common.aiTools') : id}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={
                                                cfg.visible === false
                                                    ? 'hidden'
                                                    : cfg.locked
                                                      ? 'locked'
                                                      : 'visible'
                                            }
                                            onValueChange={(value) => {
                                                updateSettings((prev) => {
                                                    const currentCats = prev.sidebarCategories || [
                                                        {
                                                            id: 'CRM' as const,
                                                            visible: true,
                                                            default: true,
                                                            order: 0,
                                                        },
                                                        {
                                                            id: 'LMS' as const,
                                                            visible: true,
                                                            default: false,
                                                            order: 1,
                                                        },
                                                        {
                                                            id: 'AI' as const,
                                                            visible: true,
                                                            default: false,
                                                            order: 2,
                                                        },
                                                    ];
                                                    const baseIds = ['CRM', 'LMS', 'AI'] as const;
                                                    let newCats = [...currentCats];
                                                    baseIds.forEach((bid) => {
                                                        if (!newCats.find((c) => c.id === bid)) {
                                                            newCats.push({
                                                                id: bid,
                                                                visible: true,
                                                                default: bid === 'CRM',
                                                                order: 0,
                                                            });
                                                        }
                                                    });

                                                    newCats = newCats.map((c) => {
                                                        if (c.id !== id) return c;
                                                        if (value === 'hidden') {
                                                            return {
                                                                ...c,
                                                                visible: false,
                                                                locked: false,
                                                            };
                                                        }
                                                        if (value === 'locked') {
                                                            return {
                                                                ...c,
                                                                visible: true,
                                                                locked: true,
                                                            };
                                                        }
                                                        return { ...c, visible: true, locked: false };
                                                    });
                                                    return { ...prev, sidebarCategories: newCats };
                                                });
                                            }}
                                        >
                                            <SelectTrigger className="w-24">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="visible">{t('common.visible')}</SelectItem>
                                                <SelectItem value="hidden">{t('common.hidden')}</SelectItem>
                                                <SelectItem value="locked">{t('common.locked')}</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div>
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="radio"
                                                name="sidebar-category-default"
                                                checked={cfg.default}
                                                onChange={() => {
                                                    updateSettings((prev) => {
                                                        const currentCats = prev.sidebarCategories || [
                                                            {
                                                                id: 'CRM' as const,
                                                                visible: true,
                                                                default: true,
                                                                order: 0,
                                                            },
                                                            {
                                                                id: 'LMS' as const,
                                                                visible: true,
                                                                default: false,
                                                                order: 1,
                                                            },
                                                            {
                                                                id: 'AI' as const,
                                                                visible: true,
                                                                default: false,
                                                                order: 2,
                                                            },
                                                        ];
                                                        const baseIds = ['CRM', 'LMS', 'AI'] as const;
                                                        let newCats = [...currentCats];
                                                        baseIds.forEach((bid) => {
                                                            if (!newCats.find((c) => c.id === bid)) {
                                                                newCats.push({
                                                                    id: bid,
                                                                    visible: true,
                                                                    default: bid === 'CRM',
                                                                    order: 0,
                                                                });
                                                            }
                                                        });

                                                        // Set only one default
                                                        newCats = newCats.map((c) => ({
                                                            ...c,
                                                            default: c.id === id,
                                                        }));
                                                        return { ...prev, sidebarCategories: newCats };
                                                    });
                                                }}
                                            />
                                            {t('common.default')}
                                        </label>
                                    </div>
                                </div>
                            );
                        });
                    })()}
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.sidebarTabs.title')}</CardTitle>
                    <CardDescription>{t('cards.sidebarTabs.description')}</CardDescription>
                </CardHeader>
                {/* Assuming activeCategory state is declared here or in the parent component */}
                {/* For example: const [activeCategory, setActiveCategory] = useState<'LMS' | 'CRM' | 'AI'>('CRM'); */}
                <CardContent className="space-y-3">
                    <Tabs
                        value={activeCategory}
                        onValueChange={(v) => setActiveCategory(v as SidebarCategory)}
                        className="w-full"
                    >
                        <TabsList className="mb-4 grid w-full grid-cols-4">
                            <TabsTrigger value="LMS">LMS</TabsTrigger>
                            <TabsTrigger value="CRM">CRM</TabsTrigger>
                            <TabsTrigger value="AI">{t('common.aiTools')}</TabsTrigger>
                            <TabsTrigger value="ERP">ERP</TabsTrigger>
                        </TabsList>

                        {(() => {
                            const categoryTabs = settings.sidebar
                                .filter((tab) => {
                                    const baseItem = sidebarItems.find((i) => i.id === tab.id);
                                    const cat = baseItem?.category || tab.category || 'CRM';
                                    return cat === activeCategory && planRows.tab(tab.id);
                                })
                                .sort((a, b) => a.order - b.order);

                            return categoryTabs.map((tab, tabIdx) => {
                                const baseItem = sidebarItems.find((i) => i.id === tab.id);
                                return (
                                <div key={tab.id} className="mb-3 rounded border p-3">
                                    <div className="flex items-start gap-3">
                                        {/* Move up/down buttons */}
                                        <div className="flex flex-col items-center gap-1 pt-6">
                                            <DotsSixVertical className="h-4 w-4 text-muted-foreground mb-1" />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                disabled={tabIdx === 0}
                                                onClick={() => moveTab(tab.id, 'up')}
                                            >
                                                <ArrowUp className="h-4 w-4" />
                                            </Button>
                                            <span className="text-xs text-muted-foreground font-medium">
                                                {tabIdx + 1}
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                disabled={tabIdx === categoryTabs.length - 1}
                                                onClick={() => moveTab(tab.id, 'down')}
                                            >
                                                <ArrowDown className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        {/* Tab fields */}
                                        <div className="flex-1">
                                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-center">
                                                <div className="col-span-2">
                                                    <Label>{t('cards.sidebarTabs.tabName')}</Label>
                                                    <Input
                                                        value={tab.label || baseItem?.title || ''}
                                                        onChange={(e) =>
                                                            updateSettings((prev) => ({
                                                                ...prev,
                                                                sidebar: prev.sidebar.map((t) =>
                                                                    t.id === tab.id
                                                                        ? { ...t, label: e.target.value }
                                                                        : t
                                                                ),
                                                            }))
                                                        }
                                                    />
                                                </div>
                                                <div>
                                                    <Label>{t('cards.sidebarTabs.route')}</Label>
                                                    <Input
                                                        value={tab.route || ''}
                                                        onChange={(e) =>
                                                            updateSettings((prev) => ({
                                                                ...prev,
                                                                sidebar: prev.sidebar.map((t) =>
                                                                    t.id === tab.id
                                                                        ? { ...t, route: e.target.value }
                                                                        : t
                                                                ),
                                                            }))
                                                        }
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2 pt-6">
                                                    <Select
                                                        value={
                                                            tab.visible === false
                                                                ? 'hidden'
                                                                : tab.locked
                                                                  ? 'locked'
                                                                  : 'visible'
                                                        }
                                                        onValueChange={(value) =>
                                                            updateSettings((prev) => ({
                                                                ...prev,
                                                                sidebar: prev.sidebar.map((t) => {
                                                                    if (t.id !== tab.id) return t;
                                                                    if (value === 'hidden') {
                                                                        return {
                                                                            ...t,
                                                                            visible: false,
                                                                            locked: false,
                                                                        };
                                                                    }
                                                                    if (value === 'locked') {
                                                                        return {
                                                                            ...t,
                                                                            visible: true,
                                                                            locked: true,
                                                                        };
                                                                    }
                                                                    return {
                                                                        ...t,
                                                                        visible: true,
                                                                        locked: false,
                                                                    };
                                                                }),
                                                            }))
                                                        }
                                                    >
                                                        <SelectTrigger className="w-24">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="visible">{t('common.visible')}</SelectItem>
                                                            <SelectItem value="hidden">{t('common.hidden')}</SelectItem>
                                                            <SelectItem value="locked">{t('common.locked')}</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    {tab.isCustom && (
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            onClick={() => removeCustomTab(tab.id)}
                                                        >
                                                            {t('common.remove')}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="mt-3 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <Label>{t('cards.sidebarTabs.subTabs')}</Label>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => addSubTab(tab.id)}
                                                    >
                                                        {t('cards.sidebarTabs.addSubTab')}
                                                    </Button>
                                                </div>
                                                {(() => {
                                                    const sortedSubs = (tab.subTabs || [])
                                                        .filter((s) => planRows.subTab(tab.id, s.id))
                                                        .sort((a, b) => a.order - b.order);

                                                    return sortedSubs.map((sub, subIdx) => {
                                                    const baseSub = baseItem?.subItems?.find(
                                                        (i) =>
                                                            (i.subItemId || i.subItem) === sub.id
                                                    );
                                                    return (
                                                        <div
                                                            key={sub.id}
                                                            className="flex items-center gap-3 rounded border p-2"
                                                        >
                                                            {/* Sub-tab move buttons */}
                                                            <div className="flex flex-col items-center gap-0.5">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-6 w-6"
                                                                    disabled={subIdx === 0}
                                                                    onClick={() =>
                                                                        moveSubTab(tab.id, sub.id, 'up')
                                                                    }
                                                                >
                                                                    <ArrowUp className="h-3 w-3" />
                                                                </Button>
                                                                <span className="text-xs text-muted-foreground">
                                                                    {subIdx + 1}
                                                                </span>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-6 w-6"
                                                                    disabled={subIdx === sortedSubs.length - 1}
                                                                    onClick={() =>
                                                                        moveSubTab(tab.id, sub.id, 'down')
                                                                    }
                                                                >
                                                                    <ArrowDown className="h-3 w-3" />
                                                                </Button>
                                                            </div>

                                                            {/* Sub-tab fields */}
                                                            <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-4 md:items-center">
                                                                <div className="col-span-2">
                                                                    <Input
                                                                        value={
                                                                            sub.label ||
                                                                            baseSub?.subItem ||
                                                                            ''
                                                                        }
                                                                        placeholder={t('cards.sidebarTabs.labelPlaceholder')}
                                                                        onChange={(e) =>
                                                                            updateSettings((prev) => ({
                                                                                ...prev,
                                                                                sidebar: prev.sidebar.map(
                                                                                    (t) =>
                                                                                        t.id === tab.id
                                                                                            ? {
                                                                                                  ...t,
                                                                                                  subTabs: (
                                                                                                      t.subTabs ||
                                                                                                      []
                                                                                                  ).map((s) =>
                                                                                                      s.id ===
                                                                                                      sub.id
                                                                                                          ? {
                                                                                                                ...s,
                                                                                                                label: e
                                                                                                                    .target
                                                                                                                    .value,
                                                                                                            }
                                                                                                          : s
                                                                                                  ),
                                                                                              }
                                                                                            : t
                                                                                ),
                                                                            }))
                                                                        }
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <Input
                                                                        value={sub.route}
                                                                        placeholder={t('cards.sidebarTabs.routePlaceholder')}
                                                                        onChange={(e) =>
                                                                            updateSettings((prev) => ({
                                                                                ...prev,
                                                                                sidebar: prev.sidebar.map(
                                                                                    (t) =>
                                                                                        t.id === tab.id
                                                                                            ? {
                                                                                                  ...t,
                                                                                                  subTabs: (
                                                                                                      t.subTabs ||
                                                                                                      []
                                                                                                  ).map((s) =>
                                                                                                      s.id ===
                                                                                                      sub.id
                                                                                                          ? {
                                                                                                                ...s,
                                                                                                                route: e
                                                                                                                    .target
                                                                                                                    .value,
                                                                                                            }
                                                                                                          : s
                                                                                                  ),
                                                                                              }
                                                                                            : t
                                                                                ),
                                                                            }))
                                                                        }
                                                                    />
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <Select
                                                                        value={
                                                                            sub.visible === false
                                                                                ? 'hidden'
                                                                                : sub.locked
                                                                                  ? 'locked'
                                                                                  : 'visible'
                                                                        }
                                                                        onValueChange={(value) =>
                                                                            updateSettings((prev) => ({
                                                                                ...prev,
                                                                                sidebar: prev.sidebar.map(
                                                                                    (t) =>
                                                                                        t.id === tab.id
                                                                                            ? {
                                                                                                  ...t,
                                                                                                  subTabs: (
                                                                                                      t.subTabs ||
                                                                                                      []
                                                                                                  ).map((s) => {
                                                                                                      if (
                                                                                                          s.id !==
                                                                                                          sub.id
                                                                                                      )
                                                                                                          return s;
                                                                                                      if (
                                                                                                          value ===
                                                                                                          'hidden'
                                                                                                      ) {
                                                                                                          return {
                                                                                                              ...s,
                                                                                                              visible:
                                                                                                                  false,
                                                                                                              locked: false,
                                                                                                          };
                                                                                                      }
                                                                                                      if (
                                                                                                          value ===
                                                                                                          'locked'
                                                                                                      ) {
                                                                                                          return {
                                                                                                              ...s,
                                                                                                              visible:
                                                                                                                  true,
                                                                                                              locked: true,
                                                                                                          };
                                                                                                      }
                                                                                                      return {
                                                                                                          ...s,
                                                                                                          visible:
                                                                                                              true,
                                                                                                          locked: false,
                                                                                                      };
                                                                                                  }),
                                                                                              }
                                                                                            : t
                                                                                ),
                                                                            }))
                                                                        }
                                                                    >
                                                                        <SelectTrigger className="w-24">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="visible">
                                                                                {t('common.visible')}
                                                                            </SelectItem>
                                                                            <SelectItem value="hidden">
                                                                                {t('common.hidden')}
                                                                            </SelectItem>
                                                                            <SelectItem value="locked">
                                                                                {t('common.locked')}
                                                                            </SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                    {sub.id.startsWith('custom-sub-') && (
                                                                        <Button
                                                                            variant="destructive"
                                                                            size="sm"
                                                                            onClick={() =>
                                                                                removeCustomSubTab(
                                                                                    tab.id,
                                                                                    sub.id
                                                                                )
                                                                            }
                                                                        >
                                                                            {t('common.remove')}
                                                                        </Button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                    });
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                            });
                        })()}
                    </Tabs>
                    <div className="pt-2">
                        <Button variant="outline" onClick={addCustomTab}>
                            {t('cards.sidebarTabs.addCustomTab')}
                        </Button>
                    </div>
                </CardContent>
            </Card>
            </section>

            <section id="grp-learners" className="space-y-6">
            {/* Slide content types: LMS only (plan-rows.ts). */}
            {planRows.card('courseContentTypes') && (
            <>
            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.courseContentTypes.title')}</CardTitle>
                    <CardDescription>{t('cards.courseContentTypes.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(
                        [
                            ['pdf', t('cards.courseContentTypes.options.pdf')],
                            ['ppt', t('cards.courseContentTypes.options.ppt')],
                            ['codeEditor', t('cards.courseContentTypes.options.codeEditor')],
                            ['document', t('cards.courseContentTypes.options.document')],
                            ['question', t('cards.courseContentTypes.options.question')],
                            ['quiz', t('cards.courseContentTypes.options.quiz')],
                            ['assignment', t('cards.courseContentTypes.options.assignment')],
                            [
                                'jupyterNotebook',
                                t('cards.courseContentTypes.options.jupyterNotebook'),
                            ],
                            ['scratch', t('cards.courseContentTypes.options.scratch')],
                            ['audio', t('cards.courseContentTypes.options.audio')],
                            ['scorm', t('cards.courseContentTypes.options.scorm')],
                            ['assessment', t('cards.courseContentTypes.options.assessment')],
                        ] as const satisfies ReadonlyArray<
                            readonly [keyof Omit<CourseContentTypeSettings, 'video'>, string]
                        >
                    ).map(([key, label]) => (
                        <div
                            key={key}
                            className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
                        >
                            <div className="text-sm font-medium text-neutral-800">{label}</div>
                            <Switch
                                checked={settings.contentTypes?.[key] !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => {
                                        const base: CourseContentTypeSettings = {
                                            pdf: prev.contentTypes?.pdf ?? true,
                                            codeEditor: prev.contentTypes?.codeEditor ?? true,
                                            document: prev.contentTypes?.document ?? true,
                                            question: prev.contentTypes?.question ?? true,
                                            quiz: prev.contentTypes?.quiz ?? true,
                                            assignment: prev.contentTypes?.assignment ?? true,
                                            jupyterNotebook:
                                                prev.contentTypes?.jupyterNotebook ?? true,
                                            scratch: prev.contentTypes?.scratch ?? true,
                                            ppt: prev.contentTypes?.ppt ?? true,
                                            audio: prev.contentTypes?.audio ?? true,
                                            scorm: prev.contentTypes?.scorm ?? true,
                                            assessment: prev.contentTypes?.assessment ?? true,
                                            video: {
                                                enabled: prev.contentTypes?.video?.enabled ?? true,
                                                showInVideoQuestion:
                                                    prev.contentTypes?.video?.showInVideoQuestion ??
                                                    true,
                                            },
                                        };
                                        return {
                                            ...prev,
                                            contentTypes: {
                                                ...base,
                                                [key]: checked,
                                            },
                                        };
                                    })
                                }
                            />
                        </div>
                    ))}
                    <div className="space-y-2 rounded border p-3">
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-neutral-800">{t('cards.courseContentTypes.video')}</div>
                            <Switch
                                checked={settings.contentTypes?.video?.enabled !== false}
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => {
                                        const base: CourseContentTypeSettings = {
                                            pdf: prev.contentTypes?.pdf ?? true,
                                            codeEditor: prev.contentTypes?.codeEditor ?? true,
                                            document: prev.contentTypes?.document ?? true,
                                            question: prev.contentTypes?.question ?? true,
                                            quiz: prev.contentTypes?.quiz ?? true,
                                            assignment: prev.contentTypes?.assignment ?? true,
                                            jupyterNotebook:
                                                prev.contentTypes?.jupyterNotebook ?? true,
                                            scratch: prev.contentTypes?.scratch ?? true,
                                            ppt: prev.contentTypes?.ppt ?? true,
                                            audio: prev.contentTypes?.audio ?? true,
                                            scorm: prev.contentTypes?.scorm ?? true,
                                            assessment: prev.contentTypes?.assessment ?? true,
                                            video: {
                                                enabled: prev.contentTypes?.video?.enabled ?? true,
                                                showInVideoQuestion:
                                                    prev.contentTypes?.video?.showInVideoQuestion ??
                                                    true,
                                            },
                                        };
                                        return {
                                            ...prev,
                                            contentTypes: {
                                                ...base,
                                                video: {
                                                    enabled: checked,
                                                    showInVideoQuestion:
                                                        base.video.showInVideoQuestion,
                                                },
                                            },
                                        };
                                    })
                                }
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="text-sm font-medium text-neutral-800">{t('cards.courseContentTypes.inVideoQuestionVisible')}</div>
                            <Switch
                                checked={
                                    settings.contentTypes?.video?.showInVideoQuestion !== false
                                }
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => {
                                        const base: CourseContentTypeSettings = {
                                            pdf: prev.contentTypes?.pdf ?? true,
                                            codeEditor: prev.contentTypes?.codeEditor ?? true,
                                            document: prev.contentTypes?.document ?? true,
                                            question: prev.contentTypes?.question ?? true,
                                            quiz: prev.contentTypes?.quiz ?? true,
                                            assignment: prev.contentTypes?.assignment ?? true,
                                            jupyterNotebook:
                                                prev.contentTypes?.jupyterNotebook ?? true,
                                            scratch: prev.contentTypes?.scratch ?? true,
                                            ppt: prev.contentTypes?.ppt ?? true,
                                            audio: prev.contentTypes?.audio ?? true,
                                            scorm: prev.contentTypes?.scorm ?? true,
                                            assessment: prev.contentTypes?.assessment ?? true,
                                            video: {
                                                enabled: prev.contentTypes?.video?.enabled ?? true,
                                                showInVideoQuestion:
                                                    prev.contentTypes?.video?.showInVideoQuestion ??
                                                    true,
                                            },
                                        };
                                        return {
                                            ...prev,
                                            contentTypes: {
                                                ...base,
                                                video: {
                                                    enabled: base.video.enabled,
                                                    showInVideoQuestion: checked,
                                                },
                                            },
                                        };
                                    })
                                }
                            />
                        </div>
                        {settings.contentTypes?.video?.enabled !== false && (
                            <>
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium text-neutral-800">
                                        {t('cards.courseContentTypes.canAddVideoQuestion')}
                                    </div>
                                    <Switch
                                        checked={settings.slideView?.showAddVideoQuestion !== false}
                                        onCheckedChange={(checked) =>
                                            updateSettings((prev) => ({
                                                ...prev,
                                                slideView: {
                                                    showCopyTo: prev.slideView?.showCopyTo ?? true,
                                                    showMoveTo: prev.slideView?.showMoveTo ?? true,
                                                    showDelete: prev.slideView?.showDelete ?? true,
                                                    showConvertToSplitScreen:
                                                        prev.slideView?.showConvertToSplitScreen ??
                                                        true,
                                                    showAddVideoQuestion: checked,
                                                },
                                            }))
                                        }
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-medium text-neutral-800">
                                        {t('cards.courseContentTypes.canConvertToSplitScreen')}
                                    </div>
                                    <Switch
                                        checked={
                                            settings.slideView?.showConvertToSplitScreen !== false
                                        }
                                        onCheckedChange={(checked) =>
                                            updateSettings((prev) => ({
                                                ...prev,
                                                slideView: {
                                                    showCopyTo: prev.slideView?.showCopyTo ?? true,
                                                    showMoveTo: prev.slideView?.showMoveTo ?? true,
                                                    showDelete: prev.slideView?.showDelete ?? true,
                                                    showAddVideoQuestion:
                                                        prev.slideView?.showAddVideoQuestion ?? true,
                                                    showConvertToSplitScreen: checked,
                                                },
                                            }))
                                        }
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </CardContent>
            </Card>
            </>
            )}

            <StudentSideViewSettingsCard
                options={STUDENT_SIDE_VIEW_OPTIONS}
                isShown={planRows.sideViewTab}
                settings={{
                    ...STUDENT_SIDE_VIEW_DEFAULTS,
                    ...settings.studentSideView,
                }}
                defaults={STUDENT_SIDE_VIEW_DEFAULTS}
                onChange={(next) =>
                    updateSettings((prev) => ({
                        ...prev,
                        studentSideView: next,
                    }))
                }
            />

            {planRows.card('learnerListColumns') && (
                <LearnerListColumnsCard
                    settings={settings.learnerListColumns}
                    onChange={(next) =>
                        updateSettings((prev) => ({
                            ...prev,
                            learnerListColumns: next,
                        }))
                    }
                />
            )}

            {/* Which custom fields are filter/sort controls on the list pages.
                Saved with the rest of this blob via the shared unsaved-changes bar.
                Note: the list pages read the institute-wide (admin) blob, so this
                panel mirrors the same card for consistency. */}
            <ListCustomFieldControlsCard
                value={settings.listCustomFieldControls}
                legacyLeadsFields={settings.leadsFilterCustomFields ?? []}
                onChange={(next) =>
                    updateSettings((prev) => ({
                        ...prev,
                        listCustomFieldControls: next,
                    }))
                }
                utmValue={settings.listUtmFilterControls}
                onUtmChange={(next) =>
                    updateSettings((prev) => ({
                        ...prev,
                        listUtmFilterControls: next,
                    }))
                }
            />

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.learnerManagement.title')}</CardTitle>
                    <CardDescription>{t('cards.learnerManagement.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {LEARNER_MANAGEMENT_OPTIONS.map(({ key, label }) => (
                        <div
                            key={key}
                            className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
                        >
                            <div className="text-sm font-medium text-neutral-800">{label}</div>
                            <Switch
                                checked={
                                    settings.learnerManagement?.[key] ??
                                    LEARNER_MANAGEMENT_DEFAULTS[key]
                                }
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        learnerManagement: {
                                            ...LEARNER_MANAGEMENT_DEFAULTS,
                                            ...prev.learnerManagement,
                                            [key]: checked,
                                        },
                                    }))
                                }
                            />
                        </div>
                    ))}
                </CardContent>
            </Card>

            {planRows.card('studentManagementActions') && (
                <StudentManagementActionsCard
                    settings={settings.studentManagementActions}
                    onChange={(next) =>
                        updateSettings((prev) => ({
                            ...prev,
                            studentManagementActions: next,
                        }))
                    }
                />
            )}
            </section>

            <section id="grp-access" className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.dashboardWidgets.title')}</CardTitle>
                    <CardDescription>{t('cards.dashboardWidgets.description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {(() => {
                        const sorted = settings.dashboard.widgets
                            .filter((w) => planRows.widget(w.id))
                            .sort((a, b) => a.order - b.order);

                        return sorted.map((w, idx) => (
                            <div key={w.id} className="flex items-center gap-3 rounded border p-3">
                                <div className="flex flex-col items-center gap-0.5">
                                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0}
                                        onClick={() => moveWidget(w.id, 'up')}>
                                        <ArrowUp className="h-3 w-3" />
                                    </Button>
                                    <span className="text-xs text-muted-foreground">{idx + 1}</span>
                                    <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === sorted.length - 1}
                                        onClick={() => moveWidget(w.id, 'down')}>
                                        <ArrowDown className="h-3 w-3" />
                                    </Button>
                                </div>
                                <div className="flex-1 text-sm font-medium">{w.id}</div>
                                <div className="flex items-center gap-2">
                                    <Switch
                                        checked={w.visible}
                                        onCheckedChange={(checked) =>
                                            updateSettings((prev) => ({
                                                ...prev,
                                                dashboard: {
                                                    widgets: prev.dashboard.widgets.map((x) =>
                                                        x.id === w.id
                                                            ? { ...x, visible: checked }
                                                            : x
                                                    ),
                                                },
                                            }))
                                        }
                                    />
                                    <span className="text-sm">{t('common.visible')}</span>
                                </div>
                            </div>
                        ));
                    })()}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.permissions.title')}</CardTitle>
                    <CardDescription>{t('cards.permissions.description')}</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(
                        [
                            [
                                'canViewInstituteDetails',
                                t('cards.permissions.options.canViewInstituteDetails'),
                            ],
                            [
                                'canEditInstituteDetails',
                                t('cards.permissions.options.canEditInstituteDetails'),
                            ],
                            [
                                'canViewProfileDetails',
                                t('cards.permissions.options.canViewProfileDetails'),
                            ],
                            [
                                'canEditProfileDetails',
                                t('cards.permissions.options.canEditProfileDetails'),
                            ],
                        ] as const
                    ).map(([key, label]) => (
                        <div
                            key={key}
                            className="flex items-center justify-between gap-4 border-b border-border py-3.5 last:border-b-0"
                        >
                            <div className="text-sm font-medium text-neutral-800">{label}</div>
                            <Switch
                                checked={
                                    settings.permissions[
                                        key as keyof DisplaySettingsData['permissions']
                                    ]
                                }
                                onCheckedChange={(checked) =>
                                    updateSettings((prev) => ({
                                        ...prev,
                                        permissions: {
                                            ...prev.permissions,
                                            [key as keyof DisplaySettingsData['permissions']]:
                                                checked,
                                        } as DisplaySettingsData['permissions'],
                                    }))
                                }
                                disabled={key === 'canEditInstituteDetails'}
                            />
                        </div>
                    ))}
                </CardContent>
            </Card>

            <TeamRoleVisibilityCard
                selfRoleName="TEACHER"
                visibleRoles={settings.teamManagement?.visibleRoles || {}}
                onChange={(next) =>
                    updateSettings((prev) => ({
                        ...prev,
                        teamManagement: { visibleRoles: next },
                    }))
                }
            />

            <Card>
                <CardHeader>
                    <CardTitle>{t('cards.postLoginRedirect.title')}</CardTitle>
                    <CardDescription>{t('cards.postLoginRedirect.description')}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="max-w-md">
                        <Label>{t('cards.postLoginRedirect.route')}</Label>
                        <Input
                            value={settings.postLoginRedirectRoute}
                            onChange={(e) =>
                                updateSettings((prev) => ({
                                    ...prev,
                                    postLoginRedirectRoute: e.target.value,
                                }))
                            }
                        />
                    </div>
                </CardContent>
            </Card>

            <SubOrgModuleCard
                settings={settings}
                onChange={(next) => updateSettings(() => next)}
                roleLabel="Teacher"
            />

            <AudienceAccessCard roleName="TEACHER" roleLabel="Teacher" />

            <CallNumberVisibilityCard roleName="TEACHER" roleLabel="Teacher" />
            </section>
            </SettingsSectionsLayout>

            <UnsavedChangesBar
                dirty={hasChanges}
                saving={isSaving}
                onSave={save}
                onDiscard={discardChanges}
            />
        </>
    );
}
