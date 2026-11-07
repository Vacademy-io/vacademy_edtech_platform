import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { cn } from '@/lib/utils';
import { UploadSimple, FileArrowDown, Link as LinkIcon } from '@phosphor-icons/react';
import type {
    ImagePayload,
    VideoPayload,
    FilePayload,
    EmbedPayload,
    CalloutPayload,
} from '../nodes/media-nodes';
import { CALLOUT_THEMES, toEmbedUrl } from '../nodes/media-nodes';

interface BlockEditorProps<T> {
    payload: T;
    setPayload: (next: T) => void;
    readOnly: boolean;
}

async function uploadToS3(file: File): Promise<string | null> {
    try {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const data = getTokenDecodedData(accessToken);
        const instituteId = (data && Object.keys(data.authorities)[0]) || '';
        const userId = data?.sub || 'unknown-user';
        const fileId = await UploadFileInS3(file, () => {}, userId, instituteId, 'STUDENTS', true);
        if (!fileId) return null;
        return (await getPublicUrl(fileId)) || null;
    } catch (e) {
        console.error('[Lexical] upload failed:', e);
        return null;
    }
}

function UploadPlaceholder({
    label,
    accept,
    uploading,
    onFile,
}: {
    label: string;
    accept: string;
    uploading: boolean;
    onFile: (file: File) => void;
}) {
    const { t } = useTranslation('studyLibraryMediaBlockEditors');
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <div className="my-2 flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-6">
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onFile(file);
                }}
            />
            <MyButton
                buttonType="secondary"
                scale="small"
                disable={uploading}
                onClick={() => inputRef.current?.click()}
            >
                <UploadSimple size={14} className="mr-1" />
                {uploading ? t('uploading') : label}
            </MyButton>
        </div>
    );
}

// ---------- Image ----------
export function ImageBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<ImagePayload>) {
    const { t } = useTranslation('studyLibraryMediaBlockEditors');
    const [uploading, setUploading] = useState(false);

    if (!payload.src) {
        if (readOnly)
            return <div className="text-caption text-neutral-400">{t('noImage')}</div>;
        return (
            <UploadPlaceholder
                label={t('uploadImage')}
                accept="image/*"
                uploading={uploading}
                onFile={async (file) => {
                    setUploading(true);
                    const url = await uploadToS3(file);
                    setUploading(false);
                    if (url) setPayload({ ...payload, src: url });
                    else toast.error(t('imageUploadFailed'));
                }}
            />
        );
    }
    return (
        <div className="my-2">
            <img
                src={payload.src}
                alt={payload.alt}
                className="mx-auto block h-auto max-w-full rounded-md"
            />
            {!readOnly && (
                <div className="mt-1">
                    <MyInput
                        inputType="text"
                        inputPlaceholder={t('altTextPlaceholder')}
                        input={payload.alt}
                        onChangeFunction={(e) => setPayload({ ...payload, alt: e.target.value })}
                        size="small"
                    />
                </div>
            )}
        </div>
    );
}

// ---------- Video ----------
export function VideoBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<VideoPayload>) {
    const { t } = useTranslation('studyLibraryMediaBlockEditors');
    const [uploading, setUploading] = useState(false);

    if (!payload.src) {
        if (readOnly)
            return <div className="text-caption text-neutral-400">{t('noVideo')}</div>;
        return (
            <UploadPlaceholder
                label={t('uploadVideo')}
                accept="video/*"
                uploading={uploading}
                onFile={async (file) => {
                    setUploading(true);
                    const url = await uploadToS3(file);
                    setUploading(false);
                    if (url) setPayload({ src: url });
                    else toast.error(t('videoUploadFailed'));
                }}
            />
        );
    }
    return (
        <video
            controls
            src={payload.src}
            className="my-2 max-h-96 w-full rounded-md"
            preload="metadata"
        />
    );
}

// ---------- File ----------
export function FileBlockEditor({ payload, setPayload, readOnly }: BlockEditorProps<FilePayload>) {
    const { t } = useTranslation('studyLibraryMediaBlockEditors');
    const [uploading, setUploading] = useState(false);

    if (!payload.href) {
        if (readOnly) return <div className="text-caption text-neutral-400">{t('noFile')}</div>;
        return (
            <UploadPlaceholder
                label={t('uploadFile')}
                accept="*/*"
                uploading={uploading}
                onFile={async (file) => {
                    setUploading(true);
                    const url = await uploadToS3(file);
                    setUploading(false);
                    if (url) setPayload({ href: url, name: file.name });
                    else toast.error(t('fileUploadFailed'));
                }}
            />
        );
    }
    return (
        <a
            href={payload.href}
            target="_blank"
            rel="noreferrer noopener"
            className="my-2 inline-flex items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-caption text-primary-500 no-underline"
        >
            <FileArrowDown size={16} />
            {payload.name || t('downloadFile')}
        </a>
    );
}

// ---------- Embed ----------
export function EmbedBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<EmbedPayload>) {
    const { t } = useTranslation('studyLibraryMediaBlockEditors');
    const [draft, setDraft] = useState('');

    if (!payload.src) {
        if (readOnly) return <div className="text-caption text-neutral-400">{t('noEmbed')}</div>;
        return (
            <div className="my-2 flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-4">
                <LinkIcon size={16} className="text-neutral-400" />
                <MyInput
                    inputType="text"
                    inputPlaceholder={t('embedUrlPlaceholder')}
                    input={draft}
                    onChangeFunction={(e) => setDraft(e.target.value)}
                    size="small"
                />
                <MyButton
                    buttonType="primary"
                    scale="small"
                    disable={!draft.trim()}
                    onClick={() => setPayload({ ...payload, src: toEmbedUrl(draft) })}
                >
                    {t('embed')}
                </MyButton>
            </div>
        );
    }
    return (
        <iframe
            src={payload.src}
            className="my-2 w-full rounded-md border-none"
            style={{ height: payload.height }}
            allowFullScreen
            title={t('embeddedContentTitle')}
        />
    );
}

// ---------- Callout ----------
export function CalloutBlockEditor({
    payload,
    setPayload,
    readOnly,
}: BlockEditorProps<CalloutPayload>) {
    const { t } = useTranslation('studyLibraryMediaBlockEditors');
    const theme = CALLOUT_THEMES[payload.theme] ?? CALLOUT_THEMES.info;
    return (
        <div
            className="my-2 rounded-md px-4 py-3"
            style={{
                background: theme.bg,
                borderLeft: `4px solid ${theme.border}`,
                color: theme.color,
            }}
        >
            {readOnly ? (
                <div className="whitespace-pre-wrap">{payload.text}</div>
            ) : (
                <textarea
                    className="w-full resize-none border-none bg-transparent outline-none"
                    style={{ color: theme.color }}
                    rows={Math.max(1, payload.text.split('\n').length)}
                    placeholder={t('calloutPlaceholder')}
                    value={payload.text}
                    onChange={(e) => setPayload({ ...payload, text: e.target.value })}
                />
            )}
            {!readOnly && (
                <div className="mt-2 flex gap-1">
                    {(Object.keys(CALLOUT_THEMES) as CalloutPayload['theme'][]).map((themeKey) => (
                        <button
                            key={themeKey}
                            type="button"
                            aria-label={t('themeAriaLabel', { theme: themeKey })}
                            className={cn(
                                'size-5 rounded-full border',
                                payload.theme === themeKey && 'ring-2 ring-primary-400'
                            )}
                            style={{
                                background: CALLOUT_THEMES[themeKey].bg,
                                borderColor: CALLOUT_THEMES[themeKey].border,
                            }}
                            onClick={() => setPayload({ ...payload, theme: themeKey })}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
