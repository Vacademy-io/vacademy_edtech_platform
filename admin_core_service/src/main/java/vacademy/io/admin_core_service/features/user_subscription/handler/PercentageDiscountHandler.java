package vacademy.io.admin_core_service.features.user_subscription.handler;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.user_subscription.dto.BenefitConfigDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralMapping;
import vacademy.io.admin_core_service.features.user_subscription.entity.ReferralOption;
import vacademy.io.admin_core_service.features.user_subscription.enums.ReferralBenefitLogsBeneficiary;
import vacademy.io.admin_core_service.features.user_subscription.enums.ReferralBenefitType;
import vacademy.io.admin_core_service.features.user_subscription.enums.ReferralStatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.service.MultiChannelDeliveryService;
import vacademy.io.admin_core_service.features.user_subscription.service.ReferralBenefitLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.ReferralRewardService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.AdminDiscountService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.learner.LearnerPackageSessionsEnrollDTO;

@Component
public class PercentageDiscountHandler implements ReferralBenefitHandler {

    @Autowired
    private ReferralBenefitLogService referralBenefitLogService;

    @Autowired
    private MultiChannelDeliveryService multiChannelDeliveryService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ReferralRewardService referralRewardService;

    @Override
    public void processBenefit(LearnerPackageSessionsEnrollDTO learnerPackageSessionsEnrollDTO,
                               ReferralOption referralOption,
                               PaymentOption paymentOption,
                               ReferralMapping referralMapping,
                               UserDTO refereeUser,
                               UserDTO referrer,
                               String instituteId,
                               BenefitConfigDTO.BenefitDTO benefitDTO,
                               String beneficiary,
                               String status) {
        try {
            BenefitConfigDTO.PercentageDiscountValue percentageDiscountValue = objectMapper.convertValue(benefitDTO.getValue(), BenefitConfigDTO.PercentageDiscountValue.class);

            // Only a referee on a non-trial plan is discounted at this checkout. A trial's
            // discount waits for its first real charge, and a referrer's reward is their own
            // next renewal — see ReferralRewardService.
            boolean atCheckout = referralRewardService.routeDiscountBenefit(
                    referralMapping, referrer.getId(), instituteId, beneficiary, status,
                    AdminDiscountService.MODE_PERCENTAGE,
                    percentageDiscountValue.getPercentage(), percentageDiscountValue.getMaxDiscount());
            if (atCheckout && hasCheckoutAmount(learnerPackageSessionsEnrollDTO)) {
                double discountedAmount = getDiscountedAmount(learnerPackageSessionsEnrollDTO, percentageDiscountValue);
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(
                        learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount() - discountedAmount
                );
            }

            // If the benefit is active, send a notification email.
            if (status.equalsIgnoreCase(ReferralStatusEnum.ACTIVE.name())) {
                boolean isForReferee = beneficiary.equalsIgnoreCase(ReferralBenefitLogsBeneficiary.REFEREE.name());
                multiChannelDeliveryService.sendReferralNotification(
                        referrer,
                        refereeUser,
                        percentageDiscountValue,
                        ReferralBenefitType.PERCENTAGE_DISCOUNT,
                        instituteId,
                        referralMapping,
                        isForReferee
                );
            }

            String targetUserId = beneficiary.equalsIgnoreCase(ReferralBenefitLogsBeneficiary.REFEREE.name())
                    ? refereeUser.getId()
                    : referrer.getId();

            referralBenefitLogService.createLog(
                    referralMapping.getUserPlan(),
                    referralMapping,
                    targetUserId,
                    ReferralBenefitType.PERCENTAGE_DISCOUNT.name(),
                    beneficiary,
                    objectMapper.writeValueAsString(percentageDiscountValue),
                    status
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to process percentage discount benefit", e);
        }
    }

    private static boolean hasCheckoutAmount(LearnerPackageSessionsEnrollDTO dto) {
        return dto.getPaymentInitiationRequest() != null && dto.getPaymentInitiationRequest().getAmount() != null;
    }

    private double getDiscountedAmount(LearnerPackageSessionsEnrollDTO learnerPackageSessionsEnrollDTO, BenefitConfigDTO.PercentageDiscountValue percentageDiscountValue) {
        double amount = learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount();
        double discount = amount * percentageDiscountValue.getPercentage() / 100.0;

        // See ReferralRewardService.effectiveCap: no cap when empty, 0, or the legacy
        // "cap = percentage" value the admin app used to save.
        Double cap = ReferralRewardService.effectiveCap(
                percentageDiscountValue.getPercentage(), percentageDiscountValue.getMaxDiscount());
        if (cap != null && discount > cap) {
            return cap;
        }
        return discount;
    }
}