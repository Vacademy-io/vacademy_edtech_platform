package vacademy.io.admin_core_service.features.stock_hold.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
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
 *
 * <p>{@code /availability} is public for the same reason: the cart checks stock before the checkout
 * form, when the learner may not be logged in yet. The catalogue already shows these counts.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/stock-hold")
@RequiredArgsConstructor
public class StockHoldReleaseController {

    /** More than any real cart holds; keeps this public endpoint from being a bulk stock scan. */
    static final int MAX_AVAILABILITY_IDS = 100;

    private final StockHoldService stockHoldService;

    @PostMapping("/release")
    public ResponseEntity<Map<String, Integer>> release(@RequestParam String paymentLogId) {
        if (!StringUtils.hasText(paymentLogId)) {
            throw new InvalidRequestException("paymentLogId is required");
        }
        return ResponseEntity.ok(Map.of("released", stockHoldService.releaseForOrder(paymentLogId.trim())));
    }

    /** Copies left per package session; a session with no stock limit is absent from the result. */
    @PostMapping("/availability")
    public ResponseEntity<Map<String, Integer>> availability(@RequestBody List<String> packageSessionIds) {
        if (packageSessionIds == null || packageSessionIds.isEmpty()) {
            return ResponseEntity.ok(Map.of());
        }
        if (packageSessionIds.size() > MAX_AVAILABILITY_IDS) {
            throw new InvalidRequestException("At most " + MAX_AVAILABILITY_IDS + " items can be checked at once");
        }
        return ResponseEntity.ok(stockHoldService.availableStock(packageSessionIds));
    }
}
