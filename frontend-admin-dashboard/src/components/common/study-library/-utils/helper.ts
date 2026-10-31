import { CourseDetailsFormValues } from '@/routes/study-library/courses/course-details/-components/course-details-schema';
import { Step1Data, Step2Data } from '../add-course/add-course-form';
import { Session } from '@/types/course/create-course';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey, Authority } from '@/constants/auth/tokens';
import { buildCoursePageJson, parseCoursePageJson } from '../add-course/-utils/course-page-content';

export type CourseFormData = Step1Data & Step2Data;
interface AddFacultyToCourse {
    user: UserDetails;
    new_user: boolean;
    /** Display role in this course (Author / Instructor / Acharya ...); '' clears it. */
    role_label?: string;
}

/**
 * Each author's role, read from the course-level author list: a level's userIds
 * hold copies taken when the author was assigned, so they can be stale.
 */
const roleLabelsById = (formData: CourseFormData) =>
    new Map(
        (Array.isArray(formData.selectedInstructors) ? formData.selectedInstructors : []).map(
            (i) => [i.id, i.roleLabel] as const
        )
    );

const withRoleLabel = (role: string | undefined) =>
    role !== undefined ? { role_label: role.trim() } : {};

interface UserDetails {
    id: string;
    username: string;
    email: string;
    full_name: string;
    address_line: string;
    city: string;
    region: string;
    pin_code: string;
    mobile_number: string;
    date_of_birth: string;
    gender: string;
    password: string;
    profile_pic_file_id: string;
    roles: string[];
    root_user: boolean;
    /** Optional author-profile metadata (subtitle / description). */
    author_subtitle?: string;
    author_description?: string;
}

interface GroupDetails {
    id: string;
    group_name: string;
    group_value: string;
    new_group: boolean;
}

interface LevelDetails {
    id: string;
    new_level: boolean;
    level_name: string;
    duration_in_days: number;
    thumbnail_file_id: string;
    package_id: string;
    package_session_status?: string;
    package_session_id?: string;
    new_package_session?: boolean;
    is_parent?: boolean;
    parent_id?: string | null;
    add_faculty_to_course: AddFacultyToCourse[];
    group: GroupDetails;
    subgroups?: { id?: string; name: string }[];
}

export interface SessionDetails {
    id: string;
    session_name: string;
    status: string;
    start_date: string;
    new_session: boolean;
    levels: LevelDetails[];
}

export interface FormattedCourseData {
    id: string;
    new_course: boolean;
    course_name: string;
    thumbnail_file_id: string;
    course_html_description: string;
    contain_levels: boolean;
    sessions: SessionDetails[];
    /**
     * Authors for a course with no sessions/levels. The backend ignores
     * `sessions` entirely when `contain_levels` is false and reads its
     * authors from here instead (CourseService.addCourse ->
     * createPackageSessionForDefaultLevelAndSession).
     */
    add_faculty_to_course?: AddFacultyToCourse[];
    /**
     * Optional subgroup configuration for the course.
     * When true, the backend will create child batches (package_session rows)
     * for each provided subgroup under the first active parent batch.
     */
    contains_subgroup?: boolean;
    subgroups?: { name: string }[];
    is_course_published_to_catalaouge: boolean;
    course_preview_image_media_id: string;
    course_banner_media_id: string;
    course_media_id: string;
    why_learn_html: string;
    who_should_learn_html: string;
    about_the_course_html: string;
    tags: string[];
    course_depth: number;
    // Approval-workflow fields. Always set on create; on update only `status`
    // is sent (the course's current value) and the rest are omitted so the
    // backend keeps ownership / copy linkage as stored.
    status?: string;
    created_by_user_id?: string;
    original_course_id?: string | null;
    version_number?: number;
    /**
     * Optional per-course advanced settings JSON (package.course_setting envelope).
     * Only set when the wizard's Advanced Settings JSON is present and valid.
     */
    course_setting?: string;
    /**
     * Public course-page extras (mode + FAQs) as a JSON string. Omitted = keep what is
     * stored; "" = clear (update only). See add-course/-utils/course-page-content.ts.
     */
    course_page_json?: string;
}

type FormattedSession = FormattedCourseData['sessions'][0];
type FormattedLevel = FormattedSession['levels'][0];

export const convertToApiCourseFormat = (formData: CourseFormData): FormattedCourseData => {
    const hasLevels = formData.hasLevels === 'yes';
    const hasSessions = formData.hasSessions === 'yes';

    // Collect subgroup names from both the legacy top-level form data and from
    // any per-level subgroup configuration, if present.
    const topLevelSubgroupNames: string[] = Array.isArray(
        (formData as unknown as { subgroups?: { subgroupName?: string }[] }).subgroups
    )
        ? ((formData as unknown as { subgroups?: { subgroupName?: string }[] }).subgroups ?? [])
              .map((sg) => (sg.subgroupName || '').trim())
              .filter(Boolean)
        : [];

    const levelSubgroupNames: string[] = Array.isArray(formData.sessions)
        ? formData.sessions.flatMap((session: any) =>
              (session.levels ?? []).flatMap((level: any) =>
                  (level.subgroups ?? [])
                      .map((sg: any) => (sg?.subgroupName || '').trim())
                      .filter(Boolean)
              )
          )
        : [];

    const allSubgroupNames = [...topLevelSubgroupNames, ...levelSubgroupNames];
    const containsSubgroup = allSubgroupNames.length > 0;

    // For the new nested model, we only send the legacy root-level `subgroups`
    // when there are top-level entries AND no nested level subgroups. When
    // nested subgroups exist, they are sent per level and the root list is
    // omitted so the backend uses the new per-(session, level) behaviour.
    const formattedSubgroups =
        containsSubgroup && levelSubgroupNames.length === 0
            ? topLevelSubgroupNames.map((name) => ({ name }))
            : undefined;

    const roleById = roleLabelsById(formData);
    const mapUser = (user: {
        id: string;
        name: string;
        email: string;
        profilePicId: string;
        authorSubtitle?: string;
        authorDescription?: string;
        roleLabel?: string;
    }) => ({
        user: {
            id: user.id || '',
            username: '',
            email: user.email || '',
            full_name: user.name || '',
            address_line: '',
            city: '',
            region: '',
            pin_code: '',
            mobile_number: '',
            date_of_birth: '',
            gender: '',
            password: '',
            profile_pic_file_id: user.profilePicId,
            roles: [],
            root_user: true,
            ...(user.authorSubtitle !== undefined ? { author_subtitle: user.authorSubtitle } : {}),
            ...(user.authorDescription !== undefined
                ? { author_description: user.authorDescription }
                : {}),
        },
        new_user: false,
        ...withRoleLabel(roleById.get(user.id) ?? user.roleLabel),
    });

    const formatLevels = (
        levels: Array<{
            id: string;
            name: string;
            userIds: { id: string; name: string; email: string; profilePicId: string }[];
            newLevel: boolean;
            subgroups?: { subgroupName?: string }[];
        }>
    ): FormattedLevel[] =>
        levels.map((level) => {
            const nestedSubgroups =
                Array.isArray(level.subgroups) && level.subgroups.length > 0
                    ? level.subgroups
                          .map((sg) => (sg.subgroupName || '').trim())
                          .filter(Boolean)
                          .map((name) => ({ name }))
                    : undefined;

            return {
                id: level.id,
                new_level: level.newLevel,
                level_name: level.name,
                duration_in_days: 0,
                thumbnail_file_id: '',
                package_id: '',
                add_faculty_to_course: [...(level.userIds?.map(mapUser) ?? [])],
                group: {
                    id: '',
                    group_name: '',
                    group_value: '',
                    new_group: true,
                },
                ...(nestedSubgroups && nestedSubgroups.length > 0
                    ? { subgroups: nestedSubgroups }
                    : {}),
            } as FormattedLevel;
        });

    let sessions: FormattedSession[] = [];

    if (!hasLevels && !hasSessions) {
        // The authors the admin picked. `instructors` is the whole staff list the
        // picker offers, and sending it made every staff member an author.
        const allUsers = formData.selectedInstructors;

        sessions = [
            {
                id: 'DEFAULT',
                session_name: 'DEFAULT',
                status: 'ACTIVE',
                start_date: '',
                new_session: true,
                levels: [
                    {
                        id: 'DEFAULT',
                        new_level: true,
                        level_name: 'DEFAULT',
                        duration_in_days: 0,
                        thumbnail_file_id: '',
                        package_id: '',
                        is_parent: false,
                        parent_id: null,
                        add_faculty_to_course: [
                            ...(Array.isArray(allUsers) ? allUsers.map(mapUser) : []),
                        ],
                        group: {
                            id: 'DEFAULT',
                            group_name: 'DEFAULT',
                            group_value: '',
                            new_group: true,
                        },
                    },
                ],
            },
        ];
    } else if (hasSessions) {
        sessions = formData.sessions.map((session) => ({
            id: session.id,
            session_name: session.name,
            status: 'ACTIVE',
            start_date: session.startDate,
            new_session: session.newSession,
            levels: hasLevels
                ? formatLevels(session.levels)
                : [
                      {
                          id: 'DEFAULT',
                          new_level: true,
                          level_name: 'DEFAULT',
                          duration_in_days: 0,
                          thumbnail_file_id: '',
                          package_id: '',
                          is_parent: false,
                          parent_id: null,
                          add_faculty_to_course: [
                              ...(session.levels?.[0]?.userIds?.map(mapUser) ?? []),
                          ],
                          group: {
                              id: 'DEFAULT',
                              group_name: 'DEFAULT',
                              group_value: '',
                              new_group: true,
                          },
                      },
                  ],
        }));
    } else if (hasLevels) {
        const standaloneLevels = formData.sessions.find((s) => s.id === 'DEFAULT')?.levels || [];
        sessions = [
            {
                id: 'DEFAULT',
                session_name: 'DEFAULT',
                status: 'ACTIVE',
                start_date: '',
                new_session: true,
                levels: standaloneLevels.map((level) => ({
                    id: level.id,
                    new_level: level.newLevel,
                    level_name: level.name,
                    duration_in_days: 0,
                    thumbnail_file_id: '',
                    package_id: '',
                    is_parent: (level as { is_parent?: boolean }).is_parent,
                    parent_id: (level as { parent_id?: string | null }).parent_id ?? null,
                    add_faculty_to_course: [...(level.userIds?.map(mapUser) ?? [])],
                    group: {
                        id: '',
                        group_name: '',
                        group_value: '',
                        new_group: true,
                    },
                })),
            },
        ];
    }

    // Get user data for approval workflow
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const isAdmin =
        tokenData?.authorities &&
        Object.values(tokenData.authorities).some((auth: Authority) =>
            auth?.roles?.includes('ADMIN')
        );

    // Per-course advanced settings JSON from the wizard. Only include when present
    // and valid JSON, so course creation never breaks on a malformed entry.
    const rawCourseSetting = (formData as { courseSettingJson?: string }).courseSettingJson;
    let courseSetting: string | undefined;
    if (rawCourseSetting && rawCourseSetting.trim().length > 0) {
        try {
            courseSetting = JSON.stringify(JSON.parse(rawCourseSetting));
        } catch {
            courseSetting = undefined;
        }
    }

    // Course-page extras: omitted entirely when the admin filled nothing in.
    const coursePageJson = buildCoursePageJson(formData.coursePage, { isEdit: false });

    // A simple course (no sessions, no levels) sends contain_levels=false, and
    // the backend then never looks inside `sessions` -- so the authors nested
    // under the DEFAULT level above were silently dropped on every create and
    // the course fell back to showing its creator. Mirror them at the top
    // level, which is the field that path actually reads.
    const defaultAuthors =
        !hasLevels && !hasSessions && Array.isArray(formData.selectedInstructors)
            ? formData.selectedInstructors.map(mapUser)
            : undefined;

    return {
        id: '',
        new_course: true,
        course_name: formData.course || '',
        thumbnail_file_id: '',
        contain_levels: hasLevels || hasSessions,
        sessions,
        ...(defaultAuthors ? { add_faculty_to_course: defaultAuthors } : {}),
        contains_subgroup: containsSubgroup,
        subgroups: formattedSubgroups,
        is_course_published_to_catalaouge: formData.publishToCatalogue,
        course_preview_image_media_id: formData.coursePreview || '',
        course_banner_media_id: formData.courseBanner || '',
        course_media_id: JSON.stringify(formData.courseMedia) || '',
        why_learn_html: formData.learningOutcome || '',
        who_should_learn_html: formData.targetAudience || '',
        about_the_course_html: formData.aboutCourse || '',
        tags: formData.tags || [],
        course_depth: formData.levelStructure || 2,
        course_html_description: formData.description || '',
        // New fields for teacher approval workflow
        status: isAdmin ? 'ACTIVE' : 'DRAFT',
        created_by_user_id: tokenData?.user || '',
        original_course_id: null,
        version_number: 1,
        ...(courseSetting ? { course_setting: courseSetting } : {}),
        ...(coursePageJson !== null ? { course_page_json: coursePageJson } : {}),
    };
};

export const convertToApiCourseFormatUpdate = (
    oldFormData: CourseFormData,
    formData: CourseFormData,
    getPackageSessionId: (params: {
        courseId: string;
        sessionId: string;
        levelId: string;
    }) => string
): FormattedCourseData => {
    const hasLevels = formData.hasLevels === 'yes';
    const hasSessions = formData.hasSessions === 'yes';

    // Derive subgroup configuration for update requests in the same way as creation.
    const topLevelSubgroupNames: string[] = Array.isArray(
        (formData as unknown as { subgroups?: { subgroupName?: string }[] }).subgroups
    )
        ? ((formData as unknown as { subgroups?: { subgroupName?: string }[] }).subgroups ?? [])
              .map((sg) => (sg.subgroupName || '').trim())
              .filter(Boolean)
        : [];

    const levelSubgroupNames: string[] = Array.isArray(formData.sessions)
        ? formData.sessions.flatMap((session: any) =>
              (session.levels ?? []).flatMap((level: any) =>
                  (level.subgroups ?? [])
                      .map((sg: any) => (sg?.subgroupName || '').trim())
                      .filter(Boolean)
              )
          )
        : [];

    const allSubgroupNames = [...topLevelSubgroupNames, ...levelSubgroupNames];
    const containsSubgroup = allSubgroupNames.length > 0;
    const formattedSubgroups =
        containsSubgroup && levelSubgroupNames.length === 0
            ? topLevelSubgroupNames.map((name) => ({ name }))
            : undefined;

    const findById = <T extends { id: string }>(list: T[], id: string) =>
        list.find((item) => item.id === id);

    type User = {
        id: string;
        name: string;
        email: string;
        profilePicId: string;
        authorSubtitle?: string;
        authorDescription?: string;
        roleLabel?: string;
    };
    const roleById = roleLabelsById(formData);

    type Level = {
        id: string;
        name: string;
        userIds: User[];
        newLevel: boolean;
    };

    const formatLevels = (sessionId: string, newLevels: Level[] = [], oldLevels: Level[] = []) => {
        const allLevelIds = new Set([...newLevels.map((l) => l.id), ...oldLevels.map((l) => l.id)]);

        return Array.from(allLevelIds).map((levelId) => {
            const current = findById(newLevels, levelId);
            const previous = findById(oldLevels, levelId);

            const isNewLevel = current && !previous;
            const isDeletedLevel = !current && previous;
            const level = current || previous;

            const currentUsers: User[] = current?.userIds || [];
            const previousUsers: User[] = previous?.userIds || [];

            const toUserPayload = (user: User) => ({
                id: user.id || '',
                username: '',
                email: user.email || '',
                full_name: user.name || '',
                address_line: '',
                city: '',
                region: '',
                pin_code: '',
                mobile_number: '',
                date_of_birth: '',
                gender: '',
                password: '',
                profile_pic_file_id: user.profilePicId || '',
                roles: [],
                root_user: true,
                ...(user.authorSubtitle !== undefined
                    ? { author_subtitle: user.authorSubtitle }
                    : {}),
                ...(user.authorDescription !== undefined
                    ? { author_description: user.authorDescription }
                    : {}),
            });

            const deletedUsers = previousUsers
                .filter((oldUser) => !currentUsers.some((newUser) => newUser.id === oldUser.id))
                .map((user) => ({
                    user: toUserPayload(user),
                    status: 'DELETED',
                    new_user: false,
                }));

            const addedUsers = currentUsers
                .filter((newUser) => !previousUsers.some((oldUser) => oldUser.id === newUser.id))
                .map((user) => ({
                    user: toUserPayload(user),
                    status: 'ACTIVE',
                    new_user: false,
                    ...withRoleLabel(roleById.get(user.id) ?? user.roleLabel),
                }));

            const existingUsers = currentUsers
                .filter((newUser) => previousUsers.some((oldUser) => oldUser.id === newUser.id))
                .map((user) => ({
                    user: toUserPayload(user),
                    status: 'ACTIVE',
                    new_user: false,
                    ...withRoleLabel(roleById.get(user.id) ?? user.roleLabel),
                }));

            const add_faculty_to_course = [...deletedUsers, ...addedUsers, ...existingUsers];

            const subgroupList = Array.isArray(
                (
                    current as unknown as {
                        subgroups?: { id?: string; subgroupName?: string; name?: string }[];
                    }
                )?.subgroups
            )
                ? (
                      current as unknown as {
                          subgroups: { id?: string; subgroupName?: string; name?: string }[];
                      }
                  ).subgroups
                      .map((sg) => {
                          const name = (sg.subgroupName ?? sg.name ?? '').trim();
                          return name.length > 0 ? { ...(sg.id ? { id: sg.id } : {}), name } : null;
                      })
                      .filter((n): n is { id?: string; name: string } => n !== null)
                : undefined;
            const subgroupPayload =
                subgroupList !== undefined && subgroupList.length >= 0 ? subgroupList : undefined;

            return {
                id: level?.id || '',
                new_level: level?.newLevel ?? false,
                level_name: level?.name || '',
                duration_in_days: 0,
                thumbnail_file_id: '',
                package_id: '',
                package_session_status: isDeletedLevel ? 'DELETED' : 'ACTIVE',
                package_session_id:
                    getPackageSessionId({
                        courseId: formData.id || '',
                        sessionId,
                        levelId: level?.id || '',
                    }) || '',
                new_package_session: isNewLevel ? true : false,
                is_parent: (level as { is_parent?: boolean } | undefined)?.is_parent,
                parent_id: (level as { parent_id?: string | null } | undefined)?.parent_id ?? null,
                add_faculty_to_course,
                group: {
                    id: '',
                    group_name: '',
                    group_value: '',
                    new_group: false,
                },
                ...(subgroupPayload !== undefined ? { subgroups: subgroupPayload } : {}),
            };
        });
    };

    const currentSessions = formData.sessions || [];
    const previousSessions = oldFormData.sessions || [];

    // Sent only when the form loaded the stored value from course-init: then always the
    // full current JSON, or "" when the admin removed everything. Otherwise omitted, so
    // the backend keeps what is stored.
    const coursePageJson = buildCoursePageJson(formData.coursePage, {
        isEdit: true,
        storedValueLoaded: (formData as { coursePageJsonLoaded?: boolean }).coursePageJsonLoaded,
    });

    const allSessionIds = new Set([
        ...currentSessions.map((s) => s.id),
        ...previousSessions.map((s) => s.id),
    ]);

    const sessions: FormattedSession[] = Array.from(allSessionIds).map((sessionId) => {
        const current = findById(currentSessions, sessionId);
        const previous = findById(previousSessions, sessionId);

        const isDeletedSession = !current && previous;
        const session = current || previous;

        const levels = formatLevels(
            sessionId,
            (current?.levels as Level[]) || [],
            (previous?.levels as Level[]) || []
        );

        return {
            id: session?.id || '',
            session_name: session?.name || '',
            status: isDeletedSession ? 'DELETED' : 'ACTIVE',
            start_date: session?.startDate || '',
            new_session: session?.newSession ?? false,
            levels,
        };
    });

    return {
        id: formData.id || '',
        new_course: false,
        course_name: formData.course || '',
        thumbnail_file_id: '',
        contain_levels: hasLevels || hasSessions,
        sessions,
        contains_subgroup: containsSubgroup,
        subgroups: formattedSubgroups,
        is_course_published_to_catalaouge: formData.publishToCatalogue,
        course_preview_image_media_id: formData.coursePreview || '',
        course_banner_media_id: formData.courseBanner || '',
        course_media_id: JSON.stringify(formData.courseMedia) || '',
        why_learn_html: formData.learningOutcome || '',
        who_should_learn_html: formData.targetAudience || '',
        about_the_course_html: formData.aboutCourse || '',
        tags: formData.tags || [],
        course_depth: formData.levelStructure || 2,
        course_html_description: formData.description || '',
        // Approval-workflow fields. Send the course's *current* status (carried
        // in by transformCourseData) so a details edit never changes it, and
        // leave ownership / copy linkage out entirely — the backend keeps the
        // stored values when they are absent. Guessing them from the editor's
        // role used to flip a teacher's published course back to DRAFT, re-own
        // any course to whoever edited it, and detach editable copies from
        // their original.
        status: (formData as any).status || undefined,
        ...(coursePageJson !== null ? { course_page_json: coursePageJson } : {}),
    };
};

export function transformCourseData(course: CourseDetailsFormValues) {
    const sessions = course.courseData.sessions ?? [];

    // ── session helpers ──────────────────────────────────────────────────────────
    const hasAnySessions = sessions.length > 0;
    const sessNameDefault = sessions.some(
        (s) => (s.sessionDetails?.session_name ?? '').trim().toLowerCase() === 'default'
    );

    // ── level helpers ────────────────────────────────────────────────────────────
    const hasAnyLevels = sessions.some(
        (s) => Array.isArray(s.levelDetails) && s.levelDetails.length > 0
    );
    const levelNameDefault = sessions.some((s) =>
        (s.levelDetails ?? []).some((l) => (l.name ?? '').trim().toLowerCase() === 'default')
    );

    const hasSessions = hasAnySessions && !sessNameDefault ? 'yes' : 'no';
    const hasLevels = hasAnyLevels && !levelNameDefault ? 'yes' : 'no';

    return {
        id: course.courseData.id || '',
        course: course.courseData.packageName || course.courseData.title || '',
        description: course.courseData.description ?? '',
        learningOutcome: course.courseData.whatYoullLearn ?? '',
        aboutCourse: course.courseData.aboutTheCourse ?? '',
        targetAudience: course.courseData.whoShouldLearn ?? '',
        coursePreview: course.courseData.coursePreviewImageMediaId ?? '',
        courseBanner: course.courseData.courseBannerMediaId ?? '',
        courseMedia: JSON.stringify(course.courseData.courseMediaId) ?? '',
        tags: course.courseData.tags ?? [],
        levelStructure: course.courseData.courseStructure ?? 0,
        hasLevels,
        hasSessions,
        sessions: sessions.map((session) => ({
            id: session.sessionDetails?.id ?? '',
            name: session.sessionDetails?.session_name ?? '',
            startDate: session.sessionDetails?.start_date ?? '',
            newSession: session.sessionDetails?.newSession ?? false,
            levels: (session.levelDetails ?? []).map((level) => ({
                id: level.id,
                name: level.name,
                userIds: level.instructors.map((inst) => ({
                    id: inst.id,
                    name: inst.name,
                    email: inst.email,
                    profilePicId: inst.profilePicId,
                    roles: inst.roles,
                    authorSubtitle: inst.authorSubtitle,
                    authorDescription: inst.authorDescription,
                    roleLabel: inst.roleLabel,
                })),
                newLevel: level.newLevel ?? false,
                subgroups: Array.isArray(
                    (level as { subgroups?: { id?: string; name: string }[] }).subgroups
                )
                    ? (level as { subgroups: { id?: string; name: string }[] }).subgroups.map(
                          (s) => ({
                              ...(s.id ? { id: s.id } : {}),
                              subgroupName: s.name ?? '',
                          })
                      )
                    : undefined,
                containsSubgroup: ((level as { subgroups?: unknown[] }).subgroups?.length ?? 0) > 0,
            })),
        })),
        containsSubgroup:
            course.courseData.sessions?.some((s) =>
                (s.levelDetails ?? []).some(
                    (l) => ((l as { subgroups?: unknown[] }).subgroups?.length ?? 0) > 0
                )
            ) ?? false,
        selectedInstructors: extractInstructors(sessions),
        instructors: [],
        publishToCatalogue: course.courseData.isCoursePublishedToCatalaouge ?? false,
        // Parsed defensively: bad JSON reads as empty instead of breaking the form.
        coursePage: parseCoursePageJson(course.courseData.coursePageJson),
        // Only course-init ever returns a string here (the institute-wide init list always
        // carries null), so a string means "loaded". Otherwise the edit form fetches
        // course-init itself before the section becomes editable.
        coursePageJsonLoaded: typeof course.courseData.coursePageJson === 'string',
        // Carried through to convertToApiCourseFormatUpdate so an edit
        // preserves DRAFT / IN_REVIEW / ACTIVE instead of guessing by role.
        status: course.courseData.status || undefined,
    };
}

function extractInstructors(data: Session[]) {
    const instructorMap = new Map<string, Session>();

    for (const session of data) {
        const levels = session.levelDetails || [];
        for (const level of levels) {
            const instructors = level.instructors || [];
            for (const instructor of instructors) {
                if (!instructorMap.has(instructor.id)) {
                    instructorMap.set(instructor.id, {
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-expect-error
                        id: instructor.id,
                        name: instructor.name,
                        email: instructor.email,
                        profilePicId: instructor.profilePicId,
                        roles: instructor.roles,
                        authorSubtitle: instructor.authorSubtitle,
                        authorDescription: instructor.authorDescription,
                        roleLabel: instructor.roleLabel,
                    });
                }
            }
        }
    }

    return Array.from(instructorMap.values());
}
