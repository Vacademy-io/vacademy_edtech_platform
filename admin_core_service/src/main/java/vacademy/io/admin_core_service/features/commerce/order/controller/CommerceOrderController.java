package vacademy.io.admin_core_service.features.commerce.order.controller;

import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceStaffOrderService;
import vacademy.io.admin_core_service.features.commerce.order.desk.dto.StaffOrderRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDate;
import java.util.Set;

/**
 * The order list, one order, and a new staff order ({@code /commerce/v1/orders}). Manager,
 * warehouse staff and accountant may read; only a store manager creates an order. The moves of
 * the order desk are in {@code CommerceOrderDeskController} and {@code CommerceShipmentController}.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/orders")
public class CommerceOrderController {

    private static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF,
            CommerceRole.ACCOUNTANT);

    private final CommerceAccessGuard accessGuard;
    private final CommerceOrderQueryService queryService;
    private final CommerceStaffOrderService staffOrderService;

    public CommerceOrderController(CommerceAccessGuard accessGuard, CommerceOrderQueryService queryService,
                                   CommerceStaffOrderService staffOrderService) {
        this.accessGuard = accessGuard;
        this.queryService = queryService;
        this.staffOrderService = staffOrderService;
    }

    @GetMapping
    public ResponseEntity<StaffOrderDtos.StaffOrderPage> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "status", required = false) String status,
            @RequestParam(value = "payment_method", required = false) String paymentMethod,
            @RequestParam(value = "payment_status", required = false) String paymentStatus,
            @RequestParam(value = "channel", required = false) String channel,
            @RequestParam(value = "queue", required = false) String queue,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "from", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(value = "to", required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "pageSize", defaultValue = "20") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        try {
            return ResponseEntity.ok(queryService.staffList(instituteId,
                    new CommerceOrderQueryService.StaffListFilter(status, paymentMethod, paymentStatus, channel, queue,
                            search, from, to), page, pageSize));
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
            return ResponseEntity.ok(queryService.staffDetail(instituteId, orderId, CommerceAccessGuard.rolesOf(user),
                    isAdmin(user), false));
        } catch (CheckoutException e) {
            throw new VacademyException(e.getStatus() == null ? HttpStatus.BAD_REQUEST : e.getStatus(),
                    e.getMessage());
        }
    }

    /** A staff order: 201 with the new order, 200 with the order a repeat of the request made. */
    @PostMapping
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> create(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) StaffOrderRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        CommerceStaffOrderService.Created created = staffOrderService.create(user, instituteId, request);
        return ResponseEntity.status(created.replayed() ? HttpStatus.OK : HttpStatus.CREATED).body(created.detail());
    }

    private static boolean isAdmin(CustomUserDetails user) {
        if (user == null || user.getAuthorities() == null) {
            return false;
        }
        return user.getAuthorities().stream().anyMatch(a -> a != null && a.getAuthority() != null
                && "ADMIN".equalsIgnoreCase(a.getAuthority().trim()));
    }
}
