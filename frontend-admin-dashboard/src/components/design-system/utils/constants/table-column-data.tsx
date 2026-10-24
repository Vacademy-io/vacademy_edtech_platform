import { ColumnDef, Row } from '@tanstack/react-table';
import { StudentTable } from '@/types/student-table-types';
import { ArrowSquareOut, CaretUpDown, Info } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { MyDropdown } from '../../dropdown';
import { useGetStudentBatch } from '@/routes/manage-students/students-list/-hooks/useGetStudentBatch';
import { ActivityStatus } from '../types/chips-types';
import { StatusChips } from '../../chips';
import { StudentMenuOptions } from '../../table-components/student-menu-options/student-menu-options';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { useActivityStatsStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/activity-stats-store';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useState, useRef } from 'react';
import { LogDetailsDialog } from '@/components/common/student-slide-tracking/log-details-dialog';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    OtherTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';
import { EnrollRequestsStudentMenuOptions } from '@/routes/manage-students/enroll-requests/-components/bulk-actions/enroll-request-individual-options';
import { generateCustomFieldColumns } from './custom-field-columns';
import { processColumnsWithSystemFields } from './system-field-columns';
import { generateEnrollRequestCustomFieldColumns } from './enroll-request-custom-field-columns';
import { processEnrollRequestColumnsWithSystemFields } from './enroll-request-system-field-columns';

interface CustomTableMeta {
    onSort?: (columnId: string, direction: string) => void;
}

export interface ActivityLogType {
    activityDate: string;
    startTime: string;
    endTime: string;
    duration: string;
    lastPageRead: number;
    videos: {
        id: string;
        start_time_in_millis: number;
        end_time_in_millis: number;
    }[];
    documents: {
        id: string;
        start_time_in_millis: number;
        end_time_in_millis: number;
        page_number: number;
    }[];
    concentrationScore: number;
}

const BatchCell = ({
    package_session_id,
    row,
}: {
    package_session_id: string;
    row: Row<StudentTable>;
}) => {
    // batchName is the batch's own name where it has one, falling back to the
    // level + course this used to print. Without it every learner of an institute
    // whose levels are all "default" showed the identical batch.
    const { batchName } = useGetStudentBatch(package_session_id);
    const { handleClick, handleDoubleClick } = useClickHandlers();

    return (
        <div
            onClick={() => handleClick('package_session_id', row)}
            onDoubleClick={(e) => handleDoubleClick(e, 'package_session_id', row)}
        >
            {batchName}
        </div>
    );
};

const DetailsCell = ({ row }: { row: Row<StudentTable> }) => {
    const { setSelectedStudent } = useStudentSidebar();

    const handleClick = async () => {
        // Open the compact side-view sheet (via SidebarTrigger), NOT the
        // fullscreen Student Profile Overlay — hence openOverlay: false.
        setSelectedStudent(row.original, { openOverlay: false });
    };

    return (
        <SidebarTrigger onClick={handleClick}>
            <ArrowSquareOut className="size-10 cursor-pointer text-neutral-600" />
        </SidebarTrigger>
    );
};

const InfoCell = ({ row }: { row: Row<ActivityLogType> }) => {
    const [isLogDetailsOpen, setIsLogDetailsOpen] = useState(false);

    return (
        <>
            <Info
                size={20}
                className="cursor-pointer text-primary-500"
                onClick={() => setIsLogDetailsOpen(true)}
            />
            <LogDetailsDialog
                isOpen={isLogDetailsOpen}
                onClose={() => setIsLogDetailsOpen(false)}
                logData={row.original}
            />
        </>
    );
};

export const useClickHandlers = () => {
    const clickTimeout = useRef<NodeJS.Timeout | null>(null);
    const { setSelectedStudent, selectedStudent } = useStudentSidebar();
    const { setOpen, open } = useSidebar();

    const handleClick = (columnId: string, row: Row<StudentTable>) => {
        if (clickTimeout.current) clearTimeout(clickTimeout.current);

        clickTimeout.current = setTimeout(() => {
            if (selectedStudent?.id != row.original.id) {
                setSelectedStudent(row.original);
                setOpen(true);
            } else {
                if (open == true) setOpen(false);
                else setOpen(true);
            }
        }, 250);
    };

    const handleDoubleClick = (e: React.MouseEvent, columnId: string, row: Row<StudentTable>) => {
        e.stopPropagation();
        if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
        }
        console.log('double clicked on column:', columnId, 'row:', row.original);
        // Add your double click logic here
    };

    return { handleClick, handleDoubleClick };
};

const CreateClickableCell = ({ row, columnId }: { row: Row<StudentTable>; columnId: string }) => {
    const { handleClick, handleDoubleClick } = useClickHandlers();
    const value = row.getValue(columnId);

    // Handle complex objects by extracting meaningful display values
    const getDisplayValue = (value: any) => {
        if (value === null || value === undefined) {
            return '-';
        }

        if (typeof value === 'string' || typeof value === 'number') {
            return value;
        }

        if (typeof value === 'object') {
            // For objects, try to extract a meaningful display value
            if (value.name) return value.name;
            if (value.title) return value.title;
            if (value.label) return value.label;
            if (value.id) return value.id;
            if (value.status) return value.status;
            if (value.type) return value.type;

            // If it's an array, join the values
            if (Array.isArray(value)) {
                return value
                    .map((item) =>
                        typeof item === 'object'
                            ? item.name ||
                              item.title ||
                              item.label ||
                              item.id ||
                              JSON.stringify(item)
                            : item
                    )
                    .join(', ');
            }

            // Fallback to JSON string for complex objects
            return JSON.stringify(value);
        }

        return String(value);
    };

    // Audience-only respondents (filled an audience form, never enrolled into a batch) get a
    // small chip next to the name so admins can tell them apart from enrolled learners.
    const isAudienceOnly = columnId === 'full_name' && row.original.is_audience_only;

    return (
        <div
            onClick={() => handleClick(columnId, row)}
            onDoubleClick={(e) => handleDoubleClick(e, columnId, row)}
            className="flex cursor-pointer items-center gap-1.5"
        >
            <span className="truncate">{getDisplayValue(value)}</span>
            {isAudienceOnly && (
                <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                    Audience
                </span>
            )}
        </div>
    );
};

const BatchCellComponent = ({ row }: { row: Row<StudentTable> }) => {
    const { handleClick, handleDoubleClick } = useClickHandlers();
    return (
        <div
            onClick={() => handleClick('package_session_id', row)}
            onDoubleClick={(e) => handleDoubleClick(e, 'package_session_id', row)}
        >
            <BatchCell package_session_id={row.original.package_session_id} row={row} />
        </div>
    );
};

const ExpiryDateCell = ({ row }: { row: Row<StudentTable> }) => {
    const { handleClick, handleDoubleClick } = useClickHandlers();

    if (row.original.expiry_date == null) {
        return <></>;
    }
    const expiryDate = new Date(row.original.expiry_date);
    const today = new Date();

    const diffTime = expiryDate.getTime() - today.getTime();
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return (
        <div
            className={`${
                daysLeft < 30
                    ? 'text-danger-600'
                    : daysLeft < 180
                      ? 'text-warning-500'
                      : 'text-success-500'
            }`}
            onClick={() => handleClick('expiry_date', row)}
            onDoubleClick={(e) => handleDoubleClick(e, 'expiry_date', row)}
        >
            {daysLeft > 0 ? daysLeft : 0}
        </div>
    );
};

const StatusCell = ({ row }: { row: Row<StudentTable> }) => {
    const { handleClick, handleDoubleClick } = useClickHandlers();
    const status = row.original.status;
    const statusMapping: Record<string, ActivityStatus> = {
        ACTIVE: 'active',
        TERMINATED: 'inactive',
    };

    const mappedStatus = statusMapping[status] || 'inactive';
    return (
        <div
            onClick={() => handleClick('status', row)}
            onDoubleClick={(e) => handleDoubleClick(e, 'status', row)}
        >
            <StatusChips status={mappedStatus} />
        </div>
    );
};

const MembershipTypeCell = ({ row }: { row: Row<StudentTable> }) => {
    const { handleClick, handleDoubleClick } = useClickHandlers();
    const { packageName, levelName, packageType } = useGetStudentBatch(
        row.original.package_session_id
    );

    const display = packageType === 'MEMBERSHIP' ? `${packageName}`.trim() || '-' : '-';

    return (
        <div
            onClick={() => handleClick('membership_type', row)}
            onDoubleClick={(e) => handleDoubleClick(e, 'membership_type', row)}
        >
            {display}
        </div>
    );
};

const MembershipRoleCell = ({ row }: { row: Row<StudentTable> }) => {
    const { handleClick, handleDoubleClick } = useClickHandlers();
    const roles = row.original.comma_separated_org_roles || '';
    const display = roles.includes('ADMIN')
        ? 'Practice Admin'
        : roles.includes('LEARNER')
          ? 'Practice Staff'
          : '-';

    return (
        <div
            onClick={() => handleClick('comma_separated_org_roles', row)}
            onDoubleClick={(e) => handleDoubleClick(e, 'comma_separated_org_roles', row)}
        >
            {display}
        </div>
    );
};

const PaymentStatusCell = ({ row }: { row: Row<StudentTable> }) => {
    const { handleClick, handleDoubleClick } = useClickHandlers();
    const status = row.original.payment_status;

    const statusMapping: Record<string, ActivityStatus> = {
        PAID: 'PAID',
        PAYMENT_PENDING: 'PAYMENT_PENDING',
    };

    const mappedStatus = statusMapping[status];
    return (
        <div
            onClick={() => handleClick('status', row)}
            onDoubleClick={(e) => handleDoubleClick(e, 'status', row)}
        >
            <StatusChips status={mappedStatus!} />
        </div>
    );
};
export const myColumns: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        size: 50,
        minSize: 50,
        maxSize: 50,
        enableResizing: false,
        enablePinning: true,
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
            />
        ),
    },
    {
        id: 'details',
        size: 80,
        minSize: 60,
        maxSize: 120,
        enablePinning: true,
        header: 'Details',
        cell: ({ row }) => <DetailsCell row={row} />,
    },
    {
        id: 'full_name',
        accessorKey: 'full_name',
        size: 200,
        minSize: 150,
        maxSize: 300,
        enablePinning: true,
        header: (props) => {
            const meta = props.table.options.meta as CustomTableMeta;
            return (
                <div className="relative">
                    <MyDropdown
                        dropdownList={['ASC', 'DESC']}
                        onSelect={(value) => {
                            if (typeof value == 'string') meta.onSort?.('full_name', value);
                        }}
                    >
                        <button className="flex w-full cursor-pointer items-center justify-between">
                            <div>Name</div>
                            <div>
                                <CaretUpDown />
                            </div>
                        </button>
                    </MyDropdown>
                </div>
            );
        },
        cell: ({ row }) => <CreateClickableCell row={row} columnId="full_name" />,
        enableHiding: true,
    },
    {
        accessorKey: 'username',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="username" />,
        enableHiding: true,
    },
    {
        accessorKey: 'package_session_id',
        size: 180,
        minSize: 120,
        maxSize: 280,
        header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
        cell: ({ row }) => <BatchCellComponent row={row} />,
        enableHiding: true,
    },
    {
        accessorKey: 'enroll_invite_name',
        size: 180,
        minSize: 120,
        maxSize: 280,
        header: getTerminology(OtherTerms.Invite, SystemTerms.Invite),
        cell: ({ row }) => <CreateClickableCell row={row} columnId="enroll_invite_name" />,
        enableHiding: true,
    },
    {
        accessorKey: 'institute_enrollment_number',
        size: 160,
        minSize: 120,
        maxSize: 220,
        header: 'Enrollment Number',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="institute_enrollment_number" />,
        enableHiding: true,
    },
    {
        accessorKey: 'sub_org_name',
        size: 180,
        minSize: 120,
        maxSize: 280,
        header: 'Sub-Org',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="sub_org_name" />,
        enableHiding: true,
    },
    {
        accessorKey: 'linked_institute_name',
        size: 200,
        minSize: 150,
        maxSize: 300,
        header: 'College/School',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="linked_institute_name" />,
        enableHiding: true,
    },
    {
        accessorKey: 'gender',
        size: 100,
        minSize: 80,
        maxSize: 150,
        header: 'Gender',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="gender" />,
        enableHiding: true,
    },
    {
        accessorKey: 'mobile_number',
        size: 140,
        minSize: 120,
        maxSize: 180,
        header: 'Mobile Number',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="mobile_number" />,
        enableHiding: true,
    },
    {
        accessorKey: 'email',
        size: 200,
        minSize: 150,
        maxSize: 300,
        header: 'Email ID',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="email" />,
        enableHiding: true,
    },
    {
        accessorKey: 'fathers_name',
        size: 150,
        minSize: 120,
        maxSize: 220,
        header: " Father/Male Guardian's Name",
        cell: ({ row }) => <CreateClickableCell row={row} columnId="fathers_name" />,
        enableHiding: true,
    },
    {
        accessorKey: 'mothers_name',
        size: 150,
        minSize: 120,
        maxSize: 220,
        header: "Mother/Female Guardian's Name",
        cell: ({ row }) => <CreateClickableCell row={row} columnId="mothers_name" />,
        enableHiding: true,
    },
    // {
    //     accessorKey: 'guardian_name',
    //     size: 150,
    //     minSize: 120,
    //     maxSize: 220,
    //     header: "Guardian's Name",
    //     cell: ({ row }) => <CreateClickableCell row={row} columnId="guardian_name" />,
    //     enableHiding: true,
    // },
    {
        accessorKey: 'parents_mobile_number',
        size: 220,
        minSize: 180,
        maxSize: 280,
        header: "Father/Male Guardian's Mobile Number",
        cell: ({ row }) => <CreateClickableCell row={row} columnId="parents_mobile_number" />,
        enableHiding: true,
    },
    {
        accessorKey: 'parents_email',
        size: 250,
        minSize: 200,
        maxSize: 350,
        header: "Father/Male Guardian's Email ID",
        cell: ({ row }) => <CreateClickableCell row={row} columnId="parents_email" />,
        enableHiding: true,
    },
    {
        accessorKey: 'parents_to_mother_mobile_number',
        size: 220,
        minSize: 180,
        maxSize: 280,
        header: "Mother/Female Guardian's Mobile Number",
        cell: ({ row }) => (
            <CreateClickableCell row={row} columnId="parents_to_mother_mobile_number" />
        ),
        enableHiding: true,
    },
    {
        accessorKey: 'parents_to_mother_email',
        size: 250,
        minSize: 200,
        maxSize: 350,
        header: "Mother/Female Guardian's Email ID",
        cell: ({ row }) => <CreateClickableCell row={row} columnId="parents_to_mother_email" />,
        enableHiding: true,
    },
    {
        accessorKey: 'billing_contact_name',
        size: 200,
        minSize: 150,
        maxSize: 300,
        header: 'Billing Contact Name',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="billing_contact_name" />,
        enableHiding: true,
    },
    {
        accessorKey: 'billing_contact_email',
        size: 250,
        minSize: 200,
        maxSize: 350,
        header: 'Billing Contact Email',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="billing_contact_email" />,
        enableHiding: true,
    },
    {
        accessorKey: 'billing_contact_role',
        size: 180,
        minSize: 120,
        maxSize: 250,
        header: 'Billing Contact Role',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="billing_contact_role" />,
        enableHiding: true,
    },
    {
        accessorKey: 'city',
        size: 120,
        minSize: 100,
        maxSize: 180,
        header: 'City',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="city" />,
        enableHiding: true,
    },
    {
        accessorKey: 'region',
        size: 120,
        minSize: 100,
        maxSize: 180,
        header: 'State',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="region" />,
        enableHiding: true,
    },
    {
        accessorKey: 'attendance_percent',
        size: 120,
        minSize: 100,
        maxSize: 180,
        header: 'Attendance',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="attendance_percent" />,
        enableHiding: true,
    },
    {
        accessorKey: 'referral_count',
        size: 120,
        minSize: 100,
        maxSize: 180,
        header: 'Referrals Count',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="referral_count" />,
        enableHiding: true,
    },
    {
        accessorKey: 'country',
        size: 120,
        minSize: 100,
        maxSize: 180,
        header: 'Country',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="country" />,
        enableHiding: true,
    },
    {
        accessorKey: 'plan_type',
        size: 120,
        minSize: 100,
        maxSize: 180,
        header: 'Plan Type',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="plan_type" />,
        enableHiding: true,
    },
    {
        accessorKey: 'amount_paid',
        size: 120,
        minSize: 100,
        maxSize: 180,
        header: 'Amount Paid',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="amount_paid" />,
        enableHiding: true,
    },
    {
        accessorKey: 'preffered_batch',
        size: 120,
        minSize: 100,
        maxSize: 180,
        header: `Preferred ${getTerminology(ContentTerms.Batch, SystemTerms.Batch)}`,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="preffered_batch" />,
        enableHiding: true,
    },
    {
        accessorKey: 'expiry_date',
        size: 120,
        minSize: 100,
        maxSize: 160,
        header: `${getTerminology(ContentTerms.Session, SystemTerms.Session)} Expiry`,
        cell: ({ row }) => <ExpiryDateCell row={row} />,
    },
    {
        accessorKey: 'status',
        size: 100,
        minSize: 80,
        maxSize: 140,
        header: 'Status',
        cell: ({ row }) => <StatusCell row={row} />,
    },
    {
        id: 'membership_role',
        accessorKey: 'comma_separated_org_roles',
        size: 160,
        minSize: 120,
        maxSize: 220,
        header: 'Membership Role',
        cell: ({ row }) => <MembershipRoleCell row={row} />,
        enableHiding: true,
    },
    {
        id: 'membership_type',
        size: 180,
        minSize: 120,
        maxSize: 280,
        header: 'Membership Type',
        cell: ({ row }) => <MembershipTypeCell row={row} />,
        enableHiding: true,
    },
    {
        id: 'options',
        size: 60,
        minSize: 50,
        maxSize: 80,
        enableResizing: false,
        header: '',
        cell: ({ row }) => <StudentMenuOptions student={row.original} />,
    },
];

/**
 * Get columns with dynamic visibility based on custom field settings
 * This function:
 * 1. Processes system fields (reorders, applies custom names)
 * 2. Adds dynamic custom field columns for learnersList location
 * 3. Returns final ordered columns
 * @param showApprovalActions - If true, shows approval-specific action buttons instead of regular student options
 */
export const getCustomColumns = (showApprovalActions = false): ColumnDef<StudentTable>[] => {
    try {
        // Create a copy of myColumns with the appropriate options column
        let columnsToProcess = [...myColumns];

        // If showApprovalActions is true, replace the options column
        if (showApprovalActions) {
            const optionsIndex = columnsToProcess.findIndex((col) => col.id === 'options');
            if (optionsIndex !== -1) {
                columnsToProcess[optionsIndex] = {
                    id: 'options',
                    size: 60,
                    minSize: 50,
                    maxSize: 80,
                    enableResizing: false,
                    header: '',
                    cell: ({ row }) => <EnrollRequestsStudentMenuOptions student={row.original} />,
                };
            }
        }

        // Step 1: Process system fields (apply custom names and reorder)
        const { columns: processedColumns } = processColumnsWithSystemFields(columnsToProcess);

        // Step 2: Generate custom field columns for learnersList location
        const customFieldColumns = generateCustomFieldColumns();

        // Step 3: Find the options column (should be last after reordering)
        const optionsColumnIndex = processedColumns.findIndex((col) => col.id === 'options');

        if (optionsColumnIndex === -1) {
            // If options column not found, append custom fields at the end

            return [...processedColumns, ...customFieldColumns];
        }

        // Step 4: Insert custom field columns before the options column
        const columnsBeforeOptions = processedColumns.slice(0, optionsColumnIndex);
        const optionsColumn = processedColumns[optionsColumnIndex];

        if (!optionsColumn) {
            return [...columnsBeforeOptions, ...customFieldColumns];
        }

        const finalColumns = [...columnsBeforeOptions, ...customFieldColumns, optionsColumn];

        return finalColumns;
    } catch (error) {
        console.error('❌ Error in getCustomColumns:', error);
        console.error('Falling back to original columns');
        return myColumns;
    }
};

export const getColumnsVisibility = (): Record<string, boolean> => {
    const { visibility } = processColumnsWithSystemFields(myColumns);
    return visibility;
};

export const enrollRequestColumns: ColumnDef<StudentTable>[] = [
    {
        id: 'checkbox',
        size: 50,
        minSize: 50,
        maxSize: 50,
        enableResizing: false,
        enablePinning: true,
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
            />
        ),
    },
    {
        id: 'details',
        size: 80,
        minSize: 60,
        maxSize: 120,
        enablePinning: true,
        header: 'Details',
        cell: ({ row }) => <DetailsCell row={row} />,
    },
    {
        id: 'full_name',
        accessorKey: 'full_name',
        size: 200,
        minSize: 150,
        maxSize: 300,
        enablePinning: true,
        header: (props) => {
            const meta = props.table.options.meta as CustomTableMeta;
            return (
                <div className="relative">
                    <MyDropdown
                        dropdownList={['ASC', 'DESC']}
                        onSelect={(value) => {
                            if (typeof value == 'string') meta.onSort?.('full_name', value);
                        }}
                    >
                        <button className="flex w-full cursor-pointer items-center justify-between">
                            <div>Name</div>
                            <div>
                                <CaretUpDown />
                            </div>
                        </button>
                    </MyDropdown>
                </div>
            );
        },
        cell: ({ row }) => <CreateClickableCell row={row} columnId="full_name" />,
    },
    {
        accessorKey: 'email',
        size: 200,
        minSize: 150,
        maxSize: 300,
        header: 'Email',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="email" />,
    },
    {
        accessorKey: 'username',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Username',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="username" />,
    },
    {
        accessorKey: 'password',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Password',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="password" />,
    },
    {
        accessorKey: 'mobile_number',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Phone',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="mobile_number" />,
    },
    {
        accessorKey: 'preferred_batch',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: `Preferred ${getTerminology(ContentTerms.Batch, SystemTerms.Batch)}`,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="preferred_batch" />,
    },
    {
        accessorKey: 'payment_status',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Payment Status',
        cell: ({ row }) => <PaymentStatusCell row={row} />,
    },
    {
        accessorKey: 'approval_status',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Approval Status',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="approval_status" />,
    },
    {
        accessorKey: 'payment_option',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Payment Option',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="payment_option" />,
    },
    {
        accessorKey: 'amount',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Amount',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="amount" />,
    },
    {
        accessorKey: 'other_custom_fields',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Other Custom Fields',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="other_custom_fields" />,
    },
    {
        accessorKey: 'source',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Source',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="source" />,
    },
    {
        accessorKey: 'type',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Type',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="type" />,
    },
    {
        accessorKey: 'type_id',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Type ID',
        cell: ({ row }) => <CreateClickableCell row={row} columnId="type_id" />,
    },
    {
        accessorKey: 'level_id',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: `${getTerminology(ContentTerms.Level, SystemTerms.Level)} ID`,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="level_id" />,
    },
    {
        id: 'options',
        size: 60,
        minSize: 50,
        maxSize: 80,
        enableResizing: false,
        header: '',
        cell: ({ row }) => <EnrollRequestsStudentMenuOptions student={row.original} />,
    },
];

/**
 * Get columns with dynamic visibility based on custom field settings for Enroll Request
 * This function:
 * 1. Processes system fields (reorders, applies custom names)
 * 2. Adds dynamic custom field columns for Enroll Request location
 * 3. Returns final ordered columns
 */
export const getEnrollRequestColumns = (): ColumnDef<StudentTable>[] => {
    try {
        // Step 1: Process system fields (apply custom names and reorder)
        const { columns: processedColumns } =
            processEnrollRequestColumnsWithSystemFields(enrollRequestColumns);

        // Step 2: Generate custom field columns for Enroll Request location
        const customFieldColumns = generateEnrollRequestCustomFieldColumns();

        // Step 3: Find the options column (should be last after reordering)
        const optionsColumnIndex = processedColumns.findIndex((col) => col.id === 'options');

        if (optionsColumnIndex === -1) {
            // If options column not found, append custom fields at the end
            return [...processedColumns, ...customFieldColumns];
        }

        // Step 4: Insert custom field columns before the options column
        const columnsBeforeOptions = processedColumns.slice(0, optionsColumnIndex);
        const optionsColumn = processedColumns[optionsColumnIndex];

        if (!optionsColumn) {
            return [...columnsBeforeOptions, ...customFieldColumns];
        }

        const finalColumns = [...columnsBeforeOptions, ...customFieldColumns, optionsColumn];
        return finalColumns;
    } catch (error) {
        console.error('❌ Error in getEnrollRequestColumns:', error);
        console.error('Falling back to original enroll request columns');
        return enrollRequestColumns;
    }
};

/**
 * Get column visibility settings for Enroll Request based on system fields
 */
export const getEnrollRequestColumnsVisibility = (): Record<string, boolean> => {
    const { visibility } = processEnrollRequestColumnsWithSystemFields(enrollRequestColumns);
    return visibility;
};

export interface ActivityLogDialogProps {
    isOpen: boolean;
    onClose: () => void;
    activityData: ActivityLogType[];
    topicName: string;
    studyType: string;
}

const LastPageReadHeader = () => {
    const { activeItem } = useContentStore();
    return (
        <>
            {activeItem?.video_slide?.url != null || activeItem?.video_slide?.published_url != null
                ? 'Percentage Watched'
                : 'Total Pages Read'}
        </>
    );
};

export const activityLogColumns: ColumnDef<ActivityLogType>[] = [
    {
        accessorKey: 'activityDate',
        header: 'Activity Date',
    },
    {
        accessorKey: 'startTime',
        header: 'Start Time',
    },
    {
        accessorKey: 'endTime',
        header: 'End Time',
    },
    {
        accessorKey: 'duration',
        header: 'Duration',
    },
    {
        accessorKey: 'concentrationScore',
        header: 'Concentration Score',
        cell: ({ row }) => {
            const concentrationScore = row.original.concentrationScore;
            return <div>{concentrationScore.toFixed(2)}</div>;
        },
    },
    {
        id: 'lastPageRead',
        accessorKey: 'lastPageRead',
        header: () => <LastPageReadHeader />,
    },
    {
        accessorKey: 'Details',
        header: 'Info',
        cell: ({ row }) => <InfoCell row={row} />,
    },
];

export interface ActivityStatsColumnsType {
    id: string;
    user_id: string;
    full_name: string;
    institute_enrollment_id: string;
    username: string;
    time_spent: string;
    last_active: string;
}

export const ActivityStatsColumns: ColumnDef<ActivityStatsColumnsType>[] = [
    {
        accessorKey: 'details',
        header: 'Details',
        size: 70,
        minSize: 60,
        maxSize: 90,
        enableResizing: false,
        cell: ({ row }) => {
            // Create a regular function to handle the click
            const handleClick = () => {
                const store = useActivityStatsStore.getState();
                store.openDialog(row.original.user_id, row.original.full_name);
            };

            return (
                <ArrowSquareOut
                    className="size-5 cursor-pointer text-neutral-500"
                    onClick={handleClick}
                />
            );
        },
    },
    {
        accessorKey: 'full_name',
        header: 'Name',
        size: 220,
        minSize: 180,
        maxSize: 280,
    },
    {
        accessorKey: 'time_spent',
        header: 'Time Spent',
        size: 130,
        minSize: 110,
        maxSize: 160,
    },
    {
        accessorKey: 'last_active',
        header: 'Last Active',
        size: 200,
        minSize: 160,
        maxSize: 240,
    },
];

export interface ActivityResponseType {
    activityDate: string;
    attemptNumber: number;
    startTime: string;
    endTime: string;
    duration: string;
    questionName: string;
    response: string;
    responseStatus: string;
}

export const activityResponseTypeColumns: ColumnDef<ActivityResponseType>[] = [
    {
        accessorKey: 'activityDate',
        header: 'Activity Date',
    },
    {
        accessorKey: 'startTime',
        header: 'Start Time',
    },
    {
        accessorKey: 'endTime',
        header: 'End Time',
    },
    {
        accessorKey: 'duration',
        header: 'Duration',
    },
    {
        accessorKey: 'questionName',
        header: 'Question Name',
        cell: ({ row }) => {
            return (
                <p
                    dangerouslySetInnerHTML={{
                        __html: row.original.questionName || '',
                    }}
                />
            );
        },
    },
    {
        accessorKey: 'response',
        header: 'Response',
    },
    {
        accessorKey: 'responseStatus',
        header: 'Response Status',
    },
];

export interface ActivityResponseAssignmentType {
    uploadDate: string;
    uploadTime: number;
    submissions: string;
}

export const activityResponseAssignmentColumns: ColumnDef<ActivityResponseAssignmentType>[] = [
    {
        accessorKey: 'uploadDate',
        header: 'Upload Date',
    },
    {
        accessorKey: 'uploadTime',
        header: 'Upload Time',
    },
    {
        accessorKey: 'submissions',
        header: 'Submissions',
    },
];

// Simple cell components for leads
// eslint-disable-next-line
const LeadDetailsCell = ({ row }: { row: Row<any> }) => {
    return (
        <div className="flex items-center justify-center">
            <button className="rounded bg-primary-400 px-2 py-1 text-xs text-white hover:bg-primary-500">
                View
            </button>
        </div>
    );
};

// eslint-disable-next-line
const LeadClickableCell = ({ row, columnId }: { row: Row<any>; columnId: string }) => {
    const value = row.getValue(columnId) as string;
    return (
        <div className="cursor-pointer text-sm text-neutral-700 hover:text-primary-500">
            {value || '-'}
        </div>
    );
};

// Leads Management Columns
// eslint-disable-next-line
export const leadsColumns: ColumnDef<any>[] = [
    {
        id: 'checkbox',
        size: 50,
        minSize: 50,
        maxSize: 50,
        enableResizing: false,
        enablePinning: true,
        header: ({ table }) => (
            <Checkbox
                checked={table.getIsAllRowsSelected()}
                onCheckedChange={(value) => table.toggleAllRowsSelected(!!value)}
                className="border-neutral-400 bg-white text-neutral-600 data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
            />
        ),
        cell: ({ row }) => (
            <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(value) => row.toggleSelected(!!value)}
                className="flex size-4 items-center justify-center border-neutral-400 text-neutral-600 shadow-none data-[state=checked]:bg-primary-500 data-[state=checked]:text-white"
            />
        ),
    },
    {
        id: 'details',
        size: 80,
        minSize: 60,
        maxSize: 120,
        enablePinning: true,
        header: 'Details',
        cell: ({ row }) => <LeadDetailsCell row={row} />,
    },
    {
        id: 'name',
        accessorKey: 'name',
        size: 200,
        minSize: 150,
        maxSize: 300,
        enablePinning: true,
        header: (props) => {
            const meta = props.table.options.meta as CustomTableMeta;
            return (
                <div className="relative">
                    <MyDropdown
                        dropdownList={['ASC', 'DESC']}
                        onSelect={(value) => {
                            if (typeof value == 'string') meta.onSort?.('name', value);
                        }}
                    >
                        <button className="flex w-full cursor-pointer items-center justify-between">
                            <div>Name</div>
                            <div>
                                <CaretUpDown />
                            </div>
                        </button>
                    </MyDropdown>
                </div>
            );
        },
        cell: ({ row }) => <LeadClickableCell row={row} columnId="name" />,
    },
    {
        accessorKey: 'email',
        size: 200,
        minSize: 150,
        maxSize: 300,
        header: 'Email',
        cell: ({ row }) => <LeadClickableCell row={row} columnId="email" />,
    },
    {
        accessorKey: 'phone',
        size: 150,
        minSize: 100,
        maxSize: 250,
        header: 'Phone',
        cell: ({ row }) => <LeadClickableCell row={row} columnId="phone" />,
    },
    {
        accessorKey: 'status',
        size: 120,
        minSize: 100,
        maxSize: 150,
        header: 'Status',
        cell: ({ row }) => {
            const status = row.getValue('status') as string;
            const statusMap: Record<string, ActivityStatus> = {
                NEW: 'pending',
                CONTACTED: 'ongoing',
                QUALIFIED: 'success',
                CONVERTED: 'success',
                LOST: 'error',
            };
            return <StatusChips status={statusMap[status] || 'pending'} />;
        },
    },
    {
        accessorKey: 'source',
        size: 150,
        minSize: 100,
        maxSize: 200,
        header: 'Source',
        cell: ({ row }) => <LeadClickableCell row={row} columnId="source" />,
    },
    {
        accessorKey: 'created_at',
        size: 150,
        minSize: 120,
        maxSize: 200,
        header: 'Created Date',
        cell: ({ row }) => {
            const date = row.getValue('created_at') as string;
            return (
                <span className="text-sm text-neutral-600">
                    {date ? new Date(date).toLocaleDateString() : '-'}
                </span>
            );
        },
    },
    {
        accessorKey: 'last_contacted',
        size: 150,
        minSize: 120,
        maxSize: 200,
        header: 'Last Contacted',
        cell: ({ row }) => {
            const date = row.getValue('last_contacted') as string;
            return (
                <span className="text-sm text-neutral-600">
                    {date ? new Date(date).toLocaleDateString() : 'Never'}
                </span>
            );
        },
    },
    {
        accessorKey: 'priority',
        size: 100,
        minSize: 80,
        maxSize: 120,
        header: 'Priority',
        cell: ({ row }) => {
            const priority = row.getValue('priority') as string;
            const priorityMap: Record<string, ActivityStatus> = {
                HIGH: 'error',
                MEDIUM: 'ongoing',
                LOW: 'pending',
            };
            return <StatusChips status={priorityMap[priority] || 'pending'} />;
        },
    },
    {
        id: 'actions',
        size: 80,
        minSize: 60,
        maxSize: 100,
        enableResizing: false,
        enablePinning: true,
        header: 'Actions',
        // eslint-disable-next-line
        cell: ({ row }) => (
            <div className="flex items-center justify-center">
                <button className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200">
                    ...
                </button>
            </div>
        ),
    },
];
