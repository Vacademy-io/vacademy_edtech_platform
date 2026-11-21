package vacademy.io.admin_core_service.features.commerce.order.cod;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.commerce.order.cod.dto.CodRemittanceDtos;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The remittance routes hand each call to the service; a new remittance is 201, a repeat 200. Bodies are snake_case. */
class CommerceCodRemittanceControllerTest {

    private final CustomUserDetails user = mock(CustomUserDetails.class);

    @Test
    void recordIs201AndARepeatIs200() {
        CommerceCodRemittanceService service = mock(CommerceCodRemittanceService.class);
        CommerceCodRemittanceController controller = new CommerceCodRemittanceController(service);
        CodRemittanceDtos.RemittanceRequest request = CodRemittanceDtos.RemittanceRequest.builder().build();
        CodRemittanceDtos.RemittanceView view = CodRemittanceDtos.RemittanceView.builder().id("rem-1").build();
        when(service.record(user, "inst-1", request)).thenReturn(new CommerceCodRemittanceService.Recorded(view, true));
        assertEquals(HttpStatus.CREATED, controller.record("inst-1", request, user).getStatusCode());
        assertSame(view, controller.record("inst-1", request, user).getBody());
        when(service.record(user, "inst-1", request)).thenReturn(new CommerceCodRemittanceService.Recorded(view, false));
        assertEquals(HttpStatus.OK, controller.record("inst-1", request, user).getStatusCode());

        CodRemittanceDtos.RemittancePage page = CodRemittanceDtos.RemittancePage.builder().items(List.of()).build();
        LocalDate from = LocalDate.of(2026, 11, 1);
        when(service.list(user, "inst-1", from, null, 1, 10)).thenReturn(page);
        assertSame(page, controller.list("inst-1", from, null, 1, 10, user).getBody());
        when(service.get(user, "inst-1", "rem-1")).thenReturn(view);
        assertSame(view, controller.get("rem-1", "inst-1", user).getBody());
    }

    @Test
    void theBodiesAreSnakeCase() throws Exception {
        ObjectMapper json = new ObjectMapper().registerModule(new JavaTimeModule());
        CodRemittanceDtos.RemittanceRequest request = json.readValue("""
                {"client_request_id": "remit-key-0001", "reference": "STMT-1", "courier_name": "Courier",
                 "received_on": "2026-11-16", "gross_amount": 1090.00, "deductions": 30, "net_amount": 1060.00,
                 "difference_reason": null, "note": "n", "order_ids": ["o-1"], "unknown": 1}
                """, CodRemittanceDtos.RemittanceRequest.class);
        assertEquals("remit-key-0001", request.getClientRequestId());
        assertEquals(LocalDate.of(2026, 11, 16), request.getReceivedOn());
        assertEquals(new BigDecimal("1060.00"), request.getNetAmount());
        assertEquals(List.of("o-1"), request.getOrderIds());
        String view = json.writeValueAsString(CodRemittanceDtos.RemittanceView.builder().id("rem-1")
                .grossAmount(new BigDecimal("1090.00")).ordersTotal(new BigDecimal("1090.00")).orderCount(1)
                .orders(List.of(CodRemittanceDtos.RemittedOrder.builder().orderId("o-1").orderNumber("ORD-1")
                        .codAmount(new BigDecimal("1090.00")).build())).build());
        for (String key : List.of("\"gross_amount\"", "\"orders_total\"", "\"order_count\"", "\"order_number\"",
                "\"cod_amount\"")) {
            assertTrue(view.contains(key), key + " in " + view);
        }
    }
}
