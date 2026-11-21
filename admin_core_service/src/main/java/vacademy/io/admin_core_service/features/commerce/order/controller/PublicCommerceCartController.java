package vacademy.io.admin_core_service.features.commerce.order.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiEnvelope;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.commerce.order.cod.CodEligibility;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodAvailability;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.pincode.CommercePincodeService;
import vacademy.io.admin_core_service.features.commerce.order.service.CartPricingException;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.controller.StorefrontFeatureGate;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontLocale;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Public cart routes of the shop:
 * <pre>
 * POST /open/commerce/v1/cart/price     lines, coupon_code, pincode, state_code, payment_method
 * GET  /open/commerce/v1/pincode/{pin}  city, state, whether COD is allowed, dispatch promise
 * </pre>
 * They sit behind the publishable Catalogue API key like the product routes: the institute is
 * the key's, browser calls are locked to the institute's verified websites, and each family
 * has limits of its own per visitor and per key ({@link CatalogApiAuth#rateLimit}); they do not
 * draw on the read limit of the catalogue routes, and the visitor is tested before the key, so
 * one client cannot use up the cart of every shopper. The institute needs the
 * {@code commerce.orders} feature. A price is never cached.
 */
@RestController
@RequestMapping("/admin-core-service/open/commerce/v1")
@RequiredArgsConstructor
public class PublicCommerceCartController implements CatalogApiEnvelope {

    /** Per minute and pod, separately for browser calls and for server-side calls. */
    static final int CART_PER_KEY = 3000;
    static final int CART_PER_VISITOR = 60;
    static final int PINCODE_PER_KEY = 1500;
    static final int PINCODE_PER_VISITOR = 30;

    private final CatalogApiAuth auth;
    private final StorefrontFeatureGate featureGate;
    private final CommerceOrderService orderService;
    private final CommercePincodeService pincodeService;
    private final CommerceStorefrontSettings storefrontSettings;
    private final CommerceCodAvailability codAvailability;

    @PostMapping("/cart/price")
    public ResponseEntity<CartPriceDtos.CartPrice> price(HttpServletRequest http,
                                                         @RequestBody(required = false) CartPriceRequest body) {
        var p = auth.authenticateUnmetered(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.ORDERS);
        auth.rateLimit(p, http, "cart", CART_PER_KEY, CART_PER_VISITOR);
        try {
            return ResponseEntity.ok().header("Cache-Control", "no-store")
                    .body(orderService.priceCart(p.instituteId(), body).view());
        } catch (CartPricingException e) {
            boolean invalid = CartPricingException.CART_INVALID.equals(e.getCode());
            throw new CatalogApiException(invalid ? HttpStatus.BAD_REQUEST : HttpStatus.CONFLICT,
                    invalid ? "invalid_request" : "cart_not_priceable", e.getMessage());
        }
    }

    @GetMapping("/pincode/{pin}")
    public ResponseEntity<CartPriceDtos.PincodeInfo> pincode(HttpServletRequest http,
                                                             @PathVariable("pin") String pin) {
        var p = auth.authenticateUnmetered(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.ORDERS);
        auth.rateLimit(p, http, "pincode", PINCODE_PER_KEY, PINCODE_PER_VISITOR);
        CommercePincodeService.Pincode found = pincodeService.lookup(pin);
        if (found == null) {
            Map<String, Object> details = new LinkedHashMap<>();
            details.put("param", "pin");
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request",
                    "A pincode has six digits.", details, null);
        }
        StorefrontSettings settings = storefrontSettings.read(p.instituteId());
        // COD_DISABLED also while the deployment does not place COD orders: checkout would refuse.
        String codReason = !codAvailability.effective(settings.cod()) ? CodEligibility.COD_DISABLED
                : settings.cod().blockedPincodes().contains(found.pincode()) ? CodEligibility.PINCODE_BLOCKED : null;
        String locale = http.getParameter("locale") != null ? http.getParameter("locale") : http.getParameter("lang");
        return ResponseEntity.ok()
                .header("Cache-Control", "public, max-age=60")
                .header("Vary", "Origin, X-API-Key, Authorization")
                .body(CartPriceDtos.PincodeInfo.builder()
                        .pincode(found.pincode())
                        .city(found.city())
                        .stateCode(found.stateCode())
                        .stateName(found.stateName())
                        .stateSource(found.source())
                        .codAllowed(codReason == null)
                        .codReason(codReason)
                        .dispatchPromise(StorefrontLocale.text(settings.dispatchPromise(),
                                StorefrontLocale.chain(locale, settings.baseLocale())))
                        .build());
    }
}
