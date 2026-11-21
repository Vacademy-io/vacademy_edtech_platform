package vacademy.io.admin_core_service.features.commerce.storefront.rules;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.storefront.StorefrontTestData;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Media;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Variant;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The rules of the views that the service test does not reach. */
class StorefrontViewsTest {

    private static final List<String> EN = StorefrontLocale.chain("en", "hi");

    @Test
    void renditionsAreTheWidthKeysAndTheJobStateStaysInside() throws Exception {
        Map<String, Object> stored = new LinkedHashMap<>();
        stored.put("960", "https://cdn.test/a-960.webp");
        stored.put("320", "https://cdn.test/a-320.webp");
        stored.put("_status", "FAILED");
        stored.put("_error", "the media service said no: internal detail");
        stored.put("_tries", 3);
        Media media = new Media(null, "media-a", "IMAGE", "REAL", Map.of("hi", "करघे पर साड़ी"), 1600, 2000, stored, 0);

        StorefrontDtos.Media view = StorefrontViews.media(media, EN, ref -> ref.startsWith("http") ? ref : null);

        // The original could not be resolved: the widest rendition stands in for it.
        assertEquals("https://cdn.test/a-960.webp", view.getUrl());
        assertEquals(List.of(320, 960), view.getRenditions().stream().map(StorefrontDtos.Rendition::getWidth).toList());
        // No English alt text: the base locale serves it.
        assertEquals("करघे पर साड़ी", view.getAlt());
        String json = new ObjectMapper().writeValueAsString(view);
        assertFalse(json.contains("_status") || json.contains("internal detail") || json.contains("_tries"), json);

        // A picture with nothing to show is left out.
        assertNull(StorefrontViews.media(media, EN, ref -> null));
    }

    @Test
    void theCardPriceIsTheLowestBuyableVariantAndSaysWhenPricesDiffer() {
        StorefrontSnapshot shop = StorefrontTestData.shop();
        Variant soldOutCheap = StorefrontTestData.variant("ps-1", "S-1", true, 0, "500.00", null, Map.of());
        Variant inStock = StorefrontTestData.variant("ps-2", "S-2", true, 9, "900.00", "1200.00", Map.of());
        Variant noPrice = StorefrontTestData.variant("ps-3", "S-3", true, 9, null, null, Map.of());
        StorefrontSnapshot.Product product = StorefrontTestData.product("p-x", "x", false, 1, null, "X",
                List.of(soldOutCheap, inStock, noPrice), Set.of(), Map.of(), null);

        StorefrontDtos.ProductCard card = StorefrontViews.card(shop, product, EN, StorefrontViews.noMedia(),
                StorefrontTestData.DAY_0);

        // 500 is sold out, so the card shows the 900 that can be bought, marked "from".
        assertEquals(0, new BigDecimal("900").compareTo(card.getPrice().getAmount()));
        assertEquals(0, new BigDecimal("1200").compareTo(card.getPrice().getCompareAtAmount()));
        assertTrue(card.getPrice().isFrom());
        assertEquals("IN_STOCK", card.getStock().getState());
        assertEquals(3, card.getVariantCount());
        assertNull(card.getDefaultVariantId());
        assertNull(card.getImage());

        // A variant without a price cannot be bought, whatever its stock.
        StorefrontDtos.ProductDetail detail = StorefrontViews.detail(shop, product, EN, StorefrontViews.noMedia(),
                StorefrontTestData.DAY_0);
        assertFalse(detail.getVariants().get(2).getStock().isPurchasable());
        assertNull(detail.getVariants().get(2).getPrice());
        assertEquals("OUT", detail.getVariants().get(2).getStock().getState());
    }

    @Test
    void aProductWithNoPricedVariantIsOutAndHasNoPrice() {
        StorefrontSnapshot shop = StorefrontTestData.shop();
        StorefrontSnapshot.Product product = StorefrontTestData.product("p-y", "y", false, 1, null, "Y",
                List.of(StorefrontTestData.variant("ps-9", "S-9", true, 9, null, null, Map.of())), Set.of(), Map.of(),
                null);
        StorefrontDtos.ProductCard card = StorefrontViews.card(shop, product, EN, StorefrontViews.noMedia(),
                StorefrontTestData.DAY_0);
        assertNull(card.getPrice());
        assertFalse(card.getStock().isPurchasable());
    }

    @Test
    void pathsCarryTheLanguageOnlyOffTheBaseLocale() {
        assertEquals("/p/red-saree", StorefrontViews.productPath("red-saree", "hi", "hi"));
        assertEquals("/p/red-saree?lang=en", StorefrontViews.productPath("red-saree", "en", "hi"));
        assertEquals("/p/red-saree", StorefrontViews.productPath("red-saree", null, "hi"));
        assertEquals("/c/a%20b", StorefrontViews.collectionPath("a b", "hi", "hi"));
        assertEquals("/p/%E0%A4%B8%E0%A4%BE%E0%A4%A1%E0%A4%BC%E0%A5%80", StorefrontViews.productPath("साड़ी", "hi", "hi"));
    }

    /**
     * W9 follow-up: the product page reads the shop's per-order maximum from the detail, in
     * display units (pieces, or metres for cloth), to cap a typed length as the cart will.
     */
    @Test
    void theDetailCarriesTheShopsPerOrderMaximumInDisplayUnits() throws Exception {
        StorefrontSnapshot shop = StorefrontTestData.shop();
        StorefrontSnapshot.Product product = StorefrontTestData.product("p-z", "z", false, 1, null, "Z",
                List.of(StorefrontTestData.variant("ps-z", "S-Z", true, 9, "100.00", null, Map.of())), Set.of(),
                Map.of(), null);

        StorefrontDtos.ProductDetail detail = StorefrontViews.detail(shop, product, EN, StorefrontViews.noMedia(),
                StorefrontTestData.DAY_0);

        assertEquals(25, shop.settings().maxOrderQuantity());
        assertEquals(25, detail.getMaxOrderQuantity());
        assertEquals(250L, shop.settings().maxLineBaseUnits(10), "the cart's limit at scale 10, in base units");
        assertTrue(new ObjectMapper().writeValueAsString(detail).contains("\"max_order_quantity\":25"));
    }
}
