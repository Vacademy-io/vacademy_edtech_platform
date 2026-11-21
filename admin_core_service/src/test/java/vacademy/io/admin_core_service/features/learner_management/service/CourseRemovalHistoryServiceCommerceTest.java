package vacademy.io.admin_core_service.features.learner_management.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.common.CommercePlans;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceVariantRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentDeletionService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CourseRemovalHistoryServiceCommerceTest {

    @Test
    void refusesAShopOrderLineBeforeAnythingIsTerminatedOrDeleted() {
        CommerceVariantRepository inviteSessions =
                mock(CommerceVariantRepository.class);
        when(inviteSessions.countVariantsOnInvite("inv-product")).thenReturn(1L);
        UserPlanService userPlanService = mock(UserPlanService.class);
        PaymentDeletionService paymentDeletionService = mock(PaymentDeletionService.class);
        UserPlan product = new UserPlan();
        product.setId("plan-product");
        product.setEnrollInviteId("inv-product");
        when(userPlanService.findById("plan-product")).thenReturn(product);
        CourseRemovalHistoryService service = new CourseRemovalHistoryService(
                userPlanService, paymentDeletionService, new CommercePlans(inviteSessions));

        VacademyException refused = assertThrows(VacademyException.class,
                () -> service.terminateAndDeleteHistory(List.of("plan-product"), "inst-1", "admin-1"));

        assertEquals(400, refused.getStatus().value());
        verify(userPlanService, never()).cancelUserPlan(anyString(), anyBoolean());
        verifyNoInteractions(paymentDeletionService);
    }
}
