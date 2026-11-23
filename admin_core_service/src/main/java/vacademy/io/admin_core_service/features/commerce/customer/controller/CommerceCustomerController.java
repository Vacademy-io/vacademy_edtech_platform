package vacademy.io.admin_core_service.features.commerce.customer.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.customer.dto.CustomerDtos;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerQueryService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Set;

/**
 * The shop's customers for staff ({@code /commerce/v1/customers}): a list and one profile.
 * Read-only. Store manager and accountant (and an institute ADMIN) with the orders feature;
 * warehouse staff and cashiers are refused. No export, no edit, no anonymise here.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/customers")
public class CommerceCustomerController {

    static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT);

    private final CommerceAccessGuard accessGuard;
    private final CommerceCustomerQueryService queryService;

    public CommerceCustomerController(CommerceAccessGuard accessGuard, CommerceCustomerQueryService queryService) {
        this.accessGuard = accessGuard;
        this.queryService = queryService;
    }

    @GetMapping
    public ResponseEntity<CustomerDtos.CustomerPage> list(
            @RequestParam("instituteId") String instituteId,
            @RequestParam(value = "search", required = false) String search,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "pageSize", defaultValue = "50") int pageSize,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(queryService.list(instituteId, search, page, pageSize));
    }

    @GetMapping("/{customerId}")
    public ResponseEntity<CustomerDtos.CustomerProfile> profile(
            @PathVariable("customerId") String customerId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        return ResponseEntity.ok(queryService.profile(instituteId, customerId));
    }
}
