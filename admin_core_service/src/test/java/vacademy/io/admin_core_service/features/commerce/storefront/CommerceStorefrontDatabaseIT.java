package vacademy.io.admin_core_service.features.commerce.storefront;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.jpa.repository.support.JpaRepositoryFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.orm.jpa.JpaTransactionManager;
import org.springframework.orm.jpa.LocalContainerEntityManagerFactoryBean;
import org.springframework.orm.jpa.SharedEntityManagerCreator;
import org.springframework.orm.jpa.vendor.HibernateJpaVendorAdapter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogMediaResolver;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.order.dto.ShippingRuleDTO;
import vacademy.io.admin_core_service.features.commerce.order.entity.CommerceShippingRule;
import vacademy.io.admin_core_service.features.commerce.order.pincode.CommercePincodeService;
import vacademy.io.admin_core_service.features.commerce.order.repository.CommerceShippingRuleRepository;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceShippingRuleService;
import vacademy.io.admin_core_service.features.commerce.order.shipping.CommerceShippingCalculator;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSnapshot;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontCatalogService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader.CartVariant;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Database-backed check of the storefront reads and the shipping rule (WP-10, WP-11): the SQL
 * of {@link StorefrontSnapshotLoader} and {@link CommercePincodeService} and the
 * {@code commerce_shipping_rule} mapping, on a real Postgres whose schema came from the Flyway
 * files up to V683.
 *
 * <p>Not part of the default build: the name ends in IT and every test is skipped unless
 * COMMERCE_IT_PG_URL names a local throwaway database (user COMMERCE_IT_PG_USER, default
 * postgres; password COMMERCE_IT_PG_PASSWORD, default empty), like the other commerce IT
 * classes. Unlike them it does not start the application: it opens its own JPA session on that
 * database, so it runs in a few seconds. It writes rows under an institute id of its own and
 * leaves them there, so never point it at a shared database.
 */
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class CommerceStorefrontDatabaseIT {

    private final String institute = UUID.randomUUID().toString();
    private final String otherInstitute = UUID.randomUUID().toString();
    /** Unique per run, so a second run on the same database does not collide on slugs or SKUs. */
    private final String run = UUID.randomUUID().toString().substring(0, 8);

    private LocalContainerEntityManagerFactoryBean factoryBean;
    private JdbcTemplate jdbc;
    private JpaTransactionManager transactionManager;
    private EntityManager entityManager;
    private StorefrontSnapshotLoader loader;
    private StorefrontSettings settings;

    @BeforeAll
    void connect() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(System.getenv("COMMERCE_IT_PG_URL"),
                envOr("COMMERCE_IT_PG_USER", "postgres"), envOr("COMMERCE_IT_PG_PASSWORD", ""));
        dataSource.setDriverClassName("org.postgresql.Driver");
        jdbc = new JdbcTemplate(dataSource);

        factoryBean = new LocalContainerEntityManagerFactoryBean();
        factoryBean.setDataSource(dataSource);
        factoryBean.setPackagesToScan("vacademy.io.admin_core_service.features.commerce.order.entity",
                "vacademy.io.admin_core_service.features.commerce.catalogue.entity");
        factoryBean.setJpaVendorAdapter(new HibernateJpaVendorAdapter());
        Properties jpa = new Properties();
        // As production: Hibernate neither changes nor checks the schema.
        jpa.setProperty("hibernate.hbm2ddl.auto", "none");
        jpa.setProperty("hibernate.dialect", "org.hibernate.dialect.PostgreSQLDialect");
        factoryBean.setJpaProperties(jpa);
        factoryBean.afterPropertiesSet();
        EntityManagerFactory factory = factoryBean.getObject();
        transactionManager = new JpaTransactionManager(factory);
        entityManager = SharedEntityManagerCreator.createSharedEntityManager(factory);

        settings = new StorefrontSettings("hi", 3, "REAL", List.of(new BigDecimal("1000.00")), Map.of(),
                StorefrontSettings.defaults().cod(), null, 25, List.of());
        CommerceStorefrontSettings settingsReader = mock(CommerceStorefrontSettings.class);
        when(settingsReader.read(any())).thenReturn(settings);
        loader = new StorefrontSnapshotLoader(settingsReader, new ObjectMapper(), transactionManager);
        ReflectionTestUtils.setField(loader, "entityManager", entityManager);

        seed();
    }

    @AfterAll
    void close() {
        if (factoryBean != null) {
            factoryBean.destroy();
        }
    }

    private static String envOr(String name, String fallback) {
        String value = System.getenv(name);
        return value == null ? fallback : value;
    }

    // ------------------------------------------------------------------ seed

    private String id(String name) {
        return name + "-" + run;
    }

    /**
     * One shop: a saree with two variants (10 in stock, and made to order), a kurta with two
     * left, a draft product, an archived variant, and a product of another institute.
     */
    private void seed() {
        jdbc.update("INSERT INTO stock_location (id, institute_id, code, name, state_code, is_source, sells_online)"
                + " VALUES (?, ?, ?, 'Khadi Gram', '09', TRUE, TRUE)", id("loc"), institute, id("LOC"));

        jdbc.update("INSERT INTO commerce_attribute (id, institute_id, code, name_i18n, kind, is_filterable, position)"
                + " VALUES (?, ?, 'colour', CAST(? AS JSONB), 'SWATCH', TRUE, 1)", id("a-colour"), institute,
                "{\"en\": \"Colour\", \"hi\": \"रंग\"}");
        jdbc.update("INSERT INTO commerce_attribute (id, institute_id, code, name_i18n, kind, is_filterable, position)"
                + " VALUES (?, ?, 'fabric', CAST(? AS JSONB), 'TEXT', TRUE, 2)", id("a-fabric"), institute,
                "{\"en\": \"Fabric\"}");
        value("v-red", "a-colour", "red", "{\"en\": \"Red\", \"hi\": \"लाल\"}", "#aa0000");
        value("v-blue", "a-colour", "blue", "{\"en\": \"Blue\"}", "#0000aa");
        value("v-cotton", "a-fabric", "cotton", "{\"en\": \"Cotton\"}", null);

        product(institute, "p-saree", "saree-" + run, "ACTIVE", "QUANTITY", id("loc"));
        translation(institute, "p-saree", "hi", "लाल सूती साड़ी", "लाल सूती साड़ी sar-red-" + run + " लाल");
        translation(institute, "p-saree", "en", "Red cotton saree", "red cotton saree sar-red-" + run + " red");
        variant(institute, "p-saree", "ps-saree-red", "SAR-RED-" + run, "TRACKED", "ACTIVE", 10, 0);
        variant(institute, "p-saree", "ps-saree-mto", "SAR-MTO-" + run, "UNTRACKED", "ACTIVE", null, 1);
        variant(institute, "p-saree", "ps-saree-old", "SAR-OLD-" + run, "TRACKED", "ARCHIVED", 5, 2);
        // The first link of the red variant carries 1000 (and an inactive plan of 1); a later link carries 900.
        price(institute, "ps-saree-red", "first", 1000.0, 1500.0, "ACTIVE", "2026-01-01 00:00:00");
        plan("ps-saree-red-first", "inactive", 1.0, "DELETED", "2025-01-01 00:00:00");
        price(institute, "ps-saree-red", "second", 900.0, 0.0, "ACTIVE", "2026-02-01 00:00:00");
        // The first link of the made-to-order variant has no ACTIVE plan: it has no price.
        price(institute, "ps-saree-mto", "first", 700.0, 0.0, "DELETED", "2026-01-01 00:00:00");
        price(institute, "ps-saree-mto", "second", 650.0, 0.0, "ACTIVE", "2026-02-01 00:00:00");
        price(institute, "ps-saree-old", "first", 400.0, 0.0, "ACTIVE", "2026-01-01 00:00:00");
        jdbc.update("INSERT INTO commerce_product_attribute_value (id, institute_id, package_id, attribute_value_id)"
                + " VALUES (?, ?, ?, ?)", id("pav-1"), institute, id("p-saree"), id("v-cotton"));
        jdbc.update("INSERT INTO commerce_product_option (id, institute_id, package_id, attribute_id, position)"
                + " VALUES (?, ?, ?, ?, 0)", id("po-1"), institute, id("p-saree"), id("a-colour"));
        jdbc.update("INSERT INTO commerce_variant_option_value (id, institute_id, package_session_id, attribute_id,"
                + " attribute_value_id) VALUES (?, ?, ?, ?, ?)", id("vov-1"), institute, id("ps-saree-red"),
                id("a-colour"), id("v-red"));
        jdbc.update("INSERT INTO commerce_variant_option_value (id, institute_id, package_session_id, attribute_id,"
                + " attribute_value_id) VALUES (?, ?, ?, ?, ?)", id("vov-2"), institute, id("ps-saree-mto"),
                id("a-colour"), id("v-blue"));
        jdbc.update("INSERT INTO commerce_product_media (id, institute_id, package_id, package_session_id, media_id,"
                + " kind, tag, alt_i18n, width, height, renditions_json, position)"
                + " VALUES (?, ?, ?, NULL, 'media-styled', 'IMAGE', 'STYLED', NULL, 1600, 2000, NULL, 0)",
                id("m-1"), institute, id("p-saree"));
        jdbc.update("INSERT INTO commerce_product_media (id, institute_id, package_id, package_session_id, media_id,"
                + " kind, tag, alt_i18n, width, height, renditions_json, position)"
                + " VALUES (?, ?, ?, ?, 'media-real', 'IMAGE', 'REAL', CAST(? AS JSONB), 1600, 2000,"
                + " CAST(? AS JSONB), 1)", id("m-2"), institute, id("p-saree"), id("ps-saree-red"),
                "{\"en\": \"Red saree on a loom\"}",
                "{\"320\": \"https://cdn.test/r-320.webp\", \"640\": \"media-real-640\"}");

        product(institute, "p-kurta", "kurta-" + run, "ACTIVE", "QUANTITY", null);
        translation(institute, "p-kurta", "en", "Blue kurta", "blue kurta kur-blu-" + run);
        variant(institute, "p-kurta", "ps-kurta", "KUR-BLU-" + run, "TRACKED", "ACTIVE", 2, 0);
        price(institute, "ps-kurta", "first", 800.0, 0.0, "ACTIVE", "2026-01-01 00:00:00");

        product(institute, "p-draft", "draft-" + run, "DRAFT", "QUANTITY", null);
        translation(institute, "p-draft", "en", "Draft shawl", "draft shawl");
        variant(institute, "p-draft", "ps-draft", "DRAFT-" + run, "TRACKED", "ACTIVE", 9, 0);
        price(institute, "ps-draft", "first", 300.0, 0.0, "ACTIVE", "2026-01-01 00:00:00");

        product(otherInstitute, "p-other", "other-" + run, "ACTIVE", "QUANTITY", null);
        translation(otherInstitute, "p-other", "en", "Other shop saree", "other shop saree");
        variant(otherInstitute, "p-other", "ps-other", "OTHER-" + run, "TRACKED", "ACTIVE", 7, 0);
        price(otherInstitute, "ps-other", "first", 100.0, 0.0, "ACTIVE", "2026-01-01 00:00:00");

        collection("c-sarees", null, "sarees-" + run, "ACTIVE", "{\"en\": \"Sarees\", \"hi\": \"साड़ियां\"}");
        collection("c-cotton", id("c-sarees"), "cotton-sarees-" + run, "ACTIVE", "{\"en\": \"Cotton sarees\"}");
        collection("c-hidden", null, "hidden-" + run, "ARCHIVED", "{\"en\": \"Hidden\"}");
        memberOf("c-cotton", "p-saree", 4);
        memberOf("c-hidden", "p-kurta", 1);
    }

    private void value(String name, String attribute, String code, String labels, String swatch) {
        jdbc.update("INSERT INTO commerce_attribute_value (id, institute_id, attribute_id, code, label_i18n,"
                + " swatch_hex, position) VALUES (?, ?, ?, ?, CAST(? AS JSONB), ?, 0)", id(name), institute,
                id(attribute), code, labels, swatch);
    }

    private void product(String instituteId, String name, String slug, String status, String stockMode,
                         String originLocationId) {
        jdbc.update("INSERT INTO package (id, status, package_name) VALUES (?, 'ACTIVE', ?)", id(name), slug);
        jdbc.update("INSERT INTO commerce_product (id, institute_id, package_id, slug, stock_mode, tax_class_id,"
                + " brand, unit, qty_scale, qty_step, origin_location_id, status, published_at, seo_i18n)"
                + " VALUES (?, ?, ?, ?, ?, ?, 'Khadi', 'PCS', 1, 1, ?, ?, TIMESTAMP '2026-10-01 10:00:00',"
                + " CAST(? AS JSONB))", id("cp-" + name), instituteId, id(name), slug, stockMode, id("tax-class"),
                originLocationId, status, "{\"en\": {\"title\": \"SEO title\"}}");
    }

    private void translation(String instituteId, String product, String locale, String name, String searchText) {
        jdbc.update("INSERT INTO commerce_product_translation (id, institute_id, package_id, locale, name,"
                + " short_description, description_html, content_blocks, search_text)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSONB), ?)", UUID.randomUUID().toString(), instituteId,
                id(product), locale, name, "Short " + name, "<p>" + name + "</p>",
                "[{\"code\": \"care\", \"html\": \"<p>Dry clean</p>\"}]", searchText.toLowerCase());
    }

    private void variant(String instituteId, String product, String session, String sku, String stockPolicy,
                         String status, Integer available, int position) {
        jdbc.update("INSERT INTO package_session (id, package_id, status, name, available_slots, max_seats)"
                + " VALUES (?, ?, 'ACTIVE', ?, ?, ?)", id(session), id(product), sku, available, available);
        jdbc.update("INSERT INTO commerce_variant (id, institute_id, package_session_id, package_id, sku,"
                + " stock_policy, lead_time_days, weight_grams, cost_price, position, status)"
                + " VALUES (?, ?, ?, ?, ?, ?, ?, 450, 123.4567, ?, ?)", id("cv-" + session), instituteId, id(session),
                id(product), sku, stockPolicy, "UNTRACKED".equals(stockPolicy) ? 12 : null, position, status);
    }

    /** An invite link of a variant with one plan. */
    private void price(String instituteId, String session, String link, double price, double mrp, String planStatus,
                       String linkCreatedAt) {
        String key = session + "-" + link;
        jdbc.update("INSERT INTO enroll_invite (id, institute_id, tag, status) VALUES (?, ?, 'COMMERCE', 'ACTIVE')",
                id("ei-" + key), instituteId);
        jdbc.update("INSERT INTO payment_option (id, status) VALUES (?, 'ACTIVE')", id("po-" + key));
        jdbc.update("INSERT INTO package_session_learner_invitation_to_payment_option (id, enroll_invite_id,"
                + " package_session_id, payment_option_id, status, created_at)"
                + " VALUES (?, ?, ?, ?, 'ACTIVE', CAST(? AS TIMESTAMP))", id("l-" + key), id("ei-" + key),
                id(session), id("po-" + key), linkCreatedAt);
        plan(key, "plan", price, planStatus, "2026-01-01 00:00:00");
        jdbc.update("UPDATE payment_plan SET elevated_price = ? WHERE id = ?", mrp, id("pl-" + key + "-plan"));
    }

    private void plan(String key, String name, double price, String status, String createdAt) {
        jdbc.update("INSERT INTO payment_plan (id, payment_option_id, status, actual_price, elevated_price,"
                + " currency, created_at) VALUES (?, ?, ?, ?, 0, 'INR', CAST(? AS TIMESTAMP))",
                id("pl-" + key + "-" + name), id("po-" + key), status, price, createdAt);
    }

    private void collection(String name, String parentId, String slug, String status, String names) {
        jdbc.update("INSERT INTO commerce_collection (id, institute_id, parent_id, kind, slug, name_i18n, media_id,"
                + " position, status) VALUES (?, ?, ?, 'CATEGORY', ?, CAST(? AS JSONB), NULL, 0, ?)", id(name),
                institute, parentId, slug, names, status);
    }

    private void memberOf(String collection, String product, int position) {
        jdbc.update("INSERT INTO commerce_product_collection (id, institute_id, collection_id, package_id, position)"
                + " VALUES (?, ?, ?, ?, ?)", UUID.randomUUID().toString(), institute, id(collection), id(product),
                position);
    }

    // ------------------------------------------------------------------ snapshot

    @Test
    void theSnapshotHoldsOnlyTheActiveProductsOfTheInstitute() {
        StorefrontSnapshot shop = loader.snapshot(institute);

        assertEquals(Set.of("saree-" + run, "kurta-" + run), shop.bySlug().keySet());
        StorefrontSnapshot.Product saree = shop.bySlug().get("saree-" + run);
        assertEquals(id("p-saree"), saree.packageId());
        assertEquals("Khadi Gram", saree.originName());
        assertEquals("Khadi", saree.brand());
        assertNotNull(saree.publishedAt());
        assertEquals(Set.of("hi", "en"), saree.translations().keySet());
        assertEquals("लाल सूती साड़ी", saree.translations().get("hi").name());
        // The shop copy carries no long text; the product page reads it per product.
        assertTrue(saree.translations().get("en").contentBlocks().isEmpty());
        assertNull(saree.translations().get("en").descriptionHtml());
        StorefrontSnapshot.Product withTexts = loader.withDetailTexts(institute, saree);
        assertEquals("care", withTexts.translations().get("en").contentBlocks().get(0).get("code"));
        assertEquals(Set.of("hi", "en"), withTexts.translations().keySet());
        assertEquals(Map.of("title", "SEO title"), saree.seoI18n().get("en"));

        // The archived variant is not sold; the two live ones come in position order.
        assertEquals(List.of(id("ps-saree-red"), id("ps-saree-mto")),
                saree.variants().stream().map(StorefrontSnapshot.Variant::packageSessionId).toList());
        StorefrontSnapshot.Variant red = saree.variants().get(0);
        assertTrue(red.tracked());
        assertEquals(10, red.availableSlots());
        assertEquals(450, red.weightGrams());
        // The first link and its first ACTIVE plan, as the admin screen reads the price.
        assertEquals(new BigDecimal("1000.00"), red.price());
        assertEquals(new BigDecimal("1500.00"), red.mrp());
        assertEquals("INR", red.currency());
        assertEquals(Map.of(id("a-colour"), id("v-red")), red.optionValueIds());
        StorefrontSnapshot.Variant madeToOrder = saree.variants().get(1);
        assertFalse(madeToOrder.tracked());
        assertEquals(12, madeToOrder.leadTimeDays());
        // Its first link has no ACTIVE plan, so it has no price, although a later link has one.
        assertNull(madeToOrder.price());

        assertEquals(Set.of(id("v-cotton"), id("v-red"), id("v-blue")), saree.attributeValueIds());
        assertEquals(List.of(id("a-colour")), saree.optionAttributeIds());
        // Only ACTIVE collections count.
        assertEquals(Map.of(id("c-cotton"), 4), saree.collectionPositions());
        assertTrue(shop.bySlug().get("kurta-" + run).collectionPositions().isEmpty());
        assertEquals(2, shop.collections().size());

        assertEquals(2, saree.media().size());
        StorefrontSnapshot.Media real = saree.media().get(1);
        assertEquals("REAL", real.tag());
        assertEquals(id("ps-saree-red"), real.packageSessionId());
        assertEquals("Red saree on a loom", real.altI18n().get("en"));
        assertEquals("media-real-640", real.renditions().get("640"));

        assertEquals(2, shop.attributes().size());
        assertEquals("रंग", shop.attributes().get(id("a-colour")).nameI18n().get("hi"));
        assertTrue(shop.attributes().get(id("a-colour")).filterable());
        assertEquals("#aa0000", shop.attributeValues().get(id("v-red")).swatchHex());

        // Nothing of the other institute, and nothing for an institute with no shop.
        assertTrue(loader.snapshot(otherInstitute).bySlug().containsKey("other-" + run));
        assertFalse(shop.bySlug().containsKey("other-" + run));
        loader.evict("no-such-institute");
        assertTrue(loader.snapshot("no-such-institute").products().isEmpty());
    }

    @Test
    void aListingOnTheRealRowsFindsAProductInHindiAndInLatinAndShowsStates() {
        CatalogMediaResolver media = mock(CatalogMediaResolver.class);
        when(media.resolve(any())).thenAnswer(call -> {
            Map<String, String> urls = new LinkedHashMap<>();
            for (String ref : (java.util.Collection<String>) call.getArgument(0)) {
                urls.put(ref, ref.startsWith("http") ? ref : "https://cdn.test/" + ref);
            }
            return urls;
        });
        StorefrontCatalogService service = new StorefrontCatalogService(loader, media);

        for (String q : List.of("सूती साड़ी", "Cotton SAREE", "sar-red-" + run)) {
            StorefrontDtos.ProductList found = service.list(institute, new StorefrontCatalogService.ProductQuery(q,
                    null, Map.of(), null, null, null, null, 1, 24, true, "hi"));
            assertEquals(List.of("saree-" + run),
                    found.getData().stream().map(StorefrontDtos.ProductCard::getSlug).toList(), "query " + q);
        }

        StorefrontDtos.ProductList all = service.list(institute, new StorefrontCatalogService.ProductQuery(null,
                "sarees-" + run, Map.of("colour", List.of("red")), null, null, null, null, 1, 24, true, "en"));
        StorefrontDtos.ProductCard saree = all.getData().get(0);
        assertEquals("Red cotton saree", saree.getName());
        assertEquals("IN_STOCK", saree.getStock().getState());
        assertNull(saree.getStock().getLeft());
        assertEquals(0, new BigDecimal("1000").compareTo(saree.getPrice().getAmount()));
        assertEquals("https://cdn.test/media-real", saree.getImage().getUrl());
        // Counted inside the collection and without the colour filter: both colours of the saree.
        assertEquals(List.of("blue", "red"), all.getFacets().getAttributes().stream()
                .filter(f -> f.getCode().equals("colour")).findFirst().orElseThrow().getValues().stream()
                .map(StorefrontDtos.FacetValue::getCode).toList());

        StorefrontDtos.ProductDetail kurta = service.detail(institute, "kurta-" + run, "hi");
        assertEquals("LOW", kurta.getStock().getState());
        assertEquals(2, kurta.getStock().getLeft());
        assertEquals("Blue kurta", kurta.getName());
        assertEquals("en", kurta.getLocale());
    }

    // ------------------------------------------------------------------ the cart read

    @Test
    void theCartReadsCurrentPriceAndStockAndNeverAnotherInstitutesVariant() {
        Map<String, CartVariant> found = loader.cartVariants(institute,
                List.of(id("ps-saree-red"), id("ps-draft"), id("ps-other"), "no-such-id"),
                List.of("KUR-BLU-" + run, "OTHER-" + run));

        assertEquals(Set.of(id("ps-saree-red"), id("ps-draft"), id("ps-kurta")), found.keySet());
        CartVariant red = found.get(id("ps-saree-red"));
        assertEquals(new BigDecimal("1000.00"), red.price());
        assertEquals(new BigDecimal("1500.00"), red.mrp());
        assertEquals(10, red.availableSlots());
        assertEquals(450, red.weightGrams());
        assertEquals(id("tax-class"), red.taxClassId());
        assertTrue(red.productActive() && red.variantActive() && red.tracked());
        assertEquals("Red cotton saree", red.names().get("en"));
        assertEquals("saree-" + run, red.slug());
        // A draft product is returned flagged, so the cart can answer NOT_FOUND for it.
        assertFalse(found.get(id("ps-draft")).productActive());

        // Stock is read at the moment of the call, not from the cached snapshot.
        loader.snapshot(institute);
        jdbc.update("UPDATE package_session SET available_slots = 3 WHERE id = ?", id("ps-kurta"));
        assertEquals(3, loader.cartVariants(institute, List.of(id("ps-kurta")), List.of()).get(id("ps-kurta"))
                .availableSlots());
        jdbc.update("UPDATE package_session SET available_slots = 2 WHERE id = ?", id("ps-kurta"));

        assertTrue(loader.cartVariants(institute, List.of(), List.of()).isEmpty());
        assertTrue(loader.cartVariants(otherInstitute, List.of(id("ps-saree-red")), List.of()).isEmpty());
        assertEquals(id("loc"), loader.onlineLocationId(institute));
        assertNull(loader.onlineLocationId(otherInstitute));
    }

    // ------------------------------------------------------------------ pincode

    @Test
    void aPincodeComesFromTheDirectoryAndElseFromItsFirstDigits() {
        CommercePincodeService pincodes = new CommercePincodeService();
        ReflectionTestUtils.setField(pincodes, "entityManager", entityManager);
        jdbc.update("INSERT INTO commerce_pincode (pincode, city, district, state_code) VALUES ('605001',"
                + " 'Puducherry', 'Puducherry', '34') ON CONFLICT (pincode) DO NOTHING");

        CommercePincodeService.Pincode directory = pincodes.lookup("605 001");
        assertEquals("Puducherry", directory.city());
        assertEquals("34", directory.stateCode());
        assertEquals("Puducherry", directory.stateName());
        assertEquals(CommercePincodeService.SOURCE_DIRECTORY, directory.source());

        CommercePincodeService.Pincode prefix = pincodes.lookup("226001");
        if (CommercePincodeService.SOURCE_PIN_PREFIX.equals(prefix.source())) {
            assertNull(prefix.city());
        }
        assertEquals("09", prefix.stateCode());
        assertNull(pincodes.lookup("12345"));
    }

    // ------------------------------------------------------------------ shipping rule

    @Test
    void aShippingRuleIsStoredReadBackAndReplacedWithOneActiveRowPerInstitute() {
        CommerceShippingRuleRepository repository = new JpaRepositoryFactory(entityManager)
                .getRepository(CommerceShippingRuleRepository.class);
        CommerceTaxSettingService taxSettings = mock(CommerceTaxSettingService.class);
        when(taxSettings.context(any())).thenReturn(CommerceTaxContext.builder().mode(TaxMode.UNREGISTERED).build());
        CommerceShippingRuleService service = new CommerceShippingRuleService(repository,
                mock(CommerceTaxClassService.class), taxSettings, mock(CommerceAuditService.class),
                new ObjectMapper());
        TransactionTemplate tx = new TransactionTemplate(transactionManager);

        assertNull(tx.execute(s -> service.activeRule(institute)));

        List<Map<String, Object>> tiers = new ArrayList<>();
        tiers.add(tier(new BigDecimal("500"), new BigDecimal("50.00")));
        tiers.add(tier(null, new BigDecimal("90.50")));
        ShippingRuleDTO first = tx.execute(s -> service.save(institute, "user-1", ShippingRuleDTO.builder()
                .basis("WEIGHT").tiers(tiers).freeAbove(new BigDecimal("999")).codCharge(new BigDecimal("40"))
                .build()));
        assertNotNull(first.getId());

        CommerceShippingCalculator.Rule read = tx.execute(s -> service.activeRule(institute));
        assertEquals(CommerceShippingCalculator.Basis.WEIGHT, read.basis());
        assertEquals(0, new BigDecimal("999").compareTo(read.freeAbove()));
        assertEquals(0, new BigDecimal("40").compareTo(read.codCharge()));
        assertEquals(0, new BigDecimal("50").compareTo(
                CommerceShippingCalculator.quote(read, new BigDecimal("100"), 500).charge()));
        assertEquals(0, new BigDecimal("90.50").compareTo(
                CommerceShippingCalculator.quote(read, new BigDecimal("100"), 501).charge()));

        // A second save archives the first row and leaves exactly one ACTIVE row.
        ShippingRuleDTO second = tx.execute(s -> service.save(institute, "user-1", ShippingRuleDTO.builder()
                .basis("FLAT").tiers(List.of(tier(null, new BigDecimal("80")))).build()));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM commerce_shipping_rule WHERE institute_id = ?"
                + " AND status = 'ACTIVE'", Integer.class, institute));
        assertEquals("ARCHIVED", jdbc.queryForObject("SELECT status FROM commerce_shipping_rule WHERE id = ?",
                String.class, first.getId()));
        assertEquals(second.getId(), tx.execute(s -> service.activeRule(institute)).id());
        assertEquals("user-1", jdbc.queryForObject("SELECT created_by FROM commerce_shipping_rule WHERE id = ?",
                String.class, second.getId()));

        // The database itself refuses a second ACTIVE row.
        assertThrows(RuntimeException.class, () -> tx.execute(s -> {
            CommerceShippingRule extra = new CommerceShippingRule();
            extra.setInstituteId(institute);
            extra.setBasis("FLAT");
            extra.setTiersJson(List.of(tier(null, BigDecimal.ONE)));
            extra.setCodCharge(BigDecimal.ZERO);
            extra.setStatus("ACTIVE");
            return repository.saveAndFlush(extra);
        }));
        assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM commerce_shipping_rule WHERE institute_id = ?"
                + " AND status = 'ACTIVE'", Integer.class, institute));
    }

    private static Map<String, Object> tier(BigDecimal upTo, BigDecimal charge) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("up_to", upTo);
        row.put("charge", charge);
        return row;
    }

    // ------------------------------------------------------------------ size

    /**
     * 700 products with three filterable attributes: how long the load and a faceted listing
     * take on this machine. The numbers are printed, not asserted: the budget is set in WP-54.
     */
    @Test
    void aListingOfSevenHundredProductsWithThreeFacets() {
        String big = UUID.randomUUID().toString();
        String p = "big-" + run + "-";
        for (int a = 0; a < 3; a++) {
            jdbc.update("INSERT INTO commerce_attribute (id, institute_id, code, name_i18n, kind, is_filterable,"
                    + " position) VALUES (?, ?, ?, CAST('{\"en\": \"Attribute\"}' AS JSONB), 'TEXT', TRUE, ?)",
                    p + "a" + a, big, "attr" + a, a);
            for (int v = 0; v < 5; v++) {
                jdbc.update("INSERT INTO commerce_attribute_value (id, institute_id, attribute_id, code, label_i18n,"
                        + " position) VALUES (?, ?, ?, ?, CAST('{\"en\": \"Value\"}' AS JSONB), ?)",
                        p + "a" + a + "v" + v, big, p + "a" + a, "v" + v, v);
            }
        }
        jdbc.update("INSERT INTO package (id, status) SELECT ? || g, 'ACTIVE' FROM generate_series(1, 700) g", p);
        jdbc.update("INSERT INTO commerce_product (id, institute_id, package_id, slug, status, published_at)"
                + " SELECT ? || 'cp' || g, ?, ? || g, ? || g, 'ACTIVE', now() FROM generate_series(1, 700) g",
                p, big, p, p);
        jdbc.update("INSERT INTO commerce_product_translation (id, institute_id, package_id, locale, name,"
                + " description_html, search_text) SELECT ? || 't' || l || g, ?, ? || g, l, 'Product ' || g,"
                + " repeat('<p>text</p>', 100), 'product ' || g"
                + " FROM generate_series(1, 700) g, (VALUES ('hi'), ('en')) AS loc(l)", p, big, p);
        jdbc.update("INSERT INTO package_session (id, package_id, status, name, available_slots, max_seats)"
                + " SELECT ? || 's' || g, ? || g, 'ACTIVE', 'sku', g % 12, 20 FROM generate_series(1, 700) g", p, p);
        jdbc.update("INSERT INTO commerce_variant (id, institute_id, package_session_id, package_id, sku)"
                + " SELECT ? || 'v' || g, ?, ? || 's' || g, ? || g, ? || g FROM generate_series(1, 700) g",
                p, big, p, p, p);
        jdbc.update("INSERT INTO enroll_invite (id, institute_id, tag, status)"
                + " SELECT ? || 'ei' || g, ?, 'COMMERCE', 'ACTIVE' FROM generate_series(1, 700) g", p, big);
        jdbc.update("INSERT INTO payment_option (id, status) SELECT ? || 'po' || g, 'ACTIVE'"
                + " FROM generate_series(1, 700) g", p);
        jdbc.update("INSERT INTO package_session_learner_invitation_to_payment_option (id, enroll_invite_id,"
                + " package_session_id, payment_option_id, status) SELECT ? || 'l' || g, ? || 'ei' || g,"
                + " ? || 's' || g, ? || 'po' || g, 'ACTIVE' FROM generate_series(1, 700) g", p, p, p, p);
        jdbc.update("INSERT INTO payment_plan (id, payment_option_id, status, actual_price, elevated_price, currency)"
                + " SELECT ? || 'pl' || g, ? || 'po' || g, 'ACTIVE', 100 + g, 0, 'INR'"
                + " FROM generate_series(1, 700) g", p, p);
        jdbc.update("INSERT INTO commerce_product_attribute_value (id, institute_id, package_id, attribute_value_id)"
                + " SELECT ? || 'pav' || a || '-' || g, ?, ? || g, ? || 'a' || a || 'v' || (g % 5)"
                + " FROM generate_series(1, 700) g, generate_series(0, 2) a", p, big, p, p);

        long start = System.nanoTime();
        StorefrontSnapshot shop = loader.snapshot(big);
        long loadMs = (System.nanoTime() - start) / 1_000_000;
        assertEquals(700, shop.products().size());

        StorefrontCatalogService service = new StorefrontCatalogService(loader, mock(CatalogMediaResolver.class));
        StorefrontCatalogService.ProductQuery query = new StorefrontCatalogService.ProductQuery("product", null,
                Map.of("attr0", List.of("v1", "v2"), "attr1", List.of("v1")), null, null, true, "price_asc", 1, 24,
                true, "en");
        service.list(big, query);
        start = System.nanoTime();
        int runs = 20;
        StorefrontDtos.ProductList list = null;
        for (int i = 0; i < runs; i++) {
            list = service.list(big, query);
        }
        long listMicros = (System.nanoTime() - start) / 1_000 / runs;
        assertEquals(3, list.getFacets().getAttributes().size());
        assertTrue(list.getTotal() > 0);
        assertEquals(24, list.getData().size());
        System.out.println("STOREFRONT-SIZE products=700 snapshot_load_ms=" + loadMs + " faceted_listing_micros="
                + listMicros + " matched=" + list.getTotal());
    }
}
