package vacademy.io.admin_core_service.features.invoice.controller;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceDTO;
import vacademy.io.admin_core_service.features.invoice.service.InvoiceService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Invoice reads: the institute list and invoice-by-id follow security.institute-guards.enforce
 * (off: answered as before, would-be refusals logged); the /test/ routes need a platform super
 * admin whatever the flag says.
 */
class InvoiceReadRoutesTest {

    private static final String INSTITUTE = "inst-1";

    private final InstituteAccessValidator validator = new InstituteAccessValidator();
    private InvoiceService invoiceService;
    private InvoiceController controller;
    private ListAppender<ILoggingEvent> logs;

    @BeforeEach
    void setUp() {
        invoiceService = mock(InvoiceService.class);
        InvoiceDTO invoice = new InvoiceDTO();
        invoice.setInstituteId(INSTITUTE);
        when(invoiceService.getInvoiceById("inv-1")).thenReturn(invoice);
        controller = new InvoiceController();
        ReflectionTestUtils.setField(controller, "invoiceService", invoiceService);
        ReflectionTestUtils.setField(controller, "instituteAccessValidator", validator);
        clientId(INSTITUTE);
        logs = new ListAppender<>();
        logs.start();
        ((Logger) LoggerFactory.getLogger(InstituteAccessValidator.class)).addAppender(logs);
    }

    @AfterEach
    void tearDown() {
        ((Logger) LoggerFactory.getLogger(InstituteAccessValidator.class)).detachAppender(logs);
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientId(String id) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (id != null) {
            request.addHeader("clientId", id);
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

    private long wouldRefuseCount() {
        return logs.list.stream().filter(e -> e.getFormattedMessage().startsWith("INSTITUTE_GUARD_WOULD_REFUSE")).count();
    }

    @Test
    void notEnforced_readsAnswerAsBeforeAndLog() {
        clientId("inst-2");
        // The institute list had no check.
        assertDoesNotThrow(() -> controller.getInvoicesByInstitute(INSTITUTE, 0, 20, null, null, null, null,
                principal("u-2", false, "ADMIN")));
        // Invoice by id kept validateUserAccess: the root flag passes, a non-root outsider does not.
        assertDoesNotThrow(() -> controller.getInvoice("inv-1", principal("u-3", true, "ADMIN")));
        assertThrows(VacademyException.class, () -> controller.getInvoice("inv-1", principal("u-4", false, "ADMIN")));
        assertEquals(3, wouldRefuseCount());
    }

    @Test
    void enforced_onlyStaffOfTheInstitute() {
        ReflectionTestUtils.setField(validator, "instituteGuardsEnforced", true);
        assertDoesNotThrow(() -> controller.getInvoicesByInstitute(INSTITUTE, 0, 20, null, null, null, null,
                principal("u-1", false, "TEACHER")));
        assertDoesNotThrow(() -> controller.getInvoice("inv-1", principal("u-1", false, "ADMIN")));
        assertThrows(ForbiddenException.class, () -> controller.getInvoice("inv-1", principal("u-5", true, "STUDENT")));
        clientId("inst-2");
        assertThrows(ForbiddenException.class, () -> controller.getInvoicesByInstitute(INSTITUTE, 0, 20, null, null,
                null, null, principal("u-3", true, "ADMIN")));
        verify(invoiceService, org.mockito.Mockito.times(1))
                .getInvoicesByInstituteId(anyString(), any(), any(), any(), any(), anyInt(), anyInt());
    }

    @Test
    void testRoutesNeedSignInAndASuperAdmin() {
        // Sign-in for these paths is covered in ApplicantRoutesSignInTest (ALLOWED_PATHS).
        // SUPER_ADMIN_USER_IDS is unset in tests, so nobody passes; an institute admin with the
        // root flag is refused before anything is generated.
        CustomUserDetails admin = principal("u-1", true, "ADMIN");
        assertThrows(VacademyException.class, () -> controller.testGenerateInvoice("pl-1", admin));
        assertThrows(VacademyException.class, () -> controller.testGenerateInvoiceMultiPackage("o-1", admin));
        assertThrows(VacademyException.class, () -> controller.testGenerateInvoiceSingle("pl-1", null));
        verify(invoiceService, never()).testGenerateInvoice(anyString());
        verify(invoiceService, never()).testGenerateInvoiceForMultiPackage(anyString());
        verify(invoiceService, never()).testGenerateInvoiceSingle(anyString());
    }
}
