import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSuspenseQuery, useMutation } from '@tanstack/react-query';
import { useInstituteQuery } from '@/services/student-list-section/getInstituteDetails';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MyDropdown } from '@/components/design-system/dropdown';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, FloppyDisk, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { MAX_LENGTH, isValidEmail, isNonEmpty } from '@/utils/form-validation';
import { isValidPhoneValue } from '@/lib/phone-validation';
import PhoneNumberInput from '@/components/design-system/phone-number-input';
import { handleFetchEnquiriesList } from '../../enquiries/-services/get-enquiries-list';
import {
    SubmitEnquiryRequest,
    submitEnquiryWithLead,
} from '../../enquiries/-services/submit-enquiry';
import { MyButton } from '@/components/design-system/button';
import { useUserAutosuggestDebounced, USER_ROLES } from '@/services/user-autosuggest';
import CustomEnquiryFieldsCard from '../-components/CustomEnquiryFieldsCard';

export const Route = createFileRoute('/admissions/new-enquiry/$audienceId/')({
    component: RouteComponent,
});

function NewEnquiryForm() {
    const { t } = useTranslation('admissionsNewEnquiryAudienceIdIndex');
    const { t: tSubmitEnquiry } = useTranslation('admissionsSubmitEnquiry');
    const { audienceId } = Route.useParams();
    const navigate = useNavigate();
    const { data: instituteData } = useSuspenseQuery(useInstituteQuery());
    const { instituteDetails } = useInstituteDetailsStore();

    // Fetch campaign details
    const { data: enquiriesData } = useSuspenseQuery(
        handleFetchEnquiriesList({
            institute_id: instituteData?.id || '',
            page: 0,
            size: 100,
        })
    );

    const campaign = enquiriesData?.content?.find((c) => c.id === audienceId);

    // Get package sessions for dropdown
    const packageSessionOptions =
        instituteDetails?.batches_for_sessions
            .filter((batch) => batch.is_parent === true || !batch.parent_id)
            .map((batch) => ({
                id: batch.id,
                label: `${batch.level.level_name}${batch.name ? ` - ${batch.name}` : ''}`,
            })) || [];

    // Form state
    const [formData, setFormData] = useState({
        // Child (Student) info - only name, DOB, gender
        childFullName: '',
        childDOB: '',
        childGender: '',
        // Parent info - full details including address
        parentName: '',
        parentEmail: '',
        parentMobile: '',
        parentAddress: '',
        parentCity: '',
        parentRegion: '',
        parentPinCode: '',
        // Package session
        packageSessionId: '',
        // Enquiry details
        enquiryStatus: 'NEW',
        parentRelationWithChild: '',
        notes: '',
        sourceType: 'WEBSITE',
        referenceSource: '',
        feeExpectation: '',
        transportRequirement: '',
        mode: 'OFFLINE' as 'ONLINE' | 'OFFLINE',
        counsellorId: '',
        // Custom fields
        customFieldValues: {} as Record<string, string>,
    });

    // Counsellor autosuggest state
    const [counsellorSearchQuery, setCounsellorSearchQuery] = useState('');
    const [selectedCounsellor, setSelectedCounsellor] = useState<{
        id: string;
        full_name: string;
    } | null>(null);

    // Fetch counsellors with debounced search
    const { data: counsellors, isLoading: isLoadingCounsellors } = useUserAutosuggestDebounced(
        counsellorSearchQuery,
        [USER_ROLES.ADMIN],
        300
    );

    const [isSubmitting, setIsSubmitting] = useState(false);

    // Submit mutation
    const submitMutation = useMutation({
        mutationFn: (payload: SubmitEnquiryRequest) =>
            submitEnquiryWithLead(payload, tSubmitEnquiry),
        onSuccess: (data) => {
            toast.success(t('toasts.submitSuccess'), {
                description: t('toasts.submitSuccessDescription', {
                    enquiryId: data.enquiry_id,
                }),
            });
            setTimeout(() => {
                navigate({ to: '/admissions/enquiries' });
            }, 1500);
        },
        onError: (error: Error) => {
            toast.error(t('toasts.submitFailed'), {
                description: error.message,
            });
        },
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validation
        if (!isNonEmpty(formData.childFullName)) {
            toast.error(t('toasts.childNameRequired'));
            return;
        }
        if (!isNonEmpty(formData.parentName)) {
            toast.error(t('toasts.parentNameRequired'));
            return;
        }
        if (!isNonEmpty(formData.parentEmail)) {
            toast.error(t('toasts.parentEmailRequired'));
            return;
        }
        if (!isValidEmail(formData.parentEmail)) {
            toast.error(t('toasts.invalidEmail'));
            return;
        }
        if (!isNonEmpty(formData.parentMobile)) {
            toast.error(t('toasts.parentMobileRequired'));
            return;
        }
        if (!isValidPhoneValue(formData.parentMobile)) {
            toast.error(t('toasts.invalidPhone'));
            return;
        }
        if (!formData.parentRelationWithChild) {
            toast.error(t('toasts.relationRequired'));
            return;
        }

        setIsSubmitting(true);

        const payload: SubmitEnquiryRequest = {
            audience_id: audienceId,
            source_type: formData.sourceType || 'WEBSITE',
            destination_package_session_id: formData.packageSessionId || undefined,
            // Auto-fill parent_name, parent_email, parent_mobile from parent details
            parent_name: formData.parentName || undefined,
            parent_email: formData.parentEmail || undefined,
            parent_mobile: formData.parentMobile || undefined,
            counsellor_id: formData.counsellorId || undefined,
            // Parent user DTO with full details
            parent_user_dto: {
                full_name: formData.parentName || undefined,
                email: formData.parentEmail || undefined,
                mobile_number: formData.parentMobile || undefined,
                address_line: formData.parentAddress || undefined,
                city: formData.parentCity || undefined,
                region: formData.parentRegion || undefined,
                pin_code: formData.parentPinCode || undefined,
                is_parent: true,
                root_user: true,
            },
            // Child user DTO - only name, DOB, gender, copy address from parent
            child_user_dto: {
                full_name: formData.childFullName || undefined,
                date_of_birth: formData.childDOB || undefined,
                gender: formData.childGender as 'MALE' | 'FEMALE' | 'OTHER' | undefined,
                // Copy address fields from parent
                address_line: formData.parentAddress || undefined,
                city: formData.parentCity || undefined,
                region: formData.parentRegion || undefined,
                pin_code: formData.parentPinCode || undefined,
                is_parent: false,
                root_user: false,
            },
            custom_field_values: formData.customFieldValues,
            enquiry: {
                enquiry_status: formData.enquiryStatus as any,
                parent_relation_with_child: formData.parentRelationWithChild as
                    | 'FATHER'
                    | 'MOTHER'
                    | 'GUARDIAN',
                notes: formData.notes || undefined,
                reference_source: formData.referenceSource || undefined,
                fee_range_expectation: formData.feeExpectation || undefined,
                transport_requirement: formData.transportRequirement || undefined,
                mode: formData.mode || undefined,
            },
        };

        try {
            await submitMutation.mutateAsync(payload);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCustomFieldChange = (fieldId: string, value: string) => {
        setFormData({
            ...formData,
            customFieldValues: {
                ...formData.customFieldValues,
                [fieldId]: value,
            },
        });
    };

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold">{t('header.title')}</h1>
                    <p className="text-sm text-muted-foreground">
                        {t('header.sessionLabel', {
                            campaignName: campaign?.campaign_name || t('header.unknownSession'),
                        })}
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                {/* Student (Child) Information - Simplified */}
                <Card className="mb-4">
                    <CardHeader>
                        <CardTitle>{t('studentCard.title')}</CardTitle>
                        <CardDescription>{t('studentCard.description')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div>
                                <Label htmlFor="childFullName">
                                    {t('studentCard.fullNameLabel')}{' '}
                                    <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="childFullName"
                                    value={formData.childFullName}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            childFullName: e.target.value,
                                        })
                                    }
                                    placeholder={t('studentCard.fullNamePlaceholder')}
                                    required
                                    maxLength={MAX_LENGTH.NAME}
                                />
                            </div>

                            <div>
                                <Label htmlFor="childDOB">{t('studentCard.dobLabel')}</Label>
                                <Input
                                    id="childDOB"
                                    type="date"
                                    value={formData.childDOB}
                                    onChange={(e) =>
                                        setFormData({ ...formData, childDOB: e.target.value })
                                    }
                                />
                            </div>
                            <div>
                                <Label htmlFor="childGender">{t('studentCard.genderLabel')}</Label>
                                <Select
                                    value={formData.childGender}
                                    onValueChange={(value) =>
                                        setFormData({ ...formData, childGender: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue
                                            placeholder={t('studentCard.genderPlaceholder')}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="MALE">
                                            {t('studentCard.genderMale')}
                                        </SelectItem>
                                        <SelectItem value="FEMALE">
                                            {t('studentCard.genderFemale')}
                                        </SelectItem>
                                        <SelectItem value="OTHER">
                                            {t('studentCard.genderOther')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Class/Package Selection */}
                {packageSessionOptions.length > 0 && (
                    <Card className="mb-4">
                        <CardHeader>
                            <CardTitle>{t('classCard.title')}</CardTitle>
                            <CardDescription>{t('classCard.description')}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Label htmlFor="packageSession">{t('classCard.label')}</Label>
                            <MyDropdown
                                currentValue={
                                    packageSessionOptions.find(
                                        (opt) => opt.id === formData.packageSessionId
                                    )?.label || ''
                                }
                                handleChange={(value) => {
                                    const selected = packageSessionOptions.find(
                                        (opt) => opt.label === value
                                    );
                                    setFormData({
                                        ...formData,
                                        packageSessionId: selected?.id || '',
                                    });
                                }}
                                dropdownList={packageSessionOptions.map((opt) => opt.label)}
                                placeholder={t('classCard.placeholder')}
                            />
                        </CardContent>
                    </Card>
                )}

                {/* Parent/Guardian Information - Full Details with Address */}
                <Card className="mb-4">
                    <CardHeader>
                        <CardTitle>{t('parentCard.title')}</CardTitle>
                        <CardDescription>{t('parentCard.description')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div>
                                <Label htmlFor="parentName">
                                    {t('parentCard.nameLabel')}{' '}
                                    <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="parentName"
                                    value={formData.parentName}
                                    onChange={(e) =>
                                        setFormData({ ...formData, parentName: e.target.value })
                                    }
                                    placeholder={t('parentCard.namePlaceholder')}
                                    required
                                    maxLength={MAX_LENGTH.NAME}
                                />
                            </div>
                            <div>
                                <Label htmlFor="parentEmail">
                                    {t('parentCard.emailLabel')}{' '}
                                    <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                    id="parentEmail"
                                    type="email"
                                    value={formData.parentEmail}
                                    onChange={(e) =>
                                        setFormData({ ...formData, parentEmail: e.target.value })
                                    }
                                    placeholder={t('parentCard.emailPlaceholder')}
                                    required
                                    maxLength={MAX_LENGTH.EMAIL}
                                    className={formData.parentEmail && !isValidEmail(formData.parentEmail) ? 'border-red-400 focus:border-red-500 focus:ring-red-300' : ''}
                                />
                                {formData.parentEmail && !isValidEmail(formData.parentEmail) && (
                                    <span className="text-xs text-red-500">
                                        {t('parentCard.emailInvalid')}
                                    </span>
                                )}
                            </div>
                            <PhoneNumberInput
                                name="parentMobile"
                                value={formData.parentMobile}
                                onChange={(_name, value) =>
                                    setFormData({ ...formData, parentMobile: value })
                                }
                                label={t('parentCard.mobileLabel')}
                                required
                                placeholder={t('parentCard.mobilePlaceholder')}
                            />
                            <div>
                                <Label htmlFor="parentRelationWithChild">
                                    {t('parentCard.relationLabel')}{' '}
                                    <span className="text-red-500">*</span>
                                </Label>
                                <Select
                                    value={formData.parentRelationWithChild}
                                    onValueChange={(value) =>
                                        setFormData({
                                            ...formData,
                                            parentRelationWithChild: value,
                                        })
                                    }
                                >
                                    <SelectTrigger id="parentRelationWithChild">
                                        <SelectValue
                                            placeholder={t('parentCard.relationPlaceholder')}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="FATHER">
                                            {t('parentCard.relationFather')}
                                        </SelectItem>
                                        <SelectItem value="MOTHER">
                                            {t('parentCard.relationMother')}
                                        </SelectItem>
                                        <SelectItem value="GUARDIAN">
                                            {t('parentCard.relationGuardian')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Address Details */}
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <Label htmlFor="parentAddress">
                                    {t('parentCard.addressLabel')}
                                </Label>
                                <Input
                                    id="parentAddress"
                                    value={formData.parentAddress}
                                    onChange={(e) =>
                                        setFormData({ ...formData, parentAddress: e.target.value })
                                    }
                                    placeholder={t('parentCard.addressPlaceholder')}
                                    maxLength={MAX_LENGTH.ADDRESS}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div>
                                <Label htmlFor="parentCity">{t('parentCard.cityLabel')}</Label>
                                <Input
                                    id="parentCity"
                                    value={formData.parentCity}
                                    onChange={(e) =>
                                        setFormData({ ...formData, parentCity: e.target.value })
                                    }
                                    placeholder={t('parentCard.cityPlaceholder')}
                                    maxLength={MAX_LENGTH.GENERAL}
                                />
                            </div>
                            <div>
                                <Label htmlFor="parentRegion">{t('parentCard.regionLabel')}</Label>
                                <Input
                                    id="parentRegion"
                                    value={formData.parentRegion}
                                    onChange={(e) =>
                                        setFormData({ ...formData, parentRegion: e.target.value })
                                    }
                                    placeholder={t('parentCard.regionPlaceholder')}
                                    maxLength={MAX_LENGTH.GENERAL}
                                />
                            </div>
                            <div>
                                <Label htmlFor="parentPinCode">
                                    {t('parentCard.pinCodeLabel')}
                                </Label>
                                <Input
                                    id="parentPinCode"
                                    value={formData.parentPinCode}
                                    onChange={(e) => {
                                        const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                                        setFormData({ ...formData, parentPinCode: digits });
                                    }}
                                    placeholder={t('parentCard.pinCodePlaceholder')}
                                    maxLength={MAX_LENGTH.PINCODE}
                                    inputMode="numeric"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Custom Fields - Filtered by Enquiry Location */}
                <CustomEnquiryFieldsCard
                    customFieldValues={formData.customFieldValues}
                    onFieldChange={handleCustomFieldChange}
                />

                {/* Enquiry Details - Enhanced with New Fields */}
                <Card className="mb-4">
                    <CardHeader>
                        <CardTitle>{t('enquiryCard.title')}</CardTitle>
                        <CardDescription>{t('enquiryCard.description')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                                <Label htmlFor="enquiryStatus">
                                    {t('enquiryCard.statusLabel')}
                                </Label>
                                <Select
                                    value={formData.enquiryStatus}
                                    onValueChange={(value) =>
                                        setFormData({ ...formData, enquiryStatus: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="NEW">
                                            {t('enquiryCard.statusNew')}
                                        </SelectItem>
                                        <SelectItem value="CONTACTED">
                                            {t('enquiryCard.statusContacted')}
                                        </SelectItem>
                                        <SelectItem value="QUALIFIED">
                                            {t('enquiryCard.statusQualified')}
                                        </SelectItem>
                                        <SelectItem value="NOT_ELIGIBLE">
                                            {t('enquiryCard.statusNotEligible')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="sourceType">{t('enquiryCard.sourceLabel')}</Label>
                                <Select
                                    value={formData.sourceType}
                                    onValueChange={(value) =>
                                        setFormData({ ...formData, sourceType: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="WEBSITE">
                                            {t('enquiryCard.sourceWebsite')}
                                        </SelectItem>
                                        <SelectItem value="GOOGLE_ADS">
                                            {t('enquiryCard.sourceGoogleAds')}
                                        </SelectItem>
                                        <SelectItem value="FACEBOOK">
                                            {t('enquiryCard.sourceFacebook')}
                                        </SelectItem>
                                        <SelectItem value="INSTAGRAM">
                                            {t('enquiryCard.sourceInstagram')}
                                        </SelectItem>
                                        <SelectItem value="REFERRAL">
                                            {t('enquiryCard.sourceReferral')}
                                        </SelectItem>
                                        <SelectItem value="OTHER">
                                            {t('enquiryCard.sourceOther')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="referenceSource">
                                    {t('enquiryCard.referenceLabel')}
                                </Label>
                                <Input
                                    id="referenceSource"
                                    value={formData.referenceSource}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            referenceSource: e.target.value,
                                        })
                                    }
                                    placeholder={t('enquiryCard.referencePlaceholder')}
                                    maxLength={MAX_LENGTH.GENERAL}
                                />
                            </div>
                            <div>
                                <Label htmlFor="mode">{t('enquiryCard.modeLabel')}</Label>
                                <Select
                                    value={formData.mode}
                                    onValueChange={(value: 'ONLINE' | 'OFFLINE') =>
                                        setFormData({ ...formData, mode: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ONLINE">
                                            {t('enquiryCard.modeOnline')}
                                        </SelectItem>
                                        <SelectItem value="OFFLINE">
                                            {t('enquiryCard.modeOffline')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label htmlFor="feeExpectation">
                                    {t('enquiryCard.feeLabel')}
                                </Label>
                                <Input
                                    id="feeExpectation"
                                    value={formData.feeExpectation}
                                    onChange={(e) =>
                                        setFormData({ ...formData, feeExpectation: e.target.value })
                                    }
                                    placeholder={t('enquiryCard.feePlaceholder')}
                                    maxLength={MAX_LENGTH.GENERAL}
                                />
                            </div>
                            <div>
                                <Label htmlFor="transportRequirement">
                                    {t('enquiryCard.transportLabel')}
                                </Label>
                                <Select
                                    value={formData.transportRequirement}
                                    onValueChange={(value) =>
                                        setFormData({ ...formData, transportRequirement: value })
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue
                                            placeholder={t('enquiryCard.transportPlaceholder')}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="YES">
                                            {t('enquiryCard.transportYes')}
                                        </SelectItem>
                                        <SelectItem value="NO">
                                            {t('enquiryCard.transportNo')}
                                        </SelectItem>
                                        <SelectItem value="OPTIONAL">
                                            {t('enquiryCard.transportOptional')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {!selectedCounsellor ? (
                                <div>
                                    <Label htmlFor="counsellorSearch">
                                        {t('enquiryCard.counsellorSearchLabel')}
                                    </Label>
                                    <Input
                                        id="counsellorSearch"
                                        value={counsellorSearchQuery}
                                        onChange={(e) => setCounsellorSearchQuery(e.target.value)}
                                        placeholder={t(
                                            'enquiryCard.counsellorSearchPlaceholder'
                                        )}
                                    />
                                    {isLoadingCounsellors && (
                                        <p className="mt-2 text-sm text-gray-500">
                                            {t('enquiryCard.searching')}
                                        </p>
                                    )}
                                    {counsellors && counsellors.length > 0 && (
                                        <div className="mt-2 max-h-48 overflow-y-auto rounded-md border">
                                            {counsellors.map((counsellor) => (
                                                <button
                                                    key={counsellor.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedCounsellor({
                                                            id: counsellor.id,
                                                            full_name: counsellor.full_name,
                                                        });
                                                        setFormData({
                                                            ...formData,
                                                            counsellorId: counsellor.id,
                                                        });
                                                        setCounsellorSearchQuery('');
                                                    }}
                                                    className="w-full border-b p-3 text-left transition-colors last:border-0 hover:bg-gray-50"
                                                >
                                                    <div className="font-medium">
                                                        {counsellor.full_name}
                                                    </div>
                                                    <div className="text-sm text-gray-600">
                                                        {counsellor.email}
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {counsellors &&
                                        counsellors.length === 0 &&
                                        counsellorSearchQuery &&
                                        !isLoadingCounsellors && (
                                            <p className="mt-2 text-sm text-gray-500">
                                                {t('enquiryCard.noCounsellorsFound', {
                                                    query: counsellorSearchQuery,
                                                })}
                                            </p>
                                        )}
                                </div>
                            ) : (
                                <div className="flex items-center justify-between rounded-md border p-2">
                                    <div>
                                        <div className="font-medium ">
                                            {selectedCounsellor?.full_name}
                                        </div>
                                        <div className="text-sm ">
                                            {t('enquiryCard.assignedCounsellor')}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedCounsellor(null);
                                            setFormData({ ...formData, counsellorId: '' });
                                        }}
                                        className="rounded-full p-1  transition-colors hover:bg-gray-100"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                            )}
                        </div>
                        <div>
                            <Label htmlFor="notes">{t('enquiryCard.notesLabel')}</Label>
                            <Textarea
                                id="notes"
                                value={formData.notes}
                                onChange={(e) =>
                                    setFormData({ ...formData, notes: e.target.value })
                                }
                                placeholder={t('enquiryCard.notesPlaceholder')}
                                rows={4}
                                maxLength={MAX_LENGTH.NOTES}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Actions */}
                <div className="flex justify-end gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        onClick={() => navigate({ to: '/admissions/enquiries' })}
                        disabled={isSubmitting}
                    >
                        {t('actions.cancel')}
                    </MyButton>
                    <MyButton type="submit" disabled={isSubmitting}>
                        <FloppyDisk className="me-2 h-4 w-4" />
                        {isSubmitting ? t('actions.saving') : t('actions.save')}
                    </MyButton>
                </div>
            </form>
        </div>
    );
}

function RouteComponent() {
    return (
        <LayoutContainer>
            <NewEnquiryForm />
        </LayoutContainer>
    );
}
