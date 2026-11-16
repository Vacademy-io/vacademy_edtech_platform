package vacademy.io.admin_core_service.features.commerce.shipment.controller;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.dto.ShipmentDtos;
import vacademy.io.admin_core_service.features.commerce.shipment.service.CommerceShipmentService;
import vacademy.io.common.auth.model.CustomUserDetails;

/**
 * Parcels of the order desk ({@code /commerce/v1/shipments}): pack, ship, delivered / returned
 * to sender / back at the shop, and the tracking correction. Store manager and warehouse staff
 * of the order's location (an institute ADMIN anywhere). Every write answers the order.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/shipments")
public class CommerceShipmentController {

    private final CommerceShipmentService shipmentService;

    public CommerceShipmentController(CommerceShipmentService shipmentService) {
        this.shipmentService = shipmentService;
    }

    @PostMapping
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> pack(
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ShipmentDtos.PackRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        StaffOrderDtos.StaffOrderDetail detail = shipmentService.pack(user, instituteId, request);
        return ResponseEntity.status(Boolean.TRUE.equals(detail.getReplayed()) ? HttpStatus.OK : HttpStatus.CREATED)
                .body(detail);
    }

    @PostMapping("/{shipmentId}/ship")
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> ship(
            @PathVariable("shipmentId") String shipmentId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ShipmentDtos.ShipRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(shipmentService.ship(user, instituteId, shipmentId, request));
    }

    @PostMapping("/{shipmentId}/status")
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> status(
            @PathVariable("shipmentId") String shipmentId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ShipmentDtos.StatusRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(shipmentService.status(user, instituteId, shipmentId, request));
    }

    @PatchMapping("/{shipmentId}")
    public ResponseEntity<StaffOrderDtos.StaffOrderDetail> patch(
            @PathVariable("shipmentId") String shipmentId,
            @RequestParam("instituteId") String instituteId,
            @RequestBody(required = false) ShipmentDtos.PatchRequest request,
            @RequestAttribute("user") CustomUserDetails user) {
        return ResponseEntity.ok(shipmentService.patch(user, instituteId, shipmentId, request));
    }
}
