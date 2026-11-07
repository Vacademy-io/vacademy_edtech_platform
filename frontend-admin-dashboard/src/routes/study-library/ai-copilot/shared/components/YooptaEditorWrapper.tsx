import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createYooptaEditor } from '@yoopta/editor';
import { html } from '@yoopta/exports';
import { plugins, TOOLS, MARKS } from '@/constants/study-library/yoopta-editor-plugins-tools';
import YooptaEditor from '@yoopta/editor';
import { markdownToHtml } from '../utils/markdownToHtml';
import { DocumentWithMermaidSimple } from './DocumentWithMermaid';

interface YooptaEditorWrapperProps {
    value: string; // HTML string from API
    onChange: (html: string) => void; // Callback with HTML string
    placeholder?: string;
    minHeight?: number | string;
    className?: string;
    editable?: boolean;
    onBlur?: () => void;
}

// Helper function to check if a string is plain text (not HTML)
function isPlainText(str: string): boolean {
    if (!str) return true;
    const trimmed = str.trim();
    // Check if string contains HTML tags
    const htmlTagPattern = /<[^>]+>/;
    // Also check for common HTML entities that indicate HTML content
    const hasHtmlEntities = /&(?:[a-z]+|#\d+);/i.test(trimmed);
    // If it has HTML tags or entities, it's not plain text
    return !htmlTagPattern.test(trimmed) && !hasHtmlEntities;
}

// Helper function to convert plain text to HTML
function textToHtml(text: string): string {
    if (!text) return '<p></p>';

    // Escape HTML entities
    const escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    // Split by newlines and wrap each line in a paragraph
    const lines = escaped.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) {
        return '<p></p>';
    }

    // If single line, return as single paragraph
    if (lines.length === 1) {
        return `<p>${lines[0]}</p>`;
    }

    // Multiple lines - wrap each in a paragraph
    return lines.map(line => `<p>${line}</p>`).join('');
}

// Helper function to sanitize and prepare HTML for Yoopta deserialization
function prepareHtmlForYoopta(htmlString: string): string {
    if (!htmlString || htmlString.trim() === '') {
        return '<p></p>';
    }

    let cleaned = htmlString.trim();

    // CRITICAL: Remove Yoopta clipboard format wrapper
    // Yoopta sometimes wraps content in <body id="yoopta-clipboard"> tags
    // We need to extract the actual content from inside
    if (cleaned.includes('id="yoopta-clipboard"') || cleaned.includes('data-editor-id')) {
        console.log('📝 [PREPARE] Detected Yoopta clipboard format, extracting content...');
        // Extract content from inside the body tag
        const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch && bodyMatch[1]) {
            cleaned = bodyMatch[1].trim();
            console.log('📝 [PREPARE] Extracted content from clipboard format, length:', cleaned.length);
        } else {
            // If no body tag match, try to remove the body tag attributes
            cleaned = cleaned.replace(/<body[^>]*>/gi, '');
            cleaned = cleaned.replace(/<\/body>/gi, '');
        }
    }

    // Check if content is markdown (has markdown syntax)
    // Also check for mermaid diagrams in markdown format
    const hasMarkdownSyntax = /^#+\s|^\*\s|^-\s|^\d+\.\s|```|\[.*\]\(.*\)/m.test(cleaned);
    const hasMermaidInMarkdown = /```mermaid[\s\S]*?```/m.test(cleaned);

    if (hasMarkdownSyntax || hasMermaidInMarkdown) {
        // Convert markdown to HTML (handles mermaid code blocks)
        // This will convert ```mermaid blocks to <div class="mermaid">...</div>
        cleaned = markdownToHtml(cleaned);
        console.log('📝 [PREPARE] Converted markdown to HTML, length:', cleaned.length);
        console.log('📝 [PREPARE] Has mermaid div:', cleaned.includes('<div class="mermaid">'));
    } else if (isPlainText(cleaned)) {
        // If it's plain text (not markdown, not HTML), convert to HTML first
        cleaned = textToHtml(cleaned);
        console.log('📝 [PREPARE] Converted plain text to HTML, length:', cleaned.length);
    } else {
        // Already HTML - check if it has mermaid diagrams
        const hasMermaidDiv = cleaned.includes('<div class="mermaid">') || cleaned.includes('class="mermaid"');
        if (hasMermaidDiv) {
            console.log('📝 [PREPARE] Content already has mermaid diagrams');
        }
    }

    // Remove DOCTYPE, html, head, body tags if present (Yoopta expects just the content)
    cleaned = cleaned.replace(/<!DOCTYPE[^>]*>/gi, '');
    cleaned = cleaned.replace(/<html[^>]*>/gi, '');
    cleaned = cleaned.replace(/<\/html>/gi, '');
    cleaned = cleaned.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');
    cleaned = cleaned.replace(/<body[^>]*>/gi, '');
    cleaned = cleaned.replace(/<\/body>/gi, '');

    // Remove HTML comments (like <!-- DS_TAG_QUESTION_START -->) as Yoopta doesn't handle them
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

    // Clean up any script or style tags that might be embedded
    cleaned = cleaned.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

    // Fix nested paragraph tags (common in quiz HTML like <p><p>...</p></p>)
    // This can cause Yoopta parsing issues
    cleaned = cleaned.replace(/<p>\s*<p>/g, '<p>');
    cleaned = cleaned.replace(/<\/p>\s*<\/p>/g, '</p>');

    // Fix empty paragraph tags that might cause issues
    cleaned = cleaned.replace(/<p>\s*<\/p>/g, '');
    cleaned = cleaned.replace(/<p><\/p>/g, '');

    // Remove Yoopta metadata attributes from paragraphs (data-meta-*, style attributes added by Yoopta)
    // These can cause issues and aren't needed for deserialization
    cleaned = cleaned.replace(/<p[^>]*data-meta-[^>]*>/gi, '<p>');
    cleaned = cleaned.replace(/style="[^"]*"/gi, ''); // Remove style attributes

    // Check if content is effectively empty (only whitespace, empty tags, or just metadata)
    const textContent = cleaned.replace(/<[^>]*>/g, '').trim();
    if (!textContent || textContent === '') {
        console.warn('⚠️ [PREPARE] Content is empty after cleaning - this might be clipboard format or ungenerated content');
        return '<p></p>';
    }

    // If the content is empty after cleaning, return a paragraph
    if (!cleaned || cleaned.trim() === '') {
        return '<p></p>';
    }

    // NOTE: The working implementation does NOT wrap in div
    // It passes HTML directly to html.deserialize(editor, html)
    // So we should NOT wrap it - just return the cleaned HTML as-is
    return cleaned;
}

export function YooptaEditorWrapper({
    value,
    onChange,
    placeholder,
    minHeight = 400,
    className = '',
    editable = true,
    onBlur,
}: YooptaEditorWrapperProps) {
    const { t } = useTranslation('studyLibraryYooptaEditorWrapper');
    const editor = useMemo(() => {
        try {
            const newEditor = createYooptaEditor();
            // Verify editor was created successfully
            if (!newEditor || typeof newEditor.setEditorValue !== 'function') {
                console.error('Editor created but missing required methods');
                return null;
            }
            console.log('✅ YooptaEditorWrapper: Editor created successfully');
            return newEditor;
        } catch (error) {
            console.error('Failed to create Yoopta editor:', error);
            return null;
        }
    }, []);

    // Debug: Log value prop changes
    useEffect(() => {
        console.log('📝 YooptaEditorWrapper: value prop changed', {
            valueType: typeof value,
            valueLength: typeof value === 'string' ? value.length : 'N/A',
            valuePreview: typeof value === 'string' ? value.substring(0, 100) : value,
            isUndefined: value === undefined,
            isNull: value === null,
            isEmpty: value === '',
            isObject: typeof value === 'object' && value !== null,
            objectKeys: typeof value === 'object' && value !== null ? Object.keys(value) : null,
        });
    }, [value]);
    const selectionRef = useRef<HTMLDivElement | null>(null);
    const previousValueRef = useRef<string>('');
    const isUpdatingFromPropsRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [isEditorReady, setIsEditorReady] = useState(false);
    const [hasRenderedEditor, setHasRenderedEditor] = useState(false);

    // Fallback: If onMount doesn't fire, assume editor is mounted after a delay
    useEffect(() => {
        if (hasRenderedEditor) return;

        const fallbackTimer = setTimeout(() => {
            if (!hasRenderedEditor) {
                console.log('⏰ [FALLBACK] onMount didn\'t fire within 1s, using timeout fallback to mark editor as mounted');
                setHasRenderedEditor(true);
            }
        }, 1000);

        return () => clearTimeout(fallbackTimer);
    }, [hasRenderedEditor]);

    // Check if content has mermaid diagrams - MUST be called before any conditional returns
    // This is needed because YooptaEditor doesn't natively support mermaid diagrams
    const hasMermaid = useMemo(() => {
        if (!value || typeof value !== 'string') return false;
        const stringValue = String(value);
        return stringValue.includes('class="mermaid"') ||
            stringValue.includes('<div class="mermaid">') ||
            stringValue.includes('```mermaid') ||
            (stringValue.includes('graph') && (stringValue.includes('-->') || stringValue.includes('---'))) ||
            (stringValue.includes('flowchart') && (stringValue.includes('-->') || stringValue.includes('---'))) ||
            (stringValue.includes('sequenceDiagram') || stringValue.includes('classDiagram')) ||
            (stringValue.toLowerCase().includes('mermaid ') && (stringValue.includes('graph') || stringValue.includes('flowchart')));
    }, [value]);

    // CRITICAL FIX: Deserialize AFTER YooptaEditor has mounted
    // The editor needs to be rendered with plugins first before html.deserialize() works
    // This useEffect handles deserialization after the editor mounts
    useEffect(() => {
        if (!hasRenderedEditor || !editor) {
            console.log('⏳ [MOUNT_DESERIALIZE] Waiting for editor to mount...', { hasRenderedEditor, hasEditor: !!editor });
            return;
        }

        // Wait longer for YooptaEditor to fully initialize with plugins
        // The working implementation calls deserialize after editor is fully mounted and initialized
        // We need to wait for the YooptaEditor component to fully render with all plugins
        const timer = setTimeout(() => {
            // Normalize value to string
            const currentValue = typeof value === 'string' ? value : (value == null ? '' : String(value));

            // Check if editor already has content
            const hasEditorContent = editor?.children && typeof editor.children === 'object' && !Array.isArray(editor.children) && Object.keys(editor.children).length > 0;

            // Always deserialize if:
            // 1. Value has changed, OR
            // 2. Editor is empty (needs initial content), OR
            // 3. This is the first mount (previousValueRef is empty)
            const shouldDeserialize = currentValue && (
                currentValue !== previousValueRef.current ||
                !hasEditorContent ||
                previousValueRef.current === ''
            );

            if (shouldDeserialize) {
                console.log('🔄 [MOUNT_DESERIALIZE] Editor mounted, attempting deserialization...');
                console.log('🔄 [MOUNT_DESERIALIZE] Current value length:', currentValue.length);
                console.log('🔄 [MOUNT_DESERIALIZE] Current value preview:', currentValue.substring(0, 200));

                const preparedHtml = prepareHtmlForYoopta(currentValue);
                console.log('🔄 [MOUNT_DESERIALIZE] Prepared HTML length:', preparedHtml.length);
                console.log('🔄 [MOUNT_DESERIALIZE] Prepared HTML preview:', preparedHtml.substring(0, 300));

                try {
                    console.log('🔄 [MOUNT_DESERIALIZE] Calling html.deserialize...');
                    console.log('🔄 [MOUNT_DESERIALIZE] Editor check:', {
                        hasEditor: !!editor,
                        editorType: typeof editor,
                        hasSetEditorValue: editor && typeof editor.setEditorValue === 'function',
                        hasChildren: !!editor?.children,
                    });

                    // Use the same simple approach as the working implementation
                    // The working implementation: html.deserialize(editor, sanitizedDocData || '')
                    // It does NOT wrap in div, just passes HTML directly
                    // CRITICAL: Ensure preparedHtml is not empty - if it is, use a default paragraph
                    const htmlToDeserialize = preparedHtml && preparedHtml.trim() ? preparedHtml : '<p></p>';
                    console.log('🔄 [MOUNT_DESERIALIZE] HTML to deserialize length:', htmlToDeserialize.length);
                    console.log('🔄 [MOUNT_DESERIALIZE] HTML to deserialize preview:', htmlToDeserialize.substring(0, 200));

                    const editorContent = html.deserialize(editor, htmlToDeserialize);

                    // Fix Embed provider.type & provider.id after deserialization.
                    // The @yoopta/embed deserializer sets provider.type to hostname
                    // instead of the short name the renderer expects.
                    if (editorContent && typeof editorContent === 'object') {
                        Object.values(editorContent).forEach((block: any) => {
                            if (block?.type !== 'Embed') return;
                            const prov = block?.value?.[0]?.props?.provider;
                            if (!prov?.url) return;
                            const url = prov.url;
                            const detect: [string, RegExp][] = [
                                ['youtube', /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([^?&#]+)/],
                                ['vimeo', /vimeo\.com(?:\/video)?\/(\d+)/],
                                ['dailymotion', /dailymotion\.com\/(?:embed\/)?video\/([^_?&#]+)/],
                                ['loom', /loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/],
                                ['wistia', /wistia\.(?:com|net)\/(?:embed\/iframe|medias)\/([a-zA-Z0-9]+)/],
                                ['figma', /figma\.com/],
                                ['twitter', /(?:twitter\.com|x\.com)\/.*\/status\/(\d+)/],
                                ['instagram', /instagram\.com\/(?:p|reel|tv)\/([^\/?#&]+)/],
                            ];
                            for (const [name, re] of detect) {
                                const m = url.match(re);
                                if (m) {
                                    prov.type = name;
                                    prov.id = m[1] || url;
                                    break;
                                }
                            }
                        });
                    }

                    const keysCount = editorContent && typeof editorContent === 'object' && !Array.isArray(editorContent) ? Object.keys(editorContent).length : 0;
                    console.log('✅ [MOUNT_DESERIALIZE] After mount - Result keys:', keysCount);

                    if (keysCount > 0 && editor && typeof editor.setEditorValue === 'function') {
                        console.log('✅ [MOUNT_DESERIALIZE] Setting editor value with', keysCount, 'blocks');
                        isUpdatingFromPropsRef.current = true;
                        editor.setEditorValue(editorContent);
                        previousValueRef.current = currentValue;
                        setIsEditorReady(true);
                        setTimeout(() => {
                            isUpdatingFromPropsRef.current = false;
                            // Verify after setting
                            const verifyKeys = editor.children && typeof editor.children === 'object' && !Array.isArray(editor.children) ? Object.keys(editor.children).length : 0;
                            console.log('✅ [MOUNT_DESERIALIZE] Verification - editor.children keys:', verifyKeys);
                        }, 100);
                    } else {
                        console.warn('⚠️ [MOUNT_DESERIALIZE] Deserialization returned empty or invalid content. Keys:', keysCount);
                        // Even if empty, set it so editor at least renders
                        if (editor && typeof editor.setEditorValue === 'function') {
                            editor.setEditorValue(editorContent);
                            previousValueRef.current = currentValue;
                            setIsEditorReady(true);
                            setTimeout(() => {
                                isUpdatingFromPropsRef.current = false;
                            }, 0);
                        }
                    }
                } catch (e) {
                    console.error('❌ [MOUNT_DESERIALIZE] Failed:', e);
                    console.error('❌ [MOUNT_DESERIALIZE] Error stack:', e instanceof Error ? e.stack : 'N/A');
                    setError(t('errors.loadFailed'));
                }
            } else {
                console.log('⏭️ [MOUNT_DESERIALIZE] Value unchanged and editor has content, skipping');
            }
        }, 800); // Longer delay to ensure YooptaEditor is fully initialized with all plugins

        return () => clearTimeout(timer);
    }, [hasRenderedEditor, editor, value]);

    // NOTE: All deserialization is now handled in the mount useEffect above
    // This prevents duplicate deserialization attempts that were causing conflicts
    // The mount useEffect handles all cases: initial mount, value changes, and empty editor

    // Handle editor changes and convert back to HTML
    const handleChange = useCallback((yooptaValue: any) => {
        if (isUpdatingFromPropsRef.current) {
            return;
        }
        if (editor && typeof editor.children === 'object') {
            try {
                const serializedHtml = html.serialize(editor, editor.children);

                // CRITICAL: Don't save empty clipboard format back to content
                // If the serializedHtml is just Yoopta clipboard format with empty content, don't save it
                if (serializedHtml && serializedHtml.includes('id="yoopta-clipboard"')) {
                    // Extract actual content from clipboard format
                    const bodyMatch = serializedHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
                    if (bodyMatch && bodyMatch[1]) {
                        const extractedContent = bodyMatch[1].trim();
                        // Check if content is effectively empty (only whitespace or empty tags)
                        const textContent = extractedContent.replace(/<[^>]*>/g, '').trim();
                        if (!textContent || textContent === '') {
                            // Don't save empty clipboard format - it would overwrite real content
                            console.log('⚠️ [HANDLE_CHANGE] Ignoring empty clipboard format to prevent overwriting content');
                            return;
                        }
                        // Use extracted content instead of full clipboard format
                        onChange(extractedContent);
                        return;
                    }
                }

                onChange(serializedHtml);
            } catch (error) {
                console.error('❌ [HANDLE_CHANGE] Serialization failed:', error);
                // Prevent crash by not calling onChange with invalid data
            }
        }
    }, [editor, onChange]);

    const editorTools = useMemo(() => {
        return TOOLS;
    }, []);

    // Mark editor as ready after first successful initialization
    // This is now handled in the main useEffect when content is set
    // Keeping this as a fallback for cases where content might be empty
    useEffect(() => {
        if (!editor || isEditorReady) return;

        // Small delay to ensure editor is fully initialized
        const timer = setTimeout(() => {
            // Ensure editor has at least empty content before marking as ready
            try {
                if (editor && typeof editor.setEditorValue === 'function') {
                    // Check if editor already has children
                    if (!editor.children || !Array.isArray(editor.children) || editor.children.length === 0) {
                        // Initialize with empty paragraph
                        // @ts-ignore - html.deserialize might have different signature depending on version
                        const emptyContent = html.deserialize(editor, '<p><br></p>');
                        if (emptyContent) {
                            editor.setEditorValue(emptyContent);
                            console.log('✅ Editor initialized with empty content');
                        }
                    }
                }
            } catch (e) {
                console.warn('Could not initialize editor in fallback useEffect:', e);
            }
            // Even if initialization fails, mark as ready so editor can render
            setIsEditorReady(true);
        }, 200);

        return () => clearTimeout(timer);
    }, [editor, isEditorReady]);

    // Conditionally render tools based on editable prop
    // Always provide tools, but they won't be interactive if editable is false
    // editorTools is already declared above using useMemo

    if (error) {
        return (
            <div
                className={`rounded-md border bg-white shadow-sm ${className}`.trim()}
                style={{
                    width: '100%',
                    minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    color: '#ef4444',
                    textAlign: 'center',
                    padding: '20px',
                }}
            >
                <p className="text-lg font-semibold">{t('errors.loadingContentPrefix')}</p>
                <p className="text-sm">{error}</p>
                <button
                    onClick={() => {
                        setError(null);
                        setIsEditorReady(false);
                        setHasRenderedEditor(false);
                        previousValueRef.current = '';
                    }}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
                >
                    {t('actions.retry')}
                </button>
            </div>
        );
    }

    // Don't render if editor failed to initialize
    if (!editor) {
        return (
            <div
                className={`rounded-md border border-red-200 bg-red-50 p-4 ${className}`.trim()}
                style={{
                    width: '100%',
                    minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
                }}
            >
                <div className="text-sm text-red-600">
                    <p className="font-semibold">{t('errors.initFailed')}</p>
                    <p className="text-xs">{t('errors.refreshAndRetry')}</p>
                </div>
            </div>
        );
    }

    // Don't show loading - always render YooptaEditor so it can mount
    // The fallback timeout will mark it as mounted if onMount doesn't fire

    // Final safety check - ensure editor has children property
    // YooptaEditor expects editor.children which is an OBJECT with UUID keys, not an array!
    // This is the correct format: { "uuid-1": { type: "paragraph", ... }, "uuid-2": { type: "heading", ... } }
    // NOTE: Do NOT call setEditorValue during render - it causes React warnings
    // The editorValue will be set by the mount useEffect after deserialization
    let editorValue = editor?.children || {};

    // YooptaEditor expects an object with blocks, NOT an array!
    // editor.children is already in the correct format: { "uuid": block, ... }

    // Note: Mermaid diagrams are now handled by the MermaidPlugin in YooptaEditor
    // The plugin will deserialize <div class="mermaid"> blocks and render them
    // We only use DocumentWithMermaidSimple as a fallback for read-only mode if needed
    // For editable mode, YooptaEditor with MermaidPlugin will handle mermaid rendering

    return (
        <div
            ref={selectionRef}
            className={`rounded-md border bg-white shadow-sm ${className}`.trim()}
            style={{
                width: '100%',
                minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
                ...(editable ? {} : { pointerEvents: 'none', opacity: 0.8 }),
            }}
        >
            <YooptaEditor
                editor={editor}
                plugins={plugins}
                tools={editorTools}
                marks={MARKS}
                value={editorValue}
                selectionBoxRoot={selectionRef}
                autoFocus={false}
                onChange={handleChange}
                className="size-full"
                style={{
                    width: '100%',
                    height: '100%',
                    minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight
                }}
            />
        </div>
    );
}

