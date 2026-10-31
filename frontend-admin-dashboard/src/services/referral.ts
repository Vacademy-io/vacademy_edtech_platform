import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    UnifiedReferralSettings,
    ReferrerTier,
    ReferrerReward,
    RefereeReward,
} from '@/types/referral';
import { REFERRAL_API_BASE, REFERRAL_DELETE, REFERRAL_UPDATE } from '@/constants/urls';
import { getInstituteId } from '@/constants/helper';

// API endpoints

// Interface for API reward format
interface ApiRewardFormat {
    tier_name: string;
    referral_count: number;
    reward: {
        type: string;
        value?: number;
        currency?: string;
        description: string;
        content?: unknown;
        course_id?: string;
        session_id?: string;
        level_id?: string;
        delivery?: unknown;
        points_per_referral?: number;
        points_to_reward?: number;
        points_reward_type?: string;
        points_reward_value?: number;
    };
}

// Types for API requests and responses
export interface ReferralOptionRequest {
    name: string;
    status: string;
    source: string; // "INSTITUTE"
    source_id: string; // institute_id
    referrer_discount_json: string;
    referee_discount_json: string;
    referrer_vesting_days: number;
    allow_combine_offers: boolean;
    tag: string | null;
    description: string;
    setting_json?: string;
}

export interface ReferralOptionResponse {
    id: string;
    name: string;
    status: string;
    source: string;
    source_id: string;
    referrer_discount_json: string;
    referee_discount_json: string;
    referrer_vesting_days: number;
    allow_combine_offers:boolean;
    tag: string | null;
    description: string;
    created_at?: string;
    updated_at?: string;
    setting_json?: string;
}

// Helper function to convert reward to new tier-based benefit format
const convertRewardToNewTierFormat = (
    reward: ReferrerReward | RefereeReward,
    tierName: string = 'benefit',
    referralRange: { min: number; max: number } = { min: 1, max: 1 },
    vestingDays: number = 7
) => {
    const benefit = convertRewardToBenefit(reward);

    return {
        tiers: [
            {
                tierName,
                referralRange,
                vestingDays,
                benefits: [benefit],
            },
        ],
    };
};

// Helper function to convert reward to benefit object
const convertRewardToBenefit = (reward: ReferrerReward | RefereeReward) => {
    switch (reward.type) {
        case 'discount_percentage':
            return {
                description: `${reward.value || 0}% discount reward`,
                type: 'PERCENTAGE_DISCOUNT',
                value: {
                    percentage: reward.value || 0,
                    // No cap. This used to send the percentage itself, so "10%" was capped at ₹10.
                    maxDiscount: null,
                },
                pointTriggers: [],
            };
        case 'discount_fixed':
            return {
                description: `₹${reward.value || 0} flat discount`,
                type: 'FLAT_DISCOUNT',
                value: {
                    amount: reward.value || 0,
                },
                pointTriggers: [],
            };
        case 'free_days':
            return {
                description: `${reward.value || 0} days free membership`,
                type: 'FREE_MEMBERSHIP_DAYS',
                value: {
                    days: reward.value || 0,
                },
                pointTriggers: [],
            };
        case 'bonus_content': {
            // Use actual delivery mediums from the reward object
            const deliveryMediums: string[] = [];

            // Check multiple locations for delivery info - priority order matters
            let effectiveDelivery = null;

            // First check reward.delivery (top level)
            if (reward.delivery && (reward.delivery.email || reward.delivery.whatsapp)) {
                effectiveDelivery = reward.delivery;
            }
            // Then check content.content.delivery (nested in content)
            else if (
                reward.content?.content?.delivery &&
                (reward.content.content.delivery.email || reward.content.content.delivery.whatsapp)
            ) {
                effectiveDelivery = reward.content.content.delivery;
            }

            if (effectiveDelivery?.email) {
                deliveryMediums.push('EMAIL');
            }
            if (effectiveDelivery?.whatsapp) {
                deliveryMediums.push('WHATSAPP');
            }

            // Get actual file IDs from content if available
            let fileIds: string[] = [];
            let contentUrl: string | null = null;

            if (reward.content?.content?.type === 'link' && reward.content.content.url) {
                // For external links, use contentUrl
                contentUrl = reward.content.content.url;
            } else if (reward.content?.content?.fileId) {
                // Use the actual uploaded file ID for uploads
                fileIds = [reward.content.content.fileId];
            } else if (reward.courseId) {
                // Fallback to courseId if available
                fileIds = [reward.courseId];
            }

            // Get actual template ID from content if available
            let templateId = 'TEMPLATE_DEFAULT'; // Default fallback
            if (reward.content?.content?.template) {
                // Use the actual selected template
                templateId = reward.content.content.template;
            }

            // Build the value object based on content type
            const valueObject: Record<string, unknown> = {
                deliveryMediums: deliveryMediums.length > 0 ? deliveryMediums : ['EMAIL'],
                templateId: templateId,
                subject: null,
                body: null,
                contentType:reward.content?.contentType
            };

            // Add either contentUrl or fileIds based on content type
            if (contentUrl) {
                valueObject.contentUrl = contentUrl;
            } else {
                valueObject.fileIds = fileIds;
            }

            return {
                description: reward.content?.content?.title || 'Exclusive bonus content',
                type: 'CONTENT',
                value: valueObject,
                pointTriggers: [],
            };
        }
        case 'points_system': {
            const pointTriggers = [];

            // Handle nested point rewards
            if (reward.pointsRewardType && reward.pointsToReward && reward.pointsRewardValue) {
                const nestedBenefit = (() => {
                    switch (reward.pointsRewardType) {
                        case 'discount_percentage':
                            return {
                                description: `${reward.pointsRewardValue}% discount unlocked`,
                                type: 'PERCENTAGE_DISCOUNT',
                                value: {
                                    percentage: reward.pointsRewardValue,
                                    maxDiscount: null,
                                },
                                pointTriggers: [],
                            };
                        case 'discount_fixed':
                            return {
                                description: `₹${reward.pointsRewardValue} discount unlocked`,
                                type: 'FLAT_DISCOUNT',
                                value: {
                                    amount: reward.pointsRewardValue,
                                },
                                pointTriggers: [],
                            };
                        case 'membership_days':
                            return {
                                description: `${reward.pointsRewardValue} days membership unlocked`,
                                type: 'FREE_MEMBERSHIP_DAYS',
                                value: {
                                    days: reward.pointsRewardValue,
                                },
                                pointTriggers: [],
                            };
                        default:
                            throw new Error(
                                `Unknown points reward type: ${reward.pointsRewardType}`
                            );
                    }
                })();

                pointTriggers.push({
                    pointsRequired: reward.pointsToReward,
                    benefits: [nestedBenefit],
                });
            }

            return {
                description: `Earn ${reward.pointsPerReferral || 0} points per referral`,
                type: 'POINTS',
                value: {
                    points: reward.pointsPerReferral || 0,
                },
                pointTriggers,
            };
        }
        default: {
            throw new Error(`Unknown reward type: ${reward.type}`);
        }
    }
};

// Helper function to convert UnifiedReferralSettings to API format
export const convertToApiFormat = (settings: UnifiedReferralSettings): ReferralOptionRequest => {
    const instituteId = getInstituteId();

    // 1. Evaluate presence of rewards
    const hasRefereeReward = !!settings.refereeReward;
    const hasReferrerRewards = settings.referrerRewards && settings.referrerRewards.length > 0;

    // 2. Validate required fields (At Least One Rule)
    if (!settings.label || (!hasRefereeReward && !hasReferrerRewards)) {
        throw new Error('Missing required fields: label, and at least one of refereeReward or referrerRewards');
    }

    // 3. Safely convert referrer rewards (fallback to empty array if undefined)
    // Per-referral rewards (discounts, points) form a ladder: a tier applies from its count
    // up to the next tier's count, and the last one applies to every referral after that.
    // Saving min = max = count rewarded only the exact Nth referral, so a "5% per referral"
    // programme paid out once. One-off milestone rewards (content, free days) keep the
    // exact count so they are not re-sent on every later referral.
    const perReferral = new Set(['discount_percentage', 'discount_fixed', 'points_system']);
    const tierCounts = (settings.referrerRewards || [])
        .map((tier: ReferrerTier) => tier.referralCount)
        .sort((a, b) => a - b);
    const nextCount = (count: number) => tierCounts.find((c) => c > count);
    const referrerTiers = (settings.referrerRewards || []).map((tier: ReferrerTier) => {
        const benefit = convertRewardToBenefit(tier.reward);
        const next = nextCount(tier.referralCount);
        return {
            tierName: tier.tierName,
            referralRange: {
                min: tier.referralCount,
                max: perReferral.has(tier.reward.type)
                    ? next !== undefined
                        ? next - 1
                        : null
                    : tier.referralCount,
            },
            vestingDays: settings.payoutVestingDays || 7,
            benefits: [benefit],
        };
    });

    const referrerDiscountJson = JSON.stringify({
        tiers: referrerTiers,
    });

    // 4. Safely convert referee reward using a ternary operator
    const refereeDiscountJson = settings.refereeReward 
        ? JSON.stringify(
            convertRewardToNewTierFormat(
                settings.refereeReward,
                'benefit',
                { min: 1, max: 1 },
                settings.payoutVestingDays || 7
            )
        )
        // Pass a null or empty tiers object string if no referee reward exists
        : JSON.stringify({ tiers: [] });

    return {
        name: settings.label,
        status: 'ACTIVE',
        source: 'INSTITUTE',
        source_id: instituteId || '',
        referrer_discount_json: referrerDiscountJson,
        referee_discount_json: refereeDiscountJson,
        // The backend DTO is snake_case; the camelCase key was silently dropped.
        allow_combine_offers: settings.allowCombineOffers,
        referrer_vesting_days: settings.payoutVestingDays || 7,
        tag: settings.isDefault ? 'DEFAULT' : null,
        description: settings.description || `Referral program: ${settings.label}`,
    };
};

// Helper function to convert new tier-based benefit format back to referee reward
const convertNewTierFormatToRefereeReward = (tierData: Record<string, unknown>): RefereeReward => {
    // Check if this is already in the new tier format
    const tiers = tierData.tiers as Array<Record<string, unknown>>;
    if (tiers && tiers[0]) {
        const firstTier = tiers[0];
        const benefits = firstTier.benefits as Array<Record<string, unknown>>;
        if (benefits && benefits[0]) {
            return convertBenefitToReward(benefits[0]) as RefereeReward;
        }
    }

    // Check if this is legacy format (direct benefit)
    if (tierData.type && tierData.value) {
        return convertBenefitToReward(tierData) as RefereeReward;
    }

    // Check if this has benefitType and benefitValue (old format)
    if (tierData.benefitType && tierData.benefitValue) {
        return convertBenefitToReward({
            type: tierData.benefitType,
            value: tierData.benefitValue,
        }) as RefereeReward;
    }

    // Default fallback - create a basic discount reward
    console.warn('No valid referee reward data found, creating default discount reward');
    return {
        type: 'discount_percentage',
        value: 10,
        currency: 'USD',
    };
};

// Helper function to convert new tier-based benefit format back to referrer rewards
const convertNewTierFormatToReferrerRewards = (
    tierData: Record<string, unknown>
): ReferrerTier[] => {
    // Check if this is the new tier format
    const tiers = tierData.tiers as Array<Record<string, unknown>>;
    if (tiers && Array.isArray(tiers)) {
        return tiers.map((tier, index) => {
            const benefits = tier.benefits as Array<Record<string, unknown>>;
            const benefit = benefits && benefits[0] ? benefits[0] : null;

            let reward: ReferrerReward;
            if (benefit) {
                reward = convertBenefitToReward(benefit) as ReferrerReward;
            } else {
                // Default fallback reward
                console.warn(
                    `No valid benefit found for tier: ${tier.tierName || index}, using default`
                );
                reward = {
                    type: 'discount_percentage',
                    value: 5,
                    currency: 'USD',
                };
            }

            const referralRange = tier.referralRange as Record<string, unknown>;

            return {
                id: `tier_${index}`,
                tierName: (tier.tierName as string) || `Tier ${index + 1}`,
                referralCount: (referralRange?.min as number) || 1,
                reward,
            };
        });
    }

    // Check for legacy format with referralBenefits
    if (
        tierData.benefitValue &&
        (tierData.benefitValue as Record<string, unknown>).referralBenefits
    ) {
        const benefitValue = tierData.benefitValue as Record<string, unknown>;
        const referralBenefits = benefitValue.referralBenefits as Array<Record<string, unknown>>;

        return referralBenefits.map((benefit, index) => {
            const reward = convertBenefitToReward({
                type: tierData.benefitType || 'discount_percentage',
                value: benefit,
            }) as ReferrerReward;

            return {
                id: `legacy_tier_${index}`,
                tierName: (benefit.tierName as string) || `Tier ${index + 1}`,
                referralCount:
                    ((benefit.referralRange as Record<string, unknown>)?.min as number) || 1,
                reward,
            };
        });
    }

    // Default fallback - create a single tier
    console.warn('No valid referrer tier data found, creating default tier');
    return [
        {
            id: 'default_tier',
            tierName: 'Default Tier',
            referralCount: 1,
            reward: {
                type: 'discount_percentage',
                value: 5,
                currency: 'USD',
            },
        },
    ];
};

// Helper function to convert benefit object back to reward
const convertBenefitToReward = (
    benefit: Record<string, unknown>
): ReferrerReward | RefereeReward => {
    // Handle case where benefit structure is different
    if (!benefit || !benefit.type) {
        console.warn('Invalid benefit structure, using default discount');
        return {
            type: 'discount_percentage',
            value: 10,
            currency: 'USD',
        };
    }

    const benefitValue = benefit.value as Record<string, unknown>;

    switch (benefit.type) {
        case 'PERCENTAGE_DISCOUNT':
            return {
                type: 'discount_percentage',
                value: (benefitValue?.percentage as number) || 0,
                currency: 'INR',
            };
        case 'FLAT_DISCOUNT':
            return {
                type: 'discount_fixed',
                value: (benefitValue?.amount as number) || 0,
                currency: 'INR',
            };
        case 'FREE_MEMBERSHIP_DAYS':
            return {
                type: 'free_days',
                value: (benefitValue?.days as number) || 0,
            };
        case 'CONTENT': {
            const deliveryMediums = benefitValue?.deliveryMediums as string[];

            // Check for delivery in multiple possible locations
            let delivery = {
                email: false,
                whatsapp: false,
            };

            if (deliveryMediums && Array.isArray(deliveryMediums) && deliveryMediums.length > 0) {
                // Use deliveryMediums from benefitValue
                delivery = {
                    email: deliveryMediums.includes('EMAIL'),
                    whatsapp: deliveryMediums.includes('WHATSAPP'),
                };
            } else if (benefit.delivery) {
                // Check if delivery is directly on the benefit object
                const benefitDelivery = benefit.delivery as Record<string, boolean>;
                delivery = {
                    email: benefitDelivery.email || false,
                    whatsapp: benefitDelivery.whatsapp || false,
                };
            } else if (benefitValue?.delivery) {
                // Check if delivery is in benefitValue
                const valueDelivery = benefitValue.delivery as Record<string, boolean>;
                delivery = {
                    email: valueDelivery.email || false,
                    whatsapp: valueDelivery.whatsapp || false,
                };
            } else {
                // Default to email delivery if no delivery info found
                console.warn('No delivery information found, defaulting to email');
                delivery = {
                    email: true,
                    whatsapp: false,
                };
            }

            // Extract content data from the benefit value
            const fileIds = benefitValue?.fileIds as string[];
            const contentUrl = benefitValue?.contentUrl as string;
            const templateId = benefitValue?.templateId as string;

            // Determine content type and structure based on available data
            let contentOption;
            if (contentUrl) {
                // External link content
                contentOption = {
                    type: 'link' as const,
                    title: (benefit.description as string) || 'Bonus Content',
                    url: contentUrl,
                    delivery,
                    template:
                        templateId && templateId !== 'TEMPLATE_DEFAULT' ? templateId : undefined,
                };
            } else {
                // Upload content (file-based)
                contentOption = {
                    type: 'upload' as const,
                    title: (benefit.description as string) || 'Bonus Content',
                    delivery,
                    fileId: fileIds && fileIds.length > 0 ? fileIds[0] : undefined,
                    template:
                        templateId && templateId !== 'TEMPLATE_DEFAULT' ? templateId : undefined,
                };
            }

            return {
                type: 'bonus_content',
                content: {
                    contentType: benefitValue.contentType as
                        | 'pdf'
                        | 'video'
                        | 'audio'
                        | 'course',
                    content: contentOption,
                },
                delivery,
            };
        }
        case 'POINTS': {
            const pointTriggers = benefit.pointTriggers as Array<Record<string, unknown>>;

            // Handle point triggers for nested rewards
            let pointsRewardType:
                | 'discount_percentage'
                | 'discount_fixed'
                | 'membership_days'
                | undefined;
            let pointsRewardValue: number | undefined;
            let pointsToReward: number | undefined;

            if (pointTriggers && pointTriggers.length > 0) {
                const trigger = pointTriggers[0];
                if (trigger) {
                    pointsToReward = trigger.pointsRequired as number;

                    const triggerBenefits = trigger.benefits as Array<Record<string, unknown>>;
                    if (triggerBenefits && triggerBenefits.length > 0) {
                        const triggerBenefit = triggerBenefits[0];
                        if (triggerBenefit) {
                            const triggerValue = triggerBenefit.value as Record<string, unknown>;

                            switch (triggerBenefit.type) {
                                case 'PERCENTAGE_DISCOUNT':
                                    pointsRewardType = 'discount_percentage';
                                    pointsRewardValue = triggerValue?.percentage as number;
                                    break;
                                case 'FLAT_DISCOUNT':
                                    pointsRewardType = 'discount_fixed';
                                    pointsRewardValue = triggerValue?.amount as number;
                                    break;
                                case 'FREE_MEMBERSHIP_DAYS':
                                    pointsRewardType = 'membership_days';
                                    pointsRewardValue = triggerValue?.days as number;
                                    break;
                            }
                        }
                    }
                }
            }

            return {
                type: 'points_system',
                pointsPerReferral: (benefitValue?.points as number) || 0,
                pointsToReward,
                pointsRewardType,
                pointsRewardValue,
            };
        }
        default:
            console.warn(`Unknown benefit type: ${benefit.type}, using default discount`);
            return {
                type: 'discount_percentage',
                value: 10,
                currency: 'USD',
            };
    }
};

// Helper function to convert API response to UnifiedReferralSettings format
export const convertFromApiFormat = (
    apiResponse: ReferralOptionResponse
): UnifiedReferralSettings => {
    try {
        const referrerDiscountData = JSON.parse(apiResponse.referrer_discount_json);
        const refereeDiscountData = JSON.parse(apiResponse.referee_discount_json);

        // Handle referee reward - convert from new tier-based format
        const refereeReward = convertNewTierFormatToRefereeReward(refereeDiscountData);

        // Handle referrer rewards - convert from new tier-based format
        let referrerRewards: ReferrerTier[] = [];

        // Check if referrerDiscountData has the new tier-based structure
        if (referrerDiscountData && typeof referrerDiscountData === 'object') {
            if (referrerDiscountData.tiers) {
                // New tier-based format
                referrerRewards = convertNewTierFormatToReferrerRewards(referrerDiscountData);
            } else if (referrerDiscountData.benefitValue?.referralBenefits) {
                // Legacy format - fallback conversion
                referrerRewards = referrerDiscountData.benefitValue.referralBenefits.map(
                    (benefit: Record<string, unknown>, index: number) => {
                        const reward = convertBenefitToReward({
                            type: referrerDiscountData.benefitType || 'CONTENT',
                            value: benefit,
                        }) as ReferrerReward;

                        return {
                            id: `${apiResponse.id}_${(benefit.tierName as string) || index}`,
                            tierName: (benefit.tierName as string) || `Tier ${index + 1}`,
                            referralCount:
                                ((benefit.referralRange as Record<string, unknown>)
                                    ?.min as number) || 1,
                            reward,
                        };
                    }
                );
            } else if (referrerDiscountData.rewards) {
                // Old format - fallback
                referrerRewards = referrerDiscountData.rewards.map((reward: ApiRewardFormat) => ({
                    id: `${apiResponse.id}_${reward.tier_name}`,
                    tierName: reward.tier_name,
                    referralCount: reward.referral_count,
                    reward: {
                        type: reward.reward.type,
                        value: reward.reward.value,
                        currency: reward.reward.currency,
                        content: reward.reward.content,
                        courseId: reward.reward.course_id,
                        sessionId: reward.reward.session_id,
                        levelId: reward.reward.level_id,
                        delivery: reward.reward.delivery,
                        pointsPerReferral: reward.reward.points_per_referral,
                        pointsToReward: reward.reward.points_to_reward,
                        pointsRewardType: reward.reward.points_reward_type,
                        pointsRewardValue: reward.reward.points_reward_value,
                    },
                }));
            }
        }

        return {
            id: apiResponse.id,
            label: apiResponse.name,
            isDefault: apiResponse.tag === 'DEFAULT',
            payoutVestingDays: apiResponse.referrer_vesting_days,
            allowCombineOffers: apiResponse.allow_combine_offers,
            refereeReward,
            referrerRewards,
        };
    } catch (error) {
        console.error('Error parsing referral option data:', error);
        throw new Error('Invalid referral option data format');
    }
};

// API functions
export const addReferralOption = async (
    settings: UnifiedReferralSettings
): Promise<ReferralOptionResponse> => {
    try {
        const apiData = convertToApiFormat(settings);

        const response = await authenticatedAxiosInstance.post<ReferralOptionResponse>(
            REFERRAL_API_BASE,
            apiData,
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        return response.data;
    } catch (error) {
        console.error('Error adding referral option:', error);
        throw error;
    }
};

export const getReferralOptions = async (): Promise<ReferralOptionResponse[]> => {
    try {
        const instituteId = getInstituteId();

        const response = await authenticatedAxiosInstance.get<ReferralOptionResponse[]>(
            REFERRAL_API_BASE,
            {
                params: {
                    source: 'INSTITUTE',
                    sourceId: instituteId,
                },
            }
        );

        return response.data;
    } catch (error) {
        console.error('Error fetching referral options:', error);
        throw error;
    }
};

export const deleteReferralOption = async (referralOptionId: string): Promise<void> => {
    try {
        await authenticatedAxiosInstance.delete(REFERRAL_DELETE, {
            data: [referralOptionId],
        });
    } catch (error) {
        console.error('Error deleting referral option:', error);
        throw error;
    }
};

export const updateReferralOption = async (
    referralOptionId: string,
    settings: UnifiedReferralSettings
): Promise<ReferralOptionResponse> => {
    try {
        const apiData = convertToApiFormat(settings);

        const response = await authenticatedAxiosInstance.put<ReferralOptionResponse>(
            REFERRAL_UPDATE(referralOptionId),
            {
                id: referralOptionId,
                ...apiData,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        return response.data;
    } catch (error) {
        console.error('Error updating referral option:', error);
        throw error;
    }
};
