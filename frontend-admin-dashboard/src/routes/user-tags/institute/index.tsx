import { createFileRoute } from '@tanstack/react-router';
import { TagsEnhancedHeader } from './-components/TagsEnhancedHeader';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useEffect, useState, useCallback } from 'react';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Trash } from '@phosphor-icons/react';
import {
    getAllTags,
    getInstituteTags,
    getDefaultTags,
    createInstituteTag,
    deleteInstituteTag,
    getUserCountsByTags,
    getUserDetailsByTags,
    type TagItem,
    type TagUserDetailItem,
} from '@/services/tag-management';
import { AssignCoursesToTagsDialog } from '@/routes/user-tags/-components/assign-courses-to-tags-dialog';
import { toast } from 'sonner';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const Route = createFileRoute('/user-tags/institute/')({
    component: () => (
        <LayoutContainer>
            <RouteComponent />
        </LayoutContainer>
    ),
});

function RouteComponent() {
    const { setNavHeading } = useNavHeadingStore();
    const [instituteTags, setInstituteTags] = useState<TagItem[]>([]);
    const [defaultTags, setDefaultTags] = useState<TagItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [newTagDesc, setNewTagDesc] = useState('');
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [searchQuery, setSearchQuery] = useState('');

    // "Show Users" dialog state
    const [usersDialogOpen, setUsersDialogOpen] = useState(false);
    const [usersDialogTag, setUsersDialogTag] = useState<TagItem | null>(null);
    const [usersLoading, setUsersLoading] = useState(false);
    const [userDetails, setUserDetails] = useState<TagUserDetailItem[]>([]);

    // "Assign Courses" dialog state
    const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);

    // "Delete tag" confirmation state. Backend rejects default tags, but we
    // also gate the UI so the trash button never appears for system tags.
    const [tagToDelete, setTagToDelete] = useState<TagItem | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        setNavHeading('User Tags');
    }, [setNavHeading]);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [inst, defs] = await Promise.all([getInstituteTags(), getDefaultTags()]);
            setInstituteTags(inst);
            setDefaultTags(defs);
            const allTags = [...inst, ...defs];
            if (allTags.length > 0) {
                const res = await getUserCountsByTags(allTags.map((t) => t.id));
                setCounts(res.tagCounts || {});
            } else {
                setCounts({});
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to load tags';
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const onCreate = async () => {
        if (!newTagName.trim()) {
            toast.error('Please provide a tag name');
            return;
        }
        setCreating(true);
        try {
            await createInstituteTag({
                tagName: newTagName.trim(),
                description: newTagDesc || undefined,
            });
            setNewTagName('');
            setNewTagDesc('');
            toast.success('Tag created');
            fetchAll();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to create tag';
            toast.error(msg);
        } finally {
            setCreating(false);
        }
    };

    const onConfirmDelete = async () => {
        if (!tagToDelete) return;
        setIsDeleting(true);
        try {
            await deleteInstituteTag(tagToDelete.id);
            toast.success(`Tag "${tagToDelete.tagName}" deleted`);
            // If this tag was selected in the bulk-assign picker, drop it
            // so the assign button doesn't reference a gone tag.
            setSelectedTagIds((prev) => {
                if (!prev.has(tagToDelete.id)) return prev;
                const next = new Set(prev);
                next.delete(tagToDelete.id);
                return next;
            });
            setTagToDelete(null);
            await fetchAll();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to delete tag';
            toast.error(msg);
        } finally {
            setIsDeleting(false);
        }
    };

    const openUsersDialog = async (tag: TagItem) => {
        setUsersDialogTag(tag);
        setUsersDialogOpen(true);
        setUsersLoading(true);
        try {
            const res = await getUserDetailsByTags([tag.id]);
            setUserDetails(res);
        } catch {
            setUserDetails([]);
            toast.error('Failed to load users');
        } finally {
            setUsersLoading(false);
        }
    };

    const exportUsersCsv = () => {
        const header = 'userId,fullName,username,email,phoneNumber,enrollmentId\n';
        const rows = userDetails
            .map(
                (u) =>
                    `${u.userId || ''},${u.fullName || ''},${u.username || ''},${u.email || ''},${u.phoneNumber || ''},${u.enrollmentId || ''}`
            )
            .join('\n');
        const blob = new Blob([header + rows + '\n'], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tag_users_${usersDialogTag?.tagName || 'export'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleTagSelection = (tagId: string) => {
        setSelectedTagIds((prev) => {
            const next = new Set(prev);
            if (next.has(tagId)) next.delete(tagId);
            else next.add(tagId);
            return next;
        });
    };

    const allTags = [...instituteTags, ...defaultTags];
    const filteredTags = allTags.filter((t) =>
        t.tagName.toLowerCase().includes(searchQuery.toLowerCase())
    );
    const selectedTags = allTags.filter((t) => selectedTagIds.has(t.id));

    const renderTagCard = (tag: TagItem, isDefault: boolean) => {
        const count = counts[tag.tagName] ?? 0;
        const isSelected = selectedTagIds.has(tag.id);

        return (
            <div
                key={tag.id}
                className={`group relative flex items-center gap-3 rounded-xl border p-4 transition-all ${
                    isSelected
                        ? 'border-indigo-300 bg-indigo-50/50 shadow-sm'
                        : 'border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm'
                }`}
            >
                {/* Checkbox */}
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleTagSelection(tag.id)}
                    className="h-4 w-4 shrink-0 rounded border-neutral-300 text-indigo-500 focus:ring-indigo-300"
                />

                {/* Tag info */}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h4 className="truncate text-sm font-semibold text-neutral-800">
                            {tag.tagName}
                        </h4>
                        {isDefault && (
                            <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">
                                SYSTEM
                            </span>
                        )}
                        <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                                tag.status === 'ACTIVE'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-neutral-100 text-neutral-500'
                            }`}
                        >
                            {tag.status}
                        </span>
                    </div>
                    {tag.description && (
                        <p className="mt-0.5 truncate text-xs text-neutral-500">
                            {tag.description}
                        </p>
                    )}
                </div>

                {/* User count + action */}
                <div className="flex shrink-0 items-center gap-2">
                    <div className="rounded-lg bg-neutral-100 px-2.5 py-1 text-center">
                        <p className="text-sm font-bold text-neutral-700">{count}</p>
                        <p className="text-[9px] text-neutral-500">users</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => openUsersDialog(tag)}
                        className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                    >
                        View Users
                    </button>
                    {!isDefault && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setTagToDelete(tag);
                            }}
                            className="rounded-lg border border-neutral-200 p-1.5 text-neutral-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                            title="Delete tag"
                            aria-label={`Delete tag ${tag.tagName}`}
                        >
                            <Trash className="size-4" weight="bold" />
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
            {/* Header with actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-bold text-neutral-900">User Tags</h1>
                    <p className="mt-1 text-sm text-neutral-500">
                        Manage tags and assign{' '}
                        {getTerminologyPlural(
                            ContentTerms.Course,
                            SystemTerms.Course
                        ).toLocaleLowerCase()}{' '}
                        to tagged users
                    </p>
                </div>
                {selectedTagIds.size > 0 && (
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        onClick={() => setAssignDialogOpen(true)}
                    >
                        📚 Assign Courses to {selectedTagIds.size} Tag
                        {selectedTagIds.size > 1 ? 's' : ''}
                    </MyButton>
                )}
            </div>

            {/* Summary header. */}
            {!loading && (
                <TagsEnhancedHeader
                    instituteTags={instituteTags}
                    defaultTags={defaultTags}
                    counts={counts}
                />
            )}

            {/* Create tag card */}
            <div className="rounded-xl border border-neutral-200 bg-white p-5">
                <h3 className="mb-3 text-sm font-semibold text-neutral-800">Create New Tag</h3>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-neutral-600">
                            Tag Name *
                        </label>
                        <input
                            type="text"
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            placeholder="e.g. VIP Student"
                            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-200"
                            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
                        />
                    </div>
                    <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-neutral-600">
                            Description
                        </label>
                        <input
                            type="text"
                            value={newTagDesc}
                            onChange={(e) => setNewTagDesc(e.target.value)}
                            placeholder="Optional description"
                            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-200"
                            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
                        />
                    </div>
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={creating || !newTagName.trim()}
                        onClick={onCreate}
                    >
                        {creating ? 'Creating...' : '+ Create'}
                    </MyButton>
                </div>
            </div>

            {/* Search */}
            <input
                type="text"
                placeholder="Search tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-200"
            />

            {/* Tags list */}
            {loading ? (
                <DashboardLoader />
            ) : filteredTags.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 py-12 text-center">
                    <p className="text-sm text-neutral-500">
                        {searchQuery ? 'No tags match your search' : 'No tags yet — create one above'}
                    </p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Institute tags */}
                    {instituteTags.filter((t) =>
                        t.tagName.toLowerCase().includes(searchQuery.toLowerCase())
                    ).length > 0 && (
                        <div>
                            <div className="mb-2 flex items-center gap-2">
                                <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                                    Institute Tags
                                </h2>
                                <div className="h-px flex-1 bg-neutral-200" />
                            </div>
                            <div className="flex flex-col gap-2">
                                {instituteTags
                                    .filter((t) =>
                                        t.tagName
                                            .toLowerCase()
                                            .includes(searchQuery.toLowerCase())
                                    )
                                    .map((t) => renderTagCard(t, false))}
                            </div>
                        </div>
                    )}

                    {/* Default tags */}
                    {defaultTags.filter((t) =>
                        t.tagName.toLowerCase().includes(searchQuery.toLowerCase())
                    ).length > 0 && (
                        <div>
                            <div className="mb-2 flex items-center gap-2">
                                <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                                    System Tags
                                </h2>
                                <div className="h-px flex-1 bg-neutral-200" />
                            </div>
                            <div className="flex flex-col gap-2">
                                {defaultTags
                                    .filter((t) =>
                                        t.tagName
                                            .toLowerCase()
                                            .includes(searchQuery.toLowerCase())
                                    )
                                    .map((t) => renderTagCard(t, true))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Users Dialog ── */}
            <MyDialog
                heading={`Users tagged: ${usersDialogTag?.tagName || ''}`}
                open={usersDialogOpen}
                onOpenChange={setUsersDialogOpen}
                dialogWidth="max-w-2xl"
                footer={
                    <div className="flex w-full items-center justify-between">
                        <MyButton buttonType="secondary" scale="small" onClick={exportUsersCsv}>
                            📥 Export CSV
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            onClick={() => setUsersDialogOpen(false)}
                        >
                            Close
                        </MyButton>
                    </div>
                }
            >
                {usersLoading ? (
                    <DashboardLoader />
                ) : userDetails.length === 0 ? (
                    <div className="py-8 text-center text-sm text-neutral-400">
                        No users found with this tag
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <p className="text-xs text-neutral-500">
                            {userDetails.length} user(s) found
                        </p>
                        <div className="max-h-[400px] overflow-auto rounded-lg border border-neutral-200">
                            <table className="w-full text-left text-xs">
                                <thead className="sticky top-0 bg-neutral-50">
                                    <tr>
                                        <th className="px-3 py-2.5 font-medium text-neutral-600">
                                            Name
                                        </th>
                                        <th className="px-3 py-2.5 font-medium text-neutral-600">
                                            Username
                                        </th>
                                        <th className="px-3 py-2.5 font-medium text-neutral-600">
                                            Email
                                        </th>
                                        <th className="px-3 py-2.5 font-medium text-neutral-600">
                                            Phone
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-neutral-100">
                                    {userDetails.map((u) => (
                                        <tr key={u.userId} className="hover:bg-neutral-50/50">
                                            <td className="px-3 py-2 font-medium text-neutral-800">
                                                {u.fullName || '—'}
                                            </td>
                                            <td className="px-3 py-2 text-neutral-600">
                                                {u.username || '—'}
                                            </td>
                                            <td className="px-3 py-2 text-neutral-600">
                                                {u.email || '—'}
                                            </td>
                                            <td className="px-3 py-2 text-neutral-600">
                                                {u.phoneNumber || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </MyDialog>

            {/* ── Assign Courses Dialog ── */}
            <AssignCoursesToTagsDialog
                selectedTags={selectedTags}
                userCount={selectedTags.reduce(
                    (sum, t) => sum + (counts[t.tagName] ?? 0),
                    0
                )}
                open={assignDialogOpen}
                onOpenChange={setAssignDialogOpen}
            />

            {/* ── Delete Tag Confirmation ── */}
            <AlertDialog
                open={!!tagToDelete}
                onOpenChange={(open) => {
                    if (!open && !isDeleting) setTagToDelete(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Delete tag &ldquo;{tagToDelete?.tagName}&rdquo;?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {tagToDelete && (counts[tagToDelete.tagName] ?? 0) > 0 ? (
                                <>
                                    This tag is currently applied to{' '}
                                    <span className="font-medium text-neutral-800">
                                        {counts[tagToDelete.tagName]}{' '}
                                        {counts[tagToDelete.tagName] === 1
                                            ? 'user'
                                            : 'users'}
                                    </span>
                                    . Deleting will mark the tag inactive — it will no longer
                                    appear in the institute tag list, but historical user
                                    associations are preserved.
                                </>
                            ) : (
                                <>
                                    This will mark the tag inactive. You can&apos;t undo this
                                    from the UI.
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                // Prevent the default close-on-click so the dialog
                                // stays open until the request resolves.
                                e.preventDefault();
                                onConfirmDelete();
                            }}
                            disabled={isDeleting}
                            className="bg-red-600 hover:bg-red-700 focus-visible:ring-red-300"
                        >
                            {isDeleting ? 'Deleting…' : 'Delete'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
