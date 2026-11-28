import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadSimple } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type { ReportFormat } from '../-shared/report-types';
import { ReportErrorNotice } from './ReportStates';

/**
 * "Download CSV" and "Download Excel" (contract §7.2). Secondary buttons: a
 * report page has no primary action. One download at a time from this page:
 * while one runs every download button is disabled and marked busy (N1); a
 * second tap does nothing (the server also runs one export at a time and
 * answers `REPORT_BUSY`). A refusal goes to `onError` too, so the page can
 * learn from it (the GSTINs of `GSTIN_REQUIRED`, M7).
 */
export function ExportButtons({
    formats,
    onDownload,
    onError,
    disabled,
}: {
    formats: readonly ReportFormat[];
    onDownload: (format: ReportFormat) => Promise<unknown>;
    onError?: (error: unknown) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation('commerce');
    const running = useRef(false);
    const [busy, setBusy] = useState<ReportFormat | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [done, setDone] = useState<string | null>(null);

    const run = async (format: ReportFormat) => {
        if (running.current) return;
        running.current = true;
        setBusy(format);
        setError(null);
        setDone(null);
        try {
            const name = await onDownload(format);
            setDone(typeof name === 'string' ? name : null);
        } catch (e) {
            setError(e);
            onError?.(e);
        } finally {
            running.current = false;
            setBusy(null);
        }
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2" aria-busy={busy !== null || undefined}>
                {formats.map((format) => (
                    <MyButton
                        key={format}
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="h-12 md:h-9"
                        disable={!!disabled || busy !== null}
                        onAsyncClick={() => run(format)}
                        aria-busy={busy === format || undefined}
                        data-testid={`report-download-${format}`}
                    >
                        <DownloadSimple size={16} />
                        {t(format === 'csv' ? 'reports.export.csv' : 'reports.export.xlsx')}
                    </MyButton>
                ))}
            </div>
            {done && (
                <p role="status" className="text-caption text-muted-foreground">
                    {t('reports.export.done', { name: done })}
                </p>
            )}
            <ReportErrorNotice error={error} />
        </div>
    );
}
