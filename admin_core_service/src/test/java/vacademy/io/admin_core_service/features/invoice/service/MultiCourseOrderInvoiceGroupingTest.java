package vacademy.io.admin_core_service.features.invoice.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Which payment logs end up on ONE invoice.
 *
 * A product-page checkout writes a parent log holding the gateway total plus a
 * child log per course, all sharing the parent's id as their order id. Grouping
 * used to require an order id starting with "MP" (the legacy multi-package
 * convention), so a real ₹949 four-subject order produced FOUR invoices
 * totalling ₹1,396 — and four payment-confirmation emails, none matching the
 * learner's bank.
 *
 * These cases pin both halves of the decision: who gets grouped, and whether the
 * grouped lines state what they were charged or merely repeat the order total.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class MultiCourseOrderInvoiceGroupingTest {

    private static final String ORDER_ID = "a43c6c06-9150-4b65-9600-848867f03cbf";
    private static final String INSTITUTE = "5ad8a70e-150f-4f99-afb6-01e2022da032";

    @Mock
    private PaymentLogRepository paymentLogRepository;
    @Mock
    private InvoicePaymentLogMappingRepository invoicePaymentLogMappingRepository;

    @InjectMocks
    private InvoiceService invoiceService;

    private PaymentLog parent;
    private List<PaymentLog> children;

    private static PaymentLog log(String id, String orderId, Double amount, boolean withPlan) {
        PaymentLog pl = new PaymentLog();
        pl.setId(id);
        pl.setPaymentStatus("PAID");
        pl.setPaymentAmount(amount);
        pl.setPaymentSpecificData("{\"originalRequest\":{\"order_id\":\"" + orderId + "\"}}");
        if (withPlan) {
            pl.setUserPlan(new UserPlan());
        }
        return pl;
    }

    @BeforeEach
    void setUp() {
        // The parent is the only log that records the children it paid for — that
        // record is what marks the order as a parent/child fan-out.
        parent = log(ORDER_ID, ORDER_ID, 949d, false);
        parent.setPaymentSpecificData(
                "{\"originalRequest\":{\"order_id\":\"" + ORDER_ID + "\"},"
                        + "\"childPaymentLogIds\":[\"c1\",\"c2\",\"c3\",\"c4\"]}");

        children = new ArrayList<>();
        for (int i = 1; i <= 4; i++) {
            children.add(log("c" + i, ORDER_ID, i == 1 ? 237.25 : 237.25, true));
        }

        List<PaymentLog> all = new ArrayList<>();
        all.add(parent);
        all.addAll(children);

        when(paymentLogRepository.findAllByOrderIdInOriginalRequest(ORDER_ID)).thenReturn(all);
        when(paymentLogRepository.findById(ORDER_ID)).thenReturn(Optional.of(parent));
        lenient().when(invoicePaymentLogMappingRepository.existsByPaymentLogId(anyString())).thenReturn(false);
    }

    @Test
    @DisplayName("groups every course of the order onto one invoice")
    void groupsAllFourCourses() {
        List<PaymentLog> grouped =
                invoiceService.findRelatedPaymentLogsForMultiPackage(children.get(0), INSTITUTE);
        assertEquals(4, grouped.size(), "one invoice covering all four courses");
    }

    @Test
    @DisplayName("leaves the ORDER's own log out of the line items")
    void excludesTheParent() {
        List<PaymentLog> grouped =
                invoiceService.findRelatedPaymentLogsForMultiPackage(children.get(0), INSTITUTE);
        assertFalse(grouped.stream().anyMatch(pl -> ORDER_ID.equals(pl.getId())),
                "the parent carries the gateway total and no UserPlan; including it "
                        + "would double the invoice and NPE the builder");
        assertTrue(grouped.stream().allMatch(pl -> pl.getUserPlan() != null));
    }

    @Test
    @DisplayName("prices those lines from what each was actually charged")
    void usesPerLineAmounts() {
        List<PaymentLog> grouped =
                invoiceService.findRelatedPaymentLogsForMultiPackage(children.get(0), INSTITUTE);
        assertTrue(invoiceService.logsCarryTheirOwnAmount(grouped),
                "a parent/child order allocates the real total across its children, so "
                        + "falling back to plan list price would re-inflate the basket");
    }

    @Test
    @DisplayName("a course already invoiced is not pulled into a second one")
    void skipsAlreadyInvoiced() {
        when(invoicePaymentLogMappingRepository.existsByPaymentLogId("c2")).thenReturn(true);
        when(invoicePaymentLogMappingRepository.existsByPaymentLogId("c3")).thenReturn(true);
        when(invoicePaymentLogMappingRepository.existsByPaymentLogId("c4")).thenReturn(true);
        List<PaymentLog> grouped =
                invoiceService.findRelatedPaymentLogsForMultiPackage(children.get(0), INSTITUTE);
        // Only one uninvoiced line left, so there is nothing to group — it falls
        // back to the single-log path exactly as before.
        assertEquals(1, grouped.size());
        assertEquals("c1", grouped.get(0).getId());
    }

    @Test
    @DisplayName("an unpaid sibling never reaches the invoice")
    void skipsUnpaid() {
        children.get(3).setPaymentStatus("PAYMENT_PENDING");
        List<PaymentLog> grouped =
                invoiceService.findRelatedPaymentLogsForMultiPackage(children.get(0), INSTITUTE);
        assertEquals(3, grouped.size());
    }

    @Test
    @DisplayName("a single-course order is untouched")
    void singleCourseOrderUnchanged() {
        // One child still has a parent recording it, so the detector fires — but a
        // lone line cannot be grouped, and the old single-log path must survive.
        PaymentLog only = children.get(0);
        when(paymentLogRepository.findAllByOrderIdInOriginalRequest(ORDER_ID))
                .thenReturn(List.of(parent, only));
        List<PaymentLog> grouped = invoiceService.findRelatedPaymentLogsForMultiPackage(only, INSTITUTE);
        assertEquals(1, grouped.size());
        assertEquals(only, grouped.get(0));
        assertTrue(invoiceService.logsCarryTheirOwnAmount(grouped));
    }

    @Test
    @DisplayName("the legacy MP flow keeps pricing its lines from the plan")
    void legacyMultiPackageUnchanged() {
        // MP copies the whole order total onto every child, so summing their
        // amounts would multiply the invoice. There is no parent log at all.
        String mpOrder = "MP" + "0123456789abcdef0123456789abcdef";
        List<PaymentLog> mpLogs = new ArrayList<>();
        for (int i = 1; i <= 3; i++) {
            mpLogs.add(log("mp" + i, mpOrder, 300d, true));
        }
        when(paymentLogRepository.findAllByOrderIdInOriginalRequest(mpOrder)).thenReturn(mpLogs);
        when(paymentLogRepository.findById(mpOrder)).thenReturn(Optional.empty());

        List<PaymentLog> grouped =
                invoiceService.findRelatedPaymentLogsForMultiPackage(mpLogs.get(0), INSTITUTE);
        assertEquals(3, grouped.size(), "MP still groups, exactly as before");
        assertFalse(invoiceService.logsCarryTheirOwnAmount(grouped),
                "MP children repeat the order total, so lines must come from the plan");
    }

    @Test
    @DisplayName("an ordinary standalone payment is not a parent/child order")
    void plainOrderIsNotParentChild() {
        assertFalse(invoiceService.isParentChildOrderId(null));
        assertFalse(invoiceService.isParentChildOrderId("   "));
        when(paymentLogRepository.findById("solo")).thenReturn(Optional.of(log("solo", "solo", 349d, true)));
        assertFalse(invoiceService.isParentChildOrderId("solo"),
                "a log with no childPaymentLogIds is nobody's parent");
    }
}
