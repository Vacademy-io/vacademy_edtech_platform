/**
 * Section ids for the create wizard's step 2 (assessment and homework).
 *
 * Step 2 sends a diff: classifySections compares the form against the last
 * saved copy (oldData) and treats a section with no id as new. The save
 * response carries no section ids, so the create flow used to keep every
 * section at sectionId '' after its first save. Saving step 2 again (back from
 * step 3, after a rename, after adding a section) then sent every section as
 * new and the server stored a second copy of each, questions included
 * (Prepper "FR Mock 1", 2026-11-18: 2 sections became 4, 100 marks became 200).
 *
 * After a save the wizard reads the assessment back and writes each new
 * section's id into the form, so the next save updates instead of adding.
 */

/** A saved section as the assessment details (step 2 saved_data.sections) return it. */
export interface SavedSectionRef {
    id: string;
    section_order?: number | null;
}

/**
 * The id each form section should carry after a save.
 *
 * Sections that already have an id keep it. A section without one takes the
 * id of the server section that is not yet in the form and was saved at its
 * position: the wizard sends a new section with section_order = index + 1,
 * and the server stores that order. If positions cannot place every new
 * section but the counts agree, they are paired in order. A section still
 * unmatched stays '' (sent as new again), which is the old behaviour and
 * never points a section at the wrong id.
 *
 * @param otherKnownIds ids the wizard already knows elsewhere (the last saved
 *        copy): a section the admin removed from the form is not "new".
 */
export function resolveSavedSectionIds(
    formSectionIds: readonly string[],
    serverSections: readonly SavedSectionRef[] | null | undefined,
    otherKnownIds: Iterable<string> = []
): string[] {
    const result = formSectionIds.map((id) => id || '');
    const known = new Set([...result.filter(Boolean), ...otherKnownIds]);
    const fresh = (serverSections ?? []).filter((s) => s?.id && !known.has(s.id));
    if (fresh.length === 0) return result;

    const used = new Set<string>();
    result.forEach((id, index) => {
        if (id) return;
        const atPosition = fresh.filter((s) => !used.has(s.id) && s.section_order === index + 1);
        if (atPosition.length === 1) {
            result[index] = atPosition[0]!.id;
            used.add(atPosition[0]!.id);
        }
    });

    const blanks = result.flatMap((id, index) => (id ? [] : [index]));
    const left = fresh
        .filter((s) => !used.has(s.id))
        .sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0));
    if (blanks.length > 0 && blanks.length === left.length) {
        blanks.forEach((formIndex, k) => {
            result[formIndex] = left[k]!.id;
        });
    }
    return result;
}

/** True when some form section has no id but the server holds a section the form does not know. */
export function hasUnrecordedSavedSections(
    formSectionIds: readonly string[],
    serverSections: readonly SavedSectionRef[] | null | undefined,
    otherKnownIds: Iterable<string> = []
): boolean {
    if (!formSectionIds.some((id) => !id)) return false;
    const known = new Set([...formSectionIds.filter(Boolean), ...otherKnownIds]);
    return (serverSections ?? []).some((s) => s?.id && !known.has(s.id));
}

/**
 * Store sections saved to another assessment (an abandoned wizard) must not
 * bring their ids into this one: they would be diffed as "unchanged" and never
 * created here.
 */
export function withoutSectionIds<T extends { sectionId: string }>(sections: readonly T[]): T[] {
    return sections.map((section) => ({ ...section, sectionId: '' }));
}

/** A copy of the form values to diff the next save against, detached from the form. */
export function snapshotFormValues<T>(values: T): T {
    try {
        return structuredClone(values);
    } catch {
        return JSON.parse(JSON.stringify(values)) as T;
    }
}
