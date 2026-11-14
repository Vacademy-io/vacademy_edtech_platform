import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PackageCourseSettingEditor } from './PackageCourseSettingEditor';
import { LmsSettingsCard } from './LmsSettingsCard';
import { LmsExistingUserPolicyCard } from './LmsExistingUserPolicyCard';
import { LeadConversionCard } from './LeadConversionCard';
import { CourseWorkflowTriggersCard } from './CourseWorkflowTriggersCard';
import { SubOrgAssociatedCard } from './SubOrgAssociatedCard';

interface PackageSettingsPanelProps {
    packageId: string;
}

/**
 * Course-level (package) settings, shown in the course-details "Settings" tab as two horizontal
 * tabs: LMS Integration (the friendly connection + workflow setup, default) and Advanced
 * Settings (the raw course_setting JSON editor).
 */
export const PackageSettingsPanel: React.FC<PackageSettingsPanelProps> = ({ packageId }) => {
    const { t } = useTranslation('studyLibraryPackageSettingsPanel');
    // Bumped after a JSON save so the LMS card re-derives its state.
    const [refreshKey, setRefreshKey] = useState(0);

    if (!packageId) {
        return (
            <div className="p-6 text-sm text-muted-foreground">
                {t('saveCourseFirst')}
            </div>
        );
    }

    return (
        <div className="p-2">
            <Tabs defaultValue="lms" className="w-full">
                <TabsList>
                    <TabsTrigger value="lms">{t('tabs.lms')}</TabsTrigger>
                    <TabsTrigger value="leads">{t('tabs.leads')}</TabsTrigger>
                    <TabsTrigger value="workflows">{t('tabs.workflows')}</TabsTrigger>
                    <TabsTrigger value="suborg">{t('tabs.suborg')}</TabsTrigger>
                    <TabsTrigger value="json">{t('tabs.json')}</TabsTrigger>
                </TabsList>
                {/* key={packageId} remounts the cards when you switch courses, so prefilled
                    connection/courseId/triggers never leak from a previously-open course. */}
                <TabsContent value="lms" className="mt-4 space-y-4">
                    <LmsSettingsCard
                        key={packageId}
                        packageId={packageId}
                        refreshKey={refreshKey}
                    />
                    {/* Behaviour flag rather than connection config, so it sits in its own card
                        below the connection form — it stays relevant even once the connection
                        is set up and the form above is collapsed. */}
                    <LmsExistingUserPolicyCard
                        key={`existing-user-${packageId}`}
                        packageId={packageId}
                        refreshKey={refreshKey}
                    />
                </TabsContent>
                <TabsContent value="leads" className="mt-4">
                    <LeadConversionCard
                        key={`lead-conversion-${packageId}`}
                        packageId={packageId}
                        refreshKey={refreshKey}
                    />
                </TabsContent>
                <TabsContent value="workflows" className="mt-4">
                    <CourseWorkflowTriggersCard key={packageId} packageId={packageId} />
                </TabsContent>
                <TabsContent value="suborg" className="mt-4">
                    <SubOrgAssociatedCard key={packageId} packageId={packageId} />
                </TabsContent>
                <TabsContent value="json" className="mt-4">
                    <PackageCourseSettingEditor
                        packageId={packageId}
                        onSaved={() => setRefreshKey((k) => k + 1)}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};
