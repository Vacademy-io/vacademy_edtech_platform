import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    YooptaPlugin,
    useYooptaEditor,
    useYooptaReadOnly,
    PluginElementRenderProps,
} from '@yoopta/editor';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { commitBlockProps } from './commitBlockProps';

export function AudioPlayerBlock({ element, attributes, children, blockId }: PluginElementRenderProps) {
    const { t } = useTranslation('studyLibraryAudioPlayer');
    const editor = useYooptaEditor();
    const isReadOnly = useYooptaReadOnly();
    const [audioUrl, setAudioUrl] = useState(element?.props?.audioUrl || '');
    const [title, setTitle] = useState(element?.props?.title || '');
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Mirror audio state in refs so commit resolves against the freshest
    // value even if two handlers fire in the same tick (e.g. upload sets
    // both audioUrl and title near-simultaneously).
    const audioUrlRef = useRef(audioUrl);
    const titleRef = useRef(title);

    // Push audio state to Yoopta via commitBlockProps (Slate + block.value
    // atomically). A useEffect-based push leaves block.value stale —
    // Save Draft then ships data-title="" and the upload vanishes on
    // reload. No-op for learners.
    const commitAudio = (patch: { audioUrl?: string; title?: string }) => {
        if (patch.audioUrl !== undefined) {
            audioUrlRef.current = patch.audioUrl;
            setAudioUrl(patch.audioUrl);
        }
        if (patch.title !== undefined) {
            titleRef.current = patch.title;
            setTitle(patch.title);
        }
        if (isReadOnly) return;
        commitBlockProps(editor, blockId, element, {
            audioUrl: audioUrlRef.current,
            title: titleRef.current,
            editorType: 'audioPlayer',
        });
    };

    // Sync local state when element props change (e.g. after deserialization)
    useEffect(() => {
        const propUrl = element?.props?.audioUrl || '';
        const propTitle = element?.props?.title || '';
        if (propUrl !== audioUrl) {
            audioUrlRef.current = propUrl;
            setAudioUrl(propUrl);
        }
        if (propTitle !== title) {
            titleRef.current = propTitle;
            setTitle(propTitle);
        }
    }, [element?.props?.audioUrl, element?.props?.title]);

    const handleFileUpload = async (file: File) => {
        if (!file.type.startsWith('audio/')) {
            alert(t('selectAudioFile'));
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

            if (!fileId) throw new Error(t('uploadFailedError'));

            const publicUrl = await getPublicUrl(fileId);
            if (!publicUrl) throw new Error(t('failedToGetUrl'));

            // Commit audioUrl and title in a single transform so both
            // land in block.value atomically — otherwise two separate
            // commits race and the second clobbers the first.
            const nextTitle = titleRef.current || file.name.replace(/\.[^/.]+$/, '');
            commitAudio({ audioUrl: publicUrl, title: nextTitle });
        } catch (error) {
            console.error('Audio upload failed:', error);
            alert(t('uploadFailedAlert'));
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
            {/* Header */}
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
                    {t('audioPlayer')}
                </span>
                {audioUrl && !isReadOnly && (
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
                        {t('replace')}
                    </button>
                )}
            </div>

            <div style={{ padding: '12px' }}>
                {!audioUrl && isReadOnly ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '16px',
                        color: '#999',
                        fontSize: '14px',
                    }}>
                        {t('noAudioUploaded')}
                    </div>
                ) : !audioUrl ? (
                    /* Upload area */
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
                                {t('uploadingEllipsis')}
                            </div>
                        ) : (
                            <>
                                <div style={{ fontSize: '32px', marginBottom: '8px' }}>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2">
                                        <path d="M9 18V5l12-2v13" />
                                        <circle cx="6" cy="18" r="3" />
                                        <circle cx="18" cy="16" r="3" />
                                    </svg>
                                </div>
                                <div style={{ fontSize: '14px', color: '#666' }}>
                                    {t('clickOrDragHint')}
                                </div>
                                <div style={{ fontSize: '12px', color: '#999', marginTop: '4px' }}>
                                    {t('supportedFormats')}
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    /* Audio player */
                    <div>
                        {/* Title: editable input for admins, static label for learners */}
                        {isReadOnly ? (
                            title && (
                                <div style={{
                                    fontSize: '14px',
                                    fontWeight: 600,
                                    color: '#333',
                                    marginBottom: '10px',
                                }}>
                                    {title}
                                </div>
                            )
                        ) : (
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => commitAudio({ title: e.target.value })}
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
                        )}
                        {/* HTML5 audio player */}
                        <audio
                            controls
                            src={audioUrl}
                            style={{ width: '100%', borderRadius: '4px' }}
                            preload="metadata"
                        />
                    </div>
                )}
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
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

// Audio icon for action menu
const AudioIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
    </svg>
);

// Yoopta Plugin Definition
export const AudioPlugin = new YooptaPlugin<{ audioPlayer: any }>({
    type: 'audioPlayer',
    elements: {
        audioPlayer: {
            render: AudioPlayerBlock,
        },
    },
    options: {
        display: {
            title: 'Audio Player',
            description: 'Embed an audio file',
            icon: <AudioIcon />,
        },
        shortcuts: ['audio', 'sound', 'music', 'mp3'],
    },
    parsers: {
        html: {
            deserialize: {
                nodeNames: ['DIV'],
                parse: (element) => {
                    if (element.getAttribute?.('data-yoopta-type') !== 'audioPlayer') {
                        return undefined;
                    }
                    const title = element.getAttribute('data-title') || '';
                    const audioEl = element.querySelector?.('audio');
                    const audioUrl = audioEl?.getAttribute('src') || '';
                    return {
                        id: `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        type: 'audioPlayer',
                        props: { audioUrl, title, editorType: 'audioPlayer' },
                        children: [{ text: '' }],
                    };
                },
            },
            serialize: (element, _children) => {
                const props = element.props || {};
                const audioUrl = props.audioUrl || '';
                const title = (props.title || '').replace(/"/g, '&quot;');

                if (!audioUrl) {
                    return `<div data-yoopta-type="audioPlayer" data-editor-type="audioPlayer" data-title="${title}" style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa; text-align: center; color: #999;">No audio uploaded</div>`;
                }

                return `<div data-yoopta-type="audioPlayer" data-editor-type="audioPlayer" data-title="${title}" style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin: 8px 0; background: #fafafa;">${title ? `<div style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: #333;">${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}<audio controls src="${audioUrl}" style="width: 100%;" preload="metadata"></audio></div>`;
            },
        },
    },
});
