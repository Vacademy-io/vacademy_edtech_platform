package vacademy.io.admin_core_service.features.commerce.order.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceSellerLookup;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.cod.CommerceCodAvailability;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.pincode.CommercePincodeService;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator.Basis;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator.Tier;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TestTaxData;
import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabBasis;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabCompare;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxHead;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.product_page.service.BasketPricingCalculator;
import vacademy.io.admin_core_service.features.product_page.service.OfferCalculator;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponValidationService;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pricing of a counter sale ({@link CommerceOrderService.CounterPricing}): no website stock or
 * per-line maximum test, the counter's location as seller and place of supply, line and bill
 * discounts, no delivery and no COD. A null counter is the cart's pricing, unchanged.
 */
class CommerceOrderServiceCounterPricingTest {

    private static final String INSTITUTE = "inst-1";
    private static final String ONLINE_STATE = "09";
    private static final String STORE_STATE = "ZZ";
    private static final String STORE = "loc-store";
    private static final String OFFER_TEN_PERCENT = """
            {"offers": {"enabled": true, "rules": [
              {"id": "o10", "label": "10% off above 2000", "minAmount": 2000, "discountType": "PERCENTAGE",
               "discountValue": 10}]}}
            """;

    private CommerceStorefrontSettings storefrontSettings;
    private CommerceShippingRuleService shippingRuleService;
    private CommerceSellerLookup sellerLookup;
    private CommerceOrderService service;
    private final Map<String, CartVariant> variants = new LinkedHashMap<>();

    @BeforeEach
    void setUp() {
        storefrontSettings = mock(CommerceStorefrontSettings.class);
        StorefrontSnapshotLoader variantLoader = mock(StorefrontSnapshotLoader.class);
        shippingRuleService = mock(CommerceShippingRuleService.class);
        CommercePincodeService pincodeService = mock(CommercePincodeService.class);
        CommerceTaxSettingService taxSettingService = mock(CommerceTaxSettingService.class);
        CommerceTaxClassService taxClassService = mock(CommerceTaxClassService.class);
        sellerLookup = mock(CommerceSellerLookup.class);
        CommerceStockSettings stockSettings = mock(CommerceStockSettings.class);
        DocumentClock clock = mock(DocumentClock.class);

        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(null));
        when(variantLoader.cartVariants(eq(INSTITUTE), any(), any())).thenAnswer(call -> variants);
        when(variantLoader.onlineLocationId(INSTITUTE)).thenReturn("loc-1");
        when(shippingRuleService.activeRule(INSTITUTE)).thenReturn(new CommerceShippingCalculator.Rule("rule-1",
                Basis.WEIGHT, List.of(new Tier(null, new BigDecimal("90.00"))), null, new BigDecimal("40.00"),
                "tc-flat"));
        when(taxSettingService.context(INSTITUTE)).thenReturn(CommerceTaxContext.builder().configured(true)
                .mode(TaxMode.REGULAR).slabBasis(SlabBasis.NET_UNIT_PRICE).slabCompare(SlabCompare.TAX_EXCLUSIVE)
                .roundTotalTo(RoundTotalTo.NONE).sellerStateCode(ONLINE_STATE).build());
        when(taxClassService.loadRefs(eq(INSTITUTE), any())).thenReturn(Map.of(
                "tc-slab", TestTaxData.slabbedClassTest(), "tc-flat", TestTaxData.flatClassTest()));
        when(sellerLookup.resolve(eq(INSTITUTE), eq("loc-1"), any()))
                .thenReturn(CommerceSellerLookup.Seller.builder().stateCode(ONLINE_STATE).build());
        when(sellerLookup.resolve(eq(INSTITUTE), eq(STORE), any()))
                .thenReturn(CommerceSellerLookup.Seller.builder().stateCode(STORE_STATE).build());
        when(clock.today(INSTITUTE)).thenReturn(TestTaxData.DATE_TEST);

        service = new CommerceOrderService(storefrontSettings, variantLoader, shippingRuleService, pincodeService,
                taxSettingService, taxClassService, sellerLookup, stockSettings, clock,
                mock(CouponValidationService.class), new OfferCalculator(), new BasketPricingCalculator(),
                new CommerceCodAvailability(true));

        // "Cotton scarf": 2 left online. "Steel bottle": none left online.
        variants.put("ps-scarf", variant("ps-scarf", "SCARF", "500.00", 2));
        variants.put("ps-bottle", variant("ps-bottle", "BOTTLE", "300.00", 0));
    }

    private static StorefrontSettings settings(String rulesJson) {
        return new StorefrontSettings("en", 3, null, List.of(), Map.of(),
                new StorefrontSettings.Cod(true, new BigDecimal("5000.00"), new BigDecimal("3000.00"), Set.of()),
                rulesJson, 25, List.of());
    }

    private static CartVariant variant(String id, String sku, String price, Integer available) {
        return new CartVariant(id, "pkg-" + id, sku, "slug-" + id, true, true, true, false, "tc-slab", "PCS", 1, 1,
                500, available, sku, Map.of("en", "Product " + sku), new BigDecimal(price), null, "INR");
    }

    private static CartPriceRequest cart(CartPriceRequest.Line... lines) {
        return CartPriceRequest.builder().lines(new ArrayList<>(List.of(lines))).locale("en")
                .paymentMethod("COD").pincode("110001").build();
    }

    private static CartPriceRequest.Line line(String ref, String variantId, int quantity) {
        return CartPriceRequest.Line.builder().lineRef(ref).variantId(variantId).quantity(quantity).build();
    }

    private static CommerceOrderService.CounterPricing counter(Map<String, BigDecimal> lineDiscounts, String bill) {
        return new CommerceOrderService.CounterPricing(STORE, lineDiscounts, bill == null ? null : new BigDecimal(bill),
                bill == null ? null : "Regular customer");
    }

    private static void assertMoney(String expected, BigDecimal actual) {
        assertNotNull(actual);
        assertEquals(0, new BigDecimal(expected).compareTo(actual), "expected " + expected + " but was " + actual);
    }

    @Test
    void theCounterSkipsTheOnlineStockAndTheMaximumPerLine() {
        CommerceOrderService.CartPrice online = service.priceCart(INSTITUTE,
                cart(line("l1", "ps-scarf", 30), line("l2", "ps-bottle", 1)));
        assertEquals(2, online.view().getUnavailable().size());

        CommerceOrderService.CartPrice counter = service.priceCart(INSTITUTE,
                cart(line("l1", "ps-scarf", 30), line("l2", "ps-bottle", 1)), null, counter(Map.of(), null));

        assertTrue(counter.view().getUnavailable().isEmpty());
        assertEquals(2, counter.view().getLines().size());
    }

    @Test
    void theSellerAndThePlaceOfSupplyAreTheCountersLocation() {
        CartPriceSnapshot snapshot = service.priceCart(INSTITUTE, cart(line("l1", "ps-scarf", 1)), null,
                counter(Map.of(), null)).snapshot();

        assertEquals(STORE, snapshot.getFulfilmentLocationId());
        assertEquals(STORE_STATE, snapshot.getPlaceOfSupplyState());
        assertEquals(CommerceOrderService.PLACE_SOURCE_COUNTER, snapshot.getPlaceOfSupplySource());
        assertEquals(STORE_STATE, snapshot.getTaxRequest().getSellerStateCode());
        assertEquals(TaxHead.CGST_SGST, snapshot.getTax().getTaxHead());
        verify(sellerLookup).resolve(eq(INSTITUTE), eq(STORE), any());
    }

    @Test
    void noDeliveryChargeAndNoCodAtTheCounter() {
        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE, cart(line("l1", "ps-scarf", 1)), null,
                counter(Map.of(), null));

        assertMoney("0.00", priced.view().getTotals().getShipping());
        assertMoney("0.00", priced.view().getTotals().getCodCharge());
        assertEquals("PREPAID", priced.view().getPaymentMethod());
        assertMoney("500.00", priced.view().getTotals().getTotal());
        verify(shippingRuleService, never()).activeRule(INSTITUTE);
        assertTrue(priced.snapshot().getTax().getLines().stream()
                .allMatch(l -> l.getLineType() == TaxLineType.ITEM));
    }

    @Test
    void aLineDiscountIsTakenOnItsLineOnly() {
        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE,
                cart(line("l1", "ps-scarf", 2), line("l2", "ps-bottle", 1)), null,
                counter(Map.of("l1", new BigDecimal("100.00")), null));

        Map<String, TaxLineResult> byRef = new LinkedHashMap<>();
        priced.snapshot().getTax().getLines().forEach(l -> byRef.put(l.getLineRef(), l));
        assertMoney("100.00", byRef.get("l1").getLineDiscount());
        assertMoney("0.00", byRef.get("l2").getLineDiscount() == null ? BigDecimal.ZERO : byRef.get("l2").getLineDiscount());
        assertMoney("1300.00", priced.view().getTotals().getSubtotal());
        assertMoney("100.00", priced.view().getTotals().getDiscount());
        assertMoney("1200.00", priced.view().getTotals().getTotal());
    }

    @Test
    void theBillDiscountIsARowOfKindBillAllocatedToTheItems() {
        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE,
                cart(line("l1", "ps-scarf", 2), line("l2", "ps-bottle", 1)), null, counter(Map.of(), "50.00"));

        List<CartPriceSnapshot.Discount> rows = priced.snapshot().getDiscounts();
        assertEquals(1, rows.size());
        assertEquals(CommerceOrderService.KIND_BILL, rows.get(0).getKind());
        assertEquals("Regular customer", rows.get(0).getLabel());
        assertMoney("50.00", rows.get(0).getAmount());
        assertMoney("50.00", priced.snapshot().getTaxRequest().getOrderDiscount());
        BigDecimal allocated = priced.snapshot().getTax().getLines().stream().map(TaxLineResult::getOrderDiscount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        assertMoney("50.00", allocated);
        assertMoney("1250.00", priced.view().getTotals().getTotal());
    }

    @Test
    void offersApplyAfterLineDiscountsAndTheBillDiscountComesLast() {
        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(OFFER_TEN_PERCENT));
        // Goods 5 x 500 = 2500; line discount 100 -> 2400; offer 10% = 240 -> 2160; bill 60 -> 2100.
        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE, cart(line("l1", "ps-scarf", 5)), null,
                counter(Map.of("l1", new BigDecimal("100.00")), "60.00"));

        List<String> kinds = priced.snapshot().getDiscounts().stream().map(CartPriceSnapshot.Discount::getKind).toList();
        assertEquals(List.of("OFFER", "BILL"), kinds);
        assertMoney("240.00", priced.snapshot().getDiscounts().get(0).getAmount());
        assertMoney("2100.00", priced.view().getTotals().getTotal());
    }

    @Test
    void aBillDiscountAboveWhatIsLeftIsRefused() {
        CartPricingException e = assertThrows(CartPricingException.class, () -> service.priceCart(INSTITUTE,
                cart(line("l1", "ps-scarf", 1)), null, counter(Map.of("l1", new BigDecimal("400.00")), "100.01")));
        assertEquals(CartPricingException.CART_INVALID, e.getCode());
    }

    @Test
    void aLineDiscountAboveTheLineIsRefused() {
        CartPricingException e = assertThrows(CartPricingException.class, () -> service.priceCart(INSTITUTE,
                cart(line("l1", "ps-scarf", 1)), null, counter(Map.of("l1", new BigDecimal("500.01")), null)));
        assertEquals(CartPricingException.CART_INVALID, e.getCode());
    }

    @Test
    void aNullCounterIsTheCartAsBefore() {
        CartPriceRequest request = cart(line("l1", "ps-scarf", 1));
        CommerceOrderService.CartPrice three = service.priceCart(INSTITUTE, request, null);
        CommerceOrderService.CartPrice four = service.priceCart(INSTITUTE, request, null, null);

        CartPriceDtos.Totals a = three.view().getTotals();
        CartPriceDtos.Totals b = four.view().getTotals();
        assertMoney(a.getTotal().toPlainString(), b.getTotal());
        assertMoney(a.getShipping().toPlainString(), b.getShipping());
        assertMoney("90.00", b.getShipping());
        assertEquals(three.snapshot().getFulfilmentLocationId(), four.snapshot().getFulfilmentLocationId());
        assertEquals("loc-1", four.snapshot().getFulfilmentLocationId());
    }
}
