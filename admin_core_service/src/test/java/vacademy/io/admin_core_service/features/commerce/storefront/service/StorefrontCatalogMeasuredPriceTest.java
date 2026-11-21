package vacademy.io.admin_core_service.features.commerce.storefront.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogMediaResolver;
import vacademy.io.admin_core_service.features.commerce.storefront.StorefrontTestData;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Product;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontCatalogService.ProductQuery;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A cloth priced per base unit (₹12.34 per 10 cm) is sorted, filtered and banded by its price per
 * metre (₹123.40), between a ₹100 and a ₹200 item; its card keeps the per-base-unit amount.
 */
class StorefrontCatalogMeasuredPriceTest {

    private static final String INSTITUTE = StorefrontTestData.INSTITUTE;

    private StorefrontCatalogService service;

    private static Product counted(String slug, String name, String price) {
        return StorefrontTestData.product("p-" + slug, slug, false, 1, null, name,
                StorefrontTestData.variant("ps-" + slug, slug.toUpperCase(), false, null, price, null, Map.of()),
                Set.of(), Map.of(), null);
    }

    private static Product cloth() {
        Product p = counted("cotton-cloth", "Cotton cloth", "12.34");
        return new Product(p.packageId(), p.slug(), p.piece(), p.taxClassId(), p.brand(), "MTR", 10, 1,
                p.originName(), p.publishedAt(), p.updatedAt(), p.seoI18n(), p.translations(), p.variants(),
                p.media(), p.attributeValueIds(), p.optionAttributeIds(), p.collectionPositions(), p.searchText());
    }

    @BeforeEach
    void setUp() {
        StorefrontSettings base = StorefrontTestData.settings();
        StorefrontSettings settings = new StorefrontSettings(base.baseLocale(), base.lowStockThreshold(),
                base.leadMediaTag(), List.of(new BigDecimal("100.00"), new BigDecimal("200.00")),
                base.dispatchPromise(), base.cod(), base.pricingRulesJson(), base.maxOrderQuantity(),
                base.mediaTags());
        List<Product> products = List.of(counted("cheap-item", "Cheap item", "100.00"), cloth(),
                counted("dear-item", "Dear item", "200.00"));
        Map<String, Product> bySlug = new LinkedHashMap<>();
        products.forEach(p -> bySlug.put(p.slug(), p));
        StorefrontSnapshot shop = new StorefrontSnapshot(INSTITUTE, settings, products, bySlug, Map.of(), Map.of(),
                List.of(), StorefrontTestData.DAY_0);

        StorefrontSnapshotLoader loader = mock(StorefrontSnapshotLoader.class);
        when(loader.snapshot(INSTITUTE)).thenReturn(shop);
        CatalogMediaResolver media = mock(CatalogMediaResolver.class);
        when(media.resolve(any())).thenReturn(Map.of());
        service = new StorefrontCatalogService(loader, media);
        service.clock = Clock.fixed(StorefrontTestData.DAY_0.plusSeconds(86_400L * 40), ZoneOffset.UTC);
    }

    private StorefrontDtos.ProductList list(String min, String max, String sort, boolean facets) {
        return service.list(INSTITUTE, new ProductQuery(null, null, Map.of(),
                min == null ? null : new BigDecimal(min), max == null ? null : new BigDecimal(max), null, sort, 1, 24,
                facets, "en"));
    }

    private static List<String> slugs(StorefrontDtos.ProductList list) {
        return list.getData().stream().map(StorefrontDtos.ProductCard::getSlug).toList();
    }

    @Test
    void sortsByThePricePerMetre() {
        assertEquals(List.of("cheap-item", "cotton-cloth", "dear-item"), slugs(list(null, null, "price_asc", false)));
        assertEquals(List.of("dear-item", "cotton-cloth", "cheap-item"), slugs(list(null, null, "price_desc", false)));
    }

    @Test
    void filtersAndBandsByThePricePerMetre() {
        assertEquals(List.of("cotton-cloth"), slugs(list("110", "150", "price_asc", false)));
        assertEquals(List.of("cheap-item", "cotton-cloth"), slugs(list(null, "150", "price_asc", false)));

        StorefrontDtos.PriceFacet price = list(null, null, "price_asc", true).getFacets().getPrice();
        assertEquals(0, new BigDecimal("100.00").compareTo(price.getMin()));
        assertEquals(0, new BigDecimal("200.00").compareTo(price.getMax()));
        // Up to 100, 100 to 200 (the cloth at 123.40 and the 200 item), above 200.
        assertEquals(List.of(1, 2, 0), price.getBands().stream().map(StorefrontDtos.PriceBand::getCount).toList());
    }

    @Test
    void theCardKeepsThePerBaseUnitAmount() {
        StorefrontDtos.ProductCard card = list(null, null, "price_asc", false).getData().get(1);
        assertEquals("cotton-cloth", card.getSlug());
        assertEquals(0, new BigDecimal("12.34").compareTo(card.getPrice().getAmount()));
    }
}
