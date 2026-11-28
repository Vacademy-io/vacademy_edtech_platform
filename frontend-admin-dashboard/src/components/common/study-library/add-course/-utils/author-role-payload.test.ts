import { describe, expect, it } from 'vitest';
import { convertToApiCourseFormat, convertToApiCourseFormatUpdate, type CourseFormData } from '../../-utils/helper';

const author = (id: string, roleLabel?: string) => ({
    id,
    name: `Name ${id}`,
    email: `${id}@x.test`,
    profilePicId: '',
    ...(roleLabel !== undefined ? { roleLabel } : {}),
});

const simpleCourse = (selectedInstructors: ReturnType<typeof author>[]) =>
    ({
        course: 'C',
        hasLevels: 'no',
        hasSessions: 'no',
        sessions: [],
        selectedInstructors,
        instructors: [],
        publishToCatalogue: false,
        tags: [],
        levelStructure: 2,
    }) as unknown as CourseFormData;

describe('author role_label in the course payload', () => {
    it('create sends the trimmed role per author, nothing when unset', () => {
        const out = convertToApiCourseFormat(simpleCourse([author('a', ' Acharya '), author('b')]));
        const level = out.sessions[0]!.levels[0]!;
        expect(level.add_faculty_to_course[0]!.role_label).toBe('Acharya');
        expect('role_label' in level.add_faculty_to_course[1]!).toBe(false);
        expect(out.add_faculty_to_course?.[0]?.role_label).toBe('Acharya');
    });

    it('edit takes the role from the course-level list, not a stale level copy', () => {
        const levelCopy = author('a', 'Instructor');
        const before = {
            ...simpleCourse([levelCopy]),
            sessions: [{ id: 's', name: 'S', startDate: '', levels: [{ id: 'l', name: 'L', userIds: [levelCopy], newLevel: false }] }],
        } as unknown as CourseFormData;
        const after = {
            ...before,
            selectedInstructors: [author('a', 'Acharya')],
            sessions: [{ id: 's', name: 'S', startDate: '', levels: [{ id: 'l', name: 'L', userIds: [levelCopy, author('b')], newLevel: false }] }],
        } as unknown as CourseFormData;
        const out = convertToApiCourseFormatUpdate(before, after, () => 'ps');
        const entries = out.sessions[0]!.levels[0]!.add_faculty_to_course as Array<{ user: { id: string }; role_label?: string }>;
        expect(entries.find((e) => e.user.id === 'a')!.role_label).toBe('Acharya');
        expect('role_label' in entries.find((e) => e.user.id === 'b')!).toBe(false);
    });
});
