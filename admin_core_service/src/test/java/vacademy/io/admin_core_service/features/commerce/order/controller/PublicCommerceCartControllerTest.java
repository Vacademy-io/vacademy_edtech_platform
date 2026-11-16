package vacademy.io.admin_core_service.features.commerce.order.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiErrorAdvice;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodAvailability;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.pincode.CommercePincodeService;
import vacademy.io.admin_core_service.features.commerce.order.service.CartPricingException;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.StorefrontTestData;
import vacademy.io.admin_core_service.features.commerce.storefront.controller.StorefrontFeatureGate;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The public cart routes: key, feature, rate limit, never cached, errors in the API shape. */
class PublicCommerceCartControllerTest {

    private static final String BASE = "/admin-core-service/open/commerce/v1";
    private static final CatalogApiAuth.Principal READER = new CatalogApiAuth.Principal("inst-1", "key-1",
            List.of(CatalogApiAuth.SCOPE_READ));

    private CatalogApiAuth auth;
    private CommerceAccessGuard guard;
    private CommerceOrderService orderService;
    private CommercePincodeService pincodeService;
    private CommerceStorefrontSettings settings;
    /** The deployment allows COD placement unless a test builds the routes with it off. */
    private CommerceCodAvailability codAvailability = new CommerceCodAvailability(true);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        auth = mock(CatalogApiAuth.class);
        guard = mock(CommerceAccessGuard.class);
        orderService = mock(CommerceOrderService.class);
        pincodeService = mock(CommercePincodeService.class);
        settings = mock(CommerceStorefrontSettings.class);
        when(settings.read("inst-1")).thenReturn(StorefrontTestData.settings());
        when(auth.authenticateUnmetered(any(), eq(CatalogApiAuth.SCOPE_READ))).thenReturn(READER);
        build();
    }

    private void build() {
        mvc = MockMvcBuilders.standaloneSetup(new PublicCommerceCartController(auth, new StorefrontFeatureGate(guard),
                        orderService, pincodeService, settings, codAvailability))
                .setControllerAdvice(new CatalogApiErrorAdvice()).build();
    }

    private static CartPriceDtos.CartPrice priced() {
        return CartPriceDtos.CartPrice.builder().currency("INR").paymentMethod("PREPAID").lines(List.of())
                .unavailable(List.of()).changes(List.of()).discounts(List.of())
                .totals(CartPriceDtos.Totals.builder().total(new BigDecimal("560.00")).lineCount(1).build())
                .build();
    }

    @Test
    void aCartIsPricedForTheKeysInstituteAndNeverCached() throws Exception {
        when(orderService.priceCart(eq("inst-1"), any())).thenReturn(new CommerceOrderService.CartPrice(null, priced()));

        mvc.perform(post(BASE + "/cart/price").contentType(MediaType.APPLICATION_JSON).content("""
                        {"lines": [{"variant_id": "ps-b", "quantity": 2, "unit_price": 1.00, "total": 2}],
                         "coupon_code": "SAVE", "pincode": "226001", "payment_method": "COD",
                         "institute_id": "inst-2", "total": 1}
                        """))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.totals.total").value(560.00))
                .andExpect(jsonPath("$.totals.line_count").value(1))
                .andExpect(jsonPath("$.payment_method").value("PREPAID"));

        verify(guard).requireFeature("inst-1", CommerceFeature.ORDERS);
        verify(auth).rateLimit(eq(READER), any(), eq("cart"), eq(PublicCommerceCartController.CART_PER_KEY),
                eq(PublicCommerceCartController.CART_PER_VISITOR));
        verify(orderService).priceCart(eq("inst-1"), argThat(r -> r.getLines().size() == 1
                && "ps-b".equals(r.getLines().get(0).getVariantId()) && r.getLines().get(0).getQuantity() == 2
                && "SAVE".equals(r.getCouponCode()) && "226001".equals(r.getPincode())
                && "COD".equals(r.getPaymentMethod())));
    }

    @Test
    void aCartThatCannotBePricedAnswersInTheApiErrorShape() throws Exception {
        when(orderService.priceCart(eq("inst-1"), any()))
                .thenThrow(new CartPricingException(CartPricingException.CART_INVALID, "The cart has no lines."));
        mvc.perform(post(BASE + "/cart/price").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"));

        when(orderService.priceCart(eq("inst-1"), any())).thenThrow(
                new CartPricingException(CartPricingException.NOT_PRICEABLE, "TAX_CLASS_MISSING: line a has no tax class"));
        mvc.perform(post(BASE + "/cart/price").contentType(MediaType.APPLICATION_JSON).content("{\"lines\":[]}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("cart_not_priceable"));

        mvc.perform(post(BASE + "/cart/price").contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"));
    }

    @Test
    void theRateLimitAndTheFeatureCheckComeBeforeAnyPricing() throws Exception {
        doThrow(new CatalogApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", "Too many requests.",
                Map.of("limit_per_minute", 60), 30))
                .when(auth).rateLimit(any(), any(), eq("cart"), anyInt(), anyInt());
        mvc.perform(post(BASE + "/cart/price").contentType(MediaType.APPLICATION_JSON).content("{\"lines\":[]}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "30"))
                .andExpect(jsonPath("$.error.code").value("rate_limited"));

        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.FEATURE_DISABLED, "off"))
                .when(guard).requireFeature("inst-1", CommerceFeature.ORDERS);
        mvc.perform(post(BASE + "/cart/price").contentType(MediaType.APPLICATION_JSON).content("{\"lines\":[]}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("commerce_not_enabled"));
        mvc.perform(get(BASE + "/pincode/226001"))
                .andExpect(status().isForbidden());

        verify(orderService, never()).priceCart(any(), any());
        verify(pincodeService, never()).lookup(any());
    }

    @Test
    void aPincodeAnswersCityStateCodAndTheDispatchPromise() throws Exception {
        when(pincodeService.lookup("226001")).thenReturn(new CommercePincodeService.Pincode("226001", "Lucknow",
                "09", "Uttar Pradesh", CommercePincodeService.SOURCE_DIRECTORY));
        mvc.perform(get(BASE + "/pincode/226001").param("locale", "en"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.pincode").value("226001"))
                .andExpect(jsonPath("$.city").value("Lucknow"))
                .andExpect(jsonPath("$.state_code").value("09"))
                .andExpect(jsonPath("$.state_name").value("Uttar Pradesh"))
                .andExpect(jsonPath("$.state_source").value("DIRECTORY"))
                .andExpect(jsonPath("$.cod_allowed").value(true))
                .andExpect(jsonPath("$.dispatch_promise").value("Ships in 2 working days"));
        verify(auth).rateLimit(eq(READER), any(), eq("pincode"), anyInt(), anyInt());

        // The seller blocks 190001 for COD; the base locale (Hindi) serves the promise.
        when(pincodeService.lookup("190001")).thenReturn(new CommercePincodeService.Pincode("190001", null, "01",
                "Jammu and Kashmir", CommercePincodeService.SOURCE_PIN_PREFIX));
        mvc.perform(get(BASE + "/pincode/190001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cod_allowed").value(false))
                .andExpect(jsonPath("$.cod_reason").value("PINCODE_BLOCKED"))
                .andExpect(jsonPath("$.city").doesNotExist())
                .andExpect(jsonPath("$.dispatch_promise").value("2 कार्य दिवसों में भेजा जाएगा"));
    }

    @Test
    void withCodPlacementSwitchedOffThePincodeAnswersCodDisabledWhateverTheShopSet() throws Exception {
        codAvailability = CommerceCodAvailability.off();
        build();
        when(pincodeService.lookup("226001")).thenReturn(new CommercePincodeService.Pincode("226001", "Lucknow",
                "09", "Uttar Pradesh", CommercePincodeService.SOURCE_DIRECTORY));
        mvc.perform(get(BASE + "/pincode/226001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cod_allowed").value(false))
                .andExpect(jsonPath("$.cod_reason").value("COD_DISABLED"));
        // A blocked pincode answers COD_DISABLED too: the switch is the first reason.
        when(pincodeService.lookup("190001")).thenReturn(new CommercePincodeService.Pincode("190001", null, "01",
                "Jammu and Kashmir", CommercePincodeService.SOURCE_PIN_PREFIX));
        mvc.perform(get(BASE + "/pincode/190001"))
                .andExpect(jsonPath("$.cod_reason").value("COD_DISABLED"));
    }

    @Test
    void aMalformedPincodeIsABadRequest() throws Exception {
        when(pincodeService.lookup("12345")).thenReturn(null);
        mvc.perform(get(BASE + "/pincode/12345"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"))
                .andExpect(jsonPath("$.error.details.param").value("pin"));
    }
}
