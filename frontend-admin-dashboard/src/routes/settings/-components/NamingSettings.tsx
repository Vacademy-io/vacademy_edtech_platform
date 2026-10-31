'use client';

import { useState, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { FloppyDisk, ArrowCounterClockwise, GearSix } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import useLocalStorage from '@/hooks/use-local-storage';
import { notifyNamingSettingsUpdated } from '@/hooks/useNamingSettingsVersion';
import {
    createNamingSettings,
    updateNamingSettings,
    getNamingSettings,
    type NamingSettingsRequest,
} from '@/services/naming-settings';
import { StorageKey } from '@/constants/storage/storage';
import { isNullOrEmptyOrUndefined } from '@/lib/utils';
import {
    CONTENT_TERMS,
    defaultNamingSettings,
    NamingSettingsType,
    OTHER_TERMS,
    ROLE_TERMS,
    systemValueDescription,
} from '../-constants/terms';
import { toast } from 'sonner';

export enum ContentTerms {
    Course = 'Course',
    Level = 'Level',
    Session = 'Session',
    Subject = 'Subject',
    Module = 'Module',
    Chapter = 'Chapter',
    Slide = 'Slide',
    LiveSession = 'LiveSession',
    Batch = 'Batch',
    Package = 'Package',
    PopularTag = 'PopularTag',
    /** @deprecated Use ContentTerms.Subject instead */
    Subjects = 'Subject',
    /** @deprecated Use ContentTerms.Module instead */
    Modules = 'Module',
    /** @deprecated Use ContentTerms.Chapter instead */
    Chapters = 'Chapter',
    /** @deprecated Use ContentTerms.Slide instead */
    Slides = 'Slide',
}

export enum RoleTerms {
    Admin = 'Admin',
    Teacher = 'Teacher',
    CourseCreator = 'CourseCreator',
    AssessmentCreator = 'AssessmentCreator',
    Evaluator = 'Evaluator',
    Learner = 'Learner',
}

export enum OtherTerms {
    AudienceList = 'AudienceList',
    Invite = 'Invite',
    Inventory = 'Inventory',
    SubOrg = 'SubOrg',
}

export enum SystemTerms {
    Course = 'Course',
    Level = 'Level',
    Session = 'Session',
    Subject = 'Subject',
    Module = 'Module',
    Chapter = 'Chapter',
    Slide = 'Slide',
    LiveSession = 'Live Session',
    Batch = 'Batch',
    Package = 'Package',
    Admin = 'Admin',
    Teacher = 'Teacher',
    CourseCreator = 'Course Creator',
    AssessmentCreator = 'Assessment Creator',
    Evaluator = 'Evaluator',
    Learner = 'Learner',
    PopularTag = 'Popular Tag',
    AudienceList = 'Audience List',
    Invite = 'Invite',
    Inventory = 'Inventory',
    SubOrg = 'Sub-Org',
    /** @deprecated Use SystemTerms.Subject instead */
    Subjects = 'Subject',
    /** @deprecated Use SystemTerms.Module instead */
    Modules = 'Module',
    /** @deprecated Use SystemTerms.Chapter instead */
    Chapters = 'Chapter',
    /** @deprecated Use SystemTerms.Slide instead */
    Slides = 'Slide',
}

const createNameRequest = (settings: NamingSettingsType[]): NamingSettingsRequest => {
    const request: Partial<NamingSettingsRequest> = {};
    settings.forEach((item) => {
        let backendKey = item.key;
        if (item.key === 'Subject') backendKey = 'Subjects';
        if (item.key === 'Module') backendKey = 'Modules';
        if (item.key === 'Chapter') backendKey = 'Chapters';
        if (item.key === 'Slide') backendKey = 'Slides';
        if (item.key === 'Learner') backendKey = 'Student';

        (request as Record<string, string>)[backendKey] = item.customValue;
        (request as Record<string, string>)[`${backendKey}_plural`] = item.customPluralValue;

        // Also keep original key just in case backend supports both or dynamic
        if (backendKey !== item.key) {
            (request as Record<string, string>)[item.key] = item.customValue;
            (request as Record<string, string>)[`${item.key}_plural`] = item.customPluralValue;
        }
    });
    return request as unknown as NamingSettingsRequest;
};

/**
 * Overlay a saved/cached term list onto the full default catalog so newly-added
 * default terms (e.g. Sub-Org) always show up — even when the persisted or
 * localStorage blob predates them. Keeps every default key, uses the saved
 * custom value where present, else the default.
 */
const mergeWithDefaults = (
    saved: NamingSettingsType[] | null | undefined
): NamingSettingsType[] =>
    defaultNamingSettings.map((defaultItem) => {
        const match = Array.isArray(saved)
            ? saved.find((s) => s.key === defaultItem.key)
            : undefined;
        return {
            ...defaultItem,
            customValue: match?.customValue ?? defaultItem.customValue,
            customPluralValue: match?.customPluralValue ?? defaultItem.customPluralValue,
        };
    });

export default function NamingSettings() {
    const { t } = useTranslation('settingsNaming');
    const [settings, setSettings] = useState<NamingSettingsType[] | null>(null);
    const { getValue: getNamingSettingsStorage, setValue: setNamingSettingsStorage } = useLocalStorage<
        NamingSettingsType[]
    >(StorageKey.NAMING_SETTINGS, []);

    const [isLoading, setIsLoading] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Initialize settings from Backend
    useEffect(() => {
        const initializeSettings = async () => {
            // 1. First, check local storage for immediate render (better UX)
            const savedSettings = getNamingSettingsStorage();
            if (Array.isArray(savedSettings) && savedSettings.length > 0) {
                // Merge so a cache saved before a new term existed still shows it.
                setSettings(mergeWithDefaults(savedSettings));
            }

            try {
                // 2. Always fetch fresh data from the backend
                const backendSettings = await getNamingSettings();

                if (backendSettings && Array.isArray(backendSettings)) {
                    // Map backend array to UI array
                    const settingsArray: NamingSettingsType[] = defaultNamingSettings.map((defaultItem) => {
                        let customValue = defaultItem.systemValue;
                        let customPluralValue = defaultItem.systemPluralValue;

                        // Helper to find item in backend array
                        const findInBackend = (key: string) => backendSettings.find(i => i.key === key);

                        // 1. Try exact match
                        let foundItem = findInBackend(defaultItem.key);
                        let foundPluralItem = findInBackend(`${defaultItem.key}_plural`);

                        // 2. If not found, try plural/alias mappings
                        if (!foundItem) {
                            if (defaultItem.key === 'Subject') foundItem = findInBackend('Subjects') || findInBackend('Subject');
                            else if (defaultItem.key === 'Module') foundItem = findInBackend('Modules') || findInBackend('Module');
                            else if (defaultItem.key === 'Chapter') foundItem = findInBackend('Chapters') || findInBackend('Chapter');
                            else if (defaultItem.key === 'Slide') foundItem = findInBackend('Slides') || findInBackend('Slide');
                            else if (defaultItem.key === 'Learner') foundItem = findInBackend('Student') || findInBackend('Learner');
                        }

                        if (!foundPluralItem) {
                            if (defaultItem.key === 'Subject') foundPluralItem = findInBackend('Subjects_plural');
                            else if (defaultItem.key === 'Module') foundPluralItem = findInBackend('Modules_plural');
                            else if (defaultItem.key === 'Chapter') foundPluralItem = findInBackend('Chapters_plural');
                            else if (defaultItem.key === 'Slide') foundPluralItem = findInBackend('Slides_plural');
                            else if (defaultItem.key === 'Learner') foundPluralItem = findInBackend('Student_plural');
                        }

                        // 3. If found, use its custom value
                        if (foundItem) {
                            customValue = foundItem.customValue;
                        }
                        if (foundPluralItem) {
                            customPluralValue = foundPluralItem.customValue;
                        }

                        return {
                            ...defaultItem,
                            customValue,
                            customPluralValue,
                        };
                    });

                    setSettings(settingsArray);
                    setNamingSettingsStorage(settingsArray);
                } else {
                    // API returned nothing: fall back to any cached customizations,
                    // merged onto defaults so new terms (e.g. Sub-Org) still appear.
                    setSettings(mergeWithDefaults(savedSettings));
                }
            } catch (error) {
                console.error('Failed to initialize naming settings:', error);
                // If API fails, rely on local storage or defaults
                if (!savedSettings || savedSettings.length === 0) {
                    setSettings(defaultNamingSettings);
                }
                toast.error(t('toasts.syncFailed'));
            }
        };

        initializeSettings();
    }, []);

    const handleCustomValueChange = (key: string, newValue: string) => {
        if (!settings) return;

        const updatedSettings = settings.map((item) =>
            item.key === key ? { ...item, customValue: newValue } : item
        );

        setSettings(updatedSettings);
        setHasChanges(true);
    };

    const handlePluralValueChange = (key: string, newValue: string) => {
        if (!settings) return;

        const updatedSettings = settings.map((item) =>
            item.key === key ? { ...item, customPluralValue: newValue } : item
        );

        setSettings(updatedSettings);
        setHasChanges(true);
    };

    const resetToDefault = (key: string) => {
        if (!settings) return;

        const item = settings.find((item) => item.key === key);
        if (item) {
            handleCustomValueChange(key, item.systemValue);
            handlePluralValueChange(key, item.systemPluralValue);
        }
    };

    const resetAllToDefault = async () => {
        if (!settings) return;

        const updatedSettings = settings.map((item) => ({
            ...item,
            customValue: item.systemValue,
            customPluralValue: item.systemPluralValue,
        }));

        setSettings(updatedSettings);
        setHasChanges(true);
    };

    const saveSettings = async () => {
        if (!settings) return;

        setIsLoading(true);
        try {
            // Call the update API
            const nameRequest = createNameRequest(settings);
            await updateNamingSettings(nameRequest);

            // Save to localStorage
            setNamingSettingsStorage(settings);
            notifyNamingSettingsUpdated();
            setHasChanges(false);
            toast.success(t('toasts.settingsSaved'));
        } catch (error) {
            console.error('Failed to save settings:', error);
            toast.error(t('toasts.saveFailed'));
        } finally {
            setIsLoading(false);
        }
    };

    if (!settings) {
        return <div className="flex items-center justify-center p-8">{t('loading')}</div>;
    }

    const terminologyData = settings;

    // Group terminology by category
    const contentTerms = terminologyData.filter((item) =>
        (CONTENT_TERMS as readonly string[]).includes(item.key)
    );
    const roleTerms = terminologyData.filter((item) =>
        (ROLE_TERMS as readonly string[]).includes(item.key)
    );
    const otherTerms = terminologyData.filter((item) =>
        (OTHER_TERMS as readonly string[]).includes(item.key)
    );

    return (
        <div className=" space-y-6 p-2">
            <div className="flex items-center justify-between">
                <div className="space-y-1">
                    <h1 className="flex items-center gap-2 text-lg font-bold">
                        <GearSix className="size-6" />
                        {t('header.title')}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {t('header.description')}
                        <br />
                        <span className="text-xs  text-primary-500">
                            {t('header.singularHint')}
                        </span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={resetAllToDefault} disabled={isLoading}>
                        <ArrowCounterClockwise className="mr-2 size-4" />
                        {t('actions.resetAll')}
                    </Button>
                    <MyButton
                        onClick={saveSettings}
                        disabled={isLoading || !hasChanges}
                        className="bg-primary-500"
                    >
                        <FloppyDisk className="mr-2 size-4" />
                        {isLoading ? t('actions.saving') : t('actions.saveChanges')}
                    </MyButton>
                </div>
            </div>

            {hasChanges && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm text-amber-800">{t('unsavedChangesBanner')}</p>
                </div>
            )}

            <div className="grid gap-6">
                {/* Reusable term row renderer */}
                {[
                    {
                        title: t('sections.contentStructure.title'),
                        description: t('sections.contentStructure.description'),
                        terms: contentTerms,
                    },
                    {
                        title: t('sections.userRoles.title'),
                        description: t('sections.userRoles.description'),
                        terms: roleTerms,
                    },
                    {
                        title: t('sections.other.title'),
                        description: t('sections.other.description'),
                        terms: otherTerms,
                    },
                ].map((section) => (
                    <Card key={section.title}>
                        <CardHeader>
                            <CardTitle>{section.title}</CardTitle>
                            <CardDescription>{section.description}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {section.terms.map((item) => (
                                <div
                                    key={item.key}
                                    className="grid grid-cols-1 items-center gap-4 rounded-lg border p-4 md:grid-cols-[1fr_1fr_1fr_auto]"
                                >
                                    <div className="space-y-1">
                                        <Label className="text-sm font-medium">
                                            {item.systemValue}
                                        </Label>
                                        <div className="flex items-center gap-2">
                                            <Badge
                                                variant="secondary"
                                                className="text-xs text-muted-foreground"
                                            >
                                                {
                                                    systemValueDescription[
                                                    item.key as keyof typeof systemValueDescription
                                                    ]
                                                }
                                            </Badge>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor={`custom-${item.key}`} className="text-sm">
                                            {t('row.singular')}
                                        </Label>
                                        <Input
                                            id={`custom-${item.key}`}
                                            value={item.customValue}
                                            onChange={(e) =>
                                                handleCustomValueChange(item.key, e.target.value)
                                            }
                                            placeholder={item.systemValue}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor={`plural-${item.key}`} className="text-sm">
                                            {t('row.plural')}
                                        </Label>
                                        <Input
                                            id={`plural-${item.key}`}
                                            value={item.customPluralValue}
                                            onChange={(e) =>
                                                handlePluralValueChange(item.key, e.target.value)
                                            }
                                            placeholder={item.systemPluralValue}
                                        />
                                    </div>
                                    <div className="flex justify-end pt-6">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => resetToDefault(item.key)}
                                            disabled={
                                                item.customValue === item.systemValue &&
                                                item.customPluralValue === item.systemPluralValue
                                            }
                                        >
                                            <ArrowCounterClockwise className="mr-1 size-3" />
                                            {t('row.reset')}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Separator />

            <div className="text-sm text-muted-foreground">
                <p>
                    <Trans i18nKey="settingsNaming:footerNote">
                        <strong>Note:</strong> Changes will be applied across your entire institute
                        once saved. All users will see the updated terminology in their interface.
                    </Trans>
                </p>
            </div>
        </div>
    );
}
