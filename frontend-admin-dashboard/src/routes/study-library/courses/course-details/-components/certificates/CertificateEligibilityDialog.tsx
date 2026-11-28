import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
    getLearnerCertificateEligibility,
    type CertificateTestStatus,
} from '../../-services/course-certificates';

interface CertificateEligibilityDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    instituteId: string;
    packageSessionId: string;
    userId: string | null;
    learnerName: string | null;
}

const STATUS_CHIP: Record<CertificateTestStatus, StatusType> = {
    PASSED: 'SUCCESS',
    COMPLETED: 'SUCCESS',
    FAILED: 'DANGER',
    AWAITING_RESULT: 'WARNING',
    NOT_ATTEMPTED: 'INFO',
};

/** One learner's standing against the course's certificate rule, test by test. */
export const CertificateEligibilityDialog = ({
    open,
    onOpenChange,
    instituteId,
    packageSessionId,
    userId,
    learnerName,
}: CertificateEligibilityDialogProps) => {
    const { t } = useTranslation('studyLibraryCertificateCriteria');

    const { data, isLoading, isError } = useQuery({
        queryKey: ['course-certificate-eligibility', instituteId, packageSessionId, userId],
        queryFn: () =>
            getLearnerCertificateEligibility({
                instituteId,
                packageSessionId,
                userId: userId as string,
            }),
        enabled: open && !!userId && !!instituteId && !!packageSessionId,
    });

    const ruleLine = (() => {
        if (!data || !data.score_required) return null;
        if (data.pass_rule === 'AVERAGE') {
            return t('dialog.ruleAverage', {
                bar: data.pass_percent ?? 0,
                avg: data.average_score_percent ?? 0,
            });
        }
        if (data.pass_rule === 'AT_LEAST') {
            return t('dialog.ruleAtLeast', {
                required: data.tests_required ?? 0,
                passed: data.tests_passed,
                total: data.tests_total,
            });
        }
        return t('dialog.ruleAll', { passed: data.tests_passed, total: data.tests_total });
    })();

    return (
        <MyDialog
            heading={learnerName ? `${t('dialog.heading')} · ${learnerName}` : t('dialog.heading')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-xl"
            footer={
                <div className="flex w-full justify-end">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('dialog.close')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4 p-2">
                {isLoading && (
                    <div className="flex flex-col gap-2">
                        <span className="text-caption text-neutral-500">{t('dialog.loading')}</span>
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-5 w-1/2" />
                        <Skeleton className="h-5 w-3/5" />
                    </div>
                )}

                {isError && (
                    <p className="rounded-md border border-danger-200 bg-danger-50 p-3 text-caption text-danger-600">
                        {t('dialog.error')}
                    </p>
                )}

                {data && (
                    <>
                        <StatusChip
                            text={data.eligible ? t('dialog.eligible') : t('dialog.notEligible')}
                            textSize="text-caption"
                            status={data.eligible ? 'SUCCESS' : 'WARNING'}
                        />

                        <div className="flex flex-col gap-1 rounded-md bg-neutral-50 p-3">
                            {data.progress_required && (
                                <p className="text-body text-neutral-700">
                                    {t('dialog.progressLine', {
                                        pct: Math.floor(data.completion_percentage ?? 0),
                                        threshold: data.threshold_percent,
                                    })}
                                </p>
                            )}
                            {ruleLine && <p className="text-body text-neutral-700">{ruleLine}</p>}
                            {data.score_blocker && (
                                <p className="text-caption text-danger-600">
                                    {t(`dialog.blocker.${data.score_blocker}`)}
                                </p>
                            )}
                        </div>

                        {data.tests.length > 0 && (
                            <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
                                {data.tests.map((test) => (
                                    <li
                                        key={test.slide_id}
                                        className="flex flex-wrap items-center justify-between gap-2 p-3"
                                    >
                                        <div className="flex min-w-0 flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate text-body text-neutral-700">
                                                    {test.title || t('picker.untitled')}
                                                </span>
                                                <Badge variant="outline">
                                                    {t(`type.${test.type}`)}
                                                </Badge>
                                            </div>
                                            <span className="text-caption text-neutral-400">
                                                {[test.module_name, test.chapter_name]
                                                    .filter(Boolean)
                                                    .join(' › ')}
                                            </span>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            <StatusChip
                                                text={t(`dialog.status.${test.status}`)}
                                                textSize="text-caption"
                                                status={STATUS_CHIP[test.status]}
                                                showIcon={false}
                                            />
                                            <span className="text-caption text-neutral-500">
                                                {[
                                                    test.score_percent !== null
                                                        ? t('dialog.score', {
                                                              pct: test.score_percent,
                                                          })
                                                        : null,
                                                    test.pass_percent !== null
                                                        ? t('dialog.passMark', {
                                                              pct: test.pass_percent,
                                                          })
                                                        : null,
                                                    test.attempts > 0
                                                        ? t('dialog.attempts', {
                                                              count: test.attempts,
                                                          })
                                                        : null,
                                                ]
                                                    .filter(Boolean)
                                                    .join(' · ')}
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </div>
        </MyDialog>
    );
};
