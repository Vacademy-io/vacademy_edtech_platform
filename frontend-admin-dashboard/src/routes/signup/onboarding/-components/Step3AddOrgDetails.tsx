import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';

import { useAddOrgStore } from '../-zustand-store/step2AddOrgZustand';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { handleSignupInstitute } from '../../-services/signup-services';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import useOrganizationStore from '../-zustand-store/step1OrganizationZustand';
import { handleLoginFlow, navigateFromLoginFlow } from '@/lib/auth/loginFlowHandler';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

export interface FormValuesStep1Signup {
    profilePictureUrl: string;
    instituteProfilePic?: string;
    instituteName: string;
    instituteType: string;
    instituteThemeCode?: string;
}

const buildOrganizationDetailsSignupStep1 = (t: TFunction) =>
    z
        .object({
            name: z.string().min(1, t('schema.nameRequired')),
            username: z
                .string()
                .min(1, t('schema.usernameRequired'))
                .refine((value) => value === value.toLowerCase(), {
                    message: t('schema.usernameNoUppercase'),
                }),
            email: z.string().min(1, t('schema.emailRequired')).email(t('schema.emailInvalid')),
            password: z.string().min(6, t('schema.passwordMinLength')),
            confirmPassword: z.string().min(1, t('schema.confirmPasswordRequired')),
            roleType: z.array(z.string()).min(1, t('schema.roleTypeRequired')),
        })
        .refine((data) => data.password === data.confirmPassword, {
            message: t('schema.passwordsMismatch'),
            path: ['confirmPassword'],
        });

type FormValues = z.infer<ReturnType<typeof buildOrganizationDetailsSignupStep1>>;

// Type-only export for consumers (signup-services.ts, helper.ts) that need the shape
// of this form's values but must not construct/parse against a translated schema
// outside a component (organizationDetailsSignupStep1 used to be the schema value
// itself; it is now a factory that requires a `t` from useTranslation()).
export type OrganizationDetailsSignupStep1Values = FormValues;

interface SignupData {
    full_name: string;
    user_name: string;
    email: string;
    password: string;
    user_roles: string[];
    subject_id?: string;
    vendor_id?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
}

export function Step3AddOrgDetails() {
    const { t } = useTranslation('signupOnboardingStep3AddOrgDetails');
    const queryClient = useQueryClient();
    const { setFormDataAddOrg, resetAddOrgForm } = useAddOrgStore();
    const { formData, resetForm } = useOrganizationStore();
    const [signupData, setSignupData] = useState<SignupData | null>(null);

    const organizationDetailsSignupStep1 = useMemo(
        () => buildOrganizationDetailsSignupStep1(t),
        [t]
    );

    const form = useForm<FormValues>({
        resolver: zodResolver(organizationDetailsSignupStep1),
        defaultValues: {
            name: '',
            username: '',
            email: '',
            password: '',
            confirmPassword: '',
            roleType: ['ADMIN'],
        },
        mode: 'onChange',
    });

    useEffect(() => {
        const url = new URL(window.location.href);
        const signupDataParam = url.searchParams.get('signupData');

        if (signupDataParam) {
            try {
                const decoded = decodeURIComponent(signupDataParam);
                const parsed = JSON.parse(atob(decoded));

                const enrichedSignupData: SignupData = {
                    full_name: parsed.name || '',
                    user_name: parsed.name?.toLowerCase().replace(/\s/g, '') || '',
                    email: parsed.email || '',
                    password: parsed.password || '',
                    user_roles: ['ADMIN'],
                    subject_id: parsed.sub ?? '',
                    vendor_id: parsed.provider ?? '',
                    ...parsed,
                };

                setSignupData(enrichedSignupData);

                form.reset({
                    name: enrichedSignupData.full_name,
                    username: enrichedSignupData.user_name,
                    email: enrichedSignupData.email,
                    password: enrichedSignupData.password,
                    confirmPassword: enrichedSignupData.password,
                    roleType: enrichedSignupData.user_roles,
                });
            } catch (e) {
                console.error('Failed to decode signupData:', e);
            }
        }
    }, [form]);

    const { getValues } = form;
    const isValid =
        !!getValues('name') &&
        !!getValues('username') &&
        !!getValues('email') &&
        !!getValues('password') &&
        !!getValues('confirmPassword');

    const handleSignupInstituteMutation = useMutation({
        mutationFn: async ({
            searchParams,
            formData,
            formDataOrg,
            signupData,
        }: {
            searchParams: Record<string, boolean>;
            formData: FormValuesStep1Signup;
            formDataOrg: z.infer<typeof organizationDetailsSignupStep1>;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            signupData?: Record<string, any>;
        }) => {
            return handleSignupInstitute({
                searchParams,
                formData,
                formDataOrg,
                signupData: {
                    ...signupData,
                    subject_id: signupData?.subject_id ?? '',
                    vendor_id: signupData?.vendor_id ?? '',
                },
            });
        },
        onSuccess: async (data) => {
            queryClient.invalidateQueries({ queryKey: ['GET_BOTH_INSTITUTE_APIS'] });

            // Use centralized login flow
            const result = await handleLoginFlow({
                loginMethod: 'signup',
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                queryClient,
            });

            if (result.shouldShowInstituteSelection) {
                // For signup, we'll redirect to institute selection page
                window.location.href = '/login?showInstituteSelection=true';
            } else {
                resetForm();
                resetAddOrgForm();
                navigateFromLoginFlow(result);
            }
        },
        onError: (error: unknown) => {
            if (error instanceof AxiosError) {
                toast.error(error?.response?.data?.ex, {
                    className: 'error-toast',
                    duration: 2000,
                });
            } else {
                console.error('Unexpected error:', error);
            }
        },
    });

    function onSubmit(values: FormValues) {
        setFormDataAddOrg({ ...values });

        const url = new URL(window.location.href);
        handleSignupInstituteMutation.mutate({
            searchParams: {
                assess: url.searchParams.get('assess') === 'true',
                lms: url.searchParams.get('lms') === 'true',
                volt: url.searchParams.get('volt') === 'true',
                vsmart: url.searchParams.get('vsmart') === 'true',
            },
            formData,
            formDataOrg: values,
            signupData: signupData || undefined,
        });
    }

    return (
        <FormProvider {...form}>
            <form>
                <div className="my-6 flex flex-col items-center justify-center gap-4 lg:gap-8">
                    <h1 className="text-xl lg:text-[1.6rem]">{t('heading')}</h1>

                    {/* Full Name */}
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field: { onChange, value, ...field } }) => (
                            <FormItem className="w-full max-w-sm">
                                <FormControl>
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('fullNamePlaceholder')}
                                        input={value}
                                        onChangeFunction={onChange}
                                        required
                                        error={form.formState.errors.name?.message}
                                        size="large"
                                        label={t('fullNameLabel')}
                                        {...field}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    {/* Username */}
                    <FormField
                        control={form.control}
                        name="username"
                        render={({ field: { onChange, value, ...field } }) => (
                            <FormItem className="w-full max-w-sm">
                                <FormControl>
                                    <MyInput
                                        inputType="text"
                                        inputPlaceholder={t('usernamePlaceholder')}
                                        input={value}
                                        onChangeFunction={onChange}
                                        required
                                        error={form.formState.errors.username?.message}
                                        size="large"
                                        label={t('usernameLabel')}
                                        {...field}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    {/* Email */}
                    <FormField
                        control={form.control}
                        name="email"
                        render={({ field: { onChange, value, ...field } }) => (
                            <FormItem className="w-full max-w-sm">
                                <FormControl>
                                    <MyInput
                                        inputType="email"
                                        inputPlaceholder={t('emailPlaceholder')}
                                        input={value}
                                        onChangeFunction={onChange}
                                        required
                                        error={form.formState.errors.email?.message}
                                        size="large"
                                        label={t('emailLabel')}
                                        {...field}
                                        className="w-full"
                                        disabled={!!signupData?.email}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    {/* Password */}
                    <FormField
                        control={form.control}
                        name="password"
                        render={({ field: { onChange, value, ...field } }) => (
                            <FormItem className="w-full max-w-sm">
                                <FormControl>
                                    <MyInput
                                        inputType="password"
                                        inputPlaceholder="******"
                                        input={value}
                                        onChangeFunction={onChange}
                                        required
                                        error={form.formState.errors.password?.message}
                                        size="large"
                                        label={t('passwordLabel')}
                                        {...field}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    {/* Confirm Password */}
                    <FormField
                        control={form.control}
                        name="confirmPassword"
                        render={({ field: { onChange, value, ...field } }) => (
                            <FormItem className="w-full max-w-sm">
                                <FormControl>
                                    <MyInput
                                        inputType="password"
                                        inputPlaceholder="******"
                                        input={value}
                                        onChangeFunction={onChange}
                                        required
                                        error={form.formState.errors.confirmPassword?.message}
                                        size="large"
                                        label={t('confirmPasswordLabel')}
                                        {...field}
                                        className="w-full"
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    {/* Submit Button */}
                    <MyButton
                        type="button"
                        scale="large"
                        buttonType="primary"
                        layoutVariant="default"
                        onClick={form.handleSubmit(onSubmit)}
                        className="mt-4"
                        disable={!isValid}
                    >
                        {t('finish')}
                    </MyButton>
                </div>
            </form>
        </FormProvider>
    );
}

export default Step3AddOrgDetails;
