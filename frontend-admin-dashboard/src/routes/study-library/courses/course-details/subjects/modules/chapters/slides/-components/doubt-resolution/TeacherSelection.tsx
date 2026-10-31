import MultiSelectDropdown from '@/components/common/multi-select-dropdown';
import { useTeacherList } from '@/routes/dashboard/-hooks/useTeacherList';
import { getInstituteId } from '@/constants/helper';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { DoubtType } from '../../-types/add-doubt-type';
import { FacultyFilterParams } from '@/routes/dashboard/-services/dashboard-services';
import { useAddReply } from '../../-services/AddReply';
import { handleAddReply } from '../../-helper/handleAddReply';
import { Tag, X } from '@phosphor-icons/react';
import React from 'react';
import { useGetUserBasicDetails } from '@/services/get_user_basic_details';
import { useTranslation } from 'react-i18next';


// Custom debounce hook
const useDebounce = <T extends (...args: any[]) => void>(callback: T, delay: number) => {
    const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout>();

    return useCallback(
        (...args: Parameters<T>) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            const newTimeoutId = setTimeout(() => {
                callback(...args);
            }, delay);
            setTimeoutId(newTimeoutId);
        },
        [callback, delay, timeoutId]
    );
};

export const TeacherSelection = ({
    doubt,
    filters,
    canChange,
    showCanAssign = true,
    teachersOverride,
    implicitAssignees,
}: {
    doubt: DoubtType;
    filters: FacultyFilterParams;
    canChange: boolean;
    showCanAssign?: boolean;
    teachersOverride?: { id: string; name: string; subtitle?: string }[];
    /**
     * Users to pre-select even when they're not in {@code doubt.all_doubt_assignee}. Typical
     * callers pass the FSPSSM-linked faculty for this doubt's batch/subject so the "Assigned To"
     * column shows sensible defaults for doubts created before the backend auto-assignment
     * behaviour was in place.
     */
    implicitAssignees?: { id: string; name: string }[];
}) => {
    const { t } = useTranslation('studyLibraryHandleAddReply');
    const addReply = useAddReply();
    const InstituteId = getInstituteId();
    const { data: TeachersList } = useTeacherList(
        InstituteId || '',
        0,
        100,
        filters,
        !teachersOverride
    );

    const teacherOptions = useMemo(
        () =>
            teachersOverride ??
            (TeachersList?.content?.map((teacher) => ({
                id: teacher.id,
                name: teacher.name,
            })) ||
                []),
        [TeachersList?.content, teachersOverride]
    );

    // Resolve currently-assigned user names directly from the doubt's assignee rows, so non-admin
    // viewers still see who the doubt is assigned to even when they can't fetch the full teacher
    // list. We fall back to names that are already in teacherOptions before hitting the API.
    const assignedUserIds = useMemo(
        () =>
            (doubt?.all_doubt_assignee ?? [])
                .filter((a) => a.source === 'USER' && !!a.source_id)
                .map((a) => a.source_id as string),
        [doubt?.all_doubt_assignee]
    );

    const optionsById = useMemo(() => {
        const map = new Map<string, string>();
        teacherOptions.forEach((opt) => map.set(String(opt.id), opt.name));
        return map;
    }, [teacherOptions]);

    const unresolvedIds = useMemo(
        () => assignedUserIds.filter((id) => !optionsById.has(id)),
        [assignedUserIds, optionsById]
    );

    const { data: resolvedAssigneeDetails } = useGetUserBasicDetails(unresolvedIds);

    const resolvedNameById = useMemo(() => {
        const map = new Map<string, string>();
        (resolvedAssigneeDetails ?? []).forEach((u) => map.set(u.id, u.name));
        return map;
    }, [resolvedAssigneeDetails]);

    // Users the admin has just × -removed from the Default pill list. Kept local so the pill
    // disappears instantly; the server response populates excluded_assignee_user_ids on the next
    // refetch and this state naturally merges via `implicitToDisplay`.
    const [locallyExcludedImplicit, setLocallyExcludedImplicit] = useState<string[]>([]);

    // selectedTeachers tracks ONLY the explicit doubt_assignee rows — this keeps add/remove
    // semantics simple (each × truly deletes a persisted row; each add creates one). FSPSSM
    // defaults are rendered separately below as read-only badges.
    const assignedFromDoubt = useMemo(() => {
        const seen = new Set<string>();
        const merged: { id: string; name: string }[] = [];
        assignedUserIds.forEach((id) => {
            if (seen.has(id)) return;
            seen.add(id);
            merged.push({
                id,
                name: optionsById.get(id) ?? resolvedNameById.get(id) ?? 'Teacher',
            });
        });
        return merged;
    }, [assignedUserIds, optionsById, resolvedNameById]);

    // Implicit = FSPSSM-linked faculty that are NOT already in the explicit assignee list,
    // NOT in the server-side excluded list, and NOT in the local pending-exclusion set (admin
    // has just clicked × Default). Rendered as "Default" pills with their own × for admins only.
    const implicitToDisplay = useMemo(() => {
        const explicit = new Set<string>(assignedUserIds);
        const serverExcluded = new Set<string>(doubt.excluded_assignee_user_ids ?? []);
        const localExcluded = new Set<string>(locallyExcludedImplicit);
        return (implicitAssignees ?? []).filter(
            (t) => !explicit.has(t.id) && !serverExcluded.has(t.id) && !localExcluded.has(t.id)
        );
    }, [
        assignedUserIds,
        implicitAssignees,
        doubt.excluded_assignee_user_ids,
        locallyExcludedImplicit,
    ]);

    const getInitials = (name?: string) => {
        const cleaned = (name ?? '').trim();
        if (!cleaned) return '?';
        const parts = cleaned.split(/\s+/);
        const first = parts[0]?.[0] ?? '';
        const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
        return (first + last).toUpperCase();
    };

    const [selectedTeachers, setSelectedTeachers] = useState<
        { id: string | number; name: string }[]
    >(assignedFromDoubt);

    // Stable key that represents the SERVER's assignee id set. We only want to reset
    // `selectedTeachers` from `assignedFromDoubt` when the server-side ids actually change —
    // otherwise the teacher/user-basic-details queries refetching (new object refs with same
    // ids) would overwrite the admin's in-flight local add/remove before the debounced submit
    // lands, which the user sees as the pill "reverting back".
    const serverAssigneeIdsKey = useMemo(
        () => assignedUserIds.slice().sort().join('|'),
        [assignedUserIds]
    );

    useEffect(() => {
        setSelectedTeachers(assignedFromDoubt);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serverAssigneeIdsKey]);

    useEffect(() => {
        // Once the server acknowledges the exclusion, drop it from the local set to avoid double-
        // bookkeeping.
        const serverExcluded = new Set(doubt.excluded_assignee_user_ids ?? []);
        setLocallyExcludedImplicit((prev) => prev.filter((id) => !serverExcluded.has(id)));
    }, [doubt.excluded_assignee_user_ids]);

    const handleTeacherSelection = (
        newlySelectedTeachers: { id: string | number; name: string }[]
    ) => {
        setSelectedTeachers(newlySelectedTeachers);
        if (canChange) {
            debouncedSubmitReply(newlySelectedTeachers);
        }
    };

    const submitReply = useCallback(
        async (
            currentSelectedTeachers: { id: string | number; name: string }[],
            excludedImplicitUserIds: string[] = []
        ) => {
            const replyData: DoubtType = {
                id: doubt.id,
                user_id: doubt.user_id,
                name: doubt.name,
                source: doubt.source,
                source_id: doubt.source_id,
                raised_time: doubt.raised_time,
                resolved_time: doubt.resolved_time,
                content_position: doubt.content_position,
                content_type: doubt.content_type,
                html_text: doubt.html_text,
                status: doubt.status,
                parent_id: doubt.parent_id,
                parent_level: doubt.parent_level,
                doubt_assignee_request_user_ids: currentSelectedTeachers
                    .filter(
                        (teacher) =>
                            !doubt.all_doubt_assignee.some(
                                (assignee) => assignee.source_id === teacher.id
                            )
                    )
                    .map((teacher) => String(teacher.id)),
                all_doubt_assignee: doubt.all_doubt_assignee,
                delete_assignee_request: doubt.all_doubt_assignee
                    .filter(
                        (assignee) =>
                            !currentSelectedTeachers.some(
                                (teacher) => teacher.id === assignee.source_id
                            )
                    )
                    .map((assignee) => assignee.id),
                excluded_assignee_user_ids: excludedImplicitUserIds,
            };
            await handleAddReply({ replyData, addReply, id: doubt.id, t });
        },
        [doubt, addReply, t]
    );

    const debouncedSubmitReply = useDebounce(submitReply, 1000);

    const handleRemoveImplicit = useCallback(
        (teacherId: string) => {
            if (!canChange) return;
            setLocallyExcludedImplicit((prev) =>
                prev.includes(teacherId) ? prev : [...prev, teacherId]
            );
            // Fire immediately (not debounced) since pill removals are discrete user actions.
            submitReply(selectedTeachers, [teacherId]).catch(() => {
                // Roll back local hide on failure so the pill reappears.
                setLocallyExcludedImplicit((prev) => prev.filter((id) => id !== teacherId));
            });
        },
        [canChange, selectedTeachers, submitReply]
    );

    const hasAssignedTeachers = selectedTeachers && selectedTeachers.length > 0;
    const hasAnyAssignees = hasAssignedTeachers || implicitToDisplay.length > 0;

    const implicitPills = implicitToDisplay.map((teacher) => (
        <span
            key={`implicit-${teacher.id}`}
            title="Default assignee via batch/subject linkage"
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 py-0.5 pl-1 pr-1 text-xs font-medium text-neutral-700"
        >
            <span
                aria-hidden
                className="flex size-5 items-center justify-center rounded-full bg-neutral-300 text-[10px] font-semibold text-neutral-700"
            >
                {getInitials(teacher.name)}
            </span>
            <span>{teacher.name}</span>
            <span className="rounded-full bg-white px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-wide text-neutral-500">
                Default
            </span>
            {canChange && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveImplicit(teacher.id);
                    }}
                    aria-label={`Remove ${teacher.name} from this doubt`}
                    title={`Remove ${teacher.name} from this doubt`}
                    className="flex size-5 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                >
                    <X size={12} weight="bold" />
                </button>
            )}
        </span>
    ));

    return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {showCanAssign && (
                <div className="flex items-center gap-1 text-neutral-500">
                    <Tag size={14} weight="duotone" />
                    <span className="font-medium">Assigned:</span>
                </div>
            )}
            {implicitPills}
            {canChange ? (
                <MultiSelectDropdown
                    options={teacherOptions}
                    selected={selectedTeachers}
                    onChange={handleTeacherSelection}
                    placeholder={hasAssignedTeachers ? 'Change Assignee' : '+ Assign Teacher'}
                    className="min-w-[160px] text-xs"
                />
            ) : hasAssignedTeachers ? (
                <div className="flex flex-wrap gap-1">
                    {selectedTeachers.map((teacher) => (
                        <span
                            key={teacher.id}
                            className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700"
                        >
                            {teacher.name}
                        </span>
                    ))}
                </div>
            ) : (
                showCanAssign && !hasAnyAssignees && <p className="italic text-neutral-500">None</p>
            )}
        </div>
    );
};
