import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Percent,
    DollarSign,
    Gift,
    Calendar,
    FileText,
    Video,
    Upload,
    Plus,
    Trash2,
    Edit,
    TrendingUp,
    Users,
    Star,
    Link2,
    Music,
    Settings,
    Mail,
    MessageCircle,
} from 'lucide-react';
import { MyButton } from '@/components/design-system/button';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { TemplateSelector, TemplatePreview } from '@/components/templates';
import { MessageTemplate } from '@/types/message-template-types';

// Enhanced interfaces with multiple programs support
export interface ContentDelivery {
    email: boolean;
    whatsapp: boolean;
    emailTemplate?: {
        id: string;
        name: string;
        subject?: string;
        content: string;
    };
    whatsappTemplate?: {
        id: string;
        name: string;
        content: string;
    };
}

export interface ContentOption {
    type: 'upload' | 'link' | 'existing_course';
    // For upload
    file?: File;
    fileId?: string; // Store the uploaded file ID
    template?: string; // Template selection
    // For link
    url?: string;
    // For existing course
    courseId?: string;
    sessionId?: string;
    levelId?: string;
    // Common
    title: string;
    description?: string;
    delivery: ContentDelivery;
}

export interface RewardContent {
    contentType: 'pdf' | 'video' | 'audio' | 'course';
    content: ContentOption;
}

export interface UnifiedReferralSettings {
    id: string;
    label: string;
    isDefault: boolean;
    requireReferrerActiveInBatch?: boolean;
    // Referee Settings - Simple one-time reward
    refereeReward?: {
        type:
            | 'discount_percentage'
            | 'discount_fixed'
            | 'bonus_content'
            | 'free_days'
            | 'points_system';
        value?: number;
        currency?: string;
        content?: RewardContent;
        courseId?: string;
        sessionId?: string;
        levelId?: string;
        delivery?: ContentDelivery;
        description?: string;
    };

    // Referrer Settings - Tiered rewards
    referrerRewards?: ReferrerTier[];

    // Program Settings
    allowCombineOffers: boolean;
    payoutVestingDays: number;
}

export interface ReferrerTier {
    id: string;
    tierName: string;
    referralCount: number;
    reward: {
        type:
            | 'discount_percentage'
            | 'discount_fixed'
            | 'bonus_content'
            | 'free_days'
            | 'points_system';
        value?: number;
        currency?: string;
        content?: RewardContent;
        courseId?: string;
        sessionId?: string;
        levelId?: string;
        delivery?: ContentDelivery;
        pointsPerReferral?: number;
        pointsToReward?: number;
        pointsRewardType?: 'discount_percentage' | 'discount_fixed' | 'membership_days';
        pointsRewardValue?: number;
        description?: string;
    };
}

interface UnifiedReferralSettingsProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (settings: UnifiedReferralSettings) => void;
    editingSettings?: UnifiedReferralSettings | null;
}

export const UnifiedReferralSettings: React.FC<UnifiedReferralSettingsProps> = ({
    isOpen,
    onClose,
    onSave,
    editingSettings,
}) => {
    const { t } = useTranslation('settingsReferral');
    const [formData, setFormData] = useState<Partial<UnifiedReferralSettings>>({
        label: '',
        isDefault: false,
        allowCombineOffers: false,
        payoutVestingDays: 7,
        refereeReward: {
            type: 'discount_percentage',
            value: 10,
            currency: 'INR',
        },
        referrerRewards: [],
    });
    const [errors, setErrors] = useState<{ label?: boolean; referrerRewards?: boolean }>({});
    const [editingTier, setEditingTier] = useState<ReferrerTier | null>(null);
    const [showTierCreator, setShowTierCreator] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (editingSettings) {
                setFormData(editingSettings);
            } else {
                setFormData({
                    label: '',
                    isDefault: false,
                    allowCombineOffers: false,
                    payoutVestingDays: 7,
                    referrerRewards: [],
                });
            }
        } else {
            // Reset when closed so there's no flash of old data on next open
            setTimeout(() => {
                setFormData({
                    label: '',
                    isDefault: false,
                    allowCombineOffers: false,
                    payoutVestingDays: 7,
                    referrerRewards: [],
                });
            }, 300); // 300ms matches Dialog out animation roughly
        }
    }, [editingSettings, isOpen]);

    const handleSave = () => {
        // 1. Validate Label
        if (!formData.label || formData.label.trim() === '') {
            setErrors({ label: true });
            toast.error(t('validation.labelRequired'));
            return;
        }

        // 2. Evaluate presence of rewards
        const hasRefereeReward = !!formData.refereeReward;
        const hasReferrerRewards = formData.referrerRewards && formData.referrerRewards.length > 0;

        // 3. Validate 'At Least One' Rule
        if (!hasRefereeReward && !hasReferrerRewards) {
            // Set error on the referrer tier section to visually indicate missing data
            setErrors({ referrerRewards: true });
            toast.error(t('validation.atLeastOneReward'));
            return;
        }

        // 4. Clear all errors if validation passes
        setErrors({});

        // 5. Construct payload
        const settings: UnifiedReferralSettings = {
            id: editingSettings?.id || Date.now().toString(),
            label: formData.label,
            isDefault: formData.isDefault || false,
            requireReferrerActiveInBatch: formData.requireReferrerActiveInBatch || false,
            refereeReward: formData.refereeReward,
            referrerRewards: formData.referrerRewards || [], // Provide fallback empty array if undefined
            allowCombineOffers: formData.allowCombineOffers || false,
            payoutVestingDays: formData.payoutVestingDays || 7,
        };
        onSave(settings);
    };

    const handleAddTier = () => {
        setEditingTier(null);
        setShowTierCreator(true);
    };

    const handleEditTier = (tier: ReferrerTier) => {
        setEditingTier(tier);
        setShowTierCreator(true);
    };

    const handleDeleteTier = (tierId: string) => {
        setFormData((prev) => ({
            ...prev,
            referrerRewards: prev.referrerRewards?.filter((tier) => tier.id !== tierId) || [],
        }));
    };

    const handleSaveTier = (tier: ReferrerTier) => {
        if (editingTier) {
            setFormData((prev) => ({
                ...prev,
                referrerRewards:
                    prev.referrerRewards?.map((t) => (t.id === editingTier.id ? tier : t)) || [],
            }));
        } else {
            setFormData((prev) => ({
                ...prev,
                referrerRewards: [...(prev.referrerRewards || []), tier],
            }));
        }
        // Clear the error state if they just added a tier
        if (errors.referrerRewards) {
            setErrors(prev => ({ ...prev, referrerRewards: false }));
        }
        setEditingTier(null);
        setShowTierCreator(false);
    };

    const getRewardTypeLabel = (type: string) => {
        switch (type) {
            case 'discount_percentage':
                return t('rewardTypes.percentageDiscount');
            case 'discount_fixed':
                return t('rewardTypes.fixedDiscount');
            case 'bonus_content':
                return t('rewardTypes.bonusContent');
            case 'free_days':
                return t('rewardTypes.freeDays');
            case 'points_system':
                return t('rewardTypes.pointsSystem');
            default:
                return type;
        }
    };

    const getRewardIcon = (type: string) => {
        switch (type) {
            case 'discount_percentage':
                return <Percent className="size-4" />;
            case 'discount_fixed':
                return <DollarSign className="size-4" />;
            case 'bonus_content':
                return <Gift className="size-4" />;
            case 'free_days':
                return <Calendar className="size-4" />;
            case 'points_system':
                return <Star className="size-4" />;
            default:
                return <Gift className="size-4" />;
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-h-[90vh] min-w-fit overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <TrendingUp className="size-5" />
                        {editingSettings ? t('mainDialog.titleEdit') : t('mainDialog.titleCreate')}
                    </DialogTitle>
                    <DialogDescription>
                        {editingSettings
                            ? t('mainDialog.descriptionEdit')
                            : t('mainDialog.descriptionCreate')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                    {/* Program Label */}
                    <div className="space-y-2">
                        <Label>
                            {t('mainDialog.programLabel')} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            value={formData.label || ''}
                            onChange={(e) => {
                                setFormData({ ...formData, label: e.target.value });
                                // Clear the error as soon as the user starts typing
                                if (errors.label) setErrors({ ...errors, label: false });
                            }}
                            placeholder={t('mainDialog.programLabelPlaceholder')}
                            className={errors.label ? "border-red-500 focus-visible:ring-red-500" : ""}
                        />
                    </div>
                    {/* Referee Settings */}
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <Gift className="size-5" />
                                        {t('refereeSection.title')}
                                    </CardTitle>
                                    <p className="text-sm text-gray-600">
                                        {t('refereeSection.subtitle')}
                                    </p>
                                </div>
                                {/* Only show Remove button if the reward exists */}
                                {formData.refereeReward && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                        onClick={() =>
                                            setFormData({ ...formData, refereeReward: undefined })
                                        }
                                    >
                                        <Trash2 className="mr-2 size-4" />
                                        {t('refereeSection.removeBenefit')}
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {formData.refereeReward ? (
                                <RefereeRewardEditor
                                    reward={formData.refereeReward}
                                    onChange={(reward) =>
                                        setFormData({ ...formData, refereeReward: reward })
                                    }
                                />
                            ) : (
                                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-6 text-center">
                                    <Gift className="mb-2 size-8 text-gray-300" />
                                    <p className="mb-4 text-sm text-gray-500">
                                        {t('refereeSection.emptyState')}
                                    </p>
                                    <Button
                                        variant="outline"
                                        onClick={() =>
                                            setFormData({
                                                ...formData,
                                                refereeReward: {
                                                    type: 'discount_percentage',
                                                    value: 10,
                                                    currency: 'INR',
                                                },
                                            })
                                        }
                                    >
                                        <Plus className="mr-2 size-4" />
                                        {t('refereeSection.addBenefit')}
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Referrer Tiered Rewards */}
                    <Card className={errors.referrerRewards ? "border-red-500 shadow-sm shadow-red-100" : ""}>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="flex items-center gap-2">
                                        <Users className="size-5" />
                                        {t('referrerSection.title')}
                                    </CardTitle>
                                    <p className="text-sm text-gray-600">
                                        {t('referrerSection.subtitle')}
                                    </p>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {formData.referrerRewards && formData.referrerRewards.length > 0 ? (
                                <div className="space-y-4">
                                    {formData.referrerRewards
                                        .sort((a, b) => a.referralCount - b.referralCount)
                                        .map((tier) => (
                                            <div key={tier.id} className="rounded-lg border p-4">
                                                <div className="mb-3 flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <Badge
                                                            variant="secondary"
                                                            className="text-sm"
                                                        >
                                                            {t('referrerSection.referralCount', {
                                                                count: tier.referralCount,
                                                            })}
                                                        </Badge>
                                                        <span className="font-medium">
                                                            {tier.tierName}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleEditTier(tier)}
                                                        >
                                                            <Edit className="size-4" />
                                                        </Button>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="text-red-600"
                                                            onClick={() =>
                                                                handleDeleteTier(tier.id)
                                                            }
                                                        >
                                                            <Trash2 className="size-4" />
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="mb-2 flex items-center gap-2">
                                                    {getRewardIcon(tier.reward.type)}
                                                    <span className="text-sm font-medium">
                                                        {getRewardTypeLabel(tier.reward.type)}
                                                        
                                                        {/* Safely display the specific values based on the reward type */}
                                                        <span className="ml-1 text-gray-500 font-normal">
                                                            {tier.reward.type === 'discount_percentage' && tier.reward.value && (
                                                                `(${tier.reward.value}%)`
                                                            )}
                                                            
                                                            {tier.reward.type === 'discount_fixed' && tier.reward.value && (
                                                                `(${tier.reward.currency === 'INR' ? '₹' : tier.reward.currency === 'USD' ? '$' : tier.reward.currency}${tier.reward.value})`
                                                            )}
                                                            
                                                            {tier.reward.type === 'free_days' && tier.reward.value && (
                                                                t('referrerSection.daysValue', { value: tier.reward.value })
                                                            )}

                                                            {tier.reward.type === 'points_system' && tier.reward.pointsPerReferral && (
                                                                t('referrerSection.pointsPerReferralValue', { value: tier.reward.pointsPerReferral })
                                                            )}
                                                        </span>
                                                    </span>
                                                    </div>
                                            </div>
                                        ))}
                                </div>
                            ) : (
                                <div className="py-8 text-center text-gray-500">
                                    <Users className="mx-auto mb-4 size-16 text-gray-300" />
                                    <p className="mb-2 text-lg font-medium">
                                        {t('referrerSection.emptyTitle')}
                                    </p>
                                    <p className="mb-4 text-sm">
                                        {t('referrerSection.emptyDescription')}
                                    </p>
                                    <Button variant="outline" onClick={handleAddTier}>
                                        <Plus className="mr-2 size-4" />
                                        {t('referrerSection.addFirstTier')}
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Program Settings */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Settings className="size-5" />
                                {t('programSettings.title')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label>{t('programSettings.vestingPeriodLabel')}</Label>
                                <Input
                                    type="number"
                                    value={formData.payoutVestingDays || ''}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            payoutVestingDays: parseInt(e.target.value) || 0,
                                        })
                                    }
                                    placeholder={t('programSettings.vestingPeriodPlaceholder')}
                                    min="0"
                                    max="365"
                                />
                            </div>

                            <div className="flex items-center space-x-2">
                                <Switch
                                    checked={formData.allowCombineOffers || false}
                                    onCheckedChange={(checked) =>
                                        setFormData({ ...formData, allowCombineOffers: checked })
                                    }
                                />
                                <Label>{t('programSettings.combineOffersLabel')}</Label>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center space-x-2">
                                    <Switch
                                        checked={formData.isDefault || false}
                                        onCheckedChange={(checked) =>
                                            setFormData({ ...formData, isDefault: checked })
                                        }
                                    />
                                    <Label>{t('programSettings.setDefaultLabel')}</Label>
                                </div>
                                <p className="ml-6 text-xs text-gray-600">
                                    {t('programSettings.setDefaultHint')}
                                </p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                    <MyButton buttonType="secondary" onClick={onClose}>
                        {t('mainDialog.cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" onClick={handleSave}>
                        {editingSettings ? t('mainDialog.updateProgram') : t('mainDialog.createProgram')}
                    </MyButton>
                </div>

                {/* Tier Creator Dialog */}
                {showTierCreator && (
                    <ReferrerTierCreator
                        isOpen={showTierCreator}
                        onClose={() => {
                            setShowTierCreator(false);
                            setEditingTier(null);
                        }}
                        onSave={handleSaveTier}
                        editingTier={editingTier}
                        existingTiers={formData.referrerRewards || []}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
};

// Enhanced Referee Reward Editor Component
interface RefereeRewardEditorProps {
    reward?: UnifiedReferralSettings['refereeReward'];
    onChange: (reward: UnifiedReferralSettings['refereeReward']) => void;
}

const RefereeRewardEditor: React.FC<RefereeRewardEditorProps> = ({ reward, onChange }) => {
    const { t } = useTranslation('settingsReferral');
    // If no reward is provided, initialize with a default reward
    const currentReward = reward || {
        type: 'discount_percentage' as const,
        value: 10,
        currency: 'INR',
    };

    // If the reward was undefined and we're using default, call onChange to update parent
    React.useEffect(() => {
        if (!reward) {
            const defaultReward = {
                type: 'discount_percentage' as const,
                value: 10,
                currency: 'INR',
            };
            onChange(defaultReward);
        }
    }, [reward, onChange]);

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>{t('refereeEditor.rewardTypeLabel')}</Label>
                <Select
                    value={currentReward.type || 'discount_percentage'}
                    onValueChange={(value) =>
                        onChange({
                            ...currentReward,
                            type: value as NonNullable<UnifiedReferralSettings['refereeReward']>['type']
                        })
                    }
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="discount_percentage">
                            <div className="flex items-center gap-2">
                                <Percent className="size-4" />
                                {t('rewardTypeOptions.percentageDiscount')}
                            </div>
                        </SelectItem>
                        <SelectItem value="discount_fixed">
                            <div className="flex items-center gap-2">
                                <DollarSign className="size-4" />
                                {t('rewardTypeOptions.fixedAmountDiscount')}
                            </div>
                        </SelectItem>
                        <SelectItem value="bonus_content">
                            <div className="flex items-center gap-2">
                                <Gift className="size-4" />
                                {t('rewardTypeOptions.bonusContent')}
                            </div>
                        </SelectItem>
                        <SelectItem value="free_days">
                            <div className="flex items-center gap-2">
                                <Calendar className="size-4" />
                                {t('rewardTypeOptions.freeMembershipDays')}
                            </div>
                        </SelectItem>
                        <SelectItem value="points_system">
                            <div className="flex items-center gap-2">
                                <Star className="size-4" />
                                {t('rewardTypeOptions.pointsSystem')}
                            </div>
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Conditional Fields based on reward type */}
            {(currentReward.type === 'discount_percentage' ||
                currentReward.type === 'free_days' ||
                currentReward.type === 'points_system') && (
                <div className="space-y-2">
                    <Label>
                        {currentReward.type === 'discount_percentage'
                            ? t('refereeEditor.discountPercentageLabel')
                            : currentReward.type === 'free_days'
                              ? t('refereeEditor.numberOfDaysLabel')
                              : t('refereeEditor.pointsEarnedLabel')}
                    </Label>
                    <div className="flex items-center gap-2">
                        <Input
                            type="number"
                            value={currentReward.value || ''}
                            onChange={(e) =>
                                onChange({ ...currentReward, value: parseInt(e.target.value) || 0 })
                            }
                            placeholder={t('refereeEditor.valuePlaceholder')}
                            min="1"
                            max={
                                currentReward.type === 'discount_percentage'
                                    ? '100'
                                    : currentReward.type === 'free_days'
                                      ? '365'
                                      : undefined
                            }
                        />
                        <span className="text-sm text-gray-500">
                            {currentReward.type === 'discount_percentage'
                                ? t('refereeEditor.percentUnit')
                                : currentReward.type === 'free_days'
                                  ? t('refereeEditor.daysUnit')
                                  : t('refereeEditor.pointsUnit')}
                        </span>
                    </div>
                </div>
            )}

            {currentReward.type === 'discount_fixed' && (
                <div className="space-y-2">
                    <Label>{t('refereeEditor.discountAmountLabel')}</Label>
                    <div className="flex items-center gap-2">
                        <Input
                            type="number"
                            value={currentReward.value || ''}
                            onChange={(e) =>
                                onChange({ ...currentReward, value: parseInt(e.target.value) || 0 })
                            }
                            placeholder={t('refereeEditor.amountPlaceholder')}
                            min="1"
                        />
                        <Select
                            value={currentReward.currency || 'INR'}
                            onValueChange={(value) =>
                                onChange({ ...currentReward, currency: value })
                            }
                        >
                            <SelectTrigger className="w-24">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="INR">₹</SelectItem>
                                <SelectItem value="USD">$</SelectItem>
                                <SelectItem value="EUR">€</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            {currentReward.type === 'bonus_content' && (
                <ContentEditor
                    content={currentReward.content}
                    onChange={(content) =>
                        onChange({
                            ...currentReward,
                            content,
                            // Also sync delivery to reward level for API compatibility
                            delivery: content.content?.delivery || currentReward.delivery,
                        })
                    }
                />
            )}
        </div>
    );
};

// Enhanced Content Editor Component
interface ContentEditorProps {
    content?: RewardContent;
    onChange: (content: RewardContent) => void;
}

const ContentEditor: React.FC<ContentEditorProps> = ({ content, onChange }) => {
    const { t } = useTranslation('settingsReferral');
    const [contentType, setContentType] = useState<'pdf' | 'video' | 'audio' | 'course'>(
        content?.contentType || 'pdf'
    );
    const [contentOption, setContentOption] = useState<ContentOption>(
        content?.content || {
            type: 'upload',
            title: '',
            delivery: { email: true, whatsapp: false },
        }
    );
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { uploadFile } = useFileUpload();

    // Create a simple form for the file upload component
    const form = useForm({
        defaultValues: {
            bonusContentFile: null,
        },
    });

    // Get user and institute info for file upload
    const getUploadData = () => {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const data = getTokenDecodedData(accessToken);
        const instituteId = data && Object.keys(data.authorities)[0];
        return { instituteId, userId: 'referral-content-upload' };
    };

    const handleFileSubmit = async (file: File) => {
        try {
            setIsUploading(true);
            const { instituteId } = getUploadData();
            const fileId = await uploadFile({
                file,
                setIsUploading,
                userId: 'referral-content-upload',
                source: instituteId || 'REFERRAL_CONTENT',
                sourceId: 'BONUS_CONTENT',
                publicUrl: true,
            });

            if (fileId) {
                setContentOption((prev) => ({
                    ...prev,
                    file,
                    fileId,
                }));
            }
        } catch (error) {
            console.error('Upload failed:', error);
        } finally {
            setIsUploading(false);
        }
    };

    useEffect(() => {
        onChange({
            contentType,
            content: contentOption,
        });
    }, [contentType, contentOption, onChange]);

    const templateOptions = [
        { value: 'template_1', label: t('contentEditor.template1') },
        { value: 'template_2', label: t('contentEditor.template2') },
        { value: 'template_3', label: t('contentEditor.template3') },
    ];

    return (
        <div className="space-y-4 rounded-lg border bg-gray-50 p-4">
            <div className="space-y-2">
                <Label>{t('contentEditor.contentTypeLabel')}</Label>
                <Select
                    value={contentType}
                    onValueChange={(value: 'pdf' | 'video' | 'audio' | 'course') =>
                        setContentType(value)
                    }
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="pdf">
                            <div className="flex items-center gap-2">
                                <FileText className="size-4" />
                                {t('contentEditor.pdfDocument')}
                            </div>
                        </SelectItem>
                        <SelectItem value="video">
                            <div className="flex items-center gap-2">
                                <Video className="size-4" />
                                {t('contentEditor.video')}
                            </div>
                        </SelectItem>
                        <SelectItem value="audio">
                            <div className="flex items-center gap-2">
                                <Music className="size-4" />
                                {t('contentEditor.audio')}
                            </div>
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>{t('contentEditor.contentSourceLabel')}</Label>
                <Select
                    value={contentOption.type}
                    onValueChange={(value: 'upload' | 'link' | 'existing_course') =>
                        setContentOption({ ...contentOption, type: value })
                    }
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="upload">
                            <div className="flex items-center gap-2">
                                <Upload className="size-4" />
                                {t('contentEditor.uploadFile')}
                            </div>
                        </SelectItem>
                        <SelectItem value="link">
                            <div className="flex items-center gap-2">
                                <Link2 className="size-4" />
                                {t('contentEditor.externalLink')}
                            </div>
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {contentOption.type === 'upload' && (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>{t('contentEditor.uploadFileLabel')}</Label>
                        {contentOption.fileId ? (
                            <div className="flex items-center justify-between rounded-lg border bg-white p-3">
                                <div className="flex items-center gap-2">
                                    <FileText className="size-4 text-green-600" />
                                    <span className="text-sm text-green-600">
                                        {t('contentEditor.uploadedSuccess')}
                                    </span>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                >
                                    {t('contentEditor.replaceFile')}
                                </Button>
                            </div>
                        ) : (
                            <div className="">
                                <MyButton
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                    buttonType="secondary"
                                    layoutVariant="default"
                                    scale="large"
                                    type="button"
                                >
                                    {t('contentEditor.uploadFile')}
                                </MyButton>
                            </div>
                        )}

                        <Form {...form}>
                            <FileUploadComponent
                                fileInputRef={fileInputRef}
                                onFileSubmit={handleFileSubmit}
                                control={form.control}
                                name="bonusContentFile"
                                acceptedFileTypes={
                                    contentType === 'pdf'
                                        ? ['application/pdf']
                                        : contentType === 'video'
                                          ? [
                                                'video/mp4',
                                                'video/quicktime',
                                                'video/x-msvideo',
                                                'video/webm',
                                            ]
                                          : contentType === 'audio'
                                            ? ['audio/*']
                                            : ['application/pdf']
                                }
                                isUploading={isUploading}
                                // className="hidden"
                            />
                        </Form>
                    </div>

                    <div className="space-y-2">
                        <Label>{t('contentEditor.selectTemplateLabel')}</Label>
                        <Select
                            value={contentOption.template || ''}
                            onValueChange={(value) =>
                                setContentOption({ ...contentOption, template: value })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={t('contentEditor.chooseTemplatePlaceholder')} />
                            </SelectTrigger>
                            <SelectContent>
                                {templateOptions.map((template) => (
                                    <SelectItem key={template.value} value={template.value}>
                                        {template.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            )}

            {contentOption.type === 'link' && (
                <div className="space-y-2">
                    <Label>{t('contentEditor.contentUrlLabel')}</Label>
                    <Input
                        type="url"
                        value={contentOption.url || ''}
                        onChange={(e) =>
                            setContentOption({ ...contentOption, url: e.target.value })
                        }
                        placeholder={t('contentEditor.contentUrlPlaceholder')}
                    />
                </div>
            )}

            <div className="space-y-2">
                <Label>{t('contentEditor.contentTitleLabel')}</Label>
                <Input
                    value={contentOption.title}
                    onChange={(e) => setContentOption({ ...contentOption, title: e.target.value })}
                    placeholder={t('contentEditor.contentTitlePlaceholder')}
                />
            </div>

            <DeliveryOptionsEditor
                delivery={contentOption.delivery}
                onChange={(delivery) => setContentOption({ ...contentOption, delivery })}
            />
        </div>
    );
};

// Delivery Options Editor Component
interface DeliveryOptionsEditorProps {
    delivery: ContentDelivery;
    onChange: (delivery: ContentDelivery) => void;
}

const DeliveryOptionsEditor: React.FC<DeliveryOptionsEditorProps> = ({ delivery, onChange }) => {
    const { t } = useTranslation('settingsReferral');
    const [previewTemplate, setPreviewTemplate] = React.useState<MessageTemplate | null>(null);
    const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);

    const handleEmailTemplateSelect = (template: MessageTemplate | null) => {
        const updatedDelivery = { ...delivery };
        if (template) {
            updatedDelivery.emailTemplate = {
                id: template.id,
                name: template.name,
                subject: template.subject,
                content: template.content,
            };
        } else {
            delete updatedDelivery.emailTemplate;
        }
        onChange(updatedDelivery);
    };

    const handleWhatsAppTemplateSelect = (template: MessageTemplate | null) => {
        const updatedDelivery = { ...delivery };
        if (template) {
            updatedDelivery.whatsappTemplate = {
                id: template.id,
                name: template.name,
                content: template.content,
            };
        } else {
            delete updatedDelivery.whatsappTemplate;
        }
        onChange(updatedDelivery);
    };

    const handleEmailTemplatePreview = (template: MessageTemplate) => {
        setPreviewTemplate(template);
        setIsPreviewOpen(true);
    };

    const handleWhatsAppTemplatePreview = (template: MessageTemplate) => {
        setPreviewTemplate(template);
        setIsPreviewOpen(true);
    };

    const handleEmailTemplateCreate = () => {
        // TODO: Implement template creation functionality
        console.log('Create email template');
    };

    const handleWhatsAppTemplateCreate = () => {
        // TODO: Implement template creation functionality
        console.log('Create WhatsApp template');
    };

    return (
        <div className="space-y-4">
            <div>
                <Label>{t('deliveryOptions.deliveryMethodsLabel')}</Label>
                <div className="mt-2 flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="email-delivery"
                            checked={delivery.email}
                            onCheckedChange={(checked) =>
                                onChange({ ...delivery, email: checked as boolean })
                            }
                        />
                        <Label htmlFor="email-delivery" className="flex items-center gap-2 text-sm">
                            <Mail className="size-4" />
                            {t('deliveryOptions.email')}
                        </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="whatsapp-delivery"
                            checked={delivery.whatsapp}
                            onCheckedChange={(checked) =>
                                onChange({ ...delivery, whatsapp: checked as boolean })
                            }
                        />
                        <Label
                            htmlFor="whatsapp-delivery"
                            className="flex items-center gap-2 text-sm"
                        >
                            <MessageCircle className="size-4" />
                            {t('deliveryOptions.whatsapp')}
                        </Label>
                    </div>
                </div>
            </div>

            {/* Email Template Selection */}
            {delivery.email && (
                <TemplateSelector
                    templateType="EMAIL"
                    variant="dropdown"
                    selectedTemplate={
                        delivery.emailTemplate
                            ? {
                                  id: delivery.emailTemplate.id,
                                  name: delivery.emailTemplate.name,
                                  subject: delivery.emailTemplate.subject,
                                  content: delivery.emailTemplate.content,
                                  type: 'EMAIL',
                                  variables: [],
                                  isDefault: false,
                                  createdAt: '',
                                  updatedAt: '',
                                  instituteId: '',
                              }
                            : null
                    }
                    onTemplateSelect={handleEmailTemplateSelect}
                    onTemplatePreview={handleEmailTemplatePreview}
                    onTemplateCreate={handleEmailTemplateCreate}
                    placeholder={t('deliveryOptions.selectEmailTemplatePlaceholder')}
                />
            )}

            {/* WhatsApp Template Selection */}
            {delivery.whatsapp && (
                <TemplateSelector
                    templateType="WHATSAPP"
                    variant="dropdown"
                    selectedTemplate={
                        delivery.whatsappTemplate
                            ? {
                                  id: delivery.whatsappTemplate.id,
                                  name: delivery.whatsappTemplate.name,
                                  content: delivery.whatsappTemplate.content,
                                  type: 'WHATSAPP',
                                  variables: [],
                                  isDefault: false,
                                  createdAt: '',
                                  updatedAt: '',
                                  instituteId: '',
                              }
                            : null
                    }
                    onTemplateSelect={handleWhatsAppTemplateSelect}
                    onTemplatePreview={handleWhatsAppTemplatePreview}
                    onTemplateCreate={handleWhatsAppTemplateCreate}
                    placeholder={t('deliveryOptions.selectWhatsappTemplatePlaceholder')}
                />
            )}

            {/* Template Preview Modal */}
            <TemplatePreview
                isOpen={isPreviewOpen}
                onClose={() => setIsPreviewOpen(false)}
                template={previewTemplate}
            />
        </div>
    );
};

// Enhanced Referrer Tier Creator Component (same structure but with enhanced content options)
interface ReferrerTierCreatorProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (tier: ReferrerTier) => void;
    editingTier?: ReferrerTier | null;
    existingTiers: ReferrerTier[];
}

const ReferrerTierCreator: React.FC<ReferrerTierCreatorProps> = ({
    isOpen,
    onClose,
    onSave,
    editingTier,
}) => {
    const { t } = useTranslation('settingsReferral');
    const [formData, setFormData] = useState<Partial<ReferrerTier>>({
        tierName: '',
        referralCount: 1,
        reward: {
            type: 'discount_percentage',
            value: 10,
            currency: 'INR',
            pointsRewardType: 'discount_fixed',
        },
    });
    const [errors, setErrors] = useState<{ tierName?: boolean }>({});

    useEffect(() => {
        if (editingTier) {
            setFormData(editingTier);
        } else {
            setFormData({
                tierName: '',
                referralCount: 1,
                reward: {
                    type: 'discount_percentage',
                    value: 10,
                    currency: 'INR',
                    description: '',
                },
            });
        }
    }, [editingTier, isOpen]);

    // Auto-calculate referral count for points system
    useEffect(() => {
        if (
            formData.reward?.type === 'points_system' &&
            formData.reward.pointsPerReferral &&
            formData.reward.pointsToReward &&
            formData.reward.pointsPerReferral > 0
        ) {
            const calculatedReferralCount = Math.ceil(
                formData.reward.pointsToReward / formData.reward.pointsPerReferral
            );
            setFormData((prev) => ({
                ...prev,
                referralCount: calculatedReferralCount,
            }));
        }
    }, [
        formData.reward?.type,
        formData.reward?.pointsPerReferral,
        formData.reward?.pointsToReward,
    ]);

    const handleSave = () => {
        let hasError = false;
        const newErrors: { tierName?: boolean } = {};

        // Validate Tier Name
        if (!formData.tierName || formData.tierName.trim() === '') {
            newErrors.tierName = true;
            hasError = true;
            toast.error(t('validation.tierNameRequired'));
        }

        // Validate Reward (Safety check, though UI usually prevents this from being null)
        if (!formData.reward) {
            hasError = true;
            toast.error(t('validation.rewardMissing'));
        }

        setErrors(newErrors);

        if (hasError) {
            return;
        }

        // Clear errors
        setErrors({});

        const tier: ReferrerTier = {
            id: editingTier?.id || Date.now().toString(),
            tierName: formData.tierName!, // Safe to use ! here because we validated it above
            referralCount: formData.referralCount || 1,
            reward: {
                // ... rest of the existing reward mapping ...
                type: formData.reward!.type as ReferrerTier['reward']['type'],
                value: formData.reward!.value,
                currency: formData.reward!.currency,
                content: formData.reward!.content,
                courseId: formData.reward!.courseId,
                sessionId: formData.reward!.sessionId,
                levelId: formData.reward!.levelId,
                delivery: formData.reward!.delivery,
                pointsPerReferral: formData.reward!.pointsPerReferral,
                pointsToReward: formData.reward!.pointsToReward,
                pointsRewardType: formData.reward!.pointsRewardType,
                pointsRewardValue: formData.reward!.pointsRewardValue,
            },
        };

        onSave(tier);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-h-[85vh] w-[600px] overflow-y-auto ">
                <DialogHeader>
                    <DialogTitle>
                        {editingTier ? t('tierCreator.titleEdit') : t('tierCreator.titleCreate')}
                    </DialogTitle>
                    <DialogDescription>
                        {editingTier
                            ? t('tierCreator.descriptionEdit')
                            : t('tierCreator.descriptionCreate')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label className={errors.tierName ? "text-red-500" : ""}>
                            {t('tierCreator.tierNameLabel')} <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            value={formData.tierName || ''}
                            onChange={(e) => {
                                setFormData({ ...formData, tierName: e.target.value });
                                // Clear the error when the user starts typing
                                if (errors.tierName) setErrors({ ...errors, tierName: false });
                            }}
                            placeholder={t('tierCreator.tierNamePlaceholder')}
                            className={errors.tierName ? "border-red-500 focus-visible:ring-red-500" : ""}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>{t('tierCreator.referralCountLabel')}</Label>
                        <Input
                            type="number"
                            value={
                                formData.reward?.type === 'points_system' &&
                                formData.reward.pointsPerReferral &&
                                formData.reward.pointsToReward
                                    ? Math.ceil(
                                          formData.reward.pointsToReward /
                                              formData.reward.pointsPerReferral
                                      )
                                    : formData.referralCount || ''
                            }
                            onChange={(e) =>
                                setFormData({
                                    ...formData,
                                    referralCount: parseInt(e.target.value) || 0,
                                })
                            }
                            disabled={
                                !!(
                                    formData.reward?.type === 'points_system' &&
                                    formData.reward.pointsPerReferral &&
                                    formData.reward.pointsToReward
                                )
                            }
                            className={
                                formData.reward?.type === 'points_system' &&
                                formData.reward.pointsPerReferral &&
                                formData.reward.pointsToReward
                                    ? 'cursor-not-allowed bg-gray-100'
                                    : ''
                            }
                        />
                        {formData.reward?.type === 'points_system' &&
                            formData.reward.pointsPerReferral &&
                            formData.reward.pointsToReward && (
                                <p className="text-xs text-gray-600">
                                    {t('tierCreator.autoCalculated', {
                                        pointsToReward: formData.reward.pointsToReward,
                                        pointsPerReferral: formData.reward.pointsPerReferral,
                                        referrals: Math.ceil(
                                            formData.reward.pointsToReward /
                                                formData.reward.pointsPerReferral
                                        ),
                                    })}
                                </p>
                            )}
                    </div>

                    <div className="space-y-2">
                        <Label>{t('tierCreator.rewardTypeLabel')}</Label>
                        <Select
                            value={formData.reward?.type || 'discount_percentage'}
                            onValueChange={(value) =>
                                setFormData({
                                    ...formData,
                                    reward: {
                                        ...formData.reward!,
                                        type: value as
                                            | 'discount_percentage'
                                            | 'discount_fixed'
                                            | 'bonus_content'
                                            | 'free_days'
                                            | 'points_system',
                                    },
                                })
                            }
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="discount_percentage">
                                    {t('rewardTypeOptions.percentageDiscount')}
                                </SelectItem>
                                <SelectItem value="discount_fixed">
                                    {t('rewardTypeOptions.fixedAmountDiscount')}
                                </SelectItem>
                                <SelectItem value="bonus_content">{t('rewardTypeOptions.bonusContent')}</SelectItem>
                                <SelectItem value="free_days">{t('rewardTypeOptions.freeMembershipDays')}</SelectItem>
                                <SelectItem value="points_system">{t('rewardTypeOptions.pointsSystem')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Conditional Fields based on reward type */}
                    {(formData.reward?.type === 'discount_percentage' ||
                        formData.reward?.type === 'free_days') && (
                        <div className="space-y-2">
                            <Label>
                                {formData.reward.type === 'discount_percentage'
                                    ? t('tierCreator.discountPercentageLabel')
                                    : t('tierCreator.numberOfDaysLabel')}
                            </Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    value={formData.reward.value || ''}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            reward: {
                                                ...formData.reward!,
                                                value: parseInt(e.target.value) || 0,
                                            },
                                        })
                                    }
                                    placeholder={t('tierCreator.valuePlaceholder')}
                                    min="1"
                                    max={
                                        formData.reward.type === 'discount_percentage'
                                            ? '100'
                                            : '365'
                                    }
                                />
                                <span className="text-sm text-gray-500">
                                    {formData.reward.type === 'discount_percentage' ? t('tierCreator.percentUnit') : t('tierCreator.daysUnit')}
                                </span>
                            </div>
                        </div>
                    )}

                    {formData.reward?.type === 'discount_fixed' && (
                        <div className="space-y-2">
                            <Label>{t('tierCreator.discountAmountLabel')}</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="number"
                                    value={formData.reward.value || ''}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            reward: {
                                                ...formData.reward!,
                                                value: parseInt(e.target.value) || 0,
                                            },
                                        })
                                    }
                                    placeholder={t('tierCreator.amountPlaceholder')}
                                    min="1"
                                />
                                <Select
                                    value={formData.reward.currency || 'INR'}
                                    onValueChange={(value) =>
                                        setFormData({
                                            ...formData,
                                            reward: {
                                                ...formData.reward!,
                                                currency: value,
                                            },
                                        })
                                    }
                                >
                                    <SelectTrigger className="w-24">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="INR">₹</SelectItem>
                                        <SelectItem value="USD">$</SelectItem>
                                        <SelectItem value="EUR">€</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {formData.reward?.type === 'bonus_content' && (
                        <ContentEditor
                            content={formData.reward.content}
                            onChange={(content) =>
                                setFormData({
                                    ...formData,
                                    reward: {
                                        ...formData.reward!,
                                        content,
                                        // Also sync delivery to reward level for API compatibility
                                        delivery:
                                            content.content?.delivery || formData.reward!.delivery,
                                    },
                                })
                            }
                        />
                    )}

                    {formData.reward?.type === 'points_system' && (
                        <div className="space-y-4 rounded-lg border bg-gray-50 p-4">
                            <div className="space-y-2">
                                <Label>{t('tierCreator.pointsPerReferralLabel')}</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={formData.reward.pointsPerReferral || ''}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                reward: {
                                                    ...formData.reward!,
                                                    pointsPerReferral:
                                                        parseInt(e.target.value) || 0,
                                                },
                                            })
                                        }
                                        placeholder={t('tierCreator.pointsPerReferralPlaceholder')}
                                        min="1"
                                    />
                                    <span className="text-sm text-gray-500">
                                        {t('tierCreator.pointsPerReferralUnit')}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-600">
                                    {t('tierCreator.pointsPerReferralHint')}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>{t('tierCreator.pointsRequiredLabel')}</Label>
                                <Input
                                    type="number"
                                    value={formData.reward.pointsToReward || ''}
                                    onChange={(e) =>
                                        setFormData({
                                            ...formData,
                                            reward: {
                                                ...formData.reward!,
                                                pointsToReward: parseInt(e.target.value) || 0,
                                            },
                                        })
                                    }
                                    placeholder={t('tierCreator.pointsRequiredPlaceholder')}
                                    min="1"
                                />
                                <p className="text-xs text-gray-600">
                                    {t('tierCreator.pointsRequiredHint')}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label>{t('tierCreator.rewardTypeLabel')}</Label>
                                <Select
                                    value={formData.reward.pointsRewardType || 'discount_fixed'}
                                    onValueChange={(value) => {
                                        setFormData({
                                            ...formData,
                                            reward: {
                                                ...formData.reward!,
                                                pointsRewardType: value as
                                                    | 'discount_percentage'
                                                    | 'discount_fixed'
                                                    | 'membership_days',
                                            },
                                        });
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="discount_percentage">
                                            {t('rewardTypeOptions.percentageDiscount')}
                                        </SelectItem>
                                        <SelectItem value="discount_fixed">
                                            {t('rewardTypeOptions.fixedAmountDiscount')}
                                        </SelectItem>
                                        <SelectItem value="membership_days">
                                            {t('rewardTypeOptions.freeMembershipDays')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>{t('tierCreator.rewardValueLabel')}</Label>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="number"
                                        value={formData.reward.pointsRewardValue || ''}
                                        onChange={(e) =>
                                            setFormData({
                                                ...formData,
                                                reward: {
                                                    ...formData.reward!,
                                                    pointsRewardValue:
                                                        parseInt(e.target.value) || 0,
                                                },
                                            })
                                        }
                                        placeholder={t('tierCreator.valuePlaceholder')}
                                        min="1"
                                    />
                                    <span className="text-sm text-gray-500">
                                        {formData.reward.pointsRewardType === 'discount_percentage'
                                            ? t('tierCreator.percentUnit')
                                            : formData.reward.pointsRewardType ===
                                                  'membership_days' && t('tierCreator.daysUnit')}
                                    </span>
                                </div>
                            </div>

                            {/* Points System Summary */}
                            <div className="rounded border bg-white p-3">
                                <h5 className="mb-2 text-sm font-medium">{t('pointsSummary.title')}</h5>
                                <div className="space-y-1 text-xs text-gray-600">
                                    <div>
                                        • {t('pointsSummary.earnsPrefix')}{' '}
                                        <strong>
                                            {formData.reward.pointsPerReferral || 0}{' '}
                                            {t('pointsSummary.pointsUnit')}
                                        </strong>{' '}
                                        {t('pointsSummary.perReferralSuffix')}
                                    </div>
                                    <div>
                                        • {t('pointsSummary.needsPrefix')}{' '}
                                        <strong>
                                            {formData.reward.pointsToReward || 0}{' '}
                                            {t('pointsSummary.totalPointsUnit')}
                                        </strong>{' '}
                                        {t('pointsSummary.toClaimSuffix')}
                                    </div>
                                    <div>
                                        • {t('pointsSummary.requiresPrefix')}{' '}
                                        <strong>
                                            {Math.ceil(
                                                (formData.reward.pointsToReward || 0) /
                                                    (formData.reward.pointsPerReferral || 1)
                                            )}{' '}
                                            {t('pointsSummary.referralsUnit')}
                                        </strong>{' '}
                                        {t('pointsSummary.toEarnSuffix')}
                                    </div>
                                    <div>
                                        • {t('pointsSummary.rewardPrefix')}{' '}
                                        <strong>
                                            {formData.reward.pointsRewardValue || 0}{' '}
                                            {formData.reward.pointsRewardType ===
                                            'discount_percentage'
                                                ? t('pointsSummary.percentDiscountSuffix')
                                                : formData.reward.pointsRewardType ===
                                                    'membership_days'
                                                  ? t('pointsSummary.freeDaysSuffix')
                                                  : t('pointsSummary.discountSuffix')}
                                        </strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 pt-4">
                    <MyButton buttonType="secondary" onClick={onClose}>
                        {t('tierCreator.cancel')}
                    </MyButton>
                    <MyButton buttonType="primary" onClick={handleSave}>
                        {editingTier ? t('tierCreator.updateTier') : t('tierCreator.createTier')}
                    </MyButton>
                </div>
            </DialogContent>
        </Dialog>
    );
};
