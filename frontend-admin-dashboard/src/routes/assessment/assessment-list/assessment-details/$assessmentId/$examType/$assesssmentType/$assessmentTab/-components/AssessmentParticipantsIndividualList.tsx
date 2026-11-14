import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ColumnDef } from '@tanstack/react-table';
import { CaretDown, CaretUp, UsersThree } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyTable } from '@/components/design-system/table';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getInstituteId } from '@/constants/helper';
import { Route } from '..';
import { handleGetIndividualStudentList } from '../-services/assessment-details-services';
import { convertToLocalDateTime } from '@/constants/helper';
import { Step3ParticipantsListIndiviudalStudentInterface } from '@/types/assessments/student-questionwise-status';
import { RegistrationDetailsBody } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/open-student-side-view';

export type ParticipantsListType = 'internal' | 'external';

/** Registrations that are not participants (bulk AI copy check without a learner). */
const NON_PARTICIPANT_SOURCES = ['COPY_CHECK_ONLY'];

/**
 * OPEN_REGISTRATION (registered through the public join link) is External; every other
 * participant source (admin pre-registration, batch) is Internal.
 */
export const splitParticipants = (
    registrations: Step3ParticipantsListIndiviudalStudentInterface[]
) => {
    const participants = (registrations || []).filter(
        (r) => !NON_PARTICIPANT_SOURCES.includes(r.source)
    );
    return {
        internal: participants.filter((r) => r.source !== 'OPEN_REGISTRATION'),
        external: participants.filter((r) => r.source === 'OPEN_REGISTRATION'),
    };
};

interface ParticipantRow {
    id: string;
    full_name: string;
    email: string;
    mobile_number: string;
    registered_on: string;
    status: string;
}

/** Registration time as sent (ISO string, or epoch millis); never throws on a bad value. */
const formatRegisteredOn = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '';
    try {
        return typeof value === 'number'
            ? convertToLocalDateTime(new Date(value).toISOString())
            : convertToLocalDateTime(String(value));
    } catch {
        return '';
    }
};

const toRow = (r: Step3ParticipantsListIndiviudalStudentInterface): ParticipantRow => ({
    id: r.id,
    full_name: r.participantName || r.username || '',
    email: r.userEmail || '',
    mobile_number: r.phoneNumber || '',
    registered_on: formatRegisteredOn(r.registrationTime),
    status: r.status || '',
});

export const AssessmentParticipantsIndividualList = ({ type }: { type: ParticipantsListType }) => {
    const { t } = useTranslation('assessmentParticipantsIndividualList');
    const instituteId = getInstituteId();
    const { assessmentId } = Route.useParams();
    const [open, setOpen] = useState(false);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const isExternal = type === 'external';

    // Loaded only while the dialog is open (as before): on a big test this call returns every
    // registration with its attempts, so it must not run just because the tab rendered.
    const query = handleGetIndividualStudentList({ instituteId, assessmentId });
    const { data, isLoading, isError } = useQuery({
        ...query,
        enabled: open && query.enabled,
        staleTime: 60 * 1000,
    });

    const rows = useMemo(() => {
        const { internal, external } = splitParticipants(data ?? []);
        return (isExternal ? external : internal).map(toRow);
    }, [data, isExternal]);

    const columns = useMemo<ColumnDef<ParticipantRow>[]>(() => {
        const dash = (value: unknown) => (value ? String(value) : '—');
        const base: ColumnDef<ParticipantRow>[] = [
            {
                accessorKey: 'full_name',
                header: t('columns.name'),
                cell: ({ row }) => (
                    <span className="font-medium text-neutral-800">
                        {dash(row.original.full_name)}
                    </span>
                ),
            },
            {
                accessorKey: 'email',
                header: t('columns.email'),
                cell: ({ row }) => dash(row.original.email),
            },
            {
                accessorKey: 'mobile_number',
                header: t('columns.phone'),
                cell: ({ row }) => dash(row.original.mobile_number),
            },
            {
                accessorKey: 'registered_on',
                header: t('columns.registeredOn'),
                cell: ({ row }) => dash(row.original.registered_on),
            },
            {
                accessorKey: 'status',
                header: t('columns.status'),
                cell: ({ row }) => dash(row.original.status),
            },
        ];
        if (!isExternal) return base;
        return [
            ...base,
            {
                id: 'details',
                header: t('columns.details'),
                cell: ({ row }) => {
                    const isExpanded = expandedId === row.original.id;
                    return (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            className="gap-1 text-primary-500"
                            onClick={() => setExpandedId(isExpanded ? null : row.original.id)}
                        >
                            {isExpanded ? t('actions.hideResponses') : t('actions.viewResponses')}
                            {isExpanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                        </MyButton>
                    );
                },
            },
        ];
    }, [t, isExternal, expandedId]);

    return (
        <MyDialog
            heading={isExternal ? t('titles.external') : t('titles.internal')}
            dialogWidth="max-w-5xl"
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) setExpandedId(null);
            }}
            trigger={
                <MyButton
                    type="button"
                    buttonType="text"
                    scale="small"
                    className="text-primary-500"
                >
                    {t('trigger.viewList')}
                </MyButton>
            }
        >
            {isLoading ? (
                <DashboardLoader />
            ) : isError ? (
                <p className="py-12 text-center text-sm text-danger-600">{t('states.loadError')}</p>
            ) : rows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                    <UsersThree size={32} className="text-neutral-400" />
                    <p className="text-sm text-neutral-500">
                        {isExternal ? t('empty.external') : t('empty.internal')}
                    </p>
                </div>
            ) : (
                <MyTable<ParticipantRow>
                    data={{
                        content: rows,
                        total_pages: 1,
                        page_no: 0,
                        page_size: rows.length,
                        total_elements: rows.length,
                        last: true,
                    }}
                    columns={columns}
                    isLoading={false}
                    error={null}
                    currentPage={0}
                    renderExpandedRow={
                        isExternal
                            ? (row) =>
                                  expandedId === row.id ? (
                                      <div className="max-w-2xl p-4">
                                          <RegistrationDetailsBody registrationId={row.id} />
                                      </div>
                                  ) : null
                            : undefined
                    }
                />
            )}
        </MyDialog>
    );
};
