/**
 * The shop's own interface messages: shipped for Hindi and
 * English inside the commerce chunk, English as the fallback for any other language.
 */
import { en, type MessageKey } from './messages.en';
import { hi } from './messages.hi';

export type { MessageKey };

export type Translate = (key: MessageKey, vars?: Record<string, string | number | null | undefined>) => string;

const TABLES: Record<string, Partial<Record<MessageKey, string>>> = { en, hi };

/** The message table of a locale: "hi-in" reads the Hindi table, anything unknown English. */
export const messagesFor = (locale: string): Partial<Record<MessageKey, string>> => {
    const code = (locale || '').toLowerCase();
    return TABLES[code] ?? TABLES[code.split('-')[0] || ''] ?? en;
};

export const interpolate = (template: string, vars?: Record<string, string | number | null | undefined>): string =>
    vars
        ? template.replace(/\{(\w+)\}/g, (match, name: string) => {
              const value = vars[name];
              return value === null || value === undefined ? match : String(value);
          })
        : template;

/**
 * A message with a number in it has a "<key>.one" twin for exactly one ("1 product", not
 * "1 products"). Hindi carries the twin too, so the choice never falls back to English.
 */
export const createTranslate = (locale: string): Translate => {
    const table = messagesFor(locale);
    return (key, vars) => {
        const one = vars && Number(vars.count) === 1 ? (`${key}.one` as MessageKey) : null;
        const template = (one && (table[one] ?? (table[key] === undefined ? en[one] : undefined))) || table[key] || en[key] || key;
        return interpolate(template, vars);
    };
};

/** True when a message key exists (for keys built from API codes, such as badges). */
export const hasMessage = (key: string): key is MessageKey => Object.prototype.hasOwnProperty.call(en, key);

/** The switch shows a short text, never a flag: "हिं | EN". */
export const LOCALE_LABELS: Record<string, string> = { hi: 'हिं', en: 'EN', mr: 'मरा', gu: 'ગુજ', bn: 'বাং', ta: 'தமி' };

export const localeLabel = (locale: string): string => LOCALE_LABELS[locale] ?? locale.toUpperCase();
