import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { Users, ChartLine, Target, TrendUp, ArrowRight, UserPlus } from '@phosphor-icons/react';
import { getPipelineMetricsQuery, getInstituteId } from '../-services/pipeline-services';
import type { PipelineMetrics } from '../-types/pipeline-types';
import PipelineUsersTable from './PipelineUsersTable';
import { AdmissionsEnhanced } from './AdmissionsEnhanced';

export default function AdmissionDashboard() {
    const { t } = useTranslation('admissionsAdmissionDashboard');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(t('navHeading'));
    }, [setNavHeading, t]);

    useSuspenseQuery(useInstituteQuery());
    const instituteDetails = useInstituteDetailsStore((s) => s.instituteDetails);
    const instituteId = getInstituteId();

    const [selectedSession, setSelectedSession] = useState<string>('all');

    const sessionOptions = useMemo(() => {
        if (!instituteDetails?.batches_for_sessions) return [];
        return instituteDetails.batches_for_sessions
            .filter((batch: any) => batch.is_parent === true || !batch.parent_id)
            .map((batch: any) => ({
                id: batch.id,
                label: `${batch.package_dto?.package_name} - ${batch.level?.level_name}${batch.name ? ` - ${batch.name}` : ''} - ${batch.session?.session_name}`,
            }));
    }, [instituteDetails]);

    const packageSessionId = selectedSession !== 'all' ? selectedSession : undefined;

    const { data: metrics, isLoading } = useQuery(
        getPipelineMetricsQuery(instituteId, packageSessionId)
    );

    if (isLoading) {
        return <LoadingSkeleton />;
    }

    const data: PipelineMetrics = metrics ?? {
        institute_id: instituteId ?? '',
        package_session_id: null,
        total_enquiries: 0,
        total_applications: 0,
        total_admissions: 0,
        enquiry_to_application_conversion_rate: 0,
        application_to_admission_conversion_rate: 0,
        overall_conversion_rate: 0,
        admissions_from_enquiry: 0,
        admissions_from_application_only: 0,
        direct_admissions: 0,
    };

    return (
        <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-800">{t('filterBar.title')}</h2>
                <Select value={selectedSession} onValueChange={setSelectedSession}>
                    <SelectTrigger className="w-72">
                        <SelectValue placeholder={t('filterBar.allClasses')} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t('filterBar.allClasses')}</SelectItem>
                        {sessionOptions.map((opt: any) => (
                            <SelectItem key={opt.id} value={opt.id}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <KPICard
                    title={t('kpi.totalEnquiries')}
                    value={data.total_enquiries}
                    icon={<Users className="size-5 text-emerald-600" weight="fill" />}
                    borderColor="border-l-emerald-500"
                    gradientFrom="from-emerald-50"
                    iconBg="bg-emerald-100"
                    valueColor="text-emerald-700"
                />
                <KPICard
                    title={t('kpi.totalApplications')}
                    value={data.total_applications}
                    icon={<Target className="size-5 text-blue-600" weight="fill" />}
                    borderColor="border-l-blue-500"
                    gradientFrom="from-blue-50"
                    iconBg="bg-blue-100"
                    valueColor="text-blue-700"
                />
                <KPICard
                    title={t('kpi.totalAdmissions')}
                    value={data.total_admissions}
                    icon={<ChartLine className="size-5 text-purple-600" weight="fill" />}
                    borderColor="border-l-purple-500"
                    gradientFrom="from-purple-50"
                    iconBg="bg-purple-100"
                    valueColor="text-purple-700"
                />
            </div>

            {/* Conversion Rates */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ConversionCard
                    title={t('conversion.enquiryToApplication')}
                    rate={data.enquiry_to_application_conversion_rate}
                    color="emerald"
                />
                <ConversionCard
                    title={t('conversion.applicationToAdmission')}
                    rate={data.application_to_admission_conversion_rate}
                    color="blue"
                />
                <ConversionCard
                    title={t('conversion.overall')}
                    rate={data.overall_conversion_rate}
                    color="purple"
                />
            </div>

            {/* Admission Breakdown */}
            <Card className="shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                        {t('breakdown.title')}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <BreakdownItem
                            label={t('breakdown.fromEnquiry.label')}
                            value={data.admissions_from_enquiry}
                            icon={<TrendUp className="size-4 text-emerald-600" weight="bold" />}
                            description={t('breakdown.fromEnquiry.description')}
                        />
                        <BreakdownItem
                            label={t('breakdown.fromApplicationOnly.label')}
                            value={data.admissions_from_application_only}
                            icon={<ArrowRight className="size-4 text-blue-600" weight="bold" />}
                            description={t('breakdown.fromApplicationOnly.description')}
                        />
                        <BreakdownItem
                            label={t('breakdown.direct.label')}
                            value={data.direct_admissions}
                            icon={<UserPlus className="size-4 text-amber-600" weight="bold" />}
                            description={t('breakdown.direct.description')}
                        />
                    </div>
                </CardContent>
            </Card>

            {/* funnel + insights. */}
            <AdmissionsEnhanced data={data} />

            {/* Pipeline Users Table */}
            <PipelineUsersTable
                instituteId={instituteId}
                packageSessionId={packageSessionId}
            />
        </div>
    );
}

// --- Sub-components ---

function KPICard({
    title,
    value,
    icon,
    borderColor,
    gradientFrom,
    iconBg,
    valueColor,
}: {
    title: string;
    value: number;
    icon: React.ReactNode;
    borderColor: string;
    gradientFrom: string;
    iconBg: string;
    valueColor: string;
}) {
    return (
        <Card
            className={`relative overflow-hidden border-l-4 ${borderColor} bg-gradient-to-br ${gradientFrom} to-white shadow-sm transition-all hover:shadow-md`}
        >
            <div className={`absolute right-3 top-3 rounded-full ${iconBg} p-2`}>{icon}</div>
            <CardHeader className="pb-1 pt-4">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
                <div className={`text-3xl font-bold ${valueColor}`}>{value.toLocaleString()}</div>
            </CardContent>
        </Card>
    );
}

function ConversionCard({
    title,
    rate,
    color,
}: {
    title: string;
    rate: number;
    color: 'emerald' | 'blue' | 'purple';
}) {
    const colorMap = {
        emerald: {
            bar: 'from-emerald-400 to-emerald-600',
            text: 'text-emerald-700',
            bg: 'bg-emerald-50',
        },
        blue: {
            bar: 'from-blue-400 to-blue-600',
            text: 'text-blue-700',
            bg: 'bg-blue-50',
        },
        purple: {
            bar: 'from-purple-400 to-purple-600',
            text: 'text-purple-700',
            bg: 'bg-purple-50',
        },
    };
    const c = colorMap[color];

    return (
        <Card className={`shadow-sm ${c.bg}`}>
            <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
                <div className={`text-2xl font-bold ${c.text}`}>{rate.toFixed(1)}%</div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                        className={`h-full rounded-full bg-gradient-to-r ${c.bar} transition-all duration-500`}
                        style={{ width: `${Math.min(rate, 100)}%` }}
                    />
                </div>
            </CardContent>
        </Card>
    );
}

function BreakdownItem({
    label,
    value,
    icon,
    description,
}: {
    label: string;
    value: number;
    icon: React.ReactNode;
    description: string;
}) {
    return (
        <div className="flex items-start gap-3 rounded-lg border bg-white p-4">
            <div className="mt-0.5 rounded-full bg-gray-100 p-2">{icon}</div>
            <div>
                <div className="text-sm font-medium text-gray-600">{label}</div>
                <div className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</div>
                <div className="text-xs text-gray-400">{description}</div>
            </div>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
                <div className="h-10 w-72 animate-pulse rounded bg-gray-200" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {[...Array(3)].map((_, i) => (
                    <Card key={i} className="animate-pulse">
                        <CardHeader className="pb-2">
                            <div className="h-4 w-24 rounded bg-gray-200" />
                        </CardHeader>
                        <CardContent>
                            <div className="h-9 w-20 rounded bg-gray-200" />
                        </CardContent>
                    </Card>
                ))}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {[...Array(3)].map((_, i) => (
                    <Card key={i} className="animate-pulse">
                        <CardHeader className="pb-2">
                            <div className="h-4 w-32 rounded bg-gray-200" />
                        </CardHeader>
                        <CardContent>
                            <div className="h-7 w-16 rounded bg-gray-200" />
                            <div className="mt-2 h-2 w-full rounded-full bg-gray-200" />
                        </CardContent>
                    </Card>
                ))}
            </div>
            <Card className="animate-pulse">
                <CardHeader className="pb-3">
                    <div className="h-4 w-40 rounded bg-gray-200" />
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="h-20 rounded bg-gray-200" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
