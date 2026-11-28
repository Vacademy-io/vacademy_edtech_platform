package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.customer.CommerceShopperSessions;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.notify.repository.CommerceNotificationStore;
import vacademy.io.admin_core_service.features.commerce.order.dto.StaffOrderDtos;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.payment.CommercePaymentConfirmService;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderStatusHistoryRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDateTime;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The staff order detail lists the order's buyer messages (masked), and a failed read never fails the detail. */
class CommerceOrderQueryServiceNotificationsTest {

    private static final String INST = "inst-1";

    private CommerceOrderQueryService service;

    @BeforeEach
    void setUp() {
        CommerceOrderRepository orders = mock(CommerceOrderRepository.class);
        CommerceOrder order = new CommerceOrder();
        order.setId("o1");
        order.setInstituteId(INST);
        order.setOrderNumber("SH-000123");
        order.setStatus("CONFIRMED");
        order.setPaymentStatus("PAID");
        order.setPaymentMethod("PREPAID");
        order.setChannel("ONLINE");
        order.setCurrency("INR");
        order.setTotal(new BigDecimal("1499.00"));
        order.setCreatedAt(LocalDateTime.of(2026, 11, 15, 10, 0));
        when(orders.findByIdAndInstituteId("o1", INST)).thenReturn(Optional.of(order));
        service = new CommerceOrderQueryService(orders, mock(CommerceOrderLineRepository.class),
                mock(CommerceOrderTenderRepository.class), mock(CommerceOrderStatusHistoryRepository.class),
                mock(CommerceCustomerService.class), new CommerceOrderAccessTokens("unit-test-signing-key",
                Clock.systemUTC()), mock(VerifiedPhones.class), mock(CommerceShopperSessions.class),
                mock(CommercePaymentConfirmService.class), new ObjectMapper(), mock(PlatformTransactionManager.class));
    }

    @Test
    void theDetailCarriesTheMessagesNewestFirst() {
        CommerceNotificationStore store = mock(CommerceNotificationStore.class);
        Date at = new Date(1_700_000_000_000L);
        when(store.ofOrder(INST, "o1", 100)).thenReturn(List.of(
                new CommerceNotificationStore.DeliveryView("ORDER_SHIPPED", "WHATSAPP", "SENT", null, "hi",
                        "••••••3210", at, at),
                new CommerceNotificationStore.DeliveryView("ORDER_CONFIRMED", "EMAIL", "SKIPPED", "NO_EMAIL", "hi",
                        null, at, null)));
        service.setNotificationStore(store);

        StaffOrderDtos.StaffOrderDetail detail = service.staffDetail(INST, "o1");

        assertEquals(2, detail.getNotifications().size());
        assertEquals("ORDER_SHIPPED", detail.getNotifications().get(0).getTrigger());
        assertEquals("••••••3210", detail.getNotifications().get(0).getRecipientMasked());
        assertEquals("NO_EMAIL", detail.getNotifications().get(1).getCode());
    }

    @Test
    void withoutTheStoreOrWhenItFailsTheDetailIsStillAnswered() {
        assertNull(service.staffDetail(INST, "o1").getNotifications());

        CommerceNotificationStore failing = mock(CommerceNotificationStore.class);
        when(failing.ofOrder(INST, "o1", 100)).thenThrow(new IllegalStateException("down"));
        service.setNotificationStore(failing);
        StaffOrderDtos.StaffOrderDetail detail = service.staffDetail(INST, "o1");
        assertNotNull(detail);
        assertNull(detail.getNotifications());
    }

    @Test
    void anEmailIsMaskedTheSharedWay() {
        assertEquals("a•••@example.com", CommerceOrderQueryService.maskEmail("asha@example.com"));
        assertNull(CommerceOrderQueryService.maskEmail("@example.com"));
    }
}
