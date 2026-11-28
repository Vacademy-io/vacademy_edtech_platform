import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { YooptaPlugin, useYooptaEditor, Elements, PluginElementRenderProps } from '@yoopta/editor';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import SimplePDFViewer from '@/components/common/simple-pdf-viewer';

export function PdfViewerBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const editor = useYooptaEditor();
    const { t } = useTranslation('studyLibraryPdfViewer');
    const [pdfUrl, setPdfUrl] = useState(element?.props?.pdfUrl || '');
    const [title, setTitle] = useState(element?.props?.title || '');
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isFirstRender = useRef(true);

    // Sync local state when element props change (e.g. after deserialization)
    useEffect(() => {
        const propUrl = element?.props?.pdfUrl || '';
        const propTitle = element?.props?.title || '';
        if (propUrl !== pdfUrl) setPdfUrl(propUrl);
        if (propTitle !== title) setTitle(propTitle);
    }, [element?.props?.pdfUrl, element?.props?.title]);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        Elements.updateElement(editor, blockId, {
            type: 'pdfViewer',
            props: {
                ...element.props,
                pdfUrl,
                title,
                editorType: 'pdfViewer',
            },
        });
    }, [pdfUrl, title]);

    const handleFileUpload = async (file: File) => {
        if (file.type !== 'application/pdf') {
            alert(t('alerts.selectPdfFile'));
            return;
        }

        setIsUploading(true);

        try {
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            const data = getTokenDecodedData(accessToken);
            const instituteId = data && Object.keys(data.authorities)[0];
            const userId = data?.sub || 'unknown-user';

            const fileId = await UploadFileInS3(
                file,
                () => {},
                userId,
                instituteId,
                'STUDENTS',
                true
            );

            if (!fileId) throw new Error('Upload failed');

            const publicUrl = await getPublicUrl(fileId);
            if (!publicUrl) throw new Error('Failed to get URL');

            const nextTitle = title || file.name.replace(/\.pdf$/i, '');

            // Persist to the Yoopta element synchronously — if we rely
            // solely on the [pdfUrl, title] effect, a save that races the
            // next render serializes the "No PDF uploaded" placeholder.
            Elements.updateElement(editor, blockId, {
                type: 'pdfViewer',
                props: {
                    ...element.props,
                    pdfUrl: publicUrl,
                    title: nextTitle,
                    editorType: 'pdfViewer',
                },
            });

            setPdfUrl(publicUrl);
            if (nextTitle !== title) setTitle(nextTitle);
        } catch (error) {
            console.error('PDF upload failed:', error);
            alert(t('alerts.uploadFailed'));
        } finally {
            setIsUploading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (file) handleFileUpload(file);
    };

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Backspace') {
            const target = e.target as HTMLInputElement;
            if (target.value.length > 0 || target.selectionStart !== 0) {
                e.stopPropagation();
            }
        }
    };

    return (
        <div
            {...attributes}
            contentEditable={false}
            style={{
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                margin: '8px 0',
                overflow: 'hidden',
                backgroundColor: '#fafafa',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: '#f0f0f0',
                    borderBottom: '1px solid #e0e0e0',
                }}
            >
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#333' }}>
                    {t('header')}
                </span>
                {pdfUrl && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <a
                            href={pdfUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            style={{
                                padding: '3px 10px',
                                fontSize: '12px',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                backgroundColor: 'white',
                                color: '#666',
                                cursor: 'pointer',
                                textDecoration: 'none',
                            }}
                        >
                            {t('actions.open')}
                        </a>
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                padding: '3px 10px',
                                fontSize: '12px',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                backgroundColor: 'white',
                                color: '#666',
                                cursor: 'pointer',
                            }}
                        >
                            {t('actions.replace')}
                        </button>
                    </div>
                )}
            </div>

            <div style={{ padding: '12px' }}>
                {!pdfUrl ? (
                    <div
                        onDrop={handleDrop}
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={() => !isUploading && fileInputRef.current?.click()}
                        style={{
                            border: '2px dashed #ccc',
                            borderRadius: '6px',
                            padding: '32px',
                            textAlign: 'center',
                            cursor: isUploading ? 'wait' : 'pointer',
                            backgroundColor: '#fff',
                        }}
                    >
                        {isUploading ? (
                            <div style={{ fontSize: '14px', color: '#666' }}>
                                {t('dropzone.uploading')}
                            </div>
                        ) : (
                            <>
                                <div style={{ marginBottom: '8px' }}>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                        <line x1="9" y1="15" x2="15" y2="15" />
                                        <line x1="9" y1="11" x2="13" y2="11" />
                                    </svg>
                                </div>
                                <div style={{ fontSize: '14px', color: '#666' }}>
                                    {t('dropzone.dragHint')}
                                </div>
                                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                                    {t('dropzone.onlyPdf')}
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <div>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            placeholder={t('titlePlaceholder')}
                            style={{
                                width: '100%',
                                padding: '6px 10px',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                fontSize: '14px',
                                marginBottom: '10px',
                                backgroundColor: '#fff',
                            }}
                        />
                        <div
                            style={{
                                width: '100%',
                                height: '600px',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                backgroundColor: '#fff',
                                overflow: 'hidden',
                            }}
                        >
                            <SimplePDFViewer pdfUrl={pdfUrl} />
                        </div>
                    </div>
                )}
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                    e.target.value = '';
                }}
            />

            {children}
        </div>
    );
}

const PdfIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="15" x2="15" y2="15" />
        <line x1="9" y1="11" x2="13" y2="11" />
    </svg>
);

export const PdfViewerPlugin = new YooptaPlugin<{ pdfViewer: any }>({
    type: 'pdfViewer',
    elements: {
        pdfViewer: {
            render: PdfViewerBlock,
        },
    },
    options: {
        display: {
            title: 'PDF Viewer',
            description: 'Embed a PDF document inline',
            icon: <PdfIcon />,
        },
        shortcuts: ['pdf', 'document', 'viewer'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'pdfViewer') {
                        return undefined;
                    }
                    const title = element.getAttribute('data-title') || '';
                    // Prefer the raw URL stored on the wrapper. Fall back to
                    // an <iframe> src for older blocks that predate data-pdf-url.
                    // If the fallback src is a docs.google.com viewer URL,
                    // unwrap ?url= so editing the block doesn't double-wrap.
                    const rawFromAttr = element.getAttribute('data-pdf-url') || '';
                    let pdfUrl = rawFromAttr;
                    if (!pdfUrl) {
                        const iframeEl = element.querySelector?.('iframe');
                        const iframeSrc = iframeEl?.getAttribute('src') || '';
                        if (iframeSrc.includes('docs.google.com/gview')) {
                            try {
                                const u = new URL(iframeSrc);
                                pdfUrl = u.searchParams.get('url') || '';
                            } catch {
                                pdfUrl = '';
                            }
                        } else {
                            pdfUrl = iframeSrc;
                        }
                    }
                    return {
                        id: `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'pdfViewer',
                        props: { pdfUrl, title, editorType: 'pdfViewer' },
                        children: [{ text: '' }],
                    };
                },
            },
            // Serialize to a marker div only. The learner side inspects
            // data-yoopta-type="pdfViewer" + data-pdf-url and renders
            // SimplePDFViewer (PDF.js) in place. We deliberately don't
            // include an <iframe> here — direct PDF iframes break when S3
            // headers aren't iframe-friendly, and docs.google.com/gview
            // now blocks embedding via X-Frame-Options. The fallback
            // "Open in new tab" link is part of the marker content so any
            // raw-HTML renderer still gives the learner a working link.
            serialize: (element, _children) => {
                const props = element.props || {};
                const pdfUrl = props.pdfUrl || '';
                const title = (props.title || '').replace(/"/g, '&quot;');

                if (!pdfUrl) {
                    return `<div data-yoopta-type="pdfViewer" data-editor-type="pdfViewer" data-title="${title}" style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa; text-align: center; color: #999;">No PDF uploaded</div>`;
                }

                const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                const safePdfUrl = pdfUrl.replace(/"/g, '&quot;');
                return `<div data-yoopta-type="pdfViewer" data-editor-type="pdfViewer" data-pdf-url="${safePdfUrl}" data-title="${title}" style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa;">${safeTitle ? `<div style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #333;">${safeTitle}</div>` : ''}<a href="${safePdfUrl}" target="_blank" rel="noreferrer noopener" style="color: #3366cc; font-size: 13px;">Open PDF in new tab</a></div>`;
            },
        },
    },
});
