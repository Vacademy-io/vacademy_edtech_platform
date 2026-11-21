/**
 * Report window controls: "Last 7 days" / "Last 30 days" / "Season" / "Custom" pills, and
 * two date buttons when Custom is on. The window lives in the URL (range/from/to), so a
 * link to this screen opens the same window.
 */
import { useTranslation } from 'react-i18next';
import { subDays } from 'date-fns';
import { PillTabs } from '@/components/shared/crm-enhance/screen-header';
import { DatePickerButton } from '@/components/shared/crm-enhance/date-picker-button';
import { AD_RANGES, type AdRange } from '../index';
import { MAX_RANGE_DAYS, toDayString, type ReportWindow } from './ad-performance-utils';

export function RangeControls({
    window: reportWindow,
    onRangeChange,
    onCustomChange,
}: {
    window: ReportWindow;
    onRangeChange: (range: AdRange) => void;
    onCustomChange: (from: string, to: string) => void;
}) {
    const { t } = useTranslation('marketingAds');
    const today = toDayString(new Date());
    const { from, to } = reportWindow;

    // The server caps a window at MAX_RANGE_DAYS; keep the pickers inside it.
    const earliestFrom = toDayString(subDays(new Date(`${to}T00:00:00`), MAX_RANGE_DAYS - 1));

    return (
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <PillTabs
                tabs={AD_RANGES.map((key) => ({ key, label: t(`ads.range.${key}`) }))}
                value={reportWindow.range}
                onChange={(key) => onRangeChange(key as AdRange)}
            />
            {reportWindow.range === 'custom' && (
                <div className="flex flex-wrap items-center gap-2">
                    <DatePickerButton
                        label={t('ads.range.from')}
                        value={from}
                        min={earliestFrom}
                        max={to}
                        onChange={(value) => onCustomChange(value, to)}
                    />
                    <DatePickerButton
                        label={t('ads.range.to')}
                        value={to}
                        min={from}
                        max={today}
                        onChange={(value) => {
                            // Moving the end can push the start past the server limit; pull it in.
                            const minFrom = toDayString(
                                subDays(new Date(`${value}T00:00:00`), MAX_RANGE_DAYS - 1)
                            );
                            onCustomChange(from < minFrom ? minFrom : from, value);
                        }}
                    />
                </div>
            )}
        </div>
    );
}
