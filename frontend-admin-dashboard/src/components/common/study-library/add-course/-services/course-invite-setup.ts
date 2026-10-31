import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_COURSE_BATCHES, GET_DEFAULT_INVITE } from '@/constants/urls';
import { handleEnrollInvite } from '@/routes/manage-students/invite/-components/create-invite/-services/enroll-invite';
import { handleMakeInviteLinkDefault } from '@/routes/study-library/courses/course-details/-services/get-invite-links';
import type {
    PaymentOption,
    ReferralData,
} from '@/routes/manage-students/invite/-components/create-invite/-utils/helper';
import type { InviteLinkFormValues } from '@/routes/manage-students/invite/-components/create-invite/GenerateInviteLinkSchema';
import type { IndividualInviteLinkDetails } from '@/types/study-library/individual-invite-interface';
import {
    perBatchInviteValues,
    singleBatchResolver,
    toInviteBatch,
    type CourseBatchDTO,
} from '../-utils/course-invite-payload';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads back the batches (package sessions) the backend created for a course.
 *
 * add-course is @Transactional, so the batches are committed by the time the POST
 * returns — but the wizard has always waited before reading them, to absorb read-replica
 * lag and proxy buffering. A bounded poll keeps the same worst-case latency as the old
 * blind 1500 ms sleep while usually returning on the first try.
 */
export async function fetchBatchesWithRetry(
    courseId: string,
    attempts = 5,
    delayMs = 400
): Promise<CourseBatchDTO[]> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            const response = await authenticatedAxiosInstance.get(
                `${GET_COURSE_BATCHES}/${courseId}/batches`
            );
            if (Array.isArray(response.data) && response.data.length > 0) {
                return response.data as CourseBatchDTO[];
            }
        } catch (error) {
            console.warn('[course-invite-setup] batch lookup attempt failed', attempt, error);
        }
        if (attempt < attempts - 1) await sleep(delayMs);
    }
    return [];
}

/** The batch's default invite, or null when the institute has none configured. */
async function fetchDefaultInvite(
    instituteId: string,
    packageSessionId: string
): Promise<IndividualInviteLinkDetails | null> {
    // Two tries: the endpoint 404s (VacademyException) when no DEFAULT invite exists, which
    // is a legitimate state, but it is also the one call that could observe the invite a beat
    // later than the package session it hangs off.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await authenticatedAxiosInstance.get(
                GET_DEFAULT_INVITE(instituteId, packageSessionId)
            );
            return (response.data as IndividualInviteLinkDetails) ?? null;
        } catch {
            if (attempt === 0) await sleep(300);
        }
    }
    return null;
}

export interface InviteSetupFailure {
    batch: CourseBatchDTO;
    error: unknown;
}

export interface InviteSetupResult {
    succeeded: CourseBatchDTO[];
    failed: InviteSetupFailure[];
}

/**
 * Attaches the chosen payment plan to every batch of a freshly created course, as one
 * invite link per batch.
 *
 * Each batch already has a DEFAULT-tagged invite when the institute has a default payment
 * option (DefaultEnrollInviteService runs inside add-course), so the normal path is a PUT
 * that re-points that invite at the chosen plan — keeping one link per batch and preserving
 * the invite code and short URL the backend already minted. Institutes with no default
 * payment option get no auto invite at all; there we POST and then mark the new link as the
 * batch default so both paths end up in the same state.
 *
 * Never throws: the course is already committed by the time this runs, so the caller needs
 * to report partial failure rather than lose the "course created" outcome.
 */
export async function setUpInvitesForNewCourse({
    instituteId,
    courseId,
    courseName,
    targetBatches,
    inviteValues,
    customFieldsDirty,
    paymentsData,
    referralProgramDetails,
    instituteLogoFileId,
    instituteVendor,
    onProgress,
}: {
    instituteId: string;
    courseId: string;
    courseName: string;
    targetBatches: CourseBatchDTO[];
    inviteValues: InviteLinkFormValues;
    customFieldsDirty: boolean;
    paymentsData: PaymentOption[];
    referralProgramDetails: ReferralData[];
    instituteLogoFileId: string;
    instituteVendor?: { vendor: string; vendor_id: string } | null;
    onProgress?: (done: number, total: number) => void;
}): Promise<InviteSetupResult> {
    const succeeded: CourseBatchDTO[] = [];
    const failed: InviteSetupFailure[] = [];

    // Sequential on purpose: every iteration mints or refreshes a short URL and fires an
    // INVITE_CREATE workflow trigger, so a parallel burst on a brand-new course is a
    // needless load spike and makes partial failures ambiguous to report.
    for (const batch of targetBatches) {
        try {
            const existing = await fetchDefaultInvite(instituteId, batch.id);

            const inviteId = await handleEnrollInvite({
                data: perBatchInviteValues({
                    base: inviteValues,
                    batch,
                    existing,
                    customFieldsDirty,
                }),
                selectedCourse: { id: courseId, name: courseName },
                selectedBatches: [toInviteBatch(batch, courseId, courseName)],
                getPackageSessionId: singleBatchResolver(batch.id),
                paymentsData,
                referralProgramDetails,
                instituteLogoFileId,
                inviteId: existing?.id,
                instituteVendor,
                existingInviteDetails: existing,
            });

            // A POSTed invite is created with an empty tag, so it would show up in Invite
            // Links without being the batch default. Promote it so the no-default-option
            // path matches the PUT path.
            if (!existing && inviteId) {
                try {
                    await handleMakeInviteLinkDefault(batch.id, String(inviteId));
                } catch (error) {
                    console.warn(
                        '[course-invite-setup] could not mark invite as default',
                        batch.id,
                        error
                    );
                }
            }

            succeeded.push(batch);
        } catch (error) {
            console.error('[course-invite-setup] failed for batch', batch.id, error);
            failed.push({ batch, error });
        }
        onProgress?.(succeeded.length + failed.length, targetBatches.length);
    }

    return { succeeded, failed };
}

/** First human-readable message out of a failed invite call, if the backend sent one. */
export function firstFailureMessage(failures: InviteSetupFailure[]): string | null {
    for (const failure of failures) {
        const error = failure.error as { response?: { data?: { ex?: string; message?: string } } };
        const message = error?.response?.data?.ex ?? error?.response?.data?.message;
        if (message) return message;
    }
    return null;
}
