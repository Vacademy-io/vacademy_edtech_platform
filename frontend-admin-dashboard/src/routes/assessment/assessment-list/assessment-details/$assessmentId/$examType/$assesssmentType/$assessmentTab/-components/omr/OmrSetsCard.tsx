import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
    CircleNotch,
    DownloadSimple,
    FileText,
    Key,
    Stack,
    UploadSimple,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import {
    downloadOmrSheetPdf,
    generateOmrSets,
    omrErrorMessage,
    type OmrOverview,
    type OmrSet,
} from '../../-services/omr-services';
import { OmrCard } from './OmrCard';

/**
 * Generate the paper sets and, per set, the three things to print: the
 * question paper and answer key (the export page, in the set's saved order)
 * and the OMR bubble sheet. Each set row also takes the filled sheets back.
 */
export const OmrSetsCard = ({
    assessmentId,
    instituteId,
    overview,
    rollOk,
    onUpload,
}: {
    assessmentId: string;
    instituteId: string;
    overview: OmrOverview;
    /** Roll-number pre-check passed: the sheets may be downloaded. */
    rollOk: boolean;
    onUpload: (set: OmrSet) => void;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [downloadingSetId, setDownloadingSetId] = useState<string | null>(null);

    const hasIssues = overview.paper_issues.length > 0;
    const hasSets = overview.sets.length > 0;

    const generate = useMutation({
        mutationFn: () => generateOmrSets(assessmentId, instituteId),
        onSuccess: (next) => {
            queryClient.setQueryData(['OMR_OVERVIEW', assessmentId, instituteId], next);
            queryClient.invalidateQueries({ queryKey: ['OMR_SET_PAPER', assessmentId] });
            setConfirmOpen(false);
            toast.success(t('sets.generated', { count: next.sets.length }));
        },
        onError: (e) => toast.error(omrErrorMessage(e, t('errors.generateFailed'))),
    });

    const download = useMutation({
        mutationFn: (set: OmrSet) => {
            setDownloadingSetId(set.id);
            return downloadOmrSheetPdf(assessmentId, instituteId, set.id, set.set_code);
        },
        onError: (e) => toast.error(omrErrorMessage(e, t('errors.downloadFailed'))),
        onSettled: () => setDownloadingSetId(null),
    });

    const openPaper = (set: OmrSet, answerKey: boolean) =>
        navigate({
            to: '/assessment/export/$assessmentId',
            params: { assessmentId },
            search: { omrSetId: set.id, answerKey },
        });

    const onGenerate = () => {
        if (hasSets) setConfirmOpen(true);
        else generate.mutate();
    };

    return (
        <OmrCard
            title={t('sets.title')}
            subtitle={t('sets.subtitle', { count: overview.question_count })}
            actions={
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="small"
                    disabled={hasIssues || overview.locked || generate.isPending}
                    onClick={onGenerate}
                >
                    {generate.isPending ? (
                        <CircleNotch size={14} className="animate-spin" />
                    ) : (
                        <Stack size={14} />
                    )}
                    {hasSets ? t('sets.regenerate') : t('sets.generate')}
                </MyButton>
            }
        >
            {hasIssues && (
                <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
                    <p className="mb-1 flex items-center gap-2 font-medium">
                        <WarningCircle size={18} className="shrink-0" />
                        {t('sets.paperIssues')}
                    </p>
                    <ul className="list-disc ps-8">
                        {overview.paper_issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                        ))}
                    </ul>
                </div>
            )}
            {overview.locked && (
                <p className="text-caption text-neutral-500">{t('sets.lockedHint')}</p>
            )}
            {!rollOk && hasSets && (
                <p className="text-caption text-warning-700">{t('sets.sheetBlocked')}</p>
            )}

            {!hasSets ? (
                <p className="text-sm text-neutral-500">{t('sets.empty')}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-table-sm text-sm">
                        <thead>
                            <tr className="border-b border-neutral-200 text-start text-caption uppercase tracking-wide text-neutral-500">
                                <th className="py-2 pe-3">{t('sets.table.set')}</th>
                                <th className="py-2 pe-3">{t('sets.table.questions')}</th>
                                <th className="py-2 pe-3">{t('sets.table.size')}</th>
                                <th className="py-2 text-end">{t('sets.table.actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100">
                            {overview.sets.map((set) => (
                                <tr key={set.id}>
                                    <td className="py-2 pe-3 font-semibold text-neutral-800">
                                        {t('sets.setLabel', { code: set.set_code })}
                                    </td>
                                    <td className="py-2 pe-3">{set.question_count}</td>
                                    <td className="py-2 pe-3">
                                        {set.density
                                            ? t(`sets.density.${set.density}`, {
                                                  defaultValue: set.density,
                                              })
                                            : '—'}
                                    </td>
                                    <td className="py-2">
                                        <div className="flex flex-wrap justify-end gap-1.5">
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={() => openPaper(set, false)}
                                            >
                                                <FileText size={14} />
                                                {t('sets.questionPaper')}
                                            </MyButton>
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                onClick={() => openPaper(set, true)}
                                            >
                                                <Key size={14} />
                                                {t('sets.answerKey')}
                                            </MyButton>
                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="small"
                                                disabled={!rollOk || download.isPending}
                                                onClick={() => download.mutate(set)}
                                            >
                                                {downloadingSetId === set.id ? (
                                                    <CircleNotch
                                                        size={14}
                                                        className="animate-spin"
                                                    />
                                                ) : (
                                                    <DownloadSimple size={14} />
                                                )}
                                                {t('sets.omrSheet')}
                                            </MyButton>
                                            <MyButton
                                                type="button"
                                                buttonType="primary"
                                                scale="small"
                                                onClick={() => onUpload(set)}
                                            >
                                                <UploadSimple size={14} />
                                                {t('sets.upload')}
                                            </MyButton>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {confirmOpen && (
                <MyDialog
                    heading={t('sets.confirmTitle')}
                    open
                    onOpenChange={(o) => !o && !generate.isPending && setConfirmOpen(false)}
                    dialogWidth="max-w-md"
                    footer={
                        <div className="flex justify-end gap-2">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                disabled={generate.isPending}
                                onClick={() => setConfirmOpen(false)}
                            >
                                {t('common.cancel')}
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                disabled={generate.isPending}
                                onClick={() => generate.mutate()}
                            >
                                {generate.isPending ? t('sets.generating') : t('sets.regenerate')}
                            </MyButton>
                        </div>
                    }
                >
                    <p className="p-4 text-sm text-neutral-700">{t('sets.confirmBody')}</p>
                </MyDialog>
            )}
        </OmrCard>
    );
};

export default OmrSetsCard;
