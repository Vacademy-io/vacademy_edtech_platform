import { useTranslation } from 'react-i18next';
import { ArrowCounterClockwise, CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import type { ScanSession } from '../-services/scan-station-services';
import { collectIssues, pageByRef, rotationOfPage, type ScanIssue } from '../-lib/review-model';
import type { DecideFn } from '../-hooks/useScanActions';
import { FlagChip } from './FlagChip';
import { PageThumb } from './PageThumb';

/**
 * A front and the back it was paired with, side by side, for a pairing the
 * reader was not sure of (PAIR_NOT_ROW_MAX / ORDER_UNCERTAIN). The clerk says it
 * is right, or rescans the load.
 */
export const PairCheckDialog = ({
    session,
    issue,
    onClose,
    decide,
    readOnly,
    onRescan,
}: {
    session: ScanSession;
    issue: ScanIssue | null;
    onClose: () => void;
    decide: DecideFn;
    readOnly: boolean;
    onRescan: (loadNo: number) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const load = session.loads.find((l) => l.load_no === issue?.load_no);
    const sheet =
        load?.sheets.find((s) => s.sheet_no === issue?.sheet_no) ?? load?.sheets[0] ?? null;
    const front = pageByRef(load, sheet?.front);
    const back = pageByRef(load, sheet?.back);
    const copy = issue?.copy_key
        ? session.copies.find((c) => c.copy_key === issue.copy_key) ?? null
        : null;

    // The pages above come from the session as it is now, so the accept names
    // the copy / flag as it is now too: if it changes before the click lands,
    // the server refuses (PLAN_CHANGED) instead of accepting a pair nobody saw.
    const accept = () => {
        if (!issue || !load) return;
        if (issue.scope === 'COPY' && copy) {
            decide('ACCEPT_COPY', {
                load_no: copy.load_no,
                sheet_no: copy.first_sheet_no,
                expected_fingerprint: copy.fingerprint ?? null,
            });
        } else {
            decide('ACCEPT_LOAD_FLAG', {
                load_no: load.load_no,
                code: issue.code,
                // This flag's own fingerprint, as the session shows it now:
                // the server accepts the flag it names, not the first one with
                // this code. A flag that is gone sends what the clerk opened,
                // and the server refuses it.
                expected_fingerprint:
                    collectIssues(session).find((i) => i.id === issue.id)?.fingerprint ??
                    issue.fingerprint,
            });
        }
        onClose();
    };

    return (
        <MyDialog
            heading={t('pair.title')}
            open={issue !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            dialogWidth="max-w-3xl"
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6">
                {issue && <FlagChip code={issue.code} severity={issue.severity} />}
                <p className="text-body text-neutral-600">{t('pair.help')}</p>
                {load && sheet && (
                    <p className="text-caption text-neutral-500">
                        {t('pair.sheet', { n: sheet.sheet_no + 1, load: load.load_no })}
                    </p>
                )}
                <div className="flex flex-wrap justify-center gap-6">
                    {front && (
                        <figure className="flex flex-col items-center gap-2">
                            <PageThumb
                                fileId={front.file_id}
                                kind={front.kind}
                                pageIndex={front.page_index}
                                rotation={rotationOfPage(load, front)}
                                label={t('pair.front')}
                                size="lg"
                            />
                            <figcaption className="text-caption text-neutral-600">
                                {t('pair.front')}
                            </figcaption>
                        </figure>
                    )}
                    {back && (
                        <figure className="flex flex-col items-center gap-2">
                            <PageThumb
                                fileId={back.file_id}
                                kind={back.kind}
                                pageIndex={back.page_index}
                                rotation={rotationOfPage(load, back)}
                                label={t('pair.back')}
                                size="lg"
                            />
                            <figcaption className="text-caption text-neutral-600">
                                {t('pair.back')}
                            </figcaption>
                        </figure>
                    )}
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-200 pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="gap-1"
                        disabled={readOnly || !load}
                        onClick={() => {
                            if (load) onRescan(load.load_no);
                            onClose();
                        }}
                    >
                        <ArrowCounterClockwise size={16} />
                        {t('pair.rescan')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        className="gap-1"
                        disabled={readOnly || !load}
                        onClick={accept}
                    >
                        <CheckCircle size={16} />
                        {t('pair.right')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};

export default PairCheckDialog;
