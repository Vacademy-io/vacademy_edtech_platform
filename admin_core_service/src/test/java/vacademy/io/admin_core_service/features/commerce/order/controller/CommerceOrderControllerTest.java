package vacademy.io.admin_core_service.features.commerce.order.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The staff order reads sit behind the commerce guard, with the orders feature and three roles. */
class CommerceOrderControllerTest {

    private static final Set<CommerceRole> READERS = Set.of(CommerceRole.STORE_MANAGER,
            CommerceRole.WAREHOUSE_STAFF, CommerceRole.ACCOUNTANT);

    private CommerceAccessGuard guard;
    private CommerceOrderQueryService queryService;
    private CommerceOrderController controller;
    private final CustomUserDetails user = mock(CustomUserDetails.class);

    @BeforeEach
    void setUp() {
        guard = mock(CommerceAccessGuard.class);
        queryService = mock(CommerceOrderQueryService.class);
        controller = new CommerceOrderController(guard, queryService);
    }

    @Test
    void theListAndTheDetailAreReadAfterTheGuard() {
        StaffOrderDtos.StaffOrderPage page = StaffOrderDtos.StaffOrderPage.builder().total(0).build();
        StaffOrderDtos.StaffOrderDetail detail = StaffOrderDtos.StaffOrderDetail.builder().build();
        when(queryService.staffList("inst-1", "CONFIRMED", "ORD-000007", 2, 10)).thenReturn(page);
        when(queryService.staffDetail("inst-1", "order-1")).thenReturn(detail);

        assertSame(page, controller.list("inst-1", "CONFIRMED", "ORD-000007", 2, 10, user).getBody());
        assertSame(detail, controller.detail("order-1", "inst-1", user).getBody());

        verify(guard, org.mockito.Mockito.times(2)).require(user, "inst-1", CommerceFeature.ORDERS, READERS);
    }

    @Test
    void aCallerTheGuardRefusesReadsNothing() {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.ROLE_NOT_ALLOWED, "no"))
                .when(guard).require(eq(user), eq("inst-1"), eq(CommerceFeature.ORDERS), any());
        assertThrows(CommerceAccessDeniedException.class,
                () -> controller.list("inst-1", null, null, 0, 20, user));
        assertThrows(CommerceAccessDeniedException.class, () -> controller.detail("order-1", "inst-1", user));
        verifyNoInteractions(queryService);
    }
}
