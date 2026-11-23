/**
 * Batch (package session) options for pickers, built from the institute
 * details the layout already loads. Shared by the announcement audience picker
 * and the Learner home audience editor, so both list batches the same way.
 */
import type { InstituteDetailsType } from '@/schemas/student/student-list/institute-schema';

export interface BatchOption {
    id: string;
    label: string;
    packageName: string;
    levelName: string;
    sessionName: string;
    status?: string;
    isOrgAssociated: boolean;
}

export function buildBatchOptions(
    instituteDetails: InstituteDetailsType | undefined
): BatchOption[] {
    const rows = instituteDetails?.batches_for_sessions ?? [];
    return rows
        .filter((batch) => !!batch.id)
        .map((batch) => ({
            id: batch.id,
            label: `${batch.package_dto.package_name} - ${batch.level.level_name} - ${batch.session.session_name}`,
            packageName: batch.package_dto.package_name,
            levelName: batch.level.level_name,
            sessionName: batch.session.session_name,
            status: batch.status,
            isOrgAssociated: Boolean((batch as { is_org_associated?: boolean }).is_org_associated),
        }));
}

/** Every course the institute has a batch of, once each, by name. */
export function buildCourseOptions(
    instituteDetails: InstituteDetailsType | undefined
): Array<{ label: string; value: string }> {
    return Array.from(
        new Map(
            (instituteDetails?.batches_for_sessions ?? [])
                .filter((b) => b?.package_dto?.id)
                .map((b) => [
                    b.package_dto.id,
                    {
                        label: b.package_dto.package_name || b.package_dto.id,
                        value: b.package_dto.id,
                    },
                ])
        ).values()
    ).sort((a, b) => a.label.localeCompare(b.label));
}
