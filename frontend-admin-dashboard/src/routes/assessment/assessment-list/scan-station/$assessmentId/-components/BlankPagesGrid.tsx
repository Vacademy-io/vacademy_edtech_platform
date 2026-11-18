import { useTranslation } from 'react-i18next';
import { CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type { ScanLoad, ScanSession } from '../-services/scan-station-services';
import { leftOutOfLoad, loadFlag, pageByRef, rotationOfPage } from '../-lib/review-model';
import type { DecideFn } from '../-hooks/useScanActions';
import { PageThumb } from './PageThumb';

/**
 * Every back of a load about to be left out as blank, for one glance before
 * anything is built: a click keeps a page, and the one button that confirms
 * them all sits below the pages, so it is only reached past them. This grid is
 * the only place BLANKS_TO_CONFIRM can be accepted. The accept names the set
 * of pages shown (the flag's fingerprint): if a load finishes reading and the
 * set changes first, the server refuses and the grid is refreshed.
 */
export const BlankPagesGrid = ({
    session,
    load,
    decide,
    readOnly,
}: {
    session: ScanSession;
    load: ScanLoad;
    decide: DecideFn;
    readOnly: boolean;
}) => {
    const { t } = useTranslation('scanStation');
    const pages = leftOutOfLoad(session, load.load_no);
    const flag = loadFlag(load, 'BLANKS_TO_CONFIRM');
    const confirmed = !flag || flag.accepted;

    if (pages.length === 0) {
        return <p className="text-caption text-neutral-500">{t('blanks.none')}</p>;
    }
    return (
        <div className="flex flex-col gap-3">
            <p className="text-caption text-neutral-600">{t('blanks.help')}</p>
            <ul className="flex flex-wrap gap-2">
                {pages.map((p) => {
                    const page = pageByRef(load, p.ref);
                    return (
                        <li key={p.ref}>
                            <button
                                type="button"
                                disabled={readOnly}
                                title={t('blanks.keep')}
                                aria-label={t('blanks.keepPage', { ref: p.ref })}
                                className="flex flex-col items-center gap-1 rounded-md p-1 transition-colors hover:bg-primary-50 disabled:cursor-not-allowed"
                                onClick={() =>
                                    decide('KEEP_PAGE', { load_no: load.load_no, ref: p.ref })
                                }
                            >
                                <PageThumb
                                    fileId={p.file_id}
                                    kind={p.kind}
                                    pageIndex={p.page_index}
                                    rotation={page ? rotationOfPage(load, page) : 0}
                                    label={p.ref}
                                />
                                <span className="text-2xs text-neutral-500">
                                    {t('blanks.keep')}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className="flex flex-wrap items-center justify-end gap-2">
                {confirmed ? (
                    <span className="flex items-center gap-1 text-caption font-medium text-success-700">
                        <CheckCircle size={14} />
                        {t('blanks.confirmed')}
                    </span>
                ) : (
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        disabled={readOnly}
                        onClick={() =>
                            decide('ACCEPT_LOAD_FLAG', {
                                load_no: load.load_no,
                                code: 'BLANKS_TO_CONFIRM',
                                expected_fingerprint: flag?.fingerprint ?? null,
                            })
                        }
                    >
                        {t('blanks.allBlank')}
                    </MyButton>
                )}
            </div>
        </div>
    );
};

export default BlankPagesGrid;
