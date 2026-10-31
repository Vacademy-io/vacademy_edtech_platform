/**
 * Grouping helpers for curriculum libraries (NCERT etc.).
 *
 * The API returns them flat inside the ordinary knowledge-base list, each
 * carrying `curriculum: { board, class, subject, medium, book }`. Everything
 * that shows them — the picker in the assessment builder, the Curriculum tab —
 * wants the same Board → Class → Subject → Book drill-down, so it lives here.
 */
import type { KnowledgeBase } from '../../-types';

export const isCurriculum = (kb: KnowledgeBase): boolean => Boolean(kb.curriculum);

export const curriculumOnly = (kbs: KnowledgeBase[] | undefined): KnowledgeBase[] =>
    (kbs ?? []).filter(isCurriculum);

export const ownOnly = (kbs: KnowledgeBase[] | undefined): KnowledgeBase[] =>
    (kbs ?? []).filter((kb) => !isCurriculum(kb));

/** "9" before "10", letters ("UG") after numbers. */
const classOrder = (a: string, b: string): number => {
    const na = Number(a);
    const nb = Number(b);
    const aNum = Number.isFinite(na);
    const bNum = Number.isFinite(nb);
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    return a.localeCompare(b);
};

const uniq = (values: string[]): string[] => Array.from(new Set(values));

export const boardsOf = (kbs: KnowledgeBase[]): string[] =>
    uniq(kbs.map((kb) => kb.curriculum!.board)).sort();

export const classesOf = (kbs: KnowledgeBase[], board: string): string[] =>
    uniq(kbs.filter((kb) => kb.curriculum!.board === board).map((kb) => kb.curriculum!.class)).sort(
        classOrder
    );

export const subjectsOf = (kbs: KnowledgeBase[], board: string, cls: string): string[] =>
    uniq(
        kbs
            .filter((kb) => kb.curriculum!.board === board && kb.curriculum!.class === cls)
            .map((kb) => kb.curriculum!.subject)
    ).sort();

/** Every book (knowledge base) of one board + class + subject, in listing order. */
export const booksOf = (
    kbs: KnowledgeBase[],
    board: string,
    cls: string,
    subject: string
): KnowledgeBase[] =>
    kbs.filter(
        (kb) =>
            kb.curriculum!.board === board &&
            kb.curriculum!.class === cls &&
            kb.curriculum!.subject === subject
    );

/** "Class 11" / "UG" — for chips and dropdowns. */
export const classLabel = (
    cls: string,
    t: (key: string, opts?: Record<string, unknown>) => string
) => (Number.isFinite(Number(cls)) ? t('classLabel', { number: cls }) : cls);
