import { getAssessmentSettings } from '@/services/assessment-settings';
import { normalizeCommentPlacement } from '@/types/assessment-settings';
import { getCopyCheckConfig } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/copy-intake-services';
import type { ScanStartBody } from '../-services/scan-station-services';

/**
 * Hands-free scanning: the clerk answers a few questions once, then a pile goes
 * in and checked copies come out with no more clicks. Kept per browser, because
 * it describes the desk (its scanner, its printer, its copies), not the test.
 */
export interface HandsFreeSettings {
    /** Are the answers written on one side of each sheet, or on both? */
    sides: 'ONE' | 'BOTH';
    /** Start the AI check by itself as soon as the copies are sorted with nothing to look at. */
    autoCheck: boolean;
    /** Print each checked copy as soon as it is ready (needs a printer and autoCheck). */
    print: boolean;
    /**
     * true: match each copy to a student of this test by the name on it.
     * false: check each copy on its own under the name written on it, without
     * adding it to anyone's results (demos, or students not on the list).
     */
    matchStudents: boolean;
}

export const DEFAULT_HANDS_FREE: HandsFreeSettings = {
    sides: 'BOTH',
    autoCheck: false,
    print: false,
    matchStudents: true,
};

const KEY = 'scanStation.handsFree';

export const readHandsFree = (): HandsFreeSettings => {
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return DEFAULT_HANDS_FREE;
        const v = JSON.parse(raw) as Partial<HandsFreeSettings>;
        return {
            sides: v.sides === 'ONE' ? 'ONE' : 'BOTH',
            autoCheck: v.autoCheck === true,
            print: v.print === true,
            matchStudents: v.matchStudents !== false,
        };
    } catch {
        return DEFAULT_HANDS_FREE;
    }
};

export const saveHandsFree = (value: HandsFreeSettings) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
        // Storage blocked: the choice lasts until the page is left.
    }
};

/**
 * The start body the "Start checking" dialog would send with nothing changed:
 * the test's own marking settings over the institute's defaults, the institute's
 * remark placement, and no email (the clerk is standing at the desk).
 */
export const defaultStartBody = async (
    assessmentId: string,
    instituteId: string,
    matchStudents: boolean
): Promise<ScanStartBody> => {
    const [own, institute] = await Promise.allSettled([
        getCopyCheckConfig(assessmentId, instituteId),
        getAssessmentSettings(true),
    ]);
    const mine = own.status === 'fulfilled' ? own.value ?? {} : {};
    const defaults = institute.status === 'fulfilled' ? institute.value.aiCopyCheck : undefined;
    const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
    return {
        preferred_model: null,
        notify_email: false,
        comment_placement: normalizeCommentPlacement(defaults?.commentPlacement),
        copy_check_config: {
            subject: text(mine.subject),
            level: text(mine.level),
            instructions: text(mine.instructions ?? defaults?.instructions),
            language_feedback: mine.language_feedback ?? defaults?.languageFeedback ?? 'OFF',
        },
        map_students: matchStudents,
    };
};

/** Checked copies already sent to the printer, per batch, so a reload never prints twice. */
const printedKey = (batchId: string) => `scanStation.printed.${batchId}`;

export const readPrinted = (batchId: string): Set<string> => {
    try {
        const raw = window.localStorage.getItem(printedKey(batchId));
        return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
        return new Set();
    }
};

export const savePrinted = (batchId: string, itemIds: Set<string>) => {
    try {
        window.localStorage.setItem(printedKey(batchId), JSON.stringify([...itemIds]));
    } catch {
        // Storage blocked: a reload may offer to print again.
    }
};
