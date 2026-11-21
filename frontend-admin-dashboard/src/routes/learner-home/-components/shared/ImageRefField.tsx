import { useTranslation } from 'react-i18next';
import { Trash } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { getInstituteId } from '@/constants/helper';
import { ImageUploadField } from '@/routes/manage-pages/-components/ImageUploadField';
import type { ImageSlotId } from '@/routes/manage-pages/-utils/image-slots';
import type { CheckIssue, ImageRef } from '../../-types/learner-home-types';
import { LIMITS } from '../../-utils/publish-checks';
import { FieldIssues } from './FieldIssues';
import { under } from './issues';

/** Spec 9: JPEG, PNG and WebP only (no GIF or SVG) for banners and tiles. */
export const LEARNER_HOME_IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
/** Media-service source of learner home uploads; renditions are allowed for it (spec 9). */
export const LEARNER_HOME_MEDIA_SOURCE = 'LEARNER_HOME_MEDIA';

interface ImageRefFieldProps {
    id: string;
    label: string;
    slot: ImageSlotId;
    value: ImageRef | null;
    onChange: (next: ImageRef | null) => void;
    /** Issues of the owning block; this field shows those at `path`. */
    issues: CheckIssue[];
    path: string;
    hint?: string;
}

/**
 * An uploaded picture as an ImageRef: the upload (signed upload, crop, media
 * library) stores the file id and size, and the admin adds the alt text or
 * marks it decorative.
 */
export function ImageRefField({
    id,
    label,
    slot,
    value,
    onChange,
    issues,
    path,
    hint,
}: ImageRefFieldProps) {
    const { t } = useTranslation('learnerHome');
    const instituteId = getInstituteId() ?? 'ADMIN';
    return (
        <div className="space-y-2 rounded-md border border-neutral-200 p-3">
            <ImageUploadField
                label={label}
                value={value?.url ?? ''}
                // The URL box is hidden, so every change also reports a file id below.
                onChange={() => undefined}
                slot={slot}
                uploadSource={LEARNER_HOME_MEDIA_SOURCE}
                uploadSourceId={instituteId}
                hideUrlInput
                // Library files were uploaded under other sources, and the
                // rendition check accepts only learner-home media of this institute.
                hideLibrary
                accept={LEARNER_HOME_IMAGE_TYPES}
                onUploaded={(meta) =>
                    onChange({
                        file_id: meta.fileId,
                        url: meta.url,
                        alt: value?.alt ?? '',
                        decorative: value?.decorative ?? false,
                        width: meta.width ?? null,
                        height: meta.height ?? null,
                    })
                }
            />
            {hint && <p className="text-caption text-neutral-500">{hint}</p>}
            <p className="text-caption text-neutral-500">{t('image.publicNote')}</p>
            {value && (
                <>
                    <div className="space-y-1">
                        <Label htmlFor={`${id}-alt`}>{t('image.alt')}</Label>
                        <Input
                            id={`${id}-alt`}
                            value={value.alt}
                            maxLength={LIMITS.alt}
                            disabled={value.decorative}
                            onChange={(e) => onChange({ ...value, alt: e.target.value })}
                            aria-describedby={`${id}-alt-hint`}
                        />
                        <p id={`${id}-alt-hint`} className="text-caption text-neutral-500">
                            {t('image.altHint')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id={`${id}-decorative`}
                            checked={value.decorative}
                            onCheckedChange={(v) => onChange({ ...value, decorative: v === true })}
                        />
                        <Label htmlFor={`${id}-decorative`} className="font-normal">
                            {t('image.decorative')}
                        </Label>
                    </div>
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={() => onChange(null)}
                    >
                        <Trash className="me-1 size-3.5" aria-hidden />
                        {t('image.remove')}
                    </MyButton>
                </>
            )}
            <FieldIssues issues={under(issues, path)} />
        </div>
    );
}
