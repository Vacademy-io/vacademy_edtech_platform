package vacademy.io.admin_core_service.features.commerce.storefront.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogMediaResolver;
import vacademy.io.admin_core_service.features.commerce.storefront.StorefrontTestData;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontCatalogService.ProductQuery;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Listing, facets, sorts, search, detail and the collection tree over the test shop. */
class StorefrontCatalogServiceTest {

    private static final String INSTITUTE = StorefrontTestData.INSTITUTE;

    private StorefrontCatalogService service;

    @BeforeEach
    void setUp() {
        StorefrontSnapshotLoader loader = mock(StorefrontSnapshotLoader.class);
        when(loader.snapshot(INSTITUTE)).thenReturn(StorefrontTestData.shop());
        when(loader.withDetailTexts(any(), any())).thenAnswer(call -> call.getArgument(1));
        CatalogMediaResolver media = mock(CatalogMediaResolver.class);
        when(media.resolve(any())).thenAnswer(call -> {
            Map<String, String> urls = new HashMap<>();
            for (String ref : (Collection<String>) call.getArgument(0)) {
                urls.put(ref, ref.startsWith("http") ? ref : "https://cdn.test/" + ref);
            }
            return urls;
        });
        service = new StorefrontCatalogService(loader, media);
        service.clock = Clock.fixed(StorefrontTestData.DAY_0.plusSeconds(86_400L * 40), ZoneOffset.UTC);
    }

    private static ProductQuery query(String q, String collection, Map<String, List<String>> attributes,
                                      String sort, boolean facets, String locale) {
        return new ProductQuery(q, collection, attributes, null, null, null, sort, 1, 24, facets, locale);
    }

    private static List<String> slugs(StorefrontDtos.ProductList list) {
        return list.getData().stream().map(StorefrontDtos.ProductCard::getSlug).toList();
    }

    private static StorefrontDtos.Facet facet(StorefrontDtos.ProductList list, String code) {
        return list.getFacets().getAttributes().stream().filter(f -> f.getCode().equals(code)).findFirst().orElseThrow();
    }

    private static Map<String, Integer> counts(StorefrontDtos.Facet facet) {
        Map<String, Integer> out = new HashMap<>();
        facet.getValues().forEach(v -> out.put(v.getCode(), v.getCount()));
        return out;
    }

    // ------------------------------------------------------------------ facets

    @Test
    void facetCountsAreTakenAgainstTheOtherGroups() {
        StorefrontDtos.ProductList list = service.list(INSTITUTE,
                query(null, null, Map.of("colour", List.of("red")), null, true, "en"));

        assertEquals(List.of("red-saree", "red-kurta"), slugs(list));
        // Colour is counted without the colour filter: the other colours keep their numbers.
        assertEquals(Map.of("red", 2, "blue", 2, "green", 1), counts(facet(list, "colour")));
        assertTrue(facet(list, "colour").getValues().get(0).isSelected());
        // Fabric is counted inside "red".
        assertEquals(Map.of("cotton", 1, "silk", 1), counts(facet(list, "fabric")));
        // Size is not filterable, so it is no facet.
        assertTrue(list.getFacets().getAttributes().stream().noneMatch(f -> f.getCode().equals("size")));
        assertEquals("Colour", facet(list, "colour").getName());
    }

    @Test
    void valuesInsideOneFacetAreAlternativesAndFacetsNarrowEachOther() {
        StorefrontDtos.ProductList list = service.list(INSTITUTE, query(null, null,
                Map.of("colour", List.of("red", "blue"), "fabric", List.of("silk")), null, true, "en"));

        assertEquals(List.of("blue-saree", "red-kurta"), slugs(list));
        // With fabric = silk: red 1 (kurta), blue 1; green would give 0 and is left out.
        assertEquals(Map.of("red", 1, "blue", 1), counts(facet(list, "colour")));
        // With colour in (red, blue): cotton 2 (red saree, loom piece), silk 2.
        assertEquals(Map.of("cotton", 2, "silk", 2), counts(facet(list, "fabric")));
    }

    @Test
    void priceAndAvailabilityFacetsIgnoreTheirOwnFilter() {
        ProductQuery query = new ProductQuery(null, null, Map.of(), new BigDecimal("900"), new BigDecimal("2500"),
                true, null, 1, 24, true, "en");
        StorefrontDtos.ProductList list = service.list(INSTITUTE, query);

        // 1000 in stock; 2000 is out of stock and filtered away by in_stock.
        assertEquals(List.of("red-saree"), slugs(list));
        StorefrontDtos.PriceFacet price = list.getFacets().getPrice();
        // Counted over every buyable product, whatever the price filter says.
        assertEquals(0, new BigDecimal("800.00").compareTo(price.getMin()));
        assertEquals(0, new BigDecimal("5000.00").compareTo(price.getMax()));
        assertEquals(List.of(2, 0, 2), price.getBands().stream().map(StorefrontDtos.PriceBand::getCount).toList());
        assertNull(price.getBands().get(0).getFrom());
        assertNull(price.getBands().get(2).getTo());
        // Availability is counted inside the price range, whatever in_stock says.
        assertEquals(1, list.getFacets().getAvailability().getInStock());
        assertEquals(1, list.getFacets().getAvailability().getOutOfStock());
    }

    @Test
    void facetsAreLeftOutUnlessAskedFor() {
        assertNull(service.list(INSTITUTE, query(null, null, Map.of(), null, false, "en")).getFacets());
    }

    @Test
    void anUnknownFilterIsRefused() {
        CatalogApiException unknown = assertThrows(CatalogApiException.class, () -> service.list(INSTITUTE,
                query(null, null, Map.of("material", List.of("x")), null, false, "en")));
        assertEquals(HttpStatus.BAD_REQUEST, unknown.getStatus());
        // An attribute that exists but is not filterable is not a filter either.
        assertThrows(CatalogApiException.class, () -> service.list(INSTITUTE,
                query(null, null, Map.of("size", List.of("m")), null, false, "en")));
    }

    // ------------------------------------------------------------------ search

    @Test
    void aHindiAndALatinQueryFindTheSameProduct() {
        assertEquals(List.of("blue-saree"), slugs(service.list(INSTITUTE,
                query("नीली रेशमी", null, Map.of(), null, false, "hi"))));
        assertEquals(List.of("blue-saree"), slugs(service.list(INSTITUTE,
                query("Blue SILK", null, Map.of(), null, false, "hi"))));
        // By SKU too.
        assertEquals(List.of("blue-saree"), slugs(service.list(INSTITUTE,
                query("sar-blu", null, Map.of(), null, false, "en"))));
        assertEquals(0, service.list(INSTITUTE, query("पगड़ी", null, Map.of(), null, false, "hi")).getTotal());
    }

    @Test
    void suggestionsNeedTwoCharactersAndListProductsAndCollections() {
        assertEquals(0, service.suggest(INSTITUTE, "s", "en").getTotal());

        StorefrontDtos.Suggestions saree = service.suggest(INSTITUTE, "saree", "en");
        assertEquals(4, saree.getTotal());
        assertEquals(4, saree.getProducts().size());
        assertEquals(List.of("sarees", "silk-sarees"),
                saree.getCollections().stream().map(StorefrontDtos.CollectionRef::getSlug).toList());

        StorefrontDtos.Suggestions hindi = service.suggest(INSTITUTE, "साड़ी", "hi");
        assertEquals(3, hindi.getTotal());
    }

    // ------------------------------------------------------------------ sort and paging

    @Test
    void everySortPutsBuyableProductsFirst() {
        // Newest alone would start with green-saree (day 30); it is out of stock, so it goes last.
        assertEquals(List.of("blue-saree", "red-saree", "red-kurta", "loom-piece", "green-saree"),
                slugs(service.list(INSTITUTE, query(null, null, Map.of(), "newest", false, "en"))));
        assertEquals(List.of("red-kurta", "red-saree", "blue-saree", "loom-piece", "green-saree"),
                slugs(service.list(INSTITUTE, query(null, null, Map.of(), "price_asc", false, "en"))));
        assertEquals(List.of("loom-piece", "blue-saree", "red-saree", "red-kurta", "green-saree"),
                slugs(service.list(INSTITUTE, query(null, null, Map.of(), "price_desc", false, "en"))));
    }

    @Test
    void recommendedInACollectionFollowsItsPositionsAndIncludesChildCollections() {
        // sarees: green (pos 1, out of stock -> last), red (2), loom piece (3); blue is in the child collection.
        assertEquals(List.of("red-saree", "loom-piece", "blue-saree", "green-saree"),
                slugs(service.list(INSTITUTE, query(null, "sarees", Map.of(), null, false, "en"))));
        assertEquals(HttpStatus.NOT_FOUND, assertThrows(CatalogApiException.class, () -> service.list(INSTITUTE,
                query(null, "no-such", Map.of(), null, false, "en"))).getStatus());
    }

    @Test
    void thePageSizeIsCappedAndPagesAreCut() {
        assertThrows(CatalogApiException.class, () -> service.list(INSTITUTE, new ProductQuery(null, null, Map.of(),
                null, null, null, null, 1, StorefrontCatalogService.MAX_PAGE_SIZE + 1, false, "en")));
        assertThrows(CatalogApiException.class, () -> service.list(INSTITUTE, new ProductQuery(null, null, Map.of(),
                null, null, null, null, 0, 24, false, "en")));
        assertThrows(CatalogApiException.class, () -> service.list(INSTITUTE,
                query(null, null, Map.of(), "bestselling", false, "en")));

        StorefrontDtos.ProductList second = service.list(INSTITUTE, new ProductQuery(null, null, Map.of(), null, null,
                null, "newest", 2, 2, false, "en"));
        assertEquals(List.of("red-kurta", "loom-piece"), slugs(second));
        assertEquals(5, second.getTotal());
        assertTrue(second.isHasMore());
    }

    // ------------------------------------------------------------------ cards and detail

    @Test
    void aCardShowsTheLeadTaggedImageTheStockStateAndTheLocale() {
        StorefrontDtos.ProductList hindi = service.list(INSTITUTE, query("red-saree", null, Map.of(), null, false,
                null));
        StorefrontDtos.ProductCard card = hindi.getData().get(0);
        assertEquals("लाल सूती साड़ी", card.getName());
        assertEquals("hi", card.getLocale());
        assertEquals("/p/red-saree", card.getPath());
        // The seller's lead tag is REAL: the second picture is the card image, with its renditions.
        assertEquals("https://cdn.test/media-red-saree-real", card.getImage().getUrl());
        assertEquals(List.of(320, 640), card.getImage().getRenditions().stream()
                .map(StorefrontDtos.Rendition::getWidth).toList());
        assertEquals("https://cdn.test/red-saree-640.webp", card.getImage().getRenditions().get(1).getUrl());
        assertEquals("IN_STOCK", card.getStock().getState());
        assertNull(card.getStock().getLeft());
        assertEquals(0, new BigDecimal("1500.00").compareTo(card.getPrice().getCompareAtAmount()));
        assertEquals("Khadi Gram", card.getOrigin());
        assertEquals("ps-red-saree", card.getDefaultVariantId());
        assertEquals("red", card.getSwatches().get(0).getCode());

        StorefrontDtos.ProductCard english = service.list(INSTITUTE,
                query("red-saree", null, Map.of(), null, false, "en")).getData().get(0);
        assertEquals("Red cotton saree", english.getName());
        assertEquals("/p/red-saree?lang=en", english.getPath());
    }

    @Test
    void lowStockShowsTheNumberAndBadges() {
        StorefrontDtos.ProductCard blue = service.list(INSTITUTE,
                query("blue-saree", null, Map.of(), null, false, "en")).getData().get(0);
        assertEquals("LOW", blue.getStock().getState());
        assertEquals(2, blue.getStock().getLeft());
        assertTrue(blue.getBadges().contains("ONLY_N_LEFT"));
        // Published on day 20, "now" is day 40: still new. Day 5 is not.
        assertTrue(blue.getBadges().contains("NEW"));

        StorefrontDtos.ProductCard piece = service.list(INSTITUTE,
                query("loom-piece", null, Map.of(), null, false, "en")).getData().get(0);
        assertTrue(piece.getStock().isSinglePiece());
        assertEquals(List.of("ONE_OF_ONE"), piece.getBadges());

        StorefrontDtos.ProductCard kurta = service.list(INSTITUTE,
                query("red-kurta", null, Map.of(), null, false, "en")).getData().get(0);
        assertEquals("MADE_TO_ORDER", kurta.getStock().getState());
        assertEquals(12, kurta.getStock().getLeadTimeDays());
        assertEquals(List.of("MADE_TO_ORDER"), kurta.getBadges());
    }

    @Test
    void theDetailFallsBackPerFieldAndNamesOneSlugPerLocale() {
        // Hindi page of a product whose description exists only in English.
        StorefrontDtos.ProductDetail detail = service.detail(INSTITUTE, "red-saree", "hi");
        assertEquals("लाल सूती साड़ी", detail.getName());
        assertEquals("hi", detail.getLocale());
        assertEquals("Short text of Red cotton saree", detail.getShortDescription());
        assertEquals("<p>About <b>Red cotton saree</b></p>", detail.getDescriptionHtml());
        assertEquals(List.of("en", "hi"), detail.getAvailableLocales());
        // The empty "story" block is dropped; "care" comes from English.
        assertEquals(List.of("care"), detail.getContentBlocks().stream().map(StorefrontDtos.ContentBlock::getCode)
                .toList());
        assertEquals("/p/red-saree", detail.getSeo().getCanonicalPath());
        assertEquals(List.of("/p/red-saree?lang=en", "/p/red-saree"),
                detail.getSeo().getAlternates().stream().map(StorefrontDtos.Alternate::getPath).toList());

        StorefrontDtos.ProductDetail english = service.detail(INSTITUTE, "red-saree", "en");
        assertEquals("/p/red-saree?lang=en", english.getSeo().getCanonicalPath());
        assertEquals("Red cotton saree | Shop", english.getSeo().getTitle());
        assertEquals("Buy Red cotton saree", english.getSeo().getDescription());

        // A product with no Hindi text at all is served in English on the Hindi page.
        StorefrontDtos.ProductDetail green = service.detail(INSTITUTE, "green-saree", "hi");
        assertEquals("Green cotton saree", green.getName());
        assertEquals("en", green.getLocale());
        assertFalse(green.getStock().isPurchasable());
    }

    @Test
    void theDetailListsOptionsVariantsSpecsAndCollections() {
        StorefrontDtos.ProductDetail detail = service.detail(INSTITUTE, "red-kurta", "en");
        assertEquals(List.of("colour"), detail.getOptions().stream().map(StorefrontDtos.Option::getCode).toList());
        assertEquals("Red", detail.getOptions().get(0).getValues().get(0).getLabel());
        StorefrontDtos.Variant variant = detail.getVariants().get(0);
        assertEquals("ps-red-kurta", variant.getId());
        assertEquals("KUR-RED", variant.getSku());
        assertEquals(Map.of("colour", "red"), variant.getOptionValues());
        assertEquals("Red", variant.getLabel());
        assertEquals("MADE_TO_ORDER", variant.getStock().getState());
        // Specs are the attributes that are not options: fabric and size.
        assertEquals(List.of("fabric", "size"), detail.getSpecs().stream().map(StorefrontDtos.Spec::getCode).toList());
        assertEquals(List.of("kurtas"), detail.getCollections().stream().map(StorefrontDtos.CollectionRef::getSlug)
                .toList());
        assertEquals(2, detail.getMedia().size());
        assertNotNull(detail.getMedia().get(0).getAlt());

        assertEquals(HttpStatus.NOT_FOUND, assertThrows(CatalogApiException.class,
                () -> service.detail(INSTITUTE, "no-such", "en")).getStatus());
    }

    // ------------------------------------------------------------------ categories and sitemap

    @Test
    void theCollectionTreeCountsProductsIncludingChildren() {
        StorefrontDtos.CategoryTree tree = service.categories(INSTITUTE, "hi", null, 0);
        assertEquals(List.of("sarees", "kurtas"), tree.getData().stream().map(StorefrontDtos.Category::getSlug)
                .toList());
        StorefrontDtos.Category sarees = tree.getData().get(0);
        assertEquals("साड़ियां", sarees.getName());
        assertEquals(4, sarees.getProductCount());
        assertEquals(3, sarees.getInStockCount());
        assertEquals("https://cdn.test/media-c1", sarees.getImageUrl());
        assertEquals(List.of("silk-sarees"), sarees.getChildren().stream().map(StorefrontDtos.Category::getSlug)
                .toList());
        assertEquals("/c/sarees", sarees.getPath());

        // With a minimum of two buyable products, kurtas (1) and silk sarees (1) are left out.
        StorefrontDtos.CategoryTree atLeastTwo = service.categories(INSTITUTE, "en", "CATEGORY", 2);
        assertEquals(List.of("sarees"), atLeastTwo.getData().stream().map(StorefrontDtos.Category::getSlug).toList());
        assertTrue(atLeastTwo.getData().get(0).getChildren().isEmpty());
        assertEquals("/c/sarees?lang=en", atLeastTwo.getData().get(0).getPath());
        assertThrows(CatalogApiException.class, () -> service.categories(INSTITUTE, "en", "BRAND", 0));
    }

    @Test
    void theSitemapListsEveryProductAndCollectionAtItsBarePath() {
        List<Map<String, Object>> entries = service.sitemapEntries(INSTITUTE, "https://shop.test/");
        assertEquals(8, entries.size());
        assertTrue(entries.stream().anyMatch(e -> "https://shop.test/p/red-saree".equals(e.get("url"))
                && "product".equals(e.get("type")) && "p-red-saree".equals(e.get("id")) && e.get("lastmod") != null));
        assertTrue(entries.stream().anyMatch(e -> "https://shop.test/c/silk-sarees".equals(e.get("url"))
                && "collection".equals(e.get("type"))));
        assertTrue(entries.stream().noneMatch(e -> e.get("url").toString().contains("?")));
    }
}
