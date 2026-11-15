package vacademy.io.admin_core_service.features.commerce.storefront;

import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Attribute;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.AttributeValue;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Collection;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Media;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Product;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Translation;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot.Variant;
import vacademy.io.admin_core_service.features.commerce.storefront.rules.StorefrontSearch;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * A small shop for the storefront tests: three attributes (colour and fabric filterable, size
 * not), two collections (sarees with a child, kurtas), and five products. Hindi is the base
 * locale and the low-stock threshold is 3.
 *
 * <pre>
 * slug          colour  fabric  price    stock            collection       published
 * red-saree     red     cotton   1000    10               sarees (pos 2)   day 10
 * blue-saree    blue    silk     3000    2  (LOW)         silk-sarees      day 20
 * green-saree   green   cotton   2000    0  (OUT)         sarees (pos 1)   day 30
 * red-kurta     red     silk      800    made to order    kurtas           day 5
 * loom-piece    blue    cotton   5000    1  (PIECE)       sarees (pos 3)   day 1
 * </pre>
 */
public final class StorefrontTestData {

    public static final String INSTITUTE = "inst-1";
    public static final Instant DAY_0 = Instant.parse("2026-10-01T00:00:00Z");

    private StorefrontTestData() {
    }

    public static StorefrontSettings settings() {
        return new StorefrontSettings("hi", 3, "REAL", List.of(new BigDecimal("1000.00"), new BigDecimal("2500.00")),
                Map.of("en", "Ships in 2 working days", "hi", "2 कार्य दिवसों में भेजा जाएगा"),
                new StorefrontSettings.Cod(true, new BigDecimal("5000.00"), new BigDecimal("3000.00"),
                        Set.of("190001")), null, 25, List.of());
    }

    public static StorefrontSnapshot shop() {
        Map<String, Attribute> attributes = new LinkedHashMap<>();
        attributes.put("a-colour", new Attribute("a-colour", "colour", Map.of("en", "Colour", "hi", "रंग"), "SWATCH",
                true, 1));
        attributes.put("a-fabric", new Attribute("a-fabric", "fabric", Map.of("en", "Fabric", "hi", "कपड़ा"), "TEXT",
                true, 2));
        attributes.put("a-size", new Attribute("a-size", "size", Map.of("en", "Size"), "SIZE", false, 3));
        Map<String, AttributeValue> values = new LinkedHashMap<>();
        values.put("v-red", new AttributeValue("v-red", "a-colour", "red", Map.of("en", "Red", "hi", "लाल"),
                "#aa0000", 1));
        values.put("v-blue", new AttributeValue("v-blue", "a-colour", "blue", Map.of("en", "Blue", "hi", "नीला"),
                "#0000aa", 2));
        values.put("v-green", new AttributeValue("v-green", "a-colour", "green", Map.of("en", "Green"), "#00aa00", 3));
        values.put("v-cotton", new AttributeValue("v-cotton", "a-fabric", "cotton", Map.of("en", "Cotton", "hi", "सूती"),
                null, 1));
        values.put("v-silk", new AttributeValue("v-silk", "a-fabric", "silk", Map.of("en", "Silk", "hi", "रेशम"),
                null, 2));
        values.put("v-m", new AttributeValue("v-m", "a-size", "m", Map.of("en", "M"), null, 1));

        List<Collection> collections = List.of(
                new Collection("c-sarees", null, "CATEGORY", "sarees", Map.of("en", "Sarees", "hi", "साड़ियां"),
                        Map.of("en", "Handwoven sarees"), "media-c1", 1, DAY_0),
                new Collection("c-silk", "c-sarees", "CATEGORY", "silk-sarees", Map.of("en", "Silk sarees"),
                        Map.of(), null, 1, DAY_0),
                new Collection("c-kurtas", null, "CATEGORY", "kurtas", Map.of("en", "Kurtas"), Map.of(), null, 2,
                        DAY_0));

        List<Product> products = new ArrayList<>();
        products.add(product("p-red-saree", "red-saree", false, 10, "लाल सूती साड़ी", "Red cotton saree",
                variant("ps-red-saree", "SAR-RED", true, 10, "1000.00", "1500.00", Map.of("a-colour", "v-red")),
                Set.of("v-cotton"), Map.of("c-sarees", 2), "Khadi Gram"));
        products.add(product("p-blue-saree", "blue-saree", false, 20, "नीली रेशमी साड़ी", "Blue silk saree",
                variant("ps-blue-saree", "SAR-BLU", true, 2, "3000.00", null, Map.of("a-colour", "v-blue")),
                Set.of("v-silk"), Map.of("c-silk", 1), null));
        products.add(product("p-green-saree", "green-saree", false, 30, null, "Green cotton saree",
                variant("ps-green-saree", "SAR-GRN", true, 0, "2000.00", null, Map.of("a-colour", "v-green")),
                Set.of("v-cotton"), Map.of("c-sarees", 1), null));
        products.add(product("p-red-kurta", "red-kurta", false, 5, "लाल कुर्ता", "Red silk kurta",
                variant("ps-red-kurta", "KUR-RED", false, null, "800.00", null, Map.of("a-colour", "v-red")),
                Set.of("v-silk", "v-m"), Map.of("c-kurtas", 1), null));
        products.add(product("p-loom-piece", "loom-piece", true, 1, "करघे की साड़ी", "Loom saree",
                variant("ps-loom-piece", "PIECE-1", true, 1, "5000.00", null, Map.of("a-colour", "v-blue")),
                Set.of("v-cotton"), Map.of("c-sarees", 3), null));

        Map<String, Product> bySlug = new LinkedHashMap<>();
        products.forEach(p -> bySlug.put(p.slug(), p));
        return new StorefrontSnapshot(INSTITUTE, settings(), List.copyOf(products), bySlug, attributes, values,
                collections, DAY_0);
    }

    public static Variant variant(String id, String sku, boolean tracked, Integer available, String price, String mrp,
                                  Map<String, String> optionValueIds) {
        return new Variant(id, sku, sku, tracked, tracked ? null : 12, 500, 100, 200, 10, null, 0, available,
                price == null ? null : new BigDecimal(price), mrp == null ? null : new BigDecimal(mrp), "INR",
                optionValueIds);
    }

    public static Product product(String packageId, String slug, boolean piece, int publishedDay, String hindiName,
                                  String englishName, Variant variant, Set<String> productValueIds,
                                  Map<String, Integer> collectionPositions, String origin) {
        return product(packageId, slug, piece, publishedDay, hindiName, englishName, List.of(variant),
                productValueIds, collectionPositions, origin);
    }

    public static Product product(String packageId, String slug, boolean piece, int publishedDay, String hindiName,
                                  String englishName, List<Variant> variants, Set<String> productValueIds,
                                  Map<String, Integer> collectionPositions, String origin) {
        Map<String, Translation> translations = new LinkedHashMap<>();
        StringBuilder search = new StringBuilder(slug);
        if (hindiName != null) {
            translations.put("hi", new Translation("hi", hindiName, null, null, List.of()));
            search.append(' ').append(hindiName);
        }
        translations.put("en", new Translation("en", englishName, "Short text of " + englishName,
                "<p>About <b>" + englishName + "</b></p><script>alert(1)</script>",
                List.of(Map.of("code", "care", "html", "<p>Dry clean only</p>"),
                        Map.of("code", "story", "html", "<p></p>"))));
        search.append(' ').append(englishName);
        Set<String> valueIds = new HashSet<>(productValueIds);
        for (Variant variant : variants) {
            valueIds.addAll(variant.optionValueIds().values());
            search.append(' ').append(variant.sku());
        }
        List<Media> media = List.of(
                new Media(null, "media-" + slug + "-styled", "IMAGE", "STYLED", Map.of("en", "Styled " + englishName),
                        1600, 2000, Map.of(), 0),
                new Media(null, "media-" + slug + "-real", "IMAGE", "REAL", Map.of("en", "Photo of " + englishName),
                        1600, 2000, Map.of("320", "media-" + slug + "-real-320", "640",
                        "https://cdn.test/" + slug + "-640.webp"), 1));
        return new Product(packageId, slug, piece, "tax-class-secret", "Khadi", "PCS", 1, 1, origin,
                DAY_0.plusSeconds(86_400L * publishedDay), DAY_0.plusSeconds(86_400L * publishedDay + 60),
                Map.of("en", Map.of("title", englishName + " | Shop", "description", "Buy " + englishName)),
                translations, List.copyOf(variants), media, valueIds, List.of("a-colour"), collectionPositions,
                StorefrontSearch.normalize(search.toString()));
    }
}
