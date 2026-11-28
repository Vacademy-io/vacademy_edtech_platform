package vacademy.io.admin_core_service.features.ai_plans_billing.controller;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.ai_plans_billing.AiPlansBillingException;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionBillingService;
import vacademy.io.admin_core_service.features.ai_plans_billing.service.AiSubscriptionOpsService;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Every tenant endpoint checks institute ADMIN first; ops endpoints are super-admin only (fail closed). */
class AiPlansControllersTest {

    AiSubscriptionBillingService billing = mock(AiSubscriptionBillingService.class);
    InstituteAccessValidator access = mock(InstituteAccessValidator.class);
    AiPlansStorefrontController tenant = new AiPlansStorefrontController(billing, access);
    CustomUserDetails user = mock(CustomUserDetails.class);

    @Test
    void checkoutChecksAdminBeforeAnythingAndPrefersTheIdempotencyHeader() {
        when(user.getUserId()).thenReturn("u1");
        tenant.checkout(user, "hdr-key", Map.of("institute_id", "i1", "plan_version_id", "pv", "autopay", true,
                "autopay_method", "UPI", "contact", "9876543210", "return_url", "https://a/x", "idempotency_key", "body-key"));
        InOrder o = inOrder(access, billing);
        o.verify(access).requireInstituteAdmin(user, "i1");
        o.verify(billing).checkout(eq("i1"), argThat(r -> "hdr-key".equals(r.idempotencyKey()) && r.autopay()
                && "pv".equals(r.planVersionId())), eq("u1"), any());
    }

    @Test
    void aNonAdminNeverReachesTheService() {
        doThrow(new VacademyException("forbidden")).when(access).requireInstituteAdmin(user, "i1");
        assertThrows(VacademyException.class, () -> tenant.storefront(user, "i1"));
        assertThrows(VacademyException.class, () -> tenant.change(user, Map.of("institute_id", "i1", "action", "CANCEL")));
        assertThrows(VacademyException.class, () -> tenant.invoicePdf(user, "inv", "i1"));
        verifyNoInteractions(billing);
    }

    @Test
    void writesNeedAnInstitute() {
        AiPlansBillingException e = assertThrows(AiPlansBillingException.class,
                () -> tenant.saveBillingProfile(user, Map.of("legal_name", "x")));
        assertEquals(AiPlansBillingException.INVALID_REQUEST, e.getCode());
        verifyNoInteractions(access, billing);
    }

    @Test
    void opsAreSuperAdminOnlyAndFailClosed() {
        AiSubscriptionOpsService ops = mock(AiSubscriptionOpsService.class);
        AiPlansBillingOpsController c = new AiPlansBillingOpsController(ops, billing);
        when(user.getUserId()).thenReturn("u1");
        assertThrows(VacademyException.class, () -> c.refund(user, "i1", "pp", Map.of("reason", "x")));
        assertThrows(VacademyException.class, () -> c.markPaid(user, "i1", "c", Map.of("amount_minor", 1)));
        assertThrows(VacademyException.class, () -> c.documents(user, "i1"));
        assertThrows(VacademyException.class, () -> c.invoicePdf(user, "i1", "inv"));
        assertThrows(VacademyException.class, () -> c.creditNotePdf(user, "i1", "cn"));
        verifyNoInteractions(ops, billing);
    }
}
