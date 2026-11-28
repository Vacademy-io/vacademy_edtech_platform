import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    CheckCircle,
    Edit2,
    FileText,
    GripVertical,
    Trash2,
    X,
    Code,
    Video,
    Loader2,
    RefreshCw,
    Layers,
    FileQuestion,
    ClipboardList,
    ChevronDown,
    ChevronUp,
    Eye,
    Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Editor } from '@monaco-editor/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HtmlDocField } from '@/components/html-slide/html-doc-field';
import { Textarea } from '@/components/ui/textarea';
import { CircularProgress } from './CircularProgress';
import { AIVideoPlayer } from '@/components/ai-video-player/AIVideoPlayer';
import { MermaidDiagram } from '../../../shared/components/MermaidDiagram';
import { DocumentWithMermaidSimple } from '../../../shared/components/DocumentWithMermaid';
import type { SlideGeneration, SlideType, QuizQuestion } from '../../../shared/types';
import { executeCode } from '../../../../courses/course-details/subjects/modules/chapters/slides/-components/utils/code-editor-utils';
import { Play, X as XIcon } from 'lucide-react';

import { markdownToHtml } from '../../../shared/utils/markdownToHtml';

// Component to display script (can be text or HTML)
const ScriptDisplay = ({ scriptUrl }: { scriptUrl: string }) => {
    const { t } = useTranslation('studyLibrarySortableSlideItem');
    const [scriptContent, setScriptContent] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isHtml, setIsHtml] = useState(false);

    useEffect(() => {
        const fetchScript = async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await fetch(scriptUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch script: ${response.statusText}`);
                }

                const contentType = response.headers.get('content-type') || '';
                const text = await response.text();

                // Check if it's HTML
                if (contentType.includes('text/html') || text.trim().startsWith('<')) {
                    setIsHtml(true);
                    setScriptContent(text);
                } else {
                    // It's plain text, convert to HTML with proper formatting
                    setIsHtml(false);
                    // Preserve line breaks and format as HTML
                    const formattedText = text
                        .split('\n')
                        .map((line) => `<p>${line || '<br>'}</p>`)
                        .join('');
                    setScriptContent(formattedText);
                }
            } catch (err) {
                console.error('Error fetching script:', err);
                setError(err instanceof Error ? err.message : t('status.failedToLoadScript'));
            } finally {
                setIsLoading(false);
            }
        };

        if (scriptUrl) {
            fetchScript();
        }
    }, [scriptUrl]);

    if (isLoading) {
        return (
            <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                    <FileText className="size-4 text-blue-600" />
                    <Label className="text-sm font-semibold text-neutral-900">{t('labels.videoScript')}</Label>
                </div>
                <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-indigo-600" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                    <FileText className="size-4 text-blue-600" />
                    <Label className="text-sm font-semibold text-neutral-900">{t('labels.videoScript')}</Label>
                </div>
                <div className="py-4 text-sm text-red-600">{error}</div>
            </div>
        );
    }

    return (
        <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
                <FileText className="size-4 text-blue-600" />
                <Label className="text-sm font-semibold text-neutral-900">{t('labels.videoScript')}</Label>
            </div>
            <div className="max-h-[600px] w-full min-w-0 max-w-full overflow-auto rounded border border-neutral-200 bg-neutral-50 p-4">
                {isHtml ? (
                    <div
                        dangerouslySetInnerHTML={{ __html: scriptContent }}
                        className="prose prose-sm max-w-none"
                    />
                ) : (
                    <div
                        dangerouslySetInnerHTML={{ __html: scriptContent }}
                        className="whitespace-pre-wrap font-mono text-sm"
                    />
                )}
            </div>
        </div>
    );
};

interface SortableSlideItemProps {
    slide: SlideGeneration;
    onEdit: (slideId: string, newTitle: string) => void;
    onDelete: (slideId: string) => void;
    getSlideIcon: (type: SlideType) => React.ReactNode;
    onRegenerate?: (slideId: string, section?: 'video' | 'code') => void;
    onContentEdit?: (slideId: string, newContent: string) => void;
    isOutlineMode?: boolean; // True when in outline mode (before content generation)
}

export const SortableSlideItem = React.memo(
    ({
        slide,
        onEdit,
        onDelete,
        getSlideIcon,
        onRegenerate,
        onContentEdit,
        isOutlineMode = false,
    }: SortableSlideItemProps) => {
        // All hooks must be called before any conditional returns
        const { t } = useTranslation('studyLibrarySortableSlideItem');
        // executeCode renders its own error/status strings, so it needs a `t`
        // bound to its own namespace plus the active locale.
        const { t: tCodeEditorUtils, i18n } = useTranslation('studyLibraryCodeEditorUtils');
        const [isEditing, setIsEditing] = useState(false);
        const [isExpanded, setIsExpanded] = useState(false);
        const [editValue, setEditValue] = useState(slide?.slideTitle || '');
        const [videoScriptContent, setVideoScriptContent] = useState('');
        const [codeContent, setCodeContent] = useState('');
        const [mermaidContent, setMermaidContent] = useState('');
        const [documentContent, setDocumentContent] = useState('');
        const [editedSections, setEditedSections] = useState<
            Array<{
                type: 'text' | 'video-script' | 'code' | 'mermaid';
                content: string;
                label: string;
            }>
        >([]);
        const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
        const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
        const [expandedMermaidEditors, setExpandedMermaidEditors] = useState<Set<number>>(
            new Set()
        );
        const [showPrompt, setShowPrompt] = useState(false);
        // Code execution state for video-code and ai-video-code slides
        const [codeOutput, setCodeOutput] = useState<{
            [slideId: string]: { output: string; isRunning: boolean; isExpanded: boolean };
        }>({});
        const editorRefs = useRef<{ [slideId: string]: any }>({});
        // Local running state for immediate UI feedback (before async state update)
        const [localRunning, setLocalRunning] = useState<{ [slideId: string]: boolean }>({});
        // Track iframe embedding failures per slide
        const [iframeFailures, setIframeFailures] = useState<{ [slideId: string]: boolean }>({});
        const iframeRefs = useRef<{ [slideId: string]: HTMLIFrameElement | null }>({});
        const iframeTimeouts = useRef<{ [slideId: string]: NodeJS.Timeout | null }>({});

        // Parse content to extract video scripts, code snippets, and mermaid diagrams
        const parseContent = useCallback((content: string) => {
            console.log('🔵 [parseContent] Called with content:', {
                hasContent: !!content,
                contentLength: content?.length || 0,
                contentPreview: content?.substring(0, 200) || 'NO CONTENT',
            });

            const sections: Array<{
                type: 'text' | 'video-script' | 'code' | 'mermaid';
                content: string;
                label: string;
                originalMatch?: string;
            }> = [];

            if (!content) {
                console.warn('⚠️ [parseContent] Content is empty, returning empty sections');
                return sections;
            }

            // For document slides, always treat content as document content (text + possibly mermaid)
            // DocumentWithMermaidSimple will extract and render mermaid diagrams inline with text
            // No need to split into sections - just render everything together
            const trimmedContent = content.trim();

            // Always create a single text section - DocumentWithMermaidSimple handles everything
            sections.push({
                type: 'text',
                content: trimmedContent,
                label: t('labels.content'),
                originalMatch: trimmedContent,
            });
            console.log(
                '✅ [parseContent] Created document content section, total sections:',
                sections.length
            );
            return sections;
        }, [t]);

        useEffect(() => {
            if (!slide) return;

            setEditValue(slide.slideTitle || '');

            // Initialize content based on slide type
            if (slide.content) {
                if (slide.slideType === 'video' || slide.slideType === 'ai-video') {
                    // Video pages - content IS the video script (NO content section)
                    // Remove any "Content" labels, sections, or headings that might be in the stored content
                    // ALL content is video script - never show "Content" section
                    let videoScript = slide.content || '';
                    // Remove any "Content" labels, sections, or headings from the HTML
                    videoScript = videoScript.replace(/<[^>]*>Content[^<]*<\/[^>]*>/gi, '');
                    videoScript = videoScript.replace(/Content[:\s]*/gi, '');
                    videoScript = videoScript.replace(
                        /<div[^>]*class[^>]*content[^>]*>[\s\S]*?<\/div>/gi,
                        ''
                    );
                    videoScript = videoScript.replace(
                        /<section[^>]*class[^>]*content[^>]*>[\s\S]*?<\/section>/gi,
                        ''
                    );
                    videoScript = videoScript.replace(/<h[1-6][^>]*>Content[^<]*<\/h[1-6]>/gi, '');
                    // Remove any labels like "Content:" or "Content Section" that might appear
                    videoScript = videoScript.replace(/<p[^>]*>Content[:\s]*<\/p>/gi, '');
                    videoScript = videoScript.replace(/<strong[^>]*>Content[:\s]*<\/strong>/gi, '');
                    setVideoScriptContent(videoScript.trim());
                } else if (slide.slideType === 'image') {
                    // Image - extract mermaid code
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = slide.content;
                    const codeElement = tempDiv.querySelector('pre code, pre');
                    setMermaidContent(codeElement?.textContent || slide.content);
                } else if (
                    slide.slideType === 'code-editor' ||
                    slide.slideType === 'jupyter' ||
                    slide.slideType === 'scratch'
                ) {
                    // Code only - use prompt if available, otherwise fall back to content
                    setCodeContent(slide.prompt || slide.content);
                } else if (
                    slide.slideType === 'video-code' ||
                    slide.slideType === 'ai-video-code'
                ) {
                    // VIDEO_CODE or AI_VIDEO_CODE
                    // Content can be JSON (old draft) or HTML (generated for viewer)
                    // We need to handle both to initialize state correctly
                    try {
                        let extractedCode = '';
                        // First try JSON (legacy or draft state)
                        try {
                            const contentData = slide.content ? JSON.parse(slide.content) : null;
                            if (contentData && contentData.code) {
                                extractedCode = contentData.code.content || '';
                                // JSON format usually doesn't have iframe in it, video is in metadata
                            }
                        } catch (e) {
                            // Not JSON, assume HTML (Viewer format)
                        }

                        if (!extractedCode && slide.content) {
                            // Try extracting from HTML
                            const content = slide.content;
                            // Extract code from pre/code blocks
                            const match = content.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
                            if (match && match[1]) {
                                extractedCode = match[1];
                            } else if (content.includes('```')) {
                                // Fallback to markdown extraction
                                const codeMatch = content.match(
                                    /```(?:python|javascript|typescript|java|html|css|markdown)?\s*\n?([\s\S]*?)\n?```/
                                );
                                if (codeMatch && codeMatch[1]) {
                                    extractedCode = codeMatch[1].trim();
                                }
                            }
                        }

                        setCodeContent(extractedCode);
                    } catch (e) {
                        console.error('Failed to parse video-code content:', e);
                    }
                } else if (
                    slide.slideType === 'video-code-editor' ||
                    slide.slideType === 'video-jupyter' ||
                    slide.slideType === 'video-scratch'
                ) {
                    // Video + Code - use prompt for code if available
                    if (slide.prompt) {
                        setCodeContent(slide.prompt);
                        setVideoScriptContent(slide.content || '');
                    } else {
                        // Fallback: extract from content
                        const content = slide.content || '';
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = content;
                        const codeBlocks = tempDiv.querySelectorAll('pre code, pre');

                        if (codeBlocks.length > 0) {
                            // Extract code from all code blocks
                            let allCode = '';
                            codeBlocks.forEach((block, idx) => {
                                const codeText = block.textContent || '';
                                if (idx > 0) allCode += '\n\n';
                                allCode += codeText.trim();
                            });
                            setCodeContent(allCode.trim());

                            // Remove ALL code blocks from content to get pure video script
                            let videoScript = content;
                            codeBlocks.forEach((block) => {
                                const blockHTML = block.outerHTML;
                                videoScript = videoScript.replace(blockHTML, '');
                            });

                            // Remove any "Content" labels, sections, or headings from the HTML
                            videoScript = videoScript.replace(/<[^>]*>Content[^<]*<\/[^>]*>/gi, '');
                            videoScript = videoScript.replace(/Content[:\s]*/gi, '');
                            videoScript = videoScript.replace(
                                /<div[^>]*class[^>]*content[^>]*>[\s\S]*?<\/div>/gi,
                                ''
                            );
                            videoScript = videoScript.replace(
                                /<section[^>]*class[^>]*content[^>]*>[\s\S]*?<\/section>/gi,
                                ''
                            );
                            videoScript = videoScript.replace(
                                /<h[1-6][^>]*>Content[^<]*<\/h[1-6]>/gi,
                                ''
                            );
                            videoScript = videoScript.replace(/<p[^>]*>Content[:\s]*<\/p>/gi, '');
                            videoScript = videoScript.replace(
                                /<strong[^>]*>Content[:\s]*<\/strong>/gi,
                                ''
                            );

                            videoScript = videoScript.trim();
                            setVideoScriptContent(videoScript || '');
                        } else {
                            // No code block found, treat entire content as video script
                            let videoScript = content;
                            videoScript = videoScript.replace(/<[^>]*>Content[^<]*<\/[^>]*>/gi, '');
                            videoScript = videoScript.replace(/Content[:\s]*/gi, '');
                            videoScript = videoScript.replace(
                                /<div[^>]*class[^>]*content[^>]*>[\s\S]*?<\/div>/gi,
                                ''
                            );
                            videoScript = videoScript.replace(
                                /<section[^>]*class[^>]*content[^>]*>[\s\S]*?<\/section>/gi,
                                ''
                            );
                            videoScript = videoScript.replace(
                                /<h[1-6][^>]*>Content[^<]*<\/h[1-6]>/gi,
                                ''
                            );
                            videoScript = videoScript.replace(/<p[^>]*>Content[:\s]*<\/p>/gi, '');
                            videoScript = videoScript.replace(
                                /<strong[^>]*>Content[:\s]*<\/strong>/gi,
                                ''
                            );
                            setVideoScriptContent(videoScript.trim());
                            setCodeContent('');
                        }
                    }
                } else if (slide.slideType === 'topic') {
                    // Topic slides - check if they have code blocks
                    // If topic has code blocks AND text content, treat it like video-code-editor (only Video Script + Code, NO Content section)
                    // ALL non-code content is treated as video script for video+code editor topics
                    const content = slide.content || '';
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = content;
                    const codeBlocks = tempDiv.querySelectorAll('pre code, pre');

                    // Check if there's substantial text content (not just code)
                    let textWithoutCode = content;
                    codeBlocks.forEach((block) => {
                        const blockHTML = block.outerHTML;
                        textWithoutCode = textWithoutCode.replace(blockHTML, '');
                    });
                    const textOnly = textWithoutCode.replace(/<[^>]*>/g, '').trim();
                    const hasTextContent = textOnly.length > 50; // At least 50 characters of text

                    // If topic has code blocks AND text content, treat it like video-code-editor
                    if (codeBlocks.length > 0 && hasTextContent) {
                        // Separate mermaid diagrams from regular code
                        // Mermaid diagrams should stay in video script (learning document)
                        // Regular code goes to code editor
                        const mermaidBlocks: Array<{ element: Element; html: string }> = [];
                        const regularCodeBlocks: Array<{ element: Element; html: string }> = [];

                        codeBlocks.forEach((block) => {
                            const codeText = block.textContent || '';
                            const parentText = block.parentElement?.textContent || '';
                            const blockHTML = block.outerHTML;
                            const isMermaid =
                                codeText.includes('graph') ||
                                codeText.includes('flowchart') ||
                                codeText.includes('sequenceDiagram') ||
                                codeText.includes('classDiagram') ||
                                parentText.toLowerCase().includes('mermaid') ||
                                block.parentElement?.querySelector('code[class*="mermaid"]');

                            if (isMermaid) {
                                mermaidBlocks.push({ element: block, html: blockHTML });
                            } else {
                                regularCodeBlocks.push({ element: block, html: blockHTML });
                            }
                        });

                        // Extract regular code (non-mermaid) to code editor
                        let allCode = '';
                        regularCodeBlocks.forEach((block, idx) => {
                            const codeText = block.element.textContent || '';
                            if (idx > 0) allCode += '\n\n';
                            allCode += codeText.trim();
                        });
                        setCodeContent(allCode.trim());

                        // Remove only regular code blocks from content, keep mermaid in video script
                        // Mermaid diagrams should appear in the learning document (video script section)
                        let videoScript = content;
                        regularCodeBlocks.forEach((block) => {
                            videoScript = videoScript.replace(block.html, '');
                        });

                        // Remove any "Content" labels, sections, or headings from the HTML
                        videoScript = videoScript.replace(/<[^>]*>Content[^<]*<\/[^>]*>/gi, '');
                        videoScript = videoScript.replace(/Content[:\s]*/gi, '');
                        videoScript = videoScript.replace(
                            /<div[^>]*class[^>]*content[^>]*>[\s\S]*?<\/div>/gi,
                            ''
                        );
                        videoScript = videoScript.replace(
                            /<section[^>]*class[^>]*content[^>]*>[\s\S]*?<\/section>/gi,
                            ''
                        );
                        videoScript = videoScript.replace(
                            /<h[1-6][^>]*>Content[^<]*<\/h[1-6]>/gi,
                            ''
                        );
                        videoScript = videoScript.replace(/<p[^>]*>Content[:\s]*<\/p>/gi, '');
                        videoScript = videoScript.replace(
                            /<strong[^>]*>Content[:\s]*<\/strong>/gi,
                            ''
                        );
                        setVideoScriptContent(videoScript.trim());
                        // Clear editedSections since we're using videoScriptContent and codeContent
                        setEditedSections([]);
                    } else {
                        // Topic without code blocks or without substantial text - parse all sections normally
                        const sections = parseContent(slide.content);
                        setEditedSections(sections);
                    }
                } else if (slide.slideType === 'doc' || slide.slideType === 'objectives') {
                    // Document - parse all sections
                    const sections = parseContent(slide.content);
                    setEditedSections(sections);
                }
            }
        }, [slide.slideTitle, slide.content, slide.slideType, parseContent]);

        // Initialize quiz questions from slide content - must be called unconditionally
        useEffect(() => {
            if ((slide.slideType === 'quiz' || slide.slideType === 'assessment') && slide.content) {
                try {
                    // Try to parse as JSON first
                    const quizData = JSON.parse(slide.content);

                    // Check if it's the new assessment format from API
                    if (
                        quizData &&
                        quizData.questions &&
                        Array.isArray(quizData.questions) &&
                        quizData.questions.length > 0
                    ) {
                        const firstQuestion = quizData.questions[0];

                        // Check if it's the new assessment format (has question.content, options with preview_id)
                        if (
                            firstQuestion.question &&
                            typeof firstQuestion.question === 'object' &&
                            firstQuestion.question.content
                        ) {
                            // New assessment format from API
                            const normalizedQuestions = quizData.questions.map((q: any) => {
                                const questionText = q.question?.content || q.question?.text || '';
                                const options = (q.options || [])
                                    .map((opt: any) => {
                                        // Handle both content and text fields
                                        return opt.content || opt.text || opt || '';
                                    })
                                    .filter((opt: string) => opt !== ''); // Filter out empty options

                                let correctIndex = 0;

                                // Find correct answer index from correct_options array
                                if (q.correct_options && q.correct_options.length > 0) {
                                    const correctOptionId = q.correct_options[0];
                                    const foundIndex = q.options?.findIndex((opt: any) => {
                                        // Check both preview_id and id fields
                                        return (
                                            opt.preview_id === correctOptionId ||
                                            opt.id === correctOptionId
                                        );
                                    });
                                    if (foundIndex !== -1 && foundIndex < options.length) {
                                        correctIndex = foundIndex;
                                    }
                                }

                                return {
                                    question: questionText,
                                    options: options,
                                    correctAnswerIndex: correctIndex,
                                    explanation: q.exp || q.explanation || '',
                                };
                            });

                            // Filter out questions with no question text or no options
                            const validQuestions = normalizedQuestions.filter(
                                (q: any) => q.question && q.options.length > 0
                            );

                            if (validQuestions.length > 0) {
                                setQuizQuestions(validQuestions);
                            } else {
                                setQuizQuestions([]);
                            }
                        } else if (
                            firstQuestion.question &&
                            typeof firstQuestion.question === 'string'
                        ) {
                            // Old quiz format
                            const normalizedQuestions = quizData.questions.map((q: any) => {
                                const questionText = q.question || '';
                                const options = (q.options || []).filter((opt: any) => {
                                    return opt !== null && opt !== undefined && opt !== '';
                                });

                                let correctIndex = 0;
                                if (
                                    q.correctAnswerIndex !== undefined &&
                                    q.correctAnswerIndex !== null
                                ) {
                                    const numIndex =
                                        typeof q.correctAnswerIndex === 'string'
                                            ? parseInt(q.correctAnswerIndex, 10)
                                            : q.correctAnswerIndex;
                                    if (
                                        typeof numIndex === 'number' &&
                                        !isNaN(numIndex) &&
                                        numIndex >= 0 &&
                                        numIndex < options.length
                                    ) {
                                        correctIndex = numIndex;
                                    }
                                }

                                return {
                                    question: questionText,
                                    options: options,
                                    correctAnswerIndex: Number(correctIndex),
                                    explanation: q.explanation || '',
                                };
                            });

                            const validQuestions = normalizedQuestions.filter(
                                (q: any) => q.question && q.options.length > 0
                            );
                            if (validQuestions.length > 0) {
                                setQuizQuestions(validQuestions);
                            } else {
                                setQuizQuestions([]);
                            }
                        } else {
                            setQuizQuestions([]);
                        }
                    } else {
                        setQuizQuestions([]);
                    }
                } catch (e) {
                    // If not JSON, try to parse as HTML (new document format)
                    if (
                        slide.content &&
                        slide.content.includes('<h3>') &&
                        slide.content.includes('Question')
                    ) {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = slide.content;
                        const questionHeaders = tempDiv.querySelectorAll('h3');

                        if (questionHeaders.length > 0) {
                            const questions: QuizQuestion[] = [];
                            questionHeaders.forEach((header) => {
                                const questionText =
                                    header.nextElementSibling?.textContent?.trim() || '';
                                const listElement = header.nextElementSibling?.nextElementSibling;

                                if (listElement && listElement.tagName === 'OL') {
                                    const options: string[] = [];
                                    let correctIndex = 0;

                                    // Extract options from the list
                                    listElement.querySelectorAll('li').forEach((li) => {
                                        const text = li.textContent?.trim() || '';
                                        if (text) {
                                            options.push(text);
                                        }
                                    });

                                    // Find the correct answer below the list
                                    let nextElement = listElement.nextElementSibling;
                                    while (nextElement) {
                                        const text = nextElement.textContent || '';
                                        if (
                                            text.includes('Correct Answer:') ||
                                            text.includes('Correct Answer')
                                        ) {
                                            // Extract the correct answer text
                                            const correctAnswerMatch =
                                                text.match(/Correct Answer:\s*(.+)/i);
                                            if (correctAnswerMatch?.[1]) {
                                                const correctAnswerText =
                                                    correctAnswerMatch[1].trim();
                                                // Find which option matches the correct answer
                                                const foundIndex = options.findIndex(
                                                    (opt) => opt.trim() === correctAnswerText
                                                );
                                                if (foundIndex !== -1) {
                                                    correctIndex = foundIndex;
                                                }
                                            }
                                            break;
                                        }
                                        nextElement = nextElement.nextElementSibling;
                                    }

                                    if (questionText && options.length > 0) {
                                        questions.push({
                                            question: questionText,
                                            options: options,
                                            correctAnswerIndex: correctIndex,
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
            } else if (slide.slideType !== 'quiz' && slide.slideType !== 'assessment') {
                setQuizQuestions([]);
            }
        }, [slide.content, slide.id, slide.slideType]);

        const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
            useSortable({ id: slide.id });

        const style = {
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.5 : 1,
        };

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

        // Auto-save content changes
        const handleContentChange = useCallback(
            (newContent: string) => {
                if (onContentEdit) {
                    onContentEdit(slide.id, newContent);
                }
            },
            [onContentEdit, slide.id]
        );

        // Handle video script change
        const handleVideoScriptChange = useCallback(
            (html: string) => {
                setVideoScriptContent(html);
                if (slide.slideType === 'video') {
                    // For video pages, the content IS the video script (NO content section)
                    let cleanHtml = html;
                    cleanHtml = cleanHtml.replace(/<[^>]*>Content[^<]*<\/[^>]*>/gi, '');
                    cleanHtml = cleanHtml.replace(/Content[:\s]*/gi, '');
                    cleanHtml = cleanHtml.replace(
                        /<div[^>]*class[^>]*content[^>]*>[\s\S]*?<\/div>/gi,
                        ''
                    );
                    cleanHtml = cleanHtml.replace(
                        /<section[^>]*class[^>]*content[^>]*>[\s\S]*?<\/section>/gi,
                        ''
                    );
                    cleanHtml = cleanHtml.replace(/<h[1-6][^>]*>Content[^<]*<\/h[1-6]>/gi, '');
                    handleContentChange(cleanHtml.trim());
                } else if (
                    slide.slideType === 'video-code-editor' ||
                    slide.slideType === 'video-jupyter' ||
                    slide.slideType === 'video-scratch' ||
                    slide.slideType === 'topic'
                ) {
                    // Combine video script and code
                    let cleanHtml = html;
                    cleanHtml = cleanHtml.replace(/<[^>]*>Content[^<]*<\/[^>]*>/gi, '');
                    cleanHtml = cleanHtml.replace(/Content[:\s]*/gi, '');
                    cleanHtml = cleanHtml.replace(
                        /<div[^>]*class[^>]*content[^>]*>[\s\S]*?<\/div>/gi,
                        ''
                    );
                    cleanHtml = cleanHtml.replace(
                        /<section[^>]*class[^>]*content[^>]*>[\s\S]*?<\/section>/gi,
                        ''
                    );
                    cleanHtml = cleanHtml.replace(/<h[1-6][^>]*>Content[^<]*<\/h[1-6]>/gi, '');
                    const combined = codeContent
                        ? `${cleanHtml.trim()}\n\n<pre><code>${codeContent}</code></pre>`
                        : cleanHtml.trim();
                    handleContentChange(combined);
                }
            },
            [codeContent, slide.slideType, handleContentChange]
        );

        // Handle code change
        const handleCodeChange = useCallback(
            (value: string | undefined) => {
                const code = value || '';
                setCodeContent(code);
                if (
                    slide.slideType === 'code-editor' ||
                    slide.slideType === 'jupyter' ||
                    slide.slideType === 'scratch'
                ) {
                    handleContentChange(code);
                } else if (
                    slide.slideType === 'video-code-editor' ||
                    slide.slideType === 'video-jupyter' ||
                    slide.slideType === 'video-scratch' ||
                    slide.slideType === 'topic'
                ) {
                    // Combine video script and code
                    let cleanVideoScript = videoScriptContent || '';
                    cleanVideoScript = cleanVideoScript.replace(
                        /<[^>]*>Content[^<]*<\/[^>]*>/gi,
                        ''
                    );
                    cleanVideoScript = cleanVideoScript.replace(/Content[:\s]*/gi, '');
                    cleanVideoScript = cleanVideoScript.replace(
                        /<div[^>]*class[^>]*content[^>]*>[\s\S]*?<\/div>/gi,
                        ''
                    );
                    cleanVideoScript = cleanVideoScript.replace(
                        /<section[^>]*class[^>]*content[^>]*>[\s\S]*?<\/section>/gi,
                        ''
                    );
                    cleanVideoScript = cleanVideoScript.replace(
                        /<h[1-6][^>]*>Content[^<]*<\/h[1-6]>/gi,
                        ''
                    );
                    const combined = cleanVideoScript
                        ? `${cleanVideoScript.trim()}\n\n<pre><code>${code}</code></pre>`
                        : `<pre><code>${code}</code></pre>`;
                    handleContentChange(combined);
                } else if (
                    slide.slideType === 'video-code' ||
                    slide.slideType === 'ai-video-code'
                ) {
                    // Updated to save as HTML structure for Viewer compatibility
                    // <div class="video-container"><iframe...></iframe></div><pre><code>...</code></pre>

                    const currentContent = slide.content || '';
                    let videoPart = '';

                    // Try to preserve existing video part from content
                    if (
                        currentContent.includes('class="video-container"') ||
                        currentContent.includes('<iframe')
                    ) {
                        const videoMatch = currentContent.match(
                            /(<div class="video-container"[\s\S]*?<\/div>)/i
                        );
                        if (videoMatch) {
                            videoPart = videoMatch[0];
                        } else {
                            const iframeMatch = currentContent.match(
                                /(<iframe[\s\S]*?<\/iframe>)/i
                            );
                            if (iframeMatch) {
                                videoPart = `<div class="video-container" style="margin-bottom: 20px;">${iframeMatch[0]}</div>`;
                            }
                        }
                    }

                    // If no video found in content, check if we have it in JSON (legacy/draft) or slide metadata
                    if (!videoPart) {
                        try {
                            const jsonContent = JSON.parse(currentContent);
                            const url = jsonContent.video?.embedUrl || jsonContent.video?.url;
                            if (url) {
                                videoPart = `<div class="video-container" style="margin-bottom: 20px;"><iframe src="${url}" width="100%" height="400" frameborder="0" allowfullscreen></iframe></div>`;
                            }
                        } catch (e) {
                            // Not JSON
                        }
                    }

                    // If still no video part, try fallback to AI Video ID marker if appropriate
                    if (
                        !videoPart &&
                        slide.slideType === 'ai-video-code' &&
                        slide.aiVideoData?.videoId
                    ) {
                        videoPart = `\n\n[AI Video: ${slide.aiVideoData.videoId}]`;
                    }

                    // Construct new HTML content
                    const newCodePart = `<pre><code class="language-python">${code}</code></pre>`;
                    const finalContent = videoPart ? `${videoPart}\n\n${newCodePart}` : newCodePart;

                    handleContentChange(finalContent);
                }
            },
            [videoScriptContent, slide.slideType, slide.content, handleContentChange]
        );

        // Handle mermaid change
        const handleMermaidChange = useCallback(
            (value: string | undefined) => {
                const mermaid = value || '';
                setMermaidContent(mermaid);
                if (slide.slideType === 'image') {
                    handleContentChange(`<pre><code>${mermaid}</code></pre>`);
                }
            },
            [slide.slideType, handleContentChange]
        );

        // Handle document section change
        const handleDocumentSectionChange = useCallback(
            (sectionIndex: number, newContent: string) => {
                const updated = [...editedSections];
                const section = updated[sectionIndex];
                if (section) {
                    updated[sectionIndex] = {
                        type: section.type,
                        content: newContent,
                        label: section.label,
                    };
                }
                setEditedSections(updated);

                // Reconstruct full content
                const originalSections = parseContent(slide.content || '');
                let newFullContent = slide.content || '';
                const originalSection = originalSections[sectionIndex];

                if (originalSection?.originalMatch) {
                    if (originalSection.type === 'mermaid' || originalSection.type === 'code') {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = originalSection.originalMatch;
                        const codeElement = tempDiv.querySelector('code, pre');
                        if (codeElement) {
                            codeElement.textContent = newContent;
                            newFullContent = newFullContent.replace(
                                originalSection.originalMatch,
                                tempDiv.innerHTML
                            );
                        } else {
                            newFullContent = newFullContent.replace(
                                originalSection.originalMatch,
                                `<pre><code>${newContent}</code></pre>`
                            );
                        }
                    } else {
                        newFullContent = newFullContent.replace(
                            originalSection.originalMatch,
                            newContent
                        );
                    }
                }

                handleContentChange(newFullContent);
            },
            [editedSections, slide.content, handleContentChange, parseContent]
        );

        // Helper function to clean HTML content - remove nested paragraphs and normalize
        const cleanHtmlContent = useCallback((content: string): string => {
            if (!content) return '';
            // Remove nested paragraph tags that can cause Yoopta parsing issues
            let cleaned = content.replace(/<\/?p>/g, '').trim();
            // Remove any other problematic nested structures
            cleaned = cleaned.replace(/<p>\s*<p>/g, '<p>');
            cleaned = cleaned.replace(/<\/p>\s*<\/p>/g, '</p>');
            return cleaned;
        }, []);

        // Convert quiz questions to HTML format for document editing
        const convertQuizToHTML = useCallback(
            (questions: QuizQuestion[]): string => {
                if (questions.length === 0) {
                    return '<p>No questions available.</p>';
                }

                let html = '';
                questions.forEach((q, index) => {
                    html += `<h3>Question ${index + 1}</h3>`;
                    // Clean question text to avoid nested paragraphs
                    const cleanQuestion = cleanHtmlContent(q.question || '');
                    if (cleanQuestion) {
                        html += `<p>${cleanQuestion}</p>`;
                    }
                    html += '<ol>';
                    (q.options || []).forEach((option) => {
                        // Clean option text - Yoopta expects plain text in list items, not nested HTML
                        const cleanOption = cleanHtmlContent(String(option || ''));
                        if (cleanOption) {
                            html += `<li>${cleanOption}</li>`;
                        }
                    });
                    html += '</ol>';
                    // Show correct answer below the options
                    const correctAnswerIndex = q.correctAnswerIndex ?? 0;
                    const correctAnswer = (q.options || [])[correctAnswerIndex] || '';
                    if (correctAnswer) {
                        const cleanAnswer = cleanHtmlContent(String(correctAnswer));
                        html += `<p><strong style="color: #10b981;">Correct Answer: ${cleanAnswer}</strong></p>`;
                    }
                    if (index < questions.length - 1) {
                        html += '<hr style="margin: 20px 0;" />';
                    }
                });
                return html;
            },
            [cleanHtmlContent]
        );

        // Parse HTML back to quiz questions format
        const parseHTMLToQuiz = useCallback((html: string): QuizQuestion[] => {
            console.log('[SortableSlideItem] parseHTMLToQuiz input length:', html.length);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            const questions: QuizQuestion[] = [];
            const questionHeaders = tempDiv.querySelectorAll('h3');
            console.log('[SortableSlideItem] Found question headers:', questionHeaders.length);

            questionHeaders.forEach((header, idx) => {
                // Collect question text from all elements between h3 and ol
                let questionText = '';
                let currentElement = header.nextElementSibling;
                let listElement: Element | null = null;

                while (currentElement) {
                    if (currentElement.tagName === 'OL') {
                        listElement = currentElement;
                        break;
                    }
                    // Skip HR tags or empty text nodes if possible (though textContent handles text)
                    if (currentElement.tagName !== 'HR') {
                        questionText +=
                            (questionText ? '\n' : '') + (currentElement.textContent?.trim() || '');
                    }
                    currentElement = currentElement.nextElementSibling;
                }

                if (listElement && listElement.tagName === 'OL') {
                    const options: string[] = [];
                    let correctIndex = 0;

                    // Extract options from the list
                    listElement.querySelectorAll('li').forEach((li) => {
                        const text = li.textContent?.trim() || '';
                        if (text) {
                            options.push(text);
                        }
                    });

                    // Find the correct answer below the list
                    let nextElement = listElement.nextElementSibling;
                    while (nextElement) {
                        const text = nextElement.textContent || '';
                        // Check for HR to stop searching this question's answer
                        if (nextElement.tagName === 'HR' || nextElement.tagName === 'H3') break;

                        if (text.includes('Correct Answer:') || text.includes('Correct Answer')) {
                            // Extract the correct answer text
                            const correctAnswerMatch = text.match(/Correct Answer:\s*(.+)/i);
                            if (correctAnswerMatch?.[1]) {
                                const correctAnswerText = correctAnswerMatch[1].trim();
                                // Find which option matches the correct answer
                                const foundIndex = options.findIndex(
                                    (opt) => opt.trim() === correctAnswerText
                                );
                                if (foundIndex !== -1) {
                                    correctIndex = foundIndex;
                                }
                            }
                            break;
                        }
                        nextElement = nextElement.nextElementSibling;
                    }

                    if (questionText && options.length > 0) {
                        questions.push({
                            question: questionText,
                            options: options,
                            correctAnswerIndex: correctIndex,
                        });
                    } else {
                        console.warn(
                            `[SortableSlideItem] Question ${idx + 1} skipped - missing text or options`,
                            { questionText, optionsLength: options.length }
                        );
                    }
                }
            });

            console.log('[SortableSlideItem] Final parsed questions:', questions);
            return questions;
        }, []);

        // Get current HTML content from quiz questions - always called
        const quizHTML = useMemo(() => {
            // Store status to avoid type narrowing issues
            const slideStatus: 'pending' | 'generating' | 'completed' = slide.status;

            if (slide.slideType === 'quiz' || slide.slideType === 'assessment') {
                // If we have quiz questions, convert them to HTML
                if (quizQuestions.length > 0) {
                    const html = convertQuizToHTML(quizQuestions);
                    console.log('📝 Quiz: Generated HTML from questions, length:', html.length);
                    return html;
                }
                // If no quiz questions but slide has content, try to parse it
                if (slide.content) {
                    // Check if it's already HTML
                    if (
                        slide.content.includes('<h3>') ||
                        slide.content.includes('<h2>') ||
                        slide.content.includes('<p>')
                    ) {
                        console.log('📝 Quiz: Using slide.content as HTML');
                        return slide.content;
                    }
                    // Try to parse as JSON (from API)
                    try {
                        const parsed = JSON.parse(slide.content);
                        if (
                            parsed &&
                            parsed.questions &&
                            Array.isArray(parsed.questions) &&
                            parsed.questions.length > 0
                        ) {
                            console.log(
                                '📝 Quiz: Parsed JSON content, questions count:',
                                parsed.questions.length
                            );
                            // If we have parsed questions but quizQuestions state hasn't updated yet,
                            // convert them directly to HTML here
                            const tempQuestions = parsed.questions
                                .map((q: any, index: number) => {
                                    if (
                                        q.question &&
                                        typeof q.question === 'object' &&
                                        q.question.content
                                    ) {
                                        // New format
                                        const questionText =
                                            q.question?.content ||
                                            q.question?.text ||
                                            q.question ||
                                            '';
                                        const options = (q.options || [])
                                            .map((opt: any) => {
                                                return opt.content || opt.text || opt || '';
                                            })
                                            .filter((opt: string) => opt !== '');

                                        let correctIndex = 0;
                                        if (q.correct_options && q.correct_options.length > 0) {
                                            const correctOptionId = q.correct_options[0];
                                            const foundIndex = q.options?.findIndex((opt: any) => {
                                                return (
                                                    opt.preview_id === correctOptionId ||
                                                    opt.id === correctOptionId
                                                );
                                            });
                                            if (foundIndex !== -1 && foundIndex < options.length) {
                                                correctIndex = foundIndex;
                                            } else {
                                                console.warn(
                                                    `📝 Quiz: Question ${index + 1} - Could not find correct option in tempQuestions`
                                                );
                                            }
                                        }

                                        return {
                                            question: questionText,
                                            options: options,
                                            correctAnswerIndex: correctIndex,
                                            explanation: q.exp || q.explanation || '',
                                        };
                                    } else if (q.question && typeof q.question === 'string') {
                                        // Old format
                                        return {
                                            question: q.question || '',
                                            options: (q.options || []).filter(
                                                (opt: any) => opt !== ''
                                            ),
                                            correctAnswerIndex: q.correctAnswerIndex || 0,
                                            explanation: q.explanation || '',
                                        };
                                    } else {
                                        console.warn(
                                            `📝 Quiz: Question ${index + 1} - Unknown format:`,
                                            q
                                        );
                                        return null;
                                    }
                                })
                                .filter(
                                    (q: any) => q !== null && q.question && q.options.length > 0
                                );

                            if (tempQuestions.length > 0) {
                                return convertQuizToHTML(tempQuestions);
                            } else {
                                console.error(
                                    '📝 Quiz: No valid questions after parsing in quizHTML'
                                );
                                return '<p>No valid questions found.</p>';
                            }
                        }
                    } catch (e) {
                        // Not JSON, might be plain text
                        console.log('📝 Quiz: Content is not JSON, treating as text');
                        return slide.content;
                    }
                }
                // Otherwise return empty
                console.log('📝 Quiz: No content available');
                return '<p>No questions available.</p>';
            }
            return '';
        }, [quizQuestions, slide.slideType, slide.content, convertQuizToHTML]);

        // Handle quiz content change - always called
        const handleQuizContentChange = useCallback(
            (html: string) => {
                if (slide.slideType === 'quiz' || slide.slideType === 'assessment') {
                    const parsedQuestions = parseHTMLToQuiz(html);
                    if (parsedQuestions.length > 0) {
                        setQuizQuestions(parsedQuestions);
                        // Save to slide content
                        const quizData = { questions: parsedQuestions };
                        handleContentChange(JSON.stringify(quizData, null, 2));
                    } else {
                        // If parsing fails, still save the HTML as content
                        handleContentChange(html);
                    }
                }
            },
            [slide.slideType, parseHTMLToQuiz, handleContentChange]
        );

        // Render content based on slide type - everything editable by default
        const renderContent = useMemo(() => {
            // Store status in variable to avoid type narrowing issues - must be done first
            const slideStatus: 'pending' | 'generating' | 'completed' = slide.status;

            // Only render content when expanded by user
            if (!isExpanded) return null;

            // Show loader if slide is generating
            if (slideStatus === 'generating') {
                return (
                    <div className="ml-8 mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex items-center justify-center gap-3 py-8">
                            <Loader2 className="size-5 animate-spin text-indigo-600" />
                            <span className="text-sm font-medium text-neutral-600">
                                {slide.slideType === 'doc'
                                    ? t('status.generatingDocument')
                                    : slide.slideType === 'quiz' || slide.slideType === 'assessment'
                                      ? t('status.generatingQuiz')
                                      : slide.slideType === 'video'
                                        ? t('status.generatingVideo')
                                        : t('status.generatingContent')}
                            </span>
                        </div>
                    </div>
                );
            }

            // Only render if slide is completed and has content
            // Exception: AI_VIDEO / AI_SLIDES / AI_STORYBOOK slides should show prompt even when pending
            // Exception: AI_VIDEO_CODE and VIDEO_CODE slides should show even when video is generating
            // Exception: Quiz/Assessment slides can show content even when not completed (if content exists)
            if (
                slide.slideType !== 'ai-video' &&
                slide.slideType !== 'ai-slides' &&
                slide.slideType !== 'ai-storybook' &&
                slide.slideType !== 'ai-video-code' &&
                slide.slideType !== 'video-code' &&
                slide.slideType !== 'quiz' &&
                slide.slideType !== 'assessment' &&
                (slideStatus !== 'completed' || !slide.content)
            ) {
                return (
                    <div className="ml-8 mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex items-center justify-center gap-3 py-8">
                            <span className="text-sm text-neutral-500">
                                {t('status.noContentAvailable')}
                            </span>
                        </div>
                    </div>
                );
            }

            // For quiz/assessment, don't show if status is generating and no valid questions
            if (
                (slide.slideType === 'quiz' || slide.slideType === 'assessment') &&
                (slideStatus as string) === 'generating' &&
                (!slide.content || quizQuestions.length === 0)
            ) {
                return (
                    <div className="ml-8 mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <div className="flex items-center justify-center gap-3 py-8">
                            <Loader2 className="size-5 animate-spin text-indigo-600" />
                            <span className="text-sm font-medium text-neutral-600">
                                {t('status.generatingQuiz')}
                            </span>
                        </div>
                    </div>
                );
            }

            try {
                // AI Video / AI Slides / AI Storybook pages - show prompt in outline view (always visible, even when pending)
                if (slide.slideType === 'ai-video' || slide.slideType === 'ai-slides' || slide.slideType === 'ai-storybook') {
                    // Show video player when video is ready - check both status and aiVideoData
                    const hasVideo =
                        slide.aiVideoData?.timelineUrl &&
                        slide.aiVideoData?.audioUrl &&
                        slide.aiVideoData?.status === 'COMPLETED';
                    const isGenerating = (slideStatus as string) === 'generating';
                    const hasScript = slide.aiVideoData?.scriptUrl;
                    // Show script if scriptUrl is available (could be during script stage or anytime script is available)
                    const shouldShowScript = hasScript && !hasVideo;

                    // Don't show anything if video is not ready and not generating (removed "No content available" message)
                    if (!hasVideo && !isGenerating && !hasScript) {
                        return null;
                    }

                    return (
                        <div className="ml-8 mt-3 min-w-0 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                            {/* Show script when available and video is not ready */}
                            {shouldShowScript && slide.aiVideoData?.scriptUrl && (
                                <ScriptDisplay scriptUrl={slide.aiVideoData.scriptUrl} />
                            )}
                            {/* Show video player when video is ready */}
                            {hasVideo && (
                                <div className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white p-4">
                                    <div className="mb-3 flex items-center gap-2">
                                        <Video className="size-4 text-purple-600" />
                                        <Label className="text-sm font-semibold text-neutral-900">
                                            {t('labels.aiGeneratedVideo')}
                                        </Label>
                                    </div>
                                    {slide.aiVideoData?.timelineUrl &&
                                        slide.aiVideoData?.audioUrl && (
                                            <div className="w-full min-w-0 max-w-full overflow-hidden">
                                                <AIVideoPlayer
                                                    timelineUrl={slide.aiVideoData.timelineUrl!}
                                                    audioUrl={slide.aiVideoData.audioUrl!}
                                                    className="w-full min-w-0 max-w-full"
                                                />
                                            </div>
                                        )}
                                </div>
                            )}
                            {/* Only show loader when actively generating, not when pending */}
                            {isGenerating && !hasScript && (
                                <div className="mt-4 flex items-center gap-2">
                                    <Loader2 className="size-4 animate-spin text-indigo-600" />
                                    <span className="text-sm text-neutral-600">
                                        {t('status.generatingVideoProgress', { progress: slide.progress || 0 })}
                                    </span>
                                </div>
                            )}
                        </div>
                    );
                }

                // Video pages - show video thumbnail with YouTube link (embedding is blocked)
                if (slide.slideType === 'video') {
                    // Parse video content to extract video URL and script
                    const parseVideoContent = (
                        content: string
                    ): { videoUrl?: string; script?: string } => {
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = content || '';

                        // Extract YouTube URL from content - try multiple patterns
                        let videoUrl: string | undefined;

                        // Pattern 1: embed URL
                        const embedMatch = content.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
                        if (embedMatch) {
                            videoUrl = `https://www.youtube.com/embed/${embedMatch[1]}`;
                        }

                        // Pattern 2: watch URL
                        if (!videoUrl) {
                            const watchMatch = content.match(
                                /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/
                            );
                            if (watchMatch) {
                                videoUrl = `https://www.youtube.com/embed/${watchMatch[1]}`;
                            }
                        }

                        // Pattern 3: short URL
                        if (!videoUrl) {
                            const shortMatch = content.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
                            if (shortMatch) {
                                videoUrl = `https://www.youtube.com/embed/${shortMatch[1]}`;
                            }
                        }

                        // Pattern 4: any 11-character ID
                        if (!videoUrl) {
                            const idMatch = content.match(/([a-zA-Z0-9_-]{11})/);
                            if (idMatch && idMatch[1] && /[a-zA-Z]/.test(idMatch[1])) {
                                videoUrl = `https://www.youtube.com/embed/${idMatch[1]}`;
                            }
                        }

                        // Extract script (remove code blocks if any)
                        const codeBlocks = tempDiv.querySelectorAll('pre code, pre');
                        codeBlocks.forEach((block) => block.remove());
                        const script = tempDiv.innerHTML.trim();

                        return { videoUrl, script: script || undefined };
                    };

                    const { videoUrl, script } = parseVideoContent(slide.content || '');
                    const displayScript = script || videoScriptContent || slide.content || '';

                    // Extract video ID from URL
                    const getVideoIdFromUrl = (url: string | undefined) => {
                        if (!url) return null;
                        const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
                        if (embedMatch) return embedMatch[1];
                        const watchMatch = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
                        if (watchMatch) return watchMatch[1];
                        const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
                        if (shortMatch) return shortMatch[1];
                        const idMatch = url.match(/([a-zA-Z0-9_-]{11})/);
                        if (idMatch) return idMatch[1];
                        return null;
                    };

                    const videoId = videoUrl ? getVideoIdFromUrl(videoUrl) : null;
                    const watchUrl = videoId
                        ? `https://www.youtube.com/watch?v=${videoId}`
                        : videoUrl || '#';
                    const thumbnailUrl = videoId
                        ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
                        : null;

                    return (
                        <div className="ml-8 mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                            <div className="space-y-4">
                                {/* Try iframe first, show thumbnail only if iframe fails */}
                                {videoUrl && videoId && !iframeFailures[slide.id] ? (
                                    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                                        <iframe
                                            ref={(el) => {
                                                if (el) {
                                                    iframeRefs.current[slide.id] = el;
                                                    // Clear any existing timeout
                                                    if (iframeTimeouts.current[slide.id]) {
                                                        clearTimeout(
                                                            iframeTimeouts.current[slide.id]!
                                                        );
                                                    }
                                                    // Set timeout - if iframe doesn't load within 2 seconds, show fallback
                                                    // YouTube iframes can load but be blocked, so we check after a short delay
                                                    // Reduced timeout to 2 seconds for faster fallback
                                                    iframeTimeouts.current[slide.id] = setTimeout(
                                                        () => {
                                                            const iframe =
                                                                iframeRefs.current[slide.id];
                                                            if (
                                                                iframe &&
                                                                !iframeFailures[slide.id]
                                                            ) {
                                                                // For YouTube, if onLoad fired but iframe is still showing error/blocked content,
                                                                // we need to show fallback. Since we can't access cross-origin content,
                                                                // we'll show fallback after timeout as YouTube often blocks embedding
                                                                console.log(
                                                                    'Iframe timeout - YouTube may be blocking embedding, showing thumbnail fallback'
                                                                );
                                                                setIframeFailures((prev) => ({
                                                                    ...prev,
                                                                    [slide.id]: true,
                                                                }));
                                                            }
                                                        },
                                                        2000
                                                    );
                                                }
                                            }}
                                            src={videoUrl}
                                            className="absolute inset-0 size-full"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                            allowFullScreen
                                            onError={() => {
                                                console.log(
                                                    'Iframe embedding failed, showing thumbnail fallback'
                                                );
                                                if (iframeTimeouts.current[slide.id]) {
                                                    clearTimeout(iframeTimeouts.current[slide.id]!);
                                                }
                                                setIframeFailures((prev) => ({
                                                    ...prev,
                                                    [slide.id]: true,
                                                }));
                                            }}
                                            // Removed onLoad handler - YouTube iframes can fire onLoad even when blocked,
                                            // which prevents the timeout-based fallback from working
                                        />
                                    </div>
                                ) : videoUrl && videoId && iframeFailures[slide.id] ? (
                                    <div className="group relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                                        <img
                                            src={
                                                thumbnailUrl ||
                                                `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                                            }
                                            alt={t('alt.videoThumbnail')}
                                            className="size-full object-cover"
                                            onError={(e) => {
                                                const img = e.target as HTMLImageElement;
                                                if (img.src.includes('maxresdefault')) {
                                                    img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                                                } else if (img.src.includes('hqdefault')) {
                                                    img.src =
                                                        'https://via.placeholder.com/1280x720/1a1a1a/ffffff?text=YouTube+Video';
                                                }
                                            }}
                                        />
                                        {/* Play button overlay */}
                                        <a
                                            href={watchUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/40 transition-colors group-hover:bg-black/60"
                                        >
                                            <div className="rounded-full bg-red-600 p-4 transition-transform group-hover:scale-110">
                                                <svg
                                                    className="size-8 fill-current text-white"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </div>
                                        </a>
                                        {/* "Watch on YouTube" text */}
                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                                            <a
                                                href={watchUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-yellow-300"
                                            >
                                                {t('actions.watchOnYoutube')}
                                            </a>
                                        </div>
                                    </div>
                                ) : videoUrl ? (
                                    <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-gradient-to-br from-red-600 to-red-800">
                                        <div className="p-8 text-center text-white">
                                            <Video className="mx-auto mb-4 size-16" />
                                            <p className="mb-4 text-lg font-semibold">
                                                {t('status.youtubeVideoAvailable')}
                                            </p>
                                            <a
                                                href={videoUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 font-semibold text-red-600 transition-colors hover:bg-red-50"
                                            >
                                                {t('actions.watchOnYoutube')}
                                            </a>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-black">
                                        <div className="text-center text-white">
                                            <Video className="mx-auto mb-4 size-16 opacity-50" />
                                            <p className="text-lg">{t('status.noVideoUrlFound')}</p>
                                            <p className="text-sm opacity-75">
                                                {t('status.checkContentForYoutubeLinks')}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Video Script */}
                                {displayScript && (
                                    <div className="mt-4 rounded-lg bg-white p-4">
                                        <div className="mb-2 flex items-center justify-between">
                                            <h4 className="font-semibold">{t('labels.videoScript')}</h4>
                                            {onRegenerate && (
                                                <button
                                                    onClick={() => onRegenerate(slide.id)}
                                                    className="flex items-center gap-1 rounded p-1.5 text-xs text-indigo-600 transition-colors hover:bg-indigo-50"
                                                    title={t('actions.regenerateVideoScript')}
                                                >
                                                    <RefreshCw className="size-3.5" />
                                                    {t('actions.regenerate')}
                                                </button>
                                            )}
                                        </div>
                                        <Textarea
                                            value={displayScript}
                                            onChange={(e) => handleVideoScriptChange(e.target.value)}
                                            className="resize-y font-mono text-caption"
                                            style={{ minHeight: 300 }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                }

                // Image page - show mermaid diagram code editor
                if (slide.slideType === 'image') {
                    return (
                        <div className="ml-8 mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Layers className="size-4 text-purple-600" />
                                    <Label className="text-sm font-semibold text-neutral-900">
                                        {t('labels.mermaidDiagramCode')}
                                    </Label>
                                </div>
                                {onRegenerate && (
                                    <button
                                        onClick={() => onRegenerate(slide.id)}
                                        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                        title={t('actions.regenerateDiagram')}
                                    >
                                        <RefreshCw className="size-3.5" />
                                        {t('actions.regenerate')}
                                    </button>
                                )}
                            </div>
                            <Editor
                                height="400px"
                                defaultLanguage="mermaid"
                                value={mermaidContent}
                                onChange={handleMermaidChange}
                                theme="vs-dark"
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 12,
                                    wordWrap: 'on',
                                }}
                            />
                        </div>
                    );
                }

                // Code only pages - show code editor
                if (
                    slide.slideType === 'code-editor' ||
                    slide.slideType === 'jupyter' ||
                    slide.slideType === 'scratch' ||
                    slide.slideType === 'solution'
                ) {
                    return (
                        <div className="ml-8 mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Code className="size-4 text-green-600" />
                                    <Label className="text-sm font-semibold text-neutral-900">
                                        {t('labels.codeSnippet')}
                                    </Label>
                                </div>
                                {onRegenerate && (
                                    <button
                                        onClick={() => onRegenerate(slide.id)}
                                        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                        title={t('actions.regenerateCode')}
                                    >
                                        <RefreshCw className="size-3.5" />
                                        {t('actions.regenerate')}
                                    </button>
                                )}
                            </div>
                            <Editor
                                height="400px"
                                defaultLanguage="python"
                                value={codeContent}
                                onChange={handleCodeChange}
                                theme="vs-dark"
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 12,
                                    wordWrap: 'on',
                                }}
                            />
                        </div>
                    );
                }

                // Video + Code pages - show both video script and code, clearly labeled
                if (
                    slide.slideType === 'video-code-editor' ||
                    slide.slideType === 'video-jupyter' ||
                    slide.slideType === 'video-scratch'
                ) {
                    return (
                        <div className="ml-8 mt-3 space-y-4">
                            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Video className="size-4 text-red-600" />
                                        <Label className="text-sm font-semibold text-neutral-900">
                                            {t('labels.videoScript')}
                                        </Label>
                                    </div>
                                    {onRegenerate && (
                                        <button
                                            onClick={() => onRegenerate(slide.id)}
                                            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                            title={t('actions.regenerateVideoScript')}
                                        >
                                            <RefreshCw className="size-3.5" />
                                            {t('actions.regenerate')}
                                        </button>
                                    )}
                                </div>
                                <Textarea
                                    value={videoScriptContent || ''}
                                    onChange={(e) => handleVideoScriptChange(e.target.value)}
                                    className="resize-y font-mono text-caption"
                                    style={{ minHeight: 300 }}
                                />
                            </div>
                            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Code className="size-4 text-green-600" />
                                        <Label className="text-sm font-semibold text-neutral-900">
                                            {t('labels.codeSnippet')}
                                        </Label>
                                    </div>
                                    {onRegenerate && (
                                        <button
                                            onClick={() => onRegenerate(slide.id)}
                                            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                            title={t('actions.regenerateCode')}
                                        >
                                            <RefreshCw className="size-3.5" />
                                            {t('actions.regenerate')}
                                        </button>
                                    )}
                                </div>
                                <Editor
                                    height="400px"
                                    defaultLanguage="python"
                                    value={codeContent || ''}
                                    onChange={handleCodeChange}
                                    theme="vs-dark"
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 12,
                                        wordWrap: 'on',
                                    }}
                                />
                            </div>
                        </div>
                    );
                }

                // Topic pages - if they have code blocks and text content, show only Video Script and Code (NO Content section)
                if (slide.slideType === 'topic') {
                    // Check if topic has code blocks and text content
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = slide.content || '';
                    const codeBlocks = tempDiv.querySelectorAll('pre code, pre');

                    // Check if there's substantial text content (not just code)
                    let textWithoutCode = slide.content || '';
                    codeBlocks.forEach((block) => {
                        const blockHTML = block.outerHTML;
                        textWithoutCode = textWithoutCode.replace(blockHTML, '');
                    });
                    const textOnly = textWithoutCode.replace(/<[^>]*>/g, '').trim();
                    const hasTextContent = textOnly.length > 50; // At least 50 characters of text

                    // If topic has code blocks AND text content, render like video-code-editor (NO Content section)
                    // Use videoScriptContent and codeContent if available (from initialization), otherwise check content
                    if (
                        codeBlocks.length > 0 &&
                        hasTextContent &&
                        (videoScriptContent || codeContent || slide.content)
                    ) {
                        // Check if there's regular code to show in code editor
                        // Mermaid diagrams are already kept in videoScriptContent, so codeContent only has regular code
                        const hasRegularCode = codeContent && codeContent.trim().length > 0;

                        return (
                            <div className="ml-8 mt-3 space-y-4">
                                <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                                    <div className="mb-3 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Video className="size-4 text-red-600" />
                                            <Label className="text-sm font-semibold text-neutral-900">
                                                {t('labels.videoScript')}
                                            </Label>
                                        </div>
                                        {onRegenerate && (
                                            <button
                                                onClick={() => onRegenerate(slide.id, 'video')}
                                                className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                                title={t('actions.regenerateVideoScript')}
                                            >
                                                <RefreshCw className="size-3.5" />
                                                {t('actions.regenerate')}
                                            </button>
                                        )}
                                    </div>
                                    <Textarea
                                        value={videoScriptContent || ''}
                                        onChange={(e) => handleVideoScriptChange(e.target.value)}
                                        className="resize-y font-mono text-caption"
                                        style={{ minHeight: 300 }}
                                    />
                                </div>
                                {hasRegularCode && (
                                    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                                        <div className="mb-3 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Code className="size-4 text-green-600" />
                                                <Label className="text-sm font-semibold text-neutral-900">
                                                    {t('labels.codeSnippet')}
                                                </Label>
                                            </div>
                                            {onRegenerate && (
                                                <button
                                                    onClick={() => onRegenerate(slide.id, 'code')}
                                                    className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                                    title={t('actions.regenerateCode')}
                                                >
                                                    <RefreshCw className="size-3.5" />
                                                    {t('actions.regenerate')}
                                                </button>
                                            )}
                                        </div>
                                        <Editor
                                            height="400px"
                                            defaultLanguage="python"
                                            value={codeContent || ''}
                                            onChange={handleCodeChange}
                                            theme="vs-dark"
                                            options={{
                                                minimap: { enabled: false },
                                                fontSize: 12,
                                                wordWrap: 'on',
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    } else {
                        // Topic without video script + code - parse and show all sections editable
                        const sections =
                            editedSections.length > 0
                                ? editedSections
                                : parseContent(slide.content || '');

                        console.log('🔵 [SortableSlideItem] Sections parsed for slide:', {
                            slideId: slide.id,
                            slideType: slide.slideType,
                            contentLength: slide.content?.length || 0,
                            sectionsCount: sections.length,
                            sections: sections.map((s) => ({
                                type: s.type,
                                label: s.label,
                                contentLength: s.content?.length || 0,
                            })),
                        });

                        return (
                            <div className="ml-8 mt-3 space-y-4">
                                {sections.map((section, idx) => (
                                    <div
                                        key={idx}
                                        className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
                                    >
                                        <div className="mb-3 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {section.type === 'video-script' && (
                                                    <Video className="size-4 text-red-600" />
                                                )}
                                                {section.type === 'code' && (
                                                    <Code className="size-4 text-green-600" />
                                                )}
                                                {section.type === 'mermaid' && (
                                                    <Layers className="size-4 text-purple-600" />
                                                )}
                                                {section.type === 'text' && (
                                                    <FileText className="size-4 text-blue-600" />
                                                )}
                                                <Label className="text-sm font-semibold text-neutral-900">
                                                    {section.label}
                                                </Label>
                                            </div>
                                            {onRegenerate && (
                                                <button
                                                    onClick={() => onRegenerate(slide.id)}
                                                    className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                                    title={t('actions.regenerateSection', { label: section.label })}
                                                >
                                                    <RefreshCw className="size-3.5" />
                                                    {t('actions.regenerate')}
                                                </button>
                                            )}
                                        </div>

                                        {section.type === 'text' ||
                                        section.type === 'video-script' ? (
                                            <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
                                                <DocumentWithMermaidSimple
                                                    htmlContent={section.content}
                                                    className="prose max-w-none"
                                                />
                                            </div>
                                        ) : section.type === 'mermaid' ? (
                                            <div className="space-y-4">
                                                {/* Mermaid Diagram Preview */}
                                                {section.content ? (
                                                    <div className="rounded border border-neutral-200 bg-white p-4">
                                                        <Label className="mb-2 block text-xs text-neutral-600">
                                                            {t('labels.diagramPreview')}
                                                        </Label>
                                                        <MermaidDiagram code={section.content} />
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-red-500">
                                                        {t('status.mermaidSectionEmpty')}
                                                    </div>
                                                )}
                                                {/* Collapsible Mermaid Code Editor */}
                                                <div className="overflow-hidden rounded border border-neutral-200">
                                                    <button
                                                        onClick={() => {
                                                            setExpandedMermaidEditors((prev) => {
                                                                const newSet = new Set(prev);
                                                                if (newSet.has(idx)) {
                                                                    newSet.delete(idx);
                                                                } else {
                                                                    newSet.add(idx);
                                                                }
                                                                return newSet;
                                                            });
                                                        }}
                                                        className="flex w-full items-center justify-between bg-neutral-50 p-2 transition-colors hover:bg-neutral-100"
                                                    >
                                                        <Label className="text-xs font-semibold text-neutral-600">
                                                            {t('labels.mermaidCode')}
                                                        </Label>
                                                        {expandedMermaidEditors.has(idx) ? (
                                                            <ChevronUp className="size-4 text-neutral-600" />
                                                        ) : (
                                                            <ChevronDown className="size-4 text-neutral-600" />
                                                        )}
                                                    </button>
                                                    {expandedMermaidEditors.has(idx) && (
                                                        <Editor
                                                            height="400px"
                                                            defaultLanguage="mermaid"
                                                            value={section.content}
                                                            onChange={(value) =>
                                                                handleDocumentSectionChange(
                                                                    idx,
                                                                    value || ''
                                                                )
                                                            }
                                                            theme="vs-dark"
                                                            options={{
                                                                minimap: { enabled: false },
                                                                fontSize: 12,
                                                                wordWrap: 'on',
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <Editor
                                                height="400px"
                                                defaultLanguage="python"
                                                value={section.content}
                                                onChange={(value) =>
                                                    handleDocumentSectionChange(idx, value || '')
                                                }
                                                theme="vs-dark"
                                                options={{
                                                    minimap: { enabled: false },
                                                    fontSize: 12,
                                                    wordWrap: 'on',
                                                }}
                                            />
                                        )}
                                    </div>
                                ))}
                            </div>
                        );
                    }
                }

                // VIDEO_CODE - YouTube video + code editor (split layout)
                if (slide.slideType === 'video-code') {
                    let videoData: any = null;
                    let codeData: any = null;

                    try {
                        const contentData = slide.content ? JSON.parse(slide.content) : null;
                        if (contentData) {
                            videoData = contentData.video;
                            codeData = contentData.code;
                        }
                    } catch (e) {
                        // Not JSON, try HTML parsing
                        const textContent = slide.content || '';
                        // Extract Code
                        const htmlCodeMatch = textContent.match(
                            /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/i
                        );
                        if (htmlCodeMatch && htmlCodeMatch[1]) {
                            codeData = {
                                content: htmlCodeMatch[1],
                                language: 'python', // default
                            };
                            // Try to extract language class
                            const langMatch = textContent.match(/<code class="language-([a-z]+)"/i);
                            if (langMatch && langMatch[1]) {
                                codeData.language = langMatch[1];
                            }
                        } else {
                            // Try markdown
                            const codeMatch = textContent.match(
                                /```(?:python|javascript|typescript|java|html|css)?\s*\n?([\s\S]*?)\n?```/
                            );
                            if (codeMatch && codeMatch[1]) {
                                codeData = {
                                    content: codeMatch[1],
                                    language: codeMatch[1] || 'python',
                                };
                            }
                        }

                        // Extract Video
                        const iframeMatch = textContent.match(/<iframe[^>]*src="([^"]*)"[^>]*>/i);
                        if (iframeMatch && iframeMatch[1]) {
                            videoData = { url: iframeMatch[1] };
                        } else {
                            // Try YouTube regex
                            const youtubeMatch = textContent.match(
                                /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+)/
                            );
                            if (youtubeMatch) {
                                videoData = {
                                    url: `https://www.youtube.com/embed/${youtubeMatch[1]}`,
                                };
                            }
                        }
                    }

                    const videoUrl = videoData?.embedUrl || videoData?.url || '';
                    const codeContent = codeData?.content || '';
                    const codeLanguage = codeData?.language || 'python';

                    // Extract video ID from URL for thumbnail fallback
                    const getVideoIdFromUrl = (url: string | undefined) => {
                        if (!url) return null;
                        const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
                        if (embedMatch) return embedMatch[1];
                        const watchMatch = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
                        if (watchMatch) return watchMatch[1];
                        const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
                        if (shortMatch) return shortMatch[1];
                        const idMatch = url.match(/([a-zA-Z0-9_-]{11})/);
                        if (idMatch) return idMatch[1];
                        return null;
                    };

                    const videoId = videoUrl ? getVideoIdFromUrl(videoUrl) : null;
                    const watchUrl = videoId
                        ? `https://www.youtube.com/watch?v=${videoId}`
                        : videoUrl || '#';
                    const thumbnailUrl = videoId
                        ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
                        : null;

                    // Extract code from markdown/HTML - look for Python code blocks first
                    let cleanCode = codeContent;
                    if (codeContent.includes('```')) {
                        // Try to extract Python code blocks
                        const pythonCodeMatch = codeContent.match(
                            /```python\s*\n?([\s\S]*?)\n?```/
                        );
                        if (pythonCodeMatch && pythonCodeMatch[1]) {
                            cleanCode = pythonCodeMatch[1].trim();
                        } else {
                            // Try other language code blocks
                            const codeMatch = codeContent.match(
                                /```(?:javascript|typescript|java|html|css)?\s*\n?([\s\S]*?)\n?```/
                            );
                            if (codeMatch && codeMatch[1]) {
                                cleanCode = codeMatch[1].trim();
                            } else {
                                // If wrapped in markdown code block, extract inner content
                                const markdownMatch = codeContent.match(
                                    /```markdown\s*\n?([\s\S]*?)\n?```/
                                );
                                if (markdownMatch && markdownMatch[1]) {
                                    // Extract Python code from the HTML/markdown
                                    const innerContent = markdownMatch[1];
                                    const innerPythonMatch = innerContent.match(
                                        /```python\s*\n?([\s\S]*?)\n?```/
                                    );
                                    if (innerPythonMatch && innerPythonMatch[1]) {
                                        cleanCode = innerPythonMatch[1].trim();
                                    } else {
                                        cleanCode = innerContent.trim();
                                    }
                                }
                            }
                        }
                    }

                    return (
                        <div className="ml-8 mt-3">
                            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                                {onRegenerate && (
                                    <div className="mb-3 flex justify-end">
                                        <button
                                            onClick={() => onRegenerate(slide.id)}
                                            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                            title={t('actions.regenerateContent')}
                                        >
                                            <RefreshCw className="size-3.5" />
                                            {t('actions.regenerate')}
                                        </button>
                                    </div>
                                )}
                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    {/* Video Section */}
                                    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white p-4">
                                        <div className="mb-3 flex items-center gap-2">
                                            <Video className="size-4 text-red-600" />
                                            <Label className="text-sm font-semibold text-neutral-900">
                                                {t('labels.video')}
                                            </Label>
                                        </div>
                                        {/* Try iframe first, show thumbnail only if iframe fails */}
                                        {videoUrl && videoId && !iframeFailures[slide.id] ? (
                                            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                                                <iframe
                                                    ref={(el) => {
                                                        if (el) {
                                                            iframeRefs.current[slide.id] = el;
                                                            // Clear any existing timeout
                                                            if (iframeTimeouts.current[slide.id]) {
                                                                clearTimeout(
                                                                    iframeTimeouts.current[
                                                                        slide.id
                                                                    ]!
                                                                );
                                                            }
                                                            // Set timeout - if iframe doesn't load within 2 seconds, show fallback
                                                            // YouTube iframes can load but be blocked, so we check after short delay
                                                            // Reduced timeout to 2 seconds for faster fallback
                                                            iframeTimeouts.current[slide.id] =
                                                                setTimeout(() => {
                                                                    const iframe =
                                                                        iframeRefs.current[
                                                                            slide.id
                                                                        ];
                                                                    if (
                                                                        iframe &&
                                                                        !iframeFailures[slide.id]
                                                                    ) {
                                                                        console.log(
                                                                            'Iframe timeout for VIDEO_CODE - YouTube may be blocking embedding, showing thumbnail fallback'
                                                                        );
                                                                        setIframeFailures(
                                                                            (prev) => ({
                                                                                ...prev,
                                                                                [slide.id]: true,
                                                                            })
                                                                        );
                                                                    }
                                                                }, 2000);
                                                        }
                                                    }}
                                                    src={videoUrl}
                                                    className="absolute inset-0 size-full"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                    onError={() => {
                                                        console.log(
                                                            'Iframe embedding failed, showing thumbnail fallback'
                                                        );
                                                        if (iframeTimeouts.current[slide.id]) {
                                                            clearTimeout(
                                                                iframeTimeouts.current[slide.id]!
                                                            );
                                                        }
                                                        setIframeFailures((prev) => ({
                                                            ...prev,
                                                            [slide.id]: true,
                                                        }));
                                                    }}
                                                    // Removed onLoad handler - YouTube iframes can fire onLoad even when blocked,
                                                    // which prevents the timeout-based fallback from working
                                                />
                                            </div>
                                        ) : videoUrl && videoId && iframeFailures[slide.id] ? (
                                            <div className="group relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                                                <img
                                                    src={
                                                        thumbnailUrl ||
                                                        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
                                                    }
                                                    alt={t('alt.videoThumbnail')}
                                                    className="size-full object-cover"
                                                    onError={(e) => {
                                                        const img = e.target as HTMLImageElement;
                                                        if (img.src.includes('maxresdefault')) {
                                                            img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
                                                        } else if (img.src.includes('hqdefault')) {
                                                            img.src =
                                                                'https://via.placeholder.com/1280x720/1a1a1a/ffffff?text=YouTube+Video';
                                                        }
                                                    }}
                                                />
                                                {/* Play button overlay */}
                                                <a
                                                    href={watchUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/40 transition-colors group-hover:bg-black/60"
                                                >
                                                    <div className="rounded-full bg-red-600 p-4 transition-transform group-hover:scale-110">
                                                        <svg
                                                            className="size-8 fill-current text-white"
                                                            viewBox="0 0 24 24"
                                                        >
                                                            <path d="M8 5v14l11-7z" />
                                                        </svg>
                                                    </div>
                                                </a>
                                                {/* "Watch on YouTube" text */}
                                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                                                    <a
                                                        href={watchUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-2 text-sm font-semibold text-white transition-colors hover:text-yellow-300"
                                                    >
                                                        {t('actions.watchOnYoutube')}
                                                    </a>
                                                </div>
                                            </div>
                                        ) : videoUrl ? (
                                            // Fallback: if videoUrl exists but no videoId, try iframe with timeout
                                            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
                                                <iframe
                                                    ref={(el) => {
                                                        if (el) {
                                                            iframeRefs.current[slide.id] = el;
                                                            if (iframeTimeouts.current[slide.id]) {
                                                                clearTimeout(
                                                                    iframeTimeouts.current[
                                                                        slide.id
                                                                    ]!
                                                                );
                                                            }
                                                            // For videos without videoId, use 2 second timeout
                                                            iframeTimeouts.current[slide.id] =
                                                                setTimeout(() => {
                                                                    if (!iframeFailures[slide.id]) {
                                                                        console.log(
                                                                            'Iframe timeout for VIDEO_CODE (no videoId) - showing fallback'
                                                                        );
                                                                        setIframeFailures(
                                                                            (prev) => ({
                                                                                ...prev,
                                                                                [slide.id]: true,
                                                                            })
                                                                        );
                                                                    }
                                                                }, 2000);
                                                        }
                                                    }}
                                                    src={videoUrl}
                                                    className="absolute inset-0 size-full"
                                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                    allowFullScreen
                                                    onError={() => {
                                                        console.log(
                                                            'Iframe embedding failed for VIDEO_CODE'
                                                        );
                                                        if (iframeTimeouts.current[slide.id]) {
                                                            clearTimeout(
                                                                iframeTimeouts.current[slide.id]!
                                                            );
                                                        }
                                                        setIframeFailures((prev) => ({
                                                            ...prev,
                                                            [slide.id]: true,
                                                        }));
                                                    }}
                                                    onLoad={() => {
                                                        if (iframeTimeouts.current[slide.id]) {
                                                            clearTimeout(
                                                                iframeTimeouts.current[slide.id]!
                                                            );
                                                        }
                                                    }}
                                                />
                                            </div>
                                        ) : (
                                            <div className="flex h-48 items-center justify-center rounded bg-neutral-100 text-sm text-neutral-500">
                                                {t('status.noVideoAvailable')}
                                            </div>
                                        )}
                                    </div>

                                    {/* Code Section */}
                                    <div className="flex flex-col rounded-lg border border-neutral-200 bg-white p-4">
                                        <div className="mb-3 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Code className="size-4 text-green-600" />
                                                <Label className="text-sm font-semibold text-neutral-900">
                                                    {t('labels.code')}
                                                </Label>
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    const currentCode =
                                                        editorRefs.current[slide.id]?.getValue() ||
                                                        cleanCode;
                                                    const slideId = slide.id;

                                                    // Use flushSync to ensure state updates immediately and UI reflects the change
                                                    flushSync(() => {
                                                        // Set local running state immediately for instant UI feedback
                                                        setLocalRunning((prev) => ({
                                                            ...prev,
                                                            [slideId]: true,
                                                        }));
                                                        setCodeOutput((prev) => {
                                                            const newState = { ...prev };
                                                            // Set isExpanded: true so output panel shows immediately
                                                            newState[slideId] = {
                                                                output: '',
                                                                isRunning: true,
                                                                isExpanded: true,
                                                            };
                                                            return newState;
                                                        });
                                                    });

                                                    try {
                                                        // Normalize language to 'python' if it's not supported
                                                        const normalizedLanguage =
                                                            codeLanguage.toLowerCase() === 'python'
                                                                ? 'python'
                                                                : 'python';
                                                        const result = await executeCode(
                                                            currentCode,
                                                            normalizedLanguage as any,
                                                            {},
                                                            tCodeEditorUtils,
                                                            i18n.language
                                                        );
                                                        setLocalRunning((prev) => ({
                                                            ...prev,
                                                            [slideId]: false,
                                                        }));
                                                        setCodeOutput((prev) => ({
                                                            ...prev,
                                                            [slideId]: {
                                                                output: result.output,
                                                                isRunning: false,
                                                                isExpanded: true,
                                                            },
                                                        }));
                                                    } catch (error) {
                                                        setLocalRunning((prev) => ({
                                                            ...prev,
                                                            [slideId]: false,
                                                        }));
                                                        setCodeOutput((prev) => ({
                                                            ...prev,
                                                            [slideId]: {
                                                                output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                                                                isRunning: false,
                                                                isExpanded: true,
                                                            },
                                                        }));
                                                    }
                                                }}
                                                disabled={
                                                    (codeOutput[slide.id]?.isRunning ||
                                                        localRunning[slide.id]) === true
                                                }
                                                className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {codeOutput[slide.id]?.isRunning ||
                                                localRunning[slide.id] ? (
                                                    <>
                                                        <Loader2 className="size-3.5 animate-spin" />
                                                        {t('actions.running')}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Play className="size-3.5" />
                                                        {t('actions.runCode')}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                        <div className="flex min-h-0 flex-1 flex-col">
                                            <div className="min-h-0 flex-1">
                                                <Editor
                                                    height="400px"
                                                    defaultLanguage={codeLanguage}
                                                    value={cleanCode}
                                                    onChange={handleCodeChange}
                                                    onMount={(editor) => {
                                                        editorRefs.current[slide.id] = editor;
                                                    }}
                                                    theme="vs-dark"
                                                    options={{
                                                        minimap: { enabled: false },
                                                        fontSize: 12,
                                                        wordWrap: 'on',
                                                    }}
                                                />
                                            </div>
                                            {/* Output Panel - show immediately when running, or when there's output AND slide is expanded */}
                                            {(codeOutput[slide.id]?.isRunning ||
                                                localRunning[slide.id] ||
                                                (isExpanded &&
                                                    codeOutput[slide.id]?.output &&
                                                    codeOutput[slide.id]?.isExpanded)) && (
                                                <div className="mt-3 border-t border-neutral-200">
                                                    <div className="flex items-center justify-between bg-neutral-50 px-3 py-2">
                                                        <span className="text-xs font-medium text-neutral-700">
                                                            {t('labels.output')}
                                                        </span>
                                                        {!(
                                                            codeOutput[slide.id]?.isRunning ||
                                                            localRunning[slide.id]
                                                        ) && (
                                                            <button
                                                                onClick={() => {
                                                                    setCodeOutput((prev) => {
                                                                        const current =
                                                                            prev[slide.id];
                                                                        if (!current) return prev;
                                                                        return {
                                                                            ...prev,
                                                                            [slide.id]: {
                                                                                ...current,
                                                                                isExpanded: false,
                                                                            },
                                                                        };
                                                                    });
                                                                }}
                                                                className="text-neutral-500 hover:text-neutral-700"
                                                            >
                                                                <XIcon className="size-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="max-h-48 overflow-y-auto bg-neutral-900 p-3">
                                                        <pre className="whitespace-pre-wrap font-mono text-xs text-green-400">
                                                            {codeOutput[slide.id]?.isRunning ||
                                                            localRunning[slide.id]
                                                                ? t('status.loadingPythonEnv')
                                                                : codeOutput[slide.id]?.output ||
                                                                  t('status.noOutputYet')}
                                                        </pre>
                                                    </div>
                                                </div>
                                            )}
                                            {!codeOutput[slide.id]?.isExpanded &&
                                                codeOutput[slide.id]?.output &&
                                                !codeOutput[slide.id]?.isRunning &&
                                                !localRunning[slide.id] && (
                                                    <button
                                                        onClick={() => {
                                                            setCodeOutput((prev) => {
                                                                const current = prev[slide.id];
                                                                if (!current) return prev;
                                                                return {
                                                                    ...prev,
                                                                    [slide.id]: {
                                                                        ...current,
                                                                        isExpanded: true,
                                                                    },
                                                                };
                                                            });
                                                        }}
                                                        className="mt-3 text-xs text-indigo-600 hover:text-indigo-700"
                                                    >
                                                        {t('actions.showOutput')}
                                                    </button>
                                                )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                }

                // AI_VIDEO_CODE - AI video + code editor (split layout)
                if (slide.slideType === 'ai-video-code') {
                    let videoData: any = null;
                    let codeData: any = null;

                    try {
                        const contentData = slide.content ? JSON.parse(slide.content) : null;
                        if (contentData) {
                            videoData = contentData.video;
                            codeData = contentData.code;
                        }
                    } catch (e) {
                        // Not JSON, try HTML parsing
                        const textContent = slide.content || '';

                        // Extract Code
                        const htmlCodeMatch = textContent.match(
                            /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/i
                        );
                        if (htmlCodeMatch && htmlCodeMatch[1]) {
                            codeData = {
                                content: htmlCodeMatch[1],
                                language: 'python',
                            };
                            const langMatch = textContent.match(/<code class="language-([a-z]+)"/i);
                            if (langMatch && langMatch[1]) {
                                codeData.language = langMatch[1];
                            }
                        } else {
                            const codeMatch = textContent.match(
                                /```(?:python|javascript|typescript|java|html|css)?\s*\n?([\s\S]*?)\n?```/
                            );
                            if (codeMatch && codeMatch[1]) {
                                codeData = { content: codeMatch[1], language: 'python' };
                            }
                        }

                        // Extract AI Video Data
                        // Check for marker logic or data-video-id
                        const aiVideoMatch = textContent.match(/\[AI Video: ([^\]]+)\]/);
                        const dataVideoIdMatch = textContent.match(/data-video-id="([^"]+)"/);

                        const aiVideoId = aiVideoMatch?.[1] || dataVideoIdMatch?.[1];

                        if (aiVideoId) {
                            // We reconstruct incomplete videoData, hoping checking for status will use slide.aiVideoData if missing
                            videoData = { status: 'COMPLETED', videoId: aiVideoId };
                            // If we are lucky, slide.aiVideoData is still preserved on the slide object itself if we need timelineUrl
                        }
                    }

                    // Fallback to slide-level AI data if we found an ID but missing details in parsed content,
                    // OR if we didn't find anything in content but slide has aiVideoData
                    if (slide.aiVideoData?.videoId) {
                        if (!videoData) videoData = {};
                        if (!videoData.timelineUrl)
                            videoData.timelineUrl = slide.aiVideoData.timelineUrl;
                        if (!videoData.audioUrl) videoData.audioUrl = slide.aiVideoData.audioUrl;
                        if (!videoData.status) videoData.status = 'COMPLETED';
                    }

                    const codeContent = codeData?.content || '';
                    const codeLanguage = codeData?.language || 'python';

                    // Extract code from markdown - look for Python code blocks first
                    let cleanCode = codeContent;
                    if (codeContent.includes('```')) {
                        // Try to extract Python code blocks
                        const pythonCodeMatch = codeContent.match(
                            /```python\s*\n?([\s\S]*?)\n?```/
                        );
                        if (pythonCodeMatch && pythonCodeMatch[1]) {
                            cleanCode = pythonCodeMatch[1].trim();
                        } else {
                            // Try other language code blocks
                            const codeMatch = codeContent.match(
                                /```(?:javascript|typescript|java|html|css)?\s*\n?([\s\S]*?)\n?```/
                            );
                            if (codeMatch && codeMatch[1]) {
                                cleanCode = codeMatch[1].trim();
                            }
                        }
                    }

                    // Check if AI video is ready
                    const isVideoReady =
                        videoData?.status === 'COMPLETED' &&
                        videoData?.timelineUrl &&
                        videoData?.audioUrl;
                    const hasScript = slide.aiVideoData?.scriptUrl;
                    const isGenerating = (slide.status as string) === 'generating';
                    // Show script if scriptUrl is available and video is not ready
                    const shouldShowScript = hasScript && !isVideoReady;

                    return (
                        <div className="ml-8 mt-3">
                            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                                {onRegenerate && (
                                    <div className="mb-3 flex justify-end">
                                        <button
                                            onClick={() => onRegenerate(slide.id)}
                                            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                            title={t('actions.regenerateContent')}
                                        >
                                            <RefreshCw className="size-3.5" />
                                            {t('actions.regenerate')}
                                        </button>
                                    </div>
                                )}

                                {/* Show script when available and video is not ready */}
                                {shouldShowScript && slide.aiVideoData?.scriptUrl && (
                                    <div className="mb-4">
                                        <ScriptDisplay scriptUrl={slide.aiVideoData.scriptUrl} />
                                    </div>
                                )}

                                {/* Only show loader when actively generating, not when pending */}
                                {isGenerating && !hasScript && !isVideoReady && (
                                    <div className="mb-4 flex items-center gap-2">
                                        <Loader2 className="size-4 animate-spin text-indigo-600" />
                                        <span className="text-sm text-neutral-600">
                                            {t('status.generatingVideoProgress', { progress: slide.progress || 0 })}
                                        </span>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                    {/* AI Video Section */}
                                    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white p-4">
                                        <div className="mb-3 flex items-center gap-2">
                                            <Video className="size-4 text-purple-600" />
                                            <Label className="text-sm font-semibold text-neutral-900">
                                                {t('labels.aiVideo')}
                                            </Label>
                                        </div>
                                        {isVideoReady &&
                                        videoData?.timelineUrl &&
                                        videoData?.audioUrl ? (
                                            <div className="aspect-video w-full">
                                                <AIVideoPlayer
                                                    timelineUrl={videoData.timelineUrl}
                                                    audioUrl={videoData.audioUrl}
                                                />
                                            </div>
                                        ) : videoData?.status === 'GENERATING' ? (
                                            <div className="flex h-48 flex-col items-center justify-center rounded bg-neutral-100">
                                                <Loader2 className="mb-2 size-6 animate-spin text-indigo-600" />
                                                <span className="text-sm text-neutral-600">
                                                    {t('status.generatingVideoProgress', { progress: videoData.progress || 0 })}
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="flex h-48 items-center justify-center rounded bg-neutral-100 text-sm text-neutral-500">
                                                {t('status.videoNotAvailableYet')}
                                            </div>
                                        )}
                                    </div>

                                    {/* Code Section */}
                                    <div className="flex flex-col rounded-lg border border-neutral-200 bg-white p-4">
                                        <div className="mb-3 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <Code className="size-4 text-green-600" />
                                                <Label className="text-sm font-semibold text-neutral-900">
                                                    {t('labels.code')}
                                                </Label>
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    const currentCode =
                                                        editorRefs.current[slide.id]?.getValue() ||
                                                        cleanCode;
                                                    const slideId = slide.id;

                                                    // Use flushSync to ensure state updates immediately and UI reflects the change
                                                    flushSync(() => {
                                                        // Set local running state immediately for instant UI feedback
                                                        setLocalRunning((prev) => ({
                                                            ...prev,
                                                            [slideId]: true,
                                                        }));
                                                        setCodeOutput((prev) => {
                                                            const newState = { ...prev };
                                                            // Set isExpanded: true so output panel shows immediately
                                                            newState[slideId] = {
                                                                output: '',
                                                                isRunning: true,
                                                                isExpanded: true,
                                                            };
                                                            return newState;
                                                        });
                                                    });

                                                    try {
                                                        // Normalize language to 'python' if it's not supported
                                                        const normalizedLanguage =
                                                            codeLanguage.toLowerCase() === 'python'
                                                                ? 'python'
                                                                : 'python';
                                                        const result = await executeCode(
                                                            currentCode,
                                                            normalizedLanguage as any,
                                                            {},
                                                            tCodeEditorUtils,
                                                            i18n.language
                                                        );
                                                        setLocalRunning((prev) => ({
                                                            ...prev,
                                                            [slideId]: false,
                                                        }));
                                                        setCodeOutput((prev) => ({
                                                            ...prev,
                                                            [slideId]: {
                                                                output: result.output,
                                                                isRunning: false,
                                                                isExpanded: true,
                                                            },
                                                        }));
                                                    } catch (error) {
                                                        setLocalRunning((prev) => ({
                                                            ...prev,
                                                            [slideId]: false,
                                                        }));
                                                        setCodeOutput((prev) => ({
                                                            ...prev,
                                                            [slideId]: {
                                                                output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                                                                isRunning: false,
                                                                isExpanded: true,
                                                            },
                                                        }));
                                                    }
                                                }}
                                                disabled={
                                                    (codeOutput[slide.id]?.isRunning ||
                                                        localRunning[slide.id]) === true
                                                }
                                                className="flex items-center gap-1.5 rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {codeOutput[slide.id]?.isRunning ||
                                                localRunning[slide.id] ? (
                                                    <>
                                                        <Loader2 className="size-3.5 animate-spin" />
                                                        {t('actions.running')}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Play className="size-3.5" />
                                                        {t('actions.runCode')}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                        <div className="flex min-h-0 flex-1 flex-col">
                                            <div className="min-h-0 flex-1">
                                                <Editor
                                                    height="400px"
                                                    defaultLanguage={codeLanguage}
                                                    value={cleanCode}
                                                    onChange={handleCodeChange}
                                                    onMount={(editor) => {
                                                        editorRefs.current[slide.id] = editor;
                                                    }}
                                                    theme="vs-dark"
                                                    options={{
                                                        minimap: { enabled: false },
                                                        fontSize: 12,
                                                        wordWrap: 'on',
                                                    }}
                                                />
                                            </div>
                                            {/* Output Panel - show immediately when running, or when there's output AND slide is expanded */}
                                            {(codeOutput[slide.id]?.isRunning ||
                                                localRunning[slide.id] ||
                                                (isExpanded &&
                                                    codeOutput[slide.id]?.output &&
                                                    codeOutput[slide.id]?.isExpanded)) && (
                                                <div className="mt-3 border-t border-neutral-200">
                                                    <div className="flex items-center justify-between bg-neutral-50 px-3 py-2">
                                                        <span className="text-xs font-medium text-neutral-700">
                                                            {t('labels.output')}
                                                        </span>
                                                        {!(
                                                            codeOutput[slide.id]?.isRunning ||
                                                            localRunning[slide.id]
                                                        ) && (
                                                            <button
                                                                onClick={() => {
                                                                    setCodeOutput((prev) => {
                                                                        const current =
                                                                            prev[slide.id];
                                                                        if (!current) return prev;
                                                                        return {
                                                                            ...prev,
                                                                            [slide.id]: {
                                                                                ...current,
                                                                                isExpanded: false,
                                                                            },
                                                                        };
                                                                    });
                                                                }}
                                                                className="text-neutral-500 hover:text-neutral-700"
                                                            >
                                                                <XIcon className="size-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="max-h-48 overflow-y-auto bg-neutral-900 p-3">
                                                        <pre className="whitespace-pre-wrap font-mono text-xs text-green-400">
                                                            {codeOutput[slide.id]?.isRunning ||
                                                            localRunning[slide.id]
                                                                ? t('status.loadingPythonEnv')
                                                                : codeOutput[slide.id]?.output ||
                                                                  t('status.noOutputYet')}
                                                        </pre>
                                                    </div>
                                                </div>
                                            )}
                                            {!codeOutput[slide.id]?.isExpanded &&
                                                codeOutput[slide.id]?.output &&
                                                !codeOutput[slide.id]?.isRunning &&
                                                !localRunning[slide.id] && (
                                                    <button
                                                        onClick={() => {
                                                            setCodeOutput((prev) => {
                                                                const current = prev[slide.id];
                                                                if (!current) return prev;
                                                                return {
                                                                    ...prev,
                                                                    [slide.id]: {
                                                                        ...current,
                                                                        isExpanded: true,
                                                                    },
                                                                };
                                                            });
                                                        }}
                                                        className="mt-3 text-xs text-indigo-600 hover:text-indigo-700"
                                                    >
                                                        {t('actions.showOutput')}
                                                    </button>
                                                )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                }

                // Document pages (doc, objectives) - render content in Yoopta editor with mermaid support
                if (slide.slideType === 'objectives' || slide.slideType === 'doc') {
                    let content = slide.content || '';

                    // CRITICAL FIX: If content is Yoopta clipboard format with empty content, use prompt instead
                    // This prevents showing blank editor when content was overwritten with clipboard format
                    if (
                        content &&
                        (content.includes('id="yoopta-clipboard"') ||
                            content.includes('data-editor-id'))
                    ) {
                        // Extract actual content from clipboard format
                        const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                        if (bodyMatch && bodyMatch[1]) {
                            const extractedContent = bodyMatch[1].trim();
                            // Check if content is effectively empty (only whitespace or empty tags)
                            const textContent = extractedContent.replace(/<[^>]*>/g, '').trim();
                            if (!textContent || textContent === '') {
                                // Content is empty clipboard format - use prompt or empty string
                                console.warn(
                                    '⚠️ [SortableSlideItem] Content is empty clipboard format, using prompt or empty'
                                );
                                content = slide.prompt ? markdownToHtml(slide.prompt) : '';
                            } else {
                                content = extractedContent;
                            }
                        } else {
                            // No body tag match - content is likely empty, use prompt
                            content = slide.prompt ? markdownToHtml(slide.prompt) : '';
                        }
                    } else {
                        // Normalize content (markdown -> html)
                        content = markdownToHtml(content);
                    }

                    return (
                        <div className="ml-8 mt-3">
                            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                                {onRegenerate && (
                                    <div className="mb-3 flex justify-end">
                                        <button
                                            onClick={() => onRegenerate(slide.id)}
                                            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                            title={t('actions.regenerateContent')}
                                        >
                                            <RefreshCw className="size-3.5" />
                                            {t('actions.regenerate')}
                                        </button>
                                    </div>
                                )}
                                <div
                                    className="rounded-lg border border-neutral-200 bg-white p-4"
                                    style={{ maxWidth: '100%', overflow: 'hidden' }}
                                >
                                    <HtmlDocField
                                        value={content}
                                        onChange={handleContentChange}
                                        minHeight={400}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                }

                // Quiz - editable document format with correct answers shown
                if (slide.slideType === 'quiz' || slide.slideType === 'assessment') {
                    return (
                        <div className="ml-8 mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                            <div className="mb-4 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <FileQuestion className="size-4 text-purple-600" />
                                    <Label className="text-sm font-semibold text-neutral-900">
                                        {t('labels.quizContent')}
                                    </Label>
                                </div>
                                {onRegenerate && (
                                    <button
                                        onClick={() => onRegenerate(slide.id)}
                                        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                        title={t('actions.regenerateQuiz')}
                                    >
                                        <RefreshCw className="size-3.5" />
                                        {t('actions.regenerate')}
                                    </button>
                                )}
                            </div>
                            <div className="rounded-lg border border-neutral-200 bg-white p-4">
                                <Textarea
                                    value={quizHTML}
                                    onChange={(e) => handleQuizContentChange(e.target.value)}
                                    className="resize-y font-mono text-caption"
                                    style={{ minHeight: 400 }}
                                />
                                <p className="mt-2 text-xs text-neutral-500">
                                    <strong>{t('quizNote.label')}</strong> {t('quizNote.body')}
                                </p>
                            </div>
                        </div>
                    );
                }

                // Assignment/Homework - editable text
                if (slide.slideType === 'homework' || slide.slideType === 'assignment') {
                    return (
                        <div className="ml-8 mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ClipboardList className="size-4 text-orange-600" />
                                    <Label className="text-sm font-semibold text-neutral-900">
                                        {t('labels.assignment')}
                                    </Label>
                                </div>
                                {onRegenerate && (
                                    <button
                                        onClick={() => onRegenerate(slide.id)}
                                        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                        title={t('actions.regenerateAssignment')}
                                    >
                                        <RefreshCw className="size-3.5" />
                                        {t('actions.regenerate')}
                                    </button>
                                )}
                            </div>
                            <HtmlDocField
                                value={slide.content || ''}
                                onChange={handleContentChange}
                                minHeight={300}
                            />
                        </div>
                    );
                }
            } catch (e) {
                return null;
            }
            return null;
        }, [
            isExpanded,
            slide.status,
            slide.content,
            slide.slideType,
            videoScriptContent,
            codeContent,
            mermaidContent,
            editedSections,
            handleVideoScriptChange,
            handleCodeChange,
            handleMermaidChange,
            handleDocumentSectionChange,
            handleContentChange,
            onRegenerate,
            parseContent,
            quizHTML,
            handleQuizContentChange,
        ]);

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
                        className="shrink-0 cursor-grab text-neutral-400 transition-opacity hover:text-neutral-600 active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100"
                    >
                        <GripVertical className="size-4" />
                    </button>

                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        {getSlideIcon(slide.slideType)}
                        {isEditing ? (
                            <Input
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleSaveEdit();
                                    if (e.key === 'Escape') handleCancelEdit();
                                }}
                                className="h-7 flex-1 text-sm"
                                autoFocus
                            />
                        ) : (
                            <span className="flex-1 truncate text-sm text-neutral-700">
                                {slide.slideTitle}
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        {/* AI Prompt Button - show if prompt exists (in outline mode or after generation) */}
                        {!isEditing && slide.prompt && (
                            <button
                                onClick={() => setShowPrompt(!showPrompt)}
                                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-50"
                                title={showPrompt ? t('actions.hideAiPrompt') : t('actions.viewAiPrompt')}
                            >
                                <Sparkles className="size-3.5" />
                                {showPrompt ? (
                                    <ChevronUp className="size-3" />
                                ) : (
                                    <ChevronDown className="size-3" />
                                )}
                            </button>
                        )}

                        {/* View Content Button - show if slide has content OR if it's AI_VIDEO with completed video */}
                        {!isEditing &&
                            ((slide.status === 'completed' && slide.content) ||
                                (slide.slideType === 'ai-video' &&
                                    slide.aiVideoData?.status === 'COMPLETED')) && (
                                <button
                                    onClick={() => {
                                        const newExpandedState = !isExpanded;
                                        setIsExpanded(newExpandedState);
                                        // Reset code output expanded state when collapsing slide
                                        if (!newExpandedState) {
                                            setCodeOutput((prev) => {
                                                const current = prev[slide.id];
                                                if (!current) return prev;
                                                return {
                                                    ...prev,
                                                    [slide.id]: { ...current, isExpanded: false },
                                                };
                                            });
                                        }
                                    }}
                                    className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                                    title={isExpanded ? t('actions.hideContent') : t('actions.viewContent')}
                                >
                                    <Eye className="size-3.5" />
                                    {isExpanded ? (
                                        <ChevronUp className="size-3" />
                                    ) : (
                                        <ChevronDown className="size-3" />
                                    )}
                                </button>
                            )}

                        {/* Edit and Delete buttons */}
                        {isEditing ? (
                            <>
                                <button
                                    onClick={handleSaveEdit}
                                    className="rounded p-1 text-xs text-indigo-600 hover:bg-indigo-50"
                                    title={t('actions.save')}
                                >
                                    <CheckCircle className="size-3.5" />
                                </button>
                                <button
                                    onClick={handleCancelEdit}
                                    className="rounded p-1 text-xs text-neutral-600 hover:bg-neutral-100"
                                    title={t('actions.cancel')}
                                >
                                    <X className="size-3.5" />
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="rounded p-1 text-xs text-indigo-600 transition-opacity hover:bg-indigo-50 md:opacity-0 md:group-hover:opacity-100"
                                    title={t('actions.edit')}
                                >
                                    <Edit2 className="size-3.5" />
                                </button>
                                <button
                                    onClick={() => setIsEditing(true)}
                                    className="rounded p-1 text-xs text-indigo-600 transition-opacity hover:bg-indigo-50 md:opacity-0 md:group-hover:opacity-100"
                                    title={t('actions.edit')}
                                >
                                    <Edit2 className="size-3.5" />
                                </button>
                                <button
                                    onClick={() => onDelete(slide.id)}
                                    className="rounded p-1 text-xs text-red-600 transition-opacity hover:bg-red-50 md:opacity-0 md:group-hover:opacity-100"
                                    title={t('actions.delete')}
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                            </>
                        )}

                        {/* Slide Progress - at extreme right */}
                        {slide.status === 'generating' && slide.progress < 100 && (
                            <CircularProgress value={slide.progress} size={24} strokeWidth={2.5} />
                        )}

                        {slide.status === 'completed' && (
                            <CheckCircle className="size-4 text-green-600" />
                        )}

                        {/* Don't show loader for pending status - only show when actively generating */}
                        {/* Loader will appear after clicking "Generate Content" button */}
                    </div>
                </div>

                {/* AI Prompt - show when toggled (in outline mode or after generation) */}
                {showPrompt && slide.prompt && (
                    <div className="ml-8 mt-3">
                        <div className="rounded-md border border-purple-200 bg-purple-50 p-4">
                            <div className="mb-3 flex items-center gap-2">
                                <Sparkles className="size-4 text-purple-600" />
                                <Label className="text-sm font-semibold text-purple-900">
                                    {t('labels.aiPrompt')}
                                </Label>
                            </div>
                            <div className="rounded-lg border border-purple-200 bg-white p-4">
                                <Textarea
                                    value={slide.prompt}
                                    readOnly
                                    className="resize-y bg-neutral-50 font-mono text-caption"
                                    style={{ minHeight: 200 }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Content - show when expanded */}
                {isExpanded && renderContent}
            </div>
        );
    },
    (prevProps, nextProps) => {
        // Custom comparison function to prevent unnecessary re-renders
        // Return true if props are equal (skip re-render), false if they differ (re-render)
        return (
            prevProps.slide.id === nextProps.slide.id &&
            prevProps.slide.status === nextProps.slide.status &&
            prevProps.slide.content === nextProps.slide.content &&
            prevProps.slide.slideTitle === nextProps.slide.slideTitle &&
            prevProps.slide.progress === nextProps.slide.progress &&
            prevProps.slide.slideType === nextProps.slide.slideType
        );
    }
);
