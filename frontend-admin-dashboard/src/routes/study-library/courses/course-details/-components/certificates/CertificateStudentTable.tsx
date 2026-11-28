import { useMemo, useState } from 'react';
import { useDebounce } from 'use-debounce';
import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise, DownloadSimple, Eye, PaperPlaneTilt } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyTable, type TableData } from '@/components/design-system/table';
import { MyPagination } from '@/components/design-system/pagination';
import { MyDialog } from '@/components/design-system/dialog';
import { Badge } from '@/components/ui/badge';
import {
    getCourseCertificateLearners,
    issueCourseCertificate,
    resendCourseCertificate,
    type CourseCertificateLearner,
} from '../../-services/course-certificates';
import { CertificateEligibilityDialog } from './CertificateEligibilityDialog';

interface CertificateStudentTableProps {
    instituteId: string;
    packageSessionId: string;
    packageId: string;
    courseName?: string;
    /**
     * Whether certificates are switched on for this course. When false the
     * issuing actions are disabled — the backend refuses them anyway, and
     * offering a Generate button directly under a "certificates are turned off"
     * banner just invites a confusing error.
     */
    certificatesEnabled: boolean;
}

const PAGE_SIZE = 25;

const buildStatusLabel = (
    t: TFunction
): Record<CourseCertificateLearner['status'], string> => ({
    GENERATED: t('status.generated'),
    AWAITING: t('status.awaiting'),
    PENDING: t('status.pending'),
});

const STATUS_VARIANT: Record<
    CourseCertificateLearner['status'],
    'default' | 'secondary' | 'outline'
> = {
    GENERATED: 'default',
    AWAITING: 'secondary',
    PENDING: 'outline',
};

export const CertificateStudentTable = ({
    instituteId,
    packageSessionId,
    packageId,
    courseName,
    certificatesEnabled,
}: CertificateStudentTableProps) => {
    const { t } = useTranslation('studyLibraryCertificateStudentTable');
    const { t: tCriteria } = useTranslation('studyLibraryCertificateCriteria');
    const [page, setPage] = useState(0);
    const [search, setSearch] = useState('');
    // Under a test-score rule every request grades the whole batch, so a request per
    // keystroke is real server load. Query on the settled value only.
    const [debouncedSearch] = useDebounce(search, 400);
    // The learner whose test-by-test results are open, and the one an admin is
    // about to issue for past the course rule.
    const [detailsFor, setDetailsFor] = useState<CourseCertificateLearner | null>(null);
    const [issueAnywayFor, setIssueAnywayFor] = useState<CourseCertificateLearner | null>(null);
    const queryClient = useQueryClient();

    const {
        data: learnerPage,
        isLoading,
        error,
    } = useQuery({
        queryKey: ['course-certificate-learners', packageSessionId, debouncedSearch, page],
        queryFn: () =>
            getCourseCertificateLearners({
                instituteId,
                packageSessionId,
                packageId,
                search: debouncedSearch || undefined,
                page,
                size: PAGE_SIZE,
            }),
        enabled: !!packageSessionId && !!instituteId,
    });

    // The backend fills the test fields only when the course has a test-score rule.
    const showTests = !!learnerPage?.content.some(
        (row) => row.tests_total !== null && row.tests_total !== undefined
    );

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ['course-certificate-learners'] });
        queryClient.invalidateQueries({ queryKey: ['course-certificate-dashboard'] });
    };

    const issueMutation = useMutation({
        mutationFn: (vars: { userId: string; regenerate: boolean; force?: boolean }) =>
            issueCourseCertificate({
                instituteId,
                packageSessionId,
                userId: vars.userId,
                regenerate: vars.regenerate,
                courseName,
                force: vars.force,
            }),
        onSuccess: (_data, vars) => {
            setIssueAnywayFor(null);
            toast.success(
                vars.regenerate ? t('toast.regenerated') : t('toast.generated'),
                {
                    description: vars.regenerate
                        ? t('toast.regeneratedDescription')
                        : t('toast.generatedDescription'),
                }
            );
            invalidate();
        },
        onError: (_error, vars) => {
            // The backend refuses when certificates are switched off for this
            // course, or the learner has not met the course rule — say so rather
            // than showing a bare failure. "Issue anyway" skips the rule, so only
            // the on/off switch can refuse it.
            toast.error(t('toast.generateError'), {
                description: vars.force
                    ? tCriteria('table.issueAnywayError')
                    : showTests
                      ? tCriteria('table.generateErrorRule')
                      : t('toast.generateErrorDescription'),
            });
        },
    });

    const resendMutation = useMutation({
        mutationFn: (certificateId: string) => resendCourseCertificate(instituteId, certificateId),
        onSuccess: () => toast.success(t('toast.emailSent')),
        onError: () => toast.error(t('toast.emailError')),
    });

    /**
     * Save the certificate PDF under its certificate number.
     *
     * <p>The naive `a.download = name; a.click()` does not work here: the file is
     * served from S3, and browsers ignore the `download` attribute cross-origin —
     * the PDF opens in a tab under a random name instead of saving. An anchor
     * that is never appended to the DOM is also ignored by some browsers. So
     * fetch the bytes and download from a same-origin blob URL, falling back to
     * opening the file if the fetch is blocked (e.g. by CORS).
     */
    const downloadCertificate = async (learner: CourseCertificateLearner) => {
        if (!learner.file_id) return;
        const fileName = `${learner.certificate_number ?? 'certificate'}.pdf`;
        try {
            const response = await fetch(learner.file_id);
            if (!response.ok) throw new Error(String(response.status));
            const blobUrl = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);
        } catch {
            window.open(learner.file_id, '_blank', 'noopener,noreferrer');
            toast.info(t('toast.openedInNewTab'), {
                description: t('toast.openedInNewTabDescription'),
            });
        }
    };

    const statusLabel = useMemo(() => buildStatusLabel(t), [t]);

    const testsColumn: ColumnDef<CourseCertificateLearner> = useMemo(
        () => ({
            id: 'tests',
            header: tCriteria('table.testsColumn'),
            cell: ({ row }) => {
                const learner = row.original;
                const total = learner.tests_total ?? 0;
                const awaiting = learner.tests_awaiting_result ?? 0;
                const average = learner.average_score_percent;
                // Only an AVERAGE rule leaves tests_required empty once there are tests.
                const isAverageRule =
                    total > 0 &&
                    (learner.tests_required === null || learner.tests_required === undefined);
                return (
                    <button
                        type="button"
                        onClick={() => setDetailsFor(learner)}
                        className="flex flex-col items-start text-start hover:underline"
                    >
                        <span
                            className={
                                learner.score_met
                                    ? 'text-body text-success-600'
                                    : 'text-body text-neutral-700'
                            }
                        >
                            {isAverageRule
                                ? tCriteria('table.average', {
                                      pct: average === null || average === undefined ? 0 : average,
                                  })
                                : tCriteria('table.passedOf', {
                                      passed: learner.tests_passed ?? 0,
                                      total,
                                  })}
                        </span>
                        <span className="text-caption text-neutral-400">
                            {awaiting > 0
                                ? tCriteria('table.awaiting', { count: awaiting })
                                : tCriteria('table.viewDetails')}
                        </span>
                    </button>
                );
            },
        }),
        [tCriteria]
    );

    const columns: ColumnDef<CourseCertificateLearner>[] = useMemo(
        () => [
            {
                accessorKey: 'full_name',
                header: t('columns.learner'),
                cell: ({ row }) => (
                    <div className="flex flex-col">
                        <span className="text-body text-neutral-700">
                            {row.original.full_name || '—'}
                        </span>
                        {row.original.email && (
                            <span className="text-caption text-neutral-400">
                                {row.original.email}
                            </span>
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'completion_percentage',
                header: t('columns.completion'),
                cell: ({ row }) => {
                    const pct = row.original.completion_percentage;
                    return (
                        <span className="text-body text-neutral-600">
                            {pct === null || pct === undefined ? '—' : `${Math.floor(pct)}%`}
                        </span>
                    );
                },
            },
            ...(showTests ? [testsColumn] : []),
            {
                accessorKey: 'status',
                header: t('columns.status'),
                cell: ({ row }) => {
                    const status = row.original.status;
                    return <Badge variant={STATUS_VARIANT[status]}>{statusLabel[status]}</Badge>;
                },
            },
            {
                accessorKey: 'issued_at',
                header: t('columns.generatedOn'),
                cell: ({ row }) => {
                    const raw = row.original.issued_at;
                    return (
                        <span className="text-body text-neutral-600">
                            {raw ? new Date(raw).toLocaleDateString() : '—'}
                        </span>
                    );
                },
            },
            {
                accessorKey: 'certificate_number',
                header: t('columns.certificateNumber'),
                cell: ({ row }) => (
                    <span className="text-body text-neutral-600">
                        {row.original.certificate_number || '—'}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: t('columns.actions'),
                cell: ({ row }) => {
                    const learner = row.original;
                    const hasCertificate = !!learner.certificate_number;
                    const busy = issueMutation.isPending || resendMutation.isPending;
                    // Generate / Regenerate / Resend all issue or re-issue, so
                    // they follow the course's enable state. Preview and
                    // Download only read an already-issued file and stay live.
                    const issuingBlocked = busy || !certificatesEnabled;

                    if (!hasCertificate) {
                        // Past the course rule: issue normally. Not past it: the
                        // backend would refuse, so offer an explicit, confirmed
                        // "Issue anyway" (offline exam, special case) instead.
                        if (learner.status !== 'AWAITING') {
                            return (
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    type="button"
                                    disable={issuingBlocked}
                                    onClick={() => setIssueAnywayFor(learner)}
                                >
                                    {tCriteria('table.issueAnyway')}
                                </MyButton>
                            );
                        }
                        return (
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                type="button"
                                disable={issuingBlocked}
                                onClick={() =>
                                    issueMutation.mutate({
                                        userId: learner.user_id,
                                        regenerate: false,
                                    })
                                }
                            >
                                {t('actions.generate')}
                            </MyButton>
                        );
                    }

                    return (
                        <div className="flex items-center gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                type="button"
                                disable={!learner.file_id}
                                onClick={() =>
                                    learner.file_id &&
                                    window.open(learner.file_id, '_blank', 'noopener,noreferrer')
                                }
                            >
                                <Eye />
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                type="button"
                                disable={!learner.file_id}
                                onClick={() => void downloadCertificate(learner)}
                            >
                                <DownloadSimple />
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                type="button"
                                disable={issuingBlocked || !learner.certificate_number}
                                onClick={() =>
                                    learner.certificate_number &&
                                    resendMutation.mutate(learner.certificate_number)
                                }
                            >
                                <PaperPlaneTilt />
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                type="button"
                                disable={issuingBlocked}
                                onClick={() =>
                                    issueMutation.mutate({
                                        userId: learner.user_id,
                                        regenerate: true,
                                    })
                                }
                            >
                                <ArrowClockwise />
                            </MyButton>
                        </div>
                    );
                },
            },
        ],
        [
            issueMutation,
            resendMutation,
            certificatesEnabled,
            statusLabel,
            t,
            tCriteria,
            showTests,
            testsColumn,
        ]
    );

    const tableData: TableData<CourseCertificateLearner> | undefined = useMemo(() => {
        if (!learnerPage) return undefined;
        return {
            content: learnerPage.content,
            total_pages: learnerPage.totalPages,
            page_no: learnerPage.pageNo,
            page_size: learnerPage.pageSize,
            total_elements: learnerPage.totalElements,
            last: learnerPage.last,
        };
    }, [learnerPage]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
                <MyInput
                    inputType="text"
                    input={search}
                    onChangeFunction={(e) => {
                        setSearch(e.target.value);
                        setPage(0);
                    }}
                    inputPlaceholder={t('searchPlaceholder')}
                    className="sm:w-96"
                />
                {tableData && (
                    <span className="text-caption text-neutral-500">
                        {t('learnerCount', { count: tableData.total_elements })}
                    </span>
                )}
            </div>

            {!isLoading && tableData && tableData.content.length === 0 ? (
                <div className="py-8 text-center text-body text-neutral-500">
                    {search ? t('emptyState.noMatch') : t('emptyState.noLearners')}
                </div>
            ) : (
                <>
                    <MyTable<CourseCertificateLearner>
                        data={tableData}
                        columns={columns}
                        isLoading={isLoading}
                        error={error}
                        currentPage={page}
                        scrollable
                    />
                    {tableData && tableData.total_pages > 1 && (
                        <MyPagination
                            currentPage={page}
                            totalPages={tableData.total_pages}
                            onPageChange={setPage}
                        />
                    )}
                </>
            )}

            <CertificateEligibilityDialog
                open={!!detailsFor}
                onOpenChange={(open) => !open && setDetailsFor(null)}
                instituteId={instituteId}
                packageSessionId={packageSessionId}
                userId={detailsFor?.user_id ?? null}
                learnerName={detailsFor?.full_name ?? null}
            />

            <MyDialog
                heading={tCriteria('table.issueAnywayTitle')}
                open={!!issueAnywayFor}
                onOpenChange={(open) => !open && setIssueAnywayFor(null)}
                dialogWidth="max-w-md"
                footer={
                    <div className="flex w-full items-center justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            type="button"
                            onClick={() => setIssueAnywayFor(null)}
                        >
                            {tCriteria('table.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            type="button"
                            disable={issueMutation.isPending || !issueAnywayFor}
                            onClick={() =>
                                issueAnywayFor &&
                                issueMutation.mutate({
                                    userId: issueAnywayFor.user_id,
                                    regenerate: false,
                                    force: true,
                                })
                            }
                        >
                            {tCriteria('table.issueAnywayConfirm')}
                        </MyButton>
                    </div>
                }
            >
                <p className="p-2 text-body text-neutral-600">
                    {tCriteria('table.issueAnywayBody', {
                        name: issueAnywayFor?.full_name || tCriteria('table.thisLearner'),
                    })}
                </p>
            </MyDialog>
        </div>
    );
};
