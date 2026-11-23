import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { Step1LearnerSelector } from '@/routes/manage-students/students-list/-components/enroll-bulk/bulk-assign-dialog/steps/Step1LearnerSelector';
import type { SelectedLearner } from '@/routes/manage-students/students-list/-types/bulk-assign-types';
import { SubOrgBulkResults } from '@/routes/manage-custom-teams/-components/sub-org-bulk-results';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    OtherTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';
import {
    bulkAddSubOrgMembers,
    chunkList,
    EMPTY_SUB_ORG_BULK_RESULT,
    failedChunk,
    mergeSubOrgBulkResults,
    SUB_ORG_ADD_CHUNK_SIZE,
    type SubOrgBulkLearner,
    type SubOrgBulkResult,
} from '@/services/sub-org-bulk-members';

type Step = 'PICK' | 'RUNNING' | 'RESULTS';

interface BatchOption {
    id: string;
    label: string;
}

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    subOrgId: string;
    subOrgName?: string;
    instituteId: string;
    /** The sub-org's own batches (its Courses tab). Empty → every batch of the institute. */
    batches: BatchOption[];
}

/** Drops the meaningless "default" level / session so a batch reads as its course name. */
function batchLabel(...parts: (string | null | undefined)[]): string {
    return parts
        .filter((p): p is string => !!p && p.trim().toLowerCase() !== 'default')
        .join(' · ');
}

function toRequestLearner(l: SelectedLearner): SubOrgBulkLearner {
    if (l.type === 'existing') {
        return { id: l.userId, email: l.email || undefined, full_name: l.name || undefined };
    }
    return {
        email: l.newUser.email?.trim() || undefined,
        full_name: l.newUser.full_name?.trim() || undefined,
        mobile_number: l.newUser.mobile_number?.trim() || undefined,
        username: l.newUser.username?.trim() || undefined,
    };
}

/**
 * Sub-org page → Learners tab → "Add learners". Lets the parent institute's admin add many
 * learners to one batch of the sub-org at once: search existing learners, upload a CSV or
 * type them in (the same picker as Bulk Assign). A learner already enrolled in that batch is
 * moved into the sub-org instead of being enrolled twice.
 */
export function AddLearnersToSubOrgDialog({
    open,
    onOpenChange,
    subOrgId,
    subOrgName,
    instituteId,
    batches,
}: Props) {
    const { t } = useTranslation('manageSuborgTeamsAddLearners');
    const queryClient = useQueryClient();
    const { instituteDetails } = useInstituteDetailsStore();
    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const learnersTerm = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
    const batchTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);

    const [step, setStep] = useState<Step>('PICK');
    const [packageSessionId, setPackageSessionId] = useState('');
    const [learners, setLearners] = useState<SelectedLearner[]>([]);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [result, setResult] = useState<SubOrgBulkResult>(EMPTY_SUB_ORG_BULK_RESULT);

    const batchOptions = useMemo<BatchOption[]>(() => {
        if (batches.length > 0) return batches;
        return (instituteDetails?.batches_for_sessions ?? [])
            .filter((b) => !b.status || b.status === 'ACTIVE')
            .map((b) => ({
                id: b.id,
                label:
                    batchLabel(
                        b.package_dto?.package_name,
                        b.level?.level_name,
                        b.session?.session_name
                    ) || b.id,
            }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [batches, instituteDetails]);
    const usingSubOrgBatches = batches.length > 0;

    // Reset on open only. `batches` is rebuilt on every render of the panel, so it must not
    // be a dependency here or every render would wipe the picked learners.
    useEffect(() => {
        if (!open) return;
        setStep('PICK');
        setLearners([]);
        setProgress({ done: 0, total: 0 });
        setResult(EMPTY_SUB_ORG_BULK_RESULT);
        setPackageSessionId('');
    }, [open]);

    // A sub-org with a single batch needs no choice.
    const onlyBatchId = batches.length === 1 ? batches[0]!.id : '';
    useEffect(() => {
        if (open && onlyBatchId) setPackageSessionId((current) => current || onlyBatchId);
    }, [open, onlyBatchId]);

    const runAdd = async () => {
        if (!packageSessionId || learners.length === 0) return;
        const rows = learners.map(toRequestLearner);
        const chunks = chunkList(rows, SUB_ORG_ADD_CHUNK_SIZE);
        setStep('RUNNING');
        setProgress({ done: 0, total: rows.length });
        let total = EMPTY_SUB_ORG_BULK_RESULT;
        for (const part of chunks) {
            try {
                const res = await bulkAddSubOrgMembers({
                    institute_id: instituteId,
                    sub_org_id: subOrgId,
                    package_session_id: packageSessionId,
                    learners: part,
                });
                total = mergeSubOrgBulkResults(total, res);
            } catch (err) {
                const message =
                    (err as { response?: { data?: { message?: string } } })?.response?.data
                        ?.message || t('errors.requestFailed');
                total = mergeSubOrgBulkResults(
                    total,
                    failedChunk(
                        part.map((p) => ({ user_id: p.id, name: p.full_name, email: p.email })),
                        message
                    )
                );
            }
            setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + part.length) }));
        }
        setResult(total);
        setStep('RESULTS');
        queryClient.invalidateQueries({ queryKey: ['sub-org-finance-detail', subOrgId] });
        queryClient.invalidateQueries({ queryKey: ['students'] });
        if (total.failed === 0) {
            toast.success(
                t('toasts.done', {
                    count: total.added + total.moved + total.already_member,
                    name: subOrgName || subOrgTerm,
                })
            );
        }
    };

    const handleOpenChange = (next: boolean) => {
        // Let a run finish: closing mid-way would hide which learners were added.
        if (!next && step === 'RUNNING') return;
        onOpenChange(next);
    };

    const footer =
        step === 'PICK' ? (
            <div className="flex w-full justify-end gap-2">
                <MyButton buttonType="secondary" scale="medium" onClick={() => onOpenChange(false)}>
                    {t('buttons.cancel')}
                </MyButton>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    disable={!packageSessionId || learners.length === 0}
                    onClick={runAdd}
                >
                    {t('buttons.add', { count: learners.length })}
                </MyButton>
            </div>
        ) : step === 'RESULTS' ? (
            <div className="flex w-full justify-end gap-2">
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => {
                        setLearners([]);
                        setStep('PICK');
                    }}
                >
                    {t('buttons.addMore')}
                </MyButton>
                <MyButton buttonType="primary" scale="medium" onClick={() => onOpenChange(false)}>
                    {t('buttons.done')}
                </MyButton>
            </div>
        ) : undefined;

    return (
        <MyDialog
            open={open}
            onOpenChange={handleOpenChange}
            heading={t('heading', {
                learners: learnersTerm,
                name: subOrgName || subOrgTerm,
            })}
            dialogWidth="max-w-3xl"
            footer={footer}
        >
            {step === 'PICK' && (
                <div className="flex flex-col">
                    <div className="flex flex-col gap-2 px-4 pt-4 sm:px-6">
                        <Label>{t('fields.batch', { term: batchTerm })}</Label>
                        {batchOptions.length === 0 ? (
                            <p className="text-caption text-neutral-500">
                                {t('noBatches', { term: batchTerm })}
                            </p>
                        ) : (
                            <SearchableSelect
                                options={batchOptions.map((b) => ({ label: b.label, value: b.id }))}
                                value={packageSessionId}
                                onChange={setPackageSessionId}
                                placeholder={t('fields.batchPlaceholder', { term: batchTerm })}
                                searchPlaceholder={t('fields.search')}
                                emptyText={t('fields.noMatch')}
                            />
                        )}
                        {!usingSubOrgBatches && batchOptions.length > 0 && (
                            <p className="text-caption text-neutral-500">
                                {t('allBatchesHint', { term: subOrgTerm })}
                            </p>
                        )}
                        <div className="flex items-start gap-2 rounded-md bg-primary-50 p-3 text-caption text-neutral-600">
                            <Info className="mt-0.5 size-4 shrink-0 text-primary-500" />
                            <span>{t('hint', { term: subOrgTerm })}</span>
                        </div>
                    </div>
                    <Step1LearnerSelector
                        instituteId={instituteId}
                        selectedLearners={learners}
                        onSelectedLearnersChange={setLearners}
                        hideGuardianControls
                    />
                </div>
            )}

            {step === 'RUNNING' && (
                <div className="flex flex-col gap-2 p-4 sm:p-6">
                    <p className="text-body text-neutral-700">
                        {t('running', { done: progress.done, total: progress.total })}
                    </p>
                    <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                </div>
            )}

            {step === 'RESULTS' && (
                <div className="p-4 sm:p-6">
                    <SubOrgBulkResults result={result} />
                </div>
            )}
        </MyDialog>
    );
}
