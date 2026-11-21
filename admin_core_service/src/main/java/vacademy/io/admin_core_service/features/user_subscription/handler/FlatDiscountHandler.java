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
public class FlatDiscountHandler implements ReferralBenefitHandler {

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
            BenefitConfigDTO.FlatDiscountValue flatDiscountValue = objectMapper.convertValue(benefitDTO.getValue(), BenefitConfigDTO.FlatDiscountValue.class);

            // Same routing as PercentageDiscountHandler: only a referee on a non-trial plan is
            // discounted at this checkout.
            boolean atCheckout = referralRewardService.routeDiscountBenefit(
                    referralMapping, referrer.getId(), instituteId, beneficiary, status,
                    AdminDiscountService.MODE_FLAT, flatDiscountValue.getAmount(), null);
            if (atCheckout && learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest() != null
                    && learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount() != null) {
                double discountAmount = getDiscountedAmount(learnerPackageSessionsEnrollDTO, flatDiscountValue);
                learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().setAmount(
                        learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount() - discountAmount
                );
            }

            // If the benefit is active, send a notification email.
            if (status.equalsIgnoreCase(ReferralStatusEnum.ACTIVE.name())) {
                boolean isForReferee = beneficiary.equalsIgnoreCase(ReferralBenefitLogsBeneficiary.REFEREE.name());
                multiChannelDeliveryService.sendReferralNotification(
                        referrer,
                        refereeUser,
                        flatDiscountValue,
                        ReferralBenefitType.FLAT_DISCOUNT,
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
                    ReferralBenefitType.FLAT_DISCOUNT.name(),
                    beneficiary,
                    objectMapper.writeValueAsString(flatDiscountValue), // Log benefit details as JSON
                    status
            );
        } catch (Exception e) {
            throw new RuntimeException("Failed to process flat discount benefit", e);
        }
    }

    private double getDiscountedAmount(LearnerPackageSessionsEnrollDTO learnerPackageSessionsEnrollDTO, BenefitConfigDTO.FlatDiscountValue flatDiscountValue) {
        double amount = learnerPackageSessionsEnrollDTO.getPaymentInitiationRequest().getAmount();
        return Math.min(amount, flatDiscountValue.getAmount());
    }
}