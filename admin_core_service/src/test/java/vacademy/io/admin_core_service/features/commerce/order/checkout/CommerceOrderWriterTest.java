package vacademy.io.admin_core_service.features.commerce.order.checkout;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.commerce.customer.entity.CommerceCustomer;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrder;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderLine;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderStatusHistory;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceOrderTender;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLegacyRepository.SaleLinkRow;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderLineRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderStatusHistoryRepository;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceOrderTenderRepository;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.stock_hold.entity.StockHold;
import vacademy.io.admin_core_service.features.stock_hold.enums.StockHoldKind;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;
import vacademy.io.admin_core_service.features.user_subscription.entity.AppliedCouponDiscount;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.AppliedCouponDiscountRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponRedemptionService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The rows of a placed order: the sums, the direct write of plans, logs and holds, and the one
 * coupon redemption. Every collaborator is a mock; no database, no gateway.
 */
class CommerceOrderWriterTest {

    private static final String INSTITUTE = "inst-1";
    private static final String USER = "user-1";

    private CommerceOrderRepository orderRepository;
    private CommerceOrderLineRepository lineRepository;
    private CommerceOrderTenderRepository tenderRepository;
    private CommerceOrderStatusHistoryRepository historyRepository;
    private CommerceOrderLegacyRepository legacyRepository;
    private CommerceCustomerService customerService;
    private StockHoldService stockHoldService;
    private UserPlanService userPlanService;
    private PaymentLogService paymentLogService;
    private AppliedCouponDiscountRepository appliedCouponDiscountRepository;
    private CouponRedemptionService couponRedemptionService;
    private CommerceOrderWriter writer;

    private final List<Double> logAmounts = new ArrayList<>();
    private final List<SaleLinkRow> links = new ArrayList<>();
    private final List<StockHold> holds = new ArrayList<>();

    @BeforeEach
    void setUp() {
        orderRepository = mock(CommerceOrderRepository.class);
        lineRepository = mock(CommerceOrderLineRepository.class);
        tenderRepository = mock(CommerceOrderTenderRepository.class);
        historyRepository = mock(CommerceOrderStatusHistoryRepository.class);
        legacyRepository = mock(CommerceOrderLegacyRepository.class);
        customerService = mock(CommerceCustomerService.class);
        stockHoldService = mock(StockHoldService.class);
        userPlanService = mock(UserPlanService.class);
        paymentLogService = mock(PaymentLogService.class);
        EnrollInviteRepository enrollInviteRepository = mock(EnrollInviteRepository.class);
        PaymentOptionRepository paymentOptionRepository = mock(PaymentOptionRepository.class);
        PaymentPlanRepository paymentPlanRepository = mock(PaymentPlanRepository.class);
        appliedCouponDiscountRepository = mock(AppliedCouponDiscountRepository.class);
        couponRedemptionService = mock(CouponRedemptionService.class);
        ObjectMapper objectMapper = new ObjectMapper().registerModule(new JavaTimeModule());

        writer = new CommerceOrderWriter(orderRepository, lineRepository, tenderRepository, historyRepository,
                legacyRepository, customerService, stockHoldService, userPlanService, paymentLogService,
                enrollInviteRepository, paymentOptionRepository, paymentPlanRepository,
                appliedCouponDiscountRepository, couponRedemptionService, objectMapper);

        when(enrollInviteRepository.findById(anyString())).thenAnswer(call -> {
            EnrollInvite invite = new EnrollInvite();
            invite.setId(call.getArgument(0));
            return Optional.of(invite);
        });
        when(paymentOptionRepository.findById(anyString())).thenAnswer(call -> {
            PaymentOption option = new PaymentOption();
            option.setId(call.getArgument(0));
            return Optional.of(option);
        });
        when(paymentPlanRepository.findById(anyString())).thenAnswer(call -> {
            PaymentPlan plan = new PaymentPlan();
            plan.setId(call.getArgument(0));
            return Optional.of(plan);
        });
        AtomicInteger planNo = new AtomicInteger();
        when(userPlanService.createUserPlan(anyString(), any(PaymentPlan.class), any(), any(EnrollInvite.class),
                any(PaymentOption.class), any(PaymentInitiationRequestDTO.class), anyString(), anyString(), any(),
                any(), any(), anyInt())).thenAnswer(call -> {
            UserPlan plan = new UserPlan();
            plan.setId("plan-" + planNo.incrementAndGet());
            return plan;
        });
        AtomicInteger logNo = new AtomicInteger();
        when(paymentLogService.createPaymentLog(anyString(), anyDouble(), anyString(), anyString(), anyString(),
                any(UserPlan.class), anyString())).thenAnswer(call -> {
            logAmounts.add(call.getArgument(1));
            return "log-" + logNo.incrementAndGet();
        });
        when(legacyRepository.findSaleLinks(eq(INSTITUTE), anyCollection())).thenAnswer(call -> links);
        when(legacyRepository.markLogsPending(anyCollection(), anyString()))
                .thenAnswer(call -> ((Collection<?>) call.getArgument(0)).size());
        when(stockHoldService.hold(eq(INSTITUTE), any(), eq(StockHoldKind.PURCHASE), anyInt()))
                .thenAnswer(call -> holds);
    }

    // ------------------------------------------------------------------ fixtures

    private static CommerceOrder order(String total) {
        CommerceOrder order = new CommerceOrder();
        order.setId("order-1");
        order.setInstituteId(INSTITUTE);
        order.setUserId(USER);
        order.setPaymentGroupId("group-1");
        order.setCurrency("INR");
        order.setTotal(new BigDecimal(total));
        order.setFulfilmentLocationId("loc-1");
        return order;
    }

    private static CommerceOrderLine item(String id, String session, int quantity, String unitPrice,
                                          String lineTotal) {
        CommerceOrderLine line = new CommerceOrderLine();
        line.setId(id);
        line.setLineType(CommerceOrderLine.TYPE_ITEM);
        line.setPackageSessionId(session);
        line.setQuantity(quantity);
        line.setUnitPrice(new BigDecimal(unitPrice));
        line.setLineTotal(new BigDecimal(lineTotal));
        return line;
    }

    private static CommerceOrderLine shipping(String id, String lineTotal) {
        CommerceOrderLine line = new CommerceOrderLine();
        line.setId(id);
        line.setLineType(CommerceOrderLine.TYPE_SHIPPING);
        line.setQuantity(1);
        line.setLineTotal(new BigDecimal(lineTotal));
        return line;
    }

    private void link(String session, String price) {
        link(session, price, "INR", "pp-" + session);
    }

    private void link(String session, String price, String currency, String planId) {
        SaleLinkRow row = mock(SaleLinkRow.class);
        when(row.getPackageSessionId()).thenReturn(session);
        when(row.getEnrollInviteId()).thenReturn("inv-" + session);
        when(row.getPaymentOptionId()).thenReturn("opt-" + session);
        when(row.getPaymentPlanId()).thenReturn(planId);
        when(row.getActualPrice()).thenReturn(price == null ? null : new BigDecimal(price));
        when(row.getCurrency()).thenReturn(currency);
        links.add(row);
    }

    private void held(String session) {
        StockHold hold = new StockHold();
        hold.setId("hold-" + session);
        hold.setPackageSessionId(session);
        hold.setReleaseToken("release-token");
        holds.add(hold);
    }

    private static BigDecimal sum(Collection<BigDecimal> amounts) {
        return amounts.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    // ------------------------------------------------------------------ sums

    @Test
    void logAmountsSumToTheOrderTotalWithDeliveryAndRoundOffOnTheLargestLine() {
        List<CommerceOrderLine> items = List.of(item("l1", "ps-a", 1, "499.50", "499.50"),
                item("l2", "ps-b", 2, "1050.20", "2100.40"), item("l3", "ps-c", 1, "10.00", "10.00"));
        // 2609.90 of goods + 80.00 delivery + 0.10 round-off.
        Map<String, BigDecimal> amounts = CommerceOrderWriter.logAmounts(new BigDecimal("2690.00"), items);
        assertEquals(new BigDecimal("499.50"), amounts.get("l1"));
        assertEquals(new BigDecimal("2180.50"), amounts.get("l2"));
        assertEquals(new BigDecimal("10.00"), amounts.get("l3"));
        assertEquals(0, sum(amounts.values()).compareTo(new BigDecimal("2690.00")));
    }

    @Test
    void aNegativeRoundOffIsTakenFromTheLargestLine() {
        List<CommerceOrderLine> items = List.of(item("l1", "ps-a", 1, "100.30", "100.30"),
                item("l2", "ps-b", 1, "50.10", "50.10"));
        Map<String, BigDecimal> amounts = CommerceOrderWriter.logAmounts(new BigDecimal("150.00"), items);
        assertEquals(new BigDecimal("99.90"), amounts.get("l1"));
        assertEquals(new BigDecimal("50.10"), amounts.get("l2"));
        assertEquals(0, sum(amounts.values()).compareTo(new BigDecimal("150.00")));
    }

    @Test
    void anOrderWhoseLinesAlreadySumToTheTotalIsLeftAlone() {
        List<CommerceOrderLine> items = List.of(item("l1", "ps-a", 3, "33.33", "99.99"));
        assertEquals(Map.of("l1", new BigDecimal("99.99")),
                CommerceOrderWriter.logAmounts(new BigDecimal("99.99"), items));
    }

    @Test
    void aTotalBelowWhatTheLinesAllowIsAnError() {
        List<CommerceOrderLine> items = List.of(item("l1", "ps-a", 1, "10.00", "10.00"),
                item("l2", "ps-b", 1, "5.00", "5.00"));
        assertThrows(IllegalStateException.class,
                () -> CommerceOrderWriter.logAmounts(new BigDecimal("4.00"), items));
    }

    // ------------------------------------------------------------------ lines of a snapshot

    @Test
    void linesAreBuiltFromTheStoredTaxResult() {
        TaxLineResult itemTax = TaxLineResult.builder().lineRef("r1").lineType(TaxLineType.ITEM).hsnCode("5208")
                .gross(new BigDecimal("2100.00")).lineDiscount(new BigDecimal("0.00"))
                .orderDiscount(new BigDecimal("100.00")).ratePercent(new BigDecimal("5"))
                .taxableValue(new BigDecimal("2000.00")).taxAmount(new BigDecimal("100.00")).build();
        TaxLineResult shippingTax = TaxLineResult.builder().lineRef("SHIPPING").lineType(TaxLineType.SHIPPING)
                .description("Delivery").gross(new BigDecimal("80.00")).ratePercent(new BigDecimal("5"))
                .taxableValue(new BigDecimal("80.00")).taxAmount(new BigDecimal("4.00")).build();
        CartPriceSnapshot snapshot = CartPriceSnapshot.builder()
                .lines(List.of(CartPriceSnapshot.Line.builder().lineRef("r1").packageSessionId("ps-a")
                        .packageId("pk-a").sku("SKU-A").name("Kurta").variantLabel("Red / M").quantity(2)
                        .qtyScale(1).unit("PCS").unitPrice(new BigDecimal("1050.00")).mrp(new BigDecimal("1200.00"))
                        .taxClassId("tc-1").weightGrams(300).build()))
                .tax(TaxResult.builder().lines(List.of(itemTax, shippingTax)).build())
                .build();

        List<CommerceOrderLine> lines = CommerceOrderWriter.buildLines(order("2184.00"), snapshot);

        assertEquals(2, lines.size());
        CommerceOrderLine item = lines.get(0);
        assertEquals(CommerceOrderLine.TYPE_ITEM, item.getLineType());
        assertEquals(1, item.getLineNo());
        assertEquals("order-1", item.getOrderId());
        assertEquals("ps-a", item.getPackageSessionId());
        assertEquals("Kurta", item.getNameSnapshot());
        assertEquals("SKU-A", item.getSkuSnapshot());
        assertEquals(2, item.getQuantity());
        assertEquals(new BigDecimal("1050.00"), item.getUnitPrice());
        assertEquals(new BigDecimal("2100.00"), item.getGross());
        assertEquals(new BigDecimal("100.00"), item.getDiscount());
        assertEquals(new BigDecimal("2000.00"), item.getTaxableValue());
        assertEquals(new BigDecimal("100.00"), item.getTaxAmount());
        assertEquals(new BigDecimal("2100.00"), item.getLineTotal());
        assertEquals("5208", item.getHsnCode());
        CommerceOrderLine delivery = lines.get(1);
        assertEquals(CommerceOrderLine.TYPE_SHIPPING, delivery.getLineType());
        assertEquals(2, delivery.getLineNo());
        assertNull(delivery.getPackageSessionId());
        assertEquals(new BigDecimal("84.00"), delivery.getLineTotal());
        assertEquals(1, delivery.getQuantity());
    }

    @Test
    void aCartLineWithoutATaxLineIsAnError() {
        CartPriceSnapshot snapshot = CartPriceSnapshot.builder()
                .lines(List.of(CartPriceSnapshot.Line.builder().lineRef("r1").packageSessionId("ps-a").quantity(1)
                        .qtyScale(1).unitPrice(new BigDecimal("10.00")).build()))
                .tax(TaxResult.builder().lines(List.of()).build())
                .build();
        assertThrows(IllegalStateException.class, () -> CommerceOrderWriter.buildLines(order("10.00"), snapshot));
    }

    // ------------------------------------------------------------------ writeMoneyRows

    @Test
    void onePlanAndOneLogPerItemLineInOneGroupAndNoEnrolment() {
        CommerceOrder order = order("2690.00");
        CommerceOrderLine a = item("l1", "ps-a", 1, "499.50", "499.50");
        CommerceOrderLine b = item("l2", "ps-b", 2, "1050.20", "2100.40");
        CommerceOrderLine delivery = shipping("l3", "84.00");
        link("ps-a", "499.50");
        link("ps-b", "1050.20");
        held("ps-a");
        held("ps-b");

        CommerceOrderWriter.MoneyRows rows = writer.writeMoneyRows(order, List.of(a, b, delivery), 15);

        // Plans: pending, bought by the user, with the line quantity, and without a coupon.
        verify(userPlanService, times(2)).createUserPlan(eq(USER), any(PaymentPlan.class), isNull(),
                any(EnrollInvite.class), any(PaymentOption.class), any(PaymentInitiationRequestDTO.class),
                eq("PENDING_FOR_PAYMENT"), eq("USER"), isNull(), isNull(), isNull(), anyInt());
        verify(userPlanService).createUserPlan(eq(USER), any(), isNull(), any(), any(), any(), anyString(),
                anyString(), isNull(), isNull(), isNull(), eq(2));
        // Logs: every one carries the order id as its order reference.
        verify(paymentLogService, times(2)).createPaymentLog(eq(USER), anyDouble(), eq("RAZORPAY"), eq("RAZORPAY"),
                eq("INR"), any(UserPlan.class), eq("order-1"));
        assertEquals(List.of("log-1", "log-2"), rows.paymentLogIds());
        assertEquals("log-1", rows.primaryPaymentLogId());
        verify(legacyRepository).markLogsPending(List.of("log-1", "log-2"), "group-1");

        // The amounts sum exactly to the order total; delivery rides on the largest line.
        assertEquals(List.of(499.50, 2190.50), logAmounts);
        assertEquals(new BigDecimal("499.50"), a.getLogAmount());
        assertEquals(new BigDecimal("2190.50"), b.getLogAmount());
        assertEquals(0, a.getLogAmount().add(b.getLogAmount()).compareTo(order.getTotal()));
        assertEquals("plan-1", a.getUserPlanId());
        assertEquals("log-1", a.getPaymentLogId());
        assertEquals("plan-2", b.getUserPlanId());
        assertEquals("log-2", b.getPaymentLogId());
        assertNull(delivery.getUserPlanId());
        assertNull(delivery.getPaymentLogId());

        // Holds: taken once for the order, each tied to its plan, all to the first log.
        ArgumentCaptor<Map<String, Integer>> quantities = ArgumentCaptor.forClass(Map.class);
        verify(stockHoldService).hold(eq(INSTITUTE), quantities.capture(), eq(StockHoldKind.PURCHASE), eq(15));
        assertEquals(Map.of("ps-a", 1, "ps-b", 2), quantities.getValue());
        verify(stockHoldService).attach(List.of(holds.get(0)), USER, "plan-1", null);
        verify(stockHoldService).attach(List.of(holds.get(1)), USER, "plan-2", null);
        verify(stockHoldService).attach(holds, null, null, "log-1");
        verify(legacyRepository).setHoldLocation(List.of("hold-ps-a", "hold-ps-b"), "loc-1");
        assertEquals("release-token", rows.releaseToken());
    }

    @Test
    void aStaffTypedPriceIsNotComparedWithTheCatalogueAndTheLogsCarryTheGivenVendor() {
        CommerceOrder order = order("900.00");
        CommerceOrderLine a = item("l1", "ps-a", 2, "450.00", "900.00");
        a.setPriceOverrideBy("manager-1");
        link("ps-a", "499.50");
        held("ps-a");

        writer.writeMoneyRows(order, List.of(a), 15, CommerceOrderWriter.VENDOR_OFFLINE);
        verify(paymentLogService).createPaymentLog(eq(USER), anyDouble(), eq("OFFLINE"), eq("OFFLINE"), eq("INR"),
                any(UserPlan.class), eq("order-1"));

        // Without the override the same price difference is a changed cart.
        CommerceOrderLine b = item("l2", "ps-a", 2, "450.00", "900.00");
        org.junit.jupiter.api.Assertions.assertThrows(RuntimeException.class,
                () -> writer.writeMoneyRows(order("900.00"), List.of(b), 15));
    }

    @Test
    void stockIsHeldBeforeAnyPlanOrLogIsWritten() {
        link("ps-a", "100.00");
        held("ps-a");
        writer.writeMoneyRows(order("100.00"), List.of(item("l1", "ps-a", 1, "100.00", "100.00")), 15);
        InOrder order = inOrder(legacyRepository, stockHoldService, userPlanService, paymentLogService);
        order.verify(legacyRepository).findSaleLinks(eq(INSTITUTE), anyCollection());
        order.verify(stockHoldService).hold(any(), any(), any(), anyInt());
        order.verify(userPlanService).createUserPlan(any(), any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any(), anyInt());
        order.verify(paymentLogService).createPaymentLog(any(), anyDouble(), any(), any(), any(), any(), any());
        order.verify(legacyRepository).markLogsPending(anyCollection(), anyString());
    }

    @Test
    void aMadeToOrderLineHasAPlanAndALogAndNoHold() {
        link("ps-a", "100.00");
        // hold() returns nothing for a variant that does not track stock.
        CommerceOrderWriter.MoneyRows rows = writer.writeMoneyRows(order("100.00"),
                List.of(item("l1", "ps-a", 1, "100.00", "100.00")), 15);
        assertEquals(List.of("log-1"), rows.paymentLogIds());
        assertNull(rows.releaseToken());
        verify(stockHoldService, never()).attach(any(), any(), any(), any());
        verify(legacyRepository, never()).setHoldLocation(any(), any());
    }

    @Test
    void aPackageSessionThatIsNotAVariantOfTheInstituteStopsTheOrder() {
        link("ps-a", "100.00");
        // ps-x has no sale link: another institute's session, or a course.
        CheckoutException e = assertThrows(CheckoutException.class, () -> writer.writeMoneyRows(order("150.00"),
                List.of(item("l1", "ps-a", 1, "100.00", "100.00"), item("l2", "ps-x", 1, "50.00", "50.00")), 15));
        assertEquals(CheckoutException.CART_CHANGED, e.getCode());
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        verify(stockHoldService, never()).hold(any(), any(), any(), anyInt());
        verifyNoInteractions(userPlanService, paymentLogService);
    }

    @Test
    void aPriceThatChangedSincePricingStopsTheOrder() {
        link("ps-a", "120.00");
        CheckoutException e = assertThrows(CheckoutException.class, () -> writer.writeMoneyRows(order("100.00"),
                List.of(item("l1", "ps-a", 1, "100.00", "100.00")), 15));
        assertEquals(CheckoutException.CART_CHANGED, e.getCode());
        verify(stockHoldService, never()).hold(any(), any(), any(), anyInt());
    }

    @Test
    void onlyTheFirstLinkOfAVariantDecidesAsInTheCart() {
        // The first link has no ACTIVE plan: the variant has no price, whatever a later link says.
        link("ps-a", null, "INR", null);
        link("ps-a", "100.00");
        assertThrows(CheckoutException.class, () -> writer.writeMoneyRows(order("100.00"),
                List.of(item("l1", "ps-a", 1, "100.00", "100.00")), 15));
    }

    @Test
    void theSameVariantOnTwoLinesIsRefused() {
        link("ps-a", "100.00");
        CheckoutException e = assertThrows(CheckoutException.class, () -> writer.writeMoneyRows(order("200.00"),
                List.of(item("l1", "ps-a", 1, "100.00", "100.00"), item("l2", "ps-a", 1, "100.00", "100.00")), 15));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
    }

    @Test
    void stockThatIsGoneIsA409AndNothingElseIsWritten() {
        link("ps-a", "100.00");
        when(stockHoldService.hold(eq(INSTITUTE), any(), eq(StockHoldKind.PURCHASE), anyInt()))
                .thenThrow(new ConflictException("Only 0 left of Kurta"));
        CheckoutException e = assertThrows(CheckoutException.class, () -> writer.writeMoneyRows(order("100.00"),
                List.of(item("l1", "ps-a", 1, "100.00", "100.00")), 15));
        assertEquals(CheckoutException.OUT_OF_STOCK, e.getCode());
        // The count of the legacy message is not passed on.
        assertTrue(!e.getMessage().contains("Only 0"));
        verifyNoInteractions(userPlanService, paymentLogService);
    }

    // ------------------------------------------------------------------ write

    private CommerceOrderWriter.NewOrder newOrder(CartPriceSnapshot snapshot) {
        return newOrder(snapshot, true, false, null);
    }

    private CommerceOrderWriter.NewOrder newOrder(CartPriceSnapshot snapshot, boolean phoneVerified,
                                                 boolean marketingConsent,
                                                 CommerceCustomerService.AddressInput remember) {
        return newOrder(snapshot, phoneVerified, phoneVerified, marketingConsent, remember);
    }

    private CommerceOrderWriter.NewOrder newOrder(CartPriceSnapshot snapshot, boolean phoneVerified, boolean holder,
                                                 boolean marketingConsent,
                                                 CommerceCustomerService.AddressInput remember) {
        return new CommerceOrderWriter.NewOrder(INSTITUTE, "ORD-000007", "req-12345678", "hash", USER,
                "919876543210", "Asha", "asha@example.com", Map.of("pincode", "226001", "state_code", "09"), null,
                remember, marketingConsent, null, null, null, snapshot, 15, phoneVerified, holder);
    }

    private CartPriceSnapshot snapshot(boolean withCoupon) {
        TaxLineResult itemTax = TaxLineResult.builder().lineRef("r1").lineType(TaxLineType.ITEM)
                .gross(new BigDecimal("1000.00")).lineDiscount(BigDecimal.ZERO)
                .orderDiscount(withCoupon ? new BigDecimal("100.00") : BigDecimal.ZERO)
                .taxableValue(withCoupon ? new BigDecimal("900.00") : new BigDecimal("1000.00"))
                .taxAmount(withCoupon ? new BigDecimal("45.00") : new BigDecimal("50.00")).build();
        BigDecimal total = withCoupon ? new BigDecimal("945.00") : new BigDecimal("1050.00");
        List<CartPriceSnapshot.Discount> discounts = withCoupon ? List.of(
                CartPriceSnapshot.Discount.builder().kind("OFFER").amount(BigDecimal.ZERO).build(),
                CartPriceSnapshot.Discount.builder().kind("COUPON").code("FEST10").amount(new BigDecimal("100.00"))
                        .couponCodeId("cc-1").appliedCouponDiscountId("acd-1").build()) : List.of();
        return CartPriceSnapshot.builder().version(1).instituteId(INSTITUTE).currency("INR").locale("hi")
                .paymentMethod("PREPAID").pincode("226001").placeOfSupplyState("09").fulfilmentLocationId("loc-1")
                .lines(List.of(CartPriceSnapshot.Line.builder().lineRef("r1").packageSessionId("ps-a").quantity(1)
                        .qtyScale(1).name("Kurta").sku("SKU-A").unitPrice(new BigDecimal("1000.00")).build()))
                .discounts(discounts)
                .tax(TaxResult.builder().lines(List.of(itemTax)).subtotal(new BigDecimal("1000.00"))
                        .discount(withCoupon ? new BigDecimal("100.00") : BigDecimal.ZERO)
                        .shipping(BigDecimal.ZERO).codCharge(BigDecimal.ZERO)
                        .taxAmount(itemTax.getTaxAmount()).roundOff(BigDecimal.ZERO).total(total).build())
                .total(total)
                .build();
    }

    private void stubSaves() {
        CommerceCustomer customer = new CommerceCustomer();
        customer.setId("cust-1");
        when(customerService.upsert(INSTITUTE, USER, "919876543210", "Asha", "asha@example.com"))
                .thenReturn(customer);
        when(orderRepository.saveAndFlush(any(CommerceOrder.class))).thenAnswer(call -> {
            CommerceOrder saved = call.getArgument(0);
            saved.setId("order-1");
            return saved;
        });
        when(orderRepository.save(any(CommerceOrder.class))).thenAnswer(call -> call.getArgument(0));
        AtomicInteger lineNo = new AtomicInteger();
        when(lineRepository.saveAll(any())).thenAnswer(call -> {
            List<CommerceOrderLine> saved = new ArrayList<>();
            for (CommerceOrderLine line : (Iterable<CommerceOrderLine>) call.getArgument(0)) {
                if (line.getId() == null) {
                    line.setId("line-" + lineNo.incrementAndGet());
                }
                saved.add(line);
            }
            return saved;
        });
        link("ps-a", "1000.00");
        held("ps-a");
    }

    @Test
    void anOrderIsWrittenPendingWithItsSnapshotATenderAndATimelineRow() {
        stubSaves();
        CommerceOrderWriter.Written written = writer.write(newOrder(snapshot(false)));

        CommerceOrder order = written.order();
        assertEquals("PENDING_PAYMENT", order.getStatus());
        assertEquals("UNPAID", order.getPaymentStatus());
        assertEquals("PREPAID", order.getPaymentMethod());
        assertEquals("ONLINE", order.getChannel());
        assertEquals("ORD-000007", order.getOrderNumber());
        assertEquals("req-12345678", order.getClientRequestId());
        assertEquals("hash", order.getRequestHash());
        assertEquals("cust-1", order.getCustomerId());
        assertEquals("09", order.getPlaceOfSupplyState());
        assertEquals(new BigDecimal("1050.00"), order.getTotal());
        assertEquals(new BigDecimal("0.00"), order.getAmountPaid());
        assertEquals("log-1", order.getPrimaryPaymentLogId());
        assertNotNull(order.getPaymentGroupId());
        assertNotNull(order.getHoldExpiresAt());
        assertTrue(order.getPriceSnapshotJson().contains("\"place_of_supply_state\":\"09\""));
        assertTrue(order.getShippingAddressJson().contains("226001"));
        // With no billing address the shipping address is the billing address.
        assertEquals(order.getShippingAddressJson(), order.getBillingAddressJson());
        assertEquals("release-token", written.releaseToken());
        assertEquals(1, written.lines().size());
        assertEquals(new BigDecimal("1050.00"), written.lines().get(0).getLogAmount());

        ArgumentCaptor<CommerceOrderTender> tender = ArgumentCaptor.forClass(CommerceOrderTender.class);
        verify(tenderRepository).save(tender.capture());
        assertEquals("PENDING", tender.getValue().getStatus());
        assertEquals("GATEWAY", tender.getValue().getMode());
        assertEquals(new BigDecimal("1050.00"), tender.getValue().getAmount());

        ArgumentCaptor<CommerceOrderStatusHistory> history = ArgumentCaptor.forClass(CommerceOrderStatusHistory.class);
        verify(historyRepository).save(history.capture());
        assertNull(history.getValue().getFromStatus());
        assertEquals("PENDING_PAYMENT", history.getValue().getToStatus());

        verifyNoInteractions(couponRedemptionService);
    }

    @Test
    void aCouponIsRedeemedExactlyOnceAndNeverHandedToAPlan() {
        stubSaves();
        AppliedCouponDiscount applied = new AppliedCouponDiscount();
        when(appliedCouponDiscountRepository.findById("acd-1")).thenReturn(Optional.of(applied));

        CommerceOrderWriter.Written written = writer.write(newOrder(snapshot(true)));

        verify(couponRedemptionService, times(1)).consume(applied);
        verify(userPlanService).createUserPlan(any(), any(), isNull(), any(), any(), any(), any(), any(), any(),
                any(), any(), anyInt());
        assertEquals("FEST10", written.order().getCouponCode());
        assertEquals("acd-1", written.order().getAppliedCouponDiscountId());
    }

    @Test
    void aCouponThatWasUsedUpInTheMeantimeStopsTheOrderBeforeAnythingIsWritten() {
        stubSaves();
        AppliedCouponDiscount applied = new AppliedCouponDiscount();
        when(appliedCouponDiscountRepository.findById("acd-1")).thenReturn(Optional.of(applied));
        org.mockito.Mockito.doThrow(new VacademyException("limit reached")).when(couponRedemptionService)
                .consume(applied);

        CheckoutException e = assertThrows(CheckoutException.class, () -> writer.write(newOrder(snapshot(true))));
        assertEquals(CheckoutException.COUPON_NOT_AVAILABLE, e.getCode());
        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        verify(stockHoldService, never()).hold(any(), any(), any(), anyInt());
        verifyNoInteractions(userPlanService, paymentLogService);
    }

    @Test
    void theCouponIsTouchedOnlyAfterTheOrderRowHoldsTheRequestKey() {
        // A duplicate of a request must fail on the unique key of the order, not on a coupon
        // its twin has used up: so the order is flushed first.
        stubSaves();
        AppliedCouponDiscount applied = new AppliedCouponDiscount();
        when(appliedCouponDiscountRepository.findById("acd-1")).thenReturn(Optional.of(applied));

        writer.write(newOrder(snapshot(true)));

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(orderRepository, couponRedemptionService,
                stockHoldService);
        order.verify(orderRepository).saveAndFlush(any(CommerceOrder.class));
        order.verify(couponRedemptionService).consume(applied);
        order.verify(stockHoldService).hold(any(), any(), any(), anyInt());
    }

    @Test
    void aDuplicateThatLosesTheRequestKeyNeverReachesTheCoupon() {
        stubSaves();
        when(orderRepository.saveAndFlush(any(CommerceOrder.class)))
                .thenThrow(new org.springframework.dao.DataIntegrityViolationException("uq_commerce_order_request"));

        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,
                () -> writer.write(newOrder(snapshot(true))));

        verifyNoInteractions(couponRedemptionService, appliedCouponDiscountRepository);
    }

    // ------------------------------------------------------------------ a typed phone proves nothing (M3)

    private static CommerceCustomerService.AddressInput address() {
        return new CommerceCustomerService.AddressInput("Home", "Other Buyer", "919876543210", "1 Other Lane", null,
                null, "Lucknow", "09", "226001", true);
    }

    @Test
    void withoutAProvedPhoneTheCustomerOfThatPhoneIsNotWrittenTo_noAccountNoConsentNoAddress() {
        stubSaves();
        CommerceCustomer owner = new CommerceCustomer();
        owner.setId("cust-owner");
        owner.setUserId("owner-user");
        when(customerService.findOrCreateUnverified(INSTITUTE, "919876543210")).thenReturn(owner);

        CommerceOrderWriter.Written written = writer.write(newOrder(snapshot(false), false, true, address()));

        // The order is written for the account of the e-mail, and nothing of the phone owner changes.
        assertEquals(USER, written.order().getUserId());
        verify(customerService).findOrCreateUnverified(INSTITUTE, "919876543210");
        verify(customerService, never()).upsert(any(), any(), any(), any(), any());
        verify(customerService, never()).recordConsent(any(), any());
        verify(customerService, never()).remember(any(), any(), any());
    }

    @Test
    void aProvedPhoneMayWriteItsConsentAndItsAddress() {
        stubSaves();

        writer.write(newOrder(snapshot(false), true, true, address()));

        verify(customerService).upsert(INSTITUTE, USER, "919876543210", "Asha", "asha@example.com");
        verify(customerService).recordConsent(any(CommerceCustomer.class), eq("CHECKOUT"));
        verify(customerService).remember(eq(INSTITUTE), eq("cust-1"), any());
        verify(customerService, never()).findOrCreateUnverified(any(), any());
    }

    // ------------------------------------------------------------------ P2

    @Test
    void theCustomerRowKeepsOnlyAHoldersAccount_anEmailAccountBesideAProvedPhoneIsNotWritten() {
        stubSaves();
        CommerceCustomer customer = new CommerceCustomer();
        customer.setId("cust-1");
        when(customerService.upsert(INSTITUTE, null, "919876543210", "Asha", "asha@example.com")).thenReturn(customer);

        CommerceOrderWriter.Written written = writer.write(newOrder(snapshot(false), true, false, false, null));

        // The order is the e-mail account's; the phone's row gets no account from it.
        assertEquals(USER, written.order().getUserId());
        verify(customerService).upsert(INSTITUTE, null, "919876543210", "Asha", "asha@example.com");
        verify(customerService, never()).upsert(INSTITUTE, USER, "919876543210", "Asha", "asha@example.com");
    }

    @Test
    void theOrderRecordsWhetherThePhoneWasProved() {
        stubSaves();
        CommerceCustomer owner = new CommerceCustomer();
        owner.setId("cust-1");
        when(customerService.findOrCreateUnverified(INSTITUTE, "919876543210")).thenReturn(owner);

        assertEquals(Boolean.TRUE, writer.write(newOrder(snapshot(false), true, true, false, null)).order()
                .getPhoneVerified());
        assertEquals(Boolean.FALSE, writer.write(newOrder(snapshot(false), false, false, false, null)).order()
                .getPhoneVerified());
    }

    @Test
    void theStockIsHeldThreeMinutesLongerThanTheOrderSoTheFinalFetchRunsFirst() {
        stubSaves();

        CommerceOrderWriter.Written written = writer.write(newOrder(snapshot(false)));

        verify(stockHoldService).hold(eq(INSTITUTE), any(), eq(StockHoldKind.PURCHASE),
                eq(15 + CommerceOrderWriter.FINAL_FETCH_GRACE_MINUTES));
        long orderMinutes = (written.order().getHoldExpiresAt().getTime() - System.currentTimeMillis()) / 60_000L;
        assertTrue(orderMinutes >= 14 && orderMinutes <= 15, "the order's own time stays the shop's hold time");
    }

    // ------------------------------------------------------------------ cash on delivery (WP-31)

    /** 1000 + 5 % tax + a 40.00 COD charge, priced for COD. */
    private static CartPriceSnapshot codSnapshot() {
        TaxLineResult itemTax = TaxLineResult.builder().lineRef("r1").lineType(TaxLineType.ITEM)
                .gross(new BigDecimal("1000.00")).lineDiscount(BigDecimal.ZERO).orderDiscount(BigDecimal.ZERO)
                .taxableValue(new BigDecimal("1000.00")).taxAmount(new BigDecimal("50.00")).build();
        TaxLineResult codTax = TaxLineResult.builder().lineRef("COD_CHARGE").lineType(TaxLineType.COD_CHARGE)
                .description("Cash on delivery charge").gross(new BigDecimal("40.00")).lineDiscount(BigDecimal.ZERO)
                .orderDiscount(BigDecimal.ZERO).taxableValue(new BigDecimal("40.00")).taxAmount(BigDecimal.ZERO)
                .build();
        BigDecimal total = new BigDecimal("1090.00");
        return CartPriceSnapshot.builder().version(1).instituteId(INSTITUTE).currency("INR").locale("hi")
                .paymentMethod("COD").pincode("226001").placeOfSupplyState("09").fulfilmentLocationId("loc-1")
                .lines(List.of(CartPriceSnapshot.Line.builder().lineRef("r1").packageSessionId("ps-a").quantity(1)
                        .qtyScale(1).name("Kurta").sku("SKU-A").unitPrice(new BigDecimal("1000.00")).build()))
                .discounts(List.of())
                .tax(TaxResult.builder().lines(List.of(itemTax, codTax)).subtotal(new BigDecimal("1000.00"))
                        .discount(BigDecimal.ZERO).shipping(BigDecimal.ZERO).codCharge(new BigDecimal("40.00"))
                        .taxAmount(new BigDecimal("50.00")).roundOff(BigDecimal.ZERO).total(total).build())
                .total(total)
                .build();
    }

    @Test
    void aCodOrderIsConfirmedItsStockSoldItsLogsOfflineAndItsTenderACodAmount() {
        stubSaves();
        when(legacyRepository.markLogsOffline(anyCollection(), anyString(), anyString()))
                .thenAnswer(call -> ((Collection<?>) call.getArgument(0)).size());

        CommerceOrderWriter.Written written = writer.write(newOrder(codSnapshot()),
                new CommerceOrderWriter.CodPlacement(false, null));

        CommerceOrder order = written.order();
        assertEquals("CONFIRMED", order.getStatus());
        assertNotNull(order.getConfirmedAt());
        assertNull(order.getCodConfirmDueAt());
        assertEquals("COD", order.getPaymentMethod());
        assertEquals("UNPAID", order.getPaymentStatus());
        assertEquals(new BigDecimal("1090.00"), order.getCodAmount());
        assertEquals(new BigDecimal("40.00"), order.getCodCharge());
        assertNull(order.getHoldExpiresAt(), "nothing expires a COD order");
        assertEquals(Boolean.TRUE, order.getPhoneVerified());
        assertNull(written.releaseToken(), "a sold hold has nothing to release");
        // The COD charge is a line of its own; the one item log carries the whole total.
        assertEquals(2, written.lines().size());
        assertEquals(CommerceOrderLine.TYPE_COD_CHARGE, written.lines().get(1).getLineType());
        assertEquals(new BigDecimal("40.00"), written.lines().get(1).getLineTotal());
        assertEquals(new BigDecimal("1090.00"), written.lines().get(0).getLogAmount());

        InOrder sold = inOrder(stockHoldService, legacyRepository);
        sold.verify(stockHoldService).hold(eq(INSTITUTE), any(), eq(StockHoldKind.PURCHASE), eq(15));
        sold.verify(stockHoldService).markSoldNow(holds);
        verify(paymentLogService).createPaymentLog(eq(USER), anyDouble(), eq("OFFLINE"), eq("OFFLINE"), eq("INR"),
                any(UserPlan.class), eq("order-1"));
        verify(legacyRepository).markLogsOffline(List.of("log-1"), order.getPaymentGroupId(), "COD");

        ArgumentCaptor<CommerceOrderTender> tender = ArgumentCaptor.forClass(CommerceOrderTender.class);
        verify(tenderRepository).save(tender.capture());
        assertEquals("COD", tender.getValue().getMode());
        assertEquals("PENDING", tender.getValue().getStatus());
        assertEquals(new BigDecimal("1090.00"), tender.getValue().getAmount());

        ArgumentCaptor<CommerceOrderStatusHistory> history = ArgumentCaptor.forClass(CommerceOrderStatusHistory.class);
        verify(historyRepository).save(history.capture());
        assertNull(history.getValue().getFromStatus());
        assertEquals("CONFIRMED", history.getValue().getToStatus());
    }

    @Test
    void aCodOrderAboveTheConfirmAmountWaitsForStaffUntilItsDueTime() {
        stubSaves();
        when(legacyRepository.markLogsOffline(anyCollection(), anyString(), anyString()))
                .thenAnswer(call -> ((Collection<?>) call.getArgument(0)).size());
        java.util.Date due = new java.util.Date(System.currentTimeMillis() + 48 * 3_600_000L);

        CommerceOrder order = writer.write(newOrder(codSnapshot()), new CommerceOrderWriter.CodPlacement(true, due))
                .order();

        assertEquals("COD_PENDING_CONFIRMATION", order.getStatus());
        assertEquals(due, order.getCodConfirmDueAt());
        assertNull(order.getConfirmedAt());
        verify(stockHoldService).markSoldNow(holds);
    }

    @Test
    void aCodOrderNeedsAProvedPhoneAndACartPricedForCod() {
        stubSaves();
        CommerceOrderWriter.CodPlacement cod = new CommerceOrderWriter.CodPlacement(false, null);
        assertThrows(IllegalStateException.class,
                () -> writer.write(newOrder(codSnapshot(), false, false, null), cod));
        assertThrows(IllegalStateException.class, () -> writer.write(newOrder(snapshot(false)), cod));
        verify(stockHoldService, never()).markSoldNow(any());
        verify(paymentLogService, never()).createPaymentLog(anyString(), anyDouble(), anyString(), anyString(),
                anyString(), any(UserPlan.class), anyString());
    }

    @Test
    void aCodOrderWhoseLogsCannotBeMarkedIsRolledBack() {
        stubSaves();
        when(legacyRepository.markLogsOffline(anyCollection(), anyString(), anyString())).thenReturn(0);
        assertThrows(IllegalStateException.class, () -> writer.write(newOrder(codSnapshot()),
                new CommerceOrderWriter.CodPlacement(false, null)));
        verify(tenderRepository, never()).save(any());
    }
}
