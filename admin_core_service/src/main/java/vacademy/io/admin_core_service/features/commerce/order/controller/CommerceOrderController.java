package vacademy.io.admin_core_service.features.commerce.order.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Set;

/**
 * The order list and one order for staff ({@code /commerce/v1/orders}).
 * Read only: the moves of the order desk (pack, ship, cancel, receipts) come later. Manager,
 * warehouse staff and accountant may read; the institute is the one the guard checked.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/orders")
@RequiredArgsConstructor
public class CommerceOrderController {

    private static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF,
            CommerceRole.ACCOUNTANT);

    private final CommerceAccessGuard accessGuard;
    private final CommerceOrderQueryService queryService;

    @GetMapping
    public ResponseEntity<StaffOrderDtos.StaffOrderPage> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "pageSize", defaultValue = "20") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        try {
            return ResponseEntity.ok(queryService.staffList(instituteId, status, search, page, pageSize));
        } catch (CheckoutException e) {
            throw new VacademyException(e.getStatus(), e.getMessage());
        }
    }

    @GetMapping("/{orderId}")
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> detail(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        try {
            return ResponseEntity.ok(queryService.staffDetail(instituteId, orderId));
        } catch (CheckoutException e) {
            throw new VacademyException(e.getStatus() == null ? HttpStatus.BAD_REQUEST : e.getStatus(),
                    e.getMessage());
        }
    }
}
