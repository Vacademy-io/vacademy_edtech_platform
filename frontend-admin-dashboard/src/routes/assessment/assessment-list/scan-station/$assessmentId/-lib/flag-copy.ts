import {
    AI_SCAN_FLAG_CODES,
    PLANNER_SCAN_FLAG_CODES,
    VERDICT_REASON_CODES,
    type ScanFlagCode,
    type ScanFlagSeverity,
} from '../-services/scan-station-services';

/**
 * Plain words and a colour for every flag code the server can send. Titles and
 * help live in the scanStation namespace under flags.<CODE>.title / .help; an
 * unknown code (a newer server) falls back to flags.UNKNOWN with its severity's tone.
 */

export type FlagTone = 'danger' | 'warning' | 'info';

export interface FlagCopy {
    titleKey: string;
    helpKey: string;
    tone: FlagTone;
    known: boolean;
}

export const KNOWN_FLAG_CODES: readonly ScanFlagCode[] = [
    ...AI_SCAN_FLAG_CODES,
    ...PLANNER_SCAN_FLAG_CODES,
    ...VERDICT_REASON_CODES,
];

/** The severity each code has in the contract, for when a flag arrives without one. */
export const CODE_SEVERITY: Record<ScanFlagCode, ScanFlagSeverity> = {
    COUNT_MISMATCH: 'BLOCK',
    FILE_UNREADABLE: 'BLOCK',
    NO_NAME_BOX_FOUND: 'BLOCK',
    LOAD_TOO_LARGE: 'BLOCK',
    PAIR_SHIFT_DETECTED: 'BLOCK',
    BACK_HAS_LABEL: 'BLOCK',
    LABEL_NO_VALUE: 'REVIEW',
    LABEL_UNUSUAL: 'REVIEW',
    PAIR_NOT_ROW_MAX: 'REVIEW',
    ORDER_UNCERTAIN: 'REVIEW',
    FRONT_BLANK: 'REVIEW',
    DPI_LOW: 'REVIEW',
    BLANK_RULE_SUSPECT: 'INFO',
    DPI_ASSUMED: 'INFO',
    UNSURE_KEPT: 'INFO',
    ANALYSIS_FAILED: 'BLOCK',
    FIRST_SHEET_NO_LABEL: 'BLOCK',
    TOO_MANY_COPIES: 'BLOCK',
    FRONT_ORDER_UNCERTAIN: 'REVIEW',
    LOAD_STARTS_MID_COPY: 'REVIEW',
    SAME_NAME: 'REVIEW',
    COPY_UNUSUALLY_LONG: 'REVIEW',
    TOO_MANY_PAGES: 'REVIEW',
    BLANKS_TO_CONFIRM: 'REVIEW',
    MTIME_DISAGREES: 'REVIEW',
    NO_COPIES: 'BLOCK',
};

const isKnown = (code: string): code is ScanFlagCode =>
    Object.prototype.hasOwnProperty.call(CODE_SEVERITY, code);

export const toneForSeverity = (severity: string | null | undefined): FlagTone =>
    severity === 'BLOCK' ? 'danger' : severity === 'REVIEW' ? 'warning' : 'info';

/** The server's severity wins; the contract's is the fallback. */
export const flagCopy = (code: string, severity?: string | null): FlagCopy => {
    const known = isKnown(code);
    const key = known ? code : 'UNKNOWN';
    return {
        titleKey: `flags.${key}.title`,
        helpKey: `flags.${key}.help`,
        tone: toneForSeverity(severity ?? (known ? CODE_SEVERITY[code] : null)),
        known,
    };
};

/** Token classes for a flag chip of each tone. */
export const TONE_CHIP_CLASS: Record<FlagTone, string> = {
    danger: 'border-danger-200 bg-danger-50 text-danger-700',
    warning: 'border-warning-200 bg-warning-50 text-warning-700',
    info: 'border-info-200 bg-info-50 text-info-700',
};
