import { useEffect, useRef, useState } from 'react';
import { UploadSimple, UserCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDialog } from '@/components/design-system/dialog';
import { getUserId } from '@/utils/userDetails';
import { useFileUpload } from '@/hooks/use-file-upload';
import { reportApiError } from '@/lib/report-api-error';
import { useUpdateMentor } from '../-hooks/use-mentorship';
import type { MentorDTO } from '../-types/mentorship-types';
import { MentorProfileFields, type MentorProfileValues } from './MentorProfileFields';

interface EditMentorDialogProps {
    instituteId: string;
    mentor: MentorDTO | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Edit an existing mentor's learner-facing profile: photo, display name, title,
 * bio, expertise, capacity and directory listing. The underlying platform user is
 * never touched here — only the mentor persona.
 */
export function EditMentorDialog({
    instituteId,
    mentor,
    open,
    onOpenChange,
}: EditMentorDialogProps) {
    const { t } = useTranslation('mentorshipEditMentorDialog');
    const [displayName, setDisplayName] = useState('');
    const [title, setTitle] = useState('');
    const [bio, setBio] = useState('');
    const [photoFileId, setPhotoFileId] = useState<string | null>(null);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [profile, setProfile] = useState<MentorProfileValues>({
        expertiseTags: [],
        maxMentees: '',
        isDiscoverable: false,
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const updateMentor = useUpdateMentor();
    const { uploadFile, getPublicUrl } = useFileUpload();

    // Re-seed the form whenever a different mentor is opened, so the dialog never
    // shows the previous mentor's values for a frame.
    useEffect(() => {
        if (!mentor || !open) return;
        setDisplayName(mentor.display_name || mentor.name || '');
        setTitle(mentor.title || '');
        setBio(mentor.bio || '');
        setProfile({
            expertiseTags: mentor.expertise_tags ?? [],
            maxMentees: mentor.max_mentees ? String(mentor.max_mentees) : '',
            isDiscoverable: !!mentor.is_discoverable,
        });
        const fileId = mentor.profile_image_file_id || mentor.profile_pic_file_id || null;
        setPhotoFileId(fileId);
        setPhotoUrl(null);
        if (fileId) {
            getPublicUrl(fileId)
                .then(setPhotoUrl)
                .catch(() => {
                    /* avatar is best-effort */
                });
        }
    }, [mentor, open, getPublicUrl]);

    const onPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploadingPhoto(true);
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: setUploadingPhoto,
                userId: getUserId() || 'admin',
                source: instituteId,
                sourceId: 'MENTORS',
            });
            if (fileId) {
                setPhotoFileId(fileId);
                setPhotoUrl(await getPublicUrl(fileId));
            }
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'upload-mentor-photo' },
                fallbackMessage: t('photoUploadFailed'),
            });
        } finally {
            setUploadingPhoto(false);
        }
    };

    const submit = async () => {
        if (!mentor) return;
        setSubmitting(true);
        try {
            await updateMentor.mutateAsync({
                id: mentor.id,
                instituteId,
                data: {
                    display_name: displayName,
                    title,
                    bio,
                    profile_image_file_id: photoFileId || undefined,
                    expertise_tags: profile.expertiseTags,
                    // 0 is the server's "clear the cap" signal, so a blank field means unlimited.
                    max_mentees: profile.maxMentees.trim() === '' ? 0 : Number(profile.maxMentees),
                    is_discoverable: profile.isDiscoverable,
                },
            });
            toast.success(t('mentorUpdated'));
            onOpenChange(false);
        } catch (error) {
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'update-mentor' },
                extra: { mentorId: mentor.id },
                fallbackMessage: t('updateFailed'),
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (!mentor) return null;

    return (
        <MyDialog
            heading={t('editMentorHeading', {
                name: mentor.display_name || mentor.name || t('defaultMentorName'),
            })}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={submit}
                        disable={submitting || uploadingPhoto}
                    >
                        {submitting ? t('saving') : t('saveChanges')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">{t('description')}</p>

                <div className="flex items-center gap-4">
                    <div className="flex size-16 items-center justify-center overflow-hidden rounded-full bg-neutral-100">
                        {photoUrl ? (
                            <img
                                src={photoUrl}
                                alt={t('mentorAlt')}
                                className="size-full object-cover"
                            />
                        ) : (
                            <UserCircle size={40} className="text-neutral-300" />
                        )}
                    </div>
                    <div className="flex flex-col gap-1">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => fileInputRef.current?.click()}
                            disable={uploadingPhoto}
                        >
                            <UploadSimple size={16} />{' '}
                            {uploadingPhoto
                                ? t('uploading')
                                : photoUrl
                                  ? t('changePhoto')
                                  : t('uploadPhoto')}
                        </MyButton>
                        <span className="text-caption text-neutral-400">{t('photoHelp')}</span>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={onPhotoChange}
                    />
                </div>

                <MyInput
                    input={displayName}
                    onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setDisplayName(e.target.value)
                    }
                    inputType="text"
                    inputPlaceholder={mentor.name || t('displayNamePlaceholder')}
                    label={t('displayNameLabel')}
                    className="sm:w-full"
                />
                <MyInput
                    input={title}
                    onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setTitle(e.target.value)
                    }
                    inputType="text"
                    inputPlaceholder={t('titlePlaceholder')}
                    label={t('titleLabel')}
                    className="sm:w-full"
                />
                <MyInput
                    input={bio}
                    onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setBio(e.target.value)
                    }
                    inputType="text"
                    inputPlaceholder={t('bioPlaceholder')}
                    label={t('bioLabel')}
                    className="sm:w-full"
                />

                <MentorProfileFields
                    values={profile}
                    onChange={setProfile}
                    assignedCount={mentor.assigned_student_count}
                />
            </div>
        </MyDialog>
    );
}
