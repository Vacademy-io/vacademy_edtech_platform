package vacademy.io.admin_core_service.features.commerce.order.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentException;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentExceptionRepository;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The staff list of money that could not be used: guarded, scoped to the institute, audited. */
class CommercePaymentExceptionControllerTest {

    private static final Set<CommerceRole> ROLES = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    private CommerceAccessGuard guard;
    private CommercePaymentExceptionRepository exceptions;
    private CommerceAuditService audit;
    private CommercePaymentExceptionController controller;
    private final CustomUserDetails user = mock(CustomUserDetails.class);

    @BeforeEach
    void setUp() {
        guard = mock(CommerceAccessGuard.class);
        exceptions = mock(CommercePaymentExceptionRepository.class);
        audit = mock(CommerceAuditService.class);
        controller = new CommercePaymentExceptionController(guard, exceptions, audit, new ObjectMapper());
        when(user.getUserId()).thenReturn("staff-1");
    }

    private static CommercePaymentException row() {
        CommercePaymentException row = new CommercePaymentException();
        row.setId("ex-1");
        row.setInstituteId("inst-1");
        row.setCommerceOrderId("order-1");
        row.setOrderNumber("ORD-000007");
        row.setKind("DUPLICATE_PAYMENT");
        row.setGatewayOrderId("order_rzp2");
        row.setGatewayPaymentId("pay_second");
        row.setAmount(new BigDecimal("499.00"));
        row.setCurrency("INR");
        return row;
    }

    @Test
    void openEntriesOfTheInstituteAreListedAfterTheGuard() {
        when(exceptions.findByInstituteIdAndStatusOrderByCreatedAtDesc(eq("inst-1"), eq("OPEN"), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(row())));

        CommercePaymentExceptionController.RowPage page = controller.list("inst-1", "open", 0, 500, user).getBody();

        verify(guard).require(user, "inst-1", CommerceFeature.ORDERS, ROLES);
        assertEquals(1, page.getTotal());
        assertEquals(50, page.getPageSize());
        CommercePaymentExceptionController.Row first = page.getExceptions().get(0);
        assertEquals("ORD-000007", first.getOrderNumber());
        assertEquals("DUPLICATE_PAYMENT", first.getKind());
        assertEquals("pay_second", first.getGatewayPaymentId());
        assertEquals(new BigDecimal("499.00"), first.getAmount());
    }

    @Test
    void anOversoldEntryHasNoPaymentId_andAnUnknownStatusIsRefused() {
        CommercePaymentException oversold = row();
        oversold.setKind("OVERSOLD_PAID");
        oversold.setGatewayPaymentId("");
        when(exceptions.findByInstituteIdOrderByCreatedAtDesc(eq("inst-1"), any(Pageable.class)))
                .thenReturn(new PageImpl<>(List.of(oversold)));

        assertNull(controller.list("inst-1", "ALL", 0, 20, user).getBody().getExceptions().get(0)
                .getGatewayPaymentId());
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class,
                () -> controller.list("inst-1", "DONE", 0, 20, user)).getStatus());
    }

    @Test
    void anEntryIsClosedWithANoteForItsOwnInstituteOnlyAndTheCloseIsAudited() {
        when(exceptions.resolve(eq("ex-1"), eq("inst-1"), eq("staff-1"), eq("refund rfnd_1"), any())).thenReturn(1);

        controller.resolve("ex-1", "inst-1", Map.of("note", " refund rfnd_1 "), user);

        verify(guard).require(user, "inst-1", CommerceFeature.ORDERS, ROLES);
        verify(audit).record(eq("inst-1"), eq("staff-1"), eq("PAYMENT_EXCEPTION_RESOLVED"),
                eq("PAYMENT_EXCEPTION"), eq("ex-1"), anyString());
    }

    @Test
    void closingNeedsANote_andAnEntryOfAnotherInstituteOrAClosedOneIsNotFound() {
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(VacademyException.class,
                () -> controller.resolve("ex-1", "inst-1", Map.of(), user)).getStatus());
        verify(exceptions, never()).resolve(any(), any(), any(), any(), any());

        when(exceptions.resolve(eq("ex-1"), eq("inst-2"), any(), any(), any())).thenReturn(0);
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(VacademyException.class,
                () -> controller.resolve("ex-1", "inst-2", Map.of("note", "x"), user)).getStatus());
        verifyNoInteractions(audit);
    }

    @Test
    void aCallerTheGuardRefusesSeesAndClosesNothing() {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, "no"))
                .when(guard).require(eq(user), eq("inst-1"), eq(CommerceFeature.ORDERS), any());

        assertThrows(CommerceAccessDeniedException.class, () -> controller.list("inst-1", "OPEN", 0, 20, user));
        assertThrows(CommerceAccessDeniedException.class,
                () -> controller.resolve("ex-1", "inst-1", Map.of("note", "x"), user));
        verifyNoInteractions(exceptions, audit);
    }
}
