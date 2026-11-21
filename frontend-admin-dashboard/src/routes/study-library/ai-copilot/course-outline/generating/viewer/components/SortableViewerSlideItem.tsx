import React, { useState, useEffect, useId, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    GripVertical,
    Edit2,
    X,
    CheckCircle,
    Trash2,
    Loader2,
    FileText,
    Video,
    Code,
    FileQuestion,
    RefreshCw,
    Link,
    Upload,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import Editor from '@monaco-editor/react';
// import { YooptaEditorWrapperSafe as YooptaEditorWrapper } from '../../../../shared/components'; // Removed - using local viewer
import { MyButton } from '@/components/design-system/button';
import {
    processDocumentContent,
    parseCodeContent,
    cleanQuizContent,
    parseVideoContent,
} from '../utils/contentParsers';
import { markdownToHtml } from '../../../../shared/utils/markdownToHtml';
import type { SlideGeneration, SlideType, QuizQuestion } from '../../../../shared/types';
import { AIVideoPlayer } from '@/components/ai-video-player';
import { cn } from '@/lib/utils';
import { HtmlSlidePreview } from '@/components/html-slide/html-slide-preview';


// Read-only viewer for AI-generated document content. Content is now creative,
// self-contained HTML, so render it in a sandboxed iframe (animations, custom
// styling and scripts all run, isolated from the app).
const HtmlContentViewer = ({ content, className }: { content: string; className?: string }) => (
    <div className={cn('w-full', className)}>
        <HtmlSlidePreview html={content} />
    </div>
);


interface SortableSlideItemProps {
    slide: SlideGeneration;
    onEdit: (slideId: string, newTitle: string) => void;
    onDelete: (slideId: string) => void;
    getSlideIcon: (type: SlideType) => React.ReactNode;
    onRegenerate?: (slideId: string, section?: 'video' | 'code') => void;
    onContentEdit?: (slideId: string, newContent: string) => void;
}

export const SortableViewerSlideItem = React.memo(({ slide, onEdit, onDelete, getSlideIcon, onRegenerate, onContentEdit }: SortableSlideItemProps) => {
    const { t } = useTranslation('studyLibrarySortableViewerSlideItem');
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(slide.slideTitle);
    const [codeContent, setCodeContent] = useState('');
    const [documentContent, setDocumentContent] = useState('');
    const [splitterPosition, setSplitterPosition] = useState(50); // 50% default
    const [isResizing, setIsResizing] = useState(false);
    const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
    const [videoUrlInput, setVideoUrlInput] = useState<string>('');
    const [videoUrlDialogOpen, setVideoUrlDialogOpen] = useState(false);
    const [tempVideoUrl, setTempVideoUrl] = useState<string>('');
    const [uploadedVideoFile, setUploadedVideoFile] = useState<File | null>(null);
    const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    /* Radio groups are document-wide: every completed slide renders its quiz
     * editor at once, so a bare `correct-${qIndex}` made question 1 of slide A
     * and question 1 of slide B one group — picking an answer in one silently
     * unchecked the other. Scope the group to this slide's component instance. */
    const quizGroupId = useId();

    // Quiz-related hooks - must be defined unconditionally
    const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
    const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
    const [regeneratingSlideId, setRegeneratingSlideId] = useState<string | null>(null);
    const [regeneratingSection, setRegeneratingSection] = useState<'video' | 'code' | undefined>(undefined);
    const [regenerationPrompt, setRegenerationPrompt] = useState<string>('');
    const regenerationPromptTextareaRef = useRef<HTMLTextAreaElement>(null);
    const [regenerateWarningDialogOpen, setRegenerateWarningDialogOpen] = useState(false);
    const [pendingRegenerateSlideId, setPendingRegenerateSlideId] = useState<string | null>(null);

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: slide.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    // Initialize code content from slide content
    useEffect(() => {
        if (slide.content && (slide.slideType === 'video-code-editor' || slide.slideType === 'video-jupyter' || slide.slideType === 'video-scratch' || slide.slideType === 'topic')) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = slide.content;
            const codeBlocks = tempDiv.querySelectorAll('pre code, pre');

            // For topic slides, extract regular code (excluding mermaid)
            if (slide.slideType === 'topic') {
                let regularCode = '';
                codeBlocks.forEach((block) => {
                    const codeText = block.textContent || '';
                    const isMermaid = codeText.includes('graph') ||
                        codeText.includes('flowchart') ||
                        codeText.includes('sequenceDiagram') ||
                        codeText.includes('classDiagram');
                    if (!isMermaid && codeText.trim().length > 0) {
                        regularCode = codeText;
                    }
                });
                // Set default code if none found (for slides like "Topic 1: What is Python?")
                if (!regularCode) {
                    regularCode = '// Start writing your code here';
                }
                setCodeContent(regularCode);
            } else {
                // For video-code-editor types, extract first code block
                const codeBlock = codeBlocks[0];
                const code = codeBlock ? (codeBlock.textContent || '') : '';
                if (code) {
                    setCodeContent(code);
                }
            }
        }
    }, [slide.content, slide.slideType]);

    // Initialize document content
    useEffect(() => {
        if (slide.slideType === 'doc' || slide.slideType === 'objectives') {
            if (slide.content) {
                setDocumentContent(slide.content);
            } else {
                setDocumentContent('');
            }
        }
    }, [slide.content, slide.slideType, slide.id]);

    // Initialize quiz questions from slide content - must be called unconditionally
    useEffect(() => {
        console.log('🎯 Initializing quiz for slide:', slide.id, 'type:', slide.slideType, 'content length:', slide.content?.length);

        if ((slide.slideType === 'quiz' || slide.slideType === 'assessment' || slide.slideType === 'ASSESSMENT') && slide.content) {
            console.log('📝 Loading quiz content:', slide.content.substring(0, 200) + '...');

            try {
                // Try to parse as JSON first (assessment format or quiz format)
                const quizData = JSON.parse(slide.content);
                console.log('📊 Parsed quiz data:', quizData);

                if (quizData && quizData.questions && Array.isArray(quizData.questions)) {
                    console.log('✅ Found questions array, length:', quizData.questions.length);

                    // Check if this is assessment format (has question_number, correct_options, etc.)
                    if (quizData.questions[0] && quizData.questions[0].question_number) {
                        console.log('🔄 Converting from assessment format to quiz format');

                        // Convert from assessment format to quiz format
                        const normalizedQuestions = quizData.questions.map((q: any) => {
                            const options = q.options || [];
                            let correctAnswerIndex = 0;

                            // Find the correct answer index from correct_options
                            if (q.correct_options && q.correct_options.length > 0) {
                                const correctOptionId = q.correct_options[0];
                                correctAnswerIndex = options.findIndex((opt: any) => opt.preview_id === correctOptionId);
                                if (correctAnswerIndex === -1) correctAnswerIndex = 0;
                            }

                            return {
                                question: cleanQuizContent(q.question?.content || q.question || 'No question'),
                                options: options.map((opt: any) => cleanQuizContent(opt.content || opt)),
                                correctAnswerIndex: Number(correctAnswerIndex),
                                explanation: q.exp ? cleanQuizContent(q.exp) : undefined
                            };
                        });
                        setQuizQuestions(normalizedQuestions);
                    } else {
                        // This is already in quiz format
                        const normalizedQuestions = quizData.questions.map((q: QuizQuestion) => {
                            const options = q.options || [];
                            let correctIndex = 0;

                            // Convert to number if it's a string
                            if (q.correctAnswerIndex !== undefined && q.correctAnswerIndex !== null) {
                                const numIndex = typeof q.correctAnswerIndex === 'string'
                                    ? parseInt(q.correctAnswerIndex, 10)
                                    : q.correctAnswerIndex;

                                // Ensure it's a valid number and within bounds
                                if (typeof numIndex === 'number' && !isNaN(numIndex) && numIndex >= 0 && numIndex < options.length) {
                                    correctIndex = numIndex;
                                }
                            }

                            return {
                                question: q.question || '',
                                options: options,
                                correctAnswerIndex: Number(correctIndex)
                            };
                        });
                        setQuizQuestions(normalizedQuestions);
                    }
                } else {
                    setQuizQuestions([]);
                }
            } catch (e) {
                // If not JSON, try to parse as HTML (new document format)
                if (slide.content && slide.content.includes('<h3>') && slide.content.includes('Question')) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = slide.content;
                    const questionHeaders = tempDiv.querySelectorAll('h3');

                    if (questionHeaders.length > 0) {
                        const questions: QuizQuestion[] = [];
                        questionHeaders.forEach((header) => {
                            // Structure: h3 -> p (question) -> ol (options) -> p (correct answer)
                            const questionParagraph = header.nextElementSibling;
                            const questionText = questionParagraph?.textContent?.trim() || '';
                            const listElement = questionParagraph?.nextElementSibling;

                            if (listElement && listElement.tagName === 'OL') {
                                const options: string[] = [];
                                let correctIndex = 0;

                                // Extract options from the ordered list
                                listElement.querySelectorAll('li').forEach((li) => {
                                    const text = li.textContent?.trim() || '';
                                    if (text) {
                                        options.push(text);
                                    }
                                });

                                // Find the correct answer paragraph below the list
                                let nextElement = listElement.nextElementSibling;
                                while (nextElement) {
                                    const text = nextElement.textContent || '';
                                    if (text.includes('Correct Answer:') || text.includes('Correct Answer')) {
                                        // Extract the correct answer text
                                        const correctAnswerMatch = text.match(/Correct Answer:\s*(.+)/i);
                                        if (correctAnswerMatch && correctAnswerMatch[1]) {
                                            const correctAnswerText = correctAnswerMatch[1].trim();
                                            // Find which option matches the correct answer
                                            const foundIndex = options.findIndex(opt => opt.trim() === correctAnswerText);
                                            if (foundIndex !== -1) {
                                                correctIndex = foundIndex;
                                            }
                                        }
                                        break;
                                    }
                                    // Skip hr elements
                                    if (nextElement.tagName === 'HR') {
                                        nextElement = nextElement.nextElementSibling;
                                    } else {
                                        nextElement = nextElement.nextElementSibling;
                                    }
                                }

                                if (questionText && options.length > 0) {
                                    questions.push({
                                        question: questionText,
                                        options: options,
                                        correctAnswerIndex: correctIndex
                                    });
                                }
                            }
                        });
                        setQuizQuestions(questions);
                    } else {
                        setQuizQuestions([]);
                    }
                } else {
                    setQuizQuestions([]);
                }
            }
        } else if (slide.slideType !== 'quiz' && slide.slideType !== 'assessment' && slide.slideType !== 'ASSESSMENT') {
            // Clear quiz questions if not a quiz/assessment slide
            setQuizQuestions([]);
        }
    }, [slide.content, slide.id, slide.slideType]);

    const handleSaveEdit = () => {
        if (editValue.trim()) {
            onEdit(slide.id, editValue.trim());
            setIsEditing(false);
        }
    };

    const handleCancelEdit = () => {
        setEditValue(slide.slideTitle);
        setIsEditing(false);
    };

    const handleCodeChange = (value: string | undefined) => {
        const code = value || '';
        setCodeContent(code);
        // In a real app, you would save this to the slide content
        // For now, we'll just update the local state
    };

    const handleDocumentChange = (html: string) => {
        setDocumentContent(html);
        if (onContentEdit) {
            onContentEdit(slide.id, html);
        }
    };

    // Resizer handlers
    const resizerRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing || !resizerRef.current) return;

            const container = resizerRef.current.closest('.resizable-container') as HTMLElement;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = (x / rect.width) * 100;

            // Limit between 20% and 80%
            const clampedPercentage = Math.max(20, Math.min(80, percentage));
            setSplitterPosition(clampedPercentage);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
    }, [isResizing]);

    const renderSlideContent = () => {
        // Show loader if slide is generating
        if (slide.status === 'generating') {
            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="flex items-center justify-center gap-3 py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                        <span className="text-sm font-medium text-neutral-600">
                            {t('generating', {
                                type:
                                    slide.slideType === 'doc'
                                        ? t('contentType.document')
                                        : slide.slideType === 'quiz' ||
                                            slide.slideType === 'assessment' ||
                                            slide.slideType === 'ASSESSMENT'
                                          ? t('contentType.quiz')
                                          : slide.slideType === 'video'
                                            ? t('contentType.video')
                                            : slide.slideType === 'ai-video'
                                              ? t('contentType.aiVideo')
                                              : slide.slideType === 'ai-slides'
                                                ? t('contentType.aiSlides')
                                                : slide.slideType === 'ai-storybook'
                                                  ? t('contentType.storybook')
                                                  : t('contentType.content'),
                            })}
                        </span>
                    </div>
                </div>
            );
        }

        if (!slide.content) {
            return <div className="text-center text-neutral-500 py-8">{t('noContentAvailable')}</div>;
        }

        const { slideType, content } = slide;

        // Topic pages - always render as video + code (especially "Topic 1: What is Python?")
        if (slideType === 'topic') {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = content;
            const codeBlocks = tempDiv.querySelectorAll('pre code, pre');

            // Check if topic has code blocks (excluding mermaid)
            let hasRegularCode = false;
            let regularCode = '';
            codeBlocks.forEach((block) => {
                const codeText = block.textContent || '';
                const isMermaid = codeText.includes('graph') ||
                    codeText.includes('flowchart') ||
                    codeText.includes('sequenceDiagram') ||
                    codeText.includes('classDiagram');
                if (!isMermaid && codeText.trim().length > 0) {
                    hasRegularCode = true;
                    if (!regularCode) {
                        regularCode = codeText;
                    }
                }
            });

            // Always render topic slides as video + code
            // If no code is found, use default placeholder code
            if (!regularCode) {
                regularCode = '// Start writing your code here';
            }

            // Extract video script (everything except regular code blocks)
            const scriptDiv = document.createElement('div');
            scriptDiv.innerHTML = content;
            const scriptCodeBlocks = scriptDiv.querySelectorAll('pre code, pre');
            scriptCodeBlocks.forEach((block) => {
                const codeText = block.textContent || '';
                const isMermaid = codeText.includes('graph') ||
                    codeText.includes('flowchart') ||
                    codeText.includes('sequenceDiagram') ||
                    codeText.includes('classDiagram');
                if (!isMermaid) {
                    const parent = block.parentElement;
                    if (parent && parent.tagName === 'PRE') {
                        parent.remove();
                    } else {
                        block.remove();
                    }
                }
            });
            const scriptHtml = scriptDiv.innerHTML.trim();

            // Initialize video URL from content
            useEffect(() => {
                if (slide.content) {
                    // Check for uploaded video reference first
                    const uploadedVideoMatch = slide.content.match(/\[UPLOADED_VIDEO:([^\]]+)\]/);
                    if (uploadedVideoMatch) {
                        // If there's an uploaded video reference, we'd need to restore it
                        // For now, we'll just clear URL input since uploaded videos are handled separately
                        setVideoUrlInput('');
                        // Note: In a real app, you'd restore the file from storage
                    } else {
                        // Check for YouTube video URL in content
                        const youtubeMatch = slide.content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                        if (youtubeMatch) {
                            setVideoUrlInput(`https://www.youtube.com/watch?v=${youtubeMatch[1]}`);
                            setUploadedVideoUrl(''); // Clear uploaded video if URL is found
                        } else {
                            // Check if there's already an embed URL or other video URL
                            const embedMatch = slide.content.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/);
                            if (embedMatch) {
                                setVideoUrlInput(embedMatch[0]);
                                setUploadedVideoUrl(''); // Clear uploaded video if URL is found
                            } else {
                                setVideoUrlInput('');
                            }
                        }
                    }
                } else {
                    setVideoUrlInput('');
                    setUploadedVideoUrl('');
                }
            }, [slide.content, slide.id]);

            // Cleanup object URL on unmount or when slide changes
            useEffect(() => {
                return () => {
                    if (uploadedVideoUrl) {
                        URL.revokeObjectURL(uploadedVideoUrl);
                    }
                };
            }, [uploadedVideoUrl]);

            // Convert video URL to embed format
            const convertToEmbedUrl = (url: string): string | null => {
                if (!url || !url.trim()) return null;

                // YouTube URL patterns
                const youtubeWatchMatch = url.match(/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]+)/);
                const youtubeShortMatch = url.match(/(?:youtu\.be\/)([a-zA-Z0-9_-]+)/);
                const youtubeEmbedMatch = url.match(/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/);

                if (youtubeWatchMatch || youtubeShortMatch) {
                    const videoId = youtubeWatchMatch ? youtubeWatchMatch[1] : youtubeShortMatch![1];
                    return `https://www.youtube.com/embed/${videoId}`;
                }

                if (youtubeEmbedMatch) {
                    return url; // Already in embed format
                }

                // For other video URLs, return as is (might be Vimeo, etc.)
                return url;
            };

            // Get embed URL from input or uploaded video
            const embedUrl = convertToEmbedUrl(videoUrlInput);
            const videoSource = uploadedVideoUrl || embedUrl;

            // Use codeContent state if available, otherwise use extracted regularCode
            const currentCode = codeContent || regularCode;

            // Initialize code content if not already set
            if (!codeContent && regularCode) {
                setCodeContent(regularCode);
            }

            // Handle opening video URL dialog
            const handleOpenVideoUrlDialog = () => {
                setTempVideoUrl(videoUrlInput);
                setVideoUrlDialogOpen(true);
            };

            // Handle saving video URL from dialog
            const handleSaveVideoUrl = () => {
                setVideoUrlInput(tempVideoUrl);
                // Clear uploaded video when URL is saved
                if (uploadedVideoUrl) {
                    URL.revokeObjectURL(uploadedVideoUrl);
                    setUploadedVideoUrl('');
                    setUploadedVideoFile(null);
                }
                // Save to slide content if onContentEdit is available
                if (onContentEdit) {
                    // Preserve existing content and add/update video URL
                    let updatedContent = slide.content || '';

                    // Remove existing YouTube URLs from content (both watch and embed formats)
                    updatedContent = updatedContent.replace(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g, '');
                    updatedContent = updatedContent.replace(/https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                    updatedContent = updatedContent.replace(/https:\/\/youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                    // Remove uploaded video references
                    updatedContent = updatedContent.replace(/\[UPLOADED_VIDEO:[^\]]+\]/g, '');

                    // Clean up extra whitespace
                    updatedContent = updatedContent.replace(/\n{3,}/g, '\n\n').trim();

                    // Add new video URL if provided
                    if (tempVideoUrl && tempVideoUrl.trim()) {
                        // Add URL to content (append it with proper spacing)
                        if (updatedContent.trim()) {
                            updatedContent += `\n\n${tempVideoUrl.trim()}`;
                        } else {
                            updatedContent = tempVideoUrl.trim();
                        }
                    }

                    onContentEdit(slide.id, updatedContent);
                }
                setVideoUrlDialogOpen(false);
            };

            // Handle canceling video URL dialog
            const handleCancelVideoUrlDialog = () => {
                setTempVideoUrl('');
                setVideoUrlDialogOpen(false);
            };

            // Handle file upload
            const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0];
                if (file) {
                    // Check if file is a video
                    if (file.type.startsWith('video/')) {
                        // Revoke previous object URL if exists
                        if (uploadedVideoUrl) {
                            URL.revokeObjectURL(uploadedVideoUrl);
                        }
                        setUploadedVideoFile(file);
                        const videoUrl = URL.createObjectURL(file);
                        setUploadedVideoUrl(videoUrl);
                        // Clear URL input when uploading file
                        setVideoUrlInput('');

                        // Save to slide content if onContentEdit is available
                        if (onContentEdit) {
                            // For uploaded files, we'll store a reference or the file name
                            // In a real app, you'd upload to a server and get a URL
                            // For now, we'll store the file name and create a local URL
                            let updatedContent = slide.content || '';

                            // Remove existing YouTube URLs from content
                            updatedContent = updatedContent.replace(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g, '');
                            updatedContent = updatedContent.replace(/https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                            updatedContent = updatedContent.replace(/https:\/\/youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');

                            // Add file reference
                            if (updatedContent.trim()) {
                                updatedContent += `\n\n[UPLOADED_VIDEO:${file.name}]`;
                            } else {
                                updatedContent = `[UPLOADED_VIDEO:${file.name}]`;
                            }

                            onContentEdit(slide.id, updatedContent);
                        }
                    } else {
                        alert(t('selectVideoFileAlert'));
                    }
                }
                // Reset input
                if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                }
            };

            // Handle upload button click
            const handleUploadClick = () => {
                fileInputRef.current?.click();
            };

            return (
                <>
                    <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                        <div className="resizable-container flex gap-2" style={{ height: '600px' }}>
                            <div
                                className="border rounded-lg overflow-hidden bg-white flex flex-col flex-shrink-0"
                                style={{ width: `${splitterPosition}%` }}
                            >
                                <div className="bg-neutral-100 px-4 py-2 border-b flex items-center justify-between flex-shrink-0">
                                    <div className="flex items-center gap-2">
                                        <Code className="h-4 w-4 text-green-600" />
                                        <span className="text-sm font-semibold">{t('codeEditor')}</span>
                                    </div>
                                    {onRegenerate && (
                                        <button
                                            onClick={() => onRegenerate(slide.id, 'code')}
                                            className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                            title={t('regenerateCode')}
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" />
                                            <span>{t('regenerate')}</span>
                                        </button>
                                    )}
                                </div>
                                <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
                                    <Editor
                                        height="550px"
                                        defaultLanguage="javascript"
                                        value={currentCode}
                                        onChange={handleCodeChange}
                                        theme="vs-light"
                                        options={{
                                            readOnly: false,
                                            minimap: { enabled: false },
                                            scrollBeyondLastLine: false,
                                            automaticLayout: true,
                                        }}
                                    />
                                </div>
                            </div>
                            <div
                                ref={resizerRef}
                                className="w-1 bg-neutral-300 hover:bg-indigo-500 cursor-col-resize flex-shrink-0 transition-colors"
                                onMouseDown={handleMouseDown}
                                style={{ cursor: isResizing ? 'col-resize' : 'col-resize' }}
                            />
                            <div
                                className="border rounded-lg overflow-hidden bg-white flex flex-col flex-shrink-0"
                                style={{ width: `${100 - splitterPosition}%` }}
                            >
                                <div className="bg-neutral-100 px-4 py-2 border-b flex items-center justify-between flex-shrink-0">
                                    <div className="flex items-center gap-2">
                                        <Video className="h-4 w-4 text-red-600" />
                                        <span className="text-sm font-semibold">{t('videoPlayer')}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleUploadClick}
                                            className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                            title={t('uploadVideoFromDevice')}
                                        >
                                            <Upload className="h-3.5 w-3.5" />
                                        </button>
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="video/*"
                                            onChange={handleFileUpload}
                                            className="hidden"
                                        />
                                        <button
                                            onClick={handleOpenVideoUrlDialog}
                                            className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                            title={t('addVideoUrl')}
                                        >
                                            <Link className="h-3.5 w-3.5" />
                                        </button>
                                        {onRegenerate && (
                                            <button
                                                onClick={() => onRegenerate(slide.id, 'video')}
                                                className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                                title={t('regenerateVideo')}
                                            >
                                                <RefreshCw className="h-3.5 w-3.5" />
                                                <span>{t('regenerate')}</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="flex-1 overflow-auto">
                                    {videoSource ? (
                                        uploadedVideoUrl ? (
                                            // Display uploaded video file
                                            <div className="aspect-video w-full bg-black min-h-[300px]">
                                                <video
                                                    src={uploadedVideoUrl}
                                                    controls
                                                    className="w-full h-full"
                                                    style={{ objectFit: 'contain' }}
                                                />
                                            </div>
                                        ) : (
                                            // Display embedded video (YouTube, etc.)
                                            <div className="aspect-video w-full bg-black min-h-[300px]">
                                                <iframe
                                                    src={embedUrl!}
                                                    className="w-full h-full"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                />
                                            </div>
                                        )
                                    ) : (
                                        <div className="w-full aspect-video bg-black flex items-center justify-center min-h-[300px]">
                                            <div className="text-center text-white">
                                                <Video className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                                <p className="text-lg">{t('videoPlayer')}</p>
                                                <p className="text-sm opacity-75">{t('clickUploadOrUrl')}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Video URL Dialog */}
                    <Dialog open={videoUrlDialogOpen} onOpenChange={setVideoUrlDialogOpen}>
                        <DialogContent className="sm:max-w-[500px]">
                            <DialogHeader>
                                <DialogTitle>{t('addVideoUrl')}</DialogTitle>
                            </DialogHeader>
                            <div className="py-4">
                                <Label className="text-sm font-medium mb-2 block">{t('videoUrlLabel')}</Label>
                                <Input
                                    type="url"
                                    value={tempVideoUrl}
                                    onChange={(e) => setTempVideoUrl(e.target.value)}
                                    placeholder={t('videoUrlPlaceholder')}
                                    className="w-full"
                                />
                            </div>
                            <DialogFooter>
                                <MyButton
                                    buttonType="primary"
                                    onClick={handleSaveVideoUrl}
                                >
                                    {t('actions.save')}
                                </MyButton>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </>
            );
        }

        // Document/Objectives pages - editable
        if (slideType === 'doc' || slideType === 'objectives') {
            // Use documentContent state if available, otherwise use content
            let displayContent = documentContent || content || '';

            // Handle Yoopta clipboard format or markdown conversion
            if (
                displayContent &&
                (displayContent.includes('id="yoopta-clipboard"') ||
                    displayContent.includes('data-editor-id'))
            ) {
                // Extract content from Yoopta format if needed
                const bodyMatch = displayContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                if (bodyMatch && bodyMatch[1]) {
                    const extractedContent = bodyMatch[1].trim();
                    const textContent = extractedContent.replace(/<[^>]*>/g, '').trim();
                    if (!textContent || textContent === '') {
                        displayContent = '';
                    } else {
                        displayContent = extractedContent;
                    }
                }
            } else {
                // Explicitly convert markdown/raw text to HTML before passing to DocumentWithMermaidSimple
                // This ensures inline formatting (bold, italic) and unfenced diagrams are processed
                displayContent = markdownToHtml(displayContent);
            }


            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="mb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-blue-600" />
                                <span className="text-sm font-semibold text-neutral-900">
                                    {slideType === 'objectives' ? t('learningObjectives') : t('document')}
                                </span>
                            </div>
                            {onRegenerate && (
                                <button
                                    onClick={() => onRegenerate(slide.id)}
                                    className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                    title={t('regenerate')}
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span>{t('regenerate')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    {/* Render the HTML content directly (mermaid-aware) */}
                                        <div className="min-h-[400px] p-4 bg-white rounded border border-neutral-200">
                        <HtmlContentViewer
                            content={displayContent}
                            className="w-full"
                        />
                    </div>
                </div>
            );
        }

        // AI Video / AI Slides / AI Storybook pages - show video player
        if (slideType === 'ai-video' || slideType === 'ai-slides' || slideType === 'ai-storybook') {
            // Store status to avoid type narrowing issues
            const slideStatus: 'pending' | 'generating' | 'completed' = slide.status;

            // Check if video data is available
            if (slide.aiVideoData?.timelineUrl && slide.aiVideoData?.audioUrl && slideStatus === 'completed') {
                return (
                    <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Video className="h-4 w-4 text-purple-600" />
                                <Label className="text-sm font-semibold text-neutral-900">{t('aiGeneratedVideo')}</Label>
                            </div>
                        </div>
                        <div className="bg-white rounded-lg border border-neutral-200 p-4">
                            <AIVideoPlayer
                                timelineUrl={slide.aiVideoData.timelineUrl}
                                audioUrl={slide.aiVideoData.audioUrl}
                                className="w-full"
                            />
                        </div>
                    </div>
                );
            } else {
                // Show generating or prompt
                const prompt = slide.prompt || t('aiVideoGeneratingDefault');
                return (
                    <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Video className="h-4 w-4 text-purple-600" />
                                <Label className="text-sm font-semibold text-neutral-900">
                                    {(slideStatus as string) === 'generating' ? t('generatingAiVideo') : t('aiVideoPrompt')}
                                </Label>
                            </div>
                        </div>
                        <div className="bg-white rounded-lg border border-neutral-200 p-4">
                            <p className="text-sm text-neutral-700 whitespace-pre-wrap">{prompt}</p>
                            {(slideStatus as string) === 'generating' && (
                                <div className="mt-4 flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                                    <span className="text-sm text-neutral-600">{t('progress', { percent: slide.progress || 0 })}</span>
                                </div>
                            )}
                        </div>
                    </div>
                );
            }
        }

        // Video pages
        if (slideType === 'video') {
            console.log('🎥 Rendering video slide:', slide.id, 'Content:', content);
            const { videoUrl, script } = parseVideoContent(content);
            console.log('🎥 Parsed video data:', { videoUrl, script, hasVideoUrl: !!videoUrl });

            // Extract video ID from URL
            const getVideoIdFromUrl = (url: string | undefined) => {
                if (!url) {
                    console.log('❌ No URL provided to getVideoIdFromUrl');
                    return null;
                }
                console.log('🔍 Extracting video ID from:', url);

                // Handle youtube.com/embed/VIDEO_ID format
                const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
                if (embedMatch) {
                    console.log('✅ Found video ID from embed:', embedMatch[1]);
                    return embedMatch[1];
                }
                // Handle youtube.com/watch?v=VIDEO_ID format
                const watchMatch = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
                if (watchMatch) {
                    console.log('✅ Found video ID from watch:', watchMatch[1]);
                    return watchMatch[1];
                }
                // Handle youtu.be/VIDEO_ID format
                const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
                if (shortMatch) {
                    console.log('✅ Found video ID from short:', shortMatch[1]);
                    return shortMatch[1];
                }
                // Try to extract any 11-character ID
                const idMatch = url.match(/([a-zA-Z0-9_-]{11})/);
                if (idMatch) {
                    console.log('✅ Found video ID from generic match:', idMatch[1]);
                    return idMatch[1];
                }
                console.log('❌ Could not extract video ID from URL');
                return null;
            };

            const videoId = videoUrl ? getVideoIdFromUrl(videoUrl) : null;
            const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : (videoUrl || '#');
            const thumbnailUrl = videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null;

            console.log('🎥 Final video data:', { videoId, watchUrl, thumbnailUrl });

            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="space-y-4">
                        {videoUrl && videoId ? (
                            <div className="space-y-2">
                                {/* YouTube video thumbnail with play button */}
                                <div className="relative w-full aspect-video rounded-lg overflow-hidden group bg-black">
                                    <img
                                        src={thumbnailUrl || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`}
                                        alt="Video thumbnail"
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            // Fallback to default thumbnail if maxresdefault fails
                                            const img = e.target as HTMLImageElement;
                                            if (img.src.includes('maxresdefault')) {
                                                img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                                            } else if (img.src.includes('hqdefault')) {
                                                // If even hqdefault fails, use a placeholder
                                                img.src = 'https://via.placeholder.com/1280x720/1a1a1a/ffffff?text=YouTube+Video';
                                            }
                                        }}
                                    />
                                    {/* Play button overlay */}
                                    <a
                                        href={watchUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/60 transition-colors cursor-pointer"
                                    >
                                        <div className="bg-red-600 rounded-full p-4 group-hover:scale-110 transition-transform">
                                            <svg
                                                className="w-8 h-8 text-white fill-current"
                                                viewBox="0 0 24 24"
                                            >
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                        </div>
                                    </a>
                                    {/* "Watch on YouTube" text */}
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                                        <a
                                            href={watchUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-white text-sm font-semibold hover:text-yellow-300 transition-colors flex items-center gap-2"
                                        >
                                            {t('watchOnYoutube')}
                                        </a>
                                    </div>
                                </div>
                            </div>
                        ) : videoUrl ? (
                            <div className="space-y-2">
                                {/* Fallback for videos where we can't extract ID - just show link */}
                                <div className="aspect-video w-full rounded-lg bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center">
                                    <div className="text-center text-white p-8">
                                        <Video className="h-16 w-16 mx-auto mb-4" />
                                        <p className="text-lg font-semibold mb-4">{t('youtubeVideoAvailable')}</p>
                                        <a
                                            href={videoUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 bg-white text-red-600 px-6 py-3 rounded-lg font-semibold hover:bg-red-50 transition-colors"
                                        >
                                            {t('watchOnYoutube')}
                                        </a>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="aspect-video w-full rounded-lg bg-black flex items-center justify-center">
                                <div className="text-center text-white">
                                    <Video className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                    <p className="text-lg">{t('noVideoUrlFound')}</p>
                                    <p className="text-sm opacity-75">{t('checkContentForLinks')}</p>
                                </div>
                            </div>
                        )}

                        {/* Show script content below video */}
                        {script && (
                            <div className="mt-4 p-4 bg-white rounded-lg">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-semibold">{t('videoScript')}</h4>
                                    {onRegenerate && (
                                        <button
                                            onClick={() => onRegenerate(slide.id)}
                                            className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                            title={t('regenerateVideoScript')}
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" />
                                            <span>{t('regenerate')}</span>
                                        </button>
                                    )}
                                </div>
                                <div
                                    className="prose max-w-none text-sm"
                                    dangerouslySetInnerHTML={{ __html: script }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        // Code editor pages
        if (slideType === 'code-editor' || slideType === 'jupyter' || slideType === 'scratch') {
            const code = parseCodeContent(content);
            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="mb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Code className="h-4 w-4 text-green-600" />
                                <span className="text-sm font-semibold text-neutral-900">{t('codeEditor')}</span>
                            </div>
                            {onRegenerate && (
                                <button
                                    onClick={() => onRegenerate(slide.id)}
                                    className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                    title={t('regenerateCode')}
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span>{t('regenerate')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <Editor
                        height="400px"
                        defaultLanguage="javascript"
                        value={code}
                        theme="vs-light"
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                        }}
                    />
                </div>
            );
        }

        // Video + Code pages (split screen)
        if (slideType === 'video-code-editor' || slideType === 'video-jupyter' || slideType === 'video-scratch') {
            const youtubeMatch = content.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
            const videoUrl = youtubeMatch ? `https://www.youtube.com/embed/${youtubeMatch[1]}` : undefined;

            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="resizable-container flex gap-2" style={{ height: '600px' }}>
                        <div
                            className="border rounded-lg overflow-hidden bg-white flex flex-col flex-shrink-0"
                            style={{ width: `${splitterPosition}%` }}
                        >
                            <div className="bg-neutral-100 px-4 py-2 border-b flex items-center gap-2 flex-shrink-0">
                                <Code className="h-4 w-4 text-green-600" />
                                <span className="text-sm font-semibold">{t('codeEditor')}</span>
                            </div>
                            <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
                                <Editor
                                    height="550px"
                                    defaultLanguage="javascript"
                                    value={codeContent}
                                    onChange={handleCodeChange}
                                    theme="vs-light"
                                    options={{
                                        readOnly: false,
                                        minimap: { enabled: false },
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                    }}
                                />
                            </div>
                        </div>
                        <div
                            className="w-1 bg-neutral-300 hover:bg-indigo-500 cursor-col-resize flex-shrink-0 transition-colors"
                            onMouseDown={handleMouseDown}
                            style={{ cursor: isResizing ? 'col-resize' : 'col-resize' }}
                        />
                        <div
                            className="border rounded-lg overflow-hidden bg-white flex flex-col flex-shrink-0"
                            style={{ width: `${100 - splitterPosition}%` }}
                        >
                            <div className="bg-neutral-100 px-4 py-2 border-b flex items-center gap-2 flex-shrink-0">
                                <Video className="h-4 w-4 text-red-600" />
                                <span className="text-sm font-semibold">{t('videoPlayer')}</span>
                            </div>
                            <div className="flex-1 overflow-auto">
                                {videoUrl ? (
                                    <div className="aspect-video w-full bg-black min-h-[300px]">
                                        <iframe
                                            src={videoUrl}
                                            className="w-full h-full"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                            allowFullScreen
                                        />
                                    </div>
                                ) : (
                                    <div className="w-full aspect-video bg-black flex items-center justify-center min-h-[300px]">
                                        <div className="text-center text-white">
                                            <Video className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                            <p className="text-lg">{t('videoPlayer')}</p>
                                            <p className="text-sm opacity-75">{t('videoWillBeDisplayed')}</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // Quiz pages (slideType can be 'assessment', 'ASSESSMENT', or 'quiz')
        if (slideType === 'quiz' || slideType === 'assessment' || slideType === 'ASSESSMENT') {
            console.log('🎯 Rendering quiz/assessment slide, current quizQuestions:', quizQuestions.length, 'slide content exists:', !!slide.content, 'slideType:', slideType);

            // Save quiz questions to slide content
            const saveQuizQuestions = () => {
                if (!onContentEdit) return;
                const quizData = { questions: quizQuestions };
                onContentEdit(slide.id, JSON.stringify(quizData, null, 2));
            };

            // Add new question

            const addQuestion = () => {
                const newQuestion: QuizQuestion = {
                    question: '',
                    options: ['', '', '', ''],
                    correctAnswerIndex: 0
                };
                const newIndex = quizQuestions.length;
                setQuizQuestions([...quizQuestions, newQuestion]);

                // Scroll to the newly added question after state update
                setTimeout(() => {
                    const questionElement = questionRefs.current[newIndex];
                    if (questionElement) {
                        questionElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        // Focus on the question textarea
                        const textarea = questionElement.querySelector('textarea');
                        if (textarea) {
                            textarea.focus();
                        }
                    }
                }, 100);
            };

            // Delete question
            const deleteQuestion = (index: number) => {
                const updated = quizQuestions.filter((_, i) => i !== index);
                setQuizQuestions(updated);
                // Clean up refs array
                questionRefs.current = questionRefs.current.filter((_, i) => i !== index);
                // Save immediately after deletion
                setTimeout(() => {
                    if (onContentEdit) {
                        const quizData = { questions: updated };
                        onContentEdit(slide.id, JSON.stringify(quizData, null, 2));
                    }
                }, 0);
            };

            // Update question
            const updateQuestion = (index: number, field: keyof QuizQuestion, value: any) => {
                const updated = [...quizQuestions];
                const currentQuestion = updated[index];
                if (!currentQuestion) return;

                if (field === 'options' && Array.isArray(value)) {
                    updated[index] = {
                        question: currentQuestion.question || '',
                        options: value,
                        correctAnswerIndex: currentQuestion.correctAnswerIndex
                    };
                } else if (field === 'correctAnswerIndex' && typeof value === 'number') {
                    updated[index] = {
                        question: currentQuestion.question || '',
                        options: currentQuestion.options || [],
                        correctAnswerIndex: value
                    };
                } else {
                    updated[index] = {
                        question: currentQuestion.question || '',
                        options: currentQuestion.options || [],
                        correctAnswerIndex: currentQuestion.correctAnswerIndex,
                        ...(field === 'question' ? { question: value || '' } : {})
                    };
                }
                setQuizQuestions(updated);
            };

            // Add option to question
            const addOption = (questionIndex: number) => {
                const updated = [...quizQuestions];
                const currentQuestion = updated[questionIndex];
                if (!currentQuestion) return;

                updated[questionIndex] = {
                    question: currentQuestion.question || '',
                    options: [...(currentQuestion.options || []), ''],
                    correctAnswerIndex: currentQuestion.correctAnswerIndex
                };
                setQuizQuestions(updated);
            };

            // Remove option from question
            const removeOption = (questionIndex: number, optionIndex: number) => {
                const updated = [...quizQuestions];
                const currentQuestion = updated[questionIndex];
                if (!currentQuestion) return;

                const options = [...(currentQuestion.options || [])];
                options.splice(optionIndex, 1);

                const currentCorrectIndex = currentQuestion.correctAnswerIndex ?? 0;
                const newCorrectIndex = currentCorrectIndex >= optionIndex
                    ? Math.max(0, currentCorrectIndex - 1)
                    : currentCorrectIndex;

                updated[questionIndex] = {
                    question: currentQuestion.question || '',
                    options,
                    correctAnswerIndex: newCorrectIndex
                };
                setQuizQuestions(updated);
            };

            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <FileQuestion className="h-4 w-4 text-purple-600" />
                            <Label className="text-sm font-semibold text-neutral-900">{t('quiz.content')}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={addQuestion}
                                className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors border border-indigo-200"
                                title={t('quiz.addQuestion')}
                            >
                                <span>+</span>
                                {t('quiz.addQuestion')}
                            </button>
                            {onRegenerate && (
                                <button
                                    onClick={() => onRegenerate(slide.id)}
                                    className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                    title={t('regenerateQuiz')}
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span>{t('regenerate')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="space-y-6">
                        {quizQuestions.length === 0 ? (
                            <div className="text-center py-8 text-neutral-500">
                                <p className="mb-4">{t('quiz.noQuestionsYet')}</p>
                            </div>
                        ) : (
                            <>
                                {quizQuestions.map((question, qIndex) => (
                                    <div
                                        key={qIndex}
                                        ref={(el) => {
                                            questionRefs.current[qIndex] = el;
                                        }}
                                        className="bg-white rounded-lg border border-neutral-200 p-4 space-y-4"
                                    >
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-sm font-semibold text-neutral-900">{t('quiz.question', { number: qIndex + 1 })}</h4>
                                            <button
                                                onClick={() => deleteQuestion(qIndex)}
                                                className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded px-2 py-1 transition-colors"
                                                title={t('quiz.deleteQuestion')}
                                            >
                                                {t('actions.delete')}
                                            </button>
                                        </div>

                                        <div>
                                            <Label className="text-xs text-neutral-700 mb-1 block">{t('quiz.questionText')}</Label>
                                            <Textarea
                                                value={question.question || ''}
                                                onChange={(e) => {
                                                    updateQuestion(qIndex, 'question', e.target.value);
                                                    setTimeout(saveQuizQuestions, 100);
                                                }}
                                                placeholder={t('quiz.questionPlaceholder')}
                                                className="min-h-[80px] text-sm"
                                            />
                                        </div>

                                        <div>
                                            <Label className="text-xs text-neutral-700 mb-2 block">{t('quiz.options')}</Label>
                                            <div className="space-y-2">
                                                {(question.options || []).map((option, optIndex) => (
                                                    <div key={optIndex} className="flex items-center gap-2">
                                                        <input
                                                            type="radio"
                                                            name={`correct-${quizGroupId}-${qIndex}`}
                                                            checked={Number(question.correctAnswerIndex ?? 0) === optIndex}
                                                            onChange={() => {
                                                                updateQuestion(qIndex, 'correctAnswerIndex', optIndex);
                                                                setTimeout(saveQuizQuestions, 100);
                                                            }}
                                                            className="h-4 w-4 text-indigo-600"
                                                        />
                                                        <Input
                                                            value={option || ''}
                                                            onChange={(e) => {
                                                                const newOptions = [...(question.options || [])];
                                                                newOptions[optIndex] = e.target.value;
                                                                updateQuestion(qIndex, 'options', newOptions);
                                                                setTimeout(saveQuizQuestions, 100);
                                                            }}
                                                            placeholder={t('quiz.optionPlaceholder', { number: optIndex + 1 })}
                                                            className="flex-1 text-sm"
                                                        />
                                                        {(question.options || []).length > 2 && (
                                                            <button
                                                                onClick={() => {
                                                                    removeOption(qIndex, optIndex);
                                                                    setTimeout(saveQuizQuestions, 100);
                                                                }}
                                                                className="text-xs text-red-600 hover:text-red-700 px-2 py-1"
                                                                title={t('quiz.removeOption')}
                                                            >
                                                                ×
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    onClick={() => {
                                                        addOption(qIndex);
                                                        setTimeout(saveQuizQuestions, 100);
                                                    }}
                                                    className="text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded px-2 py-1 transition-colors"
                                                >
                                                    {t('quiz.addOption')}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {/* Add Question button at the end */}
                                <div className="flex justify-center pt-2">
                                    <button
                                        onClick={addQuestion}
                                        className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 transition-colors border border-indigo-200"
                                        title={t('quiz.addQuestion')}
                                    >
                                        <span>+</span>
                                        {t('quiz.addQuestion')}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            );
        }

        // Homework/Assignment pages
        if (slideType === 'homework' || slideType === 'assignment') {
            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="mb-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <FileText className="h-4 w-4 text-purple-600" />
                                <span className="text-sm font-semibold text-neutral-900">
                                    {slideType === 'homework' ? t('homework') : t('assignment')}
                                </span>
                            </div>
                            {onRegenerate && (
                                <button
                                    onClick={() => onRegenerate(slide.id)}
                                    className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                    title={t('regenerateAssignment')}
                                >
                                    <RefreshCw className="h-3.5 w-3.5" />
                                    <span>{t('regenerate')}</span>
                                </button>
                            )}
                        </div>
                    </div>
                    <div
                        className="prose max-w-none"
                        dangerouslySetInnerHTML={{ __html: content }}
                    />
                </div>
            );
        }

        // Solution pages
        if (slideType === 'solution') {
            const code = parseCodeContent(content);
            return (
                <div className="mt-3 ml-8 bg-neutral-50 rounded-md border border-neutral-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-semibold">{t('solutionCode')}</h3>
                        {onRegenerate && (
                            <button
                                onClick={() => onRegenerate(slide.id)}
                                className="rounded p-1.5 text-xs text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                                title={t('regenerateSolution')}
                            >
                                <RefreshCw className="h-3.5 w-3.5" />
                                <span>{t('regenerate')}</span>
                            </button>
                        )}
                    </div>
                    <Editor
                        height="400px"
                        defaultLanguage="javascript"
                        value={code}
                        theme="vs-light"
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                        }}
                    />
                </div>
            );
        }

        return null;
    };

    return (
        <div className="mb-2">
            <div
                ref={setNodeRef}
                style={style}
                className="group flex items-center gap-2 rounded-md border border-transparent bg-white p-2 hover:border-neutral-200 hover:bg-neutral-50"
            >
                <button
                    {...attributes}
                    {...listeners}
                    className="cursor-grab active:cursor-grabbing text-neutral-400 hover:text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <GripVertical className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-2 flex-1">
                    {getSlideIcon(slide.slideType)}
                    {isEditing ? (
                        <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit();
                                if (e.key === 'Escape') handleCancelEdit();
                            }}
                            className="h-7 text-sm flex-1"
                            autoFocus
                        />
                    ) : (
                        <span className="text-sm text-neutral-700 flex-1">{slide.slideTitle}</span>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {isEditing ? (
                        <>
                            <button
                                onClick={handleSaveEdit}
                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                title={t('actions.save')}
                            >
                                <CheckCircle className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={handleCancelEdit}
                                className="rounded p-1 text-xs text-neutral-600 hover:bg-neutral-100"
                                title={t('actions.cancel')}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => setIsEditing(true)}
                                className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                title={t('actions.edit')}
                            >
                                <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => onDelete(slide.id)}
                                className="rounded p-1 text-xs text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                                title={t('actions.delete')}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </>
                    )}

                    {slide.status === 'completed' && (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                    )}
                </div>
            </div>
            {(slide.status === 'completed' || slide.status === 'generating') && renderSlideContent()}

            {/* Video URL Dialog - only show for topic slides */}
            {slide.slideType === 'topic' && (
                <Dialog open={videoUrlDialogOpen} onOpenChange={setVideoUrlDialogOpen}>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>{t('addVideoUrl')}</DialogTitle>
                        </DialogHeader>
                        <div className="py-4">
                            <Label htmlFor="video-url-input" className="text-sm font-medium mb-2 block">{t('videoUrlLabel')}</Label>
                            <Input
                                id="video-url-input"
                                type="url"
                                value={videoUrlInput}
                                onChange={(e) => setVideoUrlInput(e.target.value)}
                                placeholder={t('videoUrlPlaceholder')}
                                className="w-full"
                            />
                        </div>
                        <DialogFooter>
                            <MyButton
                                buttonType="primary"
                                onClick={() => {
                                    setVideoUrlInput(videoUrlInput);
                                    // Clear uploaded video when URL is saved
                                    if (uploadedVideoUrl) {
                                        URL.revokeObjectURL(uploadedVideoUrl);
                                        setUploadedVideoUrl('');
                                        setUploadedVideoFile(null);
                                    }
                                    // Save to slide content if onContentEdit is available
                                    if (onContentEdit) {
                                        let updatedContent = slide.content || '';
                                        // Remove existing YouTube URLs from content
                                        updatedContent = updatedContent.replace(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/g, '');
                                        updatedContent = updatedContent.replace(/https:\/\/www\.youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                                        updatedContent = updatedContent.replace(/https:\/\/youtube\.com\/embed\/[a-zA-Z0-9_-]+/g, '');
                                        // Remove uploaded video references
                                        updatedContent = updatedContent.replace(/\[UPLOADED_VIDEO:[^\]]+\]/g, '');
                                        // Clean up extra whitespace
                                        updatedContent = updatedContent.replace(/\n{3,}/g, '\n\n').trim();
                                        // Add new video URL if provided
                                        if (videoUrlInput && videoUrlInput.trim()) {
                                            if (updatedContent.trim()) {
                                                updatedContent += `\n\n${videoUrlInput.trim()}`;
                                            } else {
                                                updatedContent = videoUrlInput.trim();
                                            }
                                        }
                                        onContentEdit(slide.id, updatedContent);
                                    }
                                    setVideoUrlDialogOpen(false);
                                }}
                            >
                                {t('actions.save')}
                            </MyButton>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    );
});

SortableViewerSlideItem.displayName = 'SortableViewerSlideItem';
