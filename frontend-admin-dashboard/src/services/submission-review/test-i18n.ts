/** English catalogs for submission-review component tests (real strings, no network). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const NAMESPACES = [
    'assessmentSubmissionReview',
    'assessmentSubmissionReviewList',
    'assessmentStudentAttemptDropdown',
];

const load = (ns: string) =>
    JSON.parse(readFileSync(resolve(process.cwd(), 'public/locales/en', `${ns}.json`), 'utf-8'));

export const setupTestI18n = async () => {
    await i18n.use(initReactI18next).init({
        lng: 'en',
        fallbackLng: 'en',
        ns: NAMESPACES,
        defaultNS: NAMESPACES[0],
        resources: { en: Object.fromEntries(NAMESPACES.map((ns) => [ns, load(ns)])) },
        interpolation: { escapeValue: false },
        react: { useSuspense: false },
    });
    return i18n;
};
