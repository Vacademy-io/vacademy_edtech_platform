package vacademy.io.admin_core_service.features.commerce.storefront.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.LoadingCache;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
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
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Loads the public shop data of an institute with plain SQL and keeps it for {@link #TTL}.
 *
 * <p>A shop product is found by its {@code commerce_product} row and a variant by its
 * {@code commerce_variant} row, never by the package type. Only ACTIVE products and ACTIVE
 * variants are read, always under the institute id, and the cost columns are not selected at
 * all. The price is the first ACTIVE payment plan of the variant's first COMMERCE invite link,
 * the same row the admin product screen shows. Stock is {@code package_session.available_slots},
 * the number that can still be sold online.
 *
 * <p>The snapshot is read in one read-only transaction, which this service routes to the read
 * replica; the cart read ({@link #cartVariants}) uses the primary.
 *
 * <p>The catalogue tables belong to the catalogue work package and stock_location to the stock
 * one; they are only read here, so their repositories stay untouched.
 */
@Slf4j
@Component
public class StorefrontSnapshotLoader {

    /** Stock states on a listing can be this old, on top of the 60 s HTTP cache. */
    static final Duration TTL = Duration.ofSeconds(30);
    private static final String INVITE_TAG = "COMMERCE";
    private static final String LIVE = "ACTIVE";

    private static final String PRICE_SELECT = """
            SELECT l.package_session_id, l.id, pl.actual_price, pl.elevated_price, pl.currency
            FROM package_session_learner_invitation_to_payment_option l
            JOIN enroll_invite ei ON ei.id = l.enroll_invite_id
            JOIN commerce_variant v ON v.package_session_id = l.package_session_id
            LEFT JOIN payment_plan pl ON pl.payment_option_id = l.payment_option_id AND pl.status = :live
            WHERE ei.institute_id = :instituteId
              AND ei.tag = :tag
              AND v.institute_id = :instituteId
            """;
    private static final String PRICE_ORDER = """
             ORDER BY l.created_at ASC, l.id ASC, pl.created_at ASC, pl.id ASC
            """;

    @PersistenceContext
    private EntityManager entityManager;

    private final CommerceStorefrontSettings settingsReader;
    private final ObjectMapper objectMapper;
    /** Read-only transactions go to the read replica (ReplicationRoutingDataSource). */
    private final TransactionTemplate readOnly;
    /** For the cart: the primary, so a price or a stock level is never a replica-lag old one. */
    private final TransactionTemplate primary;

    /** Heap the cached shop copies of all institutes may take together, as estimated by {@link #weigh}. */
    static final long MAX_SNAPSHOT_BYTES = 192L * 1024 * 1024;
    /** Heap the long texts of product pages may take together. */
    static final long MAX_DETAIL_TEXT_BYTES = 32L * 1024 * 1024;

    /**
     * Bounded by estimated bytes, not by a count of shops: the copy holds what a listing, the
     * search and the facets need of every ACTIVE product, and one large shop must not take the
     * heap every institute shares. The long texts of a product (description, content blocks)
     * are not part of it; the product page reads them per product ({@link #withDetailTexts}).
     */
    private final LoadingCache<String, StorefrontSnapshot> snapshots = Caffeine.newBuilder()
            .expireAfterWrite(TTL).maximumWeight(MAX_SNAPSHOT_BYTES)
            .weigher((String key, StorefrontSnapshot value) -> weigh(value)).build(this::load);

    /** institute id + package id to the product's texts in every language. */
    private final Cache<String, Map<String, Translation>> detailTexts = Caffeine.newBuilder()
            .expireAfterWrite(TTL).maximumWeight(MAX_DETAIL_TEXT_BYTES)
            .weigher((String key, Map<String, Translation> value) -> weighTexts(value)).build();

    public StorefrontSnapshotLoader(CommerceStorefrontSettings settingsReader, ObjectMapper objectMapper,
                                    PlatformTransactionManager transactionManager) {
        this.settingsReader = settingsReader;
        this.objectMapper = objectMapper;
        this.readOnly = new TransactionTemplate(transactionManager);
        this.readOnly.setReadOnly(true);
        this.primary = new TransactionTemplate(transactionManager);
    }

    public StorefrontSnapshot snapshot(String instituteId) {
        return snapshots.get(instituteId);
    }

    /** Drops the cached shop data of an institute (after a product or a setting changes). */
    public void evict(String instituteId) {
        snapshots.invalidate(instituteId);
        detailTexts.asMap().keySet().removeIf(key -> key.startsWith(instituteId + "|"));
    }

    /**
     * The product with its description and content blocks in every language, for the product
     * page. The shop copy carries the product without them.
     */
    public Product withDetailTexts(String instituteId, Product product) {
        Map<String, Translation> texts = detailTexts.get(instituteId + "|" + product.packageId(),
                key -> readOnly.execute(status -> readDetailTexts(instituteId, product.packageId())));
        if (texts == null || texts.isEmpty()) {
            return product;
        }
        return new Product(product.packageId(), product.slug(), product.piece(), product.taxClassId(),
                product.brand(), product.unit(), product.qtyScale(), product.qtyStep(), product.originName(),
                product.publishedAt(), product.updatedAt(), product.seoI18n(), texts, product.variants(),
                product.media(), product.attributeValueIds(), product.optionAttributeIds(),
                product.collectionPositions(), product.searchText());
    }

    private Map<String, Translation> readDetailTexts(String instituteId, String packageId) {
        Map<String, Translation> out = new LinkedHashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT t.locale, t.name, t.short_description, t.description_html,
                               CAST(t.content_blocks AS TEXT)
                        FROM commerce_product_translation t
                        JOIN commerce_product p ON p.package_id = t.package_id AND p.institute_id = t.institute_id
                        WHERE t.institute_id = :instituteId AND t.package_id = :packageId AND p.status = :live
                        """)
                .setParameter("instituteId", instituteId).setParameter("packageId", packageId)
                .setParameter("live", LIVE))) {
            String locale = text(r[0]) == null ? "" : text(r[0]).toLowerCase(java.util.Locale.ROOT);
            out.put(locale, new Translation(locale, text(r[1]), text(r[2]), text(r[3]), jsonList(r[4])));
        }
        return out;
    }

    /** A rough size of one shop copy on the heap: two bytes a character plus a fixed part per row. */
    static int weigh(StorefrontSnapshot snapshot) {
        long bytes = 4_096;
        for (Product product : snapshot.products()) {
            bytes += 600 + 2L * length(product.searchText()) + 2L * length(product.slug())
                    + 400L * product.variants().size() + 500L * product.media().size()
                    + 2L * String.valueOf(product.seoI18n()).length() + weighTexts(product.translations());
        }
        bytes += 300L * (snapshot.attributes().size() + snapshot.attributeValues().size()
                + snapshot.collections().size());
        return (int) Math.min(Integer.MAX_VALUE, bytes);
    }

    static int weighTexts(Map<String, Translation> translations) {
        long bytes = 200;
        for (Translation t : translations.values()) {
            bytes += 200 + 2L * (length(t.name()) + length(t.shortDescription()) + length(t.descriptionHtml()));
            if (t.contentBlocks() != null && !t.contentBlocks().isEmpty()) {
                bytes += 2L * String.valueOf(t.contentBlocks()).length();
            }
        }
        return (int) Math.min(Integer.MAX_VALUE, bytes);
    }

    private static int length(String value) {
        return value == null ? 0 : value.length();
    }

    private StorefrontSnapshot load(String instituteId) {
        StorefrontSettings settings = settingsReader.read(instituteId);
        StorefrontSnapshot loaded = readOnly.execute(status -> read(instituteId, settings));
        log.debug("storefront: loaded {} products for institute {}", loaded.products().size(), instituteId);
        return loaded;
    }

    // ------------------------------------------------------------------ the cart

    /**
     * One variant as the cart prices it, read at the moment of pricing (never from the cache,
     * and from the primary database): the price and the stock a shopper is charged for must be
     * the current ones.
     */
    public record CartVariant(String packageSessionId, String packageId, String sku, String slug, boolean productActive,
                              boolean variantActive, boolean tracked, boolean piece, String taxClassId, String unit,
                              int qtyScale, int qtyStep, Integer weightGrams, Integer availableSlots,
                              String legacyName, Map<String, String> names, BigDecimal price, BigDecimal mrp,
                              String currency, List<OptionLabel> options) {

        public CartVariant(String packageSessionId, String packageId, String sku, String slug, boolean productActive,
                           boolean variantActive, boolean tracked, boolean piece, String taxClassId, String unit,
                           int qtyScale, int qtyStep, Integer weightGrams, Integer availableSlots,
                           String legacyName, Map<String, String> names, BigDecimal price, BigDecimal mrp,
                           String currency) {
            this(packageSessionId, packageId, sku, slug, productActive, variantActive, tracked, piece, taxClassId,
                    unit, qtyScale, qtyStep, weightGrams, availableSlots, legacyName, names, price, mrp, currency,
                    List.of());
        }
    }

    /** One option value of a variant ("Red", "M"), in the option order of its product. */
    public record OptionLabel(String code, Map<String, String> labelI18n) {
    }

    /**
     * The variants of this institute among the given package session ids and SKUs, keyed by
     * package session id. An id of another institute is simply absent.
     */
    public Map<String, CartVariant> cartVariants(String instituteId, java.util.Collection<String> packageSessionIds,
                                                 java.util.Collection<String> skus) {
        List<String> ids = clean(packageSessionIds);
        List<String> skuList = clean(skus);
        if (ids.isEmpty() && skuList.isEmpty()) {
            return Map.of();
        }
        return primary.execute(status -> readCartVariants(instituteId, ids, skuList));
    }

    /**
     * The location whose stock the website sells (at most one per institute in Phase 1), or
     * null. The cart takes the seller state for tax from it.
     */
    public String onlineLocationId(String instituteId) {
        List<?> ids = readOnly.execute(status -> entityManager.createNativeQuery("""
                        SELECT id FROM stock_location
                        WHERE institute_id = :instituteId AND sells_online AND status = :live
                        """)
                .setParameter("instituteId", instituteId).setParameter("live", LIVE)
                .getResultList());
        return ids == null || ids.isEmpty() || ids.get(0) == null ? null : ids.get(0).toString();
    }

    private Map<String, CartVariant> readCartVariants(String instituteId, List<String> ids, List<String> skus) {
        // A list parameter cannot be empty in SQL, so an unused list carries one value no id has.
        List<Object[]> rows = rows(entityManager.createNativeQuery("""
                        SELECT v.package_session_id, v.package_id, v.sku, p.slug, p.status, v.status,
                               v.stock_policy, p.stock_mode, p.tax_class_id, p.unit, p.qty_scale, p.qty_step,
                               v.weight_grams, ps.available_slots, ps.name
                        FROM commerce_variant v
                        JOIN commerce_product p ON p.package_id = v.package_id AND p.institute_id = v.institute_id
                        JOIN package_session ps ON ps.id = v.package_session_id
                        WHERE v.institute_id = :instituteId
                          AND (v.package_session_id IN (:ids) OR v.sku IN (:skus))
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", ids.isEmpty() ? List.of("-") : ids)
                .setParameter("skus", skus.isEmpty() ? List.of("-") : skus));
        if (rows.isEmpty()) {
            return Map.of();
        }
        List<String> sessionIds = rows.stream().map(r -> text(r[0])).toList();
        Set<String> packageIds = new HashSet<>();
        rows.forEach(r -> packageIds.add(text(r[1])));
        Map<String, Price> prices = prices(entityManager.createNativeQuery(
                        PRICE_SELECT + " AND l.package_session_id IN (:ids)" + PRICE_ORDER)
                .setParameter("ids", sessionIds), instituteId);
        Map<String, Map<String, String>> names = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT t.package_id, t.locale, t.name
                        FROM commerce_product_translation t
                        WHERE t.institute_id = :instituteId AND t.package_id IN (:packageIds)
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("packageIds", packageIds))) {
            names.computeIfAbsent(text(r[0]), k -> new LinkedHashMap<>()).put(text(r[1]), text(r[2]));
        }
        // The option values of each variant in the option order of its product: what tells two
        // variants of one product apart on a cart line, an order line and an invoice line.
        Map<String, List<OptionLabel>> options = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT ov.package_session_id, av.code, CAST(av.label_i18n AS TEXT)
                        FROM commerce_variant_option_value ov
                        JOIN commerce_variant v ON v.package_session_id = ov.package_session_id
                                               AND v.institute_id = ov.institute_id
                        JOIN commerce_attribute_value av ON av.id = ov.attribute_value_id
                                                        AND av.institute_id = ov.institute_id
                        LEFT JOIN commerce_product_option po ON po.package_id = v.package_id
                                                            AND po.attribute_id = ov.attribute_id
                                                            AND po.institute_id = ov.institute_id
                        WHERE ov.institute_id = :instituteId AND ov.package_session_id IN (:ids)
                        ORDER BY po.position ASC NULLS LAST, po.id ASC, ov.attribute_id ASC
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("ids", sessionIds))) {
            options.computeIfAbsent(text(r[0]), k -> new ArrayList<>())
                    .add(new OptionLabel(text(r[1]), jsonTextMap(r[2])));
        }
        Map<String, CartVariant> out = new LinkedHashMap<>();
        for (Object[] r : rows) {
            String sessionId = text(r[0]);
            Price price = prices.get(sessionId);
            out.put(sessionId, new CartVariant(sessionId, text(r[1]), text(r[2]), text(r[3]),
                    LIVE.equals(text(r[4])), LIVE.equals(text(r[5])), !"UNTRACKED".equals(text(r[6])),
                    "PIECE".equals(text(r[7])), text(r[8]), text(r[9]), intOr(r[10], 1), intOr(r[11], 1),
                    integer(r[12]), integer(r[13]), text(r[14]), names.getOrDefault(text(r[1]), Map.of()),
                    price == null ? null : price.amount(), price == null ? null : price.mrp(),
                    price == null ? null : price.currency(),
                    List.copyOf(options.getOrDefault(sessionId, List.of()))));
        }
        return out;
    }

    // ------------------------------------------------------------------ the snapshot

    private StorefrontSnapshot read(String instituteId, StorefrontSettings settings) {
        Map<String, Map<String, Translation>> translations = new HashMap<>();
        Map<String, StringBuilder> searchText = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT t.package_id, t.locale, t.name, t.short_description, t.search_text
                        FROM commerce_product_translation t
                        JOIN commerce_product p ON p.package_id = t.package_id AND p.institute_id = t.institute_id
                        WHERE t.institute_id = :instituteId AND p.status = :live
                        """)
                .setParameter("instituteId", instituteId).setParameter("live", LIVE))) {
            String packageId = text(r[0]);
            String locale = text(r[1]) == null ? "" : text(r[1]).toLowerCase(java.util.Locale.ROOT);
            translations.computeIfAbsent(packageId, k -> new LinkedHashMap<>())
                    .put(locale, new Translation(locale, text(r[2]), text(r[3]), null, List.of()));
            StringBuilder all = searchText.computeIfAbsent(packageId, k -> new StringBuilder());
            all.append(' ').append(text(r[2]) == null ? "" : text(r[2]))
                    .append(' ').append(text(r[4]) == null ? "" : text(r[4]));
        }

        Map<String, Price> prices = prices(entityManager.createNativeQuery(PRICE_SELECT + PRICE_ORDER),
                instituteId);

        Map<String, Map<String, String>> optionValues = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT package_session_id, attribute_id, attribute_value_id
                        FROM commerce_variant_option_value
                        WHERE institute_id = :instituteId
                        """)
                .setParameter("instituteId", instituteId))) {
            optionValues.computeIfAbsent(text(r[0]), k -> new LinkedHashMap<>()).put(text(r[1]), text(r[2]));
        }

        Map<String, List<Variant>> variants = new HashMap<>();
        Set<String> liveVariantIds = new HashSet<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT v.package_session_id, v.package_id, v.sku, v.stock_policy, v.lead_time_days,
                               v.weight_grams, v.length_mm, v.width_mm, v.height_mm, v.media_id, v.position,
                               ps.available_slots, ps.name
                        FROM commerce_variant v
                        JOIN commerce_product p ON p.package_id = v.package_id AND p.institute_id = v.institute_id
                        JOIN package_session ps ON ps.id = v.package_session_id
                        WHERE v.institute_id = :instituteId AND v.status = :live AND p.status = :live
                        ORDER BY v.position ASC, v.created_at ASC, v.id ASC
                        """)
                .setParameter("instituteId", instituteId).setParameter("live", LIVE))) {
            String sessionId = text(r[0]);
            liveVariantIds.add(sessionId);
            Price price = prices.get(sessionId);
            variants.computeIfAbsent(text(r[1]), k -> new ArrayList<>()).add(new Variant(sessionId, text(r[2]),
                    text(r[12]), !"UNTRACKED".equals(text(r[3])), integer(r[4]), integer(r[5]), integer(r[6]),
                    integer(r[7]), integer(r[8]), text(r[9]), intOr(r[10], 0), integer(r[11]),
                    price == null ? null : price.amount(), price == null ? null : price.mrp(),
                    price == null ? null : price.currency(),
                    Map.copyOf(optionValues.getOrDefault(sessionId, Map.of()))));
            if (text(r[2]) != null) {
                searchText.computeIfAbsent(text(r[1]), k -> new StringBuilder()).append(' ').append(text(r[2]));
            }
        }

        Map<String, Attribute> attributes = new LinkedHashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT id, code, CAST(name_i18n AS TEXT), kind, is_filterable, position
                        FROM commerce_attribute
                        WHERE institute_id = :instituteId
                        ORDER BY position ASC, code ASC
                        """)
                .setParameter("instituteId", instituteId))) {
            attributes.put(text(r[0]), new Attribute(text(r[0]), text(r[1]), jsonTextMap(r[2]), text(r[3]),
                    Boolean.TRUE.equals(r[4]), intOr(r[5], 0)));
        }
        Map<String, AttributeValue> attributeValues = new LinkedHashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT id, attribute_id, code, CAST(label_i18n AS TEXT), swatch_hex, position
                        FROM commerce_attribute_value
                        WHERE institute_id = :instituteId
                        ORDER BY position ASC, code ASC
                        """)
                .setParameter("instituteId", instituteId))) {
            attributeValues.put(text(r[0]), new AttributeValue(text(r[0]), text(r[1]), text(r[2]),
                    jsonTextMap(r[3]), text(r[4]), intOr(r[5], 0)));
        }

        Map<String, Set<String>> productValues = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT package_id, attribute_value_id
                        FROM commerce_product_attribute_value
                        WHERE institute_id = :instituteId
                        """)
                .setParameter("instituteId", instituteId))) {
            productValues.computeIfAbsent(text(r[0]), k -> new HashSet<>()).add(text(r[1]));
        }
        Map<String, List<String>> productOptions = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT package_id, attribute_id
                        FROM commerce_product_option
                        WHERE institute_id = :instituteId
                        ORDER BY position ASC, id ASC
                        """)
                .setParameter("instituteId", instituteId))) {
            productOptions.computeIfAbsent(text(r[0]), k -> new ArrayList<>()).add(text(r[1]));
        }

        Map<String, List<Media>> media = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT package_id, package_session_id, media_id, kind, tag, CAST(alt_i18n AS TEXT),
                               width, height, CAST(renditions_json AS TEXT), position
                        FROM commerce_product_media
                        WHERE institute_id = :instituteId
                        ORDER BY position ASC, created_at ASC, id ASC
                        """)
                .setParameter("instituteId", instituteId))) {
            Map<String, Object> renditions = jsonMap(r[8]);
            if ("FAILED".equals(renditions.get("_status")) && "NOT_PUBLIC".equals(renditions.get("_error"))) {
                // The media service refused the file: it was not uploaded as a product image of
                // this shop. Such a row is never shown, not even by the address of the original.
                continue;
            }
            if (text(r[1]) != null && !liveVariantIds.contains(text(r[1]))) {
                // A photo of a variant that is not on sale (archived, or of a draft product).
                continue;
            }
            media.computeIfAbsent(text(r[0]), k -> new ArrayList<>()).add(new Media(text(r[1]), text(r[2]),
                    text(r[3]), text(r[4]), jsonTextMap(r[5]), integer(r[6]), integer(r[7]), renditions,
                    intOr(r[9], 0)));
        }

        List<Collection> collections = new ArrayList<>();
        Set<String> liveCollections = new HashSet<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT id, parent_id, kind, slug, CAST(name_i18n AS TEXT), CAST(description_i18n AS TEXT),
                               media_id, position, updated_at
                        FROM commerce_collection
                        WHERE institute_id = :instituteId AND status = :live
                        ORDER BY position ASC, slug ASC
                        """)
                .setParameter("instituteId", instituteId).setParameter("live", LIVE))) {
            collections.add(new Collection(text(r[0]), text(r[1]), text(r[2]), text(r[3]), jsonTextMap(r[4]),
                    jsonTextMap(r[5]), text(r[6]), intOr(r[7], 0), instant(r[8])));
            liveCollections.add(text(r[0]));
        }
        Map<String, Map<String, Integer>> productCollections = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT collection_id, package_id, position
                        FROM commerce_product_collection
                        WHERE institute_id = :instituteId
                        """)
                .setParameter("instituteId", instituteId))) {
            if (liveCollections.contains(text(r[0]))) {
                productCollections.computeIfAbsent(text(r[1]), k -> new HashMap<>()).put(text(r[0]), intOr(r[2], 0));
            }
        }

        List<Product> products = new ArrayList<>();
        Map<String, Product> bySlug = new HashMap<>();
        for (Object[] r : rows(entityManager.createNativeQuery("""
                        SELECT p.package_id, p.slug, p.stock_mode, p.tax_class_id, p.brand, p.unit, p.qty_scale,
                               p.qty_step, p.published_at, p.updated_at, CAST(p.seo_i18n AS TEXT), sl.name
                        FROM commerce_product p
                        LEFT JOIN stock_location sl ON sl.id = p.origin_location_id
                                                   AND sl.institute_id = p.institute_id
                        WHERE p.institute_id = :instituteId AND p.status = :live
                        ORDER BY p.published_at DESC NULLS LAST, p.package_id ASC
                        """)
                .setParameter("instituteId", instituteId).setParameter("live", LIVE))) {
            String packageId = text(r[0]);
            List<Variant> ownVariants = variants.getOrDefault(packageId, List.of());
            Set<String> valueIds = new HashSet<>(productValues.getOrDefault(packageId, Set.of()));
            for (Variant variant : ownVariants) {
                valueIds.addAll(variant.optionValueIds().values());
            }
            StringBuilder search = searchText.getOrDefault(packageId, new StringBuilder());
            search.append(' ').append(text(r[1]));
            Product product = new Product(packageId, text(r[1]), "PIECE".equals(text(r[2])), text(r[3]), text(r[4]),
                    text(r[5]) == null ? "PCS" : text(r[5]), intOr(r[6], 1), intOr(r[7], 1), text(r[11]),
                    instant(r[8]), instant(r[9]), jsonMap(r[10]),
                    translations.getOrDefault(packageId, Map.of()), List.copyOf(ownVariants),
                    List.copyOf(media.getOrDefault(packageId, List.of())), Set.copyOf(valueIds),
                    List.copyOf(productOptions.getOrDefault(packageId, List.of())),
                    Map.copyOf(productCollections.getOrDefault(packageId, Map.of())),
                    StorefrontSearch.normalize(search.toString()));
            products.add(product);
            bySlug.put(product.slug(), product);
        }
        products.sort(Comparator.comparing(Product::publishedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(Product::packageId));
        return new StorefrontSnapshot(instituteId, settings, List.copyOf(products), Map.copyOf(bySlug),
                attributes, attributeValues, List.copyOf(collections), Instant.now());
    }

    private record Price(BigDecimal amount, BigDecimal mrp, String currency) {
    }

    /**
     * The first row of a variant decides: it is the first link, with that link's first ACTIVE
     * plan, or no plan at all (then the variant has no price).
     */
    private Map<String, Price> prices(Query query, String instituteId) {
        Map<String, Price> out = new HashMap<>();
        Set<String> decided = new HashSet<>();
        for (Object[] r : rows(query.setParameter("instituteId", instituteId)
                .setParameter("tag", INVITE_TAG).setParameter("live", LIVE))) {
            String sessionId = text(r[0]);
            if (!decided.add(sessionId) || r[2] == null) {
                continue;
            }
            BigDecimal amount = money(r[2]);
            BigDecimal mrp = money(r[3]);
            out.put(sessionId, new Price(amount, mrp != null && mrp.compareTo(amount) > 0 ? mrp : null, text(r[4])));
        }
        return out;
    }

    // ------------------------------------------------------------------ helpers

    @SuppressWarnings("unchecked")
    private static List<Object[]> rows(Query query) {
        return query.getResultList();
    }

    private static List<String> clean(java.util.Collection<String> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream().filter(v -> v != null && !v.isBlank()).map(String::trim).distinct().toList();
    }

    private static String text(Object value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.toString().trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static Integer integer(Object value) {
        return value instanceof Number n ? n.intValue() : null;
    }

    private static int intOr(Object value, int fallback) {
        return value instanceof Number n ? n.intValue() : fallback;
    }

    /** A price column (a double in the legacy table) as rupees with two decimals. */
    private static BigDecimal money(Object value) {
        if (value instanceof BigDecimal b) {
            return b.setScale(2, RoundingMode.HALF_UP);
        }
        if (value instanceof Number n) {
            return BigDecimal.valueOf(n.doubleValue()).setScale(2, RoundingMode.HALF_UP);
        }
        return null;
    }

    /** The JVM and the database both keep UTC. */
    private static Instant instant(Object value) {
        if (value instanceof Timestamp t) {
            return t.toInstant();
        }
        if (value instanceof LocalDateTime l) {
            return l.toInstant(ZoneOffset.UTC);
        }
        if (value instanceof OffsetDateTime o) {
            return o.toInstant();
        }
        if (value instanceof Instant i) {
            return i;
        }
        if (value instanceof java.util.Date d) {
            return d.toInstant();
        }
        return null;
    }

    private Map<String, Object> jsonMap(Object value) {
        String json = text(value);
        if (json == null || !json.startsWith("{")) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {
            });
        } catch (Exception e) {
            return Map.of();
        }
    }

    private Map<String, String> jsonTextMap(Object value) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : jsonMap(value).entrySet()) {
            if (e.getValue() instanceof String s && !s.isBlank()) {
                out.put(e.getKey().toLowerCase(java.util.Locale.ROOT), s.trim());
            }
        }
        return out;
    }

    private List<Map<String, Object>> jsonList(Object value) {
        String json = text(value);
        if (json == null || !json.startsWith("[")) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json, new TypeReference<List<Map<String, Object>>>() {
            });
        } catch (Exception e) {
            return List.of();
        }
    }
}
