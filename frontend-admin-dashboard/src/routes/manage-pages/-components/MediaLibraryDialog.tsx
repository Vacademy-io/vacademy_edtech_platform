import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CircleNotch, ImageSquare, MagnifyingGlass } from '@phosphor-icons/react';
import { GET_USER_FILES } from '@/constants/urls';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getUserId } from '@/utils/userDetails';
import { getPublicUrl } from '@/services/upload_file';

/**
 * Media library — reuse an image you already uploaded instead of hunting for
 * the file again.
 *
 * Every image field in the builder was upload-only: no browsing, no reuse, so
 * the same logo got uploaded five times and admins had to keep source files
 * to hand. This lists what this admin has uploaded and hands back a public URL.
 *
 * SCOPE CAVEAT: media_service lists files per USER, not per institute, so a
 * colleague's uploads are not visible here. Upload still works for those; a
 * true shared institute library needs a backend change (the folder/source
 * columns exist on the row but are null in practice, so they can't be filtered
 * on yet).
 */

interface FileRow {
    file_detail?: { id?: string; file_name?: string; file_type?: string };
}

export const MediaLibraryDialog = ({
    open,
    onOpenChange,
    onPick,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The picked file's public URL, and its media file id. */
    onPick: (url: string, fileId: string) => void;
}) => {
    const [search, setSearch] = useState('');
    const [resolving, setResolving] = useState<string | null>(null);
    const userId = getUserId();

    const { data, isLoading } = useQuery({
        queryKey: ['MEDIA_LIBRARY', userId],
        queryFn: async () => {
            const { data } = await axios.get(`${GET_USER_FILES}/${userId}`, {
                headers: { Authorization: `Bearer ${getTokenFromCookie(TokenKey.accessToken)}` },
            });
            return (data || []) as FileRow[];
        },
        enabled: open && !!userId,
        staleTime: 60_000,
    });

    // Newest first: the file you want is almost always the one you just made.
    const images = useMemo(() => {
        const rows = (data || [])
            .map((r) => r.file_detail)
            .filter((f): f is NonNullable<FileRow['file_detail']> =>
                !!f?.id && !!f?.file_type && f.file_type.startsWith('image/'),
            );
        const q = search.trim().toLowerCase();
        const filtered = q
            ? rows.filter((f) => (f.file_name || '').toLowerCase().includes(q))
            : rows;
        return filtered.slice().reverse();
    }, [data, search]);

    const pick = async (fileId: string) => {
        try {
            setResolving(fileId);
            const url = await getPublicUrl(fileId);
            if (url) {
                onPick(url, fileId);
                onOpenChange(false);
            }
        } finally {
            setResolving(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ImageSquare className="size-5 text-primary-500" />
                        Your images
                    </DialogTitle>
                </DialogHeader>

                <div className="relative">
                    <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                    <Input
                        className="pl-8"
                        placeholder="Search by file name"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="max-h-96 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
                            <CircleNotch className="size-4 animate-spin" /> Loading your images…
                        </div>
                    ) : images.length === 0 ? (
                        <p className="py-12 text-center text-sm text-gray-500">
                            {search
                                ? 'No images match that name.'
                                : 'No images yet — upload one and it will appear here for reuse.'}
                        </p>
                    ) : (
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                            {images.map((f) => (
                                <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => pick(f.id!)}
                                    disabled={!!resolving}
                                    title={f.file_name}
                                    className="group relative overflow-hidden rounded border border-gray-200 transition hover:border-primary-400 disabled:opacity-50"
                                >
                                    <MediaThumb fileId={f.id!} alt={f.file_name || ''} />
                                    {resolving === f.id && (
                                        <span className="absolute inset-0 flex items-center justify-center bg-white/70">
                                            <CircleNotch className="size-4 animate-spin text-primary-500" />
                                        </span>
                                    )}
                                    <span className="block truncate bg-white px-1.5 py-1 text-left text-caption text-gray-500">
                                        {f.file_name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

/** Thumbnails resolve lazily — one signed-URL call per tile, cached by id. */
const MediaThumb = ({ fileId, alt }: { fileId: string; alt: string }) => {
    const { data: url } = useQuery({
        queryKey: ['MEDIA_THUMB', fileId],
        queryFn: () => getPublicUrl(fileId),
        staleTime: 10 * 60_000,
    });
    return (
        <span className="flex aspect-video w-full items-center justify-center bg-gray-100">
            {url ? (
                <img src={url} alt={alt} loading="lazy" className="size-full object-cover" />
            ) : (
                <ImageSquare className="size-5 text-gray-300" />
            )}
        </span>
    );
};

export default MediaLibraryDialog;
