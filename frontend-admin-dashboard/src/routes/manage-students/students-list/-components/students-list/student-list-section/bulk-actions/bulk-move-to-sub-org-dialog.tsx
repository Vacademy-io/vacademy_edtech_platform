import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Info } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getSubOrgs } from '@/routes/manage-custom-teams/-services/custom-team-services';
import { SubOrgBulkResults } from '@/routes/manage-custom-teams/-components/sub-org-bulk-results';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import type { BulkActionInfo } from '@/routes/manage-students/students-list/-types/bulk-actions-types';
import {
    chunkList,
    EMPTY_SUB_ORG_BULK_RESULT,
    failedChunk,
    mergeSubOrgBulkResults,
    moveSubOrgMembers,
    SUB_ORG_MOVE_CHUNK_SIZE,
    type SubOrgBulkResult,
} from '@/services/sub-org-bulk-members';

type Step = 'PICK' | 'RUNNING' | 'RESULTS';

interface SubOrgOption {
    id: string;
    name: string;
}

/** get-all answers raw institute_suborg rows; the id / name keys vary by serializer. */
function toSubOrgOption(org: Record<string, unknown>): SubOrgOption | null {
    const pick = (keys: string[]) => {
        for (const k of keys) {
            const v = org?.[k];
            if (typeof v === 'string' && v.trim()) return v;
        }
        return undefined;
    };
    const id = pick(['suborg_id', 'suborgId', 'sub_org_id', 'subOrgId']);
    if (!id) return null;
    return { id, name: pick(['name', 'institute_name', 'instituteName']) ?? id };
}

interface Props {
    info: BulkActionInfo | null;
    onClose: () => void;
}

/**
 * Students list → select → "Move to sub-org". Moves each selected enrollment (learner +
 * the batch the row shows) into the chosen sub-org: same batch, progress and payments,
 * now counted and shown under that sub-org. Sub-org admins are refused by the server.
 */
export function BulkMoveToSubOrgDialog({ info, onClose }: Props) {
    const { t } = useTranslation('manageStudentsBulkMoveToSubOrg');
    const queryClient = useQueryClient();
    const instituteId = getCurrentInstituteId();
    const subOrgTerm = getTerminology(OtherTerms.SubOrg, SystemTerms.SubOrg);
    const open = !!info;

    const [step, setStep] = useState<Step>('PICK');
    const [subOrgId, setSubOrgId] = useState('');
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [result, setResult] = useState<SubOrgBulkResult>(EMPTY_SUB_ORG_BULK_RESULT);

    useEffect(() => {
        if (open) {
            setStep('PICK');
            setSubOrgId('');
            setProgress({ done: 0, total: 0 });
            setResult(EMPTY_SUB_ORG_BULK_RESULT);
        }
    }, [open]);

    const {
        data: rawSubOrgs,
        isLoading,
        isError,
    } = useQuery({
        queryKey: ['sub-orgs-list', instituteId],
        queryFn: () => getSubOrgs(instituteId),
        enabled: open && !!instituteId,
    });

    const subOrgs = useMemo<SubOrgOption[]>(() => {
        const list: Record<string, unknown>[] = Array.isArray(rawSubOrgs)
            ? rawSubOrgs
            : (rawSubOrgs as { content?: Record<string, unknown>[] } | undefined)?.content ?? [];
        const seen = new Set<string>();
        return list
            .map(toSubOrgOption)
            .filter((o): o is SubOrgOption => !!o && !seen.has(o.id) && !!seen.add(o.id))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [rawSubOrgs]);

    const students = info?.selectedStudents ?? [];
    const alreadyThere = subOrgId ? students.filter((s) => s.sub_org_id === subOrgId).length : 0;
    const inOtherSubOrg = subOrgId
        ? students.filter((s) => s.sub_org_id && s.sub_org_id !== subOrgId).length
        : 0;
    const targetName = subOrgs.find((o) => o.id === subOrgId)?.name ?? subOrgTerm;

    const runMove = async () => {
        if (!instituteId || !subOrgId || students.length === 0) return;
        const members = students.map((s) => ({
            user_id: s.user_id,
            package_session_id: s.package_session_id,
        }));
        const labelOf = new Map(
            students.map((s) => [
                `${s.user_id}|${s.package_session_id}`,
                { name: s.full_name, email: s.email },
            ])
        );
        const chunks = chunkList(members, SUB_ORG_MOVE_CHUNK_SIZE);
        setStep('RUNNING');
        setProgress({ done: 0, total: members.length });
        let total = EMPTY_SUB_ORG_BULK_RESULT;
        for (const part of chunks) {
            try {
                const res = await moveSubOrgMembers({
                    institute_id: instituteId,
                    sub_org_id: subOrgId,
                    members: part,
                });
                total = mergeSubOrgBulkResults(total, res);
            } catch (err) {
                const message =
                    (err as { response?: { data?: { message?: string } } })?.response?.data
                        ?.message || t('errors.requestFailed');
                total = mergeSubOrgBulkResults(
                    total,
                    failedChunk(
                        part.map((m) => ({
                            user_id: m.user_id,
                            ...labelOf.get(`${m.user_id}|${m.package_session_id}`),
                        })),
                        message
                    )
                );
            }
            setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + part.length) }));
        }
        setResult(total);
        setStep('RESULTS');
        queryClient.invalidateQueries({ queryKey: ['students'] });
        queryClient.invalidateQueries({ queryKey: ['sub-org-finance-detail', subOrgId] });
        if (total.failed === 0) {
            toast.success(
                t('toasts.done', { count: total.moved + total.already_member, name: targetName })
            );
        }
    };

    const handleOpenChange = (next: boolean) => {
        // A run in flight finishes first; closing mid-way would hide which learners moved.
        if (!next && step !== 'RUNNING') onClose();
    };

    const footer =
        step === 'PICK' ? (
            <div className="flex w-full justify-end gap-2">
                <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                    {t('buttons.cancel')}
                </MyButton>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    disable={!subOrgId || students.length === 0}
                    onClick={runMove}
                >
                    {t('buttons.move', { count: students.length })}
                </MyButton>
            </div>
        ) : step === 'RESULTS' ? (
            <div className="flex w-full justify-end">
                <MyButton buttonType="primary" scale="medium" onClick={onClose}>
                    {t('buttons.done')}
                </MyButton>
            </div>
        ) : undefined;

    return (
        <MyDialog
            open={open}
            onOpenChange={handleOpenChange}
            heading={t('heading', { term: subOrgTerm })}
            dialogWidth="max-w-xl"
            footer={footer}
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6">
                {step === 'PICK' && (
                    <>
                        <p className="text-body text-neutral-600">
                            {t('intro', { count: students.length, term: subOrgTerm })}
                        </p>
                        <div className="flex flex-col gap-2">
                            <Label>{t('fields.subOrg', { term: subOrgTerm })}</Label>
                            {isLoading ? (
                                <Skeleton className="h-10 w-full" />
                            ) : isError ? (
                                <p className="text-caption text-danger-600">
                                    {t('errors.loadSubOrgs', { term: subOrgTerm })}
                                </p>
                            ) : subOrgs.length === 0 ? (
                                <p className="text-caption text-neutral-500">
                                    {t('empty', { term: subOrgTerm })}
                                </p>
                            ) : (
                                <SearchableSelect
                                    options={subOrgs.map((o) => ({ label: o.name, value: o.id }))}
                                    value={subOrgId}
                                    onChange={setSubOrgId}
                                    placeholder={t('fields.subOrgPlaceholder', {
                                        term: subOrgTerm,
                                    })}
                                    searchPlaceholder={t('fields.search')}
                                    emptyText={t('fields.noMatch')}
                                />
                            )}
                        </div>
                        {subOrgId && (alreadyThere > 0 || inOtherSubOrg > 0) && (
                            <div className="flex flex-col gap-1 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-caption text-neutral-600">
                                {alreadyThere > 0 && (
                                    <p>
                                        {t('notes.alreadyThere', {
                                            count: alreadyThere,
                                            name: targetName,
                                        })}
                                    </p>
                                )}
                                {inOtherSubOrg > 0 && (
                                    <p>
                                        {t('notes.fromOther', {
                                            count: inOtherSubOrg,
                                            term: subOrgTerm,
                                        })}
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="flex items-start gap-2 rounded-md bg-primary-50 p-3 text-caption text-neutral-600">
                            <Info className="mt-0.5 size-4 shrink-0 text-primary-500" />
                            <span>{t('notes.keeps', { term: subOrgTerm })}</span>
                        </div>
                    </>
                )}

                {step === 'RUNNING' && (
                    <div className="flex flex-col gap-2 py-4">
                        <p className="text-body text-neutral-700">
                            {t('running', { done: progress.done, total: progress.total })}
                        </p>
                        <Progress
                            value={progress.total ? (progress.done / progress.total) * 100 : 0}
                        />
                    </div>
                )}

                {step === 'RESULTS' && <SubOrgBulkResults result={result} />}
            </div>
        </MyDialog>
    );
}
