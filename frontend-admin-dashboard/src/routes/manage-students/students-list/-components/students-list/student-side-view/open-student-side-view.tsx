import {
    Sidebar,
    SidebarContent,
    SidebarHeader,
    useSidebar,
} from '@/components/ui/sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
    X,
    EnvelopeSimple,
    Phone,
    Clock,
    ListChecks,
    IdentificationCard,
    FileText,
} from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAssistDockVisible } from '@/components/assist-dock/visibility';
import { useQuery } from '@tanstack/react-query';
import { useStudentSidebar } from '../../../-context/selected-student-sidebar-context';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { convertToLocalDateTime } from '@/constants/helper';
import {
    handleGetParticipantRegistrationDetails,
    ParticipantRegistrationDetail,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';

const DetailRow = ({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value?: string | null;
}) => {
    const { t } = useTranslation('manageStudentsOpenSideView');
    return (
        <div className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                {icon}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-caption font-medium uppercase tracking-wider text-slate-500">
                    {label}
                </p>
                <p className="truncate text-sm font-semibold text-slate-900">
                    {value || (
                        <span className="italic font-normal text-slate-400">
                            {t('common.notProvided')}
                        </span>
                    )}
                </p>
            </div>
        </div>
    );
};

const SectionHeader = ({ icon, title }: { icon: React.ReactNode; title: string }) => (
    <div className="mb-2 flex items-center gap-2 px-1">
        <div className="text-slate-500">{icon}</div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600">{title}</h4>
    </div>
);

export const OpenStudentSidebar = () => {
    const { t } = useTranslation('manageStudentsOpenSideView');
    const { state, toggleSidebar } = useSidebar();
    const { selectedStudent } = useStudentSidebar();

    const registrationId = (selectedStudent as unknown as { registration_id?: string })
        ?.registration_id;

    const { data, isLoading, isError } = useQuery<ParticipantRegistrationDetail>(
        handleGetParticipantRegistrationDetails(registrationId)
    );

    useEffect(() => {
        if (state === 'expanded') {
            document.body.classList.add('sidebar-open');
        } else {
            document.body.classList.remove('sidebar-open');
        }
        return () => {
            document.body.classList.remove('sidebar-open');
        };
    }, [state]);

    const initials =
        data?.participant_name?.trim().charAt(0).toUpperCase() ||
        selectedStudent?.full_name?.trim().charAt(0).toUpperCase() ||
        '?';
    const displayName =
        data?.participant_name || selectedStudent?.full_name || t('common.participantFallback');

    return (
        <Sidebar side="right">
            {/* pr-14 keeps content clear of the fixed Assist Dock rail (w-14) overlaying the right edge. */}
            <SidebarContent className="sidebar-content flex flex-col border-l border-slate-200 bg-white pr-14">
                <SidebarHeader className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10 border border-slate-200">
                                <AvatarFallback className="bg-primary-100 text-sm font-semibold text-primary-600">
                                    {initials}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                                <h2 className="text-base font-semibold text-slate-900">
                                    {displayName}
                                </h2>
                                <p className="text-xs text-slate-500">{t('header.subtitle')}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={toggleSidebar}
                            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                            aria-label={t('header.close')}
                        >
                            <X className="h-5 w-5" />
                        </button>
                    </div>
                </SidebarHeader>

                <div className="flex-1 overflow-y-auto px-5 py-5">
                    {isLoading && (
                        <div className="flex h-40 items-center justify-center">
                            <DashboardLoader />
                        </div>
                    )}

                    {isError && (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                            {t('states.loadError')}
                        </div>
                    )}

                    {!isLoading && !isError && !registrationId && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                            {t('states.noParticipantSelected')}
                        </div>
                    )}

                    {!isLoading && !isError && data && (
                        <div className="flex flex-col gap-5">
                            {/* Metadata chips */}
                            <div className="flex flex-wrap gap-2">
                                {data.source && (
                                    <Badge
                                        variant="secondary"
                                        className="bg-primary-50 text-primary-700 hover:bg-primary-50"
                                    >
                                        {data.source}
                                    </Badge>
                                )}
                                {data.status && (
                                    <Badge
                                        variant="secondary"
                                        className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50"
                                    >
                                        {data.status}
                                    </Badge>
                                )}
                            </div>

                            {/* Contact */}
                            <Card className="border-slate-200 shadow-none">
                                <CardContent className="p-3">
                                    <SectionHeader
                                        icon={<IdentificationCard className="h-3.5 w-3.5" />}
                                        title={t('contact.sectionTitle')}
                                    />
                                    <DetailRow
                                        icon={<EnvelopeSimple className="h-4 w-4" />}
                                        label={t('contact.email')}
                                        value={data.email}
                                    />
                                    <DetailRow
                                        icon={<Phone className="h-4 w-4" />}
                                        label={t('contact.mobileNumber')}
                                        value={data.phone_number}
                                    />
                                    <DetailRow
                                        icon={<Clock className="h-4 w-4" />}
                                        label={t('contact.registeredOn')}
                                        value={
                                            data.registration_time
                                                ? convertToLocalDateTime(data.registration_time)
                                                : undefined
                                        }
                                    />
                                </CardContent>
                            </Card>

                            {/* Custom form fields */}
                            <div>
                                <SectionHeader
                                    icon={<ListChecks className="h-3.5 w-3.5" />}
                                    title={`${t('formResponses.sectionTitle')}${
                                        data.custom_fields?.length
                                            ? ` (${data.custom_fields.length})`
                                            : ''
                                    }`}
                                />
                                {data.custom_fields && data.custom_fields.length > 0 ? (
                                    <Card className="border-slate-200 shadow-none">
                                        <CardContent className="p-3">
                                            {data.custom_fields.map((field, idx) => (
                                                <div key={field.field_id || idx}>
                                                    <DetailRow
                                                        icon={<FileText className="h-4 w-4" />}
                                                        label={
                                                            field.field_name ||
                                                            t('formResponses.fieldFallback')
                                                        }
                                                        value={field.answer}
                                                    />
                                                    {idx < data.custom_fields.length - 1 && (
                                                        <Separator className="my-1 bg-slate-100" />
                                                    )}
                                                </div>
                                            ))}
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <Card className="border-dashed border-slate-200 shadow-none">
                                        <CardContent className="flex items-center justify-center p-6 text-sm text-slate-500">
                                            {t('formResponses.empty')}
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </SidebarContent>
        </Sidebar>
    );
};
