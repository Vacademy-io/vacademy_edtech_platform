import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import {
    ArrowCounterClockwise,
    BookOpen,
    Check,
    Eye,
    GraduationCap,
    Info,
    Medal,
    Target,
    X,
} from '@phosphor-icons/react';
import { FormProvider, useForm, UseFormReturn } from 'react-hook-form';
import { InviteLinkFormValues } from './GenerateInviteLinkSchema';
import { FormControl, FormField, FormItem } from '@/components/ui/form';
import PhoneInputField from '@/components/design-system/phone-input-field';
import SelectField from '@/components/design-system/select-field';
import { MyInput } from '@/components/design-system/input';
import {
    AssessmentCustomFieldOpenRegistration,
    getDynamicSchema,
} from './-utils/dynamic-registration-form-helper';
import { convertRegistrationFormData } from './-utils/helper';
import z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { getCurrencySymbol, getPaymentPlanIcon } from './PaymentPlansDialog';
import { getAllUniqueFeatures } from './-components/PaymentPlanCard';
import { formatPlanPrice } from '@/utils/finance-utils';
import { useTranslation } from 'react-i18next';

export interface PreviewInviteLinkProps {
    form: UseFormReturn<InviteLinkFormValues>;
    levelName: string;
    instituteLogo: string;
}

// Utility to extract YouTube video ID
const extractYouTubeVideoId = (url: string): string | null => {
    const regExp = /^.*(?:youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[1] && match[1].length === 11 ? match[1] : null;
};

const PreviewInviteLink = ({ form, levelName, instituteLogo }: PreviewInviteLinkProps) => {
    const { t } = useTranslation('manageStudentsPreviewInviteLink');
    // Watch custom_fields for changes
    // Get all unique features across all payment options
    const selectedPlan = form.watch('selectedPlan');
    const allFeatures = selectedPlan?.paymentOption
        ? getAllUniqueFeatures(selectedPlan.paymentOption)
        : [];
    const watchedCustomFields = form.watch('custom_fields');

    // Memoized conversion of custom fields
    const convertedFields = useMemo(() => {
        const fields = watchedCustomFields || [];
        return convertRegistrationFormData(fields);
    }, [watchedCustomFields]);

    // Memoized zodSchema that updates when fields change
    const zodSchema = useMemo(() => {
        return getDynamicSchema(convertedFields);
    }, [convertedFields]);

    type FormValues = z.infer<typeof zodSchema>;
    type FormFieldPath = keyof FormValues extends string ? `${keyof FormValues}.value` : never;

    // Memoized default values that update when fields change
    const defaultValues = useMemo(() => {
        return convertedFields
            .sort(
                (
                    a: AssessmentCustomFieldOpenRegistration,
                    b: AssessmentCustomFieldOpenRegistration
                ) => a.field_order - b.field_order
            )
            .reduce(
                (
                    defaults: Record<
                        string,
                        {
                            id: string;
                            name: string;
                            value: string;
                            is_mandatory: boolean;
                            type: string;
                            comma_separated_options?: string[];
                        }
                    >,
                    field: AssessmentCustomFieldOpenRegistration
                ) => {
                    if (field.field_type === 'dropdown') {
                        const optionsArray = field.comma_separated_options
                            ? field.comma_separated_options.split(',').map((opt) => opt.trim())
                            : [];

                        defaults[field.field_key] = {
                            id: field.id,
                            name: field.field_name,
                            value: optionsArray[0] || '',
                            is_mandatory: field.is_mandatory || false,
                            comma_separated_options: optionsArray,
                            type: field.field_type,
                        };
                    } else {
                        defaults[field.field_key] = {
                            id: field.id,
                            name: field.field_name,
                            value: '',
                            is_mandatory: field.is_mandatory || false,
                            type: field.field_type,
                        };
                    }
                    return defaults;
                },
                {} as Record<
                    string,
                    {
                        id: string;
                        name: string;
                        value: string;
                        is_mandatory: boolean;
                        type: string;
                        comma_separated_options?: string[];
                    }
                >
            );
    }, [convertedFields]);

    const registrationForm = useForm<FormValues>({
        resolver: zodResolver(zodSchema),
        defaultValues,
        mode: 'onChange',
    });

    // Reset form when schema or defaults change
    useEffect(() => {
        registrationForm.reset(defaultValues);
    }, [defaultValues, registrationForm]);
    return (
        <>
            <Dialog>
                <DialogTrigger>
                    <MyButton
                        type="button"
                        scale="small"
                        buttonType="secondary"
                        className="mr-4 p-4 py-5"
                    >
                        <Eye size={32} />
                        {t('previewButton')}
                    </MyButton>
                </DialogTrigger>
                <DialogContent className="mx-auto max-h-dialog-tall space-y-8 overflow-y-auto">
                    <Card className="w-full overflow-hidden border-0 bg-white/80 shadow-xl backdrop-blur-sm">
                        {/* Instiute Logo */}
                        {instituteLogo && (
                            <div className="flex items-center justify-center rounded-lg pt-8">
                                <img
                                    src={instituteLogo}
                                    alt={t('instituteLogoAlt')}
                                    className="size-12 rounded-full"
                                />
                            </div>
                        )}
                        {/* Banner Image */}
                        <div className="rounded-lg p-8 !pb-0">
                            {form.getValues('courseBannerBlob') ? (
                                <div className="relative h-32 w-full overflow-hidden rounded-xl sm:h-56 lg:h-72">
                                    <img
                                        src={form.getValues('courseBannerBlob')}
                                        alt={t('courseBannerAlt')}
                                        className="size-full object-contain"
                                    />
                                </div>
                            ) : (
                                <div className="relative h-32 w-full overflow-hidden rounded-xl bg-primary-500 sm:h-56 lg:h-72"></div>
                            )}
                        </div>
                        <CardContent className="p-6 sm:p-8">
                            {/* Course Name */}
                            <div className="mb-4 flex items-start gap-2 sm:gap-3">
                                <BookOpen className="mt-0.5 size-5 shrink-0 text-blue-600 sm:size-6" />
                                <h2 className="text-lg font-semibold leading-tight text-gray-900 sm:text-xl md:text-2xl">
                                    {form.getValues('course')}
                                </h2>
                            </div>
                            {/* Tags Row */}
                            {form.getValues('tags')?.length > 0 && (
                                <div className="mb-6 flex flex-wrap gap-2">
                                    {form.getValues('tags')?.map((tag: string, index: number) => (
                                        <Badge
                                            key={index}
                                            variant="secondary"
                                            className="bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 transition-colors hover:bg-blue-200"
                                        >
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            )}

                            {/* Course Description */}
                            <p
                                className="mb-6 text-base leading-relaxed text-gray-700 sm:text-lg"
                                dangerouslySetInnerHTML={{
                                    __html: form.getValues('description') || '',
                                }}
                            />

                            {/* Level Badge */}
                            <div className="mb-8 flex items-start gap-2">
                                <Medal className="mt-0.5 size-5 shrink-0 text-amber-500" />
                                <Badge
                                    variant="outline"
                                    className="border-amber-200 px-3 py-1 text-sm font-medium text-amber-700"
                                >
                                    {t('levelLabel')}:&nbsp;{levelName}
                                </Badge>
                            </div>

                            <Separator className="my-8" />

                            {/* What Learners Will Gain Section */}
                            {form.getValues('learningOutcome') && (
                                <div className="mb-8">
                                    <div className="mb-4 flex items-start gap-2 sm:gap-3">
                                        <Target className="mt-0.5 size-5 shrink-0 text-green-600 sm:size-6" />
                                        <h2 className="text-lg font-semibold leading-tight text-gray-900 sm:text-xl md:text-2xl">
                                            {t('learnersGainHeading')}
                                        </h2>
                                    </div>
                                    <div className="grid gap-3">
                                        <p
                                            className="text-sm text-gray-700 sm:text-base"
                                            dangerouslySetInnerHTML={{
                                                __html: form.getValues('learningOutcome') || '',
                                            }}
                                        />
                                    </div>
                                </div>
                            )}

                            {form.getValues('coursePreviewBlob') && (
                                <div className="flex items-center justify-center rounded-lg pt-8">
                                    <img
                                        src={form.getValues('coursePreviewBlob')}
                                        alt={t('coursePreviewAlt')}
                                        className="w-fit"
                                    />
                                </div>
                            )}

                            <Separator className="my-8" />

                            {/* About the Course Section */}
                            {form.getValues('aboutCourse') && (
                                <div className="mb-8">
                                    <div className="mb-4 flex items-start gap-2 sm:gap-3">
                                        <Info className="mt-0.5 size-5 shrink-0 text-blue-600 sm:size-6" />
                                        <h2 className="text-lg font-semibold leading-tight text-gray-900 sm:text-xl md:text-2xl">
                                            {t('aboutCourseHeading')}
                                        </h2>
                                    </div>
                                    <p
                                        className="text-sm leading-relaxed text-gray-700 sm:text-base"
                                        dangerouslySetInnerHTML={{
                                            __html: form.getValues('aboutCourse') || '',
                                        }}
                                    />
                                </div>
                            )}

                            {/* Right side - Video Player - More Compact */}
                            {form.getValues('courseMedia')?.id &&
                                (form.getValues('courseMedia')?.type === 'youtube' ? (
                                    <div
                                        className={`shrink-0 overflow-hidden rounded-lg shadow-lg`}
                                    >
                                        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
                                            <iframe
                                                width="100%"
                                                height="100%"
                                                src={`https://www.youtube.com/embed/${extractYouTubeVideoId(form.getValues('courseMedia')?.id || '')}`}
                                                title={t('youtubePlayerTitle')}
                                                frameBorder="0"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                                className="size-full object-contain"
                                            />
                                        </div>
                                    </div>
                                ) : form.getValues('courseMedia')?.type === 'video' ? (
                                    <div
                                        className={`shrink-0 overflow-hidden rounded-lg shadow-lg`}
                                    >
                                        <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                                            <video
                                                src={form.getValues('courseMediaBlob')}
                                                controls
                                                controlsList="nodownload noremoteplayback"
                                                disablePictureInPicture
                                                disableRemotePlayback
                                                className="size-full object-contain"
                                                onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                    e.currentTarget.parentElement?.classList.add(
                                                        'bg-black'
                                                    );
                                                }}
                                            >
                                                {t('videoNotSupported')}
                                            </video>
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        className={`shrink-0 overflow-hidden rounded-lg shadow-lg`}
                                    >
                                        <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                                            <img
                                                src={form.getValues('courseMediaBlob')}
                                                alt={t('courseBannerAlt')}
                                                className="size-full object-contain"
                                            />
                                        </div>
                                    </div>
                                ))}
                        </CardContent>
                    </Card>
                    {/* Show selected plan in a card */}
                    {(form.watch('selectedPlan')?.type?.toLowerCase() === 'subscription' ||
                        form.watch('selectedPlan')?.type?.toLowerCase() === 'upfront' ||
                        form.watch('selectedPlan')?.type?.toLowerCase() === 'one_time') &&
                        form.watch('includePaymentPlans') && (
                            <Card className="mb-4 flex flex-col gap-0">
                                <div className="flex flex-col items-start gap-3 p-4">
                                    <div className="flex items-center gap-3">
                                        {getPaymentPlanIcon(form.watch('selectedPlan')?.type || '')}
                                        <div className="flex flex-1 flex-col font-semibold">
                                            <span>{form.watch('selectedPlan')?.name}</span>
                                        </div>
                                    </div>
                                    {(form.watch('selectedPlan')?.type === 'upfront' ||
                                        form.watch('selectedPlan')?.type === 'UPFRONT' ||
                                        form.watch('selectedPlan')?.type === 'one_time' ||
                                        form.watch('selectedPlan')?.type === 'ONE_TIME') && (
                                        <div className="flex flex-col gap-4">
                                            {form.watch('selectedPlan')?.paymentOption && (
                                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                                                    {form
                                                        .watch('selectedPlan')
                                                        ?.paymentOption?.map((payment, idx) => {
                                                            return (
                                                                <Card
                                                                    key={idx}
                                                                    className="w-full border border-gray-200 p-4 transition-colors hover:border-gray-300"
                                                                >
                                                                    <div className="flex flex-col gap-3">
                                                                        {/* Title */}
                                                                        <h4 className="text-base font-bold text-gray-900">
                                                                            {payment.title}
                                                                        </h4>

                                                                        {/* Price with time period inline */}
                                                                        <div className="text-xl font-bold text-primary-500">
                                                                            {getCurrencySymbol(
                                                                                form.watch(
                                                                                    'selectedPlan'
                                                                                )?.currency || ''
                                                                            )}
                                                                            {formatPlanPrice(payment.price)}&nbsp;
                                                                            {payment.value &&
                                                                                payment.unit && (
                                                                                    <span className="text-sm font-normal text-gray-500">
                                                                                        /
                                                                                        {
                                                                                            payment.value
                                                                                        }{' '}
                                                                                        {
                                                                                            payment.unit
                                                                                        }
                                                                                    </span>
                                                                                )}
                                                                        </div>

                                                                        {/* Features */}
                                                                        {allFeatures.length > 0 && (
                                                                            <div className="space-y-2">
                                                                                {allFeatures.map(
                                                                                    (
                                                                                        feature,
                                                                                        featureIdx
                                                                                    ) => {
                                                                                        const isIncluded =
                                                                                            payment.features?.includes(
                                                                                                feature
                                                                                            );
                                                                                        return (
                                                                                            <div
                                                                                                key={
                                                                                                    featureIdx
                                                                                                }
                                                                                                className="flex items-center gap-1.5 text-sm"
                                                                                            >
                                                                                                {isIncluded ? (
                                                                                                    <Check className="size-3 shrink-0 text-emerald-500" />
                                                                                                ) : (
                                                                                                    <X className="size-3 shrink-0 text-gray-400" />
                                                                                                )}
                                                                                                <span
                                                                                                    className={`${
                                                                                                        isIncluded
                                                                                                            ? 'text-gray-700'
                                                                                                            : 'text-gray-400 line-through'
                                                                                                    } leading-tight`}
                                                                                                >
                                                                                                    {
                                                                                                        feature
                                                                                                    }
                                                                                                </span>
                                                                                            </div>
                                                                                        );
                                                                                    }
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </Card>
                                                            );
                                                        })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {(form.watch('selectedPlan')?.type === 'subscription' ||
                                        form.watch('selectedPlan')?.type === 'SUBSCRIPTION') && (
                                        <div className="flex w-fit flex-wrap gap-4">
                                            {form
                                                .watch('selectedPlan')
                                                ?.paymentOption?.map((payment, idx) => {
                                                    return (
                                                        <Card
                                                            key={idx}
                                                            className="w-full border border-gray-200 p-8 py-6 transition-colors hover:border-gray-300"
                                                        >
                                                            <div className="flex flex-col gap-3">
                                                                {/* Title */}
                                                                <h4 className="text-xl font-bold text-gray-900">
                                                                    {payment.title}
                                                                </h4>

                                                                {/* Price with time period inline */}
                                                                <div className="text-xl font-bold text-primary-500">
                                                                    {getCurrencySymbol(
                                                                        form.watch('selectedPlan')
                                                                            ?.currency || ''
                                                                    )}
                                                                    {formatPlanPrice(payment.price)}&nbsp;
                                                                    {payment.value &&
                                                                        payment.unit && (
                                                                            <span className="text-sm font-normal text-gray-500">
                                                                                /{payment.value}{' '}
                                                                                {payment.unit}
                                                                            </span>
                                                                        )}
                                                                </div>

                                                                {/* Features */}
                                                                {allFeatures.length > 0 && (
                                                                    <div className="space-y-2">
                                                                        {allFeatures.map(
                                                                            (
                                                                                feature,
                                                                                featureIdx
                                                                            ) => {
                                                                                const isIncluded =
                                                                                    payment.features?.includes(
                                                                                        feature
                                                                                    );
                                                                                return (
                                                                                    <div
                                                                                        key={
                                                                                            featureIdx
                                                                                        }
                                                                                        className="flex items-center gap-1.5 text-sm"
                                                                                    >
                                                                                        {isIncluded ? (
                                                                                            <Check className="size-3 shrink-0 text-emerald-500" />
                                                                                        ) : (
                                                                                            <X className="size-3 shrink-0 text-gray-400" />
                                                                                        )}
                                                                                        <span
                                                                                            className={`${
                                                                                                isIncluded
                                                                                                    ? 'text-gray-700'
                                                                                                    : 'text-gray-400 line-through'
                                                                                            } leading-tight`}
                                                                                        >
                                                                                            {
                                                                                                feature
                                                                                            }
                                                                                        </span>
                                                                                    </div>
                                                                                );
                                                                            }
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </Card>
                                                    );
                                                })}
                                        </div>
                                    )}
                                </div>
                            </Card>
                        )}
                    <Card
                        id="registration-card"
                        className="w-full overflow-hidden border-0 bg-white/80 shadow-xl backdrop-blur-sm"
                    >
                        <CardContent className="p-6 sm:p-8">
                            <div className="mb-6 flex items-start gap-2 sm:gap-3">
                                <div className="shrink-0 rounded-lg bg-blue-100 p-1.5 sm:p-2">
                                    <GraduationCap className="size-5 text-blue-600 sm:size-6" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold leading-tight text-gray-900 sm:text-xl md:text-2xl">
                                        {t('registrationHeading')}
                                    </h2>
                                    <p className="mt-1 text-sm text-gray-600">
                                        {t('registrationSubheading')}
                                    </p>
                                </div>
                            </div>

                            <Separator className="mb-6" />

                            <div className="flex w-full items-center justify-center">
                                <div className=" mb-4 flex w-full flex-col items-start justify-center rounded-xl bg-white ">
                                    <FormProvider {...registrationForm}>
                                        <form className="mt-4 flex max-h-full w-full flex-col gap-6 overflow-auto">
                                            {Object.entries(registrationForm.getValues()).map(
                                                ([key, value]: [
                                                    string,
                                                    {
                                                        id: string;
                                                        name: string;
                                                        value: string;
                                                        is_mandatory: boolean;
                                                        type: string;
                                                        comma_separated_options?: string[];
                                                    },
                                                ]) =>
                                                    key === 'phone_number' ? (
                                                        <FormField
                                                            key={key}
                                                            control={registrationForm.control}
                                                            name={`${key}.value` as FormFieldPath}
                                                            render={() => (
                                                                <FormItem>
                                                                    <FormControl>
                                                                        <PhoneInputField
                                                                            label={t(
                                                                                'phoneNumberLabel'
                                                                            )}
                                                                            placeholder={t(
                                                                                'phoneNumberPlaceholder'
                                                                            )}
                                                                            name={`${key}.value`}
                                                                            control={
                                                                                registrationForm.control
                                                                            }
                                                                            required
                                                                        />
                                                                    </FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                    ) : (
                                                        <FormField
                                                            key={key}
                                                            control={registrationForm.control}
                                                            name={`${key}.value` as FormFieldPath}
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <FormControl>
                                                                        {value.type ===
                                                                        'dropdown' ? (
                                                                            <SelectField
                                                                                label={value.name}
                                                                                name={`${key}.value`}
                                                                                options={
                                                                                    value.comma_separated_options?.map(
                                                                                        (
                                                                                            option: string,
                                                                                            index: number
                                                                                        ) => ({
                                                                                            value: option,
                                                                                            label: option,
                                                                                            _id: index,
                                                                                        })
                                                                                    ) || []
                                                                                }
                                                                                control={
                                                                                    registrationForm.control
                                                                                }
                                                                                required={
                                                                                    value.is_mandatory
                                                                                }
                                                                                className="!w-full"
                                                                            />
                                                                        ) : (
                                                                            <MyInput
                                                                                inputType="text"
                                                                                inputPlaceholder={
                                                                                    value.name
                                                                                }
                                                                                input={
                                                                                    field.value as string
                                                                                }
                                                                                onChangeFunction={
                                                                                    field.onChange
                                                                                }
                                                                                required={
                                                                                    value.is_mandatory
                                                                                }
                                                                                size="large"
                                                                                label={value.name}
                                                                                className="!w-full !max-w-full"
                                                                            />
                                                                        )}
                                                                    </FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                    )
                                            )}
                                            <div className="flex flex-col items-center justify-center gap-4">
                                                <MyButton
                                                    type="button"
                                                    buttonType="primary"
                                                    scale="large"
                                                    layoutVariant="default"
                                                    className="w-full rounded-lg bg-gradient-to-r from-green-600 to-green-700 px-6 py-3 font-semibold text-white shadow-lg transition-all duration-200 hover:from-green-700 hover:to-green-800 hover:shadow-xl md:w-fit"
                                                >
                                                    <GraduationCap className="mr-2 size-5" />
                                                    {t('registerButton')}
                                                </MyButton>
                                                <button
                                                    type="button"
                                                    className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-gray-500 transition-colors duration-200 hover:text-gray-700"
                                                    onClick={() => registrationForm.reset()}
                                                >
                                                    <ArrowCounterClockwise className="size-4" />
                                                    {t('resetFormButton')}
                                                </button>
                                            </div>
                                        </form>
                                    </FormProvider>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    {form.getValues('customHtml') && (
                        <Card className="w-full overflow-hidden border-0 bg-white/80 shadow-xl backdrop-blur-sm">
                            <CardContent className="p-6 sm:p-8">
                                <div className="mb-6 flex items-start gap-2 sm:gap-3">
                                    <div
                                        className="size-full"
                                        dangerouslySetInnerHTML={{
                                            __html: form.getValues('customHtml') || '',
                                        }}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};

export default PreviewInviteLink;
