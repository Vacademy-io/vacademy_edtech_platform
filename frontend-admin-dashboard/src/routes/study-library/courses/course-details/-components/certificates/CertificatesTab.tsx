import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Gear, Warning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import {
    getCourseCertificateDashboard,
    getCourseCertificateSettings,
} from '../../-services/course-certificates';
import { CertificateStatsCards } from './CertificateStatsCards';
import { CertificateStudentTable } from './CertificateStudentTable';
import { CourseCertificateSettingsDialog } from './CourseCertificateSettingsDialog';
import { useInstituteTemplates } from './CourseCertificatePicker';

interface CertificatesTabProps {
    /** The course. Certificate settings are per-course and apply to every batch. */
    packageId: string;
    /** The batch selected at the top of the course page. Certificates are issued per batch. */
    packageSessionId: string;
    courseName?: string;
}

export const CertificatesTab = ({
    packageId,
    packageSessionId,
    courseName,
}: CertificatesTabProps) => {
    const { t } = useTranslation('studyLibraryCertificatesTab');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const instituteId = getInstituteId() ?? '';

    const { data: settings } = useQuery({
        queryKey: ['course-certificate-settings', packageId],
        queryFn: () => getCourseCertificateSettings(instituteId, packageId),
        enabled: !!instituteId && !!packageId,
    });

    // Which design this course actually prints, named. The tab could say whether
    // certificates were on but not which certificate — so an admin who had
    // pointed the course at a template had no way to confirm it from here.
    const { templates, defaultTemplateId } = useInstituteTemplates();
    const templateInForce = settings?.course_template_id
        ? templates.find((t) => t.id === settings.course_template_id)?.name
        : undefined;
    const instituteDefaultName = templates.find((t) => t.id === defaultTemplateId)?.name;

    const { data: dashboard, isLoading: dashboardLoading } = useQuery({
        queryKey: ['course-certificate-dashboard', packageSessionId],
        queryFn: () => getCourseCertificateDashboard(instituteId, packageSessionId, packageId),
        enabled: !!instituteId && !!packageSessionId,
    });

    if (!packageSessionId) {
        return (
            <div className="rounded-md bg-white p-6 text-body text-neutral-500 shadow-sm">
                {t('selectBatchToSeeCertificateInfo')}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 rounded-md bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-h3 font-semibold text-neutral-700">{t('certificates')}</h3>
                    <p className="text-caption text-neutral-500">
                        {t('issueAndManageCertificates')}
                    </p>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="icon"
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                >
                    <Gear />
                </MyButton>
            </div>

            {settings && !settings.effective_enabled && (
                <div className="flex items-start gap-3 rounded-md border border-warning-200 bg-warning-50 p-4">
                    <Warning className="mt-0.5 size-5 shrink-0 text-warning-500" />
                    <div>
                        <p className="text-body font-medium text-neutral-700">
                            {t('certificatesTurnedOff')}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {settings.enabled_overridden_by_course
                                ? t('courseOverridesInstituteDefault')
                                : t('instituteDefaultIsOff')}
                        </p>
                    </div>
                </div>
            )}

            {settings?.effective_enabled && (
                <p className="text-caption text-neutral-500">
                    {t('design')}{' '}
                    <span className="font-medium text-neutral-700">
                        {templateInForce ??
                            (settings.has_course_template
                                ? t('uploadedForThisCourse')
                                : instituteDefaultName ?? t('instituteDefault'))}
                    </span>{' '}
                    {settings.has_course_template
                        ? t('chosenForThisCourse')
                        : t('inheritedFromInstitute')}
                </p>
            )}

            <CertificateStatsCards data={dashboard} isLoading={dashboardLoading} />

            <CertificateStudentTable
                instituteId={instituteId}
                packageSessionId={packageSessionId}
                packageId={packageId}
                courseName={courseName}
                certificatesEnabled={settings?.effective_enabled ?? false}
            />

            <CourseCertificateSettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                instituteId={instituteId}
                packageId={packageId}
                settings={settings}
            />
        </div>
    );
};
