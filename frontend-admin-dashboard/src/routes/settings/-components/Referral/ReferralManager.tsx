import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Plus,
    PencilSimple,
    Trash,
    TrendUp,
    Users,
    Gift,
    Copy,
    Eye,
    Gear,
    Star,
    Medal,
    Percent,
    CurrencyDollar,
    Calendar,
} from '@phosphor-icons/react';
import { UnifiedReferralSettings as UnifiedReferralSettingsType } from './UnifiedReferralSettings';
import { MyButton } from '@/components/design-system/button';

interface ReferralManagerProps {
    programs: UnifiedReferralSettingsType[];
    onCreateProgram: () => void;
    onEditProgram: (program: UnifiedReferralSettingsType) => void;
    onDeleteProgram: (programId: string) => void;
    onDuplicateProgram: (program: UnifiedReferralSettingsType) => void;
}

export const ReferralManager: React.FC<ReferralManagerProps> = ({
    programs,
    onCreateProgram,
    onEditProgram,
    onDeleteProgram,
    onDuplicateProgram,
}) => {
    const { t } = useTranslation('settingsReferralManager');
    const [selectedProgram, setSelectedProgram] = useState<UnifiedReferralSettingsType | null>(
        null
    );
    const [showProgramDetails, setShowProgramDetails] = useState(false);

    const getRewardTypeIcon = (type: string) => {
        switch (type) {
            case 'discount_percentage':
                return <Percent className="size-4 text-green-600" />;
            case 'discount_fixed':
                return <CurrencyDollar className="size-4 text-green-600" />;
            case 'bonus_content':
                return <Gift className="size-4 text-purple-600" />;
            case 'free_days':
                return <Calendar className="size-4 text-blue-600" />;
            case 'points_system':
                return <Star className="size-4 text-yellow-600" />;
            default:
                return <Gift className="size-4 text-purple-600" />;
        }
    };

    const handleViewProgram = (program: UnifiedReferralSettingsType) => {
        setSelectedProgram(program);
        setShowProgramDetails(true);
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">{t('header.title')}</h2>
                    <p className="text-gray-600">{t('header.subtitle')}</p>
                </div>
                <MyButton
                    buttonType="primary"
                    onClick={onCreateProgram}
                    className="flex items-center gap-2"
                >
                    <Plus className="size-4" />
                    {t('header.createNewProgram')}
                </MyButton>
            </div>

            {/* Programs Grid */}
            {programs.length === 0 ? (
                <Card className="py-12 text-center">
                    <CardContent>
                        <h3 className="mb-2 text-lg font-medium">{t('emptyState.title')}</h3>
                        <p className="mb-4 text-gray-600">{t('emptyState.description')}</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    {programs.map((program) => (
                        <Card
                            key={program.id}
                            className={`relative overflow-hidden transition-all duration-300 hover:shadow-lg ${
                                program.isDefault
                                    ? 'border-primary-200 bg-gradient-to-br from-primary-50 to-primary-100 shadow-sm'
                                    : 'border-gray-200 bg-gradient-to-br from-gray-50 to-slate-50'
                            }`}
                        >
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className={`rounded-lg p-2 ${program.isDefault ? 'bg-primary-100' : 'bg-gray-100'}`}
                                        >
                                            <TrendUp
                                                className={`size-5 ${program.isDefault ? 'text-primary-500' : 'text-gray-500'}`}
                                            />
                                        </div>
                                        <CardTitle className="text-lg">{program.label}</CardTitle>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {program.isDefault && (
                                            <Badge
                                                variant="default"
                                                className="flex items-center gap-1 bg-primary-500 text-xs text-white"
                                            >
                                                <Medal className="size-3" />
                                                {t('programCard.defaultBadge')}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </CardHeader>

                            <CardContent className="space-y-4">
                                {/* Referee Benefit Summary */}
                                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                    <div className="mb-3 flex items-center gap-2">
                                        <div className="rounded-md bg-green-100 p-1.5">
                                            <Gift className="size-4 text-green-600" />
                                        </div>
                                        <span className="text-sm font-medium text-gray-800">
                                            {t('programCard.refereeBenefit.title')}
                                        </span>
                                    </div>
                                    {program.refereeReward ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">
                                                {getRewardTypeIcon(program.refereeReward.type)}
                                            </span>
                                            <div className="text-sm">
                                                {program.refereeReward.type === 'discount_percentage' &&
                                                    t('programCard.refereeBenefit.percentOff', {
                                                        value: program.refereeReward.value,
                                                    })}
                                                {program.refereeReward.type === 'discount_fixed' &&
                                                    t('programCard.refereeBenefit.amountOff', {
                                                        value: program.refereeReward.value,
                                                    })}
                                                {program.refereeReward.type === 'free_days' &&
                                                    t('programCard.refereeBenefit.freeDays', {
                                                        value: program.refereeReward.value,
                                                    })}
                                                {program.refereeReward.type === 'points_system' &&
                                                    t('programCard.refereeBenefit.points', {
                                                        value: program.refereeReward.value,
                                                    })}
                                                {program.refereeReward.type === 'bonus_content' && (
                                                    <div className="flex flex-col gap-1">
                                                        <span>
                                                            {program.refereeReward.content?.content
                                                                ?.title ||
                                                                t(
                                                                    'programCard.refereeBenefit.bonusContentFallback'
                                                                )}
                                                        </span>
                                                        {program.refereeReward.content?.content
                                                            ?.template && (
                                                            <span className="text-xs text-gray-500">
                                                                {t(
                                                                    'programCard.refereeBenefit.templateLabel',
                                                                    {
                                                                        template:
                                                                            program.refereeReward.content.content.template.replace(
                                                                                'template_',
                                                                                ''
                                                                            ),
                                                                    }
                                                                )}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-sm italic text-gray-500">
                                            {t('programCard.refereeBenefit.empty')}
                                        </div>
                                    )}
                                </div>

                                {/* Referrer Tiers Summary */}
                                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                    <div className="mb-3 flex items-center gap-2">
                                        <div className="rounded-md bg-blue-100 p-1.5">
                                            <Users className="size-4 text-blue-600" />
                                        </div>
                                        <span className="text-sm font-medium text-gray-800">
                                            {t('programCard.referrerTiers.title')}
                                        </span>
                                    </div>
                                    {program.referrerRewards && program.referrerRewards.length > 0 ? (
                                        <div className="space-y-1">
                                            {program.referrerRewards.slice(0, 2).map((tier) => (
                                                <div
                                                    key={tier.id}
                                                    className="flex items-center justify-between text-xs"
                                                >
                                                    <span>
                                                        {t(
                                                            'programCard.referrerTiers.referralCount',
                                                            { count: tier.referralCount }
                                                        )}
                                                    </span>
                                                    <div className="flex items-center gap-1">
                                                        <span>
                                                            {getRewardTypeIcon(tier.reward.type)}
                                                        </span>
                                                        {tier.reward.type === 'points_system' &&
                                                            tier.reward.pointsPerReferral && (
                                                                <span className="font-medium text-blue-600 text-xs">
                                                                    {t(
                                                                        'programCard.referrerTiers.pointsValue',
                                                                        {
                                                                            value: tier.reward
                                                                                .pointsPerReferral,
                                                                        }
                                                                    )}
                                                                </span>
                                                            )}
                                                        {tier.reward.type === 'bonus_content' &&
                                                            tier.reward.content?.content?.title && (
                                                                <span className="font-medium text-purple-600 text-xs">
                                                                    {tier.reward.content.content.title}
                                                                </span>
                                                            )}
                                                        {(tier.reward.type === 'discount_percentage' ||
                                                            tier.reward.type === 'discount_fixed' ||
                                                            tier.reward.type === 'free_days') &&
                                                            tier.reward.value && (
                                                                <span className="font-medium text-xs">
                                                                    {tier.reward.value}
                                                                    {tier.reward.type ===
                                                                    'discount_percentage'
                                                                        ? t(
                                                                              'programCard.referrerTiers.percentUnit'
                                                                          )
                                                                        : tier.reward.type ===
                                                                          'free_days'
                                                                          ? t(
                                                                                'programCard.referrerTiers.daysUnit'
                                                                            )
                                                                          : t(
                                                                                'programCard.referrerTiers.currencyUnit'
                                                                            )}
                                                                </span>
                                                            )}
                                                    </div>
                                                </div>
                                            ))}
                                            {program.referrerRewards.length > 2 && (
                                                <div className="text-xs text-gray-500">
                                                    {t('programCard.referrerTiers.moreTiers', {
                                                        count: program.referrerRewards.length - 2,
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="text-sm italic text-gray-500">
                                            {t('programCard.referrerTiers.empty')}
                                        </div>
                                    )}
                                </div>

                                {/* Program Settings Summary */}
                                <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                    <div className="mb-3 flex items-center gap-2">
                                        <div className="rounded-md bg-gray-100 p-1.5">
                                            <Gear className="size-4 text-gray-600" />
                                        </div>
                                        <span className="text-sm font-medium text-gray-800">
                                            {t('programCard.settings.title')}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 text-xs">
                                        <div className="rounded bg-gray-50 p-2">
                                            <span className="mb-1 block text-gray-500">
                                                {t('programCard.settings.vestingPeriod')}
                                            </span>
                                            <div className="font-medium text-gray-800">
                                                {t('programCard.settings.days', {
                                                    count: program.payoutVestingDays,
                                                })}
                                            </div>
                                        </div>
                                        <div className="rounded bg-gray-50 p-2">
                                            <span className="mb-1 block text-gray-500">
                                                {t('programCard.settings.combineOffers')}
                                            </span>
                                            <div className="font-medium text-gray-800">
                                                {program.allowCombineOffers === true
                                                    ? t('programCard.settings.yes')
                                                    : t('programCard.settings.no')}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex items-center gap-2 pt-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleViewProgram(program)}
                                        className="flex-1 transition-colors hover:border-blue-300 hover:bg-blue-50"
                                    >
                                        <Eye className="mr-1 size-4" />
                                        {t('programCard.actions.view')}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onEditProgram(program)}
                                        className="transition-colors hover:border-green-300 hover:bg-green-50"
                                    >
                                        <PencilSimple className="size-4" />
                                    </Button>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onDuplicateProgram(program)}
                                        className="transition-colors hover:border-purple-300 hover:bg-purple-50"
                                    >
                                        <Copy className="size-4" />
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                                        onClick={() => onDeleteProgram(program.id)}
                                    >
                                        <Trash className="size-4" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Program Details Modal */}
            {showProgramDetails && selectedProgram && (
                <ProgramDetailsModal
                    program={selectedProgram}
                    isOpen={showProgramDetails}
                    onClose={() => {
                        setShowProgramDetails(false);
                        setSelectedProgram(null);
                    }}
                    onEdit={() => {
                        onEditProgram(selectedProgram);
                        setShowProgramDetails(false);
                        setSelectedProgram(null);
                    }}
                />
            )}
        </div>
    );
};

// Program Details Modal Component
interface ProgramDetailsModalProps {
    program: UnifiedReferralSettingsType;
    isOpen: boolean;
    onClose: () => void;
    onEdit: () => void;
}

const ProgramDetailsModal: React.FC<ProgramDetailsModalProps> = ({
    program,
    isOpen,
    onClose,
    onEdit,
}) => {
    const { t } = useTranslation('settingsReferralManager');

    if (!isOpen) return null;

    const getRewardTypeLabel = (type: string) => {
        switch (type) {
            case 'discount_percentage':
                return t('rewardTypeLabels.percentageDiscount');
            case 'discount_fixed':
                return t('rewardTypeLabels.fixedDiscount');
            case 'bonus_content':
                return t('rewardTypeLabels.bonusContent');
            case 'free_days':
                return t('rewardTypeLabels.freeDays');
            case 'points_system':
                return t('rewardTypeLabels.pointsSystem');
            default:
                return type;
        }
    };

    const modalContent = (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-dialog-tall w-full max-w-4xl overflow-y-auto rounded-lg bg-white">
                <div className="border-b p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold">{program.label}</h2>
                            <p className="text-gray-600">{t('modal.subtitle')}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {program.isDefault && (
                                <Badge variant="default" className="bg-primary-500 text-white">
                                    <Medal className="me-1 size-3" />
                                    {t('modal.defaultBadge')}
                                </Badge>
                            )}
                            <Button onClick={onEdit} className="flex items-center gap-2">
                                <PencilSimple className="size-4" />
                                {t('modal.editProgram')}
                            </Button>
                            <Button variant="outline" onClick={onClose}>
                                {t('modal.close')}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className="space-y-6 p-6">
                    {/* Referee Benefits */}
                    {/* Referee Benefits */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Gift className="size-5 text-green-600" />
                                {t('modal.refereeBenefits.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {/* Conditional Wrapper Starts Here */}
                            {program.refereeReward ? (
                                <div className="rounded-lg bg-green-50 p-4">
                                    <div className="mb-2 flex items-center justify-between">
                                        <span className="font-medium">
                                            {getRewardTypeLabel(program.refereeReward.type)}
                                        </span>
                                        {program.refereeReward.value && (
                                            <Badge variant="secondary">
                                                {program.refereeReward.value}
                                                {program.refereeReward.type === 'discount_percentage'
                                                    ? t('modal.refereeBenefits.percentUnit')
                                                    : program.refereeReward.type === 'free_days'
                                                      ? t('modal.refereeBenefits.daysUnit')
                                                      : program.refereeReward.type === 'points_system'
                                                        ? t('modal.refereeBenefits.pointsUnit')
                                                        : ''}
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-700">
                                        {program.refereeReward.description}
                                    </p>
                                    {program.refereeReward.delivery && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="text-xs text-gray-500">
                                                {t('modal.refereeBenefits.deliveryLabel')}
                                            </span>
                                            {program.refereeReward.delivery.email && (
                                                <Badge variant="outline" className="text-xs">
                                                    {t('modal.refereeBenefits.emailBadge')}
                                                </Badge>
                                            )}
                                            {program.refereeReward.delivery.whatsapp && (
                                                <Badge variant="outline" className="text-xs">
                                                    {t('modal.refereeBenefits.whatsappBadge')}
                                                </Badge>
                                            )}
                                        </div>
                                    )}

                                    {/* Bonus Content Details */}
                                    {program.refereeReward.type === 'bonus_content' &&
                                        program.refereeReward.content && (
                                            <div className="mt-3 rounded border bg-white p-3">
                                                <h6 className="mb-2 text-xs font-medium text-gray-700">
                                                    {t('modal.refereeBenefits.contentDetails.title')}
                                                </h6>
                                                <div className="space-y-1 text-xs">
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-500">
                                                            {t(
                                                                'modal.refereeBenefits.contentDetails.contentType'
                                                            )}
                                                        </span>
                                                        <span className="font-medium capitalize">
                                                            {program.refereeReward.content.contentType}
                                                        </span>
                                                    </div>
                                                    {program.refereeReward.content.content?.title && (
                                                        <div className="flex justify-between">
                                                            <span className="text-gray-500">
                                                                {t(
                                                                    'modal.refereeBenefits.contentDetails.titleLabel'
                                                                )}
                                                            </span>
                                                            <span className="font-medium">
                                                                {
                                                                    program.refereeReward.content
                                                                        .content.title
                                                                }
                                                            </span>
                                                        </div>
                                                    )}
                                                    {program.refereeReward.content.content
                                                        ?.template && (
                                                        <div className="flex justify-between">
                                                            <span className="text-gray-500">
                                                                {t(
                                                                    'modal.refereeBenefits.contentDetails.template'
                                                                )}
                                                            </span>
                                                            <span className="font-medium">
                                                                {t(
                                                                    'modal.refereeBenefits.contentDetails.templateValue',
                                                                    {
                                                                        number:
                                                                            program.refereeReward.content.content.template.replace(
                                                                                'template_',
                                                                                ''
                                                                            ),
                                                                    }
                                                                )}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {program.refereeReward.content.content?.fileId && (
                                                        <div className="flex justify-between">
                                                            <span className="text-gray-500">
                                                                {t(
                                                                    'modal.refereeBenefits.contentDetails.file'
                                                                )}
                                                            </span>
                                                            <span className="font-medium text-green-600">
                                                                {t(
                                                                    'modal.refereeBenefits.contentDetails.uploadedBadge'
                                                                )}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                </div>
                            ) : (
                                /* Fallback if no Referee Benefit exists */
                                <div className="text-sm italic text-gray-500">
                                    {t('modal.refereeBenefits.empty')}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Referrer Tiers */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="size-5 text-blue-600" />
                                {t('modal.referrerRewards.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {[...(program.referrerRewards || [])]
                                    .sort((a, b) => a.referralCount - b.referralCount)
                                    .map((tier) => (
                                        <div key={tier.id} className="rounded-lg bg-blue-50 p-4">
                                            <div className="mb-2 flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <Badge variant="secondary">
                                                        {t('modal.referrerRewards.referralCount', {
                                                            count: tier.referralCount,
                                                        })}
                                                    </Badge>
                                                    <span className="font-medium">
                                                        {tier.tierName}
                                                    </span>
                                                </div>
                                                <span className="font-medium">
                                                    {getRewardTypeLabel(tier.reward.type)}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-700">
                                                {tier.reward.description}
                                            </p>

                                            {/* Points System Details */}
                                            {tier.reward.type === 'points_system' && (
                                                <div className="mt-3 rounded border bg-white p-3">
                                                    <h6 className="mb-2 text-xs font-medium text-gray-700">
                                                        {t(
                                                            'modal.referrerRewards.pointsSystemDetails.title'
                                                        )}
                                                    </h6>
                                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                                        <div>
                                                            <span className="text-gray-500">
                                                                {t(
                                                                    'modal.referrerRewards.pointsSystemDetails.perReferral'
                                                                )}
                                                            </span>
                                                            <div className="font-medium text-blue-600">
                                                                {t(
                                                                    'modal.referrerRewards.pointsSystemDetails.pointsEarnedValue',
                                                                    {
                                                                        value:
                                                                            tier.reward
                                                                                .pointsPerReferral ||
                                                                            0,
                                                                    }
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-500">
                                                                {t(
                                                                    'modal.referrerRewards.pointsSystemDetails.rewardAt'
                                                                )}
                                                            </span>
                                                            <div className="font-medium">
                                                                {t(
                                                                    'modal.referrerRewards.pointsSystemDetails.pointsValue',
                                                                    {
                                                                        value:
                                                                            tier.reward
                                                                                .pointsToReward || 0,
                                                                    }
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-500">
                                                                {t(
                                                                    'modal.referrerRewards.pointsSystemDetails.referralsNeeded'
                                                                )}
                                                            </span>
                                                            <div className="font-medium">
                                                                {Math.ceil(
                                                                    (tier.reward.pointsToReward ||
                                                                        0) /
                                                                        (tier.reward
                                                                            .pointsPerReferral || 1)
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-500">
                                                                {t(
                                                                    'modal.referrerRewards.pointsSystemDetails.reward'
                                                                )}
                                                            </span>
                                                            <div className="font-medium">
                                                                {tier.reward.pointsRewardType ===
                                                                'discount_percentage'
                                                                    ? t(
                                                                          'modal.referrerRewards.pointsSystemDetails.percentOff',
                                                                          {
                                                                              value:
                                                                                  tier.reward
                                                                                      .pointsRewardValue ||
                                                                                  0,
                                                                          }
                                                                      )
                                                                    : tier.reward
                                                                            .pointsRewardType ===
                                                                        'membership_days'
                                                                      ? t(
                                                                            'modal.referrerRewards.pointsSystemDetails.daysOff',
                                                                            {
                                                                                value:
                                                                                    tier.reward
                                                                                        .pointsRewardValue ||
                                                                                    0,
                                                                            }
                                                                        )
                                                                      : t(
                                                                            'modal.referrerRewards.pointsSystemDetails.amountOff',
                                                                            {
                                                                                value:
                                                                                    tier.reward
                                                                                        .pointsRewardValue ||
                                                                                    0,
                                                                            }
                                                                        )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {tier.reward.delivery && (
                                                <div className="mt-2 flex items-center gap-2">
                                                    <span className="text-xs text-gray-500">
                                                        {t('modal.referrerRewards.deliveryLabel')}
                                                    </span>
                                                    {tier.reward.delivery.email && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-xs"
                                                        >
                                                            {t('modal.referrerRewards.emailBadge')}
                                                        </Badge>
                                                    )}
                                                    {tier.reward.delivery.whatsapp && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-xs"
                                                        >
                                                            {t('modal.referrerRewards.whatsappBadge')}
                                                        </Badge>
                                                    )}
                                                </div>
                                            )}

                                            {/* Bonus Content Details for Referrer Tier */}
                                            {tier.reward.type === 'bonus_content' &&
                                                tier.reward.content && (
                                                    <div className="mt-3 rounded border bg-white p-3">
                                                        <h6 className="mb-2 text-xs font-medium text-gray-700">
                                                            {t(
                                                                'modal.referrerRewards.contentDetails.title'
                                                            )}
                                                        </h6>
                                                        <div className="space-y-1 text-xs">
                                                            <div className="flex justify-between">
                                                                <span className="text-gray-500">
                                                                    {t(
                                                                        'modal.referrerRewards.contentDetails.contentType'
                                                                    )}
                                                                </span>
                                                                <span className="font-medium capitalize">
                                                                    {
                                                                        tier.reward.content
                                                                            .contentType
                                                                    }
                                                                </span>
                                                            </div>
                                                            {tier.reward.content.content?.title && (
                                                                <div className="flex justify-between">
                                                                    <span className="text-gray-500">
                                                                        {t(
                                                                            'modal.referrerRewards.contentDetails.titleLabel'
                                                                        )}
                                                                    </span>
                                                                    <span className="font-medium">
                                                                        {
                                                                            tier.reward.content
                                                                                .content.title
                                                                        }
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {tier.reward.content.content
                                                                ?.template && (
                                                                <div className="flex justify-between">
                                                                    <span className="text-gray-500">
                                                                        {t(
                                                                            'modal.referrerRewards.contentDetails.template'
                                                                        )}
                                                                    </span>
                                                                    <span className="font-medium">
                                                                        {t(
                                                                            'modal.referrerRewards.contentDetails.templateValue',
                                                                            {
                                                                                number:
                                                                                    tier.reward.content.content.template.replace(
                                                                                        'template_',
                                                                                        ''
                                                                                    ),
                                                                            }
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {tier.reward.content.content
                                                                ?.fileId && (
                                                                <div className="flex justify-between">
                                                                    <span className="text-gray-500">
                                                                        {t(
                                                                            'modal.referrerRewards.contentDetails.file'
                                                                        )}
                                                                    </span>
                                                                    <span className="font-medium text-green-600">
                                                                        {t(
                                                                            'modal.referrerRewards.contentDetails.uploadedBadge'
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                        </div>
                                    ))}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Program Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Gear className="size-5" />
                                {t('modal.settings.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div className="rounded bg-gray-50 p-3">
                                    <span className="text-sm text-gray-500">
                                        {t('modal.settings.vestingPeriod')}
                                    </span>
                                    <div className="font-medium">
                                        {t('modal.settings.days', {
                                            count: program.payoutVestingDays,
                                        })}
                                    </div>
                                </div>
                                <div className="rounded bg-gray-50 p-3">
                                    <span className="text-sm text-gray-500">
                                        {t('modal.settings.combineWithOtherOffers')}
                                    </span>
                                    <div className="font-medium">
                                        {program.allowCombineOffers === true
                                            ? t('modal.settings.yes')
                                            : t('modal.settings.no')}
                                    </div>
                                </div>
                                <div className="rounded bg-gray-50 p-3">
                                    <span className="text-sm text-gray-500">
                                        {t('modal.settings.programStatus')}
                                    </span>
                                    <div className="font-medium">
                                        {program.isDefault
                                            ? t('modal.settings.default')
                                            : t('modal.settings.available')}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );

    if (typeof document !== 'undefined') {
        return createPortal(modalContent, document.body);
    }

    return modalContent;
};
