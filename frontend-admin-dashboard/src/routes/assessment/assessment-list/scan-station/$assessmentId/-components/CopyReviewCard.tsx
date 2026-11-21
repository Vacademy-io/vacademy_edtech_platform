import { useTranslation } from 'react-i18next';
import {
    ArrowsDownUp,
    ArrowUUpLeft,
    CheckCircle,
    LinkSimple,
    Scissors,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { ScanCopy, ScanLoad, ScanSession } from '../-services/scan-station-services';
import {
    actionsFor,
    otherDirection,
    pageByRef,
    rotationOfPage,
    type ScanIssue,
} from '../-lib/review-model';
import type { DecideFn } from '../-hooks/useScanActions';
import { FlagChip } from './FlagChip';
import { PageThumb } from './PageThumb';

/**
 * One student's copy as it will be built: the name read off the box, each sheet's
 * front and back in final order (blank backs dimmed), its flags, and the moves a
 * clerk can make — accept, leave out, join, split, keep or drop a page. An
 * accept names the copy as shown (its fingerprint), so a copy that changed in
 * the meantime is refused rather than accepted unseen.
 */
export const CopyReviewCard = ({
    session,
    copy,
    number,
    isFirst,
    issues,
    decide,
    readOnly,
    onPairCheck,
}: {
    session: ScanSession;
    copy: ScanCopy;
    /** This copy's flags (collectIssues, scope COPY). */
    issues: ScanIssue[];
    /** 1-based position in the session. */
    number: number;
    isFirst: boolean;
    decide: DecideFn;
    readOnly: boolean;
    onPairCheck: (issue: ScanIssue) => void;
}) => {
    const { t } = useTranslation('scanStation');
    const loads = new Map<number, ScanLoad>(session.loads.map((l) => [l.load_no, l]));
    const firstSheetIssue = issues.find((i) => i.code === 'FIRST_SHEET_NO_LABEL') ?? null;
    const excluded = copy.decision === 'EXCLUDED';
    const accepted = copy.decision === 'ACCEPTED';
    const at = { load_no: copy.load_no, sheet_no: copy.first_sheet_no };
    const firstSheet = copy.sheets[0];
    const firstSheetAt = firstSheet
        ? { load_no: firstSheet.load_no, sheet_no: firstSheet.sheet_no }
        : at;
    const turnTo = otherDirection(session.fronts_direction);

    return (
        <article
            id={`scan-copy-${copy.copy_key}`}
            className={cn(
                'flex flex-col gap-3 rounded-lg border bg-white p-4',
                excluded
                    ? 'border-neutral-200 opacity-70'
                    : copy.needs_review && !accepted
                      ? 'border-warning-300'
                      : 'border-neutral-200'
            )}
        >
            <header className="flex flex-wrap items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-caption text-neutral-500">
                        {t('copy.title', { n: number })}
                        {' · '}
                        {t('copy.loadSheets', { load: copy.load_no, count: copy.sheets.length })}
                        {' · '}
                        {t('copy.pages', { count: copy.page_count })}
                    </span>
                    <span
                        className={cn(
                            'truncate text-body font-semibold',
                            copy.name_text ? 'text-neutral-800' : 'text-neutral-500'
                        )}
                    >
                        {copy.name_text || t('copy.noName')}
                    </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {accepted && (
                        <span className="flex items-center gap-1 text-caption font-medium text-success-700">
                            <CheckCircle size={14} />
                            {t('copy.accepted')}
                        </span>
                    )}
                    {copy.needs_review && !accepted && !excluded && (
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            disabled={readOnly}
                            onClick={() =>
                                decide('ACCEPT_COPY', {
                                    ...at,
                                    expected_fingerprint: copy.fingerprint ?? null,
                                })
                            }
                        >
                            {t('copy.accept')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disabled={readOnly}
                        onClick={() => decide(excluded ? 'INCLUDE_COPY' : 'EXCLUDE_COPY', at)}
                    >
                        {excluded ? t('copy.include') : t('copy.exclude')}
                    </MyButton>
                    {!isFirst && !excluded && (
                        <MyButton
                            type="button"
                            buttonType="text"
                            scale="small"
                            className="gap-1"
                            disabled={readOnly}
                            onClick={() => decide('MERGE_WITH_PREVIOUS', at)}
                        >
                            <LinkSimple size={14} />
                            {t('copy.merge')}
                        </MyButton>
                    )}
                </div>
            </header>

            {excluded && <p className="text-caption text-neutral-500">{t('copy.excluded')}</p>}

            {firstSheetIssue && !excluded && (
                <div className="flex flex-col gap-2 rounded-md border border-danger-200 bg-danger-50 p-3">
                    <p className="text-caption text-danger-700">{t('copy.firstSheetHelp')}</p>
                    <div className="flex flex-wrap items-center gap-2">
                        {actionsFor(firstSheetIssue).map((action) => {
                            if (action === 'SET_FRONTS_DIRECTION') {
                                return (
                                    <MyButton
                                        key={action}
                                        type="button"
                                        buttonType="primary"
                                        scale="small"
                                        className="gap-1"
                                        disabled={readOnly}
                                        onClick={() =>
                                            decide('SET_FRONTS_DIRECTION', { value: turnTo })
                                        }
                                    >
                                        <ArrowsDownUp size={14} />
                                        {t(`copy.tryDirection.${turnTo}`)}
                                    </MyButton>
                                );
                            }
                            if (action === 'SPLIT_BEFORE_SHEET') {
                                return (
                                    <MyButton
                                        key={action}
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        className="gap-1"
                                        disabled={readOnly}
                                        onClick={() => decide('SPLIT_BEFORE_SHEET', firstSheetAt)}
                                    >
                                        <Scissors size={14} />
                                        {t('copy.startHere')}
                                    </MyButton>
                                );
                            }
                            // EXCLUDE_COPY is the last resort: the header's
                            // "Leave out" already offers it, so it is not repeated.
                            return null;
                        })}
                    </div>
                </div>
            )}

            {issues.length > 0 && (
                <ul className="flex flex-wrap items-center gap-2">
                    {issues.map((issue) => (
                        <li key={issue.id} className="flex items-center gap-1">
                            <FlagChip
                                code={issue.code}
                                severity={issue.severity}
                                accepted={issue.severity === 'REVIEW' && issue.accepted}
                            />
                            {actionsFor(issue).includes('OPEN_PAIR_CHECK') && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    onClick={() => onPairCheck(issue)}
                                >
                                    {t('actions.openPair')}
                                </MyButton>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <ol className="flex flex-wrap gap-4">
                {copy.sheets.map((s, i) => {
                    const load = loads.get(s.load_no);
                    const sheet = load?.sheets.find((x) => x.sheet_no === s.sheet_no);
                    if (!load || !sheet) return null;
                    const front = copy.pages.find(
                        (p) => p.load_no === s.load_no && p.ref === sheet.front
                    );
                    const back = copy.pages.find(
                        (p) => p.load_no === s.load_no && p.ref === sheet.back
                    );
                    const backLeftOut = copy.left_out.find(
                        (p) => p.load_no === s.load_no && p.ref === sheet.back
                    );
                    const backPage = pageByRef(load, sheet.back);
                    const sheetAt = { load_no: s.load_no, sheet_no: s.sheet_no };
                    return (
                        <li
                            key={`${s.load_no}:${s.sheet_no}`}
                            className="flex flex-col gap-2 rounded-md border border-neutral-100 bg-neutral-50 p-2"
                        >
                            <span className="text-2xs text-neutral-500">
                                {t('copy.sheet', { load: s.load_no, n: s.sheet_no + 1 })}
                            </span>
                            <div className="flex gap-2">
                                {front && (
                                    <PageThumb
                                        fileId={front.file_id}
                                        kind={front.kind}
                                        pageIndex={front.page_index}
                                        rotation={front.rotation}
                                        label={t('copy.side.FRONT')}
                                    />
                                )}
                                {back && (
                                    <div className="flex flex-col items-center gap-1">
                                        <PageThumb
                                            fileId={back.file_id}
                                            kind={back.kind}
                                            pageIndex={back.page_index}
                                            rotation={back.rotation}
                                            label={t('copy.side.BACK')}
                                        />
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            disabled={readOnly}
                                            onClick={() =>
                                                decide('DROP_PAGE', {
                                                    load_no: s.load_no,
                                                    ref: back.ref,
                                                })
                                            }
                                        >
                                            {t('copy.dropPage')}
                                        </MyButton>
                                    </div>
                                )}
                                {backLeftOut && (
                                    <div className="flex flex-col items-center gap-1">
                                        <PageThumb
                                            fileId={backLeftOut.file_id}
                                            kind={backLeftOut.kind}
                                            pageIndex={backLeftOut.page_index}
                                            rotation={backPage ? rotationOfPage(load, backPage) : 0}
                                            label={t('copy.leftOutPage')}
                                            muted
                                        />
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            disabled={readOnly}
                                            onClick={() =>
                                                decide('KEEP_PAGE', {
                                                    load_no: s.load_no,
                                                    ref: backLeftOut.ref,
                                                })
                                            }
                                        >
                                            {t('copy.keepPage')}
                                        </MyButton>
                                    </div>
                                )}
                            </div>
                            {i > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        className="gap-1"
                                        disabled={readOnly || excluded}
                                        onClick={() => decide('SPLIT_BEFORE_SHEET', sheetAt)}
                                    >
                                        <Scissors size={14} />
                                        {t('copy.split')}
                                    </MyButton>
                                    {sheet.label_present && (
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            className="gap-1"
                                            disabled={readOnly}
                                            onClick={() => decide('CLEAR_SHEET', sheetAt)}
                                        >
                                            <ArrowUUpLeft size={14} />
                                            {t('copy.clearSheet')}
                                        </MyButton>
                                    )}
                                </div>
                            ) : (
                                // The unlabelled first sheet's own moves sit in the
                                // box above; here only undoing a split it was given.
                                !sheet.label_present &&
                                !firstSheetIssue && (
                                    <div className="flex flex-wrap gap-1">
                                        <MyButton
                                            type="button"
                                            buttonType="text"
                                            scale="small"
                                            className="gap-1"
                                            disabled={readOnly}
                                            onClick={() => decide('CLEAR_SHEET', sheetAt)}
                                        >
                                            <ArrowUUpLeft size={14} />
                                            {t('copy.clearSheet')}
                                        </MyButton>
                                    </div>
                                )
                            )}
                        </li>
                    );
                })}
            </ol>
        </article>
    );
};

export default CopyReviewCard;
