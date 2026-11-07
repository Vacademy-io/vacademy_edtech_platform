import React from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PaymentPlanType } from '@/types/payment';
import { isApprovalToggleDisabled, getApprovalToggleMessage, FreePlanInfo } from '../utils/utils';
import { getTerminologyPlural } from '@/components/common/layout-container/sidebar/utils';
import { RoleTerms, SystemTerms } from '../../NamingSettings';

interface ApprovalToggleProps {
    planType: PaymentPlanType;
    requireApproval: boolean;
    existingFreePlans: FreePlanInfo[];
    onApprovalChange: (value: boolean) => void;
    /**
     * Edit mode. The "one free plan with approval, one without" rule only governs which
     * plans may be *created*, so applying it while editing greyed the switch out on every
     * existing plan and left approval unchangeable from the UI. When editing, the switch
     * stays live and the restriction copy is replaced by what the setting actually does.
     */
    isEditing?: boolean;
}

export const ApprovalToggle: React.FC<ApprovalToggleProps> = ({
    planType,
    requireApproval,
    existingFreePlans,
    onApprovalChange,
    isEditing = false,
}) => {
    const { t } = useTranslation('settingsApprovalToggle');
    const isDisabled = !isEditing && isApprovalToggleDisabled(planType, existingFreePlans);
    const learners = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
    const learnerTerm = learners.toLocaleLowerCase();
    const message = isEditing
        ? requireApproval
            ? t('message.editingRequiresApproval', { learners })
            : t('message.editingNoApproval', { learners })
        : getApprovalToggleMessage(planType, existingFreePlans);

    return (
        <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2">
                <Label
                    htmlFor="requireApproval"
                    className={`text-sm font-medium ${
                        isDisabled ? 'text-gray-500' : 'text-gray-900'
                    }`}
                >
                    {t('label.part1')} {learnerTerm} {t('label.part2')}
                </Label>
                <Switch
                    id="requireApproval"
                    checked={requireApproval}
                    onCheckedChange={onApprovalChange}
                    disabled={isDisabled}
                />
            </div>
            {message && (
                <div className="rounded-md bg-blue-50 p-2">
                    <p className="text-xs text-blue-800">{message}</p>
                </div>
            )}
        </div>
    );
};
