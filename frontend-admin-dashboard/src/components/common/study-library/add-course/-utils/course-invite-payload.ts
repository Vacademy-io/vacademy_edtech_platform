import type { Batch } from '@/routes/manage-students/invite/-components/create-invite/GenerateInviteLinkSchema';
import type { InviteLinkFormValues } from '@/routes/manage-students/invite/-components/create-invite/GenerateInviteLinkSchema';
import { ReTransformCustomFields } from '@/routes/manage-students/invite/-components/create-invite/-utils/helper';
import type { IndividualInviteLinkDetails } from '@/types/study-library/individual-invite-interface';
import type { SessionDetails } from '../../-utils/helper';
// From the step component, not add-course-form, so this stays off the wizard's import cycle.
import type { Step1Data } from '../add-course-steps/add-course-step1';

/**
 * A batch as returned by GET /admin-core-service/course/v1/{courseId}/batches
 * (CourseBatchDTO). Only ACTIVE package sessions come back, so the INVITED batch
 * the backend creates alongside every course is already excluded.
 */
export interface CourseBatchDTO {
    id: string;
    package_dto?: { id: string; package_name: string };
    level: { id: string; level_name: string };
    session: { id: string; session_name: string; start_date?: string };
    read_time_in_minutes?: number;
    is_parent?: boolean | null;
    parent_id?: string | null;
    package_session_name?: string | null;
}

const isDefaultId = (id?: string | null) => (id ?? '').toUpperCase() === 'DEFAULT';

/**
 * Step-1 course details, mapped onto the invite form's course-preview fields.
 *
 * The key set mirrors what the backend's own EnrollInviteCoursePreviewService.createPreview
 * writes into web_page_meta_data_json, so reconfiguring an auto-created invite is
 * value-equivalent rather than a partial overwrite.
 *
 * The `*Blob` fields are deliberately left empty: they hold presigned URLs that expire
 * within a day, and the learner page re-resolves them from the media ids.
 */
export function buildInviteDefaults(step1: Partial<Step1Data>): Partial<InviteLinkFormValues> {
    return {
        course: step1.course ?? '',
        description: step1.description ?? '',
        learningOutcome: step1.learningOutcome ?? '',
        aboutCourse: step1.aboutCourse ?? '',
        targetAudience: step1.targetAudience ?? '',
        coursePreview: step1.coursePreview ?? '',
        courseBanner: step1.courseBanner ?? '',
        courseMedia: step1.courseMedia ?? { type: '', id: '' },
        coursePreviewBlob: '',
        courseBannerBlob: '',
        courseMediaBlob: '',
        tags: step1.tags ?? [],
        showRelatedCourses: false,
        includeInstituteLogo: true,
        includePaymentPlans: true,
        restrictToSameBatch: false,
        customHtml: '',
    };
}

/**
 * Narrows the batches returned for a course down to the ones this wizard run actually
 * created.
 *
 * CourseService.getCourse merges into an existing package when the course name matches an
 * ACTIVE/DRAFT course in the institute and `force_new_course` is unset — which the wizard
 * leaves unset. GET /{courseId}/batches then also returns batches that existed before,
 * whose invites an admin may have configured long ago. Matching on session/level name keeps
 * us off those.
 *
 * Falls back to every batch when nothing matches, so a naming mismatch degrades to
 * "configure what we found" rather than silently configuring nothing.
 */
export function selectTargetBatches(
    batches: CourseBatchDTO[],
    sessions: SessionDetails[] | undefined
): CourseBatchDTO[] {
    const wanted = new Set(
        (sessions ?? []).flatMap((session) =>
            (session.levels ?? []).map((level) => `${session.session_name}|${level.level_name}`)
        )
    );
    if (wanted.size === 0) return batches;

    const matched = batches.filter((batch) =>
        wanted.has(`${batch.session.session_name}|${batch.level.level_name}`)
    );
    return matched.length > 0 ? matched : batches;
}

export function toInviteBatch(batch: CourseBatchDTO, courseId: string, courseName: string): Batch {
    return {
        sessionId: batch.session.id,
        levelId: batch.level.id,
        sessionName: batch.session.session_name,
        levelName: batch.level.level_name,
        courseId,
        courseName,
        isParent: batch.is_parent ?? false,
    };
}

/**
 * The package-session resolver handed to convertInviteData.
 *
 * It cannot be the institute store's getPackageSessionId: that cache predates the course
 * we just created, and a courseId|sessionId|levelId lookup collides across subgroup
 * siblings, which all share their parent's level and session. Since we issue exactly one
 * invite per batch, the resolver only ever has one answer.
 */
export const singleBatchResolver = (packageSessionId: string) => () => packageSessionId;

/** `Beginner Yoga Basics Jan 2026` — same shape as the backend's default invite name. */
export function buildPerBatchName(baseName: string, batch: CourseBatchDTO): string {
    const qualifier = [
        isDefaultId(batch.level.id) ? '' : batch.level.level_name,
        isDefaultId(batch.session.id) ? '' : batch.session.session_name,
    ]
        .filter((part) => !!part && part.trim().length > 0)
        .join(' ')
        .trim();

    const base = (baseName ?? '').trim();
    if (!qualifier) return base;
    if (!base) return qualifier;
    return `${base} - ${qualifier}`;
}

/**
 * The invite form values for one batch.
 *
 * Custom fields need care: a PUT runs syncFeatureCustomFields, which is a full replace —
 * fields absent from the payload are soft-deleted. The auto-created invite already carries
 * the institute defaults, and our seeded UI list comes from a different endpoint, so any
 * drift between the two would silently delete fields. Unless the admin actually edited the
 * list, echo back what the invite already has.
 */
export function perBatchInviteValues({
    base,
    batch,
    existing,
    customFieldsDirty,
}: {
    base: InviteLinkFormValues;
    batch: CourseBatchDTO;
    existing: IndividualInviteLinkDetails | null;
    customFieldsDirty: boolean;
}): InviteLinkFormValues {
    const customFields =
        customFieldsDirty || !existing
            ? base.custom_fields
            : (ReTransformCustomFields(existing) as InviteLinkFormValues['custom_fields']);

    return {
        ...base,
        name: buildPerBatchName(base.name, batch),
        custom_fields: customFields,
    };
}
