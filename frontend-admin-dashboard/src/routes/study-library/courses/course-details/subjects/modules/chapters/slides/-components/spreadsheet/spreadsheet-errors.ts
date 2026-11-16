import type { TFunction } from 'i18next';
import { SpreadsheetImportError } from './spreadsheet-import';
import { SPREADSHEET_MAX_CELLS, SPREADSHEET_MAX_FILE_BYTES } from './spreadsheet-slide-data';

const MB = 1024 * 1024;

const formatNumber = (lng: string, n: number, digits = 0) =>
    new Intl.NumberFormat(lng || 'en', { maximumFractionDigits: digits }).format(n);

/** The friendly message for a failed spreadsheet import (namespace: spreadsheetSlide). */
export function spreadsheetErrorMessage(t: TFunction, lng: string, error: unknown): string {
    if (!(error instanceof SpreadsheetImportError)) return t('errors.unreadable');
    const limit = error.limit;
    switch (limit.code) {
        case 'fileTooLarge':
            return t('errors.fileTooLarge', {
                size: formatNumber(lng, limit.size / MB, 1),
                max: formatNumber(lng, limit.max / MB),
            });
        case 'tooManyTabs':
            return t('errors.tooManyTabs', {
                tabs: formatNumber(lng, limit.count),
                max: formatNumber(lng, limit.max),
            });
        case 'tooManyCells':
            return t('errors.tooManyCells', {
                cells: formatNumber(lng, limit.count),
                max: formatNumber(lng, limit.max),
            });
        case 'tabTooLarge':
            return t('errors.tabTooLarge', {
                tab: limit.tab,
                cells: formatNumber(lng, limit.count),
                max: formatNumber(lng, limit.max),
            });
        case 'dataTooLarge':
            return t('errors.dataTooLarge');
        case 'empty':
            return t('errors.empty');
        case 'unsupportedType':
            return t('errors.unsupportedType');
        default:
            return t('errors.unreadable');
    }
}

/** "…up to 5 MB and 20,000 filled cells" values for the dropzone hint. */
export function spreadsheetLimitHint(lng: string) {
    return {
        maxMb: formatNumber(lng, SPREADSHEET_MAX_FILE_BYTES / MB),
        maxCells: formatNumber(lng, SPREADSHEET_MAX_CELLS),
    };
}
