package vacademy.io.admin_core_service.features.commerce.order.controller;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutConfig;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiEnvelope;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutRequest;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.controller.StorefrontFeatureGate;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Public checkout and order routes of the shop:
 * <pre>
 * GET    /open/commerce/v1/checkout/config                   buyer identity, OTP, bot check, methods
 * POST   /open/commerce/v1/checkout                          place a prepaid order
 * POST   /open/commerce/v1/checkout/{orderId}/retry-payment  the payment step again (order token)
 * POST   /open/commerce/v1/checkout/{orderId}/confirm-payment  gateway order, payment id, signature
 * GET    /open/commerce/v1/orders/view                       the order page (order token header)
 * POST   /open/commerce/v1/orders/track                      order number + verified-phone token
 * GET    /open/commerce/v1/me                                the buyer's account
 * POST   /open/commerce/v1/me/logout                         end every session of the buyer's phone
 * PUT    /open/commerce/v1/me/consent                        the buyer's marketing choice
 * GET    /open/commerce/v1/me/orders                         the buyer's orders
 * GET    /open/commerce/v1/me/addresses                      the buyer's address book
 * POST   /open/commerce/v1/me/addresses
 * PUT    /open/commerce/v1/me/addresses/{id}
 * DELETE /open/commerce/v1/me/addresses/{id}
 * </pre>
 * All sit behind the publishable Catalogue API key like the cart: the institute is the key's,
 * browser calls are locked to the institute's verified websites, each family has limits of its
 * own per visitor and per key, and the institute needs the {@code commerce.orders} feature.
 * Bodies are read here with a size cap, never by the framework. Nothing is cached.
 *
 * <p>The buyer's own routes ({@code /me}) take the shopper session in the
 * {@code X-Commerce-Session} header, or the verified-phone token of the OTP step in the
 * {@code X-Commerce-Phone-Token} header. Neither is a platform login. The order token is read
 * from the {@code X-Commerce-Order-Token} header only, never from the address.
 */
@RestController
@RequestMapping("/admin-core-service/open/commerce/v1")
@RequiredArgsConstructor
public class PublicCommerceCheckoutController implements CatalogApiEnvelope {

    /** Per minute and pod, separately for browser calls and for server-side calls. */
    static final int CHECKOUT_PER_KEY = 600;
    static final int CHECKOUT_PER_VISITOR = 10;
    static final int ORDER_READ_PER_KEY = 1500;
    static final int ORDER_READ_PER_VISITOR = 60;
    static final int TRACK_PER_KEY = 600;
    static final int TRACK_PER_VISITOR = 10;
    static final int ACCOUNT_PER_KEY = 1500;
    static final int ACCOUNT_PER_VISITOR = 60;

    /** A checkout of 50 lines with two addresses and notes is well under this. */
    static final int MAX_CHECKOUT_BODY_BYTES = 64 * 1024;
    static final int MAX_SMALL_BODY_BYTES = 8 * 1024;

    static final String PHONE_TOKEN_HEADER = "X-Commerce-Phone-Token";
    static final String ORDER_TOKEN_HEADER = "X-Commerce-Order-Token";
    static final String SESSION_HEADER = CommerceShopperSessions.HEADER;

    private final CatalogApiAuth auth;
    private final StorefrontFeatureGate featureGate;
    private final CommerceCheckoutService checkoutService;
    private final CommerceOrderQueryService queryService;
    private final CommerceCheckoutConfig checkoutConfig;
    private final ObjectMapper objectMapper;

    @GetMapping("/checkout/config")
    public ResponseEntity<Map<String, Object>> checkoutConfig(HttpServletRequest http) {
        var p = enter(http, "order", ORDER_READ_PER_KEY, ORDER_READ_PER_VISITOR);
        try {
            // Public values only; the browser may keep them for a minute.
            return ResponseEntity.ok().header("Cache-Control", "private, max-age=60")
                    .body(checkoutConfig.config(p.instituteId()));
        } catch (CheckoutException e) {
            throw new CatalogApiException(e.getStatus(), e.getCode(), e.getMessage(), e.getDetails(), null);
        }
    }

    @PostMapping("/checkout")
    public ResponseEntity<CheckoutDtos.Placed> checkout(HttpServletRequest http) {
        var p = enter(http, "checkout", CHECKOUT_PER_KEY, CHECKOUT_PER_VISITOR);
        CheckoutRequest body = read(http, CheckoutRequest.class, MAX_CHECKOUT_BODY_BYTES);
        // The address the request really came from: the limits per address are counted on it,
        // never on a header the caller chooses.
        String network = CatalogApiAuth.networkClientIp(http);
        String clientIp = network != null ? network : http.getRemoteAddr();
        boolean serverSide = http.getHeader("Origin") == null;
        String session = http.getHeader(SESSION_HEADER);
        return answer(() -> checkoutService.placeOrder(p.instituteId(), body, clientIp, serverSide, session));
    }

    @PostMapping("/checkout/{orderId}/retry-payment")
    public ResponseEntity<CheckoutDtos.Placed> retryPayment(HttpServletRequest http,
                                                            @PathVariable("orderId") String orderId) {
        var p = enter(http, "checkout", CHECKOUT_PER_KEY, CHECKOUT_PER_VISITOR);
        String token = http.getHeader(ORDER_TOKEN_HEADER);
        if (token == null || token.isBlank()) {
            Map<?, ?> body = read(http, Map.class, MAX_SMALL_BODY_BYTES);
            Object sent = body == null ? null : body.get("order_access_token");
            token = sent == null ? null : sent.toString();
        }
        String orderToken = token;
        return answer(() -> checkoutService.retryPayment(p.instituteId(), orderId, orderToken));
    }

    @PostMapping("/checkout/{orderId}/confirm-payment")
    public ResponseEntity<CheckoutDtos.Placed> confirmPayment(HttpServletRequest http,
                                                              @PathVariable("orderId") String orderId) {
        var p = enter(http, "checkout", CHECKOUT_PER_KEY, CHECKOUT_PER_VISITOR);
        Map<?, ?> body = read(http, Map.class, MAX_SMALL_BODY_BYTES);
        String gatewayOrderId = field(body, "gateway_order_id");
        String gatewayPaymentId = field(body, "gateway_payment_id");
        String signature = field(body, "signature");
        return answer(() -> checkoutService.confirmClientPayment(p.instituteId(), orderId, gatewayOrderId,
                gatewayPaymentId, signature));
    }

    @GetMapping("/orders/view")
    public ResponseEntity<CheckoutDtos.OrderView> view(HttpServletRequest http) {
        var p = enter(http, "order", ORDER_READ_PER_KEY, ORDER_READ_PER_VISITOR);
        // The header only: a token in the address ends up in logs and in the Referer.
        String orderToken = http.getHeader(ORDER_TOKEN_HEADER);
        return answer(() -> queryService.viewByToken(p.instituteId(), orderToken));
    }

    @PostMapping("/orders/track")
    public ResponseEntity<CheckoutDtos.OrderView> track(HttpServletRequest http) {
        var p = enter(http, "track", TRACK_PER_KEY, TRACK_PER_VISITOR);
        Map<?, ?> body = read(http, Map.class, MAX_SMALL_BODY_BYTES);
        String orderNumber = body == null || body.get("order_number") == null ? null
                : body.get("order_number").toString();
        Object sent = body == null ? null : body.get("phone_token");
        String phoneToken = sent != null ? sent.toString() : http.getHeader(PHONE_TOKEN_HEADER);
        return answer(() -> queryService.track(p.instituteId(), orderNumber, phoneToken));
    }

    @GetMapping("/me")
    public ResponseEntity<CheckoutDtos.Account> me(HttpServletRequest http) {
        var p = enter(http, "account", ACCOUNT_PER_KEY, ACCOUNT_PER_VISITOR);
        return answer(() -> queryService.me(p.instituteId(), http.getHeader(SESSION_HEADER),
                http.getHeader(PHONE_TOKEN_HEADER)));
    }

    @PostMapping("/me/logout")
    public ResponseEntity<Void> logout(HttpServletRequest http) {
        var p = enter(http, "account", ACCOUNT_PER_KEY, ACCOUNT_PER_VISITOR);
        try {
            queryService.logoutEverywhere(p.instituteId(), http.getHeader(SESSION_HEADER),
                    http.getHeader(PHONE_TOKEN_HEADER));
        } catch (CheckoutException e) {
            throw new CatalogApiException(e.getStatus(), e.getCode(), e.getMessage(), e.getDetails(), null);
        }
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }

    @PutMapping("/me/consent")
    public ResponseEntity<CheckoutDtos.Account> consent(HttpServletRequest http) {
        var p = enter(http, "account", ACCOUNT_PER_KEY, ACCOUNT_PER_VISITOR);
        Map<?, ?> body = read(http, Map.class, MAX_SMALL_BODY_BYTES);
        Object sent = body == null ? null : body.get("marketing_consent");
        Boolean consent = sent instanceof Boolean b ? b : null;
        return answer(() -> queryService.setConsent(p.instituteId(), http.getHeader(SESSION_HEADER),
                http.getHeader(PHONE_TOKEN_HEADER), consent));
    }

    @GetMapping("/me/orders")
    public ResponseEntity<CheckoutDtos.OrderPage> myOrders(
            HttpServletRequest http,
            @RequestParam(value = "page", defaultValue = "0") int page,
            @RequestParam(value = "page_size", defaultValue = "20") int pageSize) {
        var p = enter(http, "account", ACCOUNT_PER_KEY, ACCOUNT_PER_VISITOR);
        return answer(() -> queryService.myOrders(p.instituteId(), http.getHeader(SESSION_HEADER),
                http.getHeader(PHONE_TOKEN_HEADER), page, pageSize));
    }

    @GetMapping("/me/addresses")
    public ResponseEntity<List<CheckoutDtos.AddressView>> myAddresses(HttpServletRequest http) {
        var p = enter(http, "account", ACCOUNT_PER_KEY, ACCOUNT_PER_VISITOR);
        return answer(() -> queryService.myAddresses(p.instituteId(), http.getHeader(SESSION_HEADER),
                http.getHeader(PHONE_TOKEN_HEADER)));
    }

    @PostMapping("/me/addresses")
    public ResponseEntity<CheckoutDtos.AddressView> addAddress(HttpServletRequest http) {
        var p = enter(http, "account", ACCOUNT_PER_KEY, ACCOUNT_PER_VISITOR);
        CheckoutRequest.Address body = read(http, CheckoutRequest.Address.class, MAX_SMALL_BODY_BYTES);
        return answer(() -> queryService.addMyAddress(p.instituteId(), http.getHeader(SESSION_HEADER),
                http.getHeader(PHONE_TOKEN_HEADER), body));
    }

    @PutMapping("/me/addresses/{id}")
    public ResponseEntity<CheckoutDtos.AddressView> updateAddress(HttpServletRequest http,
                                                                  @PathVariable("id") String id) {
        var p = enter(http, "account", ACCOUNT_PER_KEY, ACCOUNT_PER_VISITOR);
        CheckoutRequest.Address body = read(http, CheckoutRequest.Address.class, MAX_SMALL_BODY_BYTES);
        return answer(() -> queryService.updateMyAddress(p.instituteId(), http.getHeader(SESSION_HEADER),
                http.getHeader(PHONE_TOKEN_HEADER), id, body));
    }

    @DeleteMapping("/me/addresses/{id}")
    public ResponseEntity<Void> deleteAddress(HttpServletRequest http, @PathVariable("id") String id) {
        var p = enter(http, "account", ACCOUNT_PER_KEY, ACCOUNT_PER_VISITOR);
        return answer(() -> {
            queryService.deleteMyAddress(p.instituteId(), http.getHeader(SESSION_HEADER),
                    http.getHeader(PHONE_TOKEN_HEADER), id);
            return null;
        });
    }

    // ------------------------------------------------------------------ helpers

    private CatalogApiAuth.Principal enter(HttpServletRequest http, String family, int perKey, int perVisitor) {
        var p = auth.authenticateUnmetered(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.ORDERS);
        auth.rateLimit(p, http, family, perKey, perVisitor);
        return p;
    }

    private static String field(Map<?, ?> body, String name) {
        Object value = body == null ? null : body.get(name);
        if (value == null) {
            return null;
        }
        String text = value.toString();
        return text.length() > 512 ? null : text;
    }

    private static <T> ResponseEntity<T> answer(Supplier<T> work) {
        try {
            T body = work.get();
            ResponseEntity.BodyBuilder response = ResponseEntity.ok().header("Cache-Control", "no-store");
            return body == null ? response.build() : response.body(body);
        } catch (CheckoutException e) {
            throw new CatalogApiException(e.getStatus(), e.getCode(), e.getMessage(), e.getDetails(), null);
        } catch (InvalidRequestException e) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, CheckoutException.INVALID_REQUEST, e.getMessage());
        }
    }

    /** Reads at most {@code maxBytes} of the body and parses it; a longer body is refused. */
    private <T> T read(HttpServletRequest http, Class<T> type, int maxBytes) {
        if (http.getContentLengthLong() > maxBytes) {
            throw tooLarge(maxBytes);
        }
        byte[] bytes;
        try (InputStream in = http.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(maxBytes, 4096));
            byte[] chunk = new byte[4096];
            int total = 0;
            int n;
            while ((n = in.read(chunk)) != -1) {
                total += n;
                if (total > maxBytes) {
                    throw tooLarge(maxBytes);
                }
                out.write(chunk, 0, n);
            }
            bytes = out.toByteArray();
        } catch (IOException e) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, CheckoutException.INVALID_REQUEST,
                    "The request body could not be read.");
        }
        if (bytes.length == 0) {
            return null;
        }
        try {
            return objectMapper.readValue(bytes, type);
        } catch (JsonProcessingException e) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, CheckoutException.INVALID_REQUEST,
                    "The request body is not valid JSON for this endpoint.");
        } catch (IOException e) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, CheckoutException.INVALID_REQUEST,
                    "The request body could not be read.");
        }
    }

    private static CatalogApiException tooLarge(int maxBytes) {
        return new CatalogApiException(HttpStatus.PAYLOAD_TOO_LARGE, "payload_too_large",
                "The request body is larger than " + (maxBytes / 1024) + " KB.");
    }
}
