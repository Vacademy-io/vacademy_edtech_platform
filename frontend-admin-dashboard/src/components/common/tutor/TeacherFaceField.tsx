import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CircleNotch, UploadSimple, X } from '@phosphor-icons/react';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { getInstituteId } from '@/constants/helper';

interface TeacherFaceFieldProps {
    /** Media file id of the current face, or blank for the built-in one. */
    fileId?: string;
    /** Shown as the fallback preview when this level inherits (course tab). */
    inheritedFileId?: string;
    teacherName?: string;
    onChange: (fileId: string | undefined) => void;
}

/** The built-in teacher face: a friendly illustrated portrait (no upload needed). */
export const DefaultTeacherFace: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 96 96" role="img" aria-label="Default teacher face" className={className}>
        <circle cx="48" cy="48" r="48" className="fill-primary-100" />
        <path d="M22 44c0-16 12-27 26-27s26 11 26 27v6H22z" className="fill-neutral-800" />
        <circle cx="48" cy="50" r="19" className="fill-warning-100" />
        <path
            d="M31 47c2-10 9-15 17-15s15 5 17 15c-3-4-9-7-17-7s-14 3-17 7z"
            className="fill-neutral-800"
        />
        <circle cx="41" cy="52" r="2.2" className="fill-neutral-800" />
        <circle cx="55" cy="52" r="2.2" className="fill-neutral-800" />
        <path
            d="M41 60c2 3 5 4 7 4s5-1 7-4"
            className="fill-none stroke-neutral-800"
            strokeWidth="2"
            strokeLinecap="round"
        />
        <path d="M18 96c3-14 14-22 30-22s27 8 30 22z" className="fill-primary-500" />
        <circle cx="66" cy="36" r="3" className="fill-warning-300" />
    </svg>
);

/**
 * Upload a teacher's face (shown next to their name in every lesson). Uses the
 * ordinary media upload; the setting stores the file id, learners resolve it
 * to a signed url. Cleared = the built-in illustrated face.
 */
export const TeacherFaceField: React.FC<TeacherFaceFieldProps> = ({
    fileId,
    inheritedFileId,
    teacherName,
    onChange,
}) => {
    const [uploading, setUploading] = useState(false);
    const [previewUrl, setPreviewUrl] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const shownId = fileId || inheritedFileId || '';

    useEffect(() => {
        let cancelled = false;
        if (!shownId) {
            setPreviewUrl('');
            return;
        }
        getPublicUrl(shownId)
            .then((u) => {
                if (!cancelled) setPreviewUrl(u || '');
            })
            .catch(() => {
                if (!cancelled) setPreviewUrl('');
            });
        return () => {
            cancelled = true;
        };
    }, [shownId]);

    const pick = async (file: File | undefined) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error('Choose an image (png, jpg or webp)');
            return;
        }
        if (file.size > 3 * 1024 * 1024) {
            toast.error('Keep the picture under 3 MB');
            return;
        }
        try {
            const id = await UploadFileInS3(
                file,
                setUploading,
                getUserId(),
                'TUTOR_TEACHER_FACE',
                getInstituteId() || 'INSTITUTE',
                true
            );
            if (!id) throw new Error('Upload failed');
            onChange(id);
            toast.success('Teacher face updated. Save to apply.');
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Could not upload the picture');
        } finally {
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <div className="space-y-1">
            <Label>Teacher face</Label>
            <div className="flex items-center gap-3">
                <div className="size-14 shrink-0 overflow-hidden rounded-full border border-neutral-200 bg-white">
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            alt={teacherName ? `${teacherName}'s face` : 'Teacher face'}
                            className="size-full object-cover"
                        />
                    ) : (
                        <DefaultTeacherFace className="size-full" />
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => void pick(e.target.files?.[0])}
                    />
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        layoutVariant="default"
                        disable={uploading}
                        onClick={() => inputRef.current?.click()}
                    >
                        {uploading ? (
                            <CircleNotch className="size-4 animate-spin" />
                        ) : (
                            <UploadSimple className="size-4" />
                        )}
                        {shownId ? 'Change picture' : 'Upload picture'}
                    </MyButton>
                    {fileId && (
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-danger-600"
                            onClick={() => onChange(undefined)}
                        >
                            <X className="size-3" />{' '}
                            {inheritedFileId ? 'Use institute face' : 'Use default face'}
                        </button>
                    )}
                </div>
            </div>
            <p className="text-xs text-neutral-500">
                A square photo or illustration, shown next to the teacher&apos;s name in every
                lesson.
                {!shownId && ' The built-in face is used until you upload one.'}
            </p>
        </div>
    );
};
