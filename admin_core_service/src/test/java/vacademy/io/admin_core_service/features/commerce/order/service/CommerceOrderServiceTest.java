package vacademy.io.admin_core_service.features.commerce.order.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceSellerLookup;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.order.cod.CodEligibility;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.pincode.CommercePincodeService;
import vacademy.io.admin_core_service.features.commerce.order.pincode.PincodeStates;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator.Basis;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator.Tier;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceStockSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
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
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateRequestDTO;
import vacademy.io.admin_core_service.features.user_subscription.dto.coupon.CouponValidateResponseDTO;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponValidationMessages;
import vacademy.io.admin_core_service.features.user_subscription.service.coupon.CouponValidationService;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Cart pricing. The discount calculators and the tax calculator are the real ones; only the
 * reads are stubbed. Tax classes are the TEST placeholders of {@link TestTaxData}.
 */
class CommerceOrderServiceTest {

    private static final String INSTITUTE = "inst-1";
    private static final String UP = "09";
    private static final String OFFER_TEN_PERCENT = """
            {"offers": {"enabled": true, "rules": [
              {"id": "o10", "label": "10% off above 2000", "minAmount": 2000, "discountType": "PERCENTAGE",
               "discountValue": 10}]}}
            """;

    private CommerceStorefrontSettings storefrontSettings;
    private StorefrontSnapshotLoader variantLoader;
    private CommerceShippingRuleService shippingRuleService;
    private CommerceTaxSettingService taxSettingService;
    private CommerceTaxClassService taxClassService;
    private CouponValidationService couponValidationService;
    private CommerceOrderService service;

    private final Map<String, CartVariant> variants = new LinkedHashMap<>();

    @BeforeEach
    void setUp() {
        storefrontSettings = mock(CommerceStorefrontSettings.class);
        variantLoader = mock(StorefrontSnapshotLoader.class);
        shippingRuleService = mock(CommerceShippingRuleService.class);
        CommercePincodeService pincodeService = mock(CommercePincodeService.class);
        taxSettingService = mock(CommerceTaxSettingService.class);
        taxClassService = mock(CommerceTaxClassService.class);
        CommerceSellerLookup sellerLookup = mock(CommerceSellerLookup.class);
        CommerceStockSettings stockSettings = mock(CommerceStockSettings.class);
        DocumentClock clock = mock(DocumentClock.class);
        couponValidationService = mock(CouponValidationService.class);

        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(null, true));
        when(variantLoader.cartVariants(eq(INSTITUTE), any(), any())).thenAnswer(call -> variants);
        when(variantLoader.onlineLocationId(INSTITUTE)).thenReturn("loc-1");
        when(shippingRuleService.activeRule(INSTITUTE)).thenReturn(weightRule(null));
        when(pincodeService.lookup(any())).thenAnswer(call -> {
            String pin = call.getArgument(0);
            return PincodeStates.isValid(pin) ? new CommercePincodeService.Pincode(pin, null,
                    PincodeStates.stateCode(pin), null, CommercePincodeService.SOURCE_PIN_PREFIX) : null;
        });
        when(taxSettingService.context(INSTITUTE)).thenReturn(context(RoundTotalTo.NONE));
        when(taxClassService.loadRefs(eq(INSTITUTE), any())).thenReturn(Map.of(
                "tc-slab", TestTaxData.slabbedClassTest(), "tc-flat", TestTaxData.flatClassTest()));
        when(sellerLookup.resolve(eq(INSTITUTE), eq("loc-1"), any()))
                .thenReturn(CommerceSellerLookup.Seller.builder().stateCode(UP).build());
        when(clock.today(INSTITUTE)).thenReturn(TestTaxData.DATE_TEST);

        service = new CommerceOrderService(storefrontSettings, variantLoader, shippingRuleService, pincodeService,
                taxSettingService, taxClassService, sellerLookup, stockSettings, clock, couponValidationService,
                new OfferCalculator(), new BasketPricingCalculator());

        variants.put("ps-a", variant("ps-a", "SKU-A", "1050.00", 10, 1, 1));
        variants.put("ps-b", variant("ps-b", "SKU-B", "500.00", 10, 1, 1));
    }

    // ------------------------------------------------------------------ fixtures

    private static StorefrontSettings settings(String rulesJson, boolean codEnabled) {
        return new StorefrontSettings("hi", 3, null, List.of(), Map.of(),
                new StorefrontSettings.Cod(codEnabled, new BigDecimal("5000.00"), new BigDecimal("3000.00"),
                        Set.of("190001")), rulesJson, 25, List.of());
    }

    private static CommerceTaxContext context(RoundTotalTo roundTo) {
        return CommerceTaxContext.builder().configured(true).mode(TaxMode.REGULAR)
                .slabBasis(SlabBasis.NET_UNIT_PRICE).slabCompare(SlabCompare.TAX_EXCLUSIVE).roundTotalTo(roundTo)
                .sellerStateCode(UP).build();
    }

    /** Up to 1 kg: 60; above: 90. COD charge 40. Charges are taxed with the flat TEST class. */
    private static CommerceShippingCalculator.Rule weightRule(String freeAbove) {
        return new CommerceShippingCalculator.Rule("rule-1", Basis.WEIGHT,
                List.of(new Tier(new BigDecimal("1000"), new BigDecimal("60.00")), new Tier(null, new BigDecimal("90.00"))),
                freeAbove == null ? null : new BigDecimal(freeAbove), new BigDecimal("40.00"), "tc-flat");
    }

    private static CartVariant variant(String id, String sku, String price, Integer available, int qtyScale,
                                       int qtyStep) {
        return new CartVariant(id, "pkg-" + id, sku, "slug-" + id, true, true, available != null, false, "tc-slab",
                qtyScale > 1 ? "MTR" : "PCS", qtyScale, qtyStep, 500, available, sku,
                Map.of("en", "Product " + sku, "hi", "उत्पाद " + sku), price == null ? null : new BigDecimal(price),
                null, "INR");
    }

    private static CartPriceRequest.Line line(String variantId, int quantity) {
        return CartPriceRequest.Line.builder().variantId(variantId).quantity(quantity).build();
    }

    private static CartPriceRequest cart(CartPriceRequest.Line... lines) {
        return CartPriceRequest.builder().lines(new ArrayList<>(List.of(lines))).locale("en").build();
    }

    private static void assertMoney(String expected, BigDecimal actual) {
        assertNotNull(actual);
        assertEquals(0, new BigDecimal(expected).compareTo(actual), "expected " + expected + " but was " + actual);
    }

    private void coupon(String code, CouponValidateResponseDTO answer) {
        when(couponValidationService.validate(any())).thenAnswer(call -> {
            CouponValidateRequestDTO request = call.getArgument(0);
            return code.equalsIgnoreCase(request.getCouponCode()) ? answer
                    : CouponValidateResponseDTO.builder().valid(false).message(CouponValidationMessages.INVALID).build();
        });
    }

    // ------------------------------------------------------------------ totals

    @Test
    void aCartWithAnOfferACouponDeliveryAndTaxInclusivePricesAddsUp() {
        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(OFFER_TEN_PERCENT, true));
        coupon("SAVE45", CouponValidateResponseDTO.builder().valid(true).couponCodeId("cc-1")
                .appliedCouponDiscountId("acd-1").discountType("FLAT").discountValue(45.0)
                .message(CouponValidationMessages.VALID).build());
        CartPriceRequest request = cart(line("ps-a", 1), line("ps-b", 2));
        request.setCouponCode("save45");

        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE, request);
        CartPriceDtos.CartPrice view = priced.view();

        // Goods 1050 + 2 x 500 = 2050. Offer 10% = 205 -> 1845. Coupon 45 -> 1800.
        // Weight 3 x 500 g = 1500 g -> 90 delivery. Prices include tax, so the total is 1890.
        assertMoney("2050.00", view.getTotals().getSubtotal());
        assertMoney("250.00", view.getTotals().getDiscount());
        assertMoney("90.00", view.getTotals().getShipping());
        assertMoney("0.00", view.getTotals().getCodCharge());
        assertMoney("0.00", view.getTotals().getRoundOff());
        assertMoney("1890.00", view.getTotals().getTotal());
        assertEquals("PREPAID", view.getPaymentMethod());
        assertEquals(List.of("OFFER", "COUPON"), view.getDiscounts().stream().map(CartPriceDtos.Discount::getKind)
                .toList());
        assertMoney("205.00", view.getDiscounts().get(0).getAmount());
        assertMoney("45.00", view.getDiscounts().get(1).getAmount());
        assertTrue(view.getCoupon().isApplied());
        assertEquals("SAVE45", view.getCoupon().getCode());

        // The coupon was computed on what was left after the offer, and counted three units.
        verify(couponValidationService).validate(org.mockito.ArgumentMatchers.argThat(r ->
                r.getTotalAmount() == 1845.0 && r.getItemCount() == 3 && INSTITUTE.equals(r.getInstituteId())));

        // Tax is inside the prices: taxable value + tax = total, line by line and in the totals.
        CartPriceDtos.Tax tax = view.getTax();
        assertMoney("1890.00", tax.getTaxableValue().add(tax.getTaxAmount()));
        assertMoney(tax.getTaxAmount().toPlainString(), tax.getCgst().add(tax.getSgst()).add(tax.getIgst())
                .add(tax.getCess()));
        BigDecimal lineNet = BigDecimal.ZERO;
        BigDecimal lineDiscount = BigDecimal.ZERO;
        for (CartPriceDtos.Line line : view.getLines()) {
            assertMoney(line.getNet().toPlainString(), line.getGross().subtract(line.getDiscount()));
            assertMoney(line.getNet().toPlainString(), line.getTaxableValue().add(line.getTaxAmount()));
            lineNet = lineNet.add(line.getNet());
            lineDiscount = lineDiscount.add(line.getDiscount());
        }
        assertMoney("1800.00", lineNet);
        assertMoney("250.00", lineDiscount);
        // The discount is shared by value: 1050/2050 and 1000/2050 of 250.
        assertMoney("128.05", view.getLines().get(0).getDiscount());
        assertMoney("121.95", view.getLines().get(1).getDiscount());

        assertMoney("90.00", view.getShipping().getCharge());
        assertEquals("WEIGHT", view.getShipping().getBasis());
    }

    @Test
    void theStoredSnapshotReproducesThePriceWithTheSameCalculator() {
        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(OFFER_TEN_PERCENT, true));
        when(taxSettingService.context(INSTITUTE)).thenReturn(context(RoundTotalTo.RUPEE));
        variants.put("ps-c", variant("ps-c", "SKU-C", "333.33", 10, 1, 1));
        CartPriceRequest request = cart(line("ps-a", 1), line("ps-b", 3), line("ps-c", 7));
        request.setPincode("400001");

        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE, request);
        CartPriceSnapshot snapshot = priced.snapshot();

        // Checkout and the invoice run the stored request through the same calculator: same result, to the paisa.
        TaxResult again = new CommerceTaxCalculator().calculate(snapshot.getTaxRequest());
        assertEquals(snapshot.getTax(), again);
        assertEquals(CartPriceSnapshot.CURRENT_VERSION, snapshot.getVersion());

        // The public totals are the calculator's own figures; nothing is rounded a second time.
        TaxResult tax = snapshot.getTax();
        CartPriceDtos.Totals totals = priced.view().getTotals();
        assertEquals(tax.getSubtotal(), totals.getSubtotal());
        assertEquals(tax.getDiscount(), totals.getDiscount());
        assertEquals(tax.getShipping(), totals.getShipping());
        assertEquals(tax.getRoundOff(), totals.getRoundOff());
        assertEquals(tax.getTotal(), totals.getTotal());
        assertEquals(tax.getTotal(), snapshot.getTotal());
        assertEquals(tax.getTaxAmount(), priced.view().getTax().getTaxAmount());

        // Rounded to the rupee, with the difference in round_off and never on a line.
        assertEquals(0, totals.getTotal().remainder(BigDecimal.ONE).signum());
        BigDecimal net = tax.getLines().stream().map(TaxLineResult::getNet).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertMoney(totals.getTotal().toPlainString(), net.add(totals.getRoundOff()));
        assertMoney(totals.getTotal().toPlainString(), totals.getSubtotal().subtract(totals.getDiscount())
                .add(totals.getShipping()).add(totals.getCodCharge()).add(totals.getRoundOff()));

        // Mumbai from an Uttar Pradesh seller: IGST, and the snapshot says where the state came from.
        assertEquals(TaxHead.IGST, tax.getTaxHead());
        assertEquals("27", snapshot.getPlaceOfSupplyState());
        assertEquals("PIN_PREFIX", snapshot.getPlaceOfSupplySource());
        assertEquals("loc-1", snapshot.getFulfilmentLocationId());
        assertEquals(List.of("ps-a", "ps-b", "ps-c"), snapshot.getLines().stream()
                .map(CartPriceSnapshot.Line::getPackageSessionId).toList());
        assertEquals("tc-slab", snapshot.getLines().get(0).getTaxClassId());
    }

    @Test
    void thePriceOfTheClientIsNeverUsed() {
        CartPriceRequest.Line cheap = line("ps-a", 1);
        cheap.setUnitPrice(new BigDecimal("1.00"));

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(cheap)).view();

        assertMoney("1050.00", view.getLines().get(0).getUnitPrice());
        assertMoney("1050.00", view.getTotals().getSubtotal());
        assertEquals(1, view.getChanges().size());
        assertEquals("PRICE_CHANGED", view.getChanges().get(0).getType());
        assertMoney("1.00", view.getChanges().get(0).getOldUnitPrice());
        assertMoney("1050.00", view.getChanges().get(0).getNewUnitPrice());

        CartPriceRequest.Line same = line("ps-a", 1);
        same.setUnitPrice(new BigDecimal("1050"));
        assertTrue(service.priceCart(INSTITUTE, cart(same)).view().getChanges().isEmpty());
    }

    @Test
    void withoutAPincodeTheTaxIsSplitForTheSellerStateAndMarkedAsNotKnown() {
        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(line("ps-b", 1))).view();
        assertEquals("CGST_SGST", view.getTax().getHead());
        assertFalse(view.getTax().isPlaceOfSupplyKnown());
        assertEquals(view.getTax().getCgst(), view.getTax().getSgst());
        assertMoney("0.00", view.getTax().getIgst());

        CartPriceRequest request = cart(line("ps-b", 1));
        request.setStateCode("27");
        CartPriceDtos.CartPrice other = service.priceCart(INSTITUTE, request).view();
        // A state without a pincode is used as sent.
        assertEquals("IGST", other.getTax().getHead());
        assertTrue(other.getTax().isPlaceOfSupplyKnown());
        assertEquals(view.getTotals().getTotal(), other.getTotals().getTotal());
    }

    // ------------------------------------------------------------------ delivery

    @Test
    void deliveryIsFreeFromTheThresholdAndTheAmountMissingIsReported() {
        when(shippingRuleService.activeRule(INSTITUTE)).thenReturn(weightRule("1000.00"));

        CartPriceDtos.CartPrice below = service.priceCart(INSTITUTE, cart(line("ps-b", 1))).view();
        assertMoney("60.00", below.getShipping().getCharge());
        assertMoney("500.00", below.getShipping().getRemainingForFree());
        assertFalse(below.getShipping().isFree());
        assertMoney("560.00", below.getTotals().getTotal());

        CommerceOrderService.CartPrice at = service.priceCart(INSTITUTE, cart(line("ps-b", 2)));
        assertMoney("0.00", at.view().getShipping().getCharge());
        assertMoney("60.00", at.view().getShipping().getChargeBeforeFree());
        assertTrue(at.view().getShipping().isFree());
        assertMoney("0.00", at.view().getShipping().getRemainingForFree());
        assertMoney("1000.00", at.view().getTotals().getTotal());
        assertTrue(at.snapshot().getTax().getLines().stream().noneMatch(l -> l.getLineType() == TaxLineType.SHIPPING));
    }

    @Test
    void theFreeThresholdIsComparedWithWhatIsPaidForTheGoods() {
        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(OFFER_TEN_PERCENT, true));
        when(shippingRuleService.activeRule(INSTITUTE)).thenReturn(weightRule("2000.00"));

        // 2050 of goods, 205 off: 1845 is below 2000, so delivery is charged.
        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(line("ps-a", 1), line("ps-b", 2))).view();
        assertMoney("90.00", view.getShipping().getCharge());
        assertMoney("155.00", view.getShipping().getRemainingForFree());
    }

    @Test
    void aShopWithNoShippingRuleChargesNoDelivery() {
        when(shippingRuleService.activeRule(INSTITUTE)).thenReturn(null);
        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(line("ps-b", 1))).view();
        assertMoney("0.00", view.getShipping().getCharge());
        assertNull(view.getShipping().getBasis());
        assertMoney("500.00", view.getTotals().getTotal());
    }

    @Test
    void aStaffOrderIsPricedAtTheTypedPriceWithTheCatalogueOneKeptAndDeliveryWaived() {
        when(shippingRuleService.activeRule(INSTITUTE)).thenReturn(weightRule("2000.00"));
        CartPriceRequest request = cart(CartPriceRequest.Line.builder().lineRef("L1").variantId("ps-b").quantity(2)
                .build());
        CommerceOrderService.CartPrice typed = service.priceCart(INSTITUTE, request,
                new CommerceOrderService.StaffPricing(java.util.Map.of("L1", new BigDecimal("450.00")), false));
        assertMoney("450.00", typed.snapshot().getLines().get(0).getUnitPrice());
        assertMoney("500.00", typed.snapshot().getLines().get(0).getListUnitPrice());
        assertMoney("0.00", typed.view().getShipping().getCharge());
        assertMoney("900.00", typed.view().getTotals().getTotal());
        assertTrue(typed.view().getChanges().isEmpty(), "a typed price is not a price change");

        // No staff pricing: the cart as the shop prices it, delivery charged.
        CommerceOrderService.CartPrice cart = service.priceCart(INSTITUTE, cart(CartPriceRequest.Line.builder()
                .lineRef("L1").variantId("ps-b").quantity(2).build()), null);
        assertMoney("500.00", cart.snapshot().getLines().get(0).getUnitPrice());
        assertNull(cart.snapshot().getLines().get(0).getListUnitPrice());
        assertTrue(cart.view().getShipping().getCharge().signum() > 0);
    }

    // ------------------------------------------------------------------ COD

    @Test
    void codAddsItsChargeAsALineOfItsOwnWhenTheCartQualifies() {
        CartPriceRequest request = cart(line("ps-b", 1));
        request.setPaymentMethod("COD");
        request.setPincode("226001");

        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE, request);
        CartPriceDtos.CartPrice view = priced.view();

        assertEquals("COD", view.getPaymentMethod());
        assertTrue(view.getCod().isEligible());
        assertNull(view.getCod().getReason());
        assertTrue(view.getCod().isOtpRequired());
        assertTrue(view.getCod().isPincodeChecked());
        assertFalse(view.getCod().isNeedsStaffConfirmation());
        assertMoney("40.00", view.getTotals().getCodCharge());
        // 500 + 60 delivery + 40 COD.
        assertMoney("600.00", view.getTotals().getTotal());
        assertMoney("600.00", view.getCod().getTotalWithCod());
        assertTrue(priced.snapshot().getTax().getLines().stream().anyMatch(l -> l.getLineType() == TaxLineType.COD_CHARGE));
        assertEquals("COD", priced.snapshot().getPaymentMethod());
    }

    @Test
    void aPrepaidCartStillSaysWhetherCodWouldBeAllowedButChargesNothingForIt() {
        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(line("ps-b", 1))).view();
        assertEquals("PREPAID", view.getPaymentMethod());
        assertTrue(view.getCod().isEligible());
        assertFalse(view.getCod().isPincodeChecked());
        assertMoney("40.00", view.getCod().getCharge());
        assertMoney("0.00", view.getTotals().getCodCharge());
        assertMoney("560.00", view.getTotals().getTotal());
    }

    @Test
    void codIsRefusedWithAReasonAndTheCartIsPricedAsPrepaid() {
        // Above the seller's maximum of 5000 (5 x 1050 + 90 + 40).
        CartPriceRequest big = cart(line("ps-a", 5));
        big.setPaymentMethod("COD");
        CartPriceDtos.CartPrice above = service.priceCart(INSTITUTE, big).view();
        assertFalse(above.getCod().isEligible());
        assertEquals(CodEligibility.ORDER_ABOVE_COD_LIMIT, above.getCod().getReason());
        assertEquals("PREPAID", above.getPaymentMethod());
        assertMoney("0.00", above.getTotals().getCodCharge());
        assertMoney("5340.00", above.getTotals().getTotal());

        // A blocked pincode.
        CartPriceRequest blocked = cart(line("ps-b", 1));
        blocked.setPaymentMethod("COD");
        blocked.setPincode("190001");
        assertEquals(CodEligibility.PINCODE_BLOCKED, service.priceCart(INSTITUTE, blocked).view().getCod().getReason());

        // COD switched off.
        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(null, false));
        CartPriceRequest off = cart(line("ps-b", 1));
        off.setPaymentMethod("cod");
        CartPriceDtos.CartPrice disabled = service.priceCart(INSTITUTE, off).view();
        assertEquals(CodEligibility.COD_DISABLED, disabled.getCod().getReason());
        assertEquals("PREPAID", disabled.getPaymentMethod());
    }

    @Test
    void aCodOrderAboveTheConfirmAmountNeedsACall() {
        CartPriceRequest request = cart(line("ps-a", 3));
        request.setPaymentMethod("COD");
        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, request).view();
        // 3150 + 90 + 40 = 3280: allowed (not above 5000) and above 3000.
        assertTrue(view.getCod().isEligible());
        assertTrue(view.getCod().isNeedsStaffConfirmation());
        assertMoney("3280.00", view.getTotals().getTotal());
    }

    // ------------------------------------------------------------------ lines that cannot be bought

    @Test
    void aLineThatCannotBeBoughtGetsAReasonAndTheRestIsPriced() {
        variants.put("ps-out", variant("ps-out", "SKU-OUT", "100.00", 0, 1, 1));
        variants.put("ps-low", variant("ps-low", "SKU-LOW", "100.00", 2, 1, 1));
        variants.put("ps-many", variant("ps-many", "SKU-MANY", "100.00", 20, 1, 1));
        variants.put("ps-free", variant("ps-free", "SKU-FREE", "0.00", 5, 1, 1));
        variants.put("ps-noplan", variant("ps-noplan", "SKU-NOPLAN", null, 5, 1, 1));
        CartVariant draft = variant("ps-draft", "SKU-DRAFT", "100.00", 5, 1, 1);
        variants.put("ps-draft", new CartVariant(draft.packageSessionId(), draft.packageId(), draft.sku(),
                draft.slug(), false, true, true, false, draft.taxClassId(), draft.unit(), 1, 1, 500, 5, draft.sku(),
                draft.names(), draft.price(), null, "INR"));

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(
                line("ps-b", 1), line("ps-unknown", 1), line("ps-out", 1), line("ps-low", 3), line("ps-many", 24),
                line("ps-free", 1), line("ps-noplan", 1), line("ps-draft", 1), line("ps-a", 0))).view();

        Map<String, CartPriceDtos.UnavailableLine> byRef = new LinkedHashMap<>();
        view.getUnavailable().forEach(u -> byRef.put(u.getLineRef(), u));
        assertEquals("NOT_FOUND", byRef.get("ps-unknown").getReason());
        assertEquals("OUT_OF_STOCK", byRef.get("ps-out").getReason());
        assertEquals("INSUFFICIENT_STOCK", byRef.get("ps-low").getReason());
        // Two left with a threshold of three: the number may be shown.
        assertEquals(2, byRef.get("ps-low").getAvailableQuantity());
        // Twenty left: not enough for twenty-four, but the count stays private.
        assertEquals("INSUFFICIENT_STOCK", byRef.get("ps-many").getReason());
        assertNull(byRef.get("ps-many").getAvailableQuantity());
        assertEquals("NO_PRICE", byRef.get("ps-free").getReason());
        assertEquals("NO_PRICE", byRef.get("ps-noplan").getReason());
        // A product that is not ACTIVE answers like an unknown one, and names nothing.
        assertEquals("NOT_FOUND", byRef.get("ps-draft").getReason());
        assertNull(byRef.get("ps-draft").getSku());
        assertEquals("QUANTITY_INVALID", byRef.get("ps-a").getReason());
        assertEquals(8, view.getUnavailable().size());
        assertEquals(8, view.getChanges().stream().filter(c -> c.getType().equals("UNAVAILABLE")).count());

        // The one good line is priced.
        assertEquals(List.of("ps-b"), view.getLines().stream().map(CartPriceDtos.Line::getVariantId).toList());
        assertMoney("560.00", view.getTotals().getTotal());
        assertEquals(1, view.getTotals().getLineCount());
    }

    @Test
    void aCartWithNothingBuyableAnswersZeroAndNoSnapshot() {
        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE, cart(line("ps-unknown", 1)));
        assertNull(priced.snapshot());
        assertMoney("0.00", priced.view().getTotals().getTotal());
        assertTrue(priced.view().getLines().isEmpty());
        assertEquals("NOT_FOUND", priced.view().getUnavailable().get(0).getReason());
        assertEquals(CodEligibility.CART_EMPTY, priced.view().getCod().getReason());
        verify(taxSettingService, never()).context(any());
    }

    @Test
    void quantitiesFollowTheStepOfTheProductAndAreCountedInBaseUnits() {
        // Cloth by the metre: base unit 10 cm, sold in steps of 50 cm, 12.50 for 10 cm, 30 m in stock.
        variants.put("ps-cloth", variant("ps-cloth", "CLOTH", "12.50", 300, 10, 5));

        CartPriceDtos.CartPrice wrong = service.priceCart(INSTITUTE, cart(line("ps-cloth", 12))).view();
        assertEquals("QUANTITY_STEP", wrong.getUnavailable().get(0).getReason());
        assertEquals(5, wrong.getUnavailable().get(0).getQtyStep());

        CommerceOrderService.CartPrice right = service.priceCart(INSTITUTE, cart(line("ps-cloth", 25)));
        CartPriceDtos.Line line = right.view().getLines().get(0);
        assertEquals(25, line.getQuantity());
        assertEquals(10, line.getQtyScale());
        assertMoney("312.50", line.getGross());
        // 500 g a metre, 2.5 m: 1250 g -> the second weight tier.
        assertEquals(1250, right.snapshot().getShipping().getWeightGrams());
        assertMoney("90.00", right.view().getShipping().getCharge());
    }

    @Test
    void twoLinesOfOneVariantCannotTogetherTakeMoreThanTheStock() {
        variants.put("ps-few", variant("ps-few", "FEW", "100.00", 3, 1, 1));
        CartPriceRequest.Line first = CartPriceRequest.Line.builder().lineRef("l1").variantId("ps-few").quantity(2).build();
        CartPriceRequest.Line second = CartPriceRequest.Line.builder().lineRef("l2").variantId("ps-few").quantity(2).build();

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(first, second)).view();

        assertEquals(List.of("l1"), view.getLines().stream().map(CartPriceDtos.Line::getLineRef).toList());
        assertEquals("INSUFFICIENT_STOCK", view.getUnavailable().get(0).getReason());
        assertEquals(1, view.getUnavailable().get(0).getAvailableQuantity());
    }

    @Test
    void aMadeToOrderVariantIsNotLimitedByStock() {
        variants.put("ps-mto", variant("ps-mto", "MTO", "100.00", null, 1, 1));
        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(line("ps-mto", 20))).view();
        assertTrue(view.getUnavailable().isEmpty());
        assertMoney("2000.00", view.getTotals().getSubtotal());
    }

    @Test
    void aLineCanBeNamedBySku() {
        CartPriceRequest.Line bySku = CartPriceRequest.Line.builder().sku("SKU-B").quantity(1).build();
        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(bySku)).view();
        assertEquals("ps-b", view.getLines().get(0).getVariantId());
        assertEquals("Product SKU-B", view.getLines().get(0).getName());
    }

    // ------------------------------------------------------------------ coupons and refusals

    @Test
    void aRefusedCouponGivesItsReasonAndNoDiscount() {
        coupon("OLD", CouponValidateResponseDTO.builder().valid(false).message(CouponValidationMessages.EXPIRED).build());
        CartPriceRequest request = cart(line("ps-b", 1));
        request.setCouponCode("OLD");

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, request).view();

        assertFalse(view.getCoupon().isApplied());
        assertEquals(CouponValidationMessages.EXPIRED, view.getCoupon().getReason());
        assertMoney("0.00", view.getTotals().getDiscount());
        assertTrue(view.getDiscounts().isEmpty());
    }

    @Test
    void aCouponNeverTakesMoreThanTheGoods() {
        coupon("HUGE", CouponValidateResponseDTO.builder().valid(true).couponCodeId("cc").discountValue(9999.0)
                .message(CouponValidationMessages.VALID).build());
        CartPriceRequest request = cart(line("ps-b", 1));
        request.setCouponCode("HUGE");

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, request).view();

        assertMoney("500.00", view.getTotals().getDiscount());
        // Only delivery is left to pay.
        assertMoney("60.00", view.getTotals().getTotal());
    }

    @Test
    void aCouponLimitedToOneItemIsComputedOnThatItem() {
        when(couponValidationService.validate(any())).thenAnswer(call -> {
            CouponValidateRequestDTO request = call.getArgument(0);
            if (!"ps-b".equals(request.getPackageSessionId())) {
                return CouponValidateResponseDTO.builder().valid(false)
                        .message(CouponValidationMessages.NOT_APPLICABLE).build();
            }
            // 10% of the amount the validation was given.
            return CouponValidateResponseDTO.builder().valid(true).couponCodeId("cc")
                    .discountValue(request.getTotalAmount() * 0.10).message(CouponValidationMessages.VALID).build();
        });
        CartPriceRequest request = cart(line("ps-a", 1), line("ps-b", 2));
        request.setCouponCode("ONLYB");

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, request).view();

        // 10% of the two B items (1000), not of the whole cart (2050).
        assertMoney("100.00", view.getCoupon().getDiscount());
        assertMoney("100.00", view.getTotals().getDiscount());
    }

    @Test
    void aShopWhoseTaxSetupIsIncompleteCannotPriceACart() {
        when(taxClassService.loadRefs(eq(INSTITUTE), any())).thenReturn(Map.of("tc-flat", TestTaxData.flatClassTest()));
        CartPricingException e = assertThrows(CartPricingException.class,
                () -> service.priceCart(INSTITUTE, cart(line("ps-b", 1))));
        assertEquals(CartPricingException.NOT_PRICEABLE, e.getCode());
    }

    @Test
    void aMalformedCartIsRefused() {
        assertEquals(CartPricingException.CART_INVALID, assertThrows(CartPricingException.class,
                () -> service.priceCart(INSTITUTE, null)).getCode());
        assertEquals(CartPricingException.CART_INVALID, assertThrows(CartPricingException.class,
                () -> service.priceCart(INSTITUTE, cart())).getCode());
        assertEquals(CartPricingException.CART_INVALID, assertThrows(CartPricingException.class,
                () -> service.priceCart(INSTITUTE, cart(CartPriceRequest.Line.builder().quantity(1).build()))).getCode());
        CartPriceRequest method = cart(line("ps-b", 1));
        method.setPaymentMethod("CHEQUE");
        assertEquals(CartPricingException.CART_INVALID, assertThrows(CartPricingException.class,
                () -> service.priceCart(INSTITUTE, method)).getCode());
        CartPriceRequest.Line[] many = new CartPriceRequest.Line[CommerceOrderService.MAX_LINES + 1];
        java.util.Arrays.fill(many, line("ps-b", 1));
        assertEquals(CartPricingException.CART_INVALID, assertThrows(CartPricingException.class,
                () -> service.priceCart(INSTITUTE, cart(many))).getCode());
    }

    // ------------------------------------------------------------------ review round 3

    private CartVariant inactive(String id, String sku, boolean productActive, boolean variantActive) {
        CartVariant v = variant(id, sku, "100.00", 5, 1, 1);
        return new CartVariant(v.packageSessionId(), v.packageId(), v.sku(), v.slug(), productActive, variantActive,
                true, false, v.taxClassId(), v.unit(), 1, 1, 500, 5, v.sku(), v.names(), v.price(), null, "INR");
    }

    @Test
    void aDraftOrArchivedVariantAskedBySkuAnswersExactlyLikeASkuThatDoesNotExist() {
        variants.put("ps-draft", inactive("ps-draft", "KK-2027-01", false, true));
        variants.put("ps-archived", inactive("ps-archived", "KK-2019-07", true, false));
        CartPriceRequest.Line draft = CartPriceRequest.Line.builder().sku("KK-2027-01").quantity(1).build();
        CartPriceRequest.Line archived = CartPriceRequest.Line.builder().sku("KK-2019-07").quantity(1).build();
        CartPriceRequest.Line unknown = CartPriceRequest.Line.builder().sku("NO-SUCH-SKU").quantity(1).build();

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(draft, archived, unknown)).view();

        assertEquals(3, view.getUnavailable().size());
        for (int i = 0; i < 3; i++) {
            CartPriceDtos.UnavailableLine line = view.getUnavailable().get(i);
            CartPriceDtos.Change change = view.getChanges().get(i);
            String sent = List.of("KK-2027-01", "KK-2019-07", "NO-SUCH-SKU").get(i);
            assertEquals("NOT_FOUND", line.getReason());
            // The line is named by what the client sent, never by the id of the hidden variant.
            assertEquals(sent, line.getLineRef());
            assertEquals(sent, line.getSku());
            assertNull(line.getVariantId());
            assertNull(line.getQtyStep());
            assertEquals(sent, change.getLineRef());
            assertNull(change.getVariantId());
        }
        String all = view.toString();
        assertFalse(all.contains("ps-draft"), "the id of a draft variant is not in the answer");
        assertFalse(all.contains("ps-archived"), "the id of an archived variant is not in the answer");
    }

    @Test
    void aQuantityAboveTheShopMaximumIsRefusedTheSameWayWhateverTheStockIs() {
        variants.put("ps-ten", variant("ps-ten", "TEN", "10.00", 10, 1, 1));
        variants.put("ps-thousand", variant("ps-thousand", "THOUSAND", "10.00", 1000, 1, 1));
        variants.put("ps-mto", variant("ps-mto", "MTO", "10.00", null, 1, 1));

        for (int quantity : new int[] {26, 500, 1001, 100_000}) {
            CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE,
                    cart(line("ps-ten", quantity), line("ps-thousand", quantity), line("ps-mto", quantity))).view();
            assertEquals(3, view.getUnavailable().size());
            for (CartPriceDtos.UnavailableLine line : view.getUnavailable()) {
                // The answer is the same for 10 on hand, 1,000 on hand and no stock tracking at all.
                assertEquals("QUANTITY_ABOVE_MAX", line.getReason(), line.getSku() + " x " + quantity);
                assertEquals(25, line.getMaxQuantity());
                assertNull(line.getAvailableQuantity());
            }
        }
        // At the maximum the plentiful variant is sold, so the most a caller learns is "25 or more".
        CartPriceDtos.CartPrice atMax = service.priceCart(INSTITUTE, cart(line("ps-thousand", 25))).view();
        assertTrue(atMax.getUnavailable().isEmpty());
    }

    @Test
    void theMaximumCountsEveryLineOfTheVariantAndBaseUnitsOfMeasuredGoods() {
        variants.put("ps-many", variant("ps-many", "MANY", "10.00", 1000, 1, 1));
        CartPriceRequest.Line first = CartPriceRequest.Line.builder().lineRef("l1").variantId("ps-many").quantity(20).build();
        CartPriceRequest.Line second = CartPriceRequest.Line.builder().lineRef("l2").variantId("ps-many").quantity(6).build();
        CartPriceDtos.CartPrice split = service.priceCart(INSTITUTE, cart(first, second)).view();
        assertEquals(List.of("l1"), split.getLines().stream().map(CartPriceDtos.Line::getLineRef).toList());
        assertEquals("QUANTITY_ABOVE_MAX", split.getUnavailable().get(0).getReason());

        // Cloth: 25 metres is 250 base units of 10 cm.
        variants.put("ps-cloth", variant("ps-cloth", "CLOTH", "12.50", 100_000, 10, 5));
        assertTrue(service.priceCart(INSTITUTE, cart(line("ps-cloth", 250))).view().getUnavailable().isEmpty());
        CartPriceDtos.UnavailableLine over = service.priceCart(INSTITUTE, cart(line("ps-cloth", 255))).view()
                .getUnavailable().get(0);
        assertEquals("QUANTITY_ABOVE_MAX", over.getReason());
        assertEquals(250, over.getMaxQuantity());
    }

    @Test
    void twoVariantsOfOneProductAreToldApartOnTheCartLineTheSnapshotAndTheTaxLine() {
        CartVariant m = variant("ps-m", "KK-M", "900.00", 10, 1, 1);
        CartVariant l = variant("ps-l", "KK-L", "900.00", 10, 1, 1);
        Map<String, String> names = Map.of("en", "Khadi Kurta", "hi", "खादी कुर्ता");
        variants.put("ps-m", new CartVariant("ps-m", "pkg-kk", "KK-M", "khadi-kurta", true, true, true, false,
                m.taxClassId(), "PCS", 1, 1, 500, 10, "KK-M", names, m.price(), null, "INR",
                List.of(new StorefrontSnapshotLoader.OptionLabel("red", Map.of("en", "Red", "hi", "लाल")),
                        new StorefrontSnapshotLoader.OptionLabel("m", Map.of("en", "M")))));
        variants.put("ps-l", new CartVariant("ps-l", "pkg-kk", "KK-L", "khadi-kurta", true, true, true, false,
                l.taxClassId(), "PCS", 1, 1, 500, 10, "KK-L", names, l.price(), null, "INR",
                List.of(new StorefrontSnapshotLoader.OptionLabel("red", Map.of("en", "Red", "hi", "लाल")),
                        new StorefrontSnapshotLoader.OptionLabel("l", Map.of()))));

        CommerceOrderService.CartPrice priced = service.priceCart(INSTITUTE, cart(line("ps-m", 1), line("ps-l", 1)));

        assertEquals(List.of("Khadi Kurta - Red / M", "Khadi Kurta - Red / l"),
                priced.view().getLines().stream().map(CartPriceDtos.Line::getName).toList());
        assertEquals(List.of("Red / M", "Red / l"),
                priced.view().getLines().stream().map(CartPriceDtos.Line::getVariantLabel).toList());
        assertEquals("Khadi Kurta - Red / M", priced.snapshot().getLines().get(0).getName());
        assertEquals("Red / M", priced.snapshot().getLines().get(0).getVariantLabel());
        // The description of the tax line is what the invoice line prints.
        assertEquals("Khadi Kurta - Red / l", priced.snapshot().getTaxRequest().getLines().get(1).getDescription());
        // A product without options keeps its bare name.
        assertNull(service.priceCart(INSTITUTE, cart(line("ps-b", 1))).view().getLines().get(0).getVariantLabel());
    }

    @Test
    void aFlatCouponLimitedToOneItemNeverTakesMoreThanThatItemIsWorth() {
        variants.put("ps-key", variant("ps-key", "KEYRING", "200.00", 10, 1, 1));
        when(couponValidationService.validate(any())).thenAnswer(call -> {
            CouponValidateRequestDTO request = call.getArgument(0);
            if (!"ps-key".equals(request.getPackageSessionId())) {
                return CouponValidateResponseDTO.builder().valid(false)
                        .message(CouponValidationMessages.NOT_APPLICABLE).build();
            }
            // A flat amount: it does not depend on the amount it is given.
            return CouponValidateResponseDTO.builder().valid(true).couponCodeId("cc").discountValue(500.0)
                    .message(CouponValidationMessages.VALID).build();
        });
        CartPriceRequest request = cart(line("ps-key", 1), line("ps-a", 1));
        request.setCouponCode("FLAT500");

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, request).view();

        // The keyring is worth 200: that is all the coupon can take, nothing comes off the other item.
        assertMoney("200.00", view.getCoupon().getDiscount());
        assertMoney("200.00", view.getTotals().getDiscount());
    }

    @Test
    void aCouponLimitedToOneItemIsComputedOnWhatIsLeftOfThatItemAfterTheOffer() {
        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(OFFER_TEN_PERCENT, true));
        List<Double> amounts = new ArrayList<>();
        when(couponValidationService.validate(any())).thenAnswer(call -> {
            CouponValidateRequestDTO request = call.getArgument(0);
            if (!"ps-b".equals(request.getPackageSessionId())) {
                return CouponValidateResponseDTO.builder().valid(false)
                        .message(CouponValidationMessages.NOT_APPLICABLE).build();
            }
            amounts.add(request.getTotalAmount());
            return CouponValidateResponseDTO.builder().valid(true).couponCodeId("cc")
                    .discountValue(request.getTotalAmount() * 0.10).message(CouponValidationMessages.VALID).build();
        });
        // 1050 + 2 x 500 = 2050; the offer takes 10% = 205, 1845 is left; B's share is 1000 / 2050 of it = 900.
        CartPriceRequest request = cart(line("ps-a", 1), line("ps-b", 2));
        request.setCouponCode("ONLYB");

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, request).view();

        assertEquals(900.0, amounts.get(amounts.size() - 1), 0.001);
        assertMoney("90.00", view.getCoupon().getDiscount());
    }

    @Test
    void itemsOfAnOfferAndOfACouponAreUnitsNotCartLines() {
        String threeOrMore = """
                {"offers": {"enabled": true, "rules": [
                  {"id": "three", "label": "10% off 3 or more", "minCourses": 3, "discountType": "PERCENTAGE",
                   "discountValue": 10}]}}
                """;
        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(threeOrMore, true));
        List<Integer> counts = new ArrayList<>();
        when(couponValidationService.validate(any())).thenAnswer(call -> {
            counts.add(((CouponValidateRequestDTO) call.getArgument(0)).getItemCount());
            return CouponValidateResponseDTO.builder().valid(false).message(CouponValidationMessages.INVALID).build();
        });
        CartPriceRequest oneLineOfThree = cart(line("ps-b", 3));
        oneLineOfThree.setCouponCode("ANY");

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, oneLineOfThree).view();

        // One line of three units reaches "3 or more".
        assertMoney("150.00", view.getTotals().getDiscount());
        assertEquals(3, counts.get(0));
        // Two units do not.
        assertMoney("0.00", service.priceCart(INSTITUTE, cart(line("ps-b", 2))).view().getTotals().getDiscount());
        // Cloth by the metre counts as one item whatever its length.
        variants.put("ps-cloth", variant("ps-cloth", "CLOTH", "12.50", 300, 10, 5));
        assertMoney("0.00", service.priceCart(INSTITUTE, cart(line("ps-cloth", 50))).view().getTotals().getDiscount());
    }

    @Test
    void thePincodeDecidesThePlaceOfSupplyAndASentStateIsOnlyUsedWithoutOne() {
        // 208001 is Uttar Pradesh (09), the seller state: CGST + SGST even when the client says 27.
        CartPriceRequest both = cart(line("ps-b", 1));
        both.setPincode("208001");
        both.setStateCode("27");
        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, both).view();
        assertEquals("09", view.getTax().getPlaceOfSupplyState());
        assertEquals("CGST_SGST", view.getTax().getHead());

        CartPriceRequest stateOnly = cart(line("ps-b", 1));
        stateOnly.setStateCode("27");
        assertEquals("IGST", service.priceCart(INSTITUTE, stateOnly).view().getTax().getHead());
    }

    @Test
    void basketPricingWithNoTierReachedInventsNoDiscountOfPaise() {
        String basket = """
                {"basketPricing": {"enabled": true, "pricingBasis": "DISCOUNT",
                  "tiers": [{"minAmount": 100000, "type": "PERCENT", "value": 10}]}}
                """;
        when(storefrontSettings.read(INSTITUTE)).thenReturn(settings(basket, true));
        variants.put("ps-paise", variant("ps-paise", "PAISE", "90.40", 10, 1, 1));

        CartPriceDtos.CartPrice view = service.priceCart(INSTITUTE, cart(line("ps-paise", 1))).view();

        assertMoney("0.00", view.getTotals().getDiscount());
        assertTrue(view.getDiscounts().isEmpty());
    }
}
