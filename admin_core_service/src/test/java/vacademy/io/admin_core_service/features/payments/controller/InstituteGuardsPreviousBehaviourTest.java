package vacademy.io.admin_core_service.features.payments.controller;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
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
import vacademy.io.admin_core_service.features.user_subscription.controller.UserPlanController;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentVoidService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * security.institute-guards.enforce off (the default): payment gateway, invoice and payment-log
 * routes decide exactly as before (validateUserAccess / requireAdminAccess, root flag passes;
 * mark-paid has no check) and only log INSTITUTE_GUARD_WOULD_REFUSE where the staff/admin
 * check would refuse.
 */
class InstituteGuardsPreviousBehaviourTest {

    private static final String INSTITUTE = "inst-1";

    private final InstituteAccessValidator validator = new InstituteAccessValidator();

    private InstitutePaymentGatewayMappingService gatewayService;
    private InstitutePaymentGatewayAdminController gatewayController;
    private InvoiceService invoiceService;
    private InvoiceController invoiceController;
    private PaymentVoidService voidService;
    private UserPlanController userPlanController;
    private ListAppender<ILoggingEvent> logs;

    @BeforeEach
    void setUp() {
        clientIdHeader(INSTITUTE);
        assertFalse(validator.isInstituteGuardsEnforced());

        gatewayService = mock(InstitutePaymentGatewayMappingService.class);
        gatewayController = new InstitutePaymentGatewayAdminController(gatewayService, validator);

        invoiceService = mock(InvoiceService.class);
        when(invoiceService.getInvoiceInstituteId("inv-1")).thenReturn(INSTITUTE);
        when(invoiceService.getInvoiceInstituteId("inv-missing"))
                .thenThrow(new VacademyException("Invoice not found: inv-missing"));
        invoiceController = new InvoiceController();
        ReflectionTestUtils.setField(invoiceController, "invoiceService", invoiceService);
        ReflectionTestUtils.setField(invoiceController, "instituteAccessValidator", validator);

        voidService = mock(PaymentVoidService.class);
        userPlanController = new UserPlanController();
        ReflectionTestUtils.setField(userPlanController, "paymentVoidService", voidService);
        ReflectionTestUtils.setField(userPlanController, "instituteAccessValidator", validator);

        logs = new ListAppender<>();
        logs.start();
        ((Logger) LoggerFactory.getLogger(InstituteAccessValidator.class)).addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        ((Logger) LoggerFactory.getLogger(InstituteAccessValidator.class)).detachAppender(logs);
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

    private List<String> wouldRefuseLines() {
        return logs.list.stream().map(ILoggingEvent::getFormattedMessage)
                .filter(m -> m.startsWith("INSTITUTE_GUARD_WOULD_REFUSE")).toList();
    }

    @Test
    @DisplayName("staff of the institute: allowed, nothing logged")
    void staffAllowedQuietly() {
        assertDoesNotThrow(() -> gatewayController.list(principal("u-1", false, "TEACHER"), INSTITUTE));
        assertDoesNotThrow(() -> userPlanController.voidPayment("pl-1", INSTITUTE, null,
                principal("u-1", false, "ADMIN")));
        assertTrue(wouldRefuseLines().isEmpty());
    }

    @Test
    @DisplayName("root-flag learner: allowed as before; the staff check's refusal is logged")
    void rootLearnerAllowedAndLogged() {
        assertDoesNotThrow(() -> gatewayController.list(principal("u-3", true, "STUDENT"), INSTITUTE));
        assertDoesNotThrow(() -> userPlanController.voidPayment("pl-1", INSTITUTE, null,
                principal("u-3", true, "STUDENT")));
        verify(voidService).voidPayment(any(), any(), any(), any());
        assertEquals(List.of(
                "INSTITUTE_GUARD_WOULD_REFUSE route=paymentGateways.list user=u-3 institute=inst-1 reason=not_staff previous=allow",
                "INSTITUTE_GUARD_WOULD_REFUSE route=userPlans.voidPayment user=u-3 institute=inst-1 reason=not_staff previous=allow"),
                wouldRefuseLines());
    }

    @Test
    @DisplayName("root-flag account of another institute: gateway write allowed as before (requireAdminAccess), logged")
    void rootOtherInstituteGatewayWrite() {
        clientIdHeader("inst-other");
        assertDoesNotThrow(() -> gatewayController.create(principal("u-4", true, "ADMIN"), INSTITUTE,
                new PaymentGatewayMappingUpsertRequest()));
        verify(gatewayService).createMapping(any(), any());
        assertEquals(List.of(
                "INSTITUTE_GUARD_WOULD_REFUSE route=paymentGateways.create user=u-4 institute=inst-1 reason=not_member previous=allow"),
                wouldRefuseLines());
    }

    @Test
    @DisplayName("TEACHER gateway write: refused as before (requireAdminAccess), logged with previous=refuse")
    void teacherGatewayWriteStillRefused() {
        assertThrows(ForbiddenException.class, () -> gatewayController.deactivate(
                principal("u-2", false, "TEACHER"), INSTITUTE, "map-1"));
        verify(gatewayService, never()).deactivateMapping(any(), any());
        assertEquals(List.of(
                "INSTITUTE_GUARD_WOULD_REFUSE route=paymentGateways.deactivate user=u-2 institute=inst-1 reason=not_admin previous=refuse"),
                wouldRefuseLines());
    }

    @Test
    @DisplayName("non-root account of another institute: refused as before by validateUserAccess")
    void nonRootOtherInstituteStillRefused() {
        clientIdHeader("inst-other");
        assertThrows(VacademyException.class, () -> userPlanController.voidPayment("pl-1", INSTITUTE, null,
                principal("u-5", false, "ADMIN")));
        verify(voidService, never()).voidPayment(any(), any(), any(), any());
    }

    @Test
    @DisplayName("mark paid had no check: other institute, no user and unknown invoice all reach the service")
    void markPaidUnchecked() {
        clientIdHeader("inst-other");
        assertDoesNotThrow(() -> invoiceController.markInvoicePaidManually("inv-1", null,
                principal("u-4", false, "ADMIN")));
        assertDoesNotThrow(() -> invoiceController.markInvoicePaidManually("inv-1", null, null));
        assertDoesNotThrow(() -> invoiceController.markInvoicePaidManually("inv-missing", null,
                principal("u-4", false, "ADMIN")));
        verify(invoiceService, times(3)).markInvoicePaidManually(any(), any(), any());
        assertEquals(List.of(
                "INSTITUTE_GUARD_WOULD_REFUSE route=invoices.markInvoicePaidManually user=u-4 institute=inst-1 reason=not_member previous=allow",
                "INSTITUTE_GUARD_WOULD_REFUSE route=invoices.markInvoicePaidManually user=null institute=inst-1 reason=no_user previous=allow",
                "INSTITUTE_GUARD_WOULD_REFUSE route=invoices.markInvoicePaidManually user=u-4 institute=null reason=not_found previous=allow"),
                wouldRefuseLines());
    }

    @Test
    @DisplayName("enforcement on: the same root-flag learner is refused")
    void enforcedRefuses() {
        ReflectionTestUtils.setField(validator, "instituteGuardsEnforced", true);
        assertThrows(ForbiddenException.class,
                () -> gatewayController.list(principal("u-3", true, "STUDENT"), INSTITUTE));
        clientIdHeader("inst-other");
        assertThrows(ForbiddenException.class, () -> invoiceController.markInvoicePaidManually("inv-1", null,
                principal("u-4", true, "ADMIN")));
        verify(invoiceService, never()).markInvoicePaidManually(any(), any(), any());
        assertTrue(wouldRefuseLines().isEmpty());
    }
}
