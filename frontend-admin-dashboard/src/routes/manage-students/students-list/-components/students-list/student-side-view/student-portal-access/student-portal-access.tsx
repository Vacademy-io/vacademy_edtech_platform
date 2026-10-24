import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
import { useState, useEffect, useMemo } from 'react';
import {
    Key,
    Copy,
    Check,
    Shield,
    MonitorPlay,
    Envelope,
    PencilSimple,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { useStudentSidebar } from '../../../../-context/selected-student-sidebar-context';
import { useStudentCredentails } from '@/services/student-list-section/getStudentCredentails';
import { useDialogStore } from '@/routes/manage-students/students-list/-hooks/useDialogStore';
import {
    getDisplaySettingsWithFallback,
    getDisplaySettingsFromCache,
} from '@/services/display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY,
    CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    type LearnerManagementSettings,
} from '@/types/display-settings';
import { isUserAdmin } from '@/utils/userDetails';
import { getLearnerPortalAccess } from '@/services/learner-portal-access';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { BatchPicker } from '../BatchPicker';
import { EditCredentialsDialog } from './edit-credentials-dialog';
import { SendResetPasswordDialog } from './send-reset-password-dialog';
import { OfflineDevicesCard } from './offline-devices-card';
import { useOfflineAccessEnabled } from '@/routes/settings/-hooks/use-offline-access-enabled';

export const StudentPortalAccess = ({ isSubmissionTab }: { isSubmissionTab?: boolean }) => {
    const { t } = useTranslation('manageStudentsPortalAccess');
    const { selectedStudent } = useStudentSidebar();
    const { openIndividualShareCredentialsDialog } = useDialogStore();
    const { getDetailsFromPackageSessionId } = useInstituteDetailsStore();
    const [copiedField, setCopiedField] = useState<string>('');
    const [learnerSettings, setLearnerSettings] = useState<LearnerManagementSettings | null>(null);
    const offlineAccessEnabled = useOfflineAccessEnabled();

    const userId = isSubmissionTab ? selectedStudent?.id : selectedStudent?.user_id;
    const { data: credentials, isLoading: isCredentialsLoading } = useStudentCredentails({
        userId: userId || '',
    });
    // `hasPassword` tracks whether a real password value exists, independent of
    // the translated placeholder text shown while loading / not-found — the copy
    // button's visibility must never branch on a translated display string.
    const hasPassword = Boolean(credentials?.password);
    const password =
        credentials?.password ||
        (isCredentialsLoading ? t('credentials.loadingPlaceholder') : t('credentials.notFoundPlaceholder'));
    const [isEditCredentialsOpen, setIsEditCredentialsOpen] = useState(false);
    const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
    // Set on a successful rename so the card reflects it straight away —
    // `selectedStudent` comes from the list row and keeps the old value until
    // that query refetches. Stored WITH the user it belongs to and matched
    // during render rather than cleared in an effect: an effect only runs after
    // the render that switched learners, so the new learner's card would show
    // the previous learner's username for a frame.
    const [renamed, setRenamed] = useState<{ userId: string; username: string } | null>(null);
    // Submission-tab rows don't carry `username`; fall back to the credentials
    // API (which returns it) so the field isn't stuck on "N/A".
    const username =
        (renamed && renamed.userId === userId ? renamed.username : '') ||
        selectedStudent?.username ||
        credentials?.username ||
        '';

    // For multi-enrollment learners: admin picks which batch's package the portal redirect /
    // reset-password email is scoped to. Defaults to the row's primary (latest) ps_id.
    // Falls back to the legacy single field when the new array isn't populated.
    const enrollmentPsIds: string[] = (
        selectedStudent?.all_package_session_ids?.length
            ? selectedStudent.all_package_session_ids
            : selectedStudent?.package_session_id
              ? [selectedStudent.package_session_id]
              : []
    ) as string[];
    const [selectedPsId, setSelectedPsId] = useState<string>(enrollmentPsIds[0] ?? '');
    useEffect(() => {
        setSelectedPsId(enrollmentPsIds[0] ?? '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedStudent?.user_id]);

    useEffect(() => {
        const fetchLearnerSettings = async () => {
            const isAdmin = isUserAdmin();
            const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
            const roleKey = getActiveRoleDisplaySettingsKey();

            const cachedSettings = getDisplaySettingsFromCache(roleKey);
            const settings =
                cachedSettings?.learnerManagement ||
                (await getDisplaySettingsWithFallback(roleKey)).learnerManagement;

            if (settings) {
                setLearnerSettings(settings);
            }
        };

        fetchLearnerSettings();
    }, []);

    // Editing credentials is an admin capability by default; teachers and custom
    // roles only get it if an admin turns it on for them in Display Settings.
    // The `??` matters: institutes whose saved settings blob predates this flag
    // have no key at all, and an admin must still see the button.
    //
    // isUserAdmin() reads a cookie and decodes the JWT on every call, so it is
    // resolved once rather than on each render — the viewer's role cannot change
    // while this component is mounted.
    const viewerIsAdmin = useMemo(() => isUserAdmin(), []);
    const canEditCredentials = learnerSettings?.allowEditCredentials ?? viewerIsAdmin;

    // `fieldKey` is an internal identifier used for both the copy-icon toggle
    // state and to look up the translated field name for toasts — kept as a
    // stable lowercase key so it never doubles as (and drifts from) display text.
    const handleCopy = async (text: string, fieldKey: 'username' | 'password') => {
        const fieldLabel =
            fieldKey === 'username'
                ? t('credentials.usernameFieldName')
                : t('credentials.passwordFieldName');
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldKey);
            toast.success(t('toast.copiedToClipboard', { field: fieldLabel }));
            setTimeout(() => setCopiedField(''), 2000);
        } catch (error) {
            toast.error(t('toast.copyFailed', { field: fieldLabel }));
        }
    };

    const handleAccessPortal = async () => {
        if (!selectedStudent?.user_id) {
            toast.error(t('toast.studentUserIdNotFound'));
            return;
        }

        // Get packageId from selectedStudent.package_id or derive it from package_session_id
        let packageId = selectedStudent.package_id;

        if (!packageId && selectedPsId) {
            const batchDetails = getDetailsFromPackageSessionId({
                packageSessionId: selectedPsId,
            });
            packageId = batchDetails?.package_dto?.id;
        }

        if (!packageId) {
            toast.error(t('toast.studentPackageIdNotFound'));
            return;
        }

        try {
            toast.loading(t('toast.accessingPortal'));
            const response = await getLearnerPortalAccess(selectedStudent.user_id, packageId);

            if (response.redirect_url) {
                // Open the redirect URL in a new tab
                window.open(response.redirect_url, '_blank', 'noopener,noreferrer');
                toast.success(t('toast.portalOpened'));
            } else {
                toast.error(t('toast.noRedirectUrl'));
            }
        } catch (error) {
            console.error('Error accessing learner portal:', error);
            toast.error(t('toast.accessPortalFailed'));
        } finally {
            toast.dismiss();
        }
    };

    // The package only matters to the system-default path, where an institute may have a
    // workflow bound to the send. The template path addresses the learner, not an enrollment,
    // so a learner with no resolvable package can still be sent a reset link.
    const resolvedPackageId = (() => {
        if (selectedStudent?.package_id) return selectedStudent.package_id;
        if (!selectedPsId) return undefined;
        return getDetailsFromPackageSessionId({ packageSessionId: selectedPsId })?.package_dto?.id;
    })();

    const handleOpenResetPassword = () => {
        if (!selectedStudent?.user_id) {
            toast.error(t('toast.studentUserIdNotFound'));
            return;
        }
        setIsResetPasswordOpen(true);
    };

    return (
        <div className="space-y-4">
            <BatchPicker
                packageSessionIds={enrollmentPsIds}
                value={selectedPsId}
                onChange={setSelectedPsId}
                label={t('batchPicker.openPortalForLabel')}
            />

            {/* Account Credentials Section.
                Rendered when the viewer may see the credentials OR change them —
                those are separate permissions, and gating the whole card on
                "view" alone would swallow the Edit button for a role that was
                granted edit without view. The values below stay behind the view
                flag; only the Edit action is behind the edit flag. */}
            {(learnerSettings?.allowViewPassword || canEditCredentials) && (
                <div className="group rounded-lg border border-neutral-200/50 bg-gradient-to-br from-white to-primary-50/30 p-3 transition-all duration-200 hover:scale-[1.01] hover:border-primary-200/50 hover:shadow-md">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="rounded-md bg-gradient-to-br from-primary-50 to-primary-100 p-1 transition-transform duration-200 group-hover:scale-105">
                                <Key className="size-3.5 text-primary-600" />
                            </div>
                            <h3 className="text-xs font-semibold text-neutral-700 transition-colors duration-200 group-hover:text-primary-700">
                                {t('credentials.title')}
                            </h3>
                        </div>

                        <div className="flex items-center gap-1.5">
                            {canEditCredentials && userId && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    disable={false}
                                    onClick={() => setIsEditCredentialsOpen(true)}
                                    className="h-auto min-h-0 cursor-pointer px-2 py-1 text-2xs"
                                    style={{ pointerEvents: 'auto', zIndex: 10 }}
                                >
                                    <PencilSimple className="mr-1 size-2.5" />
                                    {t('credentials.edit')}
                                </MyButton>
                            )}

                            {/* Sharing mails the password out, so it belongs to the
                                view permission, not the edit one. */}
                            {learnerSettings?.allowViewPassword && (
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    disable={false}
                                    onClick={() => {
                                        if (selectedStudent) {
                                            openIndividualShareCredentialsDialog(selectedStudent);
                                        }
                                    }}
                                    className="h-auto min-h-0 cursor-pointer px-2 py-1 text-2xs"
                                    style={{ pointerEvents: 'auto', zIndex: 10 }}
                                >
                                    <Shield className="mr-1 size-2.5" />
                                    {t('credentials.share')}
                                </MyButton>
                            )}
                        </div>
                    </div>

                    <div className="space-y-1">
                        {/* Username */}
                        {learnerSettings?.allowViewPassword && (
                            <div className="flex items-start gap-2 rounded-md px-1.5 py-1">
                                <div className="mt-1.5 size-1 shrink-0 rounded-full bg-neutral-300"></div>
                                <div className="min-w-0 flex-1 text-xs leading-relaxed text-neutral-700">
                                    <span className="font-medium text-neutral-600">
                                        {t('credentials.usernameLabel')}{' '}
                                    </span>
                                    <span className="group/value relative inline-flex items-center text-neutral-800">
                                        <span>{username || t('credentials.usernameNotFound')}</span>
                                        {username && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    username && handleCopy(username, 'username');
                                                }}
                                                className="ml-2 cursor-pointer rounded-md p-1 hover:bg-neutral-200"
                                                style={{ pointerEvents: 'auto' }}
                                            >
                                                {copiedField === 'username' ? (
                                                    <Check className="size-3 text-green-600" />
                                                ) : (
                                                    <Copy className="size-3 text-neutral-500 hover:text-neutral-700" />
                                                )}
                                            </button>
                                        )}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Password */}
                        {learnerSettings?.allowViewPassword && (
                            <div className="flex items-start gap-2 rounded-md px-1.5 py-1">
                                <div className="mt-1.5 size-1 shrink-0 rounded-full bg-neutral-300"></div>
                                <div className="min-w-0 flex-1 text-xs leading-relaxed text-neutral-700">
                                    <span className="font-medium text-neutral-600">
                                        {t('credentials.passwordLabel')}{' '}
                                    </span>
                                    <span className="group/value relative inline-flex items-center text-neutral-800">
                                        <span>{password}</span>
                                        {(hasPassword || isCredentialsLoading) && (
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(password, 'password')}
                                                className="ml-2 cursor-pointer rounded-md p-1 hover:bg-neutral-200"
                                                style={{ pointerEvents: 'auto' }}
                                            >
                                                {copiedField === 'password' ? (
                                                    <Check className="size-3 text-green-600" />
                                                ) : (
                                                    <Copy className="size-3 text-neutral-500 hover:text-neutral-700" />
                                                )}
                                            </button>
                                        )}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Action Buttons Section */}
            <div className="space-y-2">
                {learnerSettings?.allowPortalAccess && (
                    <div className="rounded-lg border border-neutral-200/50 bg-gradient-to-br from-white to-blue-50/30 p-3 transition-all duration-200 hover:border-blue-200/50 hover:shadow-md">
                        <div className="mb-2 flex items-center gap-2">
                            <div className="rounded-md bg-gradient-to-br from-blue-50 to-blue-100 p-1.5">
                                <MonitorPlay className="size-4 text-blue-600" />
                            </div>
                            <div className="flex-1">
                                <h4 className="text-xs font-medium text-neutral-700">
                                    {t('actions.learnerPortal.title')}
                                </h4>
                                <p className="text-2xs text-neutral-500">
                                    {t('actions.learnerPortal.description')}
                                </p>
                            </div>
                        </div>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            disable={false}
                            onClick={handleAccessPortal}
                            className="w-full cursor-pointer text-xs"
                            style={{ pointerEvents: 'auto', zIndex: 10 }}
                        >
                            <MonitorPlay className="mr-1.5 size-3.5" />
                            {t('actions.learnerPortal.button')}
                        </MyButton>
                    </div>
                )}

                {learnerSettings?.allowSendResetPasswordMail && (
                    <div className="rounded-lg border border-neutral-200/50 bg-gradient-to-br from-white to-green-50/30 p-3 transition-all duration-200 hover:border-green-200/50 hover:shadow-md">
                        <div className="mb-2 flex items-center gap-2">
                            <div className="rounded-md bg-gradient-to-br from-green-50 to-green-100 p-1.5">
                                <Envelope className="size-4 text-green-600" />
                            </div>
                            <div className="flex-1">
                                <h4 className="text-xs font-medium text-neutral-700">
                                    {t('actions.resetPassword.title')}
                                </h4>
                                <p className="text-2xs text-neutral-500">
                                    {t('actions.resetPassword.description')}
                                </p>
                            </div>
                        </div>
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={false}
                            onClick={handleOpenResetPassword}
                            className="w-full cursor-pointer border-green-200 text-xs text-green-700 hover:border-green-300 hover:bg-green-50"
                            style={{ pointerEvents: 'auto', zIndex: 10 }}
                        >
                            <Envelope className="mr-1.5 size-3.5" />
                            {t('actions.resetPassword.button')}
                        </MyButton>
                    </div>
                )}
            </div>

            {selectedStudent?.user_id && (
                <SendResetPasswordDialog
                    open={isResetPasswordOpen}
                    onOpenChange={setIsResetPasswordOpen}
                    userId={selectedStudent.user_id}
                    packageId={resolvedPackageId}
                    learnerName={selectedStudent.full_name}
                />
            )}

            {canEditCredentials && userId && (
                <EditCredentialsDialog
                    open={isEditCredentialsOpen}
                    onOpenChange={setIsEditCredentialsOpen}
                    userId={userId}
                    currentUsername={username}
                    onUpdated={(newUsername) => setRenamed({ userId, username: newUsername })}
                />
            )}

            {/* Registered offline-download devices (admin view + revoke). Hidden
                when the institute's offline access master switch is off — no
                device can register while it is off, so the card is always empty. */}
            {!isSubmissionTab && userId && offlineAccessEnabled && (
                <OfflineDevicesCard userId={userId} />
            )}

            {/* Info when no settings enabled */}
            {!learnerSettings?.allowViewPassword &&
                !canEditCredentials &&
                !learnerSettings?.allowPortalAccess &&
                !learnerSettings?.allowSendResetPasswordMail && (
                    <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-200 bg-neutral-50/50 py-12">
                        <Shield className="mb-2 size-8 text-neutral-400" />
                        <p className="text-sm text-neutral-500">{t('emptyState.title')}</p>
                        <p className="text-xs text-neutral-400">{t('emptyState.description')}</p>
                    </div>
                )}
        </div>
    );
};
