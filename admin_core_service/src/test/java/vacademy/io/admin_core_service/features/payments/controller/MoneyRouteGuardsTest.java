package vacademy.io.admin_core_service.features.payments.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.institute.controller.InstitutePaymentGatewayAdminController;
import vacademy.io.admin_core_service.features.institute.dto.PaymentGatewayMappingUpsertRequest;
import vacademy.io.admin_core_service.features.institute.service.InstitutePaymentGatewayMappingService;
import vacademy.io.admin_core_service.features.invoice.controller.InvoiceController;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.admin_core_service.features.payments.service.CashfreeWebHookService;
import vacademy.io.admin_core_service.features.payments.service.WebHookService;
import vacademy.io.admin_core_service.features.user_subscription.controller.UserPlanController;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentVoidService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.util.SuperAdminAuthUtil;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Payment gateway settings, invoice mark-paid, payment-log void and webhook reprocess:
 * staff/admin of the institute (proven by the clientId-header authorities) or an allowlisted
 * super admin; an account of another institute is refused even with the root flag.
 * With security.institute-guards.enforce on; the default (off) is covered by
 * {@link InstituteGuardsPreviousBehaviourTest}.
 */
class MoneyRouteGuardsTest {

    private static final String INSTITUTE = "inst-1";

    private final InstituteAccessValidator validator = new InstituteAccessValidator();

    private InstitutePaymentGatewayMappingService gatewayService;
    private InstitutePaymentGatewayAdminController gatewayController;

    private InvoiceService invoiceService;
    private InvoiceController invoiceController;

    private PaymentVoidService voidService;
    private UserPlanController userPlanController;

    private WebHookService webHookService;
    private CashfreeWebHookService cashfreeWebHookService;
    private WebHookController webHookController;

    @BeforeEach
    void setUp() {
        clientIdHeader(INSTITUTE);
        ReflectionTestUtils.setField(validator, "instituteGuardsEnforced", true);

        gatewayService = mock(InstitutePaymentGatewayMappingService.class);
        gatewayController = new InstitutePaymentGatewayAdminController(gatewayService, validator);

        invoiceService = mock(InvoiceService.class);
        when(invoiceService.getInvoiceInstituteId("inv-1")).thenReturn(INSTITUTE);
        invoiceController = new InvoiceController();
        ReflectionTestUtils.setField(invoiceController, "invoiceService", invoiceService);
        ReflectionTestUtils.setField(invoiceController, "instituteAccessValidator", validator);

        voidService = mock(PaymentVoidService.class);
        userPlanController = new UserPlanController();
        ReflectionTestUtils.setField(userPlanController, "paymentVoidService", voidService);
        ReflectionTestUtils.setField(userPlanController, "instituteAccessValidator", validator);

        webHookService = mock(WebHookService.class);
        cashfreeWebHookService = mock(CashfreeWebHookService.class);
        webHookController = new WebHookController();
        ReflectionTestUtils.setField(webHookController, "webHookService", webHookService);
        ReflectionTestUtils.setField(webHookController, "cashfreeWebHookService", cashfreeWebHookService);
    }

    @AfterEach
    void resetRequestContext() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientIdHeader(String clientId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (clientId != null) {
            request.addHeader("clientId", clientId);
        }
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails principal(String userId, boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId(userId);
        dto.setUsername(userId);
        dto.setFullName("Test User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    /** Puts {@code userId} on the allowlist for the duration of the returned scope. */
    private static MockedStatic<SuperAdminAuthUtil> allowlist(String userId) {
        MockedStatic<SuperAdminAuthUtil> util = mockStatic(SuperAdminAuthUtil.class);
        util.when(() -> SuperAdminAuthUtil.isSuperAdminUserId(anyString()))
                .thenAnswer(inv -> userId.equals(inv.getArgument(0)));
        util.when(() -> SuperAdminAuthUtil.requireSuperAdmin(any())).thenAnswer(inv -> {
            CustomUserDetails user = inv.getArgument(0);
            if (user == null || !userId.equals(user.getUserId())) {
                throw new VacademyException("Super admin access required");
            }
            return null;
        });
        return util;
    }

    // ── Payment gateway credentials ──────────────────────────────────────────

    @Test
    @DisplayName("gateway write: institute ADMIN passes, TEACHER is refused")
    void gatewayWriteNeedsAdmin() {
        assertDoesNotThrow(() -> gatewayController.create(principal("u-1", true, "ADMIN"), INSTITUTE,
                new PaymentGatewayMappingUpsertRequest()));
        assertThrows(ForbiddenException.class, () -> gatewayController.deactivate(
                principal("u-2", false, "TEACHER"), INSTITUTE, "map-1"));
        verify(gatewayService, never()).deactivateMapping(anyString(), anyString());
    }

    @Test
    @DisplayName("gateway read: staff passes; root-flag learner and other-institute admin are refused")
    void gatewayReadNeedsStaff() {
        assertDoesNotThrow(() -> gatewayController.list(principal("u-2", false, "TEACHER"), INSTITUTE));
        assertThrows(ForbiddenException.class,
                () -> gatewayController.list(principal("u-3", true, "STUDENT"), INSTITUTE));
        clientIdHeader("inst-other");
        assertThrows(ForbiddenException.class,
                () -> gatewayController.list(principal("u-4", true, "ADMIN"), INSTITUTE));
    }

    @Test
    @DisplayName("gateway write: other-institute account with the root flag is refused")
    void gatewayWriteCrossInstituteRefused() {
        clientIdHeader("inst-other");
        assertThrows(ForbiddenException.class, () -> gatewayController.create(
                principal("u-4", true, "ADMIN"), INSTITUTE, new PaymentGatewayMappingUpsertRequest()));
        verifyNoInteractions(gatewayService);
    }

    @Test
    @DisplayName("gateway write: allowlisted super admin passes without a role there")
    void gatewayWriteSuperAdmin() {
        clientIdHeader(null);
        try (MockedStatic<SuperAdminAuthUtil> ignored = allowlist("ops-1")) {
            assertDoesNotThrow(() -> gatewayController.deactivate(principal("ops-1", false), INSTITUTE, "map-1"));
            assertThrows(ForbiddenException.class,
                    () -> gatewayController.deactivate(principal("u-9", true), INSTITUTE, "map-1"));
        }
        verify(gatewayService).deactivateMapping(INSTITUTE, "map-1");
    }

    // ── Invoice mark paid ────────────────────────────────────────────────────

    @Test
    @DisplayName("mark paid: staff of the invoice's institute passes")
    void markPaidByStaff() {
        assertDoesNotThrow(() -> invoiceController.markInvoicePaidManually("inv-1", null,
                principal("u-2", false, "TEACHER")));
        verify(invoiceService).markInvoicePaidManually(any(), any(), any());
    }

    @Test
    @DisplayName("mark paid: account of another institute (root flag) is refused before anything is written")
    void markPaidCrossInstituteRefused() {
        clientIdHeader("inst-other");
        assertThrows(ForbiddenException.class, () -> invoiceController.markInvoicePaidManually("inv-1", null,
                principal("u-4", true, "ADMIN")));
        verify(invoiceService, never()).markInvoicePaidManually(any(), any(), any());
    }

    @Test
    @DisplayName("mark paid: allowlisted super admin passes")
    void markPaidSuperAdmin() {
        clientIdHeader(null);
        try (MockedStatic<SuperAdminAuthUtil> ignored = allowlist("ops-1")) {
            assertDoesNotThrow(() -> invoiceController.markInvoicePaidManually("inv-1", null,
                    principal("ops-1", false)));
        }
    }

    // ── Payment log void ─────────────────────────────────────────────────────

    @Test
    @DisplayName("void payment: staff passes; root-flag learner and other-institute account are refused")
    void voidPaymentNeedsStaff() {
        assertDoesNotThrow(() -> userPlanController.voidPayment("pl-1", INSTITUTE, null,
                principal("u-1", true, "ADMIN")));
        assertThrows(ForbiddenException.class, () -> userPlanController.voidPayment("pl-1", INSTITUTE, null,
                principal("u-3", true, "STUDENT")));
        clientIdHeader("inst-other");
        assertThrows(ForbiddenException.class, () -> userPlanController.voidPayment("pl-1", INSTITUTE, null,
                principal("u-4", true, "ADMIN")));
        verify(voidService).voidPayment(any(), any(), any(), any());
    }

    // ── Webhook reprocess ────────────────────────────────────────────────────

    @Test
    @DisplayName("reprocess: a root-flag institute admin is refused (allowlist unset)")
    void reprocessNeedsSuperAdmin() {
        assertThrows(VacademyException.class,
                () -> webHookController.reprocessWebhook("wh-1", principal("u-1", true, "ADMIN")));
        verifyNoInteractions(webHookService, cashfreeWebHookService);
    }
}
