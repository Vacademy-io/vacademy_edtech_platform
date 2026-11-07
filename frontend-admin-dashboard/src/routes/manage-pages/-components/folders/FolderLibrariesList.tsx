import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DotsThreeVertical, FolderOpen, Folders, Plus, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { formatDate } from '@/lib/formatters';
import { useCataloguePermissions } from '../../-hooks/use-catalogue-permissions';
import {
    createFolderLibrary,
    deleteFolderLibrary,
    folderLibrariesQueryKey,
    listFolderLibraries,
    type FolderLibrary,
} from '../../-services/folder-library-service';

/**
 * Website Builder → Folders: every folder library of the institute. A library
 * is shared — any number of Folder Browser sections, on any of the
 * institute's sites, can show the same one.
 */

const updatedOn = (iso?: string | null) => {
    if (!iso || Number.isNaN(new Date(iso).getTime())) return '—';
    return formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });
};

interface FolderLibrariesListProps {
    onOpenLibrary: (libraryId: string) => void;
    /** Opened from a section: the new library is wired into it straight away. */
    onLibraryCreated?: ((libraryId: string, name: string) => void) | null;
}

export const FolderLibrariesList = ({ onOpenLibrary, onLibraryCreated }: FolderLibrariesListProps) => {
    const instituteId = getCurrentInstituteId();
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const { canWrite, canDelete } = useCataloguePermissions();
    const [creating, setCreating] = useState(false);
    const [deleting, setDeleting] = useState<FolderLibrary | null>(null);

    const { data: libraries, isLoading, isError, refetch } = useQuery({
        queryKey: folderLibrariesQueryKey(instituteId),
        queryFn: () => listFolderLibraries(instituteId!),
        enabled: !!instituteId,
    });

    const remove = useMutation({
        mutationFn: (id: string) => deleteFolderLibrary(instituteId!, id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: folderLibrariesQueryKey(instituteId) });
            toast({ title: 'Library deleted' });
        },
        onError: () => toast({ title: 'Could not delete the library', variant: 'destructive' }),
    });

    if (!instituteId) return <div className="p-6 text-neutral-500">No institute selected</div>;

    return (
        <div className="flex flex-col gap-6 p-6 lg:p-8">
            <div className="flex flex-col gap-4 pe-8 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-xl font-semibold text-neutral-800">Folders</h1>
                    <p className="mt-0.5 max-w-2xl text-sm text-neutral-500">
                        Organise what you sell into folders students can browse — Class → Subject → courses. Put a
                        Folder Browser section on any page to show a library.
                    </p>
                </div>
                {canWrite && (
                    <MyButton buttonType="primary" scale="medium" onClick={() => setCreating(true)}>
                        <Plus className="size-4" /> New library
                    </MyButton>
                )}
            </div>

            {isError ? (
                <div className="rounded-xl border border-danger-200 bg-white px-6 py-10 text-center">
                    <p className="text-sm font-medium text-neutral-700">Could not load your folder libraries.</p>
                    <MyButton className="mt-3" buttonType="secondary" scale="medium" onClick={() => refetch()}>
                        Try again
                    </MyButton>
                </div>
            ) : isLoading ? (
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-white" />
                    ))}
                </div>
            ) : !libraries || libraries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center">
                    <Folders className="mx-auto size-10 text-neutral-300" weight="duotone" />
                    <p className="mt-2 text-sm font-medium text-neutral-700">No folder libraries yet</p>
                    <p className="mx-auto mt-1 max-w-md text-xs text-neutral-500">
                        Create one, add folders, and link a product page wherever students should see courses to buy.
                    </p>
                    {canWrite && (
                        <MyButton className="mt-4" buttonType="primary" scale="medium" onClick={() => setCreating(true)}>
                            <Plus className="size-4" /> New library
                        </MyButton>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {libraries.map((lib) => (
                        <div
                            key={lib.id}
                            className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-5 py-4 transition hover:border-neutral-300"
                        >
                            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-start" onClick={() => onOpenLibrary(lib.id)}>
                                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                                    <Folders className="size-5" weight="duotone" />
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-neutral-800">{lib.name}</p>
                                    <p className="mt-0.5 truncate text-xs text-neutral-500">
                                        {lib.node_count} item{lib.node_count === 1 ? '' : 's'} · updated {updatedOn(lib.updated_at)}
                                        {lib.description ? ` · ${lib.description}` : ''}
                                    </p>
                                </div>
                            </button>
                            <MyButton buttonType="secondary" scale="small" onClick={() => onOpenLibrary(lib.id)}>
                                <FolderOpen className="size-4" /> Open
                            </MyButton>
                            {canDelete && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label="Library actions"
                                            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                                        >
                                            <DotsThreeVertical className="size-5" weight="bold" />
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                            className="text-danger-600 focus:text-danger-600"
                                            onClick={() => setDeleting(lib)}
                                        >
                                            <Trash className="me-2 size-4" /> Delete
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {creating && (
                <CreateLibraryDialog
                    onClose={() => setCreating(false)}
                    onCreated={(lib) => {
                        queryClient.invalidateQueries({ queryKey: folderLibrariesQueryKey(instituteId) });
                        onLibraryCreated?.(lib.id, lib.name);
                        onOpenLibrary(lib.id);
                    }}
                />
            )}

            <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Folder Browser sections showing this library will show nothing until you pick another
                            library for them. Product pages themselves are not deleted.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 hover:bg-danger-700"
                            onClick={() => {
                                if (deleting) remove.mutate(deleting.id);
                                setDeleting(null);
                            }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

const CreateLibraryDialog = ({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: (lib: FolderLibrary) => void;
}) => {
    const instituteId = getCurrentInstituteId();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [error, setError] = useState<string | null>(null);
    // Enter and the Create button share this; without the guard, Enter then a
    // click (or a double Enter) creates two libraries.
    const busy = useRef(false);

    const create = async () => {
        if (busy.current) return;
        if (!name.trim()) {
            setError('Give the library a name.');
            return;
        }
        busy.current = true;
        try {
            const lib = await createFolderLibrary(instituteId!, { name: name.trim(), description: description.trim() });
            onClose();
            onCreated(lib);
        } catch (e) {
            const data = (e as { response?: { data?: { ex?: string; message?: string } } })?.response?.data;
            setError(data?.ex || data?.message || 'Could not create the library.');
        } finally {
            busy.current = false;
        }
    };

    return (
        <MyDialog
            open
            onOpenChange={(o) => !o && onClose()}
            heading="New folder library"
            dialogWidth="max-w-md"
            footerLeft={error ? <p className="text-xs text-danger-600">{error}</p> : undefined}
            footer={
                <div className="flex gap-2">
                    <MyButton buttonType="secondary" scale="medium" onClick={onClose}>
                        Cancel
                    </MyButton>
                    <MyButton buttonType="primary" scale="medium" onAsyncClick={create} loadingText="Creating…">
                        Create
                    </MyButton>
                </div>
            }
        >
            <div className="space-y-3 p-1">
                <div>
                    <Label className="text-xs">Name</Label>
                    <Input
                        className="mt-1"
                        autoFocus
                        value={name}
                        maxLength={255}
                        placeholder="e.g. All courses by class"
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && create()}
                    />
                </div>
                <div>
                    <Label className="text-xs">Description (only you see this)</Label>
                    <Textarea
                        className="mt-1"
                        rows={2}
                        value={description}
                        maxLength={2000}
                        onChange={(e) => setDescription(e.target.value)}
                    />
                </div>
            </div>
        </MyDialog>
    );
};
