import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
    CatalogueFilterWizardSettings,
    CopiedSlideStatus,
    CourseSettingsData,
    DripConditionsSettings,
    EnrollmentNotificationsSettings,
    OfferPricingSettings,
} from '@/types/course-settings';
import {
    BookOpen,
    Eye,
    Users,
    FloppyDisk,
    Image,
    Play,
    List,
    Stack,
    ArrowCounterClockwise,
    Bell,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Separator } from '@/components/ui/separator';
import { DripConditionsCard } from './DripConditionsCard';
import { OfferPricingCard } from './OfferPricingCard';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

const DEFAULT_FILTER_WIZARD: CatalogueFilterWizardSettings = {
    enabled: false,
    steps: ['level'],
    mandatory: false,
};

const FILTER_WIZARD_STEP_TERMS = {
    level: [ContentTerms.Level, SystemTerms.Level],
    session: [ContentTerms.Session, SystemTerms.Session],
    tag: [ContentTerms.PopularTag, SystemTerms.PopularTag],
} as const;

interface CourseSettingsFormProps {
    settings: CourseSettingsData;
    onSave: (settings: CourseSettingsData) => void;
    isSaving: boolean;
}

export const CourseSettingsForm: React.FC<CourseSettingsFormProps> = ({
    settings,
    onSave,
    isSaving,
}) => {
    const { t } = useTranslation('settingsCourseForm');
    const [formData, setFormData] = useState<CourseSettingsData>(settings);
    const [hasChanges, setHasChanges] = useState(false);

    // Update form data when settings prop changes
    useEffect(() => {
        setFormData(settings);
        setHasChanges(false);
    }, [settings]);

    // Check for changes when form data updates
    useEffect(() => {
        const changed = JSON.stringify(formData) !== JSON.stringify(settings);
        setHasChanges(changed);
    }, [formData, settings]);

    const handleSave = () => {
        onSave(formData);
        setHasChanges(false);
    };

    const resetAllToDefault = () => {
        setFormData(settings);
        setHasChanges(false);
    };

    const updateCourseInformation = (
        key: keyof typeof formData.courseInformation,
        value: boolean
    ) => {
        setFormData((prev) => ({
            ...prev,
            courseInformation: {
                ...prev.courseInformation,
                [key]: value,
            },
        }));
    };

    const updateCourseStructure = (
        key: keyof typeof formData.courseStructure,
        value: boolean | number
    ) => {
        setFormData((prev) => ({
            ...prev,
            courseStructure: {
                ...prev.courseStructure,
                [key]: value,
            },
        }));
    };

    const updateCatalogueSettings = (
        key: keyof typeof formData.catalogueSettings,
        value: boolean | string
    ) => {
        setFormData((prev) => ({
            ...prev,
            catalogueSettings: {
                ...prev.catalogueSettings,
                [key]: value,
            },
        }));
    };

    const updateFilterWizard = <K extends keyof CatalogueFilterWizardSettings>(
        key: K,
        value: CatalogueFilterWizardSettings[K]
    ) => {
        setFormData((prev) => ({
            ...prev,
            catalogueSettings: {
                ...prev.catalogueSettings,
                filterWizard: {
                    ...DEFAULT_FILTER_WIZARD,
                    ...prev.catalogueSettings.filterWizard,
                    [key]: value,
                },
            },
        }));
    };

    const toggleFilterWizardStep = (step: 'level' | 'session' | 'tag') => {
        const current = formData.catalogueSettings.filterWizard?.steps ?? DEFAULT_FILTER_WIZARD.steps;
        const next = current.includes(step)
            ? current.filter((s) => s !== step)
            : [...current, step];
        updateFilterWizard('steps', next);
    };

    const updateCourseViewSettings = <K extends keyof CourseSettingsData['courseViewSettings']>(
        key: K,
        value: CourseSettingsData['courseViewSettings'][K]
    ) => {
        setFormData((prev) => ({
            ...prev,
            courseViewSettings: {
                ...prev.courseViewSettings,
                [key]: value,
            },
        }));
    };

    const updateOutlineSettings = (
        key: keyof typeof formData.outlineSettings,
        value: 'expanded' | 'collapsed'
    ) => {
        setFormData((prev) => ({
            ...prev,
            outlineSettings: {
                ...prev.outlineSettings,
                [key]: value,
            },
        }));
    };

    const updateCopiedSlideStatus = (value: CopiedSlideStatus) => {
        setFormData((prev) => ({
            ...prev,
            copiedSlideStatus: value,
        }));
    };

    const updatePermissions = (
        key: keyof typeof formData.permissions,
        value: boolean | 'PARENTS_ONLY' | 'CHILDREN_ONLY' | null
    ) => {
        setFormData((prev) => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [key]: value,
            },
        }));
    };

    const updateDripConditions = (dripConditions: DripConditionsSettings) => {
        setFormData((prev) => ({
            ...prev,
            dripConditions,
        }));
    };

    const updateOfferPricing = (offerPricing: OfferPricingSettings) => {
        setFormData((prev) => ({
            ...prev,
            offerPricing,
        }));
    };

    const updateEnrollmentNotifications = (
        key: keyof EnrollmentNotificationsSettings,
        value: boolean
    ) => {
        setFormData((prev) => ({
            ...prev,
            enrollmentNotifications: {
                showNotifyLearners:
                    prev.enrollmentNotifications?.showNotifyLearners ?? true,
                showSendCredentials:
                    prev.enrollmentNotifications?.showSendCredentials ?? true,
                [key]: value,
            },
        }));
    };

    return (
        <div className="space-y-6 p-2">
            {/* Header with Save Button */}
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    {/* Empty div to maintain layout - title already shown in parent */}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={resetAllToDefault} disabled={isSaving}>
                        <ArrowCounterClockwise className="me-2 size-4" />
                        {t('actions.resetAll')}
                    </Button>
                    <MyButton
                        onClick={handleSave}
                        disabled={isSaving || !hasChanges}
                        className="bg-primary-500"
                    >
                        <FloppyDisk className="me-2 size-4" />
                        {isSaving ? t('actions.saving') : t('actions.saveChanges')}
                    </MyButton>
                </div>
            </div>

            {/* Unsaved Changes Warning */}
            {hasChanges && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm text-amber-800">{t('unsavedChanges')}</p>
                </div>
            )}

            <div className="grid gap-6">
                {/* Course Information Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <BookOpen className="size-5 text-blue-600" />
                            {t('courseInformation.heading')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="description-required"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('courseInformation.descriptionRequired')}</span>
                                </Label>
                                <Switch
                                    id="description-required"
                                    checked={formData.courseInformation.descriptionRequired}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('descriptionRequired', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="popular-topics" className="flex items-center gap-2">
                                    <span>{t('courseInformation.enablePopularTopics')}</span>
                                </Label>
                                <Switch
                                    id="popular-topics"
                                    checked={formData.courseInformation.popularTopicsEnabled}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('popularTopicsEnabled', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="learner-outcomes"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('courseInformation.learnerOutcomesRequired')}</span>
                                </Label>
                                <Switch
                                    id="learner-outcomes"
                                    checked={formData.courseInformation.learnerOutcomesRequired}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('learnerOutcomesRequired', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="about-course" className="flex items-center gap-2">
                                    <span>{t('courseInformation.aboutCourseRequired')}</span>
                                </Label>
                                <Switch
                                    id="about-course"
                                    checked={formData.courseInformation.aboutCourseRequired}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('aboutCourseRequired', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="target-audience"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('courseInformation.targetAudienceRequired')}</span>
                                </Label>
                                <Switch
                                    id="target-audience"
                                    checked={formData.courseInformation.targetAudienceRequired}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('targetAudienceRequired', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="preview-image" className="flex items-center gap-2">
                                    <Image className="size-4" />
                                    <span>{t('courseInformation.previewImageRequired')}</span>
                                </Label>
                                <Switch
                                    id="preview-image"
                                    checked={formData.courseInformation.previewImageRequired}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('previewImageRequired', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="banner-enabled" className="flex items-center gap-2">
                                    <Image className="size-4" />
                                    <span>{t('courseInformation.enableBannerImage')}</span>
                                </Label>
                                <Switch
                                    id="banner-enabled"
                                    checked={formData.courseInformation.bannerImageEnabled}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('bannerImageEnabled', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="banner-required"
                                    className="flex items-center gap-2"
                                >
                                    <Image className="size-4" />
                                    <span>{t('courseInformation.bannerImageRequired')}</span>
                                </Label>
                                <Switch
                                    id="banner-required"
                                    checked={formData.courseInformation.bannerImageRequired}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('bannerImageRequired', value)
                                    }
                                    disabled={!formData.courseInformation.bannerImageEnabled}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="course-media" className="flex items-center gap-2">
                                    <Play className="size-4" />
                                    <span>{t('courseInformation.enableCourseMedia')}</span>
                                </Label>
                                <Switch
                                    id="course-media"
                                    checked={formData.courseInformation.courseMediaEnabled}
                                    onCheckedChange={(value) =>
                                        updateCourseInformation('courseMediaEnabled', value)
                                    }
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Course Structure Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Stack className="size-5 text-green-600" />
                            {t('courseStructure.heading')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="default-depth">{t('courseStructure.defaultDepth')}</Label>
                                <Select
                                    value={formData.courseStructure.defaultDepth.toString()}
                                    onValueChange={(value) =>
                                        updateCourseStructure('defaultDepth', parseInt(value))
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="2">
                                            {t('courseStructure.depthOption', { count: 2 })}
                                        </SelectItem>
                                        <SelectItem value="3">
                                            {t('courseStructure.depthOption', { count: 3 })}
                                        </SelectItem>
                                        <SelectItem value="4">
                                            {t('courseStructure.depthOption', { count: 4 })}
                                        </SelectItem>
                                        <SelectItem value="5">
                                            {t('courseStructure.depthOption', { count: 5 })}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="fix-depth" className="flex items-center gap-2">
                                    <span>{t('courseStructure.fixCourseDepth')}</span>
                                </Label>
                                <Switch
                                    id="fix-depth"
                                    checked={formData.courseStructure.fixCourseDepth}
                                    onCheckedChange={(value) =>
                                        updateCourseStructure('fixCourseDepth', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="enable-sessions"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('courseStructure.enableSessions')}</span>
                                </Label>
                                <Switch
                                    id="enable-sessions"
                                    checked={formData.courseStructure.enableSessions}
                                    onCheckedChange={(value) =>
                                        updateCourseStructure('enableSessions', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="enable-levels" className="flex items-center gap-2">
                                    <span>{t('courseStructure.enableLevels')}</span>
                                </Label>
                                <Switch
                                    id="enable-levels"
                                    checked={formData.courseStructure.enableLevels}
                                    onCheckedChange={(value) =>
                                        updateCourseStructure('enableLevels', value)
                                    }
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Catalogue Settings Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <List className="size-5 text-purple-600" />
                            {t('catalogueSettings.heading')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="catalogue-mode">{t('catalogueSettings.catalogueMode')}</Label>
                                <Select
                                    value={formData.catalogueSettings.catalogueMode}
                                    onValueChange={(value) =>
                                        updateCatalogueSettings('catalogueMode', value)
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ask">{t('catalogueSettings.modeAsk')}</SelectItem>
                                        <SelectItem value="auto">{t('catalogueSettings.modeAuto')}</SelectItem>
                                        <SelectItem value="manual">{t('catalogueSettings.modeManual')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="auto-publish" className="flex items-center gap-2">
                                    <span>{t('catalogueSettings.autoPublish')}</span>
                                </Label>
                                <Switch
                                    id="auto-publish"
                                    checked={formData.catalogueSettings.autoPublishToCatalogue}
                                    onCheckedChange={(value) =>
                                        updateCatalogueSettings('autoPublishToCatalogue', value)
                                    }
                                />
                            </div>
                        </div>

                        <Separator />

                        <div className="space-y-3">
                            <div className="flex items-center justify-between gap-4">
                                <div className="space-y-1">
                                    <Label htmlFor="filter-wizard-enabled">
                                        {t('catalogueSettings.filterWizard.heading')}
                                    </Label>
                                    <p className="text-caption text-neutral-500">
                                        {t('catalogueSettings.filterWizard.description')}
                                    </p>
                                </div>
                                <Switch
                                    id="filter-wizard-enabled"
                                    checked={formData.catalogueSettings.filterWizard?.enabled ?? false}
                                    onCheckedChange={(value) => updateFilterWizard('enabled', value)}
                                />
                            </div>

                            {formData.catalogueSettings.filterWizard?.enabled && (
                                <div className="space-y-4 rounded-lg border border-neutral-200 p-3">
                                    <div className="space-y-2">
                                        <Label>{t('catalogueSettings.filterWizard.stepsToAsk')}</Label>
                                        <div className="flex flex-wrap gap-4">
                                            {(['level', 'session', 'tag'] as const).map((step) => {
                                                const [contentTerm, systemTerm] =
                                                    FILTER_WIZARD_STEP_TERMS[step];
                                                const label = getTerminology(contentTerm, systemTerm);
                                                return (
                                                    <div key={step} className="flex items-center gap-2">
                                                        <Checkbox
                                                            id={`filter-wizard-step-${step}`}
                                                            checked={(
                                                                formData.catalogueSettings.filterWizard
                                                                    ?.steps ?? DEFAULT_FILTER_WIZARD.steps
                                                            ).includes(step)}
                                                            onCheckedChange={() =>
                                                                toggleFilterWizardStep(step)
                                                            }
                                                        />
                                                        <Label
                                                            htmlFor={`filter-wizard-step-${step}`}
                                                            className="text-sm font-normal"
                                                        >
                                                            {label}
                                                        </Label>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {t('catalogueSettings.filterWizard.order', {
                                                level: getTerminology(
                                                    ContentTerms.Level,
                                                    SystemTerms.Level
                                                ),
                                                session: getTerminology(
                                                    ContentTerms.Session,
                                                    SystemTerms.Session
                                                ),
                                                tag: getTerminology(
                                                    ContentTerms.PopularTag,
                                                    SystemTerms.PopularTag
                                                ),
                                            })}
                                        </p>
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <Label
                                            htmlFor="filter-wizard-mandatory"
                                            className="flex items-center gap-2"
                                        >
                                            <span>{t('catalogueSettings.filterWizard.requireCompletion')}</span>
                                        </Label>
                                        <Switch
                                            id="filter-wizard-mandatory"
                                            checked={
                                                formData.catalogueSettings.filterWizard?.mandatory ??
                                                false
                                            }
                                            onCheckedChange={(value) =>
                                                updateFilterWizard('mandatory', value)
                                            }
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* View Settings Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Eye className="size-5 text-orange-600" />
                            {t('viewSettings.heading')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="default-view">{t('viewSettings.defaultViewMode')}</Label>
                                <Select
                                    value={formData.courseViewSettings.defaultViewMode}
                                    onValueChange={(value) =>
                                        updateCourseViewSettings(
                                            'defaultViewMode',
                                            value as 'outline' | 'structure'
                                        )
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="outline">
                                            {t('viewSettings.outlineMode')}
                                        </SelectItem>
                                        <SelectItem value="structure">
                                            {t('viewSettings.structureMode')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="outline-state">{t('viewSettings.defaultOutlineState')}</Label>
                                <Select
                                    value={formData.outlineSettings.defaultState}
                                    onValueChange={(value) =>
                                        updateOutlineSettings(
                                            'defaultState',
                                            value as 'expanded' | 'collapsed'
                                        )
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="expanded">
                                            {t('viewSettings.expanded')}
                                        </SelectItem>
                                        <SelectItem value="collapsed">
                                            {t('viewSettings.collapsed')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="copied-slide-status">
                                    {t('viewSettings.copiedSlideStatus')}
                                </Label>
                                <Select
                                    value={formData.copiedSlideStatus ?? 'KEEP_DRAFT'}
                                    onValueChange={(value) =>
                                        updateCopiedSlideStatus(value as CopiedSlideStatus)
                                    }
                                >
                                    <SelectTrigger id="copied-slide-status">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="KEEP_DRAFT">
                                            {t('viewSettings.keepDraft')}
                                        </SelectItem>
                                        <SelectItem value="INHERIT_SOURCE">
                                            {t('viewSettings.inheritSource')}
                                        </SelectItem>
                                        <SelectItem value="ALWAYS_PUBLISHED">
                                            {t('viewSettings.alwaysPublished')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-caption text-neutral-500">
                                    {t('viewSettings.copiedSlideDescription')}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="show-content-descriptions">
                                    {t('viewSettings.showContentDescriptions')}
                                </Label>
                                <p className="text-caption text-neutral-500">
                                    {t('viewSettings.showContentDescriptionsHint')}
                                </p>
                            </div>
                            <Switch
                                id="show-content-descriptions"
                                checked={
                                    formData.courseViewSettings.showContentDescriptions !== false
                                }
                                onCheckedChange={(value) =>
                                    updateCourseViewSettings('showContentDescriptions', value)
                                }
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Permissions Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Users className="size-5 text-red-600" />
                            {t('permissions.heading')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="learners-create"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('permissions.allowLearnersCreate')}</span>
                                </Label>
                                <Switch
                                    id="learners-create"
                                    checked={formData.permissions.allowLearnersToCreateCourses}
                                    onCheckedChange={(value) =>
                                        updatePermissions('allowLearnersToCreateCourses', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label htmlFor="payment-change" className="flex items-center gap-2">
                                    <span>{t('permissions.allowPaymentChange')}</span>
                                </Label>
                                <Switch
                                    id="payment-change"
                                    checked={formData.permissions.allowPaymentOptionChange}
                                    onCheckedChange={(value) =>
                                        updatePermissions('allowPaymentOptionChange', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="discount-change"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('permissions.allowDiscountChange')}</span>
                                </Label>
                                <Switch
                                    id="discount-change"
                                    checked={formData.permissions.allowDiscountOptionChange}
                                    onCheckedChange={(value) =>
                                        updatePermissions('allowDiscountOptionChange', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="referral-change"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('permissions.allowReferralChange')}</span>
                                </Label>
                                <Switch
                                    id="referral-change"
                                    checked={formData.permissions.allowReferralOptionChange}
                                    onCheckedChange={(value) =>
                                        updatePermissions('allowReferralOptionChange', value)
                                    }
                                />
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <Label
                                    htmlFor="course-filter-type"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('permissions.defaultCourseFilter')}</span>
                                </Label>
                                <Select
                                    value={
                                        formData.permissions.courseFilterType === 'PARENTS_ONLY' ||
                                        formData.permissions.courseFilterType === 'CHILDREN_ONLY'
                                            ? formData.permissions.courseFilterType
                                            : 'ALL'
                                    }
                                    onValueChange={(value) => {
                                        if (value === 'ALL') {
                                            updatePermissions('courseFilterType', null);
                                        } else {
                                            updatePermissions(
                                                'courseFilterType',
                                                value as 'PARENTS_ONLY' | 'CHILDREN_ONLY'
                                            );
                                        }
                                    }}
                                >
                                    <SelectTrigger id="course-filter-type" className="w-full max-w-xs">
                                        <SelectValue placeholder={t('permissions.selectDefaultFilter')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">{t('permissions.filterAll')}</SelectItem>
                                        <SelectItem value="PARENTS_ONLY">
                                            {t('permissions.filterParentsOnly')}
                                        </SelectItem>
                                        <SelectItem value="CHILDREN_ONLY">
                                            {t('permissions.filterChildrenOnly')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    {t('permissions.filterHint')}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Drip Conditions Section */}
                <DripConditionsCard
                    settings={formData.dripConditions}
                    onUpdate={updateDripConditions}
                />

                {/* Offer Pricing Section */}
                <OfferPricingCard
                    settings={formData.offerPricing ?? { enabled: false }}
                    onUpdate={updateOfferPricing}
                />

                {/* Enrollment Notifications Section */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Bell size={20} weight="duotone" className="text-primary-500" />
                            {t('enrollmentNotifications.heading')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            {t('enrollmentNotifications.description')}
                        </p>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="show-notify-learners"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('enrollmentNotifications.showNotifyLearners')}</span>
                                </Label>
                                <Switch
                                    id="show-notify-learners"
                                    checked={
                                        formData.enrollmentNotifications?.showNotifyLearners ??
                                        true
                                    }
                                    onCheckedChange={(value) =>
                                        updateEnrollmentNotifications('showNotifyLearners', value)
                                    }
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Label
                                    htmlFor="show-send-credentials"
                                    className="flex items-center gap-2"
                                >
                                    <span>{t('enrollmentNotifications.showSendCredentials')}</span>
                                </Label>
                                <Switch
                                    id="show-send-credentials"
                                    checked={
                                        formData.enrollmentNotifications?.showSendCredentials ??
                                        true
                                    }
                                    onCheckedChange={(value) =>
                                        updateEnrollmentNotifications(
                                            'showSendCredentials',
                                            value
                                        )
                                    }
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Separator />

            <div className="text-sm text-muted-foreground">
                <p>
                    <strong>{t('footerNote.label')}</strong> {t('footerNote.text')}
                </p>
            </div>
        </div>
    );
};
