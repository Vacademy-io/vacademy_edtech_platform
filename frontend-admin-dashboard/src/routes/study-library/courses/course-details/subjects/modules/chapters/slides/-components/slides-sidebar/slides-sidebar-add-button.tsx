import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
('use client');

import { MyButton } from '@/components/design-system/button';
import { Lightning } from '@phosphor-icons/react';
import { MyDropdown } from '@/components/design-system/dropdown';
import {
    Plus,
    FilePdf,
    FileDoc,
    YoutubeLogo,
    Question,
    PresentationChart,
    Code,
    BookOpen,
    MusicNotes,
    Package,
    Sparkle,
} from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { AddVideoDialog } from './add-video-dialog';
import { AddVimeoDialog } from './add-vimeo-dialog';
import { AddVideoFileDialog } from './add-video-file-dialog';
import { AddDocDialog } from './add-doc-dialog';
import { AddPdfDialog } from './add-pdf-dialog';
import { AddPptDialog } from './add-ppt-dialog';
import { AddAudioDialog } from './add-audio-dialog';
import { AddScormDialog } from './add-scorm-dialog';
import { AddAssessmentSlideDialog } from './add-assessment-slide-dialog';
import { AddAiVideoDialog } from './ai-video/add-ai-video-dialog';
import { ListChecks } from '@phosphor-icons/react';
import { useRouter } from '@tanstack/react-router';
import {
    useSlidesMutations,
    Slide,
} from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import { useDialogStore } from '@/routes/study-library/courses/-stores/slide-add-dialogs-store';
import { File, GameController, ClipboardText } from '@phosphor-icons/react';
import { formatHTMLString } from '../slide-operations/formatHtmlString';
import { EMPTY_LEXICAL_INNER } from '../lexical-editor/lexical-doc-marker';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import {
    buildAppendReorderPayload,
    generateUniqueDocumentSlideTitle,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';
import { toast } from 'sonner';
import {
    createAssignmentSlidePayload,
    createQuizSlidePayload,
} from '../yoopta-editor-customizations/createAssignmentSlidePayload';
import { createPresentationSlidePayload } from '../create-presentation-slide';
import AddQuestionDialog from './add-question-dialog';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type DisplaySettingsData } from '@/types/display-settings';
import { getDisplaySettings, getDisplaySettingsFromCache } from '@/services/display-settings';

// Simple utility function for setting first slide as active (used as fallback)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const setFirstSlideAsActive = (setActiveItem: (slide: any) => void, items: any[]) => {
    if (items && items.length > 0) {
        setActiveItem(items[0]);
    }
};

export const ChapterSidebarAddButton = () => {
    const { t } = useTranslation('slideAddMenu');
    // Load role display settings to enforce slide-type availability
    const [roleDisplay, setRoleDisplay] = useState<DisplaySettingsData | null>(null);
    useEffect(() => {
        const roleKey = getActiveRoleDisplaySettingsKey();
        const cached = getDisplaySettingsFromCache(roleKey);
        if (cached) {
            setRoleDisplay(cached);
            return;
        }
        getDisplaySettings(roleKey)
            .then(setRoleDisplay)
            .catch(() => setRoleDisplay(null));
    }, []);
    const route = useRouter();
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } =
        route.state.location.search;
    const {
        addUpdateDocumentSlide,
        addUpdateAssignmentSlide,
        addUpdateQuizSlide,
        updateSlideOrder,
    } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );

    const { items, setActiveItem, setAssessmentCreateMode } = useContentStore();

    // Use the Zustand store instead of useState
    const {
        isPdfDialogOpen,
        isDocUploadDialogOpen,
        isVideoDialogOpen,
        isVideoFileDialogOpen,
        isQuestionDialogOpen,
        isAudioDialogOpen,
        isPptDialogOpen,
        isScormDialogOpen,
        isAssessmentDialogOpen,

        openPdfDialog,
        closePdfDialog,
        openDocUploadDialog,
        closeDocUploadDialog,
        openVideoDialog,
        closeVideoDialog,
        openVideoFileDialog,
        closeVideoFileDialog,
        openQuestionDialog,
        closeQuestionDialog,
        openAudioDialog,
        closeAudioDialog,
        openPptDialog,
        closePptDialog,
        openScormDialog,
        closeScormDialog,
        openAssessmentDialog,
        closeAssessmentDialog,
        isVimeoDialogOpen,
        openVimeoDialog,
        closeVimeoDialog,
        isAiVideoDialogOpen,
        openAiVideoDialog,
        closeAiVideoDialog,
    } = useDialogStore();

    // Function to reorder slides after adding a new one at the bottom
    const reorderSlidesAfterNewSlide = async (newSlideId: string) => {
        try {
            const currentSlides = items || [];
            const newSlide = currentSlides.find((slide) => slide.id === newSlideId);

            if (!newSlide) return;

            const reorderedSlides = buildAppendReorderPayload(newSlideId, currentSlides);

            await updateSlideOrder({
                chapterId: chapterId || '',
                slideOrderPayload: reorderedSlides,
            });
        } catch (error) {
            console.error('Error reordering slides:', error);
            toast.error(t('toasts.reorderFailed'));
        }
    };

    const dropdownList = useMemo(
        () => [
            {
                label: t('menu.quickAdd.label'),
                value: 'quick-add',
                icon: <Plus className="size-4 text-primary-500" />,
                description: t('menu.quickAdd.description'),
            },
            {
                label: t('menu.pdf.label'),
                value: 'pdf',
                icon: <FilePdf className="size-4 text-red-500" />,
                description: t('menu.pdf.description'),
            },
            {
                label: t('menu.ppt.label'),
                value: 'ppt',
                icon: <PresentationChart className="size-4 text-orange-500" />,
                description: t('menu.ppt.description'),
            },
            {
                label: t('menu.doc.label'),
                value: 'doc',
                icon: <FileDoc className="size-4 text-blue-600" />,
                description: t('menu.doc.description'),
                subItems: [
                    {
                        label: t('menu.uploadDoc.label'),
                        value: 'upload-doc',
                        description: t('menu.uploadDoc.description'),
                    },
                    {
                        label: t('menu.createDocLexical.label'),
                        value: 'create-doc-lexical',
                        description: t('menu.createDocLexical.description'),
                    },
                    {
                        label: t('menu.createHtmlDoc.label'),
                        value: 'create-html-doc',
                        description: t('menu.createHtmlDoc.description'),
                    },
                    {
                        label: t('menu.createDocLegacy.label'),
                        value: 'create-doc',
                        description: t('menu.createDocLegacy.description'),
                    },
                ],
            },
            {
                label: t('menu.video.label'),
                value: 'video',
                icon: <YoutubeLogo className="size-4 text-green-500" />,
                description: t('menu.video.description'),
                subItems: [
                    {
                        label: t('menu.uploadVideo.label'),
                        value: 'upload-video',
                        description: t('menu.uploadVideo.description'),
                    },
                    {
                        label: t('menu.youtubeVideo.label'),
                        value: 'youtube-video',
                        description: t('menu.youtubeVideo.description'),
                    },
                    {
                        label: t('menu.vimeoVideo.label'),
                        value: 'vimeo-video',
                        description: t('menu.vimeoVideo.description'),
                    },
                    {
                        label: t('menu.generateAiVideo.label'),
                        value: 'generate-ai-video',
                        description: t('menu.generateAiVideo.description'),
                    },
                ],
            },
            {
                label: t('menu.aiVideo.label'),
                value: 'ai-video',
                icon: <Sparkle className="size-4 text-primary-500" weight="fill" />,
                description: t('menu.aiVideo.description'),
            },
            {
                label: t('menu.question.label'),
                value: 'question',
                icon: <Question className="size-4 text-purple-500" />,
                description: t('menu.question.description'),
            },
            {
                label: t('menu.assignment.label'),
                value: 'assignment',
                icon: <File className="size-4 text-blue-500" />,
                description: t('menu.assignment.description'),
            },
            {
                label: t('menu.presentation.label'),
                value: 'presentation',
                icon: <PresentationChart className="size-4 text-orange-500" />,
                description: t('menu.presentation.description'),
            },
            {
                label: t('menu.jupyterNotebook.label'),
                value: 'jupyter-notebook',
                icon: <BookOpen className="size-4 text-violet-500" />,
                description: t('menu.jupyterNotebook.description'),
            },
            {
                label: t('menu.scratchProject.label'),
                value: 'scratch-project',
                icon: <GameController className="size-4 text-yellow-500" />,
                description: t('menu.scratchProject.description'),
            },
            {
                label: t('menu.quiz.label'),
                value: 'quiz',
                icon: <ClipboardText className="size-4 text-pink-500" />, // ✅ Changed to ListChecks
                description: t('menu.quiz.description'),
            },
            {
                label: t('menu.audio.label'),
                value: 'audio',
                icon: <MusicNotes className="size-4 text-indigo-500" />,
                description: t('menu.audio.description'),
            },
            {
                label: t('menu.codeEditor.label'),
                value: 'code-editor',
                icon: <Code className="size-4 text-green-500" />,
                description: t('menu.codeEditor.description'),
            },
            {
                label: t('menu.scorm.label'),
                value: 'scorm',
                icon: <Package className="size-4 text-teal-500" />,
                description: t('menu.scorm.description'),
            },
            {
                label: t('menu.assessment.label'),
                value: 'assessment',
                icon: <ListChecks className="size-4 text-rose-500" />,
                description: t('menu.assessment.description'),
                subItems: [
                    {
                        label: t('menu.linkAssessment.label'),
                        value: 'link-assessment',
                        description: t('menu.linkAssessment.description'),
                    },
                    {
                        label: t('menu.createAssessment.label'),
                        value: 'create-assessment',
                        description: t('menu.createAssessment.description'),
                    },
                ],
            },
        ],
        // The catalog loads async, so the first render resolves every label to
        // its raw key. Without t here the memo freezes those keys forever.
        [t]
    );

    const filteredDropdownList = useMemo(() => {
        // Display Settings → Assessment Actions can turn off assessment creation
        // for this role. Drop the in-slide "Create new assessment" option when it
        // does; "Link existing assessment" stays, since linking isn't creating.
        const base: typeof dropdownList =
            roleDisplay?.assessmentPage?.showCreateAssessment !== false
                ? dropdownList
                : dropdownList.map((item) => {
                      if (item.subItems && item.subItems.length > 0) {
                          return {
                              ...item,
                              subItems: item.subItems.filter(
                                  (s) => s.value !== 'create-assessment'
                              ),
                          };
                      }
                      return item;
                  });
        const ct = roleDisplay?.contentTypes;
        if (!ct) return base;
        const isAllowed = (val: string): boolean => {
            switch (val) {
                case 'pdf':
                    return ct.pdf !== false;
                case 'ppt':
                    return ct.ppt !== false;
                case 'doc':
                case 'upload-doc':
                case 'create-doc':
                case 'create-doc-lexical':
                    return ct.document !== false;
                case 'video':
                case 'upload-video':
                case 'youtube-video':
                case 'vimeo-video':
                case 'ai-video':
                case 'generate-ai-video':
                    return ct.video?.enabled !== false;
                case 'question':
                    return ct.question !== false;
                case 'assignment':
                    return ct.assignment !== false;
                case 'jupyter-notebook':
                    return ct.jupyterNotebook !== false;
                case 'scratch-project':
                    return ct.scratch !== false;
                case 'quiz':
                    return ct.quiz !== false;
                case 'code-editor':
                    return ct.codeEditor !== false;
                case 'audio':
                    return ct.audio !== false;
                case 'scorm':
                    return ct.scorm !== false;
                case 'assessment':
                case 'link-assessment':
                case 'create-assessment':
                    return ct.assessment !== false;
                // presentation treated as a document-type control
                case 'presentation':
                    return ct.document !== false;
                default:
                    return true;
            }
        };
        return base
            .map((item) => {
                if (!isAllowed(item.value)) return null;
                if (item.subItems && item.subItems.length > 0) {
                    const sub = item.subItems.filter((s) => isAllowed(s.value));
                    return { ...item, subItems: sub };
                }
                return item;
            })
            .filter(Boolean) as typeof dropdownList;
    }, [roleDisplay?.contentTypes, roleDisplay?.assessmentPage, dropdownList]);

    const handleSelect = async (value: string) => {
        switch (value) {
            case 'quick-add': {
                const s = route.state.location.search as Record<string, unknown>;
                const search = {
                    courseId: String(s.courseId || ''),
                    levelId: String(s.levelId || ''),
                    subjectId: String(s.subjectId || ''),
                    moduleId: String(s.moduleId || ''),
                    chapterId: String(s.chapterId || ''),
                    slideId: String(s.slideId || ''),
                    sessionId: String(s.sessionId || ''),
                    ...(typeof s.timestamp === 'number'
                        ? { timestamp: s.timestamp as number }
                        : {}),
                    ...(typeof s.currentPage === 'number'
                        ? { currentPage: s.currentPage as number }
                        : {}),
                    quickAdd: true,
                };
                route.navigate({
                    to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
                    search,
                });
                break;
            }
            case 'pdf':
                openPdfDialog();
                break;
            case 'ppt':
                openPptDialog();
                break;
            case 'upload-doc':
                openDocUploadDialog();
                break;
            // New documents open in the Lexical editor; the data-editor="lexical"
            // marker inside the stored HTML is what routes the slide to it
            // (document_slide.type stays 'DOC' — see lexical-doc-marker.ts).
            case 'create-doc-lexical': {
                try {
                    const documentData = formatHTMLString(EMPTY_LEXICAL_INNER);
                    const slideId = crypto.randomUUID();
                    const uniqueTitle = generateUniqueDocumentSlideTitle(items || [], 'DOC');
                    const slideStatus = getSlideStatusForUser();
                    const response = await addUpdateDocumentSlide({
                        id: slideId,
                        title: uniqueTitle,
                        image_file_id: '',
                        description: '',
                        slide_order: getNextSlideOrder(items || []),
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'DOC',
                            data: documentData,
                            title: uniqueTitle,
                            cover_file_id: '',
                            total_pages: 1,
                            // Auto-published roles need the marker in published_data
                            // too — editor routing checks every content source.
                            published_data: slideStatus === 'PUBLISHED' ? documentData : null,
                            published_document_total_pages: 1,
                        },
                        status: slideStatus,
                        new_slide: true,
                        notify: false,
                    });

                    if (response) {
                        await reorderSlidesAfterNewSlide(slideId);
                    }
                } catch (err) {
                    console.error('Error creating new doc:', err);
                    toast.error(t('toasts.createDocFailed'));
                }
                break;
            }
            case 'create-doc': {
                try {
                    const documentData = formatHTMLString('');
                    const slideId = crypto.randomUUID();
                    const uniqueTitle = generateUniqueDocumentSlideTitle(items || [], 'DOC');
                    const slideStatus = getSlideStatusForUser();
                    const response = await addUpdateDocumentSlide({
                        id: slideId,
                        title: uniqueTitle,
                        image_file_id: '',
                        description: '',
                        slide_order: getNextSlideOrder(items || []),
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'DOC',
                            data: documentData,
                            title: uniqueTitle,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: slideStatus === 'PUBLISHED' ? documentData : null,
                            published_document_total_pages: 1,
                        },
                        status: slideStatus,
                        new_slide: true,
                        notify: false,
                    });

                    if (response) {
                        // Reorder slides and set as active
                        await reorderSlidesAfterNewSlide(slideId);
                    }
                } catch (err) {
                    console.error('Error creating new doc:', err);
                    toast.error(t('toasts.createDocFailed'));
                }
                break;
            }
            case 'create-html-doc': {
                // The Tiptap-based document type: data is plain HTML (no Yoopta
                // wrapper), edited with the new editor. Coexists with 'DOC'.
                try {
                    const slideId = crypto.randomUUID();
                    const uniqueTitle = generateUniqueDocumentSlideTitle(items || [], 'HTML');
                    const slideStatus = getSlideStatusForUser();
                    const response = await addUpdateDocumentSlide({
                        id: slideId,
                        title: uniqueTitle,
                        image_file_id: '',
                        description: '',
                        slide_order: getNextSlideOrder(items || []),
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'HTML',
                            data: '',
                            title: uniqueTitle,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: null,
                            published_document_total_pages: 1,
                        },
                        status: slideStatus,
                        new_slide: true,
                        notify: false,
                    });

                    if (response) {
                        await reorderSlidesAfterNewSlide(slideId);
                    }
                } catch (err) {
                    console.error('Error creating new HTML doc:', err);
                    toast.error(t('toasts.createDocFailed'));
                }
                break;
            }
            case 'youtube-video':
                openVideoDialog();
                break;
            case 'vimeo-video':
                openVimeoDialog();
                break;
            case 'ai-video':
            case 'generate-ai-video':
                openAiVideoDialog();
                break;
            case 'upload-video':
                openVideoFileDialog(); // Open the new video file upload dialog
                break;
            case 'question':
                openQuestionDialog();
                break;
            case 'assignment': {
                try {
                    const payload = createAssignmentSlidePayload(items || []);

                    const response = await addUpdateAssignmentSlide(payload);

                    if (response) {
                        await reorderSlidesAfterNewSlide(payload.id || '');
                        toast.success(t('toasts.assignmentCreated'));
                    } else {
                        throw new Error('Empty response returned from API.');
                    }
                } catch (err) {
                    console.error('❌ Error creating assignment:', err);
                    toast.error((err as Error)?.message || t('toasts.assignmentCreateFailedRetry'));
                }
                break;
            }

            case 'presentation': {
                try {
                    // Create a new presentation slide payload
                    const slideTypeObj = {
                        id: crypto.randomUUID(),
                        name: 'Text',
                        slides: null,
                    };
                    const payload = createPresentationSlidePayload(slideTypeObj, items || []);
                    payload.slide_order = getNextSlideOrder(items || []);

                    const response = await addUpdateDocumentSlide(payload);

                    if (response) {
                        // Initialize empty Excalidraw data in localStorage
                        const excalidrawData = {
                            isExcalidraw: true,
                            elements: [],
                            files: {},
                            appState: {
                                viewBackgroundColor: '#ffffff', // design-lint-ignore: Excalidraw appState takes a CSS colour string, not a token
                                gridSize: null,
                            },
                            lastModified: Date.now(),
                        };
                        localStorage.setItem(
                            `excalidraw_${payload.id}`,
                            JSON.stringify(excalidrawData)
                        );

                        // Reorder slides and set as active
                        await reorderSlidesAfterNewSlide(payload?.id || '');
                    }
                } catch (err) {
                    console.error('Error creating new presentation:', err);
                    toast.error(t('toasts.presentationCreateFailed'));
                }
                break;
            }

            case 'jupyter-notebook': {
                try {
                    // Create a Jupyter notebook slide as a document with special type
                    const slideId = crypto.randomUUID();
                    const uniqueTitle = generateUniqueDocumentSlideTitle(items || [], 'JUPYTER');
                    const slideStatus = getSlideStatusForUser();
                    const jupyterData = JSON.stringify({
                        projectName: '',
                        contentUrl: '',
                        contentBranch: 'main',
                        notebookLocation: 'root',
                        activeTab: 'settings',
                        editorType: 'jupyterEditor',
                        timestamp: Date.now(),
                    });
                    const response = await addUpdateDocumentSlide({
                        id: slideId,
                        title: uniqueTitle,
                        image_file_id: '',
                        description: 'Interactive Jupyter notebook environment',
                        slide_order: getNextSlideOrder(items || []),
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'JUPYTER',
                            data: jupyterData,
                            title: uniqueTitle,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: slideStatus === 'PUBLISHED' ? jupyterData : null,
                            published_document_total_pages: 1,
                        },
                        status: slideStatus,
                        new_slide: true,
                        notify: false,
                    });

                    if (response) {
                        // Reorder slides and set as active
                        await reorderSlidesAfterNewSlide(slideId);
                    }
                } catch (err) {
                    console.error('Error creating Jupyter notebook:', err);
                    toast.error(t('toasts.jupyterCreateFailed'));
                }
                break;
            }
            case 'scratch-project': {
                try {
                    // Create a Scratch project slide as a document with special type
                    const slideId = crypto.randomUUID();
                    const uniqueTitle = generateUniqueDocumentSlideTitle(items || [], 'SCRATCH');
                    const slideStatus = getSlideStatusForUser();
                    const scratchData = JSON.stringify({
                        projectId: '',
                        scratchUrl: '',
                        embedType: 'project',
                        autoStart: false,
                        hideControls: false,
                        editorType: 'scratchEditor',
                        timestamp: Date.now(),
                    });
                    const response = await addUpdateDocumentSlide({
                        id: slideId,
                        title: uniqueTitle,
                        image_file_id: '',
                        description: 'Interactive Scratch programming environment',
                        slide_order: getNextSlideOrder(items || []),
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'SCRATCH',
                            data: scratchData,
                            title: uniqueTitle,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: slideStatus === 'PUBLISHED' ? scratchData : null,
                            published_document_total_pages: 1,
                        },
                        status: slideStatus,
                        new_slide: true,
                        notify: false,
                    });

                    if (response) {
                        // Reorder slides and set as active
                        await reorderSlidesAfterNewSlide(slideId);
                    }
                } catch (err) {
                    console.error('Error creating Scratch project:', err);
                    toast.error(t('toasts.scratchCreateFailed'));
                }
                break;
            }
            case 'code-editor': {
                try {
                    // Create a code editor slide as a document with special type
                    const slideId = crypto.randomUUID();
                    const uniqueTitle = generateUniqueDocumentSlideTitle(items || [], 'CODE');
                    // Auto-publish code slides on creation
                    const codeData = JSON.stringify({
                        language: 'python',
                        theme: 'dark',
                        code: '# Welcome to Python Code Editor\nprint("Hello, World!")',
                        readOnly: false,
                        showLineNumbers: true,
                        fontSize: 14,
                        editorType: 'codeEditor',
                        timestamp: Date.now(),
                    });
                    const response = await addUpdateDocumentSlide({
                        id: slideId,
                        title: uniqueTitle,
                        image_file_id: '',
                        description: 'Interactive code editing environment',
                        slide_order: getNextSlideOrder(items || []),
                        document_slide: {
                            id: crypto.randomUUID(),
                            type: 'CODE',
                            data: codeData,
                            title: uniqueTitle,
                            cover_file_id: '',
                            total_pages: 1,
                            published_data: codeData,
                            published_document_total_pages: 1,
                        },
                        status: 'PUBLISHED',
                        new_slide: true,
                        notify: false,
                    });

                    if (response) {
                        // Trigger approval button visibility for auto-published slide
                        localStorage.setItem('triggerApprovalButton', Date.now().toString());
                        toast.success(t('toasts.slideAutoPublished'));
                        // Reorder slides and set as active
                        await reorderSlidesAfterNewSlide(slideId);
                    }
                } catch (err) {
                    console.error('Error creating code editor:', err);
                    toast.error(t('toasts.codeCreateFailed'));
                }
                break;
            }

            case 'quiz': {
                try {
                    const payload = createQuizSlidePayload(items || []);

                    const response = await addUpdateQuizSlide(payload);

                    if (response) {
                        await reorderSlidesAfterNewSlide(payload.id || '');

                        // Set the newly created quiz as active
                        const newQuizSlide: Slide = {
                            id: payload.id || '',
                            source_id: payload.source_id || '',
                            source_type: 'QUIZ',
                            title: payload.title,
                            image_file_id: payload.image_file_id || '',
                            description: payload.description,
                            status: payload.status,
                            slide_order: payload.slide_order ?? 0,
                            video_slide: null,
                            document_slide: null,
                            question_slide: null,
                            assignment_slide: null,
                            quiz_slide: payload.quiz_slide,
                            is_loaded: true,
                            new_slide: true,
                        };

                        setActiveItem(newQuizSlide);
                        toast.success(t('toasts.quizCreated'));
                    } else {
                        throw new Error('Empty response returned from API.');
                    }
                } catch (err) {
                    console.error('❌ Error creating quiz:', err);
                    toast.error((err as Error)?.message || t('toasts.quizCreateFailedRetry'));
                }
                break;
            }

            case 'audio':
                openAudioDialog();
                break;

            case 'scorm':
                openScormDialog();
                break;

            case 'assessment':
            case 'link-assessment':
                openAssessmentDialog();
                break;

            case 'create-assessment':
                // Render the in-slide create form (clears any active slide so the
                // form takes over the content area).
                setActiveItem(null);
                setAssessmentCreateMode(true);
                break;
        }
    };

    // Per-role visibility: when an admin hides "Add Slide" for this role from
    // Display Settings → Course Page, hide the entire add-slide control so the
    // role cannot add slides from inside a chapter either.
    if (roleDisplay?.coursePage?.showAddSlide === false) {
        return null;
    }

    return (
        <div className="w-full px-1 duration-500 animate-in fade-in slide-in-from-top-2">
            <div className="flex w-full items-center gap-2">
                <div className="min-w-0 flex-1">
                    <MyDropdown dropdownList={filteredDropdownList} onSelect={handleSelect}>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            className={`
                                group relative h-9 w-full min-w-0
                                overflow-hidden border-0 bg-gradient-to-r from-primary-400
                                to-primary-400 px-3
                                shadow-md shadow-primary-500/20
                                transition-all duration-300 ease-in-out
                                hover:scale-[1.01] hover:from-primary-400
                                hover:to-primary-400 hover:shadow-lg
                                hover:shadow-primary-500/25 active:scale-[0.99] sm:min-w-0
                            `}
                            id="add-slides"
                            title={t('addSlideButtonTitle')}
                        >
                            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-white/0 via-white/20 to-white/0 transition-transform duration-700 ease-out group-hover:translate-x-full" />

                            <div className="relative z-10 flex items-center justify-center gap-1.5">
                                <Plus className="size-4 transition-all duration-300 ease-in-out group-hover:rotate-90 group-hover:scale-110" />
                                <span className="truncate text-sm font-medium tracking-wide">
                                    {t('addSlide')}
                                </span>
                            </div>
                        </MyButton>
                    </MyDropdown>
                </div>
                <div className="shrink-0">
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        className="flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap px-3 sm:min-w-0"
                        title={t('quickAddButtonTitle')}
                        onClick={() => {
                            const s = route.state.location.search as Record<string, unknown>;
                            const search = {
                                courseId: String(s.courseId || ''),
                                levelId: String(s.levelId || ''),
                                subjectId: String(s.subjectId || ''),
                                moduleId: String(s.moduleId || ''),
                                chapterId: String(s.chapterId || ''),
                                slideId: String(s.slideId || ''),
                                sessionId: String(s.sessionId || ''),
                                ...(typeof s.timestamp === 'number'
                                    ? { timestamp: s.timestamp as number }
                                    : {}),
                                ...(typeof s.currentPage === 'number'
                                    ? { currentPage: s.currentPage as number }
                                    : {}),
                                quickAdd: true,
                            };
                            route.navigate({
                                to: '/study-library/courses/course-details/subjects/modules/chapters/slides',
                                search,
                            });
                        }}
                        id="quick-add-fast"
                    >
                        <Lightning className="size-4 shrink-0" />
                        <span className="text-sm font-medium">{t('quickAdd')}</span>
                    </MyButton>
                </div>
            </div>

            {/* Enhanced Dialog Components with consistent styling */}
            <MyDialog
                trigger={<></>}
                heading={t('dialogs.uploadPdf')}
                dialogWidth="min-w-slide-dialog-sm w-auto"
                open={isPdfDialogOpen}
                onOpenChange={closePdfDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddPdfDialog openState={(open) => !open && closePdfDialog()} />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.uploadDoc')}
                dialogWidth="min-w-slide-dialog-sm w-auto"
                open={isDocUploadDialogOpen}
                onOpenChange={closeDocUploadDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddDocDialog openState={(open) => !open && closeDocUploadDialog()} />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.addYoutubeVideo')}
                dialogWidth="min-w-slide-dialog-sm"
                open={isVideoDialogOpen}
                onOpenChange={closeVideoDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddVideoDialog openState={(open) => !open && closeVideoDialog()} />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.uploadVideoFile')}
                dialogWidth="min-w-slide-dialog-sm"
                open={isVideoFileDialogOpen}
                onOpenChange={closeVideoFileDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddVideoFileDialog openState={(open) => !open && closeVideoFileDialog()} />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.createQuestion')}
                dialogWidth="min-w-slide-dialog-md"
                open={isQuestionDialogOpen}
                onOpenChange={closeQuestionDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddQuestionDialog openState={(open) => !open && closeQuestionDialog()} />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.addAudioSlide')}
                dialogWidth="min-w-slide-dialog-md"
                open={isAudioDialogOpen}
                onOpenChange={closeAudioDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddAudioDialog openState={(open) => !open && closeAudioDialog()} />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.uploadPpt')}
                dialogWidth="min-w-slide-dialog-sm w-auto"
                open={isPptDialogOpen}
                onOpenChange={closePptDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddPptDialog openState={(open) => !open && closePptDialog()} />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.importScorm')}
                dialogWidth="min-w-slide-dialog-sm w-auto"
                open={isScormDialogOpen}
                onOpenChange={closeScormDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddScormDialog openState={(open) => !open && closeScormDialog()} />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.linkAssessment')}
                dialogWidth="min-w-slide-dialog-lg w-auto"
                open={isAssessmentDialogOpen}
                onOpenChange={closeAssessmentDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddAssessmentSlideDialog
                        openState={(open) => !open && closeAssessmentDialog()}
                    />
                </div>
            </MyDialog>

            <MyDialog
                trigger={<></>}
                heading={t('dialogs.addVimeoVideo')}
                dialogWidth="min-w-slide-dialog-sm"
                open={isVimeoDialogOpen}
                onOpenChange={closeVimeoDialog}
            >
                <div className="duration-300 animate-in fade-in slide-in-from-bottom-4">
                    <AddVimeoDialog openState={(open) => !open && closeVimeoDialog()} />
                </div>
            </MyDialog>

            <AddAiVideoDialog
                open={isAiVideoDialogOpen}
                onOpenChange={(open) => !open && closeAiVideoDialog()}
            />
        </div>
    );
};
