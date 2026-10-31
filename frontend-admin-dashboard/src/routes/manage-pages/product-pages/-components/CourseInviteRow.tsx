import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { GET_INVITE_LINKS, GET_SINGLE_INVITE_DETAILS } from '@/constants/urls';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { Button } from '@/components/ui/button';
import { Trash2, GripVertical, ChevronDown } from 'lucide-react';
import { Label } from '@/components/ui/label';
import type { MappingRow, PaymentPlan } from '../-types/product-page-types';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface InviteListItem {
    id: string;
    name: string;
    invite_code: string;
}

interface PackageSessionToPaymentOption {
    id: string; // ps_invite_payment_option_id
    package_session_id: string;
    payment_option: {
        id: string;
        name: string;
        payment_plans: PaymentPlan[];
    };
}

interface InviteDetails {
    id: string;
    name: string;
    package_session_to_payment_options: PackageSessionToPaymentOption[];
}

interface CourseInviteRowProps {
    row: MappingRow;
    onChange: (updated: MappingRow) => void;
    onRemove: () => void;
    displayOrder: number;
}

const SimpleSelect = ({
    value,
    onChange,
    options,
    placeholder,
    disabled,
}: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    placeholder: string;
    disabled?: boolean;
}) => (
    <div className="relative">
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-full appearance-none rounded-md border border-gray-200 bg-white px-3 py-2 pr-8 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
        >
            <option value="" disabled>
                {placeholder}
            </option>
            {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-2.5 size-4 text-gray-400" />
    </div>
);

export const CourseInviteRow = ({ row, onChange, onRemove, displayOrder }: CourseInviteRowProps) => {
    const instituteId = getCurrentInstituteId() || getInstituteId();
    const [selectedInviteId, setSelectedInviteId] = useState(row.inviteId || '');
    const [selectedPsOptionId, setSelectedPsOptionId] = useState(row.psInvitePaymentOptionId || '');
    const [selectedPlanId, setSelectedPlanId] = useState(row.paymentPlanId || '');

    // Fetch all active invites
    const { data: inviteListData, isLoading: isLoadingInvites } = useQuery({
        queryKey: ['INVITE_LINKS_ALL_PP', instituteId],
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
                { params: { instituteId, pageNo: 0, pageSize: 200 } }
            );
            return response.data;
        },
        enabled: !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    const inviteList: InviteListItem[] = inviteListData?.content || [];

    // Fetch full invite details when an invite is selected
    const { data: inviteDetails, isLoading: isLoadingDetails } = useQuery({
        queryKey: ['INVITE_DETAILS_PP', selectedInviteId, instituteId],
        queryFn: async () => {
            const response = await authenticatedAxiosInstance.get(
                GET_SINGLE_INVITE_DETAILS.replace('{instituteId}', instituteId!).replace(
                    '{enrollInviteId}',
                    selectedInviteId
                )
            );
            return response.data as InviteDetails;
        },
        enabled: !!selectedInviteId && !!instituteId,
        staleTime: 5 * 60 * 1000,
    });

    const psOptions: PackageSessionToPaymentOption[] =
        inviteDetails?.package_session_to_payment_options || [];

    const selectedPsOption = psOptions.find((o) => o.id === selectedPsOptionId);
    const paymentPlans: PaymentPlan[] = selectedPsOption?.payment_option?.payment_plans || [];

    // When invite changes, reset downstream selections
    useEffect(() => {
        if (!selectedInviteId) return;
        // If coming from existing row data, keep the selection; otherwise reset
        if (selectedInviteId !== row.inviteId) {
            setSelectedPsOptionId('');
            setSelectedPlanId('');
        }
    }, [selectedInviteId]);

    // Auto-select ps option if only one exists
    useEffect(() => {
        if (psOptions.length === 1 && !selectedPsOptionId) {
            setSelectedPsOptionId(psOptions[0]!.id);
        }
    }, [psOptions]);

    // Auto-select plan if only one exists
    useEffect(() => {
        if (paymentPlans.length === 1 && !selectedPlanId) {
            setSelectedPlanId(paymentPlans[0]!.id);
        }
    }, [paymentPlans]);

    // Propagate complete row update when all three are selected
    useEffect(() => {
        if (!selectedInviteId || !selectedPsOptionId || !selectedPlanId) return;

        const psOpt = psOptions.find((o) => o.id === selectedPsOptionId);
        const plan = psOpt?.payment_option?.payment_plans?.find((p) => p.id === selectedPlanId);
        const invite = inviteList.find((i) => i.id === selectedInviteId);

        if (!psOpt || !plan) return;

        onChange({
            ...row,
            inviteId: selectedInviteId,
            inviteName: invite?.name || '',
            psInvitePaymentOptionId: selectedPsOptionId,
            packageSessionId: psOpt.package_session_id,
            paymentPlanId: selectedPlanId,
            paymentPlanName: plan.name,
            paymentPlanPrice: plan.actual_price,
            currency: plan.currency,
            displayOrder,
        });
    }, [selectedInviteId, selectedPsOptionId, selectedPlanId, psOptions]);

    const inviteOptions = inviteList.map((i) => ({ value: i.id, label: i.name }));

    const psSelectOptions = psOptions.map((o) => ({
        value: o.id,
        label: `Session: ${o.package_session_id.slice(0, 8)}…`,
    }));

    const planOptions = paymentPlans.map((p) => ({
        value: p.id,
        label: `${p.name} — ${p.currency} ${p.actual_price.toLocaleString()}`,
    }));

    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <GripVertical className="size-4 cursor-grab text-gray-300" />
                    <span>
                        {getTerminology(ContentTerms.Course, SystemTerms.Course)} {displayOrder + 1}
                    </span>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0 text-gray-400 hover:text-red-500"
                    onClick={onRemove}
                >
                    <Trash2 className="size-3.5" />
                </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
                {/* Step 1: Pick Invite */}
                <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Enroll Invite</Label>
                    <SimpleSelect
                        value={selectedInviteId}
                        onChange={(v) => {
                            setSelectedInviteId(v);
                            setSelectedPsOptionId('');
                            setSelectedPlanId('');
                        }}
                        options={inviteOptions}
                        placeholder={isLoadingInvites ? 'Loading...' : 'Select invite'}
                        disabled={isLoadingInvites}
                    />
                </div>

                {/* Step 2: Pick Package Session (only shown if invite has >1 session) */}
                <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Package Session</Label>
                    <SimpleSelect
                        value={selectedPsOptionId}
                        onChange={(v) => {
                            setSelectedPsOptionId(v);
                            setSelectedPlanId('');
                        }}
                        options={psSelectOptions}
                        placeholder={
                            !selectedInviteId
                                ? 'Select invite first'
                                : isLoadingDetails
                                  ? 'Loading...'
                                  : psOptions.length === 0
                                    ? 'No sessions'
                                    : 'Select session'
                        }
                        disabled={!selectedInviteId || isLoadingDetails || psOptions.length === 0}
                    />
                </div>

                {/* Step 3: Pick Payment Plan */}
                <div className="space-y-1">
                    <Label className="text-xs text-gray-500">Payment Plan</Label>
                    <SimpleSelect
                        value={selectedPlanId}
                        onChange={setSelectedPlanId}
                        options={planOptions}
                        placeholder={!selectedPsOptionId ? 'Select session first' : 'Select plan'}
                        disabled={!selectedPsOptionId || paymentPlans.length === 0}
                    />
                </div>
            </div>

            {/* Preselected toggle */}
            <div className="mt-3 flex items-center gap-2">
                <input
                    id={`preselect-${row.rowId}`}
                    type="checkbox"
                    checked={row.preselected}
                    onChange={(e) => onChange({ ...row, preselected: e.target.checked })}
                    className="size-4 rounded border-gray-300 text-blue-600"
                />
                <label
                    htmlFor={`preselect-${row.rowId}`}
                    className="cursor-pointer text-xs text-gray-600"
                >
                    Pre-selected for learner
                </label>

                {row.paymentPlanPrice > 0 && (
                    <span className="ml-auto text-xs font-semibold text-gray-700">
                        {row.currency} {row.paymentPlanPrice.toLocaleString()}
                    </span>
                )}
            </div>
        </div>
    );
};
