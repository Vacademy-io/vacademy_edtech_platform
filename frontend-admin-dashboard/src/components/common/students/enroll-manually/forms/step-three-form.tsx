/* eslint-disable */
import { FormStepHeading } from '../form-components/form-step-heading';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import { MyDropdown } from '../dropdownForPackageItems';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFormStore } from '@/stores/students/enroll-students-manually/enroll-manually-form-store';
import {
    StepThreeData,
    stepThreeSchema,
} from '@/schemas/student/student-list/schema-enroll-students-manually';
import { useEffect, useRef } from 'react';
import { DropdownValueType } from '../dropdownTypesForPackageItems';
import { StudentTable } from '@/types/student-table-types';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INVITE_LINKS, GET_SINGLE_INVITE_DETAILS } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';
import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CalendarBlank as CalendarIcon } from '@phosphor-icons/react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface InviteItem {
    id: string;
    name: string;
    invite_code: string;
    tag?: string | null;
    payment_option_id?: string;
    package_session_ids?: string[];
}

export const StepThreeForm = ({
    initialValues,
    submitFn,
}: {
    initialValues?: StudentTable;
    submitFn: (fn: () => void) => void;
}) => {
    const { stepThreeData, setStepThreeData, nextStep } = useFormStore();
    const instituteId = getInstituteId();
    const [selectedInviteId, setSelectedInviteId] = useState<string>('');

    // Fetch all invites for the institute
    const { data: inviteListData, isLoading: isLoadingInvites } = useQuery({
        queryKey: ['INVITE_LINKS_ALL', instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.post(
                GET_INVITE_LINKS,
                {
                    search_name: '',
                    package_session_ids: [],
                    payment_option_ids: [],
                    sort_columns: {},
                    tags: [],
                },
                {
                    params: {
                        instituteId,
                        pageNo: 0,
                        pageSize: 100,
                    },
                }
            );
            return response.data;
        },
        enabled: !!instituteId,
    });

    const inviteList: InviteItem[] = (inviteListData?.content || []).filter(
        (inv: InviteItem) => {
            const tag = (inv.tag ?? '').trim().toUpperCase();
            // Hide only the bare SUB_ORG admin/scoped invites — enrolling a learner
            // through those makes them a ROOT_ADMIN (postProcessSubOrgEnrollment).
            // SUBORG_LEARNER (the sub-org learner invite) stays selectable.
            return tag !== 'SUB_ORG';
        }
    );

    // Prepare default form values
    const prepareDefaultValues = (): StepThreeData => {
        if (stepThreeData && Object.keys(stepThreeData).length > 0) {
            return stepThreeData;
        }

        return {
            invite: {
                id: '',
                name: '',
                payment_option_id: undefined,
                package_session_ids: undefined,
                payment_plans: undefined,
            },
            enrollment_number: '',
            access_days: '',
            start_date: new Date().toISOString(), // Default to today
        };
    };

    // Initialize form BEFORE any useEffects that use it
    const form = useForm<StepThreeData>({
        resolver: zodResolver(stepThreeSchema),
        defaultValues: prepareDefaultValues(),
        mode: 'onChange',
    });

    // Fetch invite details when an invite is selected
    const { data: inviteDetailsData, isLoading: isLoadingInviteDetails } = useQuery({
        queryKey: ['INVITE_DETAILS', selectedInviteId, instituteId],
        queryFn: async () => {
            if (!selectedInviteId || !instituteId) return null;

            const response = await authenticatedAxiosInstance.get(
                GET_SINGLE_INVITE_DETAILS.replace('{instituteId}', instituteId).replace(
                    '{enrollInviteId}',
                    selectedInviteId
                ),
                {
                    params: {
                        instituteId,
                        enrollInviteId: selectedInviteId,
                    },
                }
            );
            return response.data;
        },
        enabled: !!selectedInviteId && !!instituteId,
    });

    // Update form when invite details are loaded
    useEffect(() => {
        if (inviteDetailsData && selectedInviteId) {
            const selectedInvite = inviteList.find((inv) => inv.id === selectedInviteId);

            // Extract package_session_ids and payment_option from package_session_to_payment_options
            const packageSessionToPaymentOptions =
                inviteDetailsData.package_session_to_payment_options || [];

            // Get all package session IDs
            const packageSessionIds = packageSessionToPaymentOptions.map(
                (item: any) => item.package_session_id
            );

            // Get payment option from first element (as per requirement)
            const firstElement = packageSessionToPaymentOptions[0];
            const paymentOptionId = firstElement?.payment_option?.id || '';
            const paymentPlans = firstElement?.payment_option?.payment_plans || [];

            form.setValue(
                'invite',
                {
                    id: selectedInviteId,
                    name: selectedInvite?.name || '',
                    payment_option_id: paymentOptionId,
                    package_session_ids: packageSessionIds,
                    payment_plans: paymentPlans, // Store payment plans for Step 4
                    payment_option_type: firstElement?.payment_option?.type || undefined,
                },
                { shouldValidate: true }
            ); // Trigger validation after setting values

            // Manually trigger validation to ensure form is valid
            form.trigger('invite');
        }
    }, [inviteDetailsData, selectedInviteId, inviteList, form]);

    const handleGenerateEnrollNum = () => {
        const enrollNum = Math.floor(100000 + Math.random() * 900000).toString();
        form.setValue('enrollment_number', enrollNum);
    };

    const handleInviteChange = (value: DropdownValueType) => {
        if (typeof value === 'object' && 'id' in value && 'name' in value) {
            // Set the selected invite ID to trigger details fetch
            setSelectedInviteId(value.id);

            // Set basic invite info immediately (undefined for fields that will be loaded from API)
            form.setValue('invite', {
                id: value.id,
                name: value.name,
                payment_option_id: undefined, // Will be populated when details are fetched
                package_session_ids: undefined, // Will be populated when details are fetched
                payment_plans: undefined, // Will be populated when details are fetched
            });
        }
    };

    const onSubmit = (values: StepThreeData) => {
        // No extra validation - only invite id is required (handled by schema)
        setStepThreeData(values);
        nextStep();
    };

    const formRef = useRef<HTMLFormElement>(null);

    const requestFormSubmit = () => {
        if (formRef.current) {
            formRef.current.requestSubmit();
        }
    };

    useEffect(() => {
        if (submitFn) {
            submitFn(requestFormSubmit);
        }
    }, [submitFn]);

    return (
        <div>
            <div className="flex flex-col justify-center px-6 text-neutral-600">
                <Form {...form}>
                    <form
                        ref={formRef}
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="flex flex-col gap-6"
                    >
                        <FormStepHeading stepNumber={3} heading="Select Enrollment Invite" />

                        <div className="flex flex-col gap-8">
                            {/* Invite Selection */}
                            <FormField
                                control={form.control}
                                name="invite"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-subtitle font-semibold">
                                            Enrollment Invite *
                                        </FormLabel>
                                        <FormControl>
                                            <MyDropdown
                                                dropdownList={inviteList.map((invite) => ({
                                                    id: invite.id,
                                                    name: invite.name,
                                                }))}
                                                currentValue={
                                                    field.value?.id
                                                        ? {
                                                            id: field.value.id,
                                                            name: field.value.name,
                                                        }
                                                        : undefined
                                                }
                                                handleChange={handleInviteChange}
                                                placeholder="Select an invite link"
                                                disable={isLoadingInvites}
                                                required={true}
                                            />
                                        </FormControl>
                                        {isLoadingInviteDetails && (
                                            <p className="text-sm text-blue-600">
                                                Loading invite details...
                                            </p>
                                        )}
                                        {form.formState.errors.invite?.id && (
                                            <p className="text-sm text-red-500">
                                                {form.formState.errors.invite.id.message}
                                            </p>
                                        )}
                                        {form.formState.errors.invite?.payment_option_id && (
                                            <p className="text-sm text-red-500">
                                                {
                                                    form.formState.errors.invite.payment_option_id
                                                        .message
                                                }
                                            </p>
                                        )}
                                        {form.formState.errors.invite?.package_session_ids && (
                                            <p className="text-sm text-red-500">
                                                {
                                                    form.formState.errors.invite.package_session_ids
                                                        .message
                                                }
                                            </p>
                                        )}
                                    </FormItem>
                                )}
                            />

                            {/* Enrollment Number */}
                            <FormField
                                control={form.control}
                                name="enrollment_number"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-subtitle font-semibold">
                                            Enrollment Number
                                        </FormLabel>
                                        <FormControl>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    placeholder="Enter enrollment number"
                                                    {...field}
                                                    className="flex-1 rounded border px-3 py-2"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleGenerateEnrollNum}
                                                    className="rounded border px-4 py-2 hover:bg-gray-50"
                                                >
                                                    Auto Generate
                                                </button>
                                            </div>
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            {/* Enrollment Start Date */}
                            <FormField
                                control={form.control}
                                name="start_date"
                                render={({ field }) => {
                                    const selectedDate = field.value ? parseISO(field.value) : new Date();

                                    return (
                                        <FormItem>
                                            <FormLabel className="text-subtitle font-semibold">
                                                Enrollment Start Date
                                            </FormLabel>
                                            <FormControl>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <Button
                                                            variant="outline"
                                                            className={cn(
                                                                'w-full justify-start text-left font-normal',
                                                                !field.value && 'text-muted-foreground'
                                                            )}
                                                        >
                                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                                            {field.value ? (
                                                                format(selectedDate, 'PPP')
                                                            ) : (
                                                                <span>Select start date</span>
                                                            )}
                                                        </Button>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0" align="start">
                                                        <Calendar
                                                            mode="single"
                                                            selected={selectedDate}
                                                            onSelect={(date) => {
                                                                if (date) {
                                                                    field.onChange(date.toISOString());
                                                                }
                                                            }}
                                                            disabled={(date) => date > new Date()}
                                                            initialFocus
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                            </FormControl>
                                            <p className="text-xs text-muted-foreground">
                                                Choose a date to backdate the enrollment or leave as today.
                                            </p>
                                        </FormItem>
                                    );
                                }}
                            />

                            <FormField
                                control={form.control}
                                name="access_days"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-subtitle font-semibold">
                                            Access Days
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={1}
                                                placeholder="Leave blank to use the plan's duration"
                                                value={field.value ?? ''}
                                                onChange={(e) => field.onChange(e.target.value)}
                                            />
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground">
                                            Overrides the plan and invite. Enter 2 and access ends 2
                                            days after the enrollment start date. Blank falls back to
                                            the plan&apos;s duration, then the invite&apos;s.
                                        </p>
                                    </FormItem>
                                )}
                            />
                        </div>
                    </form>
                </Form>
            </div>
        </div>
    );
};
