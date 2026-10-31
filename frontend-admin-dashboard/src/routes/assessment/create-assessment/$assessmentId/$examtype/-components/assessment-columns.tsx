import { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { CaretUp, CaretDown } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { useGetStudentBatch } from '@/routes/manage-students/students-list/-hooks/useGetStudentBatch';
import { MyDropdown } from '@/components/design-system/dropdown';
import { StudentTable } from '@/types/student-table-types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface CustomTableMeta {
    onSort?: (columnId: string, direction: string) => void;
}

const BatchCell = ({ package_session_id }: { package_session_id: string }) => {
    const { packageName, levelName } = useGetStudentBatch(package_session_id);
    return (
        <div>
            {levelName} {packageName}
        </div>
    );
};

export const buildAssessmentColumns = (t: TFunction): ColumnDef<StudentTable>[] => [
    {
        id: 'checkbox',
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none"
            />
        ),
    },
    {
        accessorKey: 'full_name',
        header: (props) => {
            const meta = props.table.options.meta as CustomTableMeta;
            return (
                <div className="relative">
                    <MyDropdown
                        dropdownList={['ASC', 'DESC']}
                        onSelect={(value) => {
                            meta.onSort?.('full_name', value);
                        }}
                    >
                        <button className="flex w-full cursor-pointer items-center justify-between">
                            <div>{t('columns.name')}</div>
                            <div>
                                <CaretUp />
                                <CaretDown />
                            </div>
                        </button>
                    </MyDropdown>
                </div>
            );
        },
    },
    {
        accessorKey: 'package_session_id',
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
        cell: ({ row }) => <BatchCell package_session_id={row.original.package_session_id} />,
    },
    {
        accessorKey: 'institute_enrollment_id',
        header: t('columns.enrollmentNumber'),
    },
    {
        accessorKey: 'linked_institute_name',
        header: t('columns.collegeSchool'),
    },
    {
        accessorKey: 'gender',
        header: t('columns.gender'),
    },
    {
        accessorKey: 'mobile_number',
        header: t('columns.mobileNumber'),
    },
    {
        accessorKey: 'email',
        header: t('columns.emailId'),
    },
    {
        accessorKey: 'city',
        header: t('columns.city'),
    },
    {
        accessorKey: 'region',
        header: t('columns.state'),
    },
];
