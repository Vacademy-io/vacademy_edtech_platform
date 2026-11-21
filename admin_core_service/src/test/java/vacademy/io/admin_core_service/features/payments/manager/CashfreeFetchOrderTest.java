package vacademy.io.admin_core_service.features.payments.manager;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;
import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Cashfree get-order: URL, headers and the fields the webhook check reads. */
class CashfreeFetchOrderTest {

    private static final Map<String, Object> CONFIG = Map.of(
            "clientId", "app-id", "clientSecret", "secret", "baseUrl", "https://sandbox.cashfree.com/pg");

    private static CashfreePaymentManager manager(HttpStatus status, String body, AtomicReference<ClientRequest> seen) {
        WebClient.Builder builder = WebClient.builder().exchangeFunction(request -> {
            seen.set(request);
            return Mono.just(ClientResponse.create(status)
                    .header("Content-Type", "application/json")
                    .body(body)
                    .build());
        });
        return new CashfreePaymentManager(builder, new ObjectMapper());
    }

    @Test
    @DisplayName("reads order_status and order_amount with the institute's keys")
    void readsOrder() {
        AtomicReference<ClientRequest> seen = new AtomicReference<>();
        CashfreePaymentManager manager = manager(HttpStatus.OK,
                "{\"order_id\":\"MP1\",\"order_status\":\"PAID\",\"order_amount\":499.5,"
                        + "\"order_currency\":\"INR\",\"cf_order_id\":\"123\"}", seen);

        CashfreePaymentManager.CashfreeOrderStatus order = manager.fetchOrder("MP1", CONFIG);

        assertEquals("PAID", order.getOrderStatus());
        assertEquals(0, new BigDecimal("499.5").compareTo(order.getOrderAmount()));
        assertEquals("https://sandbox.cashfree.com/pg/orders/MP1", seen.get().url().toString());
        assertEquals("app-id", seen.get().headers().getFirst("x-client-id"));
        assertEquals("2025-01-01", seen.get().headers().getFirst("x-api-version"));
    }

    @Test
    @DisplayName("an order id with URL characters stays in its path segment")
    void encodesOrderId() {
        AtomicReference<ClientRequest> seen = new AtomicReference<>();
        manager(HttpStatus.OK, "{\"order_status\":\"ACTIVE\"}", seen).fetchOrder("a/b?c", CONFIG);
        assertEquals("https://sandbox.cashfree.com/pg/orders/a%2Fb%3Fc", seen.get().url().toString());
    }

    @Test
    @DisplayName("a gateway error or a missing order is an exception, not a status")
    void errorsThrow() {
        AtomicReference<ClientRequest> seen = new AtomicReference<>();
        assertThrows(VacademyException.class, () -> manager(HttpStatus.NOT_FOUND,
                "{\"message\":\"order not found\"}", seen).fetchOrder("MP1", CONFIG));
        assertThrows(VacademyException.class, () -> manager(HttpStatus.OK, "{}", seen).fetchOrder("MP1", CONFIG));
        assertThrows(VacademyException.class, () -> manager(HttpStatus.OK, "{}", seen)
                .fetchOrder("MP1", Map.of("baseUrl", "https://sandbox.cashfree.com/pg")));
    }
}
