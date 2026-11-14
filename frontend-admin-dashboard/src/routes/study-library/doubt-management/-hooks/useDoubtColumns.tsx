import { ColumnDef } from '@tanstack/react-table';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { useDoubtTable } from './useDoubtTable';
import { DoubtCell } from '../-components/doubt-table/doubt-cell';
import { MarkAsResolvedCell } from '../-components/doubt-table/mark-as-resolved-cell';
import { BatchCell } from '../-components/doubt-table/batch-cell';
import { TypeCell } from '../-components/doubt-table/type-cell';
import { CategoryCell } from '../-components/doubt-table/category-cell';
import { AssigneeCell } from '../-components/doubt-table/assignee-cell';
import { ActionsCell } from '../-components/doubt-table/actions-cell';
import { NavigateCell } from '../-components/doubt-table/navigate-cell';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useTranslation } from 'react-i18next';

const getInitials = (name?: string) => {
    const cleaned = (name ?? '').trim();
    if (!cleaned) return '?';
    const parts = cleaned.split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
    return (first + last).toUpperCase();
};

const formatDateAndTime = (
    iso: string | null | undefined,
    locale: string
): { date: string; time: string } | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return {
        date: d.toLocaleDateString(locale, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        }),
        time: d.toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        }),
    };
};

const DateStack = ({ iso, locale }: { iso?: string | null; locale: string }) => {
    const parts = formatDateAndTime(iso, locale);
    if (!parts) {
        return <span className="text-xs text-neutral-400">—</span>;
    }
    return (
        <div className="flex flex-col leading-tight">
            <span className="text-sm font-medium text-neutral-800">{parts.date}</span>
            <span className="text-caption text-neutral-500">{parts.time}</span>
        </div>
    );
};

export const useDoubtTableColumns = () => {
    const { t, i18n } = useTranslation('studyLibraryUseDoubtColumns');
    const { refetch, userDetailsRecord } = useDoubtTable();

    const columns: ColumnDef<Doubt>[] = [
        {
            accessorKey: 'navigate',
            header: '',
            cell: ({ row }) => <NavigateCell doubt={row.original} />,
            size: 50,
        },
        {
            accessorKey: 'doubt',
            header: t('columns.doubt'),
            cell: ({ row }) => <DoubtCell doubt={row.original} />,
        },
        {
            accessorKey: 'status',
            header: t('columns.status'),
            cell: ({ row }) => <MarkAsResolvedCell doubt={row.original} refetch={refetch} />,
        },
        {
            accessorKey: 'learner',
            header: getTerminology(RoleTerms.Learner, SystemTerms.Learner),
            cell: ({ row }) => {
                // Logged-out (guest) queries have no user_id — show the contact the guest left.
                const isGuest = !row.original.user_id && !!row.original.guest_name;
                const name = isGuest
                    ? row.original.guest_name!
                    : userDetailsRecord[row.original.user_id]?.name ?? t('learner.unknown');
                return (
                    <div className="flex items-center gap-2">
                        <Avatar className="size-8">
                            <AvatarFallback className="bg-primary-100 text-caption font-semibold text-primary-700">
                                {getInitials(name)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex min-w-0 flex-col">
                            <span className="flex items-center gap-1.5 truncate text-sm font-medium text-neutral-800">
                                {name}
                                {isGuest && (
                                    <span className="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-caption font-semibold text-neutral-500">
                                        {t('learner.guest')}
                                    </span>
                                )}
                            </span>
                            {isGuest && row.original.guest_email && (
                                <span className="truncate text-caption text-neutral-500">
                                    {row.original.guest_email}
                                </span>
                            )}
                        </div>
                    </div>
                );
            },
        },
        {
            accessorKey: 'batch',
            header: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
            cell: ({ row }) => <BatchCell batch_id={row.original.batch_id} />,
        },
        {
            accessorKey: 'category',
            header: t('columns.category'),
            cell: ({ row }) => <CategoryCell doubt={row.original} />,
        },
        {
            accessorKey: 'type',
            header: t('columns.format'),
            cell: ({ row }) => <TypeCell doubt={row.original} />,
        },
        {
            accessorKey: 'assignedTo',
            header: t('columns.assignedTo'),
            cell: ({ row }) => <AssigneeCell doubt={row.original} />,
        },
        {
            accessorKey: 'raised',
            header: t('columns.raised'),
            cell: ({ row }) => <DateStack iso={row.original.raised_time} locale={i18n.language} />,
        },
        {
            accessorKey: 'resolved',
            header: t('columns.resolved'),
            cell: ({ row }) => <DateStack iso={row.original.resolved_time} locale={i18n.language} />,
        },
        {
            accessorKey: 'actions',
            header: t('columns.actions'),
            cell: ({ row }) => <ActionsCell doubt={row.original} refetch={refetch} />,
        },
    ];

    return { columns };
};
