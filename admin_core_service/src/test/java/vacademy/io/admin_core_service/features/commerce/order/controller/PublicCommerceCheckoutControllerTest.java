package vacademy.io.admin_core_service.features.commerce.order.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiErrorAdvice;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CheckoutException;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutConfig;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceCheckoutService;
import vacademy.io.admin_core_service.features.commerce.order.checkout.CommerceOrderQueryService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CheckoutDtos;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.controller.StorefrontFeatureGate;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The public checkout and order routes: key, feature, limits, capped bodies, the API error shape. */
class PublicCommerceCheckoutControllerTest {

    private static final String BASE = "/admin-core-service/open/commerce/v1";
    private static final CatalogApiAuth.Principal READER = new CatalogApiAuth.Principal("inst-1", "key-1",
            List.of(CatalogApiAuth.SCOPE_READ));

    private CatalogApiAuth auth;
    private CommerceAccessGuard guard;
    private CommerceCheckoutService checkoutService;
    private CommerceOrderQueryService queryService;
    private CommerceCheckoutConfig checkoutConfig;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        auth = mock(CatalogApiAuth.class);
        guard = mock(CommerceAccessGuard.class);
        checkoutService = mock(CommerceCheckoutService.class);
        queryService = mock(CommerceOrderQueryService.class);
        checkoutConfig = mock(CommerceCheckoutConfig.class);
        when(auth.authenticateUnmetered(any(), eq(CatalogApiAuth.SCOPE_READ))).thenReturn(READER);
        mvc = MockMvcBuilders.standaloneSetup(new PublicCommerceCheckoutController(auth,
                        new StorefrontFeatureGate(guard), checkoutService, queryService, checkoutConfig,
                        new ObjectMapper()))
                .setControllerAdvice(new CatalogApiErrorAdvice()).build();
    }

    private static CheckoutDtos.Placed placed() {
        return CheckoutDtos.Placed.builder().orderId("order-1").orderNumber("ORD-000007").status("PENDING_PAYMENT")
                .paymentStatus("UNPAID").currency("INR").total(new BigDecimal("1050.00"))
                .payment(CheckoutDtos.Payment.builder().vendor("RAZORPAY").gatewayOrderId("order_gw_1")
                        .keyId("rzp_key").amountMinor(105000).currency("INR").build())
                .orderAccessToken("v1.a.b").build();
    }

    @Test
    void anOrderIsPlacedForTheInstituteOfTheKeyWhateverTheBodySays() throws Exception {
        when(checkoutService.placeOrder(eq("inst-1"), any(), any(), anyBoolean(), any())).thenReturn(placed());

        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("""
                        {"client_request_id": "req-12345678", "institute_id": "inst-2", "user_id": "u-9",
                         "lines": [{"variant_id": "ps-a", "quantity": 1, "unit_price": 1.00}],
                         "expected_total": 1050.00, "total": 1,
                         "customer": {"name": "Asha", "phone": "9876543210"},
                         "shipping_address": {"line1": "12 Gandhi Marg", "pincode": "226001"}}
                        """))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.order_number").value("ORD-000007"))
                .andExpect(jsonPath("$.payment.gateway_order_id").value("order_gw_1"))
                .andExpect(jsonPath("$.payment.amount_minor").value(105000))
                .andExpect(jsonPath("$.order_access_token").value("v1.a.b"));

        verify(guard).requireFeature("inst-1", CommerceFeature.ORDERS);
        verify(auth).rateLimit(eq(READER), any(), eq("checkout"),
                eq(PublicCommerceCheckoutController.CHECKOUT_PER_KEY),
                eq(PublicCommerceCheckoutController.CHECKOUT_PER_VISITOR));
        verify(checkoutService).placeOrder(eq("inst-1"), argThat(r -> "req-12345678".equals(r.getClientRequestId())
                && r.getLines().size() == 1 && new BigDecimal("1050.00").compareTo(r.getExpectedTotal()) == 0
                && "Asha".equals(r.getCustomer().getName())
                && "226001".equals(r.getShippingAddress().getPincode())), any(), anyBoolean(), isNull());
    }

    @Test
    void theAddressOfTheLimitsIsTheOneTheRequestCameFrom_neverTheHeaderTheCallerChooses() throws Exception {
        when(checkoutService.placeOrder(eq("inst-1"), any(), any(), anyBoolean(), any())).thenReturn(placed());

        // A server-side call (no Origin) that names a new shopper address each time.
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{}")
                        .header("CF-Connecting-IP", "203.0.113.7").header("X-Client-IP", "198.51.100.1"))
                .andExpect(status().isOk());
        // A browser call.
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{}")
                        .header("CF-Connecting-IP", "203.0.113.8").header("Origin", "https://shop.example")
                        .header("X-Client-IP", "198.51.100.2"))
                .andExpect(status().isOk());

        verify(checkoutService).placeOrder(eq("inst-1"), any(), eq("203.0.113.7"), eq(true), isNull());
        verify(checkoutService).placeOrder(eq("inst-1"), any(), eq("203.0.113.8"), eq(false), isNull());
    }

    @Test
    void aBodyOverTheCapIsRefusedBeforeItIsParsed() throws Exception {
        String big = "{\"customer_note\": \"" + "x".repeat(PublicCommerceCheckoutController.MAX_CHECKOUT_BODY_BYTES)
                + "\"}";
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content(big))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error.code").value("payload_too_large"));
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("invalid_request"));
        verifyNoInteractions(checkoutService);
    }

    @Test
    void aRefusalCarriesItsCodeAndTheNewPrice() throws Exception {
        when(checkoutService.placeOrder(eq("inst-1"), any(), any(), anyBoolean(), any())).thenThrow(new CheckoutException(
                HttpStatus.CONFLICT, CheckoutException.PRICE_CHANGED, "The total of the cart has changed.",
                Map.of("price", Map.of("totals", Map.of("total", 1100)))));
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("price_changed"))
                .andExpect(jsonPath("$.error.details.price.totals.total").value(1100));
    }

    @Test
    void withoutAKeyOrTheFeatureNothingIsReached() throws Exception {
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.FEATURE_DISABLED, "off"))
                .when(guard).requireFeature("inst-1", CommerceFeature.ORDERS);
        for (String path : List.of("/orders/view", "/me/orders", "/me/addresses", "/me", "/checkout/config")) {
            mvc.perform(get(BASE + path)).andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.error.code").value("commerce_not_enabled"));
        }
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
        mvc.perform(post(BASE + "/orders/track").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());

        when(auth.authenticateUnmetered(any(), eq(CatalogApiAuth.SCOPE_READ))).thenThrow(
                new CatalogApiException(HttpStatus.UNAUTHORIZED, "missing_api_key", "Send your publishable key."));
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(checkoutService, queryService, checkoutConfig);
    }

    @Test
    void theOrderPageTakesTheTokenAndTrackTakesNumberAndPhoneToken() throws Exception {
        CheckoutDtos.OrderView view = CheckoutDtos.OrderView.builder().orderNumber("ORD-000007").status("CONFIRMED")
                .build();
        when(queryService.viewByToken("inst-1", "v1.a.b")).thenReturn(view);
        when(queryService.viewByToken(eq("inst-1"), isNull())).thenThrow(new CheckoutException(
                HttpStatus.FORBIDDEN, CheckoutException.TOKEN_INVALID, "The order link is not valid or has expired."));
        when(queryService.track("inst-1", "ORD-000007", "phone-token")).thenReturn(view);
        when(queryService.track(eq("inst-1"), eq("ORD-000008"), any())).thenThrow(
                new CheckoutException(HttpStatus.NOT_FOUND, CheckoutException.ORDER_NOT_FOUND, "Not found."));

        mvc.perform(get(BASE + "/orders/view").header(PublicCommerceCheckoutController.ORDER_TOKEN_HEADER, "v1.a.b"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.order_number").value("ORD-000007"))
                .andExpect(header().string("Cache-Control", "no-store"));
        // The token in the address is not read any more: the page is refused.
        mvc.perform(get(BASE + "/orders/view").param("token", "v1.a.b"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("token_invalid"));
        mvc.perform(post(BASE + "/orders/track").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"order_number\": \"ORD-000007\", \"phone_token\": \"phone-token\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CONFIRMED"));
        mvc.perform(post(BASE + "/orders/track").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"order_number\": \"ORD-000008\", \"phone_token\": \"phone-token\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("not_found"));
        verify(auth, org.mockito.Mockito.times(2)).rateLimit(eq(READER), any(), eq("order"), anyInt(), anyInt());
    }

    @Test
    void theBuyersRoutesTakeThePhoneTokenFromTheHeader() throws Exception {
        when(queryService.myOrders("inst-1", null, "phone-token", 1, 10)).thenReturn(CheckoutDtos.OrderPage.builder()
                .orders(List.of()).page(1).pageSize(10).total(0).build());
        when(queryService.myOrders(eq("inst-1"), isNull(), isNull(), anyInt(), anyInt())).thenThrow(new CheckoutException(
                HttpStatus.UNAUTHORIZED, CheckoutException.TOKEN_INVALID, "Verify your phone number to continue."));

        mvc.perform(get(BASE + "/me/orders").param("page", "1").param("page_size", "10")
                        .header(PublicCommerceCheckoutController.PHONE_TOKEN_HEADER, "phone-token"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.page_size").value(10));
        mvc.perform(get(BASE + "/me/orders"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("token_invalid"));
        mvc.perform(delete(BASE + "/me/addresses/addr-1")
                        .header(PublicCommerceCheckoutController.PHONE_TOKEN_HEADER, "phone-token"))
                .andExpect(status().isOk());
        verify(queryService).deleteMyAddress("inst-1", null, "phone-token", "addr-1");
    }

    @Test
    void theShopperSessionHeaderReachesEveryAccountRouteAndTheCheckout() throws Exception {
        when(checkoutService.placeOrder(eq("inst-1"), any(), any(), anyBoolean(), any())).thenReturn(placed());
        when(queryService.myOrders("inst-1", "s1.a.b", null, 0, 20)).thenReturn(CheckoutDtos.OrderPage.builder()
                .orders(List.of(CheckoutDtos.OrderSummary.builder().orderNumber("ORD-000003").status("CONFIRMED")
                        .placedAt("2026-11-15T10:00:00Z").masked(true).build()))
                .page(0).pageSize(20).total(1).build());

        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{}")
                        .header(PublicCommerceCheckoutController.SESSION_HEADER, "s1.a.b"))
                .andExpect(status().isOk());
        verify(checkoutService).placeOrder(eq("inst-1"), any(), any(), anyBoolean(), eq("s1.a.b"));

        // A masked row: number, status and date only.
        mvc.perform(get(BASE + "/me/orders").header(PublicCommerceCheckoutController.SESSION_HEADER, "s1.a.b"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.orders[0].masked").value(true))
                .andExpect(jsonPath("$.orders[0].order_number").value("ORD-000003"))
                .andExpect(jsonPath("$.orders[0].total").doesNotExist())
                .andExpect(jsonPath("$.orders[0].item_count").doesNotExist())
                .andExpect(jsonPath("$.orders[0].order_access_token").doesNotExist());
        mvc.perform(get(BASE + "/me/addresses").header(PublicCommerceCheckoutController.SESSION_HEADER, "s1.a.b"))
                .andExpect(status().isOk());
        verify(queryService).myAddresses("inst-1", "s1.a.b", null);
    }

    @Test
    void meLogoutAndConsent() throws Exception {
        CheckoutDtos.Account account = CheckoutDtos.Account.builder().name("Asha").phoneMasked("••••••3210")
                .emailMasked(null).marketingConsent(true).sessionExpiresAt("2026-11-22T10:00:00Z").build();
        when(queryService.me("inst-1", "s1.a.b", null)).thenReturn(account);
        when(queryService.setConsent("inst-1", "s1.a.b", null, true)).thenReturn(account);
        when(queryService.me("inst-1", "s1.old", null)).thenThrow(new CheckoutException(HttpStatus.UNAUTHORIZED,
                CheckoutException.SESSION_INVALID, "Your session has ended."));

        mvc.perform(get(BASE + "/me").header(PublicCommerceCheckoutController.SESSION_HEADER, "s1.a.b"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.phone_masked").value("••••••3210"))
                .andExpect(jsonPath("$.email_masked").isEmpty())
                .andExpect(jsonPath("$.marketing_consent").value(true))
                .andExpect(jsonPath("$.session_expires_at").value("2026-11-22T10:00:00Z"));
        mvc.perform(get(BASE + "/me").header(PublicCommerceCheckoutController.SESSION_HEADER, "s1.old"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("session_invalid"));

        mvc.perform(post(BASE + "/me/logout").header(PublicCommerceCheckoutController.SESSION_HEADER, "s1.a.b"))
                .andExpect(status().isNoContent());
        verify(queryService).logoutEverywhere("inst-1", "s1.a.b", null);

        mvc.perform(put(BASE + "/me/consent").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"marketing_consent\": true}")
                        .header(PublicCommerceCheckoutController.SESSION_HEADER, "s1.a.b"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.marketing_consent").value(true));
        verify(queryService).setConsent("inst-1", "s1.a.b", null, true);
        verify(auth, org.mockito.Mockito.atLeastOnce()).rateLimit(eq(READER), any(), eq("account"), anyInt(), anyInt());
    }

    @Test
    void theCheckoutConfigIsPublicShortLivedAndCarriesNoSecret() throws Exception {
        Map<String, Object> config = new java.util.LinkedHashMap<>();
        config.put("buyer_identity", "EITHER");
        config.put("bot_check", Map.of("required", true, "site_key", "0x4AAAA-public"));
        config.put("payment_methods", List.of("PREPAID"));
        when(checkoutConfig.config("inst-1")).thenReturn(config);

        mvc.perform(get(BASE + "/checkout/config"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "private, max-age=60"))
                .andExpect(jsonPath("$.buyer_identity").value("EITHER"))
                .andExpect(jsonPath("$.payment_methods[0]").value("PREPAID"));
        verify(auth).rateLimit(eq(READER), any(), eq("order"), anyInt(), anyInt());
        verify(checkoutService, never()).placeOrder(anyString(), any(), any(), anyBoolean(), any());
    }

    @Test
    void aRetryAndAConfirmationNameTheirOrderInThePath() throws Exception {
        when(checkoutService.retryPayment("inst-1", "order-1", "v1.a.b")).thenReturn(placed());
        when(checkoutService.confirmClientPayment("inst-1", "order-1", "order_gw_1", "pay_1", "sig"))
                .thenReturn(placed());

        mvc.perform(post(BASE + "/checkout/order-1/retry-payment").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"order_access_token\": \"v1.a.b\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.order_id").value("order-1"));
        mvc.perform(post(BASE + "/checkout/order-1/retry-payment")
                        .header(PublicCommerceCheckoutController.ORDER_TOKEN_HEADER, "v1.a.b"))
                .andExpect(status().isOk());
        mvc.perform(post(BASE + "/checkout/order-1/confirm-payment").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"gateway_order_id\": \"order_gw_1\", \"gateway_payment_id\": \"pay_1\", "
                                + "\"signature\": \"sig\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.order_id").value("order-1"));
    }
}
