import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { PackageDTO } from '../../-types/package-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updatePackageDetails } from '../../-services/package-service';
import { toast } from 'sonner';
import { Pencil, Trash } from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { UploadFileInS3 } from '@/services/upload_file';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface EditPackageDialogProps {
    packageDto: PackageDTO;
    trigger?: React.ReactNode;
}

export const EditPackageDialog = ({ packageDto, trigger }: EditPackageDialogProps) => {
    const [open, setOpen] = useState(false);
    const queryClient = useQueryClient();

    // Form State
    const [formData, setFormData] = useState({
        package_name: packageDto.package_name,
        tags: packageDto.tags || [],
        why_learn_html: packageDto.why_learn_html || '',
        who_should_learn_html: packageDto.who_should_learn_html || '',
        about_the_course_html: packageDto.about_the_course_html || '',
        course_html_description_html: packageDto.course_html_description_html || '',
        is_course_published_to_catalaouge: packageDto.is_course_published_to_catalaouge,
        course_depth: packageDto.course_depth,
        // Media fields would typically need a file uploader, skipping for text-only edit first
        thumbnail_file_id: packageDto.thumbnail_file_id,
        course_preview_image_media_id: packageDto.course_preview_image_media_id,
        course_banner_media_id: packageDto.course_banner_media_id,
        course_media_id: packageDto.course_media_id,
    });

    const [isUploading, setIsUploading] = useState(false);

    // Get user ID for upload
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken || '');
    const userId = (tokenData?.user as string) || '';

    const handleFileUpload = async (file: File, fieldName: string) => {
        if (!userId) {
            toast.error('User session not found');
            return;
        }

        try {
            const fileId = await UploadFileInS3(
                file,
                setIsUploading,
                userId,
                'PACKAGE_ASSETS',
                packageDto.id
            );

            if (fileId) {
                setFormData((prev) => ({
                    ...prev,
                    [fieldName]: fileId,
                }));
                toast.success('File uploaded successfully');
            }
        } catch (error) {
            toast.error('Failed to upload file');
            console.error(error);
        }
    };

    const { mutate, isPending } = useMutation({
        mutationFn: async () => {
            // ... existing mutation logic
            await updatePackageDetails(packageDto.id, formData);
        },
        onSuccess: () => {
            toast.success('Package updated successfully');
            queryClient.invalidateQueries({ queryKey: ['package-sessions'] });
            setOpen(false);
        },
        onError: () => {
            toast.error('Failed to update package');
        },
    });

    const handleTagsChange = (val: string) => {
        setFormData((prev) => ({
            ...prev,
            tags: val
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
        }));
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="ghost" size="icon" className="size-8">
                        <Pencil className="size-4" />
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="z-[100] max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Edit Package Details</DialogTitle>
                    <DialogDescription>
                        Update the package information, tags, and content descriptions.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Package Name</Label>
                        <Input
                            id="name"
                            value={formData.package_name}
                            onChange={(e) =>
                                setFormData({ ...formData, package_name: e.target.value })
                            }
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="tags">Tags (comma separated)</Label>
                        <Input
                            id="tags"
                            value={formData.tags.join(', ')}
                            onChange={(e) => handleTagsChange(e.target.value)}
                            placeholder="java, spring, backend"
                        />
                    </div>

                    <div className="flex items-center space-x-2">
                        <Switch
                            id="published"
                            checked={formData.is_course_published_to_catalaouge}
                            onCheckedChange={(checked) =>
                                setFormData({
                                    ...formData,
                                    is_course_published_to_catalaouge: checked,
                                })
                            }
                        />
                        <Label htmlFor="published">Published to Catalogue</Label>
                    </div>

                    <div className="grid gap-2">
                        <Label>Why Learn (HTML)</Label>
                        <Textarea
                            className="min-h-[100px] font-mono text-xs"
                            value={formData.why_learn_html}
                            onChange={(e) =>
                                setFormData({ ...formData, why_learn_html: e.target.value })
                            }
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>Who Should Learn (HTML)</Label>
                        <Textarea
                            className="min-h-[100px] font-mono text-xs"
                            value={formData.who_should_learn_html}
                            onChange={(e) =>
                                setFormData({
                                    ...formData,
                                    who_should_learn_html: e.target.value,
                                })
                            }
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>
                            About the {getTerminology(ContentTerms.Course, SystemTerms.Course)}{' '}
                            (HTML)
                        </Label>
                        <Textarea
                            className="min-h-[100px] font-mono text-xs"
                            value={formData.about_the_course_html}
                            onChange={(e) =>
                                setFormData({
                                    ...formData,
                                    about_the_course_html: e.target.value,
                                })
                            }
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label>Thumbnail Image</Label>
                            <div className="flex flex-col gap-1">
                                <Input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                        if (e.target.files?.[0])
                                            handleFileUpload(
                                                e.target.files[0],
                                                'thumbnail_file_id'
                                            );
                                    }}
                                />
                                {formData.thumbnail_file_id && (
                                    <div className="flex items-center justify-between rounded bg-green-50 px-2 py-1">
                                        <span className="truncate text-[10px] text-green-600">
                                            ID: {formData.thumbnail_file_id}
                                        </span>
                                        <button
                                            onClick={() =>
                                                setFormData({
                                                    ...formData,
                                                    thumbnail_file_id: null,
                                                })
                                            }
                                            className="text-red-500 hover:text-red-700"
                                            title="Remove file"
                                        >
                                            <Trash className="size-3" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label>Preview Image</Label>
                            <div className="flex flex-col gap-1">
                                <Input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                        if (e.target.files?.[0])
                                            handleFileUpload(
                                                e.target.files[0],
                                                'course_preview_image_media_id'
                                            );
                                    }}
                                />
                                {formData.course_preview_image_media_id && (
                                    <div className="flex items-center justify-between rounded bg-green-50 px-2 py-1">
                                        <span className="truncate text-[10px] text-green-600">
                                            ID: {formData.course_preview_image_media_id}
                                        </span>
                                        <button
                                            onClick={() =>
                                                setFormData({
                                                    ...formData,
                                                    course_preview_image_media_id: null,
                                                })
                                            }
                                            className="text-red-500 hover:text-red-700"
                                            title="Remove file"
                                        >
                                            <Trash className="size-3" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label>Banner Image</Label>
                            <div className="flex flex-col gap-1">
                                <Input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => {
                                        if (e.target.files?.[0])
                                            handleFileUpload(
                                                e.target.files[0],
                                                'course_banner_media_id'
                                            );
                                    }}
                                />
                                {formData.course_banner_media_id && (
                                    <div className="flex items-center justify-between rounded bg-green-50 px-2 py-1">
                                        <span className="truncate text-[10px] text-green-600">
                                            ID: {formData.course_banner_media_id}
                                        </span>
                                        <button
                                            onClick={() =>
                                                setFormData({
                                                    ...formData,
                                                    course_banner_media_id: null,
                                                })
                                            }
                                            className="text-red-500 hover:text-red-700"
                                            title="Remove file"
                                        >
                                            <Trash className="size-3" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label>
                                {getTerminology(ContentTerms.Course, SystemTerms.Course)} Media
                                (Video/Image)
                            </Label>
                            <div className="flex flex-col gap-1">
                                <Input
                                    type="file"
                                    accept="image/*,video/*"
                                    onChange={(e) => {
                                        if (e.target.files?.[0])
                                            handleFileUpload(e.target.files[0], 'course_media_id');
                                    }}
                                />
                                {formData.course_media_id && (
                                    <div className="flex items-center justify-between rounded bg-green-50 px-2 py-1">
                                        <span className="truncate text-[10px] text-green-600">
                                            ID: {formData.course_media_id}
                                        </span>
                                        <button
                                            onClick={() =>
                                                setFormData({ ...formData, course_media_id: null })
                                            }
                                            className="text-red-500 hover:text-red-700"
                                            title="Remove file"
                                        >
                                            <Trash className="size-3" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {isUploading && (
                        <div className="flex justify-center">
                            <DashboardLoader />
                            <span className="ml-2 text-xs">Uploading...</span>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={() => mutate()} disabled={isPending || isUploading}>
                        {isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
