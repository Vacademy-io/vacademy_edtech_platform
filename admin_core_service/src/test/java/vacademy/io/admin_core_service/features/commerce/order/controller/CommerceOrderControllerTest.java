package vacademy.io.admin_core_service.features.commerce.order.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The staff order reads sit behind the commerce guard, with the orders feature and three roles;
 * the list passes every desk filter through; the detail carries the caller's roles for its next
 * actions; a new staff order answers 201, a repeat of one 200.
 */
class CommerceOrderControllerTest {

    private static final Set<CommerceRole> READERS = Set.of(CommerceRole.STORE_MANAGER,
            CommerceRole.WAREHOUSE_STAFF, CommerceRole.ACCOUNTANT);

    private CommerceAccessGuard guard;
    private CommerceOrderQueryService queryService;
    private CommerceStaffOrderService staffOrderService;
    private CommerceOrderController controller;
    private final CustomUserDetails user = mock(CustomUserDetails.class);

    @BeforeEach
    void setUp() {
        guard = mock(CommerceAccessGuard.class);
        queryService = mock(CommerceOrderQueryService.class);
        staffOrderService = mock(CommerceStaffOrderService.class);
        controller = new CommerceOrderController(guard, queryService, staffOrderService);
        List<GrantedAuthority> roles = List.of(new SimpleGrantedAuthority("COMMERCE_WAREHOUSE_STAFF"));
        when(user.getAuthorities()).thenAnswer(call -> roles);
    }

    @Test
    void theListAndTheDetailAreReadAfterTheGuard() {
        StaffOrderDtos.StaffOrderPage page = StaffOrderDtos.StaffOrderPage.builder().total(0).build();
        StaffOrderDtos.StaffOrderDetail detail = StaffOrderDtos.StaffOrderDetail.builder().build();
        CommerceOrderQueryService.StaffListFilter filter = new CommerceOrderQueryService.StaffListFilter("CONFIRMED",
                "COD", "UNPAID", "ONLINE", "TO_PACK", "ORD-000007", LocalDate.of(2026, 11, 1),
                LocalDate.of(2026, 11, 16));
        when(queryService.staffList("inst-1", filter, 2, 10)).thenReturn(page);
        when(queryService.staffDetail("inst-1", "order-1", Set.of(CommerceRole.WAREHOUSE_STAFF), false, false))
                .thenReturn(detail);

        assertSame(page, controller.list("inst-1", "CONFIRMED", "COD", "UNPAID", "ONLINE", "TO_PACK", "ORD-000007",
                LocalDate.of(2026, 11, 1), LocalDate.of(2026, 11, 16), 2, 10, user).getBody());
        assertSame(detail, controller.detail("order-1", "inst-1", user).getBody());

        verify(guard, org.mockito.Mockito.times(2)).require(user, "inst-1", CommerceFeature.ORDERS, READERS);
    }

    @Test
    void aCallerTheGuardRefusesReadsNothing() {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, "no"))
                .when(guard).require(eq(user), eq("inst-1"), eq(CommerceFeature.ORDERS), any());
        assertThrows(CommerceAccessDeniedException.class,
                () -> controller.list("inst-1", null, null, null, null, null, null, null, null, 0, 20, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.detail("order-1", "inst-1", user));
        verifyNoInteractions(queryService);
    }

    @Test
    void aNewStaffOrderIs201AndARepeatOfOneIs200() {
        StaffOrderRequest request = StaffOrderRequest.builder().clientRequestId("staff-order-1").build();
        StaffOrderDtos.StaffOrderDetail detail = StaffOrderDtos.StaffOrderDetail.builder().build();
        when(staffOrderService.create(user, "inst-1", request))
                .thenReturn(new CommerceStaffOrderService.Created(detail, false))
                .thenReturn(new CommerceStaffOrderService.Created(detail, true));
        ResponseEntity<StaffOrderDtos.StaffOrderDetail> created = controller.create("inst-1", request, user);
        assertEquals(HttpStatus.CREATED, created.getStatusCode());
        assertSame(detail, created.getBody());
        assertEquals(HttpStatus.OK, controller.create("inst-1", request, user).getStatusCode());
        verifyNoInteractions(queryService);
        verify(guard, org.mockito.Mockito.never()).require(any(), any(), any(), any());
    }
}
