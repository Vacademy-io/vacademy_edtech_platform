package vacademy.io.admin_core_service.features.stock_hold.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.Map;

/**
 * Public (no-auth) release of an unpaid order's stock holds. Mapped under /open/** which is in
 * ALLOWED_PATHS in ApplicationSecurityConfig.
 *
 * <p>The storefront calls it from Razorpay's {@code ondismiss}, when the learner closes the
 * payment window, so the stock goes back at once instead of after {@link StockHoldService#HOLD_MINUTES}.
 * It needs no login because the learner checking out may have none.
 *
 * <p>The call takes a body with the payment log id and the release token that
 * {@code StockHoldService.hold} issued; only its hash is stored, the comparison takes constant
 * time, and a SOLD hold or one with a payment attempt in progress is never released.
 *
 * <p>The form {@code ?paymentLogId=} is also accepted while
 * {@code stock-hold.release.legacy-form-enabled} is true (the default); it never releases a shop
 * product's hold.
 *
 * <p>{@code /availability} is public for the same reason: the cart checks stock before the checkout
 * form, when the learner may not be logged in yet. The catalogue already shows these counts.
 */
@RestController
@RequestMapping("/admin-core-service/open/v1/stock-hold")
@RequiredArgsConstructor
public class StockHoldReleaseController {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** More than any real cart holds; keeps this public endpoint from being a bulk stock scan. */
    static final int MAX_AVAILABILITY_IDS = 100;

    private final StockHoldService stockHoldService;

    /** See the class comment. A field, so the one-argument constructor stays. */
    @Value("${stock-hold.release.legacy-form-enabled:true}")
    private boolean legacyFormEnabled = true;

    @PostMapping("/release")
    public ResponseEntity<Map<String, Integer>> release(
            @RequestParam(value = "paymentLogId", required = false) String paymentLogId,
            @RequestBody(required = false) String rawBody) {
        // The body is read as text: the old form arrives with no body and any content type,
        // and must not fail on that during the grace cycle.
        JsonNode body = parse(rawBody);
        String bodyPaymentLogId = text(body, "paymentLogId", "payment_log_id");
        String releaseToken = text(body, "releaseToken", "release_token");
        if (StringUtils.hasText(releaseToken)) {
            if (!StringUtils.hasText(bodyPaymentLogId)) {
                throw new InvalidRequestException("paymentLogId is required");
            }
            return ResponseEntity.ok(Map.of("released", stockHoldService.releaseForOrderWithToken(
                    bodyPaymentLogId.trim(), releaseToken.trim())));
        }
        String legacyId = StringUtils.hasText(paymentLogId) ? paymentLogId : bodyPaymentLogId;
        if (!StringUtils.hasText(legacyId)) {
            throw new InvalidRequestException("paymentLogId is required");
        }
        if (!legacyFormEnabled) {
            throw new ForbiddenException("A release token is required");
        }
        return ResponseEntity.ok(Map.of("released", stockHoldService.releaseForOrderLegacyForm(legacyId.trim())));
    }

    void setLegacyFormEnabled(boolean legacyFormEnabled) {
        this.legacyFormEnabled = legacyFormEnabled;
    }

    private static JsonNode parse(String rawBody) {
        if (!StringUtils.hasText(rawBody) || !rawBody.trim().startsWith("{")) {
            return null;
        }
        try {
            return MAPPER.readTree(rawBody);
        } catch (Exception e) {
            throw new InvalidRequestException("The request body is not valid JSON");
        }
    }

    private static String text(JsonNode body, String name, String snakeName) {
        if (body == null) {
            return null;
        }
        JsonNode node = body.hasNonNull(name) ? body.get(name) : body.get(snakeName);
        return node == null || node.isNull() || !node.isValueNode() ? null : node.asText();
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
