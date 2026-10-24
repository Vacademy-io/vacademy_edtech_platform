package vacademy.io.admin_core_service.features.institute.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentOptionDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionSource;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionTag;
import vacademy.io.admin_core_service.features.user_subscription.enums.PaymentOptionType;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentOptionService;

import java.util.List;

@Service
public class InstituteDefaultUserSubscriptionService {

    @Autowired
    private PaymentOptionService paymentOptionService;

    public void createDefaultPaymentOption(String instituteId) {
        PaymentOptionDTO paymentOptionDTO = PaymentOptionDTO.builder()
                .name("Institute Payment Option")
                .status(StatusEnum.ACTIVE.name())
                .source(PaymentOptionSource.INSTITUTE.name())
                .sourceId(instituteId)
                .tag(PaymentOptionTag.DEFAULT.name())
                .type(PaymentOptionType.FREE.name())
                .requireApproval(false)
                .build();
        PaymentPlanDTO paymentPlanDTO = PaymentPlanDTO.builder()
            .name("Default Plan")
            .status(StatusEnum.ACTIVE.name())
            .validityInDays(365)
            .actualPrice(0.0)
            .elevatedPrice(0.0)
            .currency("INR")
            .description("Default free payment plan")
            .featureJson("{}")
            .referralOption(null)
            .build();
        paymentOptionDTO.setPaymentPlans(List.of(paymentPlanDTO));

        // System-seeded on institute creation: there is no admin to credit as creator.
        paymentOptionService.savePaymentOption(paymentOptionDTO, null);
    }
}
