package vacademy.io.admin_core_service.features.product_config.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ProductPaidWelcomeServiceTest {

    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    InternalClientUtils hmac = mock(InternalClientUtils.class);
    ProductPaidWelcomeService service = new ProductPaidWelcomeService(jdbc);

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(service, "internalClientUtils", hmac);
        ReflectionTestUtils.setField(service, "clientName", "admin_core_service");
        ReflectionTestUtils.setField(service, "authServerBaseUrl", "http://auth");
    }

    @Test
    void aPaidBuyAccountBecomesProdAndGetsItsLoginMailOnce() {
        when(jdbc.queryForList(anyString(), eq(String.class), eq("inst-1"), eq("LEAD")))
                .thenReturn(List.of("Evalezy"));
        when(jdbc.update(anyString(), eq("PROD"), eq("inst-1"), eq("LEAD"))).thenReturn(1).thenReturn(0);

        assertTrue(service.onPlanPaid("inst-1"));
        assertFalse(service.onPlanPaid("inst-1"), "the webhook and the reconcile job: one mail");

        verify(hmac, times(1)).makeHmacRequest(eq("admin_core_service"), eq("POST"), eq("http://auth"),
                eq("/auth-service/internal/v1/self-signup/evalezy/paid-welcome?instituteId=inst-1"), isNull());
    }

    @Test
    void anAccountThatIsNotWaitingForPaymentIsLeftAlone() {
        when(jdbc.queryForList(anyString(), eq(String.class), eq("inst-2"), eq("LEAD"))).thenReturn(List.of());
        assertFalse(service.onPlanPaid("inst-2"));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
        verifyNoInteractions(hmac);
    }

    @Test
    void aVacademyInstituteIsLeftAlone() {
        when(jdbc.queryForList(anyString(), eq(String.class), eq("inst-3"), eq("LEAD")))
                .thenReturn(List.of("vacademy"));
        assertFalse(service.onPlanPaid("inst-3"));
        verifyNoInteractions(hmac);
    }

    @Test
    void aFailureNeverReachesThePayment() {
        when(jdbc.queryForList(anyString(), eq(String.class), eq("inst-4"), eq("LEAD")))
                .thenThrow(new RuntimeException("db down"));
        assertFalse(service.onPlanPaid("inst-4"));
    }
}
