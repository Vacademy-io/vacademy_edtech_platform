import { StorageKey } from '@/constants/storage/storage';
import {
    ContentTerms,
    OtherTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';
import type { NamingSettingsType } from '@/routes/settings/-constants/terms';
import type { Rename } from './search';

/**
 * Training videos are recorded and titled once, in English, with the platform's default terms.
 * This rewrites what admins READ (titles, topics, section names) into their institute's own
 * words from Settings › Naming Settings — "Turn Your Course Into a Paid Course" becomes
 * "Turn Your Programme Into a Paid Programme" for an institute that renamed Course.
 *
 * Deliberately uses the institute's flat customValue (its content-source-language word), not
 * getTerminology(): in a Hindi/French UI getTerminology returns the translated system word, which
 * would splice "Cours" / "पाठ्यक्रम" into an English video title.
 */
interface TermRule {
    key: string;
    system: string;
    /** Lower-case forms that appear in video text. Longest first within each list. */
    singular: string[];
    plural: string[];
}

const RULES: TermRule[] = [
    {
        key: ContentTerms.LiveSession,
        system: SystemTerms.LiveSession,
        singular: ['live session', 'live class'],
        plural: ['live sessions', 'live classes'],
    },
    {
        key: OtherTerms.AudienceList,
        system: SystemTerms.AudienceList,
        singular: ['audience list'],
        plural: ['audience lists'],
    },
    {
        key: ContentTerms.Course,
        system: SystemTerms.Course,
        singular: ['course'],
        plural: ['courses'],
    },
    {
        key: ContentTerms.Batch,
        system: SystemTerms.Batch,
        singular: ['batch'],
        plural: ['batches'],
    },
    {
        key: ContentTerms.Subject,
        system: SystemTerms.Subject,
        singular: ['subject'],
        plural: ['subjects'],
    },
    {
        key: ContentTerms.Module,
        system: SystemTerms.Module,
        singular: ['module'],
        plural: ['modules'],
    },
    {
        key: ContentTerms.Chapter,
        system: SystemTerms.Chapter,
        singular: ['chapter'],
        plural: ['chapters'],
    },
    { key: ContentTerms.Slide, system: SystemTerms.Slide, singular: ['slide'], plural: ['slides'] },
    {
        key: RoleTerms.Learner,
        system: SystemTerms.Learner,
        singular: ['learner', 'student'],
        plural: ['learners', 'students'],
    },
    {
        key: RoleTerms.Teacher,
        system: SystemTerms.Teacher,
        singular: ['teacher'],
        plural: ['teachers'],
    },
];

// Settings stores the plural of the four structure terms under their old plural key.
const LEGACY_KEYS: Record<string, string> = {
    Subject: 'Subjects',
    Module: 'Modules',
    Chapter: 'Chapters',
    Slide: 'Slides',
};

function readSettings(): NamingSettingsType[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(StorageKey.NAMING_SETTINGS) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

const pluralOf = (word: string) => (/(s|x|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`);

const LATIN = /^[\p{Script=Latin}\p{N}\s\-'’&./()]+$/u;

/** Match the case of the word being replaced: "Course"→"Programme", "course"→"programme". */
function matchCase(found: string, replacement: string): string {
    if (found === found.toUpperCase() && found.length > 1) return replacement.toUpperCase();
    if (found.charAt(0) === found.charAt(0).toUpperCase())
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    // Only lower-case a plain word ("Programme"); keep acronyms and brand casing ("NEET Batch").
    return /^[A-Z][a-z]+$/.test(replacement) ? replacement.toLowerCase() : replacement;
}

export interface TrainingTerminology {
    rename: Rename;
    /** The institute uses at least one custom term the videos don't. */
    active: boolean;
}

export function getTrainingTerminology(): TrainingTerminology {
    const settings = readSettings();
    const replacements: Array<{
        re: RegExp;
        singular: string;
        plural: string;
        pluralForms: Set<string>;
    }> = [];
    for (const rule of RULES) {
        const setting = settings.find((s) => s.key === rule.key || s.key === LEGACY_KEYS[rule.key]);
        const singular = setting?.customValue?.trim();
        if (
            !singular ||
            !LATIN.test(singular) ||
            singular.toLowerCase() === rule.system.toLowerCase()
        )
            continue;
        const pluralRaw = setting?.customPluralValue?.trim();
        const plural =
            pluralRaw &&
            LATIN.test(pluralRaw) &&
            pluralRaw.toLowerCase() !== pluralOf(rule.system).toLowerCase()
                ? pluralRaw
                : pluralOf(singular);
        const forms = [...rule.plural, ...rule.singular].sort((a, b) => b.length - a.length);
        replacements.push({
            re: new RegExp(
                `\\b(${forms.map((f) => f.replace(/\s+/g, '\\s+')).join('|')})\\b`,
                'gi'
            ),
            singular,
            plural,
            pluralForms: new Set(rule.plural),
        });
    }
    if (!replacements.length) return { rename: (s) => s, active: false };
    const rename: Rename = (text) => {
        let out = text;
        for (const r of replacements)
            out = out.replace(r.re, (found) =>
                matchCase(
                    found,
                    r.pluralForms.has(found.toLowerCase().replace(/\s+/g, ' '))
                        ? r.plural
                        : r.singular
                )
            );
        return out;
    };
    return { rename, active: true };
}
