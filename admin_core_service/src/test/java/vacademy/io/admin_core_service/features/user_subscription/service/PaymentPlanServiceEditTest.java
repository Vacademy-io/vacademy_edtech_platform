package vacademy.io.admin_core_service.features.user_subscription.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.user_subscription.dto.PaymentPlanDTO;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Editing a single-plan option (FREE / DONATION / ONE_TIME) from Settings resends its
 * one plan without an id. That must update the stored plan, not retire it and mint a
 * new one — every user_plan already on it points at the stored id.
 */
@ExtendWith(MockitoExtension.class)
class PaymentPlanServiceEditTest {

    @Mock
    private PaymentPlanRepository paymentPlanRepository;

    @InjectMocks
    private PaymentPlanService service;

    private static PaymentPlan plan(String id, String name, Double price) {
        PaymentPlan plan = new PaymentPlan();
        plan.setId(id);
        plan.setName(name);
        plan.setStatus("ACTIVE");
        plan.setActualPrice(price);
        return plan;
    }

    @Test
    @DisplayName("one stored plan + one id-less resent plan = update in place, nothing retired")
    void singleIdlessPlanUpdatesTheStoredOne() {
        PaymentOption option = new PaymentOption();
        option.setId("po-1");
        PaymentPlan stored = plan("pp-1", "Old", 100.0);
        List<PaymentPlan> existing = new ArrayList<>(List.of(stored));
        PaymentPlanDTO resent = PaymentPlanDTO.builder().name("New").actualPrice(150.0).status("ACTIVE").build();

        List<PaymentPlan> result = service.editPaymentPlans(existing, new ArrayList<>(List.of(resent)), option);

        assertEquals(1, result.size());
        assertSame(stored, result.get(0));
        assertEquals("pp-1", result.get(0).getId());
        assertEquals("New", stored.getName());
        assertEquals(150.0, stored.getActualPrice());
        assertEquals("ACTIVE", stored.getStatus());
        verify(paymentPlanRepository, never()).saveAll(anyList());
    }

    @Test
    @DisplayName("full payload: a null validity is 'no expiry' and clears the stored window")
    void fullPayloadWritesNullValidity() {
        PaymentOption option = new PaymentOption();
        PaymentPlan stored = plan("pp-1", "Free", 0.0);
        stored.setValidityInDays(30);
        PaymentPlanDTO unlimited = PaymentPlanDTO.builder().name("Free").status("ACTIVE").validityInDays(null).build();

        service.editPaymentPlans(new ArrayList<>(List.of(stored)), new ArrayList<>(List.of(unlimited)), option, true);

        assertNull(stored.getValidityInDays(), "Limited -> Unlimited must actually drop the 30-day window");
    }

    @Test
    @DisplayName("partial payload (PUT dialog): a null validity means 'not sent' and keeps the stored window")
    void partialPayloadKeepsValidity() {
        PaymentOption option = new PaymentOption();
        PaymentPlan stored = plan("pp-1", "Annual", 100.0);
        stored.setValidityInDays(365);
        PaymentPlanDTO partial = PaymentPlanDTO.builder().id("pp-1").actualPrice(120.0).build();

        service.editPaymentPlans(new ArrayList<>(List.of(stored)), new ArrayList<>(List.of(partial)), option);

        assertEquals(365, stored.getValidityInDays());
        assertEquals(120.0, stored.getActualPrice());
        assertEquals("Annual", stored.getName(), "fields the dialog did not send are untouched");
    }

    @Test
    @DisplayName("several stored plans + an id-less plan still replaces: no positional guess for ladders")
    void multiplePlansAreNotGuessed() {
        PaymentOption option = new PaymentOption();
        PaymentPlan monthly = plan("pp-m", "Monthly", 10.0);
        PaymentPlan yearly = plan("pp-y", "Yearly", 100.0);
        List<PaymentPlan> existing = new ArrayList<>(List.of(monthly, yearly));
        PaymentPlanDTO resent = PaymentPlanDTO.builder().name("Lifetime").actualPrice(500.0).status("ACTIVE").build();

        List<PaymentPlan> result = service.editPaymentPlans(existing, new ArrayList<>(List.of(resent)), option);

        assertEquals(1, result.size());
        assertNull(result.get(0).getId(), "a genuinely new plan gets a generated id");
        assertEquals("DELETED", monthly.getStatus());
        assertEquals("DELETED", yearly.getStatus());
        verify(paymentPlanRepository).saveAll(List.of(monthly, yearly));
    }
}
