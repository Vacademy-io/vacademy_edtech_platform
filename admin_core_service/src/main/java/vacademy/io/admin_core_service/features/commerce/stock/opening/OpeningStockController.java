package vacademy.io.admin_core_service.features.commerce.stock.opening;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Map;

/**
 * Opening stock of a location ({@code /commerce/v1/stock/opening/...}, WP-53). Refused with
 * FEATURE_DISABLED unless the institute has both the inventory and the switch-over feature.
 */
@RestController
@RequestMapping("/admin-core-service/commerce/v1/stock/opening")
public class OpeningStockController {

    private final OpeningStockService service;

    public OpeningStockController(OpeningStockService service) {
        this.service = service;
    }

    /** Costs loaded, opening receipts, the latest blind recount and its verdict, for one location. */
    @GetMapping("/readiness")
    public ResponseEntity<Map<String, Object>> readiness(@RequestAttribute("user") CustomUserDetails user,
                                                         @RequestParam("instituteId") String instituteId,
                                                         @RequestParam(value = "locationId", required = false)
                                                         String locationId) {
        return ResponseEntity.ok(service.readiness(user, instituteId, locationId));
    }
}
