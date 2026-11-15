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
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        auth = mock(CatalogApiAuth.class);
        guard = mock(CommerceAccessGuard.class);
        checkoutService = mock(CommerceCheckoutService.class);
        queryService = mock(CommerceOrderQueryService.class);
        when(auth.authenticateUnmetered(any(), eq(CatalogApiAuth.SCOPE_READ))).thenReturn(READER);
        mvc = MockMvcBuilders.standaloneSetup(new PublicCommerceCheckoutController(auth,
                        new StorefrontFeatureGate(guard), checkoutService, queryService, new ObjectMapper()))
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
        when(checkoutService.placeOrder(eq("inst-1"), any(), any(), anyBoolean())).thenReturn(placed());

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
                && "226001".equals(r.getShippingAddress().getPincode())), any(), anyBoolean());
    }

    @Test
    void theAddressOfTheLimitsIsTheOneTheRequestCameFrom_neverTheHeaderTheCallerChooses() throws Exception {
        when(checkoutService.placeOrder(eq("inst-1"), any(), any(), anyBoolean())).thenReturn(placed());

        // A server-side call (no Origin) that names a new shopper address each time.
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{}")
                        .header("CF-Connecting-IP", "203.0.113.7").header("X-Client-IP", "198.51.100.1"))
                .andExpect(status().isOk());
        // A browser call.
        mvc.perform(post(BASE + "/checkout").contentType(MediaType.APPLICATION_JSON).content("{}")
                        .header("CF-Connecting-IP", "203.0.113.8").header("Origin", "https://shop.example")
                        .header("X-Client-IP", "198.51.100.2"))
                .andExpect(status().isOk());

        verify(checkoutService).placeOrder(eq("inst-1"), any(), eq("203.0.113.7"), eq(true));
        verify(checkoutService).placeOrder(eq("inst-1"), any(), eq("203.0.113.8"), eq(false));
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
        when(checkoutService.placeOrder(eq("inst-1"), any(), any(), anyBoolean())).thenThrow(new CheckoutException(
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
        for (String path : List.of("/orders/view?token=t", "/me/orders", "/me/addresses")) {
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
        verifyNoInteractions(checkoutService, queryService);
    }

    @Test
    void theOrderPageTakesTheTokenAndTrackTakesNumberAndPhoneToken() throws Exception {
        CheckoutDtos.OrderView view = CheckoutDtos.OrderView.builder().orderNumber("ORD-000007").status("CONFIRMED")
                .build();
        when(queryService.viewByToken("inst-1", "v1.a.b")).thenReturn(view);
        when(queryService.track("inst-1", "ORD-000007", "phone-token")).thenReturn(view);
        when(queryService.track(eq("inst-1"), eq("ORD-000008"), any())).thenThrow(
                new CheckoutException(HttpStatus.NOT_FOUND, CheckoutException.ORDER_NOT_FOUND, "Not found."));

        mvc.perform(get(BASE + "/orders/view").param("token", "v1.a.b"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.order_number").value("ORD-000007"))
                .andExpect(header().string("Cache-Control", "no-store"));
        mvc.perform(post(BASE + "/orders/track").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"order_number\": \"ORD-000007\", \"phone_token\": \"phone-token\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CONFIRMED"));
        mvc.perform(post(BASE + "/orders/track").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"order_number\": \"ORD-000008\", \"phone_token\": \"phone-token\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("not_found"));
        verify(auth).rateLimit(eq(READER), any(), eq("order"), anyInt(), anyInt());
    }

    @Test
    void theBuyersRoutesTakeThePhoneTokenFromTheHeader() throws Exception {
        when(queryService.myOrders("inst-1", "phone-token", 1, 10)).thenReturn(CheckoutDtos.OrderPage.builder()
                .orders(List.of()).page(1).pageSize(10).total(0).build());
        when(queryService.myOrders(eq("inst-1"), isNull(), anyInt(), anyInt())).thenThrow(new CheckoutException(
                HttpStatus.UNAUTHORIZED, CheckoutException.TOKEN_INVALID, "Verify your phone number to continue."));

        mvc.perform(get(BASE + "/me/orders").param("page", "1").param("page_size", "10")
                        .header(PublicCommerceCheckoutController.PHONE_TOKEN_HEADER, "phone-token"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.page_size").value(10));
        mvc.perform(get(BASE + "/me/orders"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("token_invalid"));
        mvc.perform(delete(BASE + "/me/addresses/addr-1")
                        .header(PublicCommerceCheckoutController.PHONE_TOKEN_HEADER, "phone-token"))
                .andExpect(status().isOk());
        verify(queryService).deleteMyAddress("inst-1", "phone-token", "addr-1");
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
