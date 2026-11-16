package vacademy.io.admin_core_service.features.stock_hold.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The public release call: the token form, and the old form during and after the grace cycle. */
class StockHoldReleaseTokenTest {

    private StockHoldService service;
    private StockHoldReleaseController controller;

    @BeforeEach
    void setUp() {
        service = mock(StockHoldService.class);
        controller = new StockHoldReleaseController(service);
    }

    @Test
    void theTokenFormGoesToTheTokenCheck() {
        when(service.releaseForOrderWithToken("log-1", "tok")).thenReturn(2);

        assertEquals(2, controller.release(null, "{\"paymentLogId\":\"log-1\",\"releaseToken\":\"tok\"}")
                .getBody().get("released"));
        assertEquals(2, controller.release(null, "{\"payment_log_id\":\"log-1\",\"release_token\":\"tok\"}")
                .getBody().get("released"));

        verify(service, never()).releaseForOrderLegacyForm(anyString());
        verify(service, never()).releaseForOrder(anyString());
    }

    @Test
    void afterTheGraceCycleAReleaseWithoutATokenIsRefused() {
        controller.setLegacyFormEnabled(false);

        assertThrows(ForbiddenException.class, () -> controller.release("log-1", null));
        assertThrows(ForbiddenException.class, () -> controller.release(null, "{\"paymentLogId\":\"log-1\"}"));

        verify(service, never()).releaseForOrderLegacyForm(anyString());
        verify(service, never()).releaseForOrder(anyString());
    }

    @Test
    void duringTheGraceCycleTheOldFormUsesTheRestrictedReleaseNeverThePlainOne() {
        when(service.releaseForOrderLegacyForm("log-1")).thenReturn(1);

        assertEquals(1, controller.release(" log-1 ", "").getBody().get("released"));

        verify(service).releaseForOrderLegacyForm("log-1");
        verify(service, never()).releaseForOrder(anyString());
    }

    @Test
    void anEmptyCallOrABrokenBodyIsABadRequest() {
        assertThrows(InvalidRequestException.class, () -> controller.release(null, null));
        assertThrows(InvalidRequestException.class, () -> controller.release(null, "{not json"));
        assertThrows(InvalidRequestException.class, () -> controller.release(null, "{\"releaseToken\":\"tok\"}"));
    }
}
