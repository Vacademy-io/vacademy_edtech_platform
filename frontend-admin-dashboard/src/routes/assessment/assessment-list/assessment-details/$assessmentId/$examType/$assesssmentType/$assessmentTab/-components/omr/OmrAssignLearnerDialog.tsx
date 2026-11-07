import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import {
    getOmrParticipants,
    omrErrorMessage,
    resolveOmrSheet,
    type OmrParticipant,
    type OmrSheet,
} from '../../-services/omr-services';
import { OmrFileImage } from './omr-file';

/**
 * Whose sheet is this? Every participant of the assessment behind a search box
 * (name or enrollment number). The reader's suggestion is preselected; a learner
 * who already has a graded sheet is flagged, since a second one is refused.
 */
export const OmrAssignLearnerDialog = ({
    sheet,
    assessmentId,
    instituteId,
    onClose,
    onResolved,
}: {
    sheet: OmrSheet;
    assessmentId: string;
    instituteId: string;
    onClose: () => void;
    onResolved: () => void;
}) => {
    const { t } = useTranslation('assessmentOmr');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<string | null>(sheet.matched_user_id ?? null);

    const { data: participants = [], isLoading } = useQuery({
        queryKey: ['OMR_PARTICIPANTS', assessmentId, instituteId],
        queryFn: () => getOmrParticipants(assessmentId, instituteId),
        staleTime: 30_000,
    });

    const q = search.trim().toLowerCase();
    const filtered = useMemo(() => {
        const list = q
            ? participants.filter((p) =>
                  `${p.name ?? ''} ${p.enrollment_number ?? ''}`.toLowerCase().includes(q)
              )
            : participants;
        return list.slice(0, 100);
    }, [participants, q]);
    const picked: OmrParticipant | undefined = participants.find((p) => p.user_id === selected);

    const resolve = useMutation({
        mutationFn: (userId: string) => resolveOmrSheet(sheet.id, instituteId, userId),
        onSuccess: () => {
            toast.success(t('toasts.assigned'));
            onResolved();
        },
        onError: (e) => toast.error(omrErrorMessage(e, t('errors.actionFailed'))),
    });

    return (
        <MyDialog
            heading={t('assign.title')}
            open
            onOpenChange={(o) => !o && !resolve.isPending && onClose()}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={resolve.isPending}
                        onClick={onClose}
                    >
                        {t('common.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={!selected || resolve.isPending}
                        onClick={() => selected && resolve.mutate(selected)}
                    >
                        {resolve.isPending ? t('assign.assigning') : t('assign.confirm')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start gap-3 text-sm text-neutral-600">
                    <OmrFileImage
                        fileId={sheet.name_crop_file_id}
                        alt={t('review.nameCropAlt')}
                        className="h-12 max-w-56"
                    />
                    <div>
                        <div>{t('assign.readRoll', { roll: sheet.read_roll || '—' })}</div>
                        {sheet.reason && (
                            <div className="text-caption text-warning-700">{sheet.reason}</div>
                        )}
                    </div>
                </div>
                <MyInput
                    inputType="text"
                    inputPlaceholder={t('assign.search')}
                    input={search}
                    onChangeFunction={(e) => setSearch(e.target.value)}
                    // MyInput caps itself at sm:w-60; only a same-breakpoint class lifts it.
                    className="w-full text-body sm:w-full"
                />
                <div className="max-h-list-md overflow-y-auto rounded-md border border-neutral-200">
                    {isLoading ? (
                        <DashboardLoader />
                    ) : filtered.length === 0 ? (
                        <p className="flex items-center gap-2 p-3 text-sm text-neutral-500">
                            <MagnifyingGlass size={16} />
                            {t('assign.none')}
                        </p>
                    ) : (
                        <ul>
                            {filtered.map((p) => (
                                <li key={p.user_id}>
                                    <button
                                        type="button"
                                        disabled={resolve.isPending}
                                        onClick={() => setSelected(p.user_id)}
                                        className={cn(
                                            'flex w-full items-center justify-between gap-3 px-3 py-2 text-start hover:bg-primary-50',
                                            selected === p.user_id && 'bg-primary-50'
                                        )}
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm text-neutral-800">
                                                {p.name || p.user_id}
                                            </span>
                                            <span className="block truncate font-mono text-caption text-neutral-500">
                                                {p.enrollment_number || '—'}
                                            </span>
                                        </span>
                                        <span className="flex shrink-0 items-center gap-2">
                                            {p.has_omr_sheet && (
                                                <span className="text-caption text-warning-700">
                                                    {t('assign.hasSheet')}
                                                </span>
                                            )}
                                            {selected === p.user_id && (
                                                <CheckCircle
                                                    size={16}
                                                    weight="fill"
                                                    className="text-primary-500"
                                                />
                                            )}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
                {picked?.has_omr_sheet && (
                    <p className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-caption text-warning-700">
                        <WarningCircle size={16} className="mt-px shrink-0" />
                        {t('assign.hasSheetWarning', { name: picked.name || '' })}
                    </p>
                )}
            </div>
        </MyDialog>
    );
};

export default OmrAssignLearnerDialog;
