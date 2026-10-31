import { useState, useEffect, useMemo } from 'react';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useNavigate } from '@tanstack/react-router';
import {
    Eye,
    EyeSlash,
    User,
    Lock,
    CheckCircle,
    WarningCircle,
    CircleNotch,
    Info,
} from '@phosphor-icons/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { UPDATE_USER_DETAILS } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getUserId, getUserName } from '@/utils/userDetails';
import { removeCookiesAndLogout } from '@/lib/auth/sessionUtility';
import { MyDialog } from '@/components/design-system/dialog';
import { cn } from '@/lib/utils';
import { noAutofillProps } from '@/lib/no-autofill';
import { AutofillDecoy } from '@/components/design-system/autofill-decoy';

// Validation schemas
const buildAccountDetailsSchema = (t: TFunction) =>
    z
        .object({
            username: z
                .string()
                .min(3, t('validation.usernameMin'))
                .max(50, t('validation.usernameMax')),
            newPassword: z.string().min(4, t('validation.newPasswordMin')),
            confirmPassword: z.string().min(1, t('validation.confirmPasswordRequired')),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
            message: t('password.mismatch'),
            path: ['confirmPassword'],
        });

type AccountDetailsFormData = z.infer<ReturnType<typeof buildAccountDetailsSchema>>;

interface AccountDetailsProps {
    open: boolean;
    setOpen: (open: boolean) => void;
    onClose?: () => void;
}

export default function AccountDetailsEdit({ open, setOpen, onClose }: AccountDetailsProps) {
    const { t } = useTranslation('dashboardAccountDetailsEdit');
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [userId, setUserId] = useState<string>('');
    const [currentUsername, setCurrentUsername] = useState<string>('');
    const [redirecting, setRedirecting] = useState(false);
    const accountDetailsSchema = useMemo(() => buildAccountDetailsSchema(t), [t]);
    const {
        register,
        handleSubmit,
        formState: { errors },
        setValue,
        watch,
    } = useForm<AccountDetailsFormData>({
        resolver: zodResolver(accountDetailsSchema),
        defaultValues: {
            username: '',
            newPassword: '',
            confirmPassword: '',
        },
    });

    // Watch for password changes to show validation feedback
    const newPassword = watch('newPassword');
    const confirmPassword = watch('confirmPassword');

    const passwordValidations = [
        { label: t('password.minLengthHint'), valid: newPassword.length >= 4 },
    ];

    const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;

    // Load user details from preferences
    useEffect(() => {
        const loadUserDetails = async () => {
            try {
                const username = getUserName();
                const user_id = getUserId();
                setUserId(user_id || '');
                setCurrentUsername(username || '');
                setValue('username', username || '');
            } catch (error) {
                console.error('Error loading user details:', error);
                toast.error(t('toast.loadUserFailed'));
            }
        };

        loadUserDetails();
    }, [setValue]);

    const handleClose = async () => {
        setRedirecting(true);
        if (onClose) {
            onClose();
        } else {
            navigate({ to: '/dashboard' });
        }
        setRedirecting(false);
    };

    const onSubmit = async (data: AccountDetailsFormData) => {
        if (!userId) {
            toast.error(t('toast.userIdMissing'));
            return;
        }

        setIsLoading(true);

        try {
            // Prepare the request payload
            const updatePayload = {
                username: data.username,
                password: data.newPassword,
            };

            // Make API call to update user details
            const response = await authenticatedAxiosInstance.put(
                `${UPDATE_USER_DETAILS}?userId=${userId}`,
                updatePayload
            );

            if (response.status === 200) {
                removeCookiesAndLogout();
                toast.success(t('toast.updateSuccess'));
                handleClose();
            }
        } catch (error: unknown) {
            console.error('Error updating account details:', error);

            // Handle specific error cases
            const axiosError = error as {
                response?: { status?: number; data?: { message?: string } };
            };
            if (axiosError.response?.status === 510) {
                toast.error(t('toast.usernameExists'));
            } else if (axiosError.response?.data?.message) {
                toast.error(axiosError.response.data.message);
            } else {
                toast.error(t('toast.updateFailed'));
            }
        } finally {
            setIsLoading(false);
        }
    };

    const renderError = (message?: string) =>
        message ? (
            <p className="flex items-center gap-1 text-caption text-danger-600">
                <WarningCircle className="size-3.5 shrink-0" />
                {message}
            </p>
        ) : null;

    return (
        <MyDialog
            open={open}
            onOpenChange={setOpen}
            heading={t('dialogTitle')}
            dialogWidth="max-w-lg"
            footer={
                <>
                    <MyButton
                        type="button"
                        scale="medium"
                        buttonType="secondary"
                        onClick={handleClose}
                        disable={isLoading || redirecting}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton
                        type="submit"
                        form={ACCOUNT_DETAILS_FORM_ID}
                        scale="medium"
                        buttonType="primary"
                        disable={isLoading}
                    >
                        {isLoading && <CircleNotch className="size-4 animate-spin" />}
                        {isLoading ? t('actions.updating') : t('actions.update')}
                    </MyButton>
                </>
            }
        >
            <form
                id={ACCOUNT_DETAILS_FORM_ID}
                onSubmit={handleSubmit(onSubmit)}
                className="flex flex-col gap-6"
            >
                {/* Change-credentials form, not a login: without this Chrome
                    drops the saved password straight into "New Password". */}
                <AutofillDecoy />

                <div className="flex items-start gap-2 rounded-md border border-info-200 bg-info-50 p-3 text-caption text-info-700">
                    <Info className="mt-0.5 size-4 shrink-0" />
                    <span>{t('signOutNote')}</span>
                </div>

                {/* Username Section */}
                <section className="flex flex-col gap-3">
                    <SectionHeading icon={<User className="size-4" />}>
                        {t('username.sectionTitle')}
                    </SectionHeading>
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="username" className="text-body text-neutral-700">
                            {t('username.label')}
                        </Label>
                        <Input
                            id="username"
                            {...noAutofillProps('text')}
                            {...register('username')}
                            placeholder={t('username.placeholder')}
                            className={cn('h-10 text-body', errors.username && 'border-danger-600')}
                            disabled={isLoading}
                        />
                        {renderError(errors.username?.message)}
                        {currentUsername && !errors.username && (
                            <p className="text-caption text-neutral-500">
                                {t('username.current', { username: currentUsername })}
                            </p>
                        )}
                    </div>
                </section>

                {/* Password Section */}
                <section className="flex flex-col gap-3 border-t border-neutral-200 pt-6">
                    <SectionHeading icon={<Lock className="size-4" />}>
                        {t('password.sectionTitle')}
                    </SectionHeading>

                    {/* New Password */}
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="newPassword" className="text-body text-neutral-700">
                            {t('password.newLabel')}
                        </Label>
                        <div className="relative">
                            <Input
                                id="newPassword"
                                type={showNewPassword ? 'text' : 'password'}
                                {...noAutofillProps('password')}
                                {...register('newPassword')}
                                placeholder={t('password.newPlaceholder')}
                                className={cn(
                                    'h-10 pr-10 text-body',
                                    errors.newPassword && 'border-danger-600'
                                )}
                                disabled={isLoading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                            >
                                {showNewPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        {renderError(errors.newPassword?.message)}

                        {/* Password validation indicators */}
                        {newPassword && !errors.newPassword && (
                            <div className="flex flex-col gap-1">
                                {passwordValidations.map((validation, index) => (
                                    <div
                                        key={index}
                                        className={cn(
                                            'flex items-center gap-1 text-caption',
                                            validation.valid
                                                ? 'text-success-600'
                                                : 'text-neutral-400'
                                        )}
                                    >
                                        {validation.valid ? (
                                            <CheckCircle size={12} />
                                        ) : (
                                            <WarningCircle size={12} />
                                        )}
                                        <span>{validation.label}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Confirm Password */}
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="confirmPassword" className="text-body text-neutral-700">
                            {t('password.confirmLabel')}
                        </Label>
                        <div className="relative">
                            <Input
                                id="confirmPassword"
                                type={showConfirmPassword ? 'text' : 'password'}
                                {...noAutofillProps('password')}
                                {...register('confirmPassword')}
                                placeholder={t('password.confirmPlaceholder')}
                                className={cn(
                                    'h-10 pr-10 text-body',
                                    errors.confirmPassword && 'border-danger-600'
                                )}
                                disabled={isLoading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                            >
                                {showConfirmPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                        {errors.confirmPassword ? (
                            renderError(errors.confirmPassword.message)
                        ) : confirmPassword ? (
                            <div
                                className={cn(
                                    'flex items-center gap-1 text-caption',
                                    passwordsMatch ? 'text-success-600' : 'text-danger-600'
                                )}
                            >
                                {passwordsMatch ? (
                                    <CheckCircle size={12} />
                                ) : (
                                    <WarningCircle size={12} />
                                )}
                                <span>
                                    {passwordsMatch ? t('password.match') : t('password.mismatch')}
                                </span>
                            </div>
                        ) : null}
                    </div>
                </section>
            </form>
        </MyDialog>
    );
}

const ACCOUNT_DETAILS_FORM_ID = 'account-details-form';

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <h3 className="flex items-center gap-2 text-subtitle font-semibold text-neutral-700">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary-50 text-primary-500">
                {icon}
            </span>
            {children}
        </h3>
    );
}
