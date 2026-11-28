import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretRight, Check, UploadSimple, UserCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDialog } from '@/components/design-system/dialog';
import { getUserId } from '@/utils/userDetails';
import { useFileUpload } from '@/hooks/use-file-upload';
import { reportApiError } from '@/lib/report-api-error';
import {
    fetchEligibleOrgUsers,
    type InstituteUser,
} from '@/routes/manage-institute/teams/-services/institute-users-service';
import { handleInviteUsers } from '@/routes/dashboard/-services/dashboard-services';
import { useCreateMentor } from '../-hooks/use-mentorship';
import { MentorProfileFields, type MentorProfileValues } from './MentorProfileFields';

interface AddMentorDialogProps {
    instituteId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Good enough to catch a typo before we spend an invitation on it. */
function isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Expertise, capacity, photo and titles are all optional and editable afterwards,
 * so they start folded. The dialog then asks one question — who is this? — and
 * only expands for an admin who wants to fill the rest in now.
 */
function OptionalDetails({
    open,
    onToggle,
    children,
}: {
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    const { t } = useTranslation('mentorshipAddMentorDialog');
    return (
        <div className="flex flex-col gap-3">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex w-fit items-center gap-1.5 text-caption font-medium text-primary-600 hover:text-primary-700"
            >
                <CaretRight
                    size={12}
                    weight="bold"
                    className={`transition-transform ${open ? 'rotate-90' : ''}`}
                />
                {open ? t('optionalDetails.hide') : t('optionalDetails.show')}
            </button>
            {open && <div className="flex flex-col gap-4">{children}</div>}
        </div>
    );
}

function initials(name?: string | null): string {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    return (
        (parts[0]?.[0] ?? '').concat(parts.length > 1 ? parts[1]?.[0] ?? '' : '').toUpperCase() ||
        '?'
    );
}

/**
 * Add a mentor, from either direction:
 *   - someone already on the team, picked from the list, or
 *   - someone who isn't yet, invited by name + email right here.
 *
 * The invite path exists because the alternative was a detour: leave mentorship,
 * go to Teams, invite the person, wait, come back, find them. It reuses the
 * platform's own invitation endpoint with the MENTOR role, which creates the user
 * immediately and returns its id — so the mentor row is created in the same step
 * and the person appears in the list straight away, pending their acceptance.
 */
export function AddMentorDialog({ instituteId, open, onOpenChange }: AddMentorDialogProps) {
    const { t } = useTranslation('mentorshipAddMentorDialog');
    const [mode, setMode] = useState<'team' | 'invite'>('team');
    // Everything past "who is it" is optional and editable later, so the dialog
    // opens short and only grows if the admin asks it to.
    const [showDetails, setShowDetails] = useState(false);
    const [inviteName, setInviteName] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<InstituteUser | null>(null);
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

    const createMentor = useCreateMentor();
    const { uploadFile, getPublicUrl } = useFileUpload();

    const membersQuery = useQuery({
        queryKey: ['mentorship-eligible-org-users', instituteId],
        enabled: !!instituteId && open,
        queryFn: () => fetchEligibleOrgUsers(instituteId),
        staleTime: 60_000,
    });

    const members = membersQuery.data ?? [];
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return members;
        return members.filter(
            (m) =>
                (m.full_name || '').toLowerCase().includes(q) ||
                (m.email || '').toLowerCase().includes(q)
        );
    }, [members, search]);

    const reset = () => {
        setSearch('');
        setSelected(null);
        setDisplayName('');
        setTitle('');
        setBio('');
        setPhotoFileId(null);
        setPhotoUrl(null);
        setProfile({ expertiseTags: [], maxMentees: '', isDiscoverable: false });
        setMode('team');
        setShowDetails(false);
        setInviteName('');
        setInviteEmail('');
    };

    const pick = async (m: InstituteUser) => {
        setSelected(m);
        setDisplayName((prev) => prev || m.full_name || '');
        // Default the mentor photo to the member's existing team avatar (admin can replace).
        if (m.profile_pic_file_id) {
            setPhotoFileId(m.profile_pic_file_id);
            try {
                setPhotoUrl(await getPublicUrl(m.profile_pic_file_id));
            } catch {
                /* avatar is best-effort */
            }
        }
    };

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
                fallbackMessage: t('toast.photoUploadFailed'),
            });
        } finally {
            setUploadingPhoto(false);
        }
    };

    const submit = async () => {
        if (mode === 'team' && !selected) {
            toast.error(t('toast.selectTeamMember'));
            return;
        }
        if (mode === 'invite' && (!inviteName.trim() || !isEmail(inviteEmail))) {
            toast.error(t('toast.enterNameEmail'));
            return;
        }
        setSubmitting(true);
        try {
            // Inviting first yields the new user's id, which the mentor row needs.
            // If the invite succeeds but the mentor row fails, the person is left as
            // an invited team member — recoverable by adding them from the team list,
            // and better than silently losing the invitation.
            const userId =
                mode === 'team'
                    ? selected!.id
                    : ((
                          await handleInviteUsers(instituteId, {
                              name: inviteName.trim(),
                              email: inviteEmail.trim(),
                              roleType: ['MENTOR'],
                          })
                      )?.id as string | undefined);

            if (!userId) {
                throw new Error(t('errors.invitationMissingUser'));
            }

            await createMentor.mutateAsync({
                institute_id: instituteId,
                user_id: userId,
                display_name:
                    displayName || (mode === 'team' ? selected!.full_name : inviteName.trim()),
                title,
                bio,
                profile_image_file_id: photoFileId || undefined,
                expertise_tags: profile.expertiseTags,
                max_mentees:
                    profile.maxMentees.trim() === '' ? undefined : Number(profile.maxMentees),
                is_discoverable: profile.isDiscoverable,
            });
            toast.success(
                mode === 'invite'
                    ? t('toast.invitationSent', { email: inviteEmail.trim() })
                    : t('toast.mentorAdded')
            );
            reset();
            onOpenChange(false);
        } catch (error) {
            // Duplicate-mentor and validation refusals come back with a readable
            // reason; showing it beats "Failed to add mentor".
            reportApiError(error, {
                feature: 'mentorship',
                tags: { 'mentorship.action': 'create-mentor' },
                extra: { mode, userId: selected?.id },
                fallbackMessage:
                    mode === 'invite' ? t('toast.inviteFailed') : t('toast.addFailed'),
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <MyDialog
            heading={t('dialog.heading')}
            open={open}
            onOpenChange={(o) => {
                if (!o) reset();
                onOpenChange(o);
            }}
            dialogWidth="max-w-lg"
            footer={
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={submit}
                        disable={
                            submitting ||
                            (mode === 'team'
                                ? !selected
                                : !inviteName.trim() || !isEmail(inviteEmail))
                        }
                        title={
                            mode === 'team' && !selected
                                ? t('actions.chooseTeamMemberFirst')
                                : undefined
                        }
                    >
                        {submitting
                            ? mode === 'invite'
                                ? t('actions.inviting')
                                : t('actions.adding')
                            : mode === 'invite'
                              ? t('actions.inviteAsMentor')
                              : t('actions.addMentor')}
                    </MyButton>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p className="text-body text-neutral-600">{t('intro')}</p>

                {!selected && (
                    <div className="flex gap-1 rounded-lg bg-neutral-100 p-1">
                        {(
                            [
                                { key: 'team', label: t('modeTabs.team') },
                                { key: 'invite', label: t('modeTabs.invite') },
                            ] as const
                        ).map((tab) => (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setMode(tab.key)}
                                className={`flex-1 rounded-md px-3 py-1.5 text-body transition-colors ${
                                    mode === tab.key
                                        ? 'bg-white font-medium text-neutral-700 shadow-sm'
                                        : 'text-neutral-500 hover:text-neutral-700'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                )}

                {mode === 'invite' && !selected && (
                    <div className="flex flex-col gap-3">
                        <p className="text-caption text-neutral-500">{t('inviteHint')}</p>
                        <MyInput
                            input={inviteName}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setInviteName(e.target.value)
                            }
                            inputType="text"
                            inputPlaceholder={t('fields.fullNamePlaceholder')}
                            label={t('fields.fullNameLabel')}
                            required
                            className="sm:w-full"
                        />
                        <MyInput
                            input={inviteEmail}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setInviteEmail(e.target.value)
                            }
                            inputType="email"
                            inputPlaceholder={t('fields.emailPlaceholder')}
                            label={t('fields.emailLabel')}
                            required
                            className="sm:w-full"
                        />
                    </div>
                )}

                {mode === 'team' && !selected ? (
                    <div className="flex flex-col gap-2">
                        <MyInput
                            input={search}
                            onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                setSearch(e.target.value)
                            }
                            inputType="text"
                            inputPlaceholder={t('teamSearch.placeholder')}
                            className="sm:w-full"
                        />
                        <div className="max-h-64 overflow-y-auto rounded-md border border-neutral-200">
                            {membersQuery.isLoading ? (
                                <div className="p-4 text-body text-neutral-400">
                                    {t('teamSearch.loading')}
                                </div>
                            ) : membersQuery.isError ? (
                                <div className="p-4 text-body text-danger-600">
                                    {t('teamSearch.loadError')}
                                </div>
                            ) : filtered.length === 0 ? (
                                <div className="p-4 text-body text-neutral-400">
                                    {members.length === 0
                                        ? t('teamSearch.noMembers')
                                        : t('teamSearch.noMatches')}
                                </div>
                            ) : (
                                filtered.map((m) => (
                                    <button
                                        type="button"
                                        key={m.id}
                                        onClick={() => pick(m)}
                                        className="flex w-full items-center gap-3 border-b border-neutral-100 px-3 py-2 text-left last:border-b-0 hover:bg-neutral-50"
                                    >
                                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-caption font-semibold text-primary-600">
                                            {initials(m.full_name)}
                                        </span>
                                        <span className="flex flex-col">
                                            <span className="text-body text-neutral-700">
                                                {m.full_name || m.email || m.id}
                                            </span>
                                            <span className="text-caption text-neutral-400">
                                                {m.email}
                                                {m.roles && m.roles.length
                                                    ? ` · ${m.roles.join(', ')}`
                                                    : ''}
                                            </span>
                                        </span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                ) : mode === 'invite' ? (
                    <OptionalDetails open={showDetails} onToggle={() => setShowDetails((v) => !v)}>
                        <MentorProfileFields values={profile} onChange={setProfile} />
                    </OptionalDetails>
                ) : selected ? (
                    <>
                        <div className="flex items-center justify-between gap-3 rounded-md border border-primary-200 bg-primary-50 px-3 py-2">
                            <div className="flex items-center gap-2">
                                <Check size={16} weight="bold" className="text-primary-500" />
                                <div className="flex flex-col">
                                    <span className="text-body font-medium text-neutral-700">
                                        {selected.full_name || selected.email}
                                    </span>
                                    <span className="text-caption text-neutral-400">
                                        {selected.email}
                                    </span>
                                </div>
                            </div>
                            <MyButton
                                type="button"
                                buttonType="text"
                                scale="small"
                                onClick={() => setSelected(null)}
                                title={t('selectedMember.changeTitle')}
                            >
                                {t('selectedMember.change')}
                            </MyButton>
                        </div>

                        <OptionalDetails
                            open={showDetails}
                            onToggle={() => setShowDetails((v) => !v)}
                        >
                            <div className="flex items-center gap-4">
                                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-neutral-100">
                                    {photoUrl ? (
                                        <img
                                            src={photoUrl}
                                            alt={t('photo.alt')}
                                            className="h-full w-full object-cover"
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
                                            ? t('photo.uploading')
                                            : photoUrl
                                              ? t('photo.change')
                                              : t('photo.upload')}
                                    </MyButton>
                                    <span className="text-caption text-neutral-400">
                                        {t('photo.hint')}
                                    </span>
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
                                inputPlaceholder={selected.full_name || t('fields.displayNameLabel')}
                                label={t('fields.displayNameLabel')}
                                className="sm:w-full"
                            />
                            <MyInput
                                input={title}
                                onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setTitle(e.target.value)
                                }
                                inputType="text"
                                inputPlaceholder={t('fields.titlePlaceholder')}
                                label={t('fields.titleLabel')}
                                className="sm:w-full"
                            />
                            <MyInput
                                input={bio}
                                onChangeFunction={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    setBio(e.target.value)
                                }
                                inputType="text"
                                inputPlaceholder={t('fields.bioPlaceholder')}
                                label={t('fields.bioLabel')}
                                className="sm:w-full"
                            />

                            <MentorProfileFields values={profile} onChange={setProfile} />
                        </OptionalDetails>
                    </>
                ) : null}
            </div>
        </MyDialog>
    );
}
