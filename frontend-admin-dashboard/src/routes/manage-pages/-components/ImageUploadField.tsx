import { useEffect, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UploadSimple as Upload, CircleNotch as Loader2, Image as ImageIcon, Sparkle } from '@phosphor-icons/react';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { MediaLibraryDialog } from './MediaLibraryDialog';
import { useToast } from '@/hooks/use-toast';
import { generateAiImage, AiImageKind } from '../-services/ai-page-service';
import ImageCropperDialog from '@/components/design-system/image-cropper-dialog';
import {
    canCrop,
    imageAdvice,
    slotHint,
    slotOf,
    type ImageSlot,
    type ImageSlotId,
    type Size,
} from '../-utils/image-slots';
import { prepareCropped, prepareOriginal, readImageSize } from '../-utils/image-prep';

interface ImageUploadFieldProps {
    label: string;
    value: string;
    onChange: (url: string) => void;
    placeholder?: string;
    /** When set, shows a "Generate with AI" affordance producing this kind of image. */
    aiKind?: AiImageKind;
    /**
     * Where the site shows this image (see image-slots): the cropper's
     * suggested shape, the size hint, the resize and the warnings. Unset: any
     * shape ("free").
     */
    slot?: ImageSlotId | ImageSlot;
}

/** A picked file waiting in the cropper. */
interface PendingImage {
    file: File;
    url: string;
    size: Size | null;
}

export const ImageUploadField = ({ label, value, onChange, placeholder, aiKind, slot: slotProp }: ImageUploadFieldProps) => {
    const slot = slotOf(slotProp);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [aiOpen, setAiOpen] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiBusy, setAiBusy] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [pending, setPending] = useState<PendingImage | null>(null);
    // The current image's natural size, for the advice under the preview.
    const [shown, setShown] = useState<Size | null>(null);
    const { uploadFile } = useFileUpload();

    useEffect(() => setShown(null), [value]);
    // The picked file's preview URL lives as long as the cropper shows it.
    useEffect(() => () => {
        if (pending) URL.revokeObjectURL(pending.url);
    }, [pending]);
    const { toast } = useToast();

    const handleGenerate = async () => {
        if (!aiPrompt.trim() || aiBusy) return;
        try {
            setAiBusy(true);
            const { urls } = await generateAiImage({ prompt: aiPrompt.trim(), kind: aiKind });
            if (urls[0]) {
                onChange(urls[0]);
                setAiOpen(false);
                setAiPrompt('');
            }
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast({ title: 'Image generation failed', description: typeof detail === 'string' ? detail : 'Please try again.', variant: 'destructive' });
        } finally {
            setAiBusy(false);
        }
    };

    const resetInput = () => {
        // Reset input so same file can be re-uploaded if needed
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const upload = async (file: File) => {
        const userId = getUserId();
        if (!userId) {
            console.error('[ImageUploadField] No userId found');
            return;
        }

        try {
            setIsUploading(true);
            const fileId = await uploadFile({
                file,
                setIsUploading,
                userId,
                source: 'CATALOGUE_IMAGES',
                sourceId: 'ADMIN',
                publicUrl: true,
            });
            if (fileId) {
                // uploadFile returns a file ID, not a URL — resolve it
                const resolvedUrl = await getPublicUrl(fileId);
                onChange(resolvedUrl || fileId);
            }
        } catch (err) {
            console.error('[ImageUploadField] Upload failed:', err);
        } finally {
            setIsUploading(false);
        }
    };

    // A picked image opens the cropper at the slot's shape; an SVG or GIF
    // (vector, animation) is uploaded as it is.
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        resetInput();
        if (!file) return;
        if (!canCrop(file.type)) {
            await upload(file);
            return;
        }
        const size = await readImageSize(file);
        if (!size) {
            // The browser cannot draw it (e.g. HEIC on some browsers): upload as before.
            await upload(file);
            return;
        }
        setPending({ file, url: URL.createObjectURL(file), size });
    };

    const applyCrop = async (canvas: HTMLCanvasElement) => {
        const picked = pending;
        setPending(null);
        if (!picked) return;
        setIsUploading(true);
        let file: File;
        try {
            file = await prepareCropped(canvas, picked.file, slot);
        } catch {
            toast({ title: 'Could not crop this image', description: 'It was uploaded as it is.' });
            file = picked.file;
        }
        await upload(file);
    };

    const applyWhole = async () => {
        const picked = pending;
        setPending(null);
        if (!picked) return;
        setIsUploading(true);
        await upload(picked.size ? await prepareOriginal(picked.file, picked.size, slot) : picked.file);
    };

    // Advice for the picked file (size only: the cropper itself handles shape),
    // and for the image the field holds now.
    const pickedAdvice = pending ? imageAdvice(pending.size, slot).filter((a) => a.kind === 'lowRes') : [];
    const currentAdvice = value ? imageAdvice(shown, slot) : [];

    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <p className="text-caption text-neutral-500" data-image-hint="">
                {slotHint(slot)}
            </p>

            {/* Preview: the whole image (a logo on the site's light and dark surfaces). */}
            {value && (
                <div className={slot.logo ? 'grid grid-cols-2 gap-1' : undefined}>
                    {(slot.logo ? ['bg-white', 'bg-neutral-900'] : ['bg-gray-50']).map((surface, i) => (
                        <div
                            key={surface}
                            className={`relative h-24 w-full overflow-hidden rounded border ${surface}`}
                        >
                            <img
                                src={value}
                                alt={i === 0 ? 'Preview' : ''}
                                aria-hidden={i > 0 || undefined}
                                className="size-full object-contain"
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    if (i === 0 && img.naturalWidth > 0) {
                                        setShown({ width: img.naturalWidth, height: img.naturalHeight });
                                    }
                                }}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        </div>
                    ))}
                </div>
            )}
            {slot.logo && value && (
                <p className="text-caption text-neutral-500">
                    Check your logo reads on both a light and a dark background.
                </p>
            )}
            {currentAdvice.map((a) => (
                <p key={a.kind} className="text-caption text-warning-600" data-image-advice={a.kind}>
                    {a.message}
                </p>
            ))}

            {!value && (
                <div className="flex h-16 w-full items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50 text-gray-400">
                    <ImageIcon className="size-5" />
                </div>
            )}

            {/* URL input */}
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder || 'https://example.com/image.png'}
                className="text-sm"
            />

            {/* Upload button */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
            />
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                >
                    {isUploading ? (
                        <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Uploading...
                        </>
                    ) : (
                        <>
                            <Upload className="mr-2 size-4" />
                            Upload
                        </>
                    )}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setLibraryOpen(true)}
                    title="Pick an image you already uploaded"
                >
                    <ImageIcon className="mr-2 size-4" />
                    Library
                </Button>
                {aiKind && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 text-primary-500"
                        onClick={() => setAiOpen((o) => !o)}
                    >
                        <Sparkle className="mr-2 size-4" weight="duotone" />
                        Generate with AI
                    </Button>
                )}
            </div>

            <MediaLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} onPick={onChange} />

            {pending && (
                <ImageCropperDialog
                    open
                    onOpenChange={(open) => {
                        if (!open) setPending(null);
                    }}
                    src={pending.url}
                    title="Crop image"
                    aspectRatio={slot.aspect ?? undefined}
                    aspectLabel={slot.aspectLabel}
                    confirmLabel="Crop and upload"
                    useOriginalLabel="Use as is"
                    onUseOriginal={() => void applyWhole()}
                    onCroppedCanvas={(canvas) => void applyCrop(canvas)}
                    notice={
                        <div className="space-y-1 text-center text-caption text-neutral-500">
                            <p>
                                {pending.size ? `${pending.size.width} × ${pending.size.height} px · ` : ''}
                                {slotHint(slot)}
                            </p>
                            {pickedAdvice.map((a) => (
                                <p key={a.kind} className="text-warning-600">
                                    {a.message}
                                </p>
                            ))}
                        </div>
                    }
                />
            )}

            {/* AI generate prompt row */}
            {aiKind && aiOpen && (
                <div className="space-y-2 rounded border border-primary-100 bg-primary-50 p-2">
                    <Input
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleGenerate(); } }}
                        placeholder={aiKind === 'logo' ? 'Describe your logo (e.g. a rocket for a coding academy)' : 'Describe the image you want'}
                        className="text-sm"
                        autoFocus
                    />
                    <Button type="button" size="sm" className="w-full" onClick={handleGenerate} disabled={!aiPrompt.trim() || aiBusy}>
                        {aiBusy ? <><Loader2 className="mr-2 size-4 animate-spin" /> Generating…</> : <><Sparkle className="mr-2 size-4" /> Generate</>}
                    </Button>
                </div>
            )}
        </div>
    );
};
