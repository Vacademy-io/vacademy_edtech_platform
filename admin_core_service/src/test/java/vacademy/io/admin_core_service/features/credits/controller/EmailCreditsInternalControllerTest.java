package vacademy.io.admin_core_service.features.credits.controller;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;

import java.math.BigDecimal;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EmailCreditsInternalControllerTest {

    private final CreditClient credits = mock(CreditClient.class);
    private final EmailCreditsInternalController controller = new EmailCreditsInternalController(credits);

    @Test
    void chargesThePrecomputedAmountUnderTheEmailUseCase() {
        when(credits.deductPrecomputed(anyString(), anyString(), anyString(), any(), anyString(), any()))
                .thenReturn(true);

        var response = controller.charge(new EmailCreditsInternalController.ChargeRequest(
                "inst-1", new BigDecimal("1.20"), 30L, "2026-11", "email:inst-1:2026-11:0-30"));

        assertEquals(true, response.getBody().get("charged"));
        ArgumentCaptor<MeteringFields> metering = ArgumentCaptor.forClass(MeteringFields.class);
        verify(credits).deductPrecomputed(eq("inst-1"), eq("email"), contains("30 beyond"),
                eq(new BigDecimal("1.20")), eq("email:inst-1:2026-11:0-30"), metering.capture());
        assertEquals("email_send", metering.getValue().useCase());
        assertEquals(30L, metering.getValue().usageContext().get("units"));
    }

    @Test
    void refusesWhatCannotBeAnEmailCharge() {
        assertEquals(400, controller.charge(null).getStatusCode().value());
        assertEquals(400, controller.charge(new EmailCreditsInternalController.ChargeRequest(
                "inst-1", BigDecimal.ZERO, 0L, "2026-11", "email:x")).getStatusCode().value());
        assertEquals(400, controller.charge(new EmailCreditsInternalController.ChargeRequest(
                "inst-1", new BigDecimal("1"), 25L, "2026-11", "voice_call:1")).getStatusCode().value());
        assertEquals(400, controller.charge(new EmailCreditsInternalController.ChargeRequest(
                "inst-1", new BigDecimal("10000.01"), 1L, "2026-11", "email:x")).getStatusCode().value());
        verifyNoInteractions(credits);
    }

    @Test
    void anUnreadableBalanceIsNullNotZero() {
        when(credits.readBalance("inst-1")).thenReturn(Optional.empty());
        when(credits.readBalance("inst-2")).thenReturn(Optional.of(12.5));

        assertNull(controller.balance("inst-1").getBody().get("balance"));
        assertEquals(0, new BigDecimal("12.5").compareTo((BigDecimal) controller.balance("inst-2").getBody().get("balance")));
    }
}
