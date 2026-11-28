import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UseFormReturn } from 'react-hook-form';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField, FormItem, FormControl, FormMessage, FormLabel } from '@/components/ui/form';
import { ImageSquare, PencilSimpleLine, X } from '@phosphor-icons/react';
import { MyInput } from '@/components/design-system/input';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { Badge } from '@/components/ui/badge';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

// Renders a course image with a graceful placeholder when the URL is empty
// or fails to load (e.g. the saved media file no longer exists).
const PreviewImageWithFallback = ({ src, alt }: { src?: string; alt: string }) => {
    const [errored, setErrored] = useState(false);
    useEffect(() => {
        setErrored(false);
    }, [src]);

    if (!src || errored) {
        return (
            <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
                <p className="text-white">
                    <ImageSquare size={100} />
                </p>
            </div>
        );
    }
    return (
        <div className="h-48 w-full rounded-lg bg-gray-100">
            <img
                src={src}
                alt={alt}
                onError={() => setErrored(true)}
                className="size-full rounded-lg object-contain"
            />
        </div>
    );
};

interface CoursePreviewCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
    handleTagInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    addTag: (e?: React.MouseEvent | React.KeyboardEvent, selectedTag?: string) => void;
    removeTag: (tagToRemove: string) => void;
    coursePreviewRef: React.RefObject<HTMLInputElement>;
    courseBannerRef: React.RefObject<HTMLInputElement>;
    mediaMenuRef: React.RefObject<HTMLDivElement>;
    youtubeInputRef: React.RefObject<HTMLDivElement>;
    courseMediaRef: React.RefObject<HTMLInputElement>;
    handleFileUpload: (file: File, field: 'coursePreview' | 'courseBanner' | 'courseMedia') => void;
    extractYouTubeVideoId: (url: string) => string | null;
    isBundle?: boolean;
    totalBatches?: number;
}

const CoursePreviewCard = ({
    form,
    handleTagInputChange,
    addTag,
    removeTag,
    coursePreviewRef,
    courseBannerRef,
    mediaMenuRef,
    youtubeInputRef,
    courseMediaRef,
    handleFileUpload,
    extractYouTubeVideoId,
    isBundle = false,
    totalBatches = 1,
}: CoursePreviewCardProps) => {
    const { t } = useTranslation('manageStudentsCoursePreviewCard');
    return (
        <Card className="pb-4">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-2xl font-bold">
                    <PencilSimpleLine size={22} />
                    <span>{t('card.title')}</span>
                    {isBundle && (
                        <Badge variant="secondary" className="ml-2 bg-blue-100 text-blue-700">
                            {t('card.bundleBadge', { count: totalBatches })}
                        </Badge>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 gap-8">
                    {/* Left Column - Form Fields */}
                    <div className="space-y-6">
                        <FormField
                            control={form.control}
                            name="course"
                            render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <MyInput
                                            id="course-name"
                                            required={true}
                                            label={getTerminology(ContentTerms.Course, SystemTerms.Course)}
                                            inputType="text"
                                            inputPlaceholder={t('courseName.placeholder')}
                                            className="w-full"
                                            input={field.value}
                                            onChangeFunction={(e) => field.onChange(e.target.value)}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="flex flex-col">
                            <FormField
                                control={form.control}
                                name="description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('description.label')}</FormLabel>
                                        <FormControl>
                                            <RichTextEditor
                                                onChange={(value: string) => {
                                                    const plainText = value
                                                        .replace(/<[^>]*>/g, '')
                                                        .trim();
                                                    const words = plainText.split(/\s+/);
                                                    if (words.length <= 30) {
                                                        field.onChange(value);
                                                    } else {
                                                        // Truncate to first 30 words and update editor content
                                                        const truncatedText = words
                                                            .slice(0, 30)
                                                            .join(' ');
                                                        field.onChange(truncatedText);
                                                    }
                                                }}
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                minHeight={120}
                                                placeholder={t('description.placeholder')}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            <span className="relative top-12 text-xs text-red-500">
                                {t('description.maxWordsHint')}
                            </span>
                        </div>

                        {/* Tags Section */}
                        <div className="space-y-2 pt-10">
                            <Label className="font-medium text-gray-900">
                                {t('tags.sectionLabel', {
                                    term: getTerminology(
                                        ContentTerms.PopularTag,
                                        SystemTerms.PopularTag
                                    ),
                                })}
                            </Label>
                            <p className="text-sm text-gray-600">{t('tags.helperText')}</p>
                            <div className="flex gap-2">
                                <Input
                                    type="text"
                                    placeholder={t('tags.inputPlaceholder')}
                                    value={form.watch('newTag')}
                                    onChange={handleTagInputChange}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            addTag(e);
                                        }
                                    }}
                                    className="h-9 border-gray-300"
                                />

                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    layoutVariant="default"
                                    onClick={addTag}
                                    disable={!(form.watch('newTag') || '').trim()}
                                >
                                    {t('tags.addButton')}
                                </MyButton>
                            </div>

                            {/* Suggestions dropdown */}
                            {form.watch('filteredTags')?.length > 0 && (
                                <div className="w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-sm">
                                    <div className="flex flex-wrap gap-1.5 p-2">
                                        {form.watch('filteredTags').map((tag, index) => (
                                            <span
                                                key={index}
                                                className="hover:text-primary-600 cursor-pointer select-none rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-700 transition-colors hover:bg-primary-100"
                                                onClick={(e) => addTag(e, tag)}
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {form.watch('tags')?.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {form.watch('tags').map((tag, index) => (
                                        <Badge
                                            key={index}
                                            variant="secondary"
                                            className="flex items-center gap-1 px-3 py-1"
                                        >
                                            {tag}
                                            <X
                                                className="size-3 cursor-pointer"
                                                onClick={() => removeTag(tag)}
                                            />
                                        </Badge>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col gap-16 pb-8">
                            <FormField
                                control={form.control}
                                name="learningOutcome"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('learningOutcome.label')}</FormLabel>
                                        <FormControl>
                                            <RichTextEditor
                                                onChange={field.onChange}
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                minHeight={120}
                                                placeholder={t('placeholders.courseOverview')}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="aboutCourse"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('aboutCourse.label')}</FormLabel>
                                        <FormControl>
                                            <RichTextEditor
                                                onChange={field.onChange}
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                minHeight={120}
                                                placeholder={t('placeholders.courseOverview')}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="targetAudience"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>{t('targetAudience.label')}</FormLabel>
                                        <FormControl>
                                            <RichTextEditor
                                                onChange={field.onChange}
                                                value={field.value}
                                                onBlur={field.onBlur}
                                                minHeight={120}
                                                placeholder={t('placeholders.courseOverview')}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>

                    {/* Right Column - Image Uploads */}
                    <div className="space-y-6">
                        {/* Course Preview */}
                        <div className="flex flex-col gap-1">
                            <FormLabel>{t('media.coursePreview.label')}</FormLabel>
                            <p className="text-sm text-gray-500">
                                {t('media.coursePreview.helperText')}
                            </p>
                            <div className="relative">
                                {form.watch('uploadingStates').coursePreview ? (
                                    <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
                                        <DashboardLoader />
                                    </div>
                                ) : form.watch('coursePreview') ? (
                                    <PreviewImageWithFallback
                                        src={form.watch('coursePreviewBlob')}
                                        alt={t('media.coursePreview.alt')}
                                    />
                                ) : (
                                    <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
                                        <p className="text-white">
                                            <ImageSquare size={100} />
                                        </p>
                                    </div>
                                )}
                                <FileUploadComponent
                                    fileInputRef={coursePreviewRef}
                                    onFileSubmit={(file) => handleFileUpload(file, 'coursePreview')}
                                    control={form.control}
                                    name="coursePreview"
                                    acceptedFileTypes={['image/jpeg', 'image/png', 'image/svg+xml']}
                                />
                                <MyButton
                                    type="button"
                                    onClick={() => coursePreviewRef.current?.click()}
                                    disabled={form.watch('uploadingStates').coursePreview}
                                    buttonType="secondary"
                                    layoutVariant="icon"
                                    scale="small"
                                    className="absolute bottom-2 right-2 bg-white"
                                >
                                    <PencilSimpleLine />
                                </MyButton>
                            </div>
                        </div>

                        {/* Course Banner */}
                        <div className="flex flex-col gap-1">
                            <FormLabel>{t('media.courseBanner.label')}</FormLabel>
                            <p className="text-sm text-gray-500">
                                {t('media.courseBanner.helperText')}
                            </p>
                            <div className="relative">
                                {form.watch('uploadingStates').courseBanner ? (
                                    <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
                                        <DashboardLoader />
                                    </div>
                                ) : form.watch('courseBanner') ? (
                                    <PreviewImageWithFallback
                                        src={form.watch('courseBannerBlob')}
                                        alt={t('media.courseBanner.alt')}
                                    />
                                ) : (
                                    <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
                                        <p className="text-white">
                                            <ImageSquare size={100} />
                                        </p>
                                    </div>
                                )}
                                <FileUploadComponent
                                    fileInputRef={courseBannerRef}
                                    onFileSubmit={(file) => handleFileUpload(file, 'courseBanner')}
                                    control={form.control}
                                    name="courseBanner"
                                    acceptedFileTypes={['image/jpeg', 'image/png', 'image/svg+xml']}
                                />
                                <MyButton
                                    type="button"
                                    onClick={() => courseBannerRef.current?.click()}
                                    disabled={form.watch('uploadingStates').courseBanner}
                                    buttonType="secondary"
                                    layoutVariant="icon"
                                    scale="small"
                                    className="absolute bottom-2 right-2 bg-white"
                                >
                                    <PencilSimpleLine />
                                </MyButton>
                            </div>
                        </div>

                        {/* Course Media */}
                        <div className="flex flex-col gap-1">
                            <FormLabel>{t('media.courseMedia.label')}</FormLabel>
                            <p className="text-sm text-gray-500">
                                {t('media.courseMedia.helperText')}
                            </p>
                            <div className="flex flex-col gap-2">
                                {/* Preview logic remains unchanged */}
                                {form.watch('uploadingStates').courseMedia ? (
                                    <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
                                        <DashboardLoader />
                                    </div>
                                ) : (form.watch('courseMedia')?.id ||
                                      form.watch('courseMediaBlob')) &&
                                  form.watch('courseMedia')?.type !== 'youtube' ? (
                                    form.watch('courseMedia')?.type === 'video' ? (
                                        form.watch('courseMediaBlob') ? (
                                            <div className="h-48 w-full rounded-lg bg-gray-100">
                                                <video
                                                    src={form.watch('courseMediaBlob')}
                                                    controls
                                                    controlsList="nodownload noremoteplayback"
                                                    disablePictureInPicture
                                                    disableRemotePlayback
                                                    className="size-full rounded-lg object-contain"
                                                >
                                                    {t('media.courseMedia.videoUnsupported')}
                                                </video>
                                            </div>
                                        ) : (
                                            <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
                                                <p className="text-white">
                                                    <ImageSquare size={100} />
                                                </p>
                                            </div>
                                        )
                                    ) : (
                                        <PreviewImageWithFallback
                                            src={form.watch('courseMediaBlob')}
                                            alt={t('media.courseMedia.alt')}
                                        />
                                    )
                                ) : form.watch('courseMedia')?.type === 'youtube' &&
                                  form.watch('courseMedia')?.id ? (
                                    <div className="mt-2 flex h-48 w-full items-center justify-center rounded-lg bg-gray-100">
                                        <iframe
                                            width="100%"
                                            height="100%"
                                            src={`https://www.youtube.com/embed/${extractYouTubeVideoId(form.watch('courseMedia')?.id || '')}`}
                                            title={t('youtube.playerTitle')}
                                            frameBorder="0"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                            allowFullScreen
                                            className="size-full rounded-lg object-contain"
                                        />
                                    </div>
                                ) : (
                                    <div className="flex h-48 items-center justify-center rounded-lg bg-gray-100">
                                        <p className="text-white">
                                            <ImageSquare size={100} />
                                        </p>
                                    </div>
                                )}
                                {/* Pen icon and dropdown logic */}
                                <div className="-mt-10 mr-2 flex flex-col items-end justify-end">
                                    <MyButton
                                        type="button"
                                        disabled={form.watch('uploadingStates').courseMedia}
                                        buttonType="secondary"
                                        layoutVariant="icon"
                                        scale="small"
                                        className="bg-white hover:bg-white active:bg-white"
                                        onClick={() => {
                                            form.setValue(
                                                'showMediaMenu',
                                                !form.watch('showMediaMenu')
                                            );
                                            form.setValue('showYoutubeInput', false);
                                        }}
                                    >
                                        <PencilSimpleLine />
                                    </MyButton>
                                    {form.watch('showMediaMenu') && (
                                        <div
                                            ref={mediaMenuRef}
                                            className=" flex w-48 flex-col gap-2 rounded bg-white p-2 shadow"
                                        >
                                            <button
                                                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-100"
                                                onClick={() => {
                                                    form.setValue('showMediaMenu', false);
                                                    courseMediaRef.current?.click();
                                                }}
                                            >
                                                {t('media.courseMedia.uploadOption')}
                                            </button>
                                            <button
                                                className="w-full rounded px-3 py-2 text-left text-sm hover:bg-gray-100"
                                                onClick={() => {
                                                    form.setValue('showMediaMenu', false);
                                                    form.setValue('showYoutubeInput', true);
                                                }}
                                            >
                                                {t('media.courseMedia.youtubeOption')}
                                            </button>
                                        </div>
                                    )}
                                    {form.watch('showYoutubeInput') && (
                                        <div
                                            ref={youtubeInputRef}
                                            className=" w-64 rounded bg-white p-4 shadow"
                                        >
                                            <label className="mb-1 block text-sm font-medium text-gray-700">
                                                {t('youtube.pasteLinkLabel')}
                                            </label>
                                            <Input
                                                type="text"
                                                placeholder="https://youtube.com/watch?v=..."
                                                value={form.watch('youtubeUrl') || ''}
                                                onChange={(e) => {
                                                    form.setValue('youtubeUrl', e.target.value);
                                                    form.setValue('youtubeError', '');
                                                }}
                                                className="mb-2"
                                            />
                                            {form.watch('youtubeError') && (
                                                <div className="mb-2 text-xs text-red-500">
                                                    {form.watch('youtubeError')}
                                                </div>
                                            )}
                                            <MyButton
                                                buttonType="primary"
                                                scale="medium"
                                                layoutVariant="default"
                                                className="w-full"
                                                onClick={() => {
                                                    const id = extractYouTubeVideoId(
                                                        form.watch('youtubeUrl')
                                                    );
                                                    if (!id) {
                                                        form.setValue(
                                                            'youtubeError',
                                                            t('errors.invalidYoutubeLink')
                                                        );
                                                        return;
                                                    }
                                                    form.setValue('courseMedia', {
                                                        type: 'youtube',
                                                        id: form.watch('youtubeUrl'),
                                                    });
                                                    form.setValue(
                                                        'courseMediaBlob',
                                                        form.watch('youtubeUrl')
                                                    );
                                                    form.setValue('showYoutubeInput', false);
                                                }}
                                                disable={!form.watch('youtubeUrl')}
                                            >
                                                {t('youtube.saveButton')}
                                            </MyButton>
                                        </div>
                                    )}
                                </div>
                                {/* Always render the FileUploadComponent, but hide it visually */}
                                <div style={{ display: 'none' }}>
                                    <FileUploadComponent
                                        fileInputRef={courseMediaRef}
                                        onFileSubmit={(file) =>
                                            handleFileUpload(file, 'courseMedia')
                                        }
                                        control={form.control}
                                        name="courseMedia"
                                        acceptedFileTypes={[
                                            'image/jpeg',
                                            'image/png',
                                            'image/svg+xml',
                                            'video/mp4',
                                            'video/quicktime',
                                            'video/x-msvideo',
                                            'video/webm',
                                        ]}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default CoursePreviewCard;
