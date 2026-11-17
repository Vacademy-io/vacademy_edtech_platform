package vacademy.io.admin_core_service.features.commerce.notify.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.notify.dto.NotificationSettingsDtos;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderLinkService;
import vacademy.io.admin_core_service.features.commerce.order.desk.CommerceOrderDeskService;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;
import java.util.Set;

/**
 * The buyer messages of one order ({@code GET /orders/{id}/notifications}, for the readers of the
 * order at its location) and the revocation of its order links ({@code POST
 * /orders/{id}/links/revoke}, a store manager at the order's location or an admin).
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/orders")
public class CommerceOrderNotificationController {

    public static final Set<CommerceRole> READ = Set.of(CommerceRole.STORE_MANAGER, CommerceRole.WAREHOUSE_STAFF,
            CommerceRole.ACCOUNTANT);
    public static final int LIMIT = 100;

    private final CommerceAccessGuard accessGuard;
    private final CommerceOrderDeskService desk;
    private final CommerceNotificationStore store;
    private final CommerceOrderLinkService linkService;

    public CommerceOrderNotificationController(CommerceAccessGuard accessGuard, CommerceOrderDeskService desk,
                                               CommerceNotificationStore store, CommerceOrderLinkService linkService) {
        this.accessGuard = accessGuard;
        this.desk = desk;
        this.store = store;
        this.linkService = linkService;
    }

    @GetMapping("/{orderId}/notifications")
    public ResponseEntity<NotificationSettingsDtos.DeliveryList> notifications(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        // Membership and the feature first: an outsider learns nothing about ids.
        accessGuard.require(user, instituteId, CommerceFeature.ORDERS, READ);
        CommerceOrder order = desk.readOrder(instituteId, orderId);
        desk.authorize(user, instituteId, order.getFulfilmentLocationId(), READ);
        return ResponseEntity.ok(NotificationSettingsDtos.DeliveryList.builder()
                .items(NotificationSettingsDtos.DeliveryView.of(store.ofOrder(instituteId, order.getId(), LIMIT)))
                .build());
    }

    @PostMapping("/{orderId}/links/revoke")
    public ResponseEntity<Map<String, Object>> revokeLinks(
            @PathVariable("orderId") String orderId,
            @RequestParam("instituteId") String instituteId,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(linkService.revoke(user, instituteId, orderId));
    }
}
