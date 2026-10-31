import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getAssessmentDetails } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useSuspenseQuery } from '@tanstack/react-query';
import {
    FileText,
    Tag,
    BookOpen,
    PlayCircle,
    StopCircle,
    Repeat,
    Timer,
    Eye,
    ArrowsLeftRight,
    CheckCircle,
    Info,
    GearSix,
} from '@phosphor-icons/react';
import { Route } from '..';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { convertToLocalDateTime } from '@/constants/helper';
import {
    resolveSubjectName,
    unresolvedSubjectIds,
    useSubjectNamesByIds,
} from '@/services/subject-names';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { useTranslation } from 'react-i18next';
import { sanitizeRichHtml } from '@/lib/sanitize-html';

interface InfoCardItem {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
}

const InfoCard = ({ icon: Icon, label, value }: InfoCardItem) => (
    <Card className="border-slate-200 shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="flex items-start gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                <Icon className="h-4 w-4" />
            </div>
            <div className="flex min-w-0 flex-col">
                <p className="text-caption font-medium uppercase tracking-wider text-slate-500">
                    {label}
                </p>
                <p className="truncate text-sm font-semibold text-slate-900">{value}</p>
            </div>
        </CardContent>
    </Card>
);

const SectionHeader = ({
    icon: Icon,
    title,
    description,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description?: string;
}) => (
    <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-600">
            <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex flex-col">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {description && <p className="text-xs text-slate-500">{description}</p>}
        </div>
    </div>
);

const SettingRow = ({
    icon: Icon,
    label,
    value,
    enabled,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value?: string;
    enabled?: boolean;
}) => (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-primary-200 hover:bg-primary-50/20">
        <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium text-slate-800">{label}</span>
        </div>
        <div className="flex items-center gap-2">
            {value && (
                <Badge
                    variant="secondary"
                    className="bg-slate-100 font-semibold tabular-nums text-slate-700 hover:bg-slate-100"
                >
                    {value}
                </Badge>
            )}
            {enabled && <CheckCircle className="h-5 w-5 text-emerald-500" />}
        </div>
    </div>
);

export const AssessmentBasicInfoTab = () => {
    const { t } = useTranslation('assessmentBasicInfoTab');
    const { assessmentId, examType } = Route.useParams();
    const { data: instituteDetails } = useSuspenseQuery(useInstituteQuery());
    const { data: assessmentDetails, isLoading } = useSuspenseQuery(
        getAssessmentDetails({
            assessmentId: assessmentId,
            instituteId: instituteDetails?.id,
            type: examType,
        })
    );
    // Before the early return: the institute list only holds one subject per distinct
    // name and drops subjects whose course was deleted, so most stored ids need the
    // direct lookup to render as anything but "N/A".
    const savedSubjectId = assessmentDetails[0]?.saved_data?.subject_selection;
    const subjectNamesById = useSubjectNamesByIds(
        unresolvedSubjectIds(instituteDetails?.subjects, [savedSubjectId])
    );
    if (isLoading) return <DashboardLoader />;

    const saved = assessmentDetails[0]?.saved_data;
    const subjectLabel = getTerminology(ContentTerms.Subjects, SystemTerms.Subjects);
    const subjectName =
        resolveSubjectName(instituteDetails?.subjects, subjectNamesById, savedSubjectId) ||
        t('basicInfo.notAvailable');
    const instructionsHtml = saved?.instructions?.content || '';
    const previewDuration = saved?.assessment_preview ?? 0;
    const totalDurationMin = assessmentDetails[1]?.saved_data?.duration;

    return (
        <div className="mt-6 flex flex-col gap-6">
            {/* Basic info cards */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoCard
                    icon={Tag}
                    label={t('basicInfo.assessmentName')}
                    value={saved?.name || t('basicInfo.untitled')}
                />
                <InfoCard icon={BookOpen} label={subjectLabel} value={subjectName} />
            </div>

            {/* Instructions */}
            <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-5">
                    <SectionHeader
                        icon={FileText}
                        title={t('instructions.title')}
                        description={t('instructions.description')}
                    />
                    {instructionsHtml ? (
                        <div
                            dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(instructionsHtml) }}
                            className="custom-html-content prose prose-sm mt-2 max-w-none text-slate-700"
                        />
                    ) : (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                            <Info className="h-4 w-4" />
                            {t('instructions.empty')}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Live date range */}
            {(examType === 'EXAM' || examType === 'SURVEY') && (
                <Card className="border-slate-200 shadow-sm">
                    <CardContent className="p-5">
                        <SectionHeader icon={Timer} title={t('liveDateRange.title')} />
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <InfoCard
                                icon={PlayCircle}
                                label={t('liveDateRange.startDateTime')}
                                value={convertToLocalDateTime(saved?.boundation_start_date ?? '')}
                            />
                            <InfoCard
                                icon={StopCircle}
                                label={t('liveDateRange.endDateTime')}
                                value={convertToLocalDateTime(saved?.boundation_end_date ?? '')}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Attempt settings */}
            <Card className="border-slate-200 shadow-sm">
                <CardContent className="p-5">
                    <SectionHeader
                        icon={GearSix}
                        title={t('attemptSettings.title')}
                        description={t('attemptSettings.description')}
                    />
                    <div className="mt-3 flex flex-col gap-2">
                        {examType === 'EXAM' && saved?.reattempt_count != null && (
                            <SettingRow
                                icon={Repeat}
                                label={t('attemptSettings.reattemptCount')}
                                value={String(saved.reattempt_count)}
                            />
                        )}
                        <SettingRow
                            icon={Timer}
                            label={t('attemptSettings.totalDuration')}
                            value={
                                totalDurationMin
                                    ? t('attemptSettings.durationMinutes', {
                                          count: totalDurationMin,
                                      })
                                    : t('attemptSettings.durationNotSet')
                            }
                        />
                        {previewDuration > 0 && (
                            <SettingRow
                                icon={Eye}
                                label={t('attemptSettings.assessmentPreview')}
                                value={t('attemptSettings.durationMinutes', {
                                    count: previewDuration,
                                })}
                                enabled
                            />
                        )}
                        {saved?.can_switch_section && (
                            <SettingRow
                                icon={ArrowsLeftRight}
                                label={t('attemptSettings.allowSwitchingSections')}
                                enabled
                            />
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
