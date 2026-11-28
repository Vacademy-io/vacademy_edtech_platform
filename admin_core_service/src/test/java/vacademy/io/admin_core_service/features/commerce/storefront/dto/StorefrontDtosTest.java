package vacademy.io.admin_core_service.features.commerce.storefront.dto;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.PublicDtoFields;
import vacademy.io.admin_core_service.features.commerce.storefront.StorefrontTestData;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontLocale;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontViews;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** What is public is exactly this list. */
class StorefrontDtosTest {

    private static final Map<String, Set<String>> ALLOWED = Map.ofEntries(
            Map.entry("Price", Set.of("amount", "compareAtAmount", "currency", "from")),
            Map.entry("Stock", Set.of("state", "left", "purchasable", "singlePiece", "leadTimeDays")),
            Map.entry("Rendition", Set.of("width", "url")),
            Map.entry("Media", Set.of("kind", "url", "alt", "tag", "width", "height", "renditions", "variantId",
                    "position")),
            Map.entry("Swatch", Set.of("code", "label", "swatchHex")),
            Map.entry("ProductCard", Set.of("id", "slug", "path", "locale", "name", "shortDescription", "brand",
                    "unit", "qtyScale", "qtyStep", "origin", "image", "price", "stock", "badges", "swatches",
                    "variantCount", "defaultVariantId", "publishedAt")),
            Map.entry("OptionValue", Set.of("code", "label", "swatchHex", "position")),
            Map.entry("Option", Set.of("code", "name", "kind", "values")),
            Map.entry("Variant", Set.of("id", "sku", "label", "optionValues", "price", "stock", "weightGrams",
                    "lengthMm", "widthMm", "heightMm", "image", "position")),
            Map.entry("ContentBlock", Set.of("code", "html")),
            Map.entry("Spec", Set.of("code", "name", "values")),
            Map.entry("Alternate", Set.of("locale", "path")),
            Map.entry("Seo", Set.of("title", "description", "canonicalPath", "alternates")),
            Map.entry("CollectionRef", Set.of("slug", "kind", "name", "path")),
            Map.entry("ProductDetail", Set.of("id", "slug", "path", "locale", "availableLocales", "name",
                    "shortDescription", "descriptionHtml", "contentBlocks", "brand", "unit", "qtyScale", "qtyStep",
                    "maxOrderQuantity", "stockMode", "origin", "price", "stock", "badges", "media", "options", "variants", "specs",
                    "collections", "seo", "publishedAt", "updatedAt")),
            Map.entry("FacetValue", Set.of("code", "label", "swatchHex", "count", "selected")),
            Map.entry("Facet", Set.of("code", "name", "kind", "values")),
            Map.entry("PriceBand", Set.of("from", "to", "count")),
            Map.entry("PriceFacet", Set.of("min", "max", "bands")),
            Map.entry("AvailabilityFacet", Set.of("inStock", "outOfStock")),
            Map.entry("Facets", Set.of("attributes", "price", "availability")),
            Map.entry("ProductList", Set.of("data", "total", "page", "pageSize", "hasMore", "locale", "facets")),
            Map.entry("Suggestions", Set.of("products", "collections", "total", "locale")),
            Map.entry("Category", Set.of("slug", "kind", "name", "description", "imageUrl", "path", "position",
                    "productCount", "inStockCount", "children")),
            Map.entry("CategoryTree", Set.of("data", "locale")));

    @Test
    void thePublicViewsHaveExactlyTheAllowedFields() {
        PublicDtoFields.assertExactly(StorefrontDtos.class, ALLOWED);
    }

    @Test
    void aSerialisedProductCarriesNoInternalValueAndNoCountAboveTheThreshold() throws Exception {
        StorefrontSnapshot shop = StorefrontTestData.shop();
        List<String> chain = StorefrontLocale.chain("en", "hi");
        ObjectMapper mapper = new ObjectMapper();
        for (StorefrontSnapshot.Product product : shop.products()) {
            String json = mapper.writeValueAsString(StorefrontViews.detail(shop, product, chain,
                    ref -> "https://cdn.test/" + ref, StorefrontTestData.DAY_0));
            // The fixture puts this marker in the tax class id; no internal id may come out.
            assertFalse(json.contains("tax-class-secret"), json);
            assertFalse(json.contains(StorefrontTestData.INSTITUTE), json);
            assertFalse(json.contains("<script"), "authored HTML is sanitised");
            for (String key : keys(mapper.readTree(json))) {
                assertFalse(key.matches(".*(cost|tax_class|available_slots|institute|external_ref|barcode|label_code).*"),
                        "public key " + key);
            }
        }
        // Ten in stock with a threshold of three: the state, and no number anywhere.
        JsonNode red = mapper.readTree(mapper.writeValueAsString(StorefrontViews.detail(shop,
                shop.bySlug().get("red-saree"), chain, ref -> null, StorefrontTestData.DAY_0)));
        assertEquals("IN_STOCK", red.path("stock").path("state").asText());
        assertTrue(red.path("stock").path("left").isNull());
        assertTrue(red.path("variants").get(0).path("stock").path("left").isNull());
        assertFalse(red.toString().contains(":10,") && red.path("stock").toString().contains("10"));
    }

    @Test
    void jsonNamesAreSnakeCase() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        JsonNode stock = mapper.readTree(mapper.writeValueAsString(StorefrontDtos.Stock.builder()
                .state("LOW").left(2).purchasable(true).singlePiece(true).leadTimeDays(3).build()));
        assertEquals(Set.of("state", "left", "purchasable", "single_piece", "lead_time_days"), Set.copyOf(names(stock)));
        JsonNode price = mapper.readTree(mapper.writeValueAsString(StorefrontDtos.Price.builder()
                .currency("INR").from(true).build()));
        assertEquals(Set.of("amount", "compare_at_amount", "currency", "from"), Set.copyOf(names(price)));
    }

    private static List<String> names(JsonNode node) {
        List<String> out = new ArrayList<>();
        node.fieldNames().forEachRemaining(out::add);
        return out;
    }

    private static List<String> keys(JsonNode node) {
        List<String> out = new ArrayList<>();
        if (node.isObject()) {
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> field = fields.next();
                // option_values is keyed by attribute codes, which are data, not field names.
                if (!field.getKey().equals("option_values")) {
                    out.add(field.getKey());
                    out.addAll(keys(field.getValue()));
                }
            }
        } else if (node.isArray()) {
            node.forEach(child -> out.addAll(keys(child)));
        }
        return out;
    }
}
