// batch-section.tsx
import { useState } from 'react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyDropdown } from '@/components/design-system/dropdown';
import {
    BatchType,
    batchWithStudentDetails,
} from '@/routes/manage-institute/batches/-types/manage-batches-types';
import {
    BookOpen,
    CalendarBlank,
    Copy,
    DotsThreeVertical,
    Eye,
    LinkSimple,
    Plus,
    TrashSimple,
    Users,
} from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { BulkAssignDialog } from '@/routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/BulkAssignDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteBatches } from '@/routes/manage-institute/batches/-services/delete-batches';
import { toast } from 'sonner';
import createInviteLink from '@/routes/manage-students/invite/-utils/createInviteLink';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, RoleTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { cn, convertCapitalToTitleCase } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
    BatchDisplayStatus,
    getBatchDisplayStatus,
} from '@/routes/manage-institute/batches/-utils/batch-filters';
import type { BatchView } from './batches-toolbar';

/** Cards shown per course before "Show all" — a course can carry hundreds of batches. */
const INITIAL_VISIBLE = 9;

const STATUS_STYLES: Record<BatchDisplayStatus, { pill: string; dot: string }> = {
    active: { pill: 'bg-success-50 text-success-600', dot: 'bg-success-500' },
    upcoming: { pill: 'bg-info-50 text-info-600', dot: 'bg-info-500' },
    inactive: { pill: 'bg-neutral-100 text-neutral-500', dot: 'bg-neutral-400' },
};

const BatchStatusPill = ({ batch }: { batch: BatchType }) => {
    const { t } = useTranslation('manageInstituteBatchSection');
    const status = getBatchDisplayStatus(batch);
    return (
        <span
            className={cn(
                'inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium',
                STATUS_STYLES[status].pill
            )}
        >
            <span className={cn('size-1.5 rounded-full', STATUS_STYLES[status].dot)} />
            {t(`status.${status}`)}
        </span>
    );
};

/** Everything one batch can do — shared by the card and the list row. */
const useBatchActions = (batch: BatchType) => {
    const { t } = useTranslation('manageInstituteBatchSection');
    const navigate = useNavigate();
    const deleteBatchesMutation = useDeleteBatches();
    const { instituteDetails } = useInstituteDetailsStore();
    const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
    // `batch` is read back as a package_session id — the learner list matches it
    // against batches_for_sessions to hydrate its Batch filter chip. It used to be
    // sent as a display label, which matched no id, so View Batch landed on a list
    // that was silently pinned to this batch with no filter shown for it.
    const viewBatch = () =>
        navigate({
            to: '/manage-students/students-list',
            search: {
                batch: batch.package_session_id,
                package_session_id: batch.package_session_id,
            },
        });

    // A batch with no invite used to copy ".../learner-invitation-response?inviteCode=null"
    // and still toast success.
    const copyInviteLink = () => {
        if (!batch.invite_code) return;
        navigator.clipboard.writeText(
            createInviteLink(batch.invite_code, instituteDetails?.learner_portal_base_url)
        );
        toast.success(t('toast.inviteLinkCopied'));
    };

    const deleteBatch = () =>
        deleteBatchesMutation.mutate(
            { packageSessionIds: [batch.package_session_id] },
            {
                onSuccess: () => {
                    toast.success(t('toast.batchDeletedSuccess'));
                    setOpenDeleteDialog(false);
                },
                onError: () => {
                    toast.error(t('toast.batchDeleteFailed'));
                },
            }
        );

    const menu = (
        <MyDropdown
            dropdownList={[
                { value: 'view', label: t('menu.view'), icon: <Eye size={16} /> },
                ...(batch.invite_code
                    ? [
                          {
                              value: 'copy',
                              label: t('menu.copyInvite'),
                              icon: <LinkSimple size={16} />,
                          },
                      ]
                    : []),
                {
                    value: 'delete',
                    label: t('menu.delete'),
                    icon: <TrashSimple size={16} className="text-danger-500" />,
                },
            ]}
            handleChange={(value) => {
                if (value === 'view') viewBatch();
                if (value === 'copy') copyInviteLink();
                if (value === 'delete') setOpenDeleteDialog(true);
            }}
        >
            <span
                aria-label={t('menu.label')}
                className="flex size-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
            >
                <DotsThreeVertical size={20} weight="bold" />
            </span>
        </MyDropdown>
    );

    const deleteDialog = (
        <MyDialog
            heading={t('deleteDialog.heading')}
            open={openDeleteDialog}
            onOpenChange={setOpenDeleteDialog}
            dialogWidth="w-full max-w-md"
            footer={
                <div className="flex w-full items-center justify-end gap-3 py-2">
                    <MyButton buttonType="secondary" onClick={() => setOpenDeleteDialog(false)}>
                        {t('deleteDialog.cancel')}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        onClick={deleteBatch}
                        disable={deleteBatchesMutation.isPending}
                        className="border-danger-300 !text-danger-600 hover:border-danger-500 hover:bg-danger-50"
                    >
                        {t('deleteDialog.confirm')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-2 text-body text-neutral-600">
                <p>{t('deleteDialog.confirmMessage', { batchName: batch.batch_name })}</p>
                {batch.count_students > 0 && (
                    <p className="rounded-md bg-warning-50 px-3 py-2 text-warning-700">
                        {t('deleteDialog.learnerWarning', {
                            count: batch.count_students,
                            learner: getTerminology(
                                RoleTerms.Learner,
                                SystemTerms.Learner
                            ).toLocaleLowerCase(),
                            learners: getTerminologyPlural(
                                RoleTerms.Learner,
                                SystemTerms.Learner
                            ).toLocaleLowerCase(),
                        })}
                    </p>
                )}
            </div>
        </MyDialog>
    );

    return { viewBatch, copyInviteLink, menu, deleteDialog };
};

const InviteCode = ({ batch, onCopy }: { batch: BatchType; onCopy: () => void }) => {
    const { t } = useTranslation('manageInstituteBatchSection');
    return (
        <div className="flex items-center gap-2">
            <span className="min-w-12 rounded-md bg-neutral-100 px-3 py-1 text-center font-mono text-caption text-neutral-700">
                {batch.invite_code || '—'}
            </span>
            <MyButton
                type="button"
                layoutVariant="icon"
                buttonType="text"
                scale="small"
                onClick={onCopy}
                disable={!batch.invite_code}
                aria-label={t('menu.copyInvite')}
                className="text-neutral-500 hover:text-neutral-700"
            >
                <Copy size={16} />
            </MyButton>
        </div>
    );
};

/**
 * Opens the same enroll wizard as the learner list, with this batch already
 * picked. It used to open the old manual-enrol form, which knew nothing of
 * the batch it was clicked on.
 */
const BatchEnrollButton = ({
    batch,
    label,
    className,
}: {
    batch: BatchType;
    label: string;
    className?: string;
}) => {
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();

    return (
        <>
            <MyButton
                buttonType="text"
                scale="medium"
                onClick={() => setOpen(true)}
                className={cn('gap-1.5 !text-neutral-700 hover:!text-primary-500', className)}
            >
                <Plus size={16} />
                {label}
            </MyButton>
            <BulkAssignDialog
                open={open}
                onOpenChange={setOpen}
                initialPackageSessionId={batch.package_session_id}
                // Learner counts on the cards come from this query.
                onSuccess={() => queryClient.invalidateQueries({ queryKey: ['GET_BATCHES'] })}
            />
        </>
    );
};

const BatchCard = ({ batch }: { batch: BatchType }) => {
    const { t } = useTranslation('manageInstituteBatchSection');
    const { viewBatch, copyInviteLink, menu, deleteDialog } = useBatchActions(batch);
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const start = batch.start_date ? dayjs(batch.start_date) : null;

    return (
        <>
            <div className="flex flex-col rounded-xl border border-neutral-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                <div className="flex flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                        <p className="text-title font-semibold text-neutral-800">
                            {convertCapitalToTitleCase(batch.batch_name)}
                        </p>
                        {menu}
                    </div>
                    <BatchStatusPill batch={batch} />
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body text-neutral-600">
                        <span className="flex items-center gap-2">
                            <Users size={18} />
                            {t('batchCard.studentCount', {
                                count: batch.count_students,
                                term: learnerTerm,
                            })}
                        </span>
                        {start?.isValid() && (
                            <span className="flex items-center gap-2 text-neutral-500">
                                <CalendarBlank size={18} />
                                {t(
                                    start.isAfter(dayjs(), 'day')
                                        ? 'batchCard.startsOn'
                                        : 'batchCard.startedOn',
                                    { date: start.format('DD MMM YYYY') }
                                )}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3 text-body text-neutral-600">
                        {t('batchCard.inviteCodeLabel')}
                        <InviteCode batch={batch} onCopy={copyInviteLink} />
                    </div>
                </div>
                <div className="mt-auto grid grid-cols-2 gap-3 border-t border-neutral-100 p-4">
                    <BatchEnrollButton
                        batch={batch}
                        label={t('batchCard.enrollButton', { term: learnerTerm })}
                        className="w-full"
                    />
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={viewBatch}
                        className="w-full gap-2 border-primary-50 bg-primary-50 !text-primary-500 hover:border-primary-100 hover:bg-primary-100"
                    >
                        <Eye size={18} />
                        {t('batchCard.viewBatchButton')}
                    </MyButton>
                </div>
            </div>
            {deleteDialog}
        </>
    );
};

const BatchRow = ({ batch }: { batch: BatchType }) => {
    const { t } = useTranslation('manageInstituteBatchSection');
    const { viewBatch, copyInviteLink, menu, deleteDialog } = useBatchActions(batch);
    const learnerTerm = getTerminology(RoleTerms.Learner, SystemTerms.Learner);
    const start = batch.start_date ? dayjs(batch.start_date) : null;

    return (
        <>
            <div className="flex flex-col gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0 md:grid md:grid-cols-12 md:items-center md:gap-4">
                <p
                    title={convertCapitalToTitleCase(batch.batch_name)}
                    className="truncate text-subtitle font-semibold text-neutral-800 md:col-span-2"
                >
                    {convertCapitalToTitleCase(batch.batch_name)}
                </p>
                <div className="md:col-span-2">
                    <BatchStatusPill batch={batch} />
                </div>
                <div className="flex items-center gap-2 text-body text-neutral-600 md:col-span-2">
                    <Users size={16} />
                    {t('batchCard.studentCount', {
                        count: batch.count_students,
                        term: learnerTerm,
                    })}
                </div>
                <div className="md:col-span-2">
                    <InviteCode batch={batch} onCopy={copyInviteLink} />
                </div>
                <p className="text-body text-neutral-500 md:col-span-2">
                    {start?.isValid() ? start.format('DD MMM YYYY') : '—'}
                </p>
                <div className="flex items-center justify-end gap-1 md:col-span-2">
                    <BatchEnrollButton batch={batch} label={t('batchCard.enrollShort')} />
                    <MyButton
                        buttonType="text"
                        scale="medium"
                        onClick={viewBatch}
                        className="gap-1.5"
                    >
                        <Eye size={16} />
                        {t('batchCard.viewShort')}
                    </MyButton>
                    {menu}
                </div>
            </div>
            {deleteDialog}
        </>
    );
};

interface CourseHeaderProps {
    course: batchWithStudentDetails;
    totalBatches: number;
    totalLearners: number;
    onCreateBatch: () => void;
}

const CourseHeader = ({
    course,
    totalBatches,
    totalLearners,
    onCreateBatch,
}: CourseHeaderProps) => {
    const { t } = useTranslation('manageInstituteBatchSection');
    const navigate = useNavigate();
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    return (
        <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-600">
                <BookOpen size={24} />
            </div>
            <div className="flex min-w-0 grow flex-col gap-0.5">
                <p className="truncate text-title font-semibold text-neutral-800">
                    {convertCapitalToTitleCase(course.package_dto.package_name)}
                </p>
                <p className="flex flex-wrap items-center gap-x-3 text-body text-neutral-500">
                    <span>
                        {t('course.totalBatches', {
                            term: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch),
                            count: totalBatches,
                        })}
                    </span>
                    <span className="h-3 w-px bg-neutral-300" />
                    <span>
                        {t('course.totalLearners', {
                            term: getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner),
                            count: totalLearners,
                        })}
                    </span>
                </p>
            </div>
            <MyButton
                buttonType="secondary"
                scale="medium"
                onClick={onCreateBatch}
                className="hidden gap-1.5 sm:flex"
            >
                <Plus size={16} />
                {t('course.addBatch', { term: batchTerm })}
            </MyButton>
            <MyDropdown
                dropdownList={[
                    {
                        value: 'create',
                        label: t('course.createBatch', { term: batchTerm }),
                        icon: <Plus size={16} />,
                    },
                    {
                        value: 'open',
                        label: t('course.openCourse', { term: courseTerm }),
                        icon: <BookOpen size={16} />,
                    },
                ]}
                handleChange={(value) => {
                    if (value === 'create') onCreateBatch();
                    if (value === 'open')
                        navigate({
                            to: '/study-library/courses/course-details',
                            search: { courseId: course.package_dto.id },
                        });
                }}
            >
                <span
                    aria-label={t('menu.label')}
                    className="flex size-9 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                >
                    <DotsThreeVertical size={20} weight="bold" />
                </span>
            </MyDropdown>
        </div>
    );
};

interface BatchSectionProps {
    /** The course with only the batches that pass the current filters, already sorted. */
    course: batchWithStudentDetails;
    totalBatches: number;
    totalLearners: number;
    view: BatchView;
    onCreateBatch: () => void;
}

export const BatchSection = ({
    course,
    totalBatches,
    totalLearners,
    view,
    onCreateBatch,
}: BatchSectionProps) => {
    const { t } = useTranslation('manageInstituteBatchSection');
    const [showAll, setShowAll] = useState(false);
    const visible = showAll ? course.batches : course.batches.slice(0, INITIAL_VISIBLE);
    const hidden = course.batches.length - visible.length;

    return (
        <section className="flex flex-col gap-4">
            <CourseHeader
                course={course}
                totalBatches={totalBatches}
                totalLearners={totalLearners}
                onCreateBatch={onCreateBatch}
            />

            {course.batches.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
                    <p className="text-body text-neutral-500">{t('section.noBatches')}</p>
                    <MyButton buttonType="secondary" scale="medium" onClick={onCreateBatch}>
                        <Plus size={16} className="me-1" />
                        {t('course.createBatch', {
                            term: getTerminology(ContentTerms.Batch, SystemTerms.Batch),
                        })}
                    </MyButton>
                </div>
            ) : view === 'grid' ? (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {visible.map((batch) => (
                        <BatchCard batch={batch} key={batch.package_session_id} />
                    ))}
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                    <div className="hidden border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-caption font-medium uppercase text-neutral-500 md:grid md:grid-cols-12 md:gap-4">
                        <span className="col-span-2">{t('list.name')}</span>
                        <span className="col-span-2">{t('list.status')}</span>
                        <span className="col-span-2">
                            {getTerminology(RoleTerms.Learner, SystemTerms.Learner)}
                        </span>
                        <span className="col-span-2">{t('list.inviteCode')}</span>
                        <span className="col-span-2">{t('list.startDate')}</span>
                        <span className="col-span-2" />
                    </div>
                    {visible.map((batch) => (
                        <BatchRow batch={batch} key={batch.package_session_id} />
                    ))}
                </div>
            )}

            {hidden > 0 && (
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => setShowAll(true)}
                    className="self-center"
                >
                    {t('section.showAll', { count: course.batches.length })}
                </MyButton>
            )}
        </section>
    );
};
