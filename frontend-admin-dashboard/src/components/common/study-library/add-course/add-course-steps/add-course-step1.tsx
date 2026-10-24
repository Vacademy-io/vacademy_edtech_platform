import { TokenKey } from '@/constants/auth/tokens';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { PencilSimpleLine, UploadSimple, X } from '@phosphor-icons/react';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { MyButton } from '@/components/design-system/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import ImageCropperDialog from '@/components/design-system/image-cropper-dialog';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';

import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { CourseSettingsData } from '@/types/course-settings';
import { AiAssistButton } from './ai-assist-button';
import { CoursePageSection, type CoursePageStatus } from './course-page-section';
import {
    COURSE_PAGE_MODES,
    emptyCoursePageContent,
    isBlankHtml,
    isEmptyFaq,
} from '../-utils/course-page-content';

// Step 1 Schema
export const step1Schema = z.object({
    id: z.string().optional(),
    course: z.string().refine(
        (value) => value.length >= 1,
        () => ({
            message: `${getTerminology(ContentTerms.Course, SystemTerms.Course)} name is required`,
        })
    ),
    description: z.string().optional(),
    learningOutcome: z.string().optional(),
    aboutCourse: z.string().optional(),
    targetAudience: z.string().optional(),
    coursePreview: z.string().optional(),
    courseBanner: z.string().optional(),
    courseMedia: z.object({
        type: z.string().optional(),
        id: z.string().optional(),
    }),
    coursePreviewBlob: z.string().optional(),
    courseBannerBlob: z.string().optional(),
    courseMediaBlob: z.string().optional(),
    tags: z.array(z.string()).default([]),
    /** Optional public course-page extras; serialised to `course_page_json` on save. */
    coursePage: z
        .object({
            mode: z.enum(COURSE_PAGE_MODES).nullable(),
            faqs: z.array(z.object({ q: z.string(), a: z.string() })),
        })
        .superRefine((value, ctx) => {
            // Untouched rows are dropped on save; a half-filled one is a mistake to flag.
            value.faqs.forEach((faq, index) => {
                if (isEmptyFaq(faq)) return;
                if (!faq.q.trim()) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['faqs', index, 'q'],
                        message: 'Add the question, or remove this FAQ',
                    });
                }
                if (isBlankHtml(faq.a)) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['faqs', index, 'a'],
                        message: 'Add an answer, or remove this FAQ',
                    });
                }
            });
        })
        .optional(),
});
export type Step1Data = z.infer<typeof step1Schema>;

// Utility to extract YouTube video ID
const extractYouTubeVideoId = (url: string): string | null => {
    const regExp = /^.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[1] && match[1].length === 11 ? match[1] : null;
};

export const AddCourseStep1 = ({
    onNext,
    initialData,
    courseSettings,
    settingsLoading,
    coursePageStatus = 'ready',
}: {
    onNext: (data: Step1Data) => void;
    initialData?: Step1Data;
    courseSettings?: CourseSettingsData;
    settingsLoading?: boolean;
    /** Edit: 'loading' until the stored course-page content is read from course-init. */
    coursePageStatus?: CoursePageStatus;
}) => {
    const { instituteDetails } = useInstituteDetailsStore();
    const courseTerm = getTerminology(ContentTerms.Course, SystemTerms.Course);
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];

    const { uploadFile, getPublicUrl } = useFileUpload();

    const coursePreviewRef = useRef<HTMLInputElement>(null);
    const courseBannerRef = useRef<HTMLInputElement>(null);
    const courseMediaRef = useRef<HTMLInputElement>(null);

    const [uploadingStates, setUploadingStates] = useState({
        coursePreview: false,
        courseBanner: false,
        courseMedia: false,
    });

    const [tags, setTags] = useState<string[]>(initialData?.tags || []); // selected tags
    const allTags = instituteDetails?.tags || [];
    const [newTag, setNewTag] = useState<string>('');
    const [filteredTags, setFilteredTags] = useState<string[]>([]);

    // Remove dialog state
    const [youtubeUrl, setYoutubeUrl] = useState('');
    const [youtubeError, setYoutubeError] = useState('');
    const [showYoutubeInput, setShowYoutubeInput] = useState(false);
    const youtubeInputRef = useRef<HTMLDivElement>(null);

    // Cropper dialog state
    const [isCropperOpen, setIsCropperOpen] = useState(false);
    const [cropperSrc, setCropperSrc] = useState<string>('');
    const [cropperAspect, setCropperAspect] = useState<number | undefined>(undefined);
    const cropTargetField = useRef<'coursePreview' | 'courseBanner' | 'courseMedia'>(
        'coursePreview'
    );
    const cropOutputType = useRef<'image/jpeg' | 'image/png' | 'image/webp'>('image/jpeg');
    // Which image box a file is being dragged over (drop opens the cropper).
    const [dragOverField, setDragOverField] = useState<string | null>(null);

    // Hide YouTube input when clicking outside
    useEffect(() => {
        if (!showYoutubeInput) return;
        function handleClick(e: MouseEvent) {
            if (youtubeInputRef.current && !youtubeInputRef.current.contains(e.target as Node)) {
                setShowYoutubeInput(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showYoutubeInput]);

    const form = useForm<Step1Data>({
        resolver: zodResolver(step1Schema),
        defaultValues: {
            course: initialData?.course,
            description: initialData?.description,
            learningOutcome: initialData?.learningOutcome,
            aboutCourse: initialData?.aboutCourse,
            targetAudience: initialData?.targetAudience,
            coursePreview: initialData?.coursePreview,
            courseBanner: initialData?.courseBanner,
            courseMedia: {
                ...(typeof initialData?.courseMedia === 'string'
                    ? initialData?.courseMedia
                        ? JSON.parse(initialData?.courseMedia)
                        : { type: '', id: '' }
                    : initialData?.courseMedia || { type: '', id: '' }),
            },
            coursePreviewBlob: '',
            courseBannerBlob: '',
            courseMediaBlob: '',
            tags: initialData?.tags,
            coursePage: initialData?.coursePage ?? emptyCoursePageContent(),
        },
    });

    // Collapsed by default. While open, step 1 never auto-advances (see below), so an
    // admin who has filled every other field can still add FAQs.
    const [coursePageOpen, setCoursePageOpen] = useState(false);
    // Edit: the stored content arrives after mount. The section is read-only until then,
    // so taking the loaded value cannot overwrite anything the admin typed.
    const previousCoursePageStatus = useRef(coursePageStatus);
    useEffect(() => {
        if (previousCoursePageStatus.current !== 'ready' && coursePageStatus === 'ready') {
            const loaded = initialData?.coursePage ?? emptyCoursePageContent();
            // Set the array by its own name so useFieldArray re-reads its rows.
            form.setValue('coursePage.mode', loaded.mode);
            form.setValue('coursePage.faqs', loaded.faqs);
        }
        previousCoursePageStatus.current = coursePageStatus;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coursePageStatus]);
    // A half-filled FAQ blocks Next; open the section so its message is visible.
    const submitStep = form.handleSubmit(onNext, (errors) => {
        if (errors.coursePage) setCoursePageOpen(true);
    });

    // Watch all form field values
    const courseValue = form.watch('course');
    const description = form.watch('description');
    const learningOutcome = form.watch('learningOutcome');
    const aboutCourse = form.watch('aboutCourse');
    const targetAudience = form.watch('targetAudience');
    const coursePreview = form.watch('coursePreview');
    const courseBanner = form.watch('courseBanner');
    const courseMedia = form.watch('courseMedia');

    // Function to check if ONLY REQUIRED fields are filled (for enabling Next button)
    const areRequiredFieldsFilled = useCallback((): boolean => {
        // Course name is always required
        if (!courseValue || courseValue.trim() === '') {
            return false;
        }

        // Check if any upload is in progress
        if (Object.values(uploadingStates).some((state) => state)) {
            return false;
        }

        return true;
    }, [courseValue, uploadingStates]);

    // Function to check if ALL visible fields are filled (for auto-advance)
    const areAllVisibleFieldsFilled = useCallback((): boolean => {
        // First check if required fields are filled
        if (!areRequiredFieldsFilled()) {
            return false;
        }

        // Then check all optional/visible fields based on settings
        const checks = {
            description: {
                enabled: courseSettings?.courseInformation?.descriptionRequired,
                value: description,
                filled: !!(description && description.trim() !== ''),
            },
            tags: {
                enabled: courseSettings?.courseInformation?.popularTopicsEnabled,
                value: tags,
                filled: !!(tags && tags.length > 0),
            },
            learningOutcome: {
                enabled: courseSettings?.courseInformation?.learnerOutcomesRequired,
                value: learningOutcome,
                filled: !!(learningOutcome && learningOutcome.trim() !== ''),
            },
            aboutCourse: {
                enabled: courseSettings?.courseInformation?.aboutCourseRequired,
                value: aboutCourse,
                filled: !!(aboutCourse && aboutCourse.trim() !== ''),
            },
            targetAudience: {
                enabled: courseSettings?.courseInformation?.targetAudienceRequired,
                value: targetAudience,
                filled: !!(targetAudience && targetAudience.trim() !== ''),
            },
            coursePreview: {
                enabled: courseSettings?.courseInformation?.previewImageRequired,
                value: coursePreview,
                filled: !!(coursePreview && coursePreview.trim() !== ''),
            },
            courseBanner: {
                enabled: courseSettings?.courseInformation?.bannerImageEnabled,
                value: courseBanner,
                filled: !!(courseBanner && courseBanner.trim() !== ''),
            },
            courseMedia: {
                enabled: courseSettings?.courseInformation?.courseMediaEnabled,
                value: form.watch('courseMedia'),
                filled: (() => {
                    const mediaData = form.watch('courseMedia');
                    return !!(mediaData?.id && mediaData?.type);
                })(),
            },
        };

        // Check description if enabled
        if (checks.description.enabled && !checks.description.filled) {
            return false;
        }

        // Check tags if enabled
        if (checks.tags.enabled && !checks.tags.filled) {
            return false;
        }

        // Check learner outcomes if enabled
        if (checks.learningOutcome.enabled && !checks.learningOutcome.filled) {
            return false;
        }

        // Check about course if enabled
        if (checks.aboutCourse.enabled && !checks.aboutCourse.filled) {
            return false;
        }

        // Check target audience if enabled
        if (checks.targetAudience.enabled && !checks.targetAudience.filled) {
            return false;
        }

        // Check preview image if enabled
        if (checks.coursePreview.enabled && !checks.coursePreview.filled) {
            return false;
        }

        // Check banner image if enabled
        if (checks.courseBanner.enabled && !checks.courseBanner.filled) {
            return false;
        }

        // Check course media if enabled
        if (checks.courseMedia.enabled && !checks.courseMedia.filled) {
            return false;
        }

        return true;
    }, [
        areRequiredFieldsFilled,
        courseSettings,
        description,
        tags,
        learningOutcome,
        aboutCourse,
        targetAudience,
        coursePreview,
        courseBanner,
        form,
    ]);

    // Next button is disabled only if REQUIRED fields are not filled
    const isNextDisabled = !areRequiredFieldsFilled();

    const handleFileUpload = async (
        file: File,
        field: 'coursePreview' | 'courseBanner' | 'courseMedia'
    ) => {
        try {
            setUploadingStates((prev) => ({
                ...prev,
                [field]: true,
            }));

            const uploadedFileId = await uploadFile({
                file,
                setIsUploading: (state) =>
                    setUploadingStates((prev) => ({
                        ...prev,
                        [field]: state,
                    })),
                userId: 'your-user-id',
                source: INSTITUTE_ID,
                sourceId: 'COURSES',
            });

            const publicUrl = await getPublicUrl(uploadedFileId || '');

            if (uploadedFileId) {
                if (field === 'courseMedia') {
                    form.setValue(field, {
                        type: file.type.includes('video') ? 'video' : 'image',
                        id: uploadedFileId,
                    }); // set as string
                } else {
                    form.setValue(field, uploadedFileId); // set as string
                }
                if (field === 'coursePreview') {
                    form.setValue('coursePreviewBlob', publicUrl);
                } else if (field === 'courseBanner') {
                    form.setValue('courseBannerBlob', publicUrl);
                } else if (field === 'courseMedia') {
                    form.setValue('courseMediaBlob', publicUrl);
                }
            }
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error('Image upload failed. Please try again.');
        } finally {
            setUploadingStates((prev) => ({
                ...prev,
                [field]: false,
            }));
        }
    };

    const readFileAsDataURL = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

    const handleFileSelectedWithCrop = async (
        file: File,
        field: 'coursePreview' | 'courseBanner' | 'courseMedia'
    ) => {
        const isImage = file.type.startsWith('image/');
        const isSvg = file.type === 'image/svg+xml';
        const isVideo = file.type.startsWith('video/');

        if (!isImage || isSvg || isVideo) {
            // Skip crop for non-images, SVGs, and videos
            await handleFileUpload(file, field);
            return;
        }

        const dataUrl = await readFileAsDataURL(file);
        cropTargetField.current = field;
        // Set aspect ratio based on field
        if (field === 'coursePreview') {
            setCropperAspect(2);
        } else if (field === 'courseBanner') {
            setCropperAspect(2.64);
        } else {
            setCropperAspect(2.64);
        }
        cropOutputType.current = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        setCropperSrc(dataUrl);
        setIsCropperOpen(true);
    };

    /** Drag-and-drop onto an image box: same path as picking a file. */
    const imageDropProps = (
        field: 'coursePreview' | 'courseBanner' | 'courseMedia',
        accepted: string[]
    ) => ({
        onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            if (dragOverField !== field) setDragOverField(field);
        },
        onDragLeave: () => setDragOverField(null),
        onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            setDragOverField(null);
            const file = e.dataTransfer.files?.[0];
            if (!file) return;
            if (!accepted.includes(file.type)) {
                toast.error('Please drop a JPEG, PNG or SVG image');
                return;
            }
            void handleFileSelectedWithCrop(file, field);
        },
    });

    const handleTagInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const input = e.target.value;
        setNewTag(input);

        if (input.trim()) {
            const filtered = allTags
                ?.filter(
                    (tag) => tag.toLowerCase().includes(input.toLowerCase()) && !tags.includes(tag) // Exclude already selected tags
                )
                .slice(0, 5);
            setFilteredTags(filtered);
        } else {
            setFilteredTags([]);
        }
    };

    const addTag = (e?: React.MouseEvent | React.KeyboardEvent, selectedTag?: string) => {
        if (e) e.preventDefault();

        const tagToAdd = selectedTag || newTag.trim();
        if (tagToAdd && !tags.includes(tagToAdd)) {
            const updatedTags = [...tags, tagToAdd];
            setTags(updatedTags);
            form.setValue('tags', updatedTags);
        }

        setNewTag('');
        setFilteredTags([]);
    };

    const removeTag = (tagToRemove: string) => {
        const updatedTags = tags.filter((tag) => tag !== tagToRemove);
        setTags(updatedTags);
        form.setValue('tags', updatedTags);
    };

    // Remove image/media handlers
    const removeCoursePreview = () => {
        form.setValue('coursePreview', '');
        form.setValue('coursePreviewBlob', '');
    };

    const removeCourseBanner = () => {
        form.setValue('courseBanner', '');
        form.setValue('courseBannerBlob', '');
    };

    const removeCourseMedia = () => {
        form.setValue('courseMedia', { type: '', id: '' });
        form.setValue('courseMediaBlob', '');
        setYoutubeUrl('');
    };

    useEffect(() => {
        const fetchAndSetUrls = async () => {
            const rawCourseMedia = initialData?.courseMedia;
            let courseMediaImage: { id?: string } | null = null;
            if (rawCourseMedia) {
                if (typeof rawCourseMedia === 'string') {
                    try {
                        courseMediaImage = JSON.parse(rawCourseMedia);
                    } catch {
                        courseMediaImage = null;
                    }
                } else if (typeof rawCourseMedia === 'object') {
                    courseMediaImage = rawCourseMedia as { id?: string };
                }
            }

            const coursePreviewId = form.getValues('coursePreview') || '';
            const courseBannerId = form.getValues('courseBanner') || '';
            const courseMediaId = courseMediaImage?.id;

            const [coursePreviewUrl, courseBannerUrl, courseMediaUrl] = await Promise.all([
                coursePreviewId ? getPublicUrl(coursePreviewId) : Promise.resolve(''),
                courseBannerId ? getPublicUrl(courseBannerId) : Promise.resolve(''),
                courseMediaId ? getPublicUrl(courseMediaId) : Promise.resolve(''),
            ]);

            if (coursePreviewUrl) form.setValue('coursePreviewBlob', coursePreviewUrl);
            if (courseBannerUrl) form.setValue('courseBannerBlob', courseBannerUrl);
            if (courseMediaUrl) form.setValue('courseMediaBlob', courseMediaUrl);
        };

        if (initialData) {
            fetchAndSetUrls();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData]);

    useEffect(() => {
        const refetchBlobUrls = async () => {
            const previewId = form.getValues('coursePreview');
            const bannerId = form.getValues('courseBanner');
            const mediaData = form.getValues('courseMedia');

            // Only fetch if we have file IDs but missing blob URLs
            if (previewId && !form.getValues('coursePreviewBlob')) {
                const url = await getPublicUrl(previewId);
                form.setValue('coursePreviewBlob', url);
            }

            if (bannerId && !form.getValues('courseBannerBlob')) {
                const url = await getPublicUrl(bannerId);
                form.setValue('courseBannerBlob', url);
            }

            if (mediaData?.id && !form.getValues('courseMediaBlob')) {
                const url = await getPublicUrl(mediaData.id);
                form.setValue('courseMediaBlob', url);
            }
        };

        refetchBlobUrls();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coursePreview, courseBanner, courseMedia]);

    // Auto-advance to next step when ALL visible fields are filled
    useEffect(() => {
        // Only auto-advance if settings are loaded
        if (settingsLoading || !courseSettings) {
            return undefined;
        }
        // Do not auto-advance in edit mode
        if (Object.keys(initialData || {}).length > 0) {
            return undefined;
        }
        // Nor while the admin is working in the optional course-page section.
        if (coursePageOpen) {
            return undefined;
        }

        // Check if ALL visible fields are filled
        if (areAllVisibleFieldsFilled()) {
            // Add a small delay to ensure smooth UX and avoid jarring immediate transition
            const timer = setTimeout(() => {
                submitStep();
            }, 300);

            return () => {
                clearTimeout(timer);
            };
        }

        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        courseValue,
        description,
        learningOutcome,
        aboutCourse,
        targetAudience,
        coursePreview,
        courseBanner,
        courseMedia,
        tags,
        uploadingStates,
        courseSettings,
        settingsLoading,
        initialData,
        coursePageOpen,
    ]);

    // Show loading state if settings are still loading
    if (settingsLoading) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center">
                <div className="text-center">
                    <div className="mb-4 inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
                    <p>Loading {courseTerm.toLocaleLowerCase()} settings...</p>
                </div>
            </div>
        );
    }

    return (
        <Form {...form}>
            <form onSubmit={submitStep} className="flex min-h-0 flex-1 flex-col">
                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto">
                    <div className="p-8">
                        <h1 className="mb-8">
                            Step 1: {getTerminology(ContentTerms.Course, SystemTerms.Course)}{' '}
                            Overview
                        </h1>
                        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
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
                                                    label={getTerminology(
                                                        ContentTerms.Course,
                                                        SystemTerms.Course
                                                    )}
                                                    inputType="text"
                                                    inputPlaceholder={`Enter ${courseTerm.toLocaleLowerCase()} name`}
                                                    className="w-full"
                                                    input={field.value}
                                                    onChangeFunction={(e) =>
                                                        field.onChange(e.target.value)
                                                    }
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                {courseSettings?.courseInformation?.descriptionRequired && (
                                    <FormField
                                        control={form.control}
                                        name="description"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex items-center justify-between">
                                                    <FormLabel>Description</FormLabel>
                                                    <AiAssistButton
                                                        mode="text"
                                                        field="description"
                                                        fieldLabel="Description"
                                                        getCourseName={() =>
                                                            form.getValues('course')
                                                        }
                                                        getExistingHtml={() => field.value}
                                                        onGenerated={(html) => field.onChange(html)}
                                                    />
                                                </div>
                                                <p className="text-sm text-neutral-500">
                                                    Shown under the title on the{' '}
                                                    {courseTerm.toLocaleLowerCase()} page.
                                                </p>
                                                <FormControl>
                                                    <RichTextEditor
                                                        onChange={field.onChange}
                                                        value={field.value || ''}
                                                        onBlur={field.onBlur}
                                                        minHeight={120}
                                                        placeholder={`Enter ${getTerminology(
                                                            ContentTerms.Course,
                                                            SystemTerms.Course
                                                        )} description`}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}

                                {/* Tags Section */}
                                {courseSettings?.courseInformation?.popularTopicsEnabled && (
                                    <div className="space-y-2 pt-10">
                                        <Label className="text-base font-medium text-neutral-900">
                                            {getTerminologyPlural(
                                                ContentTerms.PopularTag,
                                                SystemTerms.PopularTag
                                            )}
                                        </Label>
                                        <p className="text-sm text-neutral-600">
                                            Add tags to help categorize and find your{' '}
                                            {getTerminology(
                                                ContentTerms.Course,
                                                SystemTerms.Course
                                            ).toLowerCase()}{' '}
                                            easily
                                        </p>
                                        <div className="flex gap-2">
                                            <Input
                                                type="text"
                                                placeholder="Enter a tag"
                                                value={newTag}
                                                onChange={handleTagInputChange}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        addTag(e);
                                                    }
                                                }}
                                                className="h-9 border-neutral-300"
                                            />

                                            <MyButton
                                                type="button"
                                                buttonType="secondary"
                                                scale="medium"
                                                layoutVariant="default"
                                                onClick={addTag}
                                                disable={!newTag.trim()}
                                            >
                                                Add
                                            </MyButton>
                                        </div>

                                        {/* Suggestions dropdown */}
                                        {filteredTags?.length > 0 && (
                                            <div className="w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-sm">
                                                <div className="flex flex-wrap gap-1.5 p-2">
                                                    {filteredTags.map((tag, index) => (
                                                        <span
                                                            key={index}
                                                            className="cursor-pointer select-none rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-700 transition-colors hover:bg-primary-100 hover:text-primary-600"
                                                            onClick={(e) => addTag(e, tag)}
                                                        >
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {tags?.length > 0 && (
                                            <div className="flex flex-wrap gap-2">
                                                {tags?.map((tag, index) => (
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
                                )}
                                <div className="flex flex-col gap-16 pb-8">
                                    {courseSettings?.courseInformation?.learnerOutcomesRequired && (
                                        <FormField
                                            control={form.control}
                                            name="learningOutcome"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel>
                                                            What learners will gain?
                                                        </FormLabel>
                                                        <AiAssistButton
                                                            mode="text"
                                                            field="learningOutcome"
                                                            fieldLabel="What learners will gain?"
                                                            getCourseName={() =>
                                                                form.getValues('course')
                                                            }
                                                            getExistingHtml={() => field.value}
                                                            onGenerated={(html) =>
                                                                field.onChange(html)
                                                            }
                                                        />
                                                    </div>
                                                    <FormControl>
                                                        <RichTextEditor
                                                            onChange={field.onChange}
                                                            value={field.value || ''}
                                                            onBlur={field.onBlur}
                                                            minHeight={120}
                                                            placeholder={`Provide a detailed overview of the ${courseTerm.toLocaleLowerCase()}. Include learning objectives, topics covered, format (video, quizzes, projects), and who this ${courseTerm.toLocaleLowerCase()} is for.`}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                    {courseSettings?.courseInformation?.aboutCourseRequired && (
                                        <FormField
                                            control={form.control}
                                            name="aboutCourse"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel>
                                                            About the{' '}
                                                            {getTerminology(
                                                                ContentTerms.Course,
                                                                SystemTerms.Course
                                                            )}
                                                        </FormLabel>
                                                        <AiAssistButton
                                                            mode="text"
                                                            field="aboutCourse"
                                                            fieldLabel={`About the ${getTerminology(
                                                                ContentTerms.Course,
                                                                SystemTerms.Course
                                                            )}`}
                                                            getCourseName={() =>
                                                                form.getValues('course')
                                                            }
                                                            getExistingHtml={() => field.value}
                                                            onGenerated={(html) =>
                                                                field.onChange(html)
                                                            }
                                                        />
                                                    </div>
                                                    <FormControl>
                                                        <RichTextEditor
                                                            onChange={field.onChange}
                                                            value={field.value || ''}
                                                            onBlur={field.onBlur}
                                                            minHeight={120}
                                                            placeholder={`Provide a detailed overview of the ${courseTerm.toLocaleLowerCase()}. Include learning objectives, topics covered, format (video, quizzes, projects), and who this ${courseTerm.toLocaleLowerCase()} is for.`}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                    {courseSettings?.courseInformation?.targetAudienceRequired && (
                                        <FormField
                                            control={form.control}
                                            name="targetAudience"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <div className="flex items-center justify-between">
                                                        <FormLabel>Who should join?</FormLabel>
                                                        <AiAssistButton
                                                            mode="text"
                                                            field="targetAudience"
                                                            fieldLabel="Who should join?"
                                                            getCourseName={() =>
                                                                form.getValues('course')
                                                            }
                                                            getExistingHtml={() => field.value}
                                                            onGenerated={(html) =>
                                                                field.onChange(html)
                                                            }
                                                        />
                                                    </div>
                                                    <p className="text-sm text-neutral-500">
                                                        Shown as &lsquo;Who should do this{' '}
                                                        {courseTerm.toLocaleLowerCase()}&rsquo; on
                                                        the {courseTerm.toLocaleLowerCase()} page.
                                                    </p>
                                                    <FormControl>
                                                        <RichTextEditor
                                                            onChange={field.onChange}
                                                            value={field.value || ''}
                                                            onBlur={field.onBlur}
                                                            minHeight={120}
                                                            placeholder={`Provide a detailed overview of the ${courseTerm.toLocaleLowerCase()}. Include learning objectives, topics covered, format (video, quizzes, projects), and who this ${courseTerm.toLocaleLowerCase()} is for.`}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </div>
                            </div>

                            {/* Right Column - Image Uploads */}
                            <div className="space-y-6">
                                {/* Course Preview */}
                                {courseSettings?.courseInformation?.previewImageRequired && (
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center justify-between">
                                            <FormLabel>
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                )}{' '}
                                                Preview Image
                                            </FormLabel>
                                            <AiAssistButton
                                                mode="image"
                                                imageKind="preview"
                                                aspectRatio="16:9"
                                                fieldLabel="Preview Image"
                                                getCourseName={() => form.getValues('course')}
                                                disabled={uploadingStates.coursePreview}
                                                onGenerated={(file) =>
                                                    handleFileSelectedWithCrop(
                                                        file,
                                                        'coursePreview'
                                                    )
                                                }
                                            />
                                        </div>
                                        <p className="text-sm text-neutral-500">
                                            This is the thumbnail that appears on the{' '}
                                            {courseTerm.toLocaleLowerCase()} card. Recommended size:
                                            2:1 ratio. Drag an image here or click to upload, then
                                            move and resize the crop.
                                        </p>
                                        <div className="relative">
                                            {uploadingStates.coursePreview ? (
                                                <div className="flex h-52 items-center justify-center rounded-lg bg-neutral-100">
                                                    <DashboardLoader />
                                                </div>
                                            ) : form.watch('coursePreview') ? (
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() =>
                                                        coursePreviewRef.current?.click()
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            coursePreviewRef.current?.click();
                                                        }
                                                    }}
                                                    {...imageDropProps('coursePreview', [
                                                        'image/jpeg',
                                                        'image/png',
                                                        'image/svg+xml',
                                                    ])}
                                                    className={cn(
                                                        'group relative h-52 w-full cursor-pointer overflow-hidden rounded-lg bg-neutral-100',
                                                        dragOverField === 'coursePreview' &&
                                                            'ring-2 ring-primary-400'
                                                    )}
                                                >
                                                    <img
                                                        src={form.watch('coursePreviewBlob')}
                                                        alt={`${courseTerm} Preview`}
                                                        className="size-full rounded-lg object-contain"
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 transition-colors group-hover:bg-black/40">
                                                        <PencilSimpleLine
                                                            size={28}
                                                            className="text-white opacity-0 transition-opacity group-hover:opacity-100"
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() =>
                                                        coursePreviewRef.current?.click()
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            coursePreviewRef.current?.click();
                                                        }
                                                    }}
                                                    {...imageDropProps('coursePreview', [
                                                        'image/jpeg',
                                                        'image/png',
                                                        'image/svg+xml',
                                                    ])}
                                                    className={cn(
                                                        'flex h-52 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 transition-colors hover:border-primary-400 hover:bg-primary-50',
                                                        dragOverField === 'coursePreview' &&
                                                            'border-primary-400 bg-primary-50'
                                                    )}
                                                >
                                                    <UploadSimple
                                                        size={40}
                                                        className="text-neutral-400"
                                                    />
                                                    <p className="text-sm font-medium text-neutral-600">
                                                        Drag an image here or click to upload
                                                    </p>
                                                    <p className="text-xs text-neutral-400">
                                                        JPEG, PNG, SVG — 2:1 ratio recommended
                                                    </p>
                                                </div>
                                            )}
                                            <FileUploadComponent
                                                fileInputRef={coursePreviewRef}
                                                onFileSubmit={(file) =>
                                                    handleFileSelectedWithCrop(
                                                        file,
                                                        'coursePreview'
                                                    )
                                                }
                                                control={form.control}
                                                name="coursePreview"
                                                acceptedFileTypes={[
                                                    'image/jpeg',
                                                    'image/png',
                                                    'image/svg+xml',
                                                ]}
                                            />
                                        </div>
                                        {/* Remove button for preview image */}
                                        {form.watch('coursePreview') && (
                                            <button
                                                type="button"
                                                onClick={removeCoursePreview}
                                                className="mt-1 inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 hover:underline"
                                            >
                                                <X className="size-3" />
                                                Remove image
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Course Banner */}
                                {courseSettings?.courseInformation?.bannerImageEnabled && (
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center justify-between">
                                            <FormLabel>
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                )}{' '}
                                                Banner Image
                                            </FormLabel>
                                            <AiAssistButton
                                                mode="image"
                                                imageKind="banner"
                                                aspectRatio="16:9"
                                                fieldLabel="Banner Image"
                                                getCourseName={() => form.getValues('course')}
                                                disabled={uploadingStates.courseBanner}
                                                onGenerated={(file) =>
                                                    handleFileSelectedWithCrop(file, 'courseBanner')
                                                }
                                            />
                                        </div>
                                        <p className="text-sm text-neutral-500">
                                            A wide background image displayed on top of the{' '}
                                            {courseTerm.toLocaleLowerCase()} detail page.
                                            Recommended size: 2.64:1 ratio
                                        </p>
                                        <div className="relative">
                                            {uploadingStates.courseBanner ? (
                                                <div className="flex h-52 items-center justify-center rounded-lg bg-neutral-100">
                                                    <DashboardLoader />
                                                </div>
                                            ) : form.watch('courseBanner') ? (
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => courseBannerRef.current?.click()}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            courseBannerRef.current?.click();
                                                        }
                                                    }}
                                                    className="group relative h-52 w-full cursor-pointer overflow-hidden rounded-lg bg-neutral-100"
                                                >
                                                    <img
                                                        src={form.watch('courseBannerBlob')}
                                                        alt={`${courseTerm} Banner`}
                                                        className="size-full rounded-lg object-contain"
                                                    />
                                                    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 transition-colors group-hover:bg-black/40">
                                                        <PencilSimpleLine
                                                            size={28}
                                                            className="text-white opacity-0 transition-opacity group-hover:opacity-100"
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => courseBannerRef.current?.click()}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            courseBannerRef.current?.click();
                                                        }
                                                    }}
                                                    className="flex h-52 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 transition-colors hover:border-primary-400 hover:bg-primary-50"
                                                >
                                                    <UploadSimple
                                                        size={40}
                                                        className="text-neutral-400"
                                                    />
                                                    <p className="text-sm font-medium text-neutral-600">
                                                        Click to upload banner
                                                    </p>
                                                    <p className="text-xs text-neutral-400">
                                                        JPEG, PNG, SVG — 2.64:1 ratio recommended
                                                    </p>
                                                </div>
                                            )}
                                            <FileUploadComponent
                                                fileInputRef={courseBannerRef}
                                                onFileSubmit={(file) =>
                                                    handleFileSelectedWithCrop(file, 'courseBanner')
                                                }
                                                control={form.control}
                                                name="courseBanner"
                                                acceptedFileTypes={[
                                                    'image/jpeg',
                                                    'image/png',
                                                    'image/svg+xml',
                                                ]}
                                            />
                                        </div>
                                        {/* Remove button for banner image */}
                                        {form.watch('courseBanner') && (
                                            <button
                                                type="button"
                                                onClick={removeCourseBanner}
                                                className="mt-1 inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 hover:underline"
                                            >
                                                <X className="size-3" />
                                                Remove image
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* Course Media */}
                                {courseSettings?.courseInformation?.courseMediaEnabled && (
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center justify-between">
                                            <FormLabel>
                                                {getTerminology(
                                                    ContentTerms.Course,
                                                    SystemTerms.Course
                                                )}{' '}
                                                Media (Image or Video)
                                            </FormLabel>
                                            <AiAssistButton
                                                mode="image"
                                                imageKind="media"
                                                aspectRatio="16:9"
                                                fieldLabel="Media Image"
                                                getCourseName={() => form.getValues('course')}
                                                disabled={uploadingStates.courseMedia}
                                                onGenerated={(file) =>
                                                    handleFileSelectedWithCrop(file, 'courseMedia')
                                                }
                                            />
                                        </div>
                                        <p className="text-sm text-neutral-500">
                                            A featured media block within the{' '}
                                            {courseTerm.toLocaleLowerCase()} page; this can visually
                                            represent the content or offer a teaser. For videos,
                                            recommended format: MP4
                                        </p>
                                        <div className="relative flex flex-col gap-2">
                                            {/* Preview logic remains unchanged */}
                                            {uploadingStates.courseMedia ? (
                                                <div className="flex h-52 items-center justify-center rounded-lg bg-neutral-100">
                                                    <DashboardLoader />
                                                </div>
                                            ) : form.watch('courseMedia')?.id &&
                                              form.watch('courseMedia')?.type !== 'youtube' &&
                                              !extractYouTubeVideoId(
                                                  form.watch('courseMedia')?.id || ''
                                              ) ? (
                                                form.watch('courseMedia')?.type === 'video' ? (
                                                    <div className="h-52 w-full rounded-lg bg-neutral-100">
                                                        <video
                                                            src={form.watch('courseMediaBlob')}
                                                            controls
                                                            controlsList="nodownload noremoteplayback"
                                                            disablePictureInPicture
                                                            disableRemotePlayback
                                                            className="size-full rounded-lg object-contain"
                                                        >
                                                            Your browser does not support the video
                                                            tag.
                                                        </video>
                                                    </div>
                                                ) : (
                                                    <div className="flex h-52 items-center justify-center rounded-lg bg-neutral-100">
                                                        <img
                                                            src={form.watch('courseMediaBlob')}
                                                            alt={`${courseTerm} Banner`}
                                                            className="size-full rounded-lg object-contain"
                                                        />
                                                    </div>
                                                )
                                            ) : form.watch('courseMedia')?.id &&
                                              (form.watch('courseMedia')?.type === 'youtube' ||
                                                  extractYouTubeVideoId(
                                                      form.watch('courseMedia')?.id || ''
                                                  )) ? (
                                                <div className="mt-2 flex h-52 w-full items-center justify-center rounded-lg bg-neutral-100">
                                                    <iframe
                                                        width="100%"
                                                        height="100%"
                                                        src={`https://www.youtube.com/embed/${extractYouTubeVideoId(form.watch('courseMedia')?.id || '')}`}
                                                        title="YouTube video player"
                                                        frameBorder="0"
                                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                        allowFullScreen
                                                        className="size-full rounded-lg object-contain"
                                                    />
                                                </div>
                                            ) : (
                                                <div
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => {
                                                        setShowYoutubeInput(false);
                                                        courseMediaRef.current?.click();
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            setShowYoutubeInput(false);
                                                            courseMediaRef.current?.click();
                                                        }
                                                    }}
                                                    className="flex h-52 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 bg-neutral-50 transition-colors hover:border-primary-400 hover:bg-primary-50"
                                                >
                                                    <UploadSimple
                                                        size={40}
                                                        className="text-neutral-400"
                                                    />
                                                    <p className="text-sm font-medium text-neutral-600">
                                                        Click to upload image or video
                                                    </p>
                                                    <p className="text-xs text-neutral-400">
                                                        Image, video (MP4), or YouTube URL
                                                    </p>
                                                </div>
                                            )}
                                            {/* Pen icon and dropdown logic */}
                                            <div className="absolute bottom-2 right-2 flex flex-col items-end">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <MyButton
                                                            type="button"
                                                            disabled={uploadingStates.courseMedia}
                                                            buttonType="secondary"
                                                            layoutVariant="icon"
                                                            scale="small"
                                                            className="z-10 bg-white hover:bg-white active:bg-white"
                                                            onClick={() =>
                                                                setShowYoutubeInput(false)
                                                            }
                                                        >
                                                            <PencilSimpleLine />
                                                        </MyButton>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent
                                                        align="end"
                                                        // The edit-course dialog stacks above the
                                                        // default popover layer, so the menu needs
                                                        // the top-modal tier to stay visible there.
                                                        className="z-popover-above-top-modal w-48"
                                                    >
                                                        <DropdownMenuItem
                                                            onSelect={() =>
                                                                courseMediaRef.current?.click()
                                                            }
                                                        >
                                                            Upload Image/Video
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onSelect={() => {
                                                                // Pre-fill with the existing link so
                                                                // an already-saved YouTube URL can be
                                                                // edited in place instead of retyped.
                                                                const cm =
                                                                    form.getValues('courseMedia');
                                                                const existing =
                                                                    cm?.id &&
                                                                    (cm?.type === 'youtube' ||
                                                                        extractYouTubeVideoId(
                                                                            cm.id
                                                                        ))
                                                                        ? cm.id
                                                                        : '';
                                                                setYoutubeUrl(existing);
                                                                setYoutubeError('');
                                                                setShowYoutubeInput(true);
                                                            }}
                                                        >
                                                            YouTube Link
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                                {showYoutubeInput && (
                                                    <div
                                                        ref={youtubeInputRef}
                                                        className="z-20 mt-2 w-64 rounded-md border border-neutral-200 bg-white p-4 shadow-lg"
                                                    >
                                                        <label className="mb-1 block text-sm font-medium text-neutral-700">
                                                            Paste YouTube Link
                                                        </label>
                                                        <Input
                                                            type="text"
                                                            placeholder="https://youtube.com/watch?v=..."
                                                            value={youtubeUrl || ''}
                                                            onChange={(e) => {
                                                                setYoutubeUrl(e.target.value);
                                                                setYoutubeError('');
                                                            }}
                                                            className="mb-2"
                                                        />
                                                        {youtubeError && (
                                                            <div className="mb-2 text-xs text-red-500">
                                                                {youtubeError}
                                                            </div>
                                                        )}
                                                        <MyButton
                                                            buttonType="primary"
                                                            scale="medium"
                                                            layoutVariant="default"
                                                            className="w-full"
                                                            onClick={() => {
                                                                const id =
                                                                    extractYouTubeVideoId(
                                                                        youtubeUrl
                                                                    );
                                                                if (!id) {
                                                                    setYoutubeError(
                                                                        'Invalid YouTube link'
                                                                    );
                                                                    return;
                                                                }
                                                                form.setValue('courseMedia', {
                                                                    type: 'youtube',
                                                                    id: youtubeUrl,
                                                                });
                                                                form.setValue(
                                                                    'courseMediaBlob',
                                                                    youtubeUrl
                                                                );
                                                                setShowYoutubeInput(false);
                                                            }}
                                                            disable={!youtubeUrl}
                                                        >
                                                            Save YouTube Link
                                                        </MyButton>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Always render the FileUploadComponent, but hide it visually */}
                                            <div style={{ display: 'none' }}>
                                                <FileUploadComponent
                                                    fileInputRef={courseMediaRef}
                                                    onFileSubmit={(file) =>
                                                        handleFileSelectedWithCrop(
                                                            file,
                                                            'courseMedia'
                                                        )
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
                                        {/* Remove button for course media */}
                                        {(form.watch('courseMedia')?.id ||
                                            form.watch('courseMedia')?.type === 'youtube') && (
                                            <button
                                                type="button"
                                                onClick={removeCourseMedia}
                                                className="mt-1 inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600 hover:underline"
                                            >
                                                <X className="size-3" />
                                                Remove media
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="mt-8">
                            <CoursePageSection
                                form={form}
                                courseTerm={courseTerm}
                                status={coursePageStatus}
                                open={coursePageOpen}
                                onOpenChange={setCoursePageOpen}
                            />
                        </div>
                    </div>
                </div>

                {/* Fixed Footer */}
                <div className="sticky bottom-0 mt-auto border-t bg-white px-8 py-4 shadow-sm">
                    <div className="flex justify-end">
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            layoutVariant="default"
                            scale="large"
                            id="next-button"
                            className="px-8"
                            disable={isNextDisabled}
                        >
                            Next
                        </MyButton>
                    </div>
                </div>
            </form>
            <ImageCropperDialog
                open={isCropperOpen}
                onOpenChange={setIsCropperOpen}
                src={cropperSrc}
                aspectRatio={cropperAspect}
                title="Crop Image"
                outputMimeType={cropOutputType.current}
                onCropped={(file) => handleFileUpload(file, cropTargetField.current)}
            />
        </Form>
    );
};
