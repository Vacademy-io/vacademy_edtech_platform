import { useTranslation } from 'react-i18next';
import { CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { FrontsDirection, ScanSession } from '../-services/scan-station-services';
import { pageByRef, rotationOfPage } from '../-lib/review-model';
import type { DecideFn } from '../-hooks/useScanActions';
import { PageThumb } from './PageThumb';

const OTHER: Record<FrontsDirection, FrontsDirection> = {
    FORWARD: 'REVERSED',
    REVERSED: 'FORWARD',
};

/**
 * "Which way are the fronts?" A pile's fronts can come out first-to-last or
 * last-to-first; when the server cannot tell, the clerk sees the first copy of
 * more than one sheet in both orders and picks the one that starts with the name box.
 */
export const FrontsDirectionPrompt = ({
    session,
    decide,
    readOnly,
}: {
    session: ScanSession;
    decide: DecideFn;
    readOnly: boolean;
}) => {
    const { t } = useTranslation('scanStation');
    const current = session.fronts_direction;
    const copy = session.copies.find((c) => c.sheets.length > 1) ?? null;
    const fronts = copy
        ? copy.sheets.flatMap((s) => {
              const load = session.loads.find((l) => l.load_no === s.load_no);
              const sheet = load?.sheets.find((x) => x.sheet_no === s.sheet_no);
              const page = pageByRef(load, sheet?.front);
              return page && load ? [{ page, rotation: rotationOfPage(load, page) }] : [];
          })
        : [];
    const options: { value: FrontsDirection; pages: typeof fronts }[] = [
        { value: current, pages: fronts },
        { value: OTHER[current], pages: [...fronts].reverse() },
    ];

    return (
        <section
            id="scan-session-flags"
            className="flex flex-col gap-3 rounded-lg border border-warning-300 bg-warning-50 p-4"
        >
            <h2 className="text-subtitle font-semibold text-warning-700">{t('direction.title')}</h2>
            <p className="text-body text-neutral-700">{t('direction.help')}</p>
            {fronts.length === 0 ? (
                <p className="text-caption text-neutral-600">{t('direction.none')}</p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {options.map((option) => (
                    <div
                        key={option.value}
                        className={cn(
                            'flex flex-col gap-2 rounded-md border bg-white p-3',
                            option.value === current ? 'border-primary-300' : 'border-neutral-200'
                        )}
                    >
                        <span className="text-body font-medium text-neutral-800">
                            {t(`direction.${option.value}`)}
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {option.pages.map(({ page, rotation }) => (
                                <PageThumb
                                    key={page.ref}
                                    fileId={page.file_id}
                                    kind={page.kind}
                                    pageIndex={page.page_index}
                                    rotation={rotation}
                                    label={page.ref}
                                />
                            ))}
                        </div>
                        <MyButton
                            type="button"
                            buttonType={option.value === current ? 'primary' : 'secondary'}
                            scale="small"
                            className="gap-1 self-start"
                            disabled={readOnly}
                            onClick={() => decide('SET_FRONTS_DIRECTION', { value: option.value })}
                        >
                            {option.value === current && <CheckCircle size={14} />}
                            {t('direction.choose')}
                        </MyButton>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default FrontsDirectionPrompt;
