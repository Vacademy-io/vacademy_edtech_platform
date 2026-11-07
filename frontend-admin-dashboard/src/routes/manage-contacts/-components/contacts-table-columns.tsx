import { ColumnDef, Row } from '@tanstack/react-table';
import { ContactUser } from '../-types/contact-types';
import { ArrowSquareOut, CaretUpDown, UserCircle } from '@phosphor-icons/react';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { useStudentSidebar } from '@/routes/manage-students/students-list/-context/selected-student-sidebar-context';
import { StudentTable } from '@/types/student-table-types';
import { MyDropdown } from '@/components/design-system/dropdown';
import { useRef } from 'react';
import { LeadScoreBadge } from '@/components/shared/lead-score-badge';
import { DuplicateBadge } from '@/components/shared/duplicate-badge';

// Reusing the click handler logic pattern
export const useClickHandlers = () => {
    const clickTimeout = useRef<NodeJS.Timeout | null>(null);
    const { setSelectedStudent, selectedStudent } = useStudentSidebar();
    const { setOpen, open } = useSidebar();

    const handleClick = (columnId: string, row: Row<ContactUser>) => {
        if (clickTimeout.current) clearTimeout(clickTimeout.current);

        clickTimeout.current = setTimeout(() => {
            if (selectedStudent?.id != row.original.user?.id) {
                // Map ContactUser to StudentTable (partial) to satisfy constraints
                const mappedStudent = mapContactToStudent(row.original);
                setSelectedStudent(mappedStudent);
                setOpen(true);
            } else {
                if (open == true) setOpen(false);
                else setOpen(true);
            }
        }, 250);
    };

    const handleDoubleClick = (e: React.MouseEvent, columnId: string, row: Row<ContactUser>) => {
        e.stopPropagation();
        if (clickTimeout.current) {
            clearTimeout(clickTimeout.current);
            clickTimeout.current = null;
        }
    };

    return { handleClick, handleDoubleClick };
};

const mapContactToStudent = (contact: ContactUser): StudentTable => {
    // Build custom_fields map: prefer v2 customFieldsMap, fallback to custom_fields array
    const customFields: Record<string, string | null> = contact.custom_fields_map || {};
    if (!contact.custom_fields_map && contact.custom_fields) {
        for (const cf of contact.custom_fields) {
            if (cf.custom_field_id) {
                customFields[cf.custom_field_id] = cf.value || null;
            }
        }
    }

    const result: StudentTable = {
        id: contact.user.id,
        user_id: contact.user.id,
        full_name: contact.user.full_name,
        email: contact.user.email,
        username: contact.user.username,
        mobile_number: contact.user.mobile_number,
        gender: contact.user.gender || '',
        region: contact.user.region || null,
        city: contact.user.city || '',
        date_of_birth: contact.user.date_of_birth || '',
        created_at: '',
        address_line: contact.user.address_line || '',
        attendance_percent: 0,
        referral_count: 0,
        pin_code: contact.user.pin_code || '',
        fathers_name: contact.fathers_name || '',
        mothers_name: contact.mothers_name || '',
        father_mobile_number: '',
        father_email: '',
        mother_mobile_number: '',
        mother_email: '',
        linked_institute_name: contact.linked_institute_name || null,
        updated_at: '',
        package_session_id: contact.package_session_id || '',
        // Carry the user's full enrollment list so the side view's "Open portal
        // for" picker can offer every membership (matches the students-list,
        // which gets this via raw-object spread). Falls back to the singular id.
        all_package_session_ids:
            contact.all_package_session_ids ??
            contact.package_session_ids ??
            (contact.package_session_id ? [contact.package_session_id] : []),
        institute_enrollment_id: contact.institute_enrollment_number || '',
        status: (contact.status as 'ACTIVE' | 'TERMINATED' | 'INACTIVE') || 'INACTIVE',
        session_expiry_days: 0,
        institute_id: contact.institute_id || '',
        expiry_date: 0,
        face_file_id: contact.face_file_id || contact.user.profile_pic_file_id || null,
        parents_email: contact.parents_email || '',
        parents_mobile_number: contact.parents_mobile_number || '',
        parents_to_mother_email: contact.parents_to_mother_email || '',
        parents_to_mother_mobile_number: contact.parents_to_mother_mobile_number || '',
        destination_package_session_id: '',
        enroll_invite_id: '',
        payment_status: contact.payment_status || '',
        custom_fields: customFields,
        sub_org_name: contact.sub_org_name,
        sub_org_id: contact.sub_org_id,
        comma_separated_org_roles: contact.comma_separated_org_roles,
    };

    // LeadFormResponseCard reads the lead's form answers off `_response_fields`,
    // which until now only the audience-list flows attached — so opening a lead
    // from Contacts showed the Lead tab with no answers on it at all. The values
    // are already in this response (the API sends field_name and field_type per
    // field), and the loop above already walks them, so this is a re-shape of
    // data we hold, not another request. Attached AFTER the object literal
    // because it is not part of the canonical StudentTable shape.
    (result as unknown as Record<string, unknown>)._response_fields = (contact.custom_fields ?? [])
        .filter((cf) => cf.custom_field_id)
        .map((cf) => ({
            id: cf.custom_field_id,
            name: cf.field_name,
            type: cf.field_type,
            rawValue: cf.value ?? null,
        }));

    return result;
};

const DetailsCell = ({ row }: { row: Row<ContactUser> }) => {
    const { setSelectedStudent } = useStudentSidebar();

    const handleOpenDrawer = () => {
        // Open the compact side-view sheet (via SidebarTrigger), NOT the
        // fullscreen overlay — matches the student-list Details arrow.
        setSelectedStudent(mapContactToStudent(row.original), { openOverlay: false });
    };

    return (
        <div className="flex items-center gap-1">
            <SidebarTrigger onClick={handleOpenDrawer}>
                <span
                    className="flex size-7 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-700"
                    title="Open side panel"
                    aria-label="Open side panel"
                >
                    <ArrowSquareOut className="size-4" />
                </span>
            </SidebarTrigger>
        </div>
    );
};

const CreateClickableCell = ({ row, columnId }: { row: Row<ContactUser>; columnId: string }) => {
    const { handleClick, handleDoubleClick } = useClickHandlers();

    // Handle nested access or root access
    // TanStack table usually handles accessors automatically for getValue,
    // but here we are using manual columnId in handleClick which expects a flat structure key maybe?
    // Actually handleClick just passes the key.

    // Get value from row (works with nested accessorKey)
    const value = row.getValue(columnId) as string;

    return (
        <div
            onClick={() => handleClick(columnId, row)}
            onDoubleClick={(e) => handleDoubleClick(e, columnId, row)}
            className="cursor-pointer truncate"
        >
            {value || '-'}
        </div>
    );
};

/**
 * What the "Manage Column" list calls a column: its header text. The Name header is a sort
 * dropdown rather than text, so it gets its plain name.
 */
export const getContactColumnLabel = (column: ColumnDef<ContactUser>): string => {
    if (typeof column.header === 'string') return column.header;
    if (column.id === 'user.full_name') return 'Name';
    return column.id ?? '';
};

export const getContactColumns = (
    onSort?: (columnId: string, direction: string) => void,
    showLeadScore = false,
    onAssignCounselor?: (userId: string, userName: string) => void,
    showCounselor = false
): ColumnDef<ContactUser>[] => [
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
        id: 'user.full_name',
        accessorKey: 'user.full_name',
        size: 200,
        header: () => (
            <MyDropdown
                dropdownList={['ASC', 'DESC']}
                onSelect={(value) => {
                    if (typeof value == 'string' && onSort) onSort('full_name', value);
                }}
            >
                <button className="flex w-full cursor-pointer items-center justify-between">
                    <div>Name</div>
                    <CaretUpDown />
                </button>
            </MyDropdown>
        ),
        // Tier and score have their own Lead Status / Lead Points columns, so none here.
        cell: ({ row }) => (
            <div className="flex flex-col gap-0.5">
                <CreateClickableCell row={row} columnId="user.full_name" />
                <DuplicateBadge isDuplicate={row.original.is_duplicate} />
            </div>
        ),
    },
    {
        id: 'user.username',
        accessorKey: 'user.username',
        header: 'Username',
        size: 150,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="user.username" />,
    },
    {
        id: 'user.email',
        accessorKey: 'user.email',
        header: 'Email',
        size: 200,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="user.email" />,
    },
    {
        id: 'user.mobile_number',
        accessorKey: 'user.mobile_number',
        header: 'Mobile',
        size: 150,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="user.mobile_number" />,
    },
    {
        id: 'user.gender',
        accessorKey: 'user.gender',
        header: 'Gender',
        size: 100,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="user.gender" />,
    },
    {
        id: 'user.region',
        accessorKey: 'user.region',
        header: 'Region',
        size: 150,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="user.region" />,
    },
    {
        id: 'user.city',
        accessorKey: 'user.city',
        header: 'City',
        size: 150,
        cell: ({ row }) => <CreateClickableCell row={row} columnId="user.city" />,
    },
    {
        // created_at seems missing from user object in provided JSON,
        // fallback to last_login_time or remove if strictly needed from root?
        // JSON shows last_login_time.
        // Let's use last_login_time for now as created_at is not in the sample JSON user object.
        // Explicit id, like its neighbours: Manage Column saves the layout by column id.
        id: 'user.last_login_time',
        accessorKey: 'user.last_login_time',
        header: 'Last Login',
        size: 150,
        cell: ({ row }) => {
            const val = row.original.user.last_login_time;
            return <div className="truncate">{val ? new Date(val).toLocaleDateString() : '-'}</div>;
        },
    },
    {
        id: 'source',
        header: 'Source',
        size: 180,
        cell: ({ row }) => {
            const isInst = row.original.is_institute_user;
            const isAud = row.original.is_audience_respondent;
            const sources = [];
            if (isInst) sources.push('Institute');
            if (isAud) sources.push('Audience');
            return <div>{sources.join(', ')}</div>;
        },
    },
    ...(showLeadScore
        ? [
              {
                  id: 'lead_status',
                  header: 'Lead Status',
                  size: 200,
                  cell: ({ row }: { row: Row<ContactUser> }) => {
                      const score = row.original.lead_score;
                      const status = row.original.lead_conversion_status;
                      const isConverted = status === 'CONVERTED';
                      if (isConverted) {
                          return (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                                  Converted
                              </span>
                          );
                      }
                      if (status === 'LOST') {
                          return (
                              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                                  Lost
                              </span>
                          );
                      }
                      const tier = row.original.lead_tier;
                      if (score != null || (tier != null && tier !== '')) {
                          // Score lives in the Lead Points column right next to this one.
                          return (
                              <LeadScoreBadge
                                  score={score}
                                  tier={tier}
                                  showScore={false}
                                  size="sm"
                              />
                          );
                      }
                      return <span className="text-xs text-neutral-400">—</span>;
                  },
              } as ColumnDef<ContactUser>,
              {
                  id: 'lead_points',
                  header: 'Lead Points',
                  size: 110,
                  cell: ({ row }: { row: Row<ContactUser> }) => {
                      const score = row.original.lead_score;
                      const isConverted = row.original.lead_conversion_status === 'CONVERTED';
                      if (isConverted || score == null) {
                          return <span className="text-xs text-neutral-400">—</span>;
                      }
                      return (
                          <span className="text-sm font-semibold text-neutral-700">{score}</span>
                      );
                  },
              } as ColumnDef<ContactUser>,
          ]
        : []),
    ...(showCounselor
        ? [
              {
                  id: 'counsellor',
                  header: 'Counsellor',
                  size: 160,
                  cell: ({ row }: { row: Row<ContactUser> }) => {
                      const userId = row.original.user?.id;
                      const userName = row.original.user?.full_name ?? '';
                      const assignedName = row.original.assigned_counselor_name;
                      if (assignedName) {
                          return (
                              <button
                                  className="flex items-center gap-1 truncate text-sm text-neutral-700 hover:text-primary-600"
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      if (onAssignCounselor && userId)
                                          onAssignCounselor(userId, userName);
                                  }}
                                  title="Click to reassign"
                              >
                                  <UserCircle className="size-4 shrink-0 text-neutral-400" />
                                  <span className="truncate">{assignedName}</span>
                              </button>
                          );
                      }
                      return (
                          <button
                              className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-primary-50 hover:text-primary-700"
                              onClick={(e) => {
                                  e.stopPropagation();
                                  if (onAssignCounselor && userId)
                                      onAssignCounselor(userId, userName);
                              }}
                          >
                              Assign
                          </button>
                      );
                  },
              } as ColumnDef<ContactUser>,
          ]
        : []),
];
