import { MyButton } from '@/components/design-system/button';
import { MyDropdown } from '@/components/design-system/dropdown';
import { SearchableSelect } from '@/components/design-system/searchable-select';
import type { SearchableSelectOption } from '@/components/design-system/searchable-select';
import { Plus, Trash as Trash2 } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

export type CourseViewMode = 'DETAILS' | 'PAGE' | 'OUTLINE' | 'TILES';
export interface CoursePageSetting {
    mode?: CourseViewMode;
    route?: string;
}

const MODES: CourseViewMode[] = ['DETAILS', 'PAGE', 'OUTLINE', 'TILES'];

/**
 * What each course opens when a visitor clicks "View course".
 *
 * The catalogue's course cards all lead to one shared details page, rendered
 * the same way for every course off the package record. Institutes do not all
 * sell the same way — some courses need a page written for them, some sell on
 * their syllabus alone — so this picks a view per course:
 *
 *   DETAILS  the standard details page (the default, and what any course left
 *            out of the list keeps, so turning the setting on changes nothing
 *            until a course is given a mode)
 *   PAGE     a page authored in this catalogue replaces it entirely
 *   OUTLINE  the same details page with the syllabus leading and the
 *            marketing accordion dropped, as folder rows
 *   TILES    the same syllabus-first page with the subjects as artwork cards
 *
 * Stored as `coursePages.courses`: { '<course id>': { mode, route } }. Only
 * PAGE uses `route`, and it stores the page ROUTE because that is what the
 * learner URL is built from.
 *
 * Courses come from the institute's batches, the same source every other
 * course picker in the dashboard reads; the id it stores is the package id,
 * which is exactly what the catalogue's course cards carry. Both entity
 * pickers are SearchableSelect rather than a plain dropdown: an institute
 * routinely has more courses (and a catalogue more pages) than the ~8 above
 * which the design system requires search.
 */
export const CoursePagesEditor = ({
    courses: courseSettings,
    pages,
    onChange,
}: {
    courses: Record<string, CoursePageSetting>;
    pages: Array<{ id: string; route?: string; title?: string; published?: boolean }>;
    onChange: (next: Record<string, CoursePageSetting>) => void;
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { getCourseFromPackage } = useInstituteDetailsStore();

    const courses = getCourseFromPackage();
    const entries = Object.entries(courseSettings || {});

    // The details page lives at /<tag>/<courseId>, and a catalogue page at
    // /<tag>/<route> — the same route. Offering a page whose route is blank
    // (the home page) would send the CTA to a page that is not reachable by
    // route at all, so those are filtered out rather than silently broken.
    const pageOptions: SearchableSelectOption[] = pages
        .filter((p) => p.published !== false && typeof p.route === 'string' && p.route.trim() !== '')
        .map((p) => ({ label: p.title || p.route || '', value: p.route as string }));

    const commit = (next: [string, CoursePageSetting][]) => onChange(Object.fromEntries(next));

    const addRow = () => {
        const firstUnset = courses.find((c) => !(c.id in (courseSettings || {})));
        if (!firstUnset) return;
        commit([...entries, [firstUnset.id, { mode: 'DETAILS' }]]);
    };

    const setCourse = (index: number, courseId: string) => {
        // Re-keying an object entry has to rebuild it — mutating the key in
        // place would drop the row's position and, if the new id already has a
        // row, silently merge two rows into one.
        if (entries.some(([id], i) => i !== index && id === courseId)) return;
        commit(entries.map((e, i) => (i === index ? [courseId, e[1]] : e)));
    };

    const patchRow = (index: number, patch: Partial<CoursePageSetting>) =>
        commit(entries.map((e, i) => (i === index ? [e[0], { ...e[1], ...patch }] : e)));

    const removeRow = (index: number) => commit(entries.filter((_, i) => i !== index));

    const allSet = courses.length > 0 && entries.length >= courses.length;

    /** Courses this row may choose: its own, plus any not already spoken for.
     *  A course whose row was deleted from the institute still has to appear
     *  or the row would render blank and the next edit would silently move it. */
    const courseOptionsFor = (courseId: string): SearchableSelectOption[] => {
        const options = courses
            .filter((c) => c.id === courseId || !(c.id in (courseSettings || {})))
            .map((c) => ({ label: c.name, value: c.id }));
        return courses.some((c) => c.id === courseId)
            ? options
            : [{ label: courseId, value: courseId }, ...options];
    };

    return (
        <div className="space-y-2 rounded-md border border-dashed border-neutral-200 p-2">
            {entries.length === 0 && (
                <p className="text-caption text-neutral-400">{t('global.coursePages.empty')}</p>
            )}
            {entries.map(([courseId, setting], index) => {
                const mode: CourseViewMode = setting?.mode ?? (setting?.route ? 'PAGE' : 'DETAILS');
                const route = setting?.route || '';
                return (
                    <div
                        key={`${courseId}-${index}`}
                        className="space-y-2 rounded-md border border-neutral-200 bg-white p-2"
                    >
                        <div className="flex items-center gap-1">
                            <div className="min-w-0 flex-1">
                                <SearchableSelect
                                    options={courseOptionsFor(courseId)}
                                    value={courseId}
                                    onChange={(v) => setCourse(index, v)}
                                    placeholder={t('global.coursePages.courseLabel')}
                                    searchPlaceholder={t('global.coursePages.courseSearch')}
                                    emptyText={t('global.coursePages.noCourses')}
                                />
                            </div>
                            <MyButton
                                buttonType="text"
                                layoutVariant="icon"
                                scale="small"
                                className="shrink-0 text-danger-600"
                                onClick={() => removeRow(index)}
                                aria-label={t('global.coursePages.remove')}
                            >
                                <Trash2 className="size-4" />
                            </MyButton>
                        </div>

                        <MyDropdown
                            currentValue={t(`global.coursePages.mode.${mode}`)}
                            dropdownList={MODES.map((m) => ({
                                label: t(`global.coursePages.mode.${m}`),
                                value: m,
                            }))}
                            handleChange={(v) => patchRow(index, { mode: v as CourseViewMode })}
                            placeholder={t('global.coursePages.modeLabel')}
                            className="w-full"
                        />
                        <p className="text-caption text-neutral-400">
                            {t(`global.coursePages.modeHint.${mode}`)}
                        </p>

                        {/* The page picker belongs to PAGE alone — showing it
                            for the other modes would imply the choice matters
                            there, and the learner side ignores it. */}
                        {mode === 'PAGE' && (
                            <>
                                {pageOptions.length === 0 ? (
                                    <p className="text-caption text-warning-600">
                                        {t('global.coursePages.noPages')}
                                    </p>
                                ) : (
                                    <SearchableSelect
                                        options={
                                            route && !pageOptions.some((p) => p.value === route)
                                                ? [{ label: route, value: route }, ...pageOptions]
                                                : pageOptions
                                        }
                                        value={route}
                                        onChange={(v) => patchRow(index, { route: v })}
                                        placeholder={t('global.coursePages.pagePlaceholder')}
                                        searchPlaceholder={t('global.coursePages.pageSearch')}
                                        emptyText={t('global.coursePages.noPages')}
                                    />
                                )}
                                {!route && pageOptions.length > 0 && (
                                    <p className="text-caption text-warning-600">
                                        {t('global.coursePages.unsetRowHint')}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                );
            })}
            <MyButton
                buttonType="secondary"
                scale="small"
                className="w-full gap-1"
                disable={allSet || courses.length === 0}
                onClick={addRow}
            >
                <Plus className="size-4" /> {t('global.coursePages.add')}
            </MyButton>
            {courses.length === 0 && (
                <p className="text-caption text-neutral-400">{t('global.coursePages.noCourses')}</p>
            )}
            {allSet && (
                <p className="text-caption text-neutral-400">{t('global.coursePages.allMapped')}</p>
            )}
        </div>
    );
};
