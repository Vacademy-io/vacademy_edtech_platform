package vacademy.io.admin_core_service.features.stock_hold.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.Map;

/**
 * Public (no-auth) release of an unpaid order's stock holds. Mapped under /open/** which is in
 * ALLOWED_PATHS in ApplicationSecurityConfig.
 *
 * <p>The storefront calls it from Razorpay's {@code ondismiss}, when the learner closes the
 * payment window, so the stock goes back at once instead of after {@link StockHoldService#HOLD_MINUTES}.
 * It needs no login because the learner checking out may have none. It is safe to leave open:
 * it only ever releases HELD rows of an order whose payment log is not PAID, which the expiry job
 * would release anyway, and it reveals nothing beyond a count.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/stock-hold")
@RequiredArgsConstructor
public class StockHoldReleaseController {

    private final StockHoldService stockHoldService;

    @PostMapping("/release")
    public ResponseEntity<Map<String, Integer>> release(@RequestParam String paymentLogId) {
        if (!StringUtils.hasText(paymentLogId)) {
            throw new InvalidRequestException("paymentLogId is required");
        }
        return ResponseEntity.ok(Map.of("released", stockHoldService.releaseForOrder(paymentLogId.trim())));
    }
}
