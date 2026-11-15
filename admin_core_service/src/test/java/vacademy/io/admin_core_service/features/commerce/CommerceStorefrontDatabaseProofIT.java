package vacademy.io.admin_core_service.features.commerce;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.AdminCoreServiceApplication;
import vacademy.io.admin_core_service.features.auth_service.service.AsyncEnrollmentEmailService;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.PublicCatalogApiController;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.AttributeDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.AttributeValueDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.CollectionDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductMediaDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.CommerceImportService;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportJobResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.dto.ImportValidationResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceAttributeService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceCollectionService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductMediaService;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.DocumentSeriesDTO;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceDocumentSeriesService;
import vacademy.io.admin_core_service.features.commerce.document.service.CommerceInvoiceService;
import vacademy.io.admin_core_service.features.commerce.document.service.DocumentClock;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionClient;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionException;
import vacademy.io.admin_core_service.features.commerce.media.CommerceRenditionService;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceDtos;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceRequest;
import vacademy.io.admin_core_service.features.commerce.order.dto.CartPriceSnapshot;
import vacademy.io.admin_core_service.features.commerce.order.dto.ShippingRuleDTO;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceOrderService;
import vacademy.io.admin_core_service.features.commerce.order.service.CommerceShippingRuleService;
import vacademy.io.admin_core_service.features.commerce.stock.dto.LocationRequest;
import vacademy.io.admin_core_service.features.commerce.stock.dto.ReceiptRequest;
import vacademy.io.admin_core_service.features.commerce.stock.entity.StockLocation;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockLocationService;
import vacademy.io.admin_core_service.features.commerce.stock.service.StockReceiptService;
import vacademy.io.admin_core_service.features.commerce.storefront.dto.StorefrontDtos;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontCatalogService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontCatalogService.ProductQuery;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSitemapContributor;
import vacademy.io.admin_core_service.features.commerce.storefront.service.StorefrontSnapshotLoader;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxClassRef;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineInput;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRequest;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxClassDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxRateRuleDTO;
import vacademy.io.admin_core_service.features.commerce.tax.dto.TaxSettingDTO;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxClassService;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.admin_core_service.features.notification.service.DynamicNotificationService;
import vacademy.io.admin_core_service.features.notification_service.service.PaymentNotificatonService;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentOption;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentPlan;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentOptionRepository;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentPlanRepository;
import vacademy.io.admin_core_service.features.user_subscription.service.PaymentLogService;
import vacademy.io.admin_core_service.features.user_subscription.service.UserPlanService;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Database-backed proof of the public shop reads (WP-10), cart pricing (WP-11), the product
 * import (WP-07) and the rendition state (WP-05), on a local Postgres with the real Flyway
 * chain and the real Spring context. Same pattern as {@link CommerceM1DatabaseProofIT}:
 * skipped unless {@code COMMERCE_IT_PG_URL} names a database on this machine, every outside
 * URL pinned to a closed local port, no scheduled job running.
 *
 * <p>The media service is not reachable from here, so {@link CommerceRenditionClient} is a mock
 * that answers what the media service answers for a 2,000 px upload; the real encoder is
 * proven in media_service ({@code ImageRenditionRealCodecTest}). Every tax rate, HSN code and
 * slab limit below is a TEST placeholder.
 */
@SpringBootTest(classes = AdminCoreServiceApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(CommerceM1DatabaseProofIT.LocalOnly.class)
@EnabledIfEnvironmentVariable(named = "COMMERCE_IT_PG_URL", matches = "jdbc:postgresql://(127\\.0\\.0\\.1|localhost)[:/].*")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class CommerceStorefrontDatabaseProofIT {

    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String SELLER_STATE = "09";
    private static final int BULK = 700;
    private static final String[] COLOURS = {"red", "blue", "green", "white"};
    private static final String[] FABRICS = {"cotton", "silk", "khadi"};
    private static final String[] CRAFTS = {"handloom", "powerloom"};

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        CommerceM1DatabaseProofIT.database(registry);
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "16");
    }

    @Autowired
    private JdbcTemplate db;
    @Autowired
    private PlatformTransactionManager transactionManager;
    @Autowired
    private CapabilityResolver capabilityResolver;
    @Autowired
    private CommerceProductService productService;
    @Autowired
    private CommerceAttributeService attributeService;
    @Autowired
    private CommerceCollectionService collectionService;
    @Autowired
    private CommerceProductMediaService productMediaService;
    @Autowired
    private StockLocationService locationService;
    @Autowired
    private StockReceiptService receiptService;
    @Autowired
    private CommerceTaxSettingService taxSettingService;
    @Autowired
    private CommerceTaxClassService taxClassService;
    @Autowired
    private CommerceDocumentSeriesService seriesService;
    @Autowired
    private CommerceInvoiceService commerceInvoiceService;
    @Autowired
    private DocumentClock documentClock;
    @Autowired
    private UserPlanService userPlanService;
    @Autowired
    private PaymentLogService paymentLogService;
    @Autowired
    private PaymentPlanRepository paymentPlanRepository;
    @Autowired
    private PaymentOptionRepository paymentOptionRepository;
    @Autowired
    private EnrollInviteRepository enrollInviteRepository;
    @Autowired
    private StorefrontCatalogService storefront;
    @Autowired
    private StorefrontSnapshotLoader snapshotLoader;
    @Autowired
    private StorefrontSitemapContributor sitemapContributor;
    @Autowired
    private PublicCatalogApiController catalogApiController;
    @Autowired
    private CommerceOrderService orderService;
    @Autowired
    private CommerceShippingRuleService shippingRuleService;
    @Autowired
    private CommerceImportService importService;
    @Autowired
    private CommerceRenditionService renditionService;
    @Autowired
    private vacademy.io.admin_core_service.features.commerce.stock.scheduler.StockReconciliationJob reconciliationJob;

    // Outside services: mocked so nothing leaves this machine.
    @MockBean
    private AuthService authService;
    @MockBean
    private WorkflowTriggerService workflowTriggerService;
    @MockBean
    private PaymentNotificatonService paymentNotificatonService;
    @MockBean
    private DynamicNotificationService dynamicNotificationService;
    @MockBean
    private AsyncEnrollmentEmailService asyncEnrollmentEmailService;
    @MockBean
    private MediaService mediaService;
    @MockBean
    private CommerceRenditionClient renditionClient;

    private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

    private final String instA = UUID.randomUUID().toString();   // the shop the listing and the cart run on
    private final String instB = UUID.randomUUID().toString();   // another shop; also the import target
    private final String run = instA.substring(0, 8);
    private final String actor = "admin-a-" + run;
    private final String buyer = "buyer-" + run;

    private String taxClassA;
    private String taxClassB;
    private String wh;
    private String collectionA;
    private final Map<String, String> valueIds = new LinkedHashMap<>();   // "colour=red" -> value id (instA)

    private ProductResponse khadi;       // hi + en, in stock (50)
    private ProductResponse lowStock;    // 2 left
    private ProductResponse soldOut;     // 0
    private ProductResponse englishOnly; // en translation only
    private ProductResponse draft;
    private ProductResponse archived;
    private ProductResponse otherShop;   // instB
    private VariantResponse cartA;       // 800.00, 300 g
    private VariantResponse cartB;       // 1500.00, 700 g

    private Path evidence;

    // ------------------------------------------------------------------ plumbing

    @BeforeAll
    void openEvidence() throws IOException {
        String path = System.getenv("COMMERCE_IT_EVIDENCE_STOREFRONT");
        evidence = Path.of(path != null && !path.isBlank() ? path : "target/commerce-storefront-proof-evidence.txt");
        Files.writeString(evidence, "", StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
    }

    @AfterAll
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
        db.execute("DROP TRIGGER IF EXISTS proof_refuse_bad_product ON commerce_product");
        db.execute("DROP FUNCTION IF EXISTS proof_refuse_bad_product()");
    }

    /** Spring resets the mocks after every test, so their answers are set up each time. */
    @BeforeEach
    void outsideServicesAnswerLocally() throws Exception {
        when(authService.getUsersFromAuthServiceWithPasswordByUserId(anyString())).thenAnswer(call -> {
            UserDTO user = new UserDTO();
            user.setId(call.getArgument(0));
            user.setEmail(call.getArgument(0) + "@example.invalid");
            user.setFullName("Proof Buyer");
            return user;
        });
        when(mediaService.uploadFileV2(any(MultipartFile.class))).thenAnswer(call -> {
            MultipartFile file = call.getArgument(0);
            FileDetailsDTO details = new FileDetailsDTO();
            details.setId("file-" + file.getOriginalFilename());
            return details;
        });
        when(renditionClient.generate(anyString(), any())).thenAnswer(call -> renditionsOf(call.getArgument(0)));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instA);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    /** What the media service answers for a 2,000 x 2,500 upload (ImageRenditionRealCodecTest). */
    private static CommerceRenditionClient.Result renditionsOf(String mediaId) {
        Map<Integer, String> urls = new TreeMap<>();
        for (int width : new int[] {320, 640, 960, 1600}) {
            urls.put(width, "https://cdn.test/COMMERCE_RENDITION/v1/" + mediaId + "/w" + width + ".webp");
        }
        return new CommerceRenditionClient.Result(2000, 2500, urls, 1);
    }

    private void note(String line) {
        try {
            Files.writeString(evidence, line + "\n", StandardOpenOption.APPEND);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private List<Map<String, Object>> sql(String title, String query, Object... args) {
        List<Map<String, Object>> rows = db.queryForList(query, args);
        note("-- " + title);
        note("   " + query.replaceAll("\\s+", " ").trim() + (args.length > 0 ? "   args=" + List.of(args) : ""));
        if (rows.isEmpty()) {
            note("   (0 rows)");
        }
        rows.forEach(row -> note("   " + row));
        return rows;
    }

    private long count(String query, Object... args) {
        Long n = db.queryForObject(query, Long.class, args);
        return n == null ? 0 : n;
    }

    private <T> T inTransaction(Supplier<T> work) {
        return new TransactionTemplate(transactionManager).execute(status -> work.get());
    }

    private static void same(BigDecimal expected, Object actual, String what) {
        BigDecimal value = actual == null ? BigDecimal.ZERO : new BigDecimal(String.valueOf(actual));
        BigDecimal wanted = expected == null ? BigDecimal.ZERO : expected;
        assertEquals(0, wanted.compareTo(value), what + ": expected " + wanted + " but was " + value);
    }

    private void institute(String id, String name) {
        db.update("INSERT INTO institutes (id, name, learner_portal_base_url) VALUES (?, ?, ?)", id, name,
                "https://shop-" + id.substring(0, 8) + ".example.com");
        db.update("INSERT INTO institute_module_entitlement (institute_id, key, enabled) VALUES (?, 'commerce', true)", id);
        capabilityResolver.evict(id);
        taxSettingService.update(id, actor, TaxSettingDTO.builder().taxMode("REGULAR").sellerGstin(SELLER_GSTIN)
                .sellerLegalName("Proof Seller " + id.substring(0, 8)).sellerAddress("1 Proof Road, Lucknow 226001")
                .roundTotalTo("RUPEE").build());
    }

    /** TEST placeholders, not rates: 5 percent up to 1000.00, 12 percent above. */
    private String taxClass(String instituteId, String code, String hsn) {
        LocalDate from = LocalDate.of(2020, 4, 1);
        return taxClassService.create(instituteId, actor, TaxClassDTO.builder().code(code).name(code + " TEST")
                .hsnCode(hsn).unit("PCS")
                .rules(List.of(
                        TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("0")).maxUnitPrice(new BigDecimal("1000.00"))
                                .ratePercent(new BigDecimal("5")).effectiveFrom(from).build(),
                        TaxRateRuleDTO.builder().minUnitPrice(new BigDecimal("1000.01"))
                                .ratePercent(new BigDecimal("12")).effectiveFrom(from).build()))
                .build()).getId();
    }

    private String attribute(String instituteId, String code, String en, String hi, String[] values) {
        AttributeDTO made = attributeService.create(instituteId, actor, AttributeDTO.builder().code(code)
                .nameI18n(Map.of("en", en, "hi", hi)).kind("TEXT").isFilterable(true).build());
        int position = 0;
        for (String value : values) {
            AttributeValueDTO v = attributeService.createValue(instituteId, actor, made.getId(),
                    AttributeValueDTO.builder().code(value).labelI18n(Map.of("en", value)).position(position++).build());
            if (instA.equals(instituteId)) {
                valueIds.put(code + "=" + value, v.getId());
            }
        }
        return made.getId();
    }

    private void setting(String instituteId, String dataJson) {
        db.update("UPDATE institutes SET setting_json = ? WHERE id = ?",
                "{\"setting\":{\"COMMERCE_SETTING\":{\"key\":\"COMMERCE_SETTING\","
                        + "\"name\":\"Commerce\",\"data\":" + dataJson + "}}}", instituteId);
        snapshotLoader.evict(instituteId);
    }

    private String commerceSetting(boolean cod) {
        return "{\"baseLocale\":\"hi\",\"lowStockThreshold\":3,\"priceBands\":[300,600],"
                + "\"cod\":{\"enabled\":" + cod + ",\"maxOrderValue\":5000,\"staffConfirmThreshold\":3000,"
                + "\"blockedPincodes\":[\"190001\"]}}";
    }

    private ProductResponse product(String instituteId, String taxClassId, String slug, String hi, String en,
                                    String status, String sku, String price, Integer weight,
                                    List<String> attributeValues, List<String> collections) {
        List<ProductTranslationDTO> translations = new ArrayList<>();
        if (hi != null) {
            translations.add(ProductTranslationDTO.builder().locale("hi").name(hi).build());
        }
        if (en != null) {
            translations.add(ProductTranslationDTO.builder().locale("en").name(en).build());
        }
        ProductRequest request = ProductRequest.builder().slug(slug).translations(translations)
                .taxClassId(taxClassId).status(status).attributeValueIds(attributeValues).collectionIds(collections)
                .variants(List.of(VariantRequest.builder().sku(sku).name("One size").price(new BigDecimal(price))
                        .weightGrams(weight).build()))
                .build();
        return productService.save(instituteId, actor, request);
    }

    private void receive(String packageSessionId, int quantity) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(wh);
        request.setSourceKind("OTHER");
        request.setNote("proof stock");
        request.setClientRequestId("sf-" + packageSessionId);
        ReceiptRequest.Line line = new ReceiptRequest.Line();
        line.setPackageSessionId(packageSessionId);
        line.setQuantity(quantity);
        line.setUnitCost(new BigDecimal("100.00"));
        request.setLines(List.of(line));
        receiptService.create(instA, actor, true, request);
    }

    private void receiveLines(String requestId, List<ReceiptRequest.Line> lines) {
        ReceiptRequest request = new ReceiptRequest();
        request.setLocationId(wh);
        request.setSourceKind("OTHER");
        request.setNote("proof stock");
        request.setClientRequestId(requestId);
        request.setLines(lines);
        receiptService.create(instA, actor, true, request);
    }

    private ProductQuery query(String q, Map<String, List<String>> attributes, Boolean inStock, int page, int size,
                               boolean facets, String locale) {
        return new ProductQuery(q, null, attributes == null ? Map.of() : attributes, null, null, inStock, null, page,
                size, facets, locale);
    }

    private StorefrontDtos.ProductCard onlyCard(String q, String locale) {
        StorefrontDtos.ProductList found = storefront.list(instA, query(q, null, null, 1, 24, false, locale));
        assertEquals(1, found.getTotal(), "one product for \"" + q + "\"");
        return found.getData().get(0);
    }

    // ------------------------------------------------------------------ seed

    @Test
    @Order(1)
    void seed_twoShopsWithTaxAttributesCollectionsAndSevenHundredProducts() {
        note("== seed: shop A " + instA + ", shop B " + instB);
        assertEquals(2, count("SELECT count(*) FROM flyway_schema_history WHERE success AND version IN ('683','684')"),
                "V683 and V684 are in the Flyway history");
        sql("commerce migrations in the Flyway history",
                "SELECT version, description, success FROM flyway_schema_history WHERE version IN ('679','680','681','682','683','684') ORDER BY 1");
        db.update("INSERT INTO level (id, level_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        db.update("INSERT INTO session (id, session_name, status) VALUES ('DEFAULT', 'DEFAULT', 'ACTIVE'), ('INVITED', 'INVITED', 'ACTIVE') ON CONFLICT DO NOTHING");
        institute(instA, "Storefront Proof A " + run);
        institute(instB, "Storefront Proof B " + run);
        taxClassA = taxClass(instA, "cloth_test", "5208");
        taxClassB = taxClass(instB, "garments", "6205");
        setting(instA, commerceSetting(false));

        attribute(instA, "colour", "Colour", "रंग", COLOURS);
        attribute(instA, "fabric", "Fabric", "कपड़ा", FABRICS);
        attribute(instA, "craft", "Craft", "शिल्प", CRAFTS);
        collectionA = collectionService.create(instA, actor, CollectionDTO.builder().slug("kurtas")
                .nameI18n(Map.of("en", "Kurtas", "hi", "कुर्ते")).build()).getId();

        LocationRequest location = new LocationRequest();
        location.setCode("WH-" + run);
        location.setName("WH " + run);
        location.setAddressLine1("1 Proof Road");
        location.setCity("Lucknow");
        location.setPincode("226001");
        location.setStateCode(SELLER_STATE);
        location.setGstin(SELLER_GSTIN);
        location.setIsStore(false);
        location.setIsWarehouse(true);
        location.setIsPosEnabled(false);
        location.setSellsOnline(true);
        StockLocation warehouse = locationService.create(instA, actor, true, location);
        wh = warehouse.getId();

        // 700 products through the product service; colour, fabric and craft cycle with the index.
        long started = System.nanoTime();
        List<Object[]> stock = new ArrayList<>();
        for (int i = 0; i < BULK; i++) {
            ProductResponse made = product(instA, taxClassA, "bulk-" + run + "-" + i, "थोक वस्तु " + i,
                    "Bulk item " + i, "ACTIVE", "B" + run + "-" + i, String.valueOf(100 + i), 200,
                    List.of(valueIds.get("colour=" + COLOURS[i % 4]), valueIds.get("fabric=" + FABRICS[i % 3]),
                            valueIds.get("craft=" + CRAFTS[i % 2])), List.of(collectionA));
            // every fifth is sold out, the next one has 2 left, the rest 50
            int units = i % 5 == 0 ? 0 : i % 5 == 1 ? 2 : 50;
            stock.add(new Object[] {units, units, made.getVariants().get(0).getPackageSessionId()});
        }
        note("-- " + BULK + " products saved through CommerceProductService in "
                + (System.nanoTime() - started) / 1_000_000 + " ms");
        // Stock comes in through real receipts at the online location (at most 500 lines each),
        // so the counters the listing reads agree with the ledger.
        started = System.nanoTime();
        List<ReceiptRequest.Line> lines = new ArrayList<>();
        int receipts = 0;
        for (Object[] each : stock) {
            if ((Integer) each[0] == 0) {
                continue;
            }
            ReceiptRequest.Line line = new ReceiptRequest.Line();
            line.setPackageSessionId((String) each[2]);
            line.setQuantity((Integer) each[0]);
            line.setUnitCost(new BigDecimal("40.00"));
            lines.add(line);
            if (lines.size() == 300) {
                receiveLines("sf-bulk-" + run + "-" + receipts++, lines);
                lines = new ArrayList<>();
            }
        }
        if (!lines.isEmpty()) {
            receiveLines("sf-bulk-" + run + "-" + receipts++, lines);
        }
        note("-- stock for the bulk products posted by " + receipts + " receipts in "
                + (System.nanoTime() - started) / 1_000_000 + " ms");

        khadi = product(instA, taxClassA, "khadi-kurta-" + run, "खादी कुर्ता " + run, "Khadi Kurta " + run, "ACTIVE",
                "KK-" + run, "950.00", 250, List.of(valueIds.get("fabric=khadi")), List.of(collectionA));
        ProductRequest shortEn = new ProductRequest();
        shortEn.setTranslations(List.of(
                ProductTranslationDTO.builder().locale("hi").name("खादी कुर्ता " + run).build(),
                ProductTranslationDTO.builder().locale("en").name("Khadi Kurta " + run)
                        .shortDescription("Hand-spun cotton").build()));
        khadi = productService.update(instA, actor, khadi.getPackageId(), shortEn);
        lowStock = product(instA, taxClassA, "low-shawl-" + run, "शॉल " + run, "Lowstock Shawl " + run, "ACTIVE",
                "LS-" + run, "700.00", 150, null, null);
        soldOut = product(instA, taxClassA, "gone-stole-" + run, "स्टोल " + run, "Soldout Stole " + run, "ACTIVE",
                "SO-" + run, "600.00", 150, null, null);
        englishOnly = product(instA, taxClassA, "english-only-" + run, null, "Onlyenglish Scarf " + run, "ACTIVE",
                "EO-" + run, "400.00", 100, null, null);
        draft = product(instA, taxClassA, "khadi-kurta-draft-" + run, "खादी कुर्ता मसौदा " + run,
                "Khadi Kurta Draft " + run, "DRAFT", "KD-" + run, "950.00", 250, null, null);
        archived = product(instA, taxClassA, "khadi-kurta-old-" + run, "खादी कुर्ता पुराना " + run,
                "Khadi Kurta Old " + run, "ACTIVE", "KO-" + run, "950.00", 250, null, null);
        archived = productService.changeStatus(instA, actor, archived.getPackageId(), "ARCHIVED");
        otherShop = product(instB, taxClassB, "khadi-kurta-other-" + run, "खादी कुर्ता अन्य " + run,
                "Khadi Kurta Other " + run, "ACTIVE", "KX-" + run, "950.00", 250, null, null);
        cartA = product(instA, taxClassA, "cart-a-" + run, "कार्ट ए " + run, "Cart A " + run, "ACTIVE",
                "CA-" + run, "800.00", 300, null, null).getVariants().get(0);
        cartB = product(instA, taxClassA, "cart-b-" + run, "कार्ट बी " + run, "Cart B " + run, "ACTIVE",
                "CB-" + run, "1500.00", 700, null, null).getVariants().get(0);

        receive(khadi.getVariants().get(0).getPackageSessionId(), 50);
        receive(lowStock.getVariants().get(0).getPackageSessionId(), 2);
        receive(cartA.getPackageSessionId(), 50);
        receive(cartB.getPackageSessionId(), 50);

        // Other shops, so the tables are not just this one shop (the planner then has a reason
        // to use the institute index, as on a shared production table).
        db.update("INSERT INTO package (id, status, package_name) SELECT 'noise-' || ? || '-' || g, 'ACTIVE', 'noise' "
                + "FROM generate_series(1, 20000) g", run);
        db.update("INSERT INTO commerce_product (id, institute_id, package_id, slug, status, published_at) "
                + "SELECT 'noise-' || ? || '-' || g, 'noise-inst-' || (g % 40), 'noise-' || ? || '-' || g, "
                + "'noise-' || ? || '-' || g, 'ACTIVE', now() FROM generate_series(1, 20000) g", run, run, run);
        db.update("INSERT INTO commerce_product_translation (id, institute_id, package_id, locale, name, search_text) "
                + "SELECT 'noise-' || ? || '-' || g, 'noise-inst-' || (g % 40), 'noise-' || ? || '-' || g, 'en', "
                + "'noise ' || g, 'noise ' || g FROM generate_series(1, 20000) g", run, run);
        db.update("INSERT INTO package_session (id, package_id, status, name, available_slots, max_seats) "
                + "SELECT 'noise-' || ? || '-' || g, 'noise-' || ? || '-' || g, 'ACTIVE', 'noise', 0, 0 "
                + "FROM generate_series(1, 20000) g", run, run);
        db.update("INSERT INTO commerce_variant (id, institute_id, package_session_id, package_id, sku, stock_policy) "
                + "SELECT 'noise-' || ? || '-' || g, 'noise-inst-' || (g % 40), 'noise-' || ? || '-' || g, "
                + "'noise-' || ? || '-' || g, 'NOISE-' || ? || '-' || g, 'UNTRACKED' FROM generate_series(1, 20000) g", run, run, run, run);
        db.execute("ANALYZE commerce_product");
        db.execute("ANALYZE package_session");
        db.execute("ANALYZE commerce_product_translation");
        db.execute("ANALYZE commerce_variant");

        sql("products of shop A by status", "SELECT status, count(*) FROM commerce_product WHERE institute_id = ? GROUP BY status ORDER BY status", instA);
        sql("rows in commerce_product, all shops", "SELECT count(*) AS products, count(DISTINCT institute_id) AS shops FROM commerce_product");
        sql("rows in the translation and variant tables, all shops", "SELECT (SELECT count(*) FROM commerce_product_translation) AS translations, (SELECT count(*) FROM commerce_variant) AS variants");
        snapshotLoader.evict(instA);
        snapshotLoader.evict(instB);
        noDriftInTheseShops("the seed");
    }

    /** The reconciliation job finds nothing in the two shops (and in the noise rows) of this run. */
    private void noDriftInTheseShops(String step) {
        List<?> drift = reconciliationJob.findSellableDrift().stream()
                .filter(d -> instA.equals(d.instituteId()) || instB.equals(d.instituteId())
                        || d.instituteId().startsWith("noise-inst-")).toList();
        assertTrue(drift.isEmpty(), "no stock drift after " + step + ": " + drift);
    }

    // ------------------------------------------------------------------ listing

    private long sqlCount(String... codes) {
        StringBuilder q = new StringBuilder("SELECT count(*) FROM commerce_product p WHERE p.institute_id = ? AND p.status = 'ACTIVE'");
        List<Object> args = new ArrayList<>();
        args.add(instA);
        for (String code : codes) {
            q.append(" AND EXISTS (SELECT 1 FROM commerce_product_attribute_value pav "
                    + "JOIN commerce_attribute_value av ON av.id = pav.attribute_value_id "
                    + "JOIN commerce_attribute a ON a.id = av.attribute_id "
                    + "WHERE pav.package_id = p.package_id AND pav.institute_id = p.institute_id "
                    + "AND a.code = ? AND av.code = ?)");
            args.add(code.substring(0, code.indexOf('=')));
            args.add(code.substring(code.indexOf('=') + 1));
        }
        return count(q.toString(), args.toArray());
    }

    private static int facetCount(StorefrontDtos.ProductList list, String attribute, String value) {
        return list.getFacets().getAttributes().stream().filter(f -> attribute.equals(f.getCode()))
                .flatMap(f -> f.getValues().stream()).filter(v -> value.equals(v.getCode()))
                .mapToInt(StorefrontDtos.FacetValue::getCount).findFirst().orElse(0);
    }

    @Test
    @Order(2)
    void listing_threeFacetsOverSevenHundredProducts_countsEqualSql_andTheReadUsesTheInstituteIndex() {
        note("");
        note("== listing with three facets");
        long active = count("SELECT count(*) FROM commerce_product WHERE institute_id = ? AND status = 'ACTIVE'", instA);
        assertEquals(BULK + 6, active, "700 bulk products and 6 named ones are ACTIVE");

        snapshotLoader.evict(instA);
        long t0 = System.nanoTime();
        StorefrontDtos.ProductList all = storefront.list(instA, query(null, null, null, 1, 24, true, "en"));
        long cold = (System.nanoTime() - t0) / 1_000_000;
        assertEquals(active, all.getTotal());
        assertEquals(24, all.getData().size());
        assertTrue(all.isHasMore());

        // No filter: every facet value counts the ACTIVE products that carry it.
        for (String colour : COLOURS) {
            assertEquals(sqlCount("colour=" + colour), facetCount(all, "colour", colour), "colour " + colour);
        }
        for (String fabric : FABRICS) {
            assertEquals(sqlCount("fabric=" + fabric), facetCount(all, "fabric", fabric), "fabric " + fabric);
        }
        for (String craft : CRAFTS) {
            assertEquals(sqlCount("craft=" + craft), facetCount(all, "craft", craft), "craft " + craft);
        }
        long sqlInStock = count("SELECT count(*) FROM commerce_product p WHERE p.institute_id = ? AND p.status = 'ACTIVE' "
                + "AND EXISTS (SELECT 1 FROM commerce_variant v JOIN package_session ps ON ps.id = v.package_session_id "
                + "WHERE v.package_id = p.package_id AND v.status = 'ACTIVE' AND ps.available_slots > 0)", instA);
        assertEquals(sqlInStock, all.getFacets().getAvailability().getInStock(), "in stock");
        assertEquals(active - sqlInStock, all.getFacets().getAvailability().getOutOfStock(), "out of stock");
        note("-- no filter: total " + all.getTotal() + ", in stock " + sqlInStock + ", out " + (active - sqlInStock)
                + "; facet counts equal the SQL counts for 4 colours, 3 fabrics, 2 crafts");

        // Three facets picked together.
        Map<String, List<String>> picked = new LinkedHashMap<>();
        picked.put("colour", List.of("red"));
        picked.put("fabric", List.of("cotton"));
        picked.put("craft", List.of("handloom"));
        long t1 = System.nanoTime();
        StorefrontDtos.ProductList three = storefront.list(instA, query(null, picked, null, 1, 100, true, "en"));
        long warm = (System.nanoTime() - t1) / 1_000;
        long expected = sqlCount("colour=red", "fabric=cotton", "craft=handloom");
        assertTrue(expected > 0);
        assertEquals(expected, three.getTotal(), "red AND cotton AND handloom");
        assertEquals(expected, three.getData().size());
        // A facet counts what picking that value would give, with the other two facets kept.
        for (String colour : COLOURS) {
            assertEquals(sqlCount("colour=" + colour, "fabric=cotton", "craft=handloom"),
                    facetCount(three, "colour", colour), "colour " + colour + " within cotton and handloom");
        }
        for (String fabric : FABRICS) {
            assertEquals(sqlCount("colour=red", "fabric=" + fabric, "craft=handloom"),
                    facetCount(three, "fabric", fabric), "fabric " + fabric + " within red and handloom");
        }
        // Two values of one facet are an OR.
        Map<String, List<String>> either = Map.of("colour", List.of("red", "blue"), "fabric", List.of("silk"));
        assertEquals(sqlCount("colour=red", "fabric=silk") + sqlCount("colour=blue", "fabric=silk"),
                storefront.list(instA, query(null, either, null, 1, 24, false, "en")).getTotal());
        // In stock only.
        Map<String, List<String>> red = Map.of("colour", List.of("red"));
        long redInStock = count("SELECT count(*) FROM commerce_product p WHERE p.institute_id = ? AND p.status = 'ACTIVE' "
                + "AND EXISTS (SELECT 1 FROM commerce_product_attribute_value pav JOIN commerce_attribute_value av "
                + "ON av.id = pav.attribute_value_id WHERE pav.package_id = p.package_id AND av.code = 'red') "
                + "AND EXISTS (SELECT 1 FROM commerce_variant v JOIN package_session ps ON ps.id = v.package_session_id "
                + "WHERE v.package_id = p.package_id AND ps.available_slots > 0)", instA);
        assertEquals(redInStock, storefront.list(instA, query(null, red, true, 1, 24, false, "en")).getTotal());
        // Pages do not overlap and add up.
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int page = 1; page <= 2; page++) {
            storefront.list(instA, query(null, red, null, page, 100, false, "en")).getData()
                    .forEach(card -> assertTrue(seen.add(card.getId()), "a product appears on one page only"));
        }
        assertEquals(sqlCount("colour=red"), seen.size());
        note("-- red AND cotton AND handloom: " + expected + " products; facet counts inside the selection equal SQL");

        // Timings on this machine.
        long[] micros = new long[20];
        for (int i = 0; i < micros.length; i++) {
            long t = System.nanoTime();
            storefront.list(instA, query(null, picked, null, 1, 24, true, "en"));
            micros[i] = (System.nanoTime() - t) / 1_000;
        }
        java.util.Arrays.sort(micros);
        note("-- timings: first listing after eviction (loads the shop from the database) " + cold + " ms; "
                + "three-facet listing with facets, 20 runs: median " + micros[10] / 1000.0 + " ms, slowest "
                + micros[19] / 1000.0 + " ms (first " + warm / 1000.0 + " ms)");

        // The statements the listing is built from read commerce_product by institute and status.
        String products = "SELECT p.package_id, p.slug, p.stock_mode, p.tax_class_id, p.brand, p.unit, p.qty_scale, "
                + "p.qty_step, p.published_at, p.updated_at, CAST(p.seo_i18n AS TEXT), sl.name FROM commerce_product p "
                + "LEFT JOIN stock_location sl ON sl.id = p.origin_location_id AND sl.institute_id = p.institute_id "
                + "WHERE p.institute_id = ? AND p.status = 'ACTIVE' ORDER BY p.published_at DESC NULLS LAST, p.package_id ASC";
        String translations = "SELECT t.package_id, t.locale, t.name, t.short_description, t.description_html, "
                + "CAST(t.content_blocks AS TEXT), t.search_text FROM commerce_product_translation t "
                + "JOIN commerce_product p ON p.package_id = t.package_id AND p.institute_id = t.institute_id "
                + "WHERE t.institute_id = ? AND p.status = 'ACTIVE'";
        String variants = "SELECT v.package_session_id, v.package_id, v.sku, v.stock_policy, ps.available_slots, ps.name "
                + "FROM commerce_variant v JOIN commerce_product p ON p.package_id = v.package_id AND p.institute_id = v.institute_id "
                + "JOIN package_session ps ON ps.id = v.package_session_id "
                + "WHERE v.institute_id = ? AND v.status = 'ACTIVE' AND p.status = 'ACTIVE' ORDER BY v.position ASC, v.created_at ASC, v.id ASC";
        for (String[] each : new String[][] {{"products", products}, {"translations", translations}, {"variants", variants}}) {
            List<String> plan = db.queryForList("EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF) " + each[1], String.class, instA);
            note("-- EXPLAIN ANALYZE, " + each[0] + " of the shop:");
            plan.forEach(line -> note("   " + line));
            assertTrue(plan.stream().noneMatch(line -> line.contains("Seq Scan on commerce_product ")),
                    each[0] + ": no sequential scan of commerce_product\n" + String.join("\n", plan));
            if (each[0].equals("products")) {
                assertTrue(plan.stream().anyMatch(line -> line.contains("idx_commerce_product_institute_status")),
                        "the product read uses the institute and status index\n" + String.join("\n", plan));
            }
        }
    }

    @Test
    @Order(3)
    void search_aHindiAndALatinQueryFindTheSameProduct_draftArchivedAndOtherShopsNeverAppear() throws Exception {
        note("");
        note("== search and visibility");
        StorefrontDtos.ProductCard hindi = onlyCard("खादी कुर्ता", "hi");
        StorefrontDtos.ProductCard latin = onlyCard("khadi kurta", "en");
        StorefrontDtos.ProductCard mixedCase = onlyCard("KHADI Kurta", "en");
        assertEquals(khadi.getPackageId(), hindi.getId());
        assertEquals(khadi.getPackageId(), latin.getId());
        assertEquals(khadi.getPackageId(), mixedCase.getId());
        assertEquals("खादी कुर्ता " + run, hindi.getName());
        assertEquals("Khadi Kurta " + run, latin.getName());
        note("-- \"खादी कुर्ता\" and \"khadi kurta\" both find " + hindi.getSlug() + " and nothing else, although shop A "
                + "also has a DRAFT and an ARCHIVED product with those words and shop B an ACTIVE one");
        sql("the four products with these words", "SELECT p.institute_id = ? AS shop_a, p.slug, p.status FROM commerce_product p "
                + "WHERE p.slug LIKE 'khadi-kurta%' AND p.slug LIKE ? ORDER BY p.slug", instA, "%" + run);

        // Not in any listing, not by address, not in the sitemap, not in the cart.
        java.util.Set<String> listed = new java.util.HashSet<>();
        for (int page = 1; ; page++) {
            StorefrontDtos.ProductList each = storefront.list(instA, query(null, null, null, page, 100, false, "en"));
            each.getData().forEach(card -> listed.add(card.getId()));
            if (!each.isHasMore()) {
                break;
            }
        }
        assertEquals(BULK + 6, listed.size());
        for (ProductResponse hidden : List.of(draft, archived, otherShop)) {
            assertFalse(listed.contains(hidden.getPackageId()), hidden.getSlug() + " is not listed");
            CatalogApiException notFound = assertThrows(CatalogApiException.class,
                    () -> storefront.detail(instA, hidden.getSlug(), "en"));
            assertEquals(404, notFound.getStatus().value(), hidden.getSlug());
            CommerceOrderService.CartPrice priced = orderService.priceCart(instA, CartPriceRequest.builder()
                    .lines(List.of(CartPriceRequest.Line.builder()
                            .variantId(hidden.getVariants().get(0).getPackageSessionId()).quantity(1).build())).build());
            assertEquals(1, priced.view().getUnavailable().size());
            assertEquals("NOT_FOUND", priced.view().getUnavailable().get(0).getReason(), hidden.getSlug());
            assertNull(priced.view().getUnavailable().get(0).getSku(), "no SKU is echoed for a hidden product");
            assertTrue(priced.view().getLines().isEmpty());

            // Asked by SKU, a hidden variant answers exactly like a SKU that does not exist: the line
            // is named by what was sent, and its id appears nowhere in the answer.
            String sku = hidden.getVariants().get(0).getSku();
            String hiddenId = hidden.getVariants().get(0).getPackageSessionId();
            CartPriceDtos.CartPrice bySku = orderService.priceCart(instA, CartPriceRequest.builder()
                    .lines(List.of(CartPriceRequest.Line.builder().sku(sku).quantity(1).build())).build()).view();
            CartPriceDtos.CartPrice unknown = orderService.priceCart(instA, CartPriceRequest.builder()
                    .lines(List.of(CartPriceRequest.Line.builder().sku(sku + "-NONE").quantity(1).build())).build()).view();
            assertEquals("NOT_FOUND", bySku.getUnavailable().get(0).getReason());
            assertEquals(sku, bySku.getUnavailable().get(0).getLineRef(), hidden.getSlug());
            assertNull(bySku.getUnavailable().get(0).getVariantId(), hidden.getSlug());
            assertNull(bySku.getChanges().get(0).getVariantId(), hidden.getSlug());
            assertFalse(json.writeValueAsString(bySku).contains(hiddenId), "the id of " + hidden.getSlug() + " is not told");
            assertEquals(json.writeValueAsString(unknown).replace(sku + "-NONE", sku), json.writeValueAsString(bySku),
                    "the same answer as for a SKU that does not exist");
        }
        note("-- DRAFT, ARCHIVED and shop B variant asked by SKU: same JSON as an unknown SKU, no id in the answer");
        // The staff list: every row carries its tax class, and the filter keeps the products without one.
        ProductResponse noClass = product(instA, null, "no-tax-class-" + run, "बिना कर " + run, "No Tax Class " + run,
                "DRAFT", "NT-" + run, "300.00", 100, null, null);
        var missing = productService.list(instA, null, null, null, true, 0, 20);
        assertEquals(1, missing.getTotalElements(), "one product of shop A has no tax class");
        assertEquals(noClass.getPackageId(), missing.getContent().get(0).getPackageId());
        assertNull(missing.getContent().get(0).getTaxClassId());
        var everything = productService.list(instA, "ACTIVE", null, null, false, 0, 50);
        assertEquals(BULK + 6, everything.getTotalElements());
        everything.getContent().forEach(row -> {
            assertEquals(taxClassA, row.getTaxClassId());
            assertEquals("QUANTITY", row.getStockMode());
        });
        assertEquals(0, productService.list(instB, null, null, null, true, 0, 20).getTotalElements());
        note("-- staff list, taxClassMissing=true: 1 of " + count("SELECT count(*) FROM commerce_product WHERE institute_id = ?", instA)
                + " products of shop A (" + noClass.getSlug() + "); every other row carries tax_class_id");

        // Shop B sees its own product and none of shop A.
        StorefrontDtos.ProductList shopB = storefront.list(instB, query(null, null, null, 1, 100, false, "en"));
        assertEquals(1, shopB.getTotal());
        assertEquals(otherShop.getPackageId(), shopB.getData().get(0).getId());
        assertEquals(khadi.getPackageId(), storefront.detail(instA, khadi.getSlug(), "en").getId());
        note("-- DRAFT, ARCHIVED and shop B product: absent from all " + listed.size() + " listed products, 404 by "
                + "address, NOT_FOUND in the cart; shop B lists only its own 1 product");
    }

    @Test
    @Order(4)
    void stock_isAStateNotACount_andTextFallsBackPerFieldToTheBaseLanguage() throws Exception {
        note("");
        note("== stock state and locale fallback");
        StorefrontDtos.ProductCard in = onlyCard("khadi kurta", "en");
        assertEquals("IN_STOCK", in.getStock().getState());
        assertNull(in.getStock().getLeft(), "50 on hand is not told");
        assertTrue(in.getStock().isPurchasable());
        StorefrontDtos.ProductCard low = onlyCard("lowstock shawl", "en");
        assertEquals("LOW", low.getStock().getState());
        assertEquals(2, low.getStock().getLeft(), "at or below the threshold of 3 the number is told");
        StorefrontDtos.ProductCard out = onlyCard("soldout stole", "en");
        assertEquals("OUT", out.getStock().getState());
        assertNull(out.getStock().getLeft());
        assertFalse(out.getStock().isPurchasable());
        sql("what the database holds for the three", "SELECT v.sku, ps.available_slots, ps.max_seats, v.cost_price FROM commerce_variant v "
                + "JOIN package_session ps ON ps.id = v.package_session_id WHERE v.sku IN (?, ?, ?) ORDER BY v.sku",
                "KK-" + run, "LS-" + run, "SO-" + run);

        String listJson = json.writeValueAsString(storefront.list(instA, query("khadi kurta", null, null, 1, 24, true, "en")));
        String detailJson = json.writeValueAsString(storefront.detail(instA, khadi.getSlug(), "en"));
        note("-- card of the product with 50 on hand: " + json.writeValueAsString(in.getStock()));
        note("-- card of the product with 2 on hand:  " + json.writeValueAsString(low.getStock()));
        note("-- card of the product with 0 on hand:  " + json.writeValueAsString(out.getStock()));
        for (String body : List.of(listJson, detailJson)) {
            for (String word : List.of("available_slots", "max_seats", "on_hand", "cost", "tax_class", "package_session",
                    "supplier", "\"left\":50", ":50,", ":50}")) {
                assertFalse(body.contains(word), "public JSON does not contain " + word + ": " + body);
            }
        }

        // Base locale is Hindi. A product with English text only is served in English; a field
        // missing in the asked language comes from the next one, field by field.
        assertEquals("Onlyenglish Scarf " + run, onlyCard("onlyenglish scarf", "hi").getName());
        StorefrontDtos.ProductDetail hi = storefront.detail(instA, khadi.getSlug(), "hi");
        assertEquals("खादी कुर्ता " + run, hi.getName());
        assertEquals("Hand-spun cotton", hi.getShortDescription(), "the Hindi page borrows the English short text");
        StorefrontDtos.ProductDetail en = storefront.detail(instA, khadi.getSlug(), "en");
        assertEquals("Khadi Kurta " + run, en.getName());
        StorefrontDtos.ProductDetail fr = storefront.detail(instA, khadi.getSlug(), "fr");
        assertEquals("खादी कुर्ता " + run, fr.getName(), "an unknown language falls back to the base language");
        assertEquals("/p/" + khadi.getSlug(), hi.getPath());
        assertEquals("/p/" + khadi.getSlug() + "?lang=en", en.getPath());
        note("-- locale: hi name \"" + hi.getName() + "\" with en short text \"" + hi.getShortDescription() + "\"; "
                + "fr falls back to \"" + fr.getName() + "\"; paths " + hi.getPath() + " and " + en.getPath());
    }

    @Test
    @Order(5)
    void sitemap_holdsTheActiveProductsAndCollectionsOfTheShop() {
        note("");
        note("== sitemap");
        List<Map<String, Object>> entries = sitemapContributor.sitemapEntries(instA);
        long products = entries.stream().filter(e -> "product".equals(e.get("type"))).count();
        assertEquals(BULK + 6, products);
        String base = "https://shop-" + run + ".example.com";
        java.util.Set<String> urls = new java.util.HashSet<>();
        entries.forEach(e -> urls.add(String.valueOf(e.get("url"))));
        assertTrue(urls.contains(base + "/p/" + khadi.getSlug()), urls.stream().limit(3).toList().toString());
        assertTrue(urls.contains(base + "/c/kurtas"));
        for (ProductResponse hidden : List.of(draft, archived, otherShop)) {
            assertTrue(urls.stream().noneMatch(u -> u.endsWith("/" + hidden.getSlug())), hidden.getSlug());
        }
        entries.stream().filter(e -> "product".equals(e.get("type"))).forEach(e -> assertNotNull(e.get("lastmod")));
        // The public /sitemap route has the contributor wired in.
        Object wired = ReflectionTestUtils.getField(catalogApiController, "sitemapContributors");
        assertTrue(wired instanceof List<?> list && list.stream().anyMatch(c -> c instanceof StorefrontSitemapContributor),
                "the sitemap route calls the storefront contributor");
        // A shop without the feature adds nothing.
        db.update("UPDATE institute_module_entitlement SET enabled = false WHERE institute_id = ? AND key = 'commerce'", instB);
        capabilityResolver.evict(instB);
        assertTrue(sitemapContributor.sitemapEntries(instB).isEmpty(), "feature off, no entries");
        db.update("UPDATE institute_module_entitlement SET enabled = true WHERE institute_id = ? AND key = 'commerce'", instB);
        capabilityResolver.evict(instB);
        note("-- " + entries.size() + " entries: " + products + " products, " + (entries.size() - products)
                + " collections; e.g. " + base + "/p/" + khadi.getSlug() + "; hidden products absent; feature off = 0 entries");
    }

    // ------------------------------------------------------------------ cart

    private CartPriceRequest cart(String pincode, String state, String method, Object... variantAndQuantity) {
        List<CartPriceRequest.Line> lines = new ArrayList<>();
        for (int i = 0; i < variantAndQuantity.length; i += 2) {
            lines.add(CartPriceRequest.Line.builder()
                    .variantId(((VariantResponse) variantAndQuantity[i]).getPackageSessionId())
                    .quantity((Integer) variantAndQuantity[i + 1]).build());
        }
        return CartPriceRequest.builder().lines(lines).pincode(pincode).stateCode(state).paymentMethod(method)
                .locale("en").build();
    }

    /** The tax request built here by hand, from the stored prices and the charge worked out on paper. */
    private TaxResult byHand(String placeState, String shipping, String codCharge, Object... variantAndQuantity) {
        CommerceTaxContext settings = taxSettingService.context(instA);
        TaxClassRef ref = taxClassService.loadRefs(instA, List.of(taxClassA)).get(taxClassA);
        List<TaxLineInput> lines = new ArrayList<>();
        for (int i = 0; i < variantAndQuantity.length; i += 2) {
            VariantResponse variant = (VariantResponse) variantAndQuantity[i];
            lines.add(TaxLineInput.builder().lineRef(variant.getPackageSessionId()).lineType(TaxLineType.ITEM)
                    .description(variant.getSku()).unitPrice(variant.getPrice()).quantity((Integer) variantAndQuantity[i + 1])
                    .qtyScale(1).taxClass(ref).build());
        }
        if (shipping != null) {
            lines.add(TaxLineInput.builder().lineRef("SHIPPING").lineType(TaxLineType.SHIPPING).description("Delivery")
                    .unitPrice(new BigDecimal(shipping)).quantity(1).qtyScale(1).taxClass(ref).build());
        }
        if (codCharge != null) {
            lines.add(TaxLineInput.builder().lineRef("COD_CHARGE").lineType(TaxLineType.COD_CHARGE)
                    .description("Cash on delivery charge").unitPrice(new BigDecimal(codCharge)).quantity(1).qtyScale(1)
                    .taxClass(ref).build());
        }
        return new CommerceTaxCalculator().calculate(TaxRequest.builder().mode(settings.getMode())
                .slabBasis(settings.getSlabBasis()).slabCompare(settings.getSlabCompare())
                .roundTotalTo(settings.getRoundTotalTo()).sellerStateCode(SELLER_STATE).placeOfSupplyState(placeState)
                .date(documentClock.today(instA)).orderDiscount(BigDecimal.ZERO.setScale(2)).lines(lines).build());
    }

    private void totalsEqual(TaxResult expected, CartPriceDtos.CartPrice view, String what) {
        same(expected.getSubtotal(), view.getTotals().getSubtotal(), what + " subtotal");
        same(expected.getDiscount(), view.getTotals().getDiscount(), what + " discount");
        same(expected.getShipping(), view.getTotals().getShipping(), what + " shipping");
        same(expected.getCodCharge(), view.getTotals().getCodCharge(), what + " COD charge");
        same(expected.getRoundOff(), view.getTotals().getRoundOff(), what + " round-off");
        same(expected.getTotal(), view.getTotals().getTotal(), what + " total");
        same(expected.getTaxableValue(), view.getTax().getTaxableValue(), what + " taxable value");
        same(expected.getCgst(), view.getTax().getCgst(), what + " CGST");
        same(expected.getSgst(), view.getTax().getSgst(), what + " SGST");
        same(expected.getIgst(), view.getTax().getIgst(), what + " IGST");
        same(expected.getTaxAmount(), view.getTax().getTaxAmount(), what + " tax");
        assertEquals(expected.getTaxHead().name(), view.getTax().getHead(), what + " tax head");
        for (CartPriceDtos.Line line : view.getLines()) {
            TaxLineResult row = expected.getLines().stream()
                    .filter(l -> l.getLineType() == TaxLineType.ITEM && line.getLineRef().equals(l.getLineRef()))
                    .findFirst().orElseThrow();
            same(row.getTaxableValue(), line.getTaxableValue(), what + " line " + line.getSku() + " taxable");
            same(row.getTaxAmount(), line.getTaxAmount(), what + " line " + line.getSku() + " tax");
            same(row.getRatePercent(), line.getTaxRatePercent(), what + " line " + line.getSku() + " rate");
            same(row.getNet(), line.getNet(), what + " line " + line.getSku() + " net");
            assertEquals(row.getHsnCode(), line.getHsnCode());
        }
    }

    private String paymentLog(VariantResponse variant, int quantity, String orderId) {
        UserPlan plan = inTransaction(() -> {
            PaymentPlan paymentPlan = paymentPlanRepository.findById(variant.getPaymentPlanId()).orElseThrow();
            EnrollInvite invite = enrollInviteRepository.findById(variant.getEnrollInviteId()).orElseThrow();
            PaymentOption option = paymentOptionRepository.findById(variant.getPaymentOptionId()).orElseThrow();
            PaymentInitiationRequestDTO payment = new PaymentInitiationRequestDTO();
            payment.setAmount(paymentPlan.getActualPrice() * quantity);
            payment.setCurrency("INR");
            return userPlanService.createUserPlan(buyer, paymentPlan, null, invite, option, payment,
                    "PENDING_FOR_PAYMENT", null, null, null, null, quantity);
        });
        return paymentLogService.createPaymentLog(buyer, variant.getPrice().doubleValue() * quantity, "RAZORPAY",
                "RAZORPAY", "INR", plan, orderId);
    }

    @Test
    @Order(6)
    void cart_totalsEqualTheTaxCalculator_andTheInvoiceWrittenFromTheSameLines() throws Exception {
        note("");
        note("== cart price against the tax calculator and the invoice");
        // Delivery by weight (TEST amounts): up to 500 g 50, up to 2,000 g 90, above 150; COD charge 30.
        List<Map<String, Object>> tiers = new ArrayList<>();
        tiers.add(new LinkedHashMap<>(Map.of("up_to", 500, "charge", 50)));
        tiers.add(new LinkedHashMap<>(Map.of("up_to", 2000, "charge", 90)));
        Map<String, Object> open = new LinkedHashMap<>();
        open.put("up_to", null);
        open.put("charge", 150);
        tiers.add(open);
        ShippingRuleDTO rule = shippingRuleService.save(instA, actor, ShippingRuleDTO.builder().basis("WEIGHT")
                .tiers(tiers).codCharge(new BigDecimal("30")).taxClassId(taxClassA).build());
        sql("the shipping rule", "SELECT basis, CAST(tiers_json AS TEXT) AS tiers, free_above, cod_charge, status FROM commerce_shipping_rule WHERE institute_id = ?", instA);
        assertNotNull(rule.getId());

        // 2 x 800.00 (5 percent slab) and 1 x 1500.00 (12 percent slab): 600 + 700 = 1,300 g, delivery 90.
        // Same state (pincode 208001 is Uttar Pradesh): CGST + SGST.
        CommerceOrderService.CartPrice priced = orderService.priceCart(instA,
                cart("208001", null, "PREPAID", cartA, 2, cartB, 1));
        CartPriceDtos.CartPrice view = priced.view();
        CartPriceSnapshot snapshot = priced.snapshot();
        note("-- cart: " + json.writeValueAsString(view));
        assertEquals(2, view.getLines().size());
        assertTrue(view.getUnavailable().isEmpty());
        assertEquals("PREPAID", view.getPaymentMethod());
        same(new BigDecimal("90.00"), view.getShipping().getCharge(), "delivery for 1,300 g");
        assertEquals(1300, snapshot.getShipping().getWeightGrams());
        assertEquals(SELLER_STATE, snapshot.getPlaceOfSupplyState());
        assertEquals("PIN_PREFIX", snapshot.getPlaceOfSupplySource());
        assertEquals(wh, snapshot.getFulfilmentLocationId());

        // 1. The calculator, given the stored request, returns the stored result.
        TaxResult again = new CommerceTaxCalculator().calculate(snapshot.getTaxRequest());
        assertEquals(json.writeValueAsString(snapshot.getTax()), json.writeValueAsString(again),
                "CommerceTaxCalculator.calculate(snapshot.taxRequest) equals snapshot.tax");
        // 2. A request built by hand from the prices and the delivery charge gives the same money.
        TaxResult hand = byHand(SELLER_STATE, "90.00", null, cartA, 2, cartB, 1);
        totalsEqual(hand, view, "same state");
        assertEquals("CGST_SGST", view.getTax().getHead());
        same(view.getTotals().getSubtotal().subtract(view.getTotals().getDiscount()).add(view.getTotals().getShipping())
                .add(view.getTotals().getCodCharge()).add(view.getTotals().getRoundOff()), view.getTotals().getTotal(),
                "the totals add up");
        note("-- by hand: subtotal " + hand.getSubtotal() + ", shipping " + hand.getShipping() + ", taxable "
                + hand.getTaxableValue() + ", CGST " + hand.getCgst() + ", SGST " + hand.getSgst() + ", round-off "
                + hand.getRoundOff() + ", total " + hand.getTotal() + " = cart totals");

        // 3. The invoice written from the cart's tax result holds the same figures, line by line.
        seriesService.create(instA, actor, DocumentSeriesDTO.builder().documentType("TAX_INVOICE")
                .prefix("SF" + run.substring(0, 2)).build());
        String logA = paymentLog(cartA, 2, "sf-o1-" + run);
        String logB = paymentLog(cartB, 1, "sf-o1-" + run);
        paymentLogService.updatePaymentLog(logA, "SUCCESS", "PAID", "{\"gateway\":\"proof\"}");
        paymentLogService.updatePaymentLog(logB, "SUCCESS", "PAID", "{\"gateway\":\"proof\"}");
        CommerceInvoiceService.Issued issued = inTransaction(() -> commerceInvoiceService.issue(instA,
                CommerceInvoiceRequest.builder().commerceOrderId("order-sf-o1-" + run).orderNumber("ORD-SF-" + run)
                        .channel("ONLINE").locationId(wh).userId(buyer).buyerName("Proof Buyer").buyerPhone("9999999999")
                        .billingAddress("2 Buyer Lane, Kanpur 208001").shippingAddress("2 Buyer Lane, Kanpur 208001")
                        .tax(snapshot.getTax()).paymentLogIds(List.of(logA, logB)).actorUserId(actor).build()));
        String invoiceId = issued.invoice().getId();
        Map<String, Object> row = sql("the invoice", "SELECT invoice_number, tax_head, place_of_supply_state, subtotal, discount_amount, tax_amount, round_off, total_amount FROM invoice WHERE id = ?", invoiceId).get(0);
        same(hand.getTaxableValue(), row.get("subtotal"), "invoice taxable value");
        same(hand.getTaxAmount(), row.get("tax_amount"), "invoice tax");
        same(hand.getRoundOff(), row.get("round_off"), "invoice round-off");
        same(hand.getTotal(), row.get("total_amount"), "invoice total");
        same(view.getTotals().getTotal(), row.get("total_amount"), "invoice total equals the cart total");
        assertEquals(view.getTax().getHead(), row.get("tax_head"));
        List<Map<String, Object>> stored = sql("its lines", "SELECT source_id, item_type, description, quantity, unit_price, amount, hsn_code, tax_rate, taxable_value, cgst, sgst, igst, cess, discount "
                + "FROM invoice_line_item WHERE invoice_id = ? ORDER BY item_type, source_id", invoiceId);
        assertEquals(hand.getLines().size(), stored.size(), "two items and the delivery line");
        for (TaxLineResult line : hand.getLines()) {
            Map<String, Object> s = stored.stream().filter(l -> line.getLineRef().equals(l.get("source_id"))).findFirst().orElseThrow();
            assertEquals("COMMERCE_" + line.getLineType().name(), s.get("item_type"));
            assertEquals(line.getQuantity(), ((Number) s.get("quantity")).intValue());
            same(line.getUnitPrice(), s.get("unit_price"), line.getLineRef() + " unit price");
            same(line.getNet(), s.get("amount"), line.getLineRef() + " net");
            same(line.getRatePercent(), s.get("tax_rate"), line.getLineRef() + " rate");
            same(line.getTaxableValue(), s.get("taxable_value"), line.getLineRef() + " taxable");
            same(line.getCgst(), s.get("cgst"), line.getLineRef() + " cgst");
            same(line.getSgst(), s.get("sgst"), line.getLineRef() + " sgst");
            same(line.getIgst(), s.get("igst"), line.getLineRef() + " igst");
            assertEquals(line.getHsnCode(), s.get("hsn_code"));
        }
        for (CartPriceDtos.Line line : view.getLines()) {
            Map<String, Object> s = stored.stream().filter(l -> line.getLineRef().equals(l.get("source_id"))).findFirst().orElseThrow();
            same(line.getTaxableValue(), s.get("taxable_value"), "cart line " + line.getSku() + " taxable = invoice line");
            same(line.getTaxAmount(), new BigDecimal(String.valueOf(s.get("cgst"))).add(new BigDecimal(String.valueOf(s.get("sgst"))))
                    .add(new BigDecimal(String.valueOf(s.get("igst")))).add(new BigDecimal(String.valueOf(s.get("cess")))),
                    "cart line " + line.getSku() + " tax = invoice line");
            same(line.getTaxRatePercent(), s.get("tax_rate"), "cart line " + line.getSku() + " rate = invoice line");
            same(line.getUnitPrice(), s.get("unit_price"), "cart line " + line.getSku() + " unit price = invoice line");
            assertEquals(line.getQuantity(), ((Number) s.get("quantity")).intValue());
        }
        note("-- invoice " + row.get("invoice_number") + ": 3 lines equal the calculator lines and the 2 cart lines, to the paisa");

        // Another state: IGST, same total.
        CartPriceDtos.CartPrice other = orderService.priceCart(instA, cart(null, "27", "PREPAID", cartA, 2, cartB, 1)).view();
        totalsEqual(byHand("27", "90.00", null, cartA, 2, cartB, 1), other, "other state");
        assertEquals("IGST", other.getTax().getHead());
        same(view.getTotals().getTotal(), other.getTotals().getTotal(), "the total does not depend on the state");
        same(BigDecimal.ZERO, other.getTax().getCgst(), "no CGST across states");
        // The price the cart showed is never trusted.
        CartPriceRequest stale = cart("208001", null, "PREPAID", cartA, 1);
        stale.getLines().get(0).setUnitPrice(new BigDecimal("1.00"));
        CartPriceDtos.CartPrice corrected = orderService.priceCart(instA, stale).view();
        same(new BigDecimal("800.00"), corrected.getLines().get(0).getUnitPrice(), "the stored price is charged");
        assertEquals("PRICE_CHANGED", corrected.getChanges().get(0).getType());
        // More than the shop sells in one order: refused the same way whatever is on hand (50 here),
        // so the answer has no boundary at the stock count.
        for (int quantity : new int[] {26, 50, 51, 5000}) {
            CartPriceDtos.CartPrice tooMany = orderService.priceCart(instA, cart(null, null, null, cartA, quantity)).view();
            assertEquals("QUANTITY_ABOVE_MAX", tooMany.getUnavailable().get(0).getReason(), "quantity " + quantity);
            assertEquals(25, tooMany.getUnavailable().get(0).getMaxQuantity());
            assertNull(tooMany.getUnavailable().get(0).getAvailableQuantity(), "50 on hand is not told");
        }
        assertTrue(orderService.priceCart(instA, cart(null, null, null, cartA, 25)).view().getUnavailable().isEmpty(),
                "25 of 50 can be bought");
        // The same answer for a variant with 2 on hand.
        CartPriceDtos.CartPrice lowAboveMax = orderService.priceCart(instA, CartPriceRequest.builder().lines(List.of(
                CartPriceRequest.Line.builder().variantId(lowStock.getVariants().get(0).getPackageSessionId()).quantity(26).build())).build()).view();
        assertEquals("QUANTITY_ABOVE_MAX", lowAboveMax.getUnavailable().get(0).getReason());
        assertNull(lowAboveMax.getUnavailable().get(0).getAvailableQuantity());
        note("-- 26, 50, 51 and 5000 of a variant with 50 on hand, and 26 of one with 2 on hand: QUANTITY_ABOVE_MAX, "
                + "max_quantity 25, no available_quantity; 25 of 50 is priced");
        String cartJson = json.writeValueAsString(view);
        for (String word : List.of("tax_class", "cost", "available_slots", "location")) {
            assertFalse(cartJson.contains(word), "the public cart view does not contain " + word);
        }
    }

    @Test
    @Order(7)
    void shipping_isChargedByTheWeightOfTheCart() {
        note("");
        note("== delivery by weight");
        Object[][] cases = {
                {1, "50.00", 300L},     // 300 g
                {2, "90.00", 600L},     // 600 g: above 500
                {6, "90.00", 1800L},    // 1,800 g
                {7, "150.00", 2100L},   // 2,100 g: above 2,000
        };
        for (Object[] each : cases) {
            CommerceOrderService.CartPrice priced = orderService.priceCart(instA,
                    cart("208001", null, "PREPAID", cartA, each[0]));
            same(new BigDecimal((String) each[1]), priced.view().getShipping().getCharge(), each[0] + " x 300 g");
            assertEquals((Long) each[2], priced.snapshot().getShipping().getWeightGrams());
            assertEquals("WEIGHT", priced.view().getShipping().getBasis());
            totalsEqual(byHand(SELLER_STATE, (String) each[1], null, cartA, each[0]), priced.view(), each[0] + " x 300 g");
            note("-- " + each[0] + " x 300 g = " + each[2] + " g: delivery " + priced.view().getShipping().getCharge()
                    + ", total " + priced.view().getTotals().getTotal());
        }
    }

    @Test
    @Order(8)
    void cod_isRefusedWithAReason_andAllowedWithItsCharge() {
        note("");
        note("== cash on delivery");
        // Off in the settings.
        CartPriceDtos.CartPrice off = orderService.priceCart(instA, cart("208001", null, "COD", cartA, 1)).view();
        assertFalse(off.getCod().isEligible());
        assertEquals("COD_DISABLED", off.getCod().getReason());
        assertEquals("PREPAID", off.getPaymentMethod(), "priced as prepaid");
        same(BigDecimal.ZERO, off.getTotals().getCodCharge(), "no COD charge");
        note("-- COD off in the settings: " + off.getCod().getReason() + ", priced as " + off.getPaymentMethod());

        setting(instA, commerceSetting(true));
        // 800 + 50 delivery + 30 COD charge.
        CartPriceDtos.CartPrice ok = orderService.priceCart(instA, cart("208001", null, "COD", cartA, 1)).view();
        assertTrue(ok.getCod().isEligible());
        assertNull(ok.getCod().getReason());
        assertEquals("COD", ok.getPaymentMethod());
        assertFalse(ok.getCod().isNeedsStaffConfirmation());
        same(new BigDecimal("30.00"), ok.getTotals().getCodCharge(), "COD charge");
        totalsEqual(byHand(SELLER_STATE, "50.00", "30.00", cartA, 1), ok, "COD");
        same(new BigDecimal("880.00"), ok.getTotals().getTotal(), "800 + 50 + 30");
        note("-- COD on, 800 + 50 + 30: eligible, total " + ok.getTotals().getTotal());
        // The same cart asked as prepaid carries no COD charge.
        CartPriceDtos.CartPrice prepaid = orderService.priceCart(instA, cart("208001", null, "PREPAID", cartA, 1)).view();
        same(BigDecimal.ZERO, prepaid.getTotals().getCodCharge(), "prepaid has no COD charge");
        assertTrue(prepaid.getCod().isEligible(), "the answer still says COD is possible");

        // Above the confirm amount (3,000) and under the limit (5,000): allowed, staff will call.
        CartPriceDtos.CartPrice call = orderService.priceCart(instA, cart("208001", null, "COD", cartB, 2)).view();
        assertTrue(call.getCod().isEligible());
        assertTrue(call.getCod().isNeedsStaffConfirmation());
        note("-- 2 x 1500 + 90 + 30 = " + call.getTotals().getTotal() + ": eligible, needs a confirmation call");

        // Above the limit.
        CartPriceDtos.CartPrice above = orderService.priceCart(instA, cart("208001", null, "COD", cartB, 4)).view();
        assertFalse(above.getCod().isEligible());
        assertEquals("ORDER_ABOVE_COD_LIMIT", above.getCod().getReason());
        assertEquals("PREPAID", above.getPaymentMethod());
        same(BigDecimal.ZERO, above.getTotals().getCodCharge(), "no COD charge when refused");
        totalsEqual(byHand(SELLER_STATE, "150.00", null, cartB, 4), above, "COD refused");
        note("-- 4 x 1500: " + above.getCod().getReason() + ", priced as " + above.getPaymentMethod() + ", total "
                + above.getTotals().getTotal());

        // A blocked pincode, and one that is not a pincode.
        CartPriceDtos.CartPrice blocked = orderService.priceCart(instA, cart("190001", null, "COD", cartA, 1)).view();
        assertEquals("PINCODE_BLOCKED", blocked.getCod().getReason());
        assertEquals("PREPAID", blocked.getPaymentMethod());
        CartPriceDtos.CartPrice invalid = orderService.priceCart(instA, cart("12", null, "COD", cartA, 1)).view();
        assertEquals("PINCODE_INVALID", invalid.getCod().getReason());
        assertEquals("PREPAID", invalid.getPaymentMethod());
        // No pincode yet: the amount qualifies, the pincode rule is still open.
        CartPriceDtos.CartPrice noPin = orderService.priceCart(instA, cart(null, null, "COD", cartA, 1)).view();
        assertTrue(noPin.getCod().isEligible());
        assertFalse(noPin.getCod().isPincodeChecked());
        note("-- pincode 190001: " + blocked.getCod().getReason() + "; pincode \"12\": " + invalid.getCod().getReason()
                + "; no pincode: eligible with pincode_checked false");
    }

    // ------------------------------------------------------------------ import

    private static String csv(List<Map<ImportColumn, String>> rows) {
        StringBuilder out = new StringBuilder();
        ImportColumn[] columns = ImportColumn.values();
        for (int i = 0; i < columns.length; i++) {
            out.append(i == 0 ? "" : ",").append(columns[i].header());
        }
        out.append("\n");
        for (Map<ImportColumn, String> row : rows) {
            for (int i = 0; i < columns.length; i++) {
                String cell = row.getOrDefault(columns[i], "");
                out.append(i == 0 ? "" : ",").append('"').append(cell.replace("\"", "\"\"")).append('"');
            }
            out.append("\n");
        }
        return out.toString();
    }

    private Map<ImportColumn, String> productRow(String handle, String sku, String price) {
        Map<ImportColumn, String> row = new LinkedHashMap<>();
        row.put(ImportColumn.HANDLE, handle);
        row.put(ImportColumn.EXTERNAL_REF, "woo-" + handle);
        row.put(ImportColumn.NAME_HI, "आयात " + handle);
        row.put(ImportColumn.NAME_EN, "Imported " + handle);
        row.put(ImportColumn.SHORT_DESCRIPTION_EN, "Imported by the proof");
        row.put(ImportColumn.COLLECTIONS, "kurtas");
        row.put(ImportColumn.ATTRIBUTES, "fabric=khadi");
        row.put(ImportColumn.TAX_CLASS_CODE, "garments");
        row.put(ImportColumn.HSN, "6205");
        row.put(ImportColumn.STATUS, "ACTIVE");
        row.put(ImportColumn.SKU, sku);
        row.put(ImportColumn.PRICE, price);
        row.put(ImportColumn.MRP, "2000");
        row.put(ImportColumn.WEIGHT_GRAMS, "250");
        return row;
    }

    /** 300 products in 500 rows: the first 200 have two sizes, the other 100 one variant. */
    private byte[] fiveHundredRows() {
        List<Map<ImportColumn, String>> rows = new ArrayList<>();
        for (int i = 0; i < 300; i++) {
            String handle = "imp-" + run + "-" + i;
            if (i < 200) {
                Map<ImportColumn, String> small = productRow(handle, "I" + run + "-" + i + "-S", String.valueOf(500 + i));
                small.put(ImportColumn.OPTION1_NAME, "size");
                small.put(ImportColumn.OPTION1_VALUE, "s");
                small.put(ImportColumn.VARIANT_EXTERNAL_REF, "woo-" + handle + "-s");
                rows.add(small);
                Map<ImportColumn, String> medium = new LinkedHashMap<>();
                medium.put(ImportColumn.HANDLE, handle);
                medium.put(ImportColumn.SKU, "I" + run + "-" + i + "-M");
                medium.put(ImportColumn.VARIANT_EXTERNAL_REF, "woo-" + handle + "-m");
                medium.put(ImportColumn.OPTION1_VALUE, "m");
                medium.put(ImportColumn.PRICE, String.valueOf(520 + i));
                medium.put(ImportColumn.WEIGHT_GRAMS, "260");
                rows.add(medium);
            } else {
                rows.add(productRow(handle, "I" + run + "-" + i, String.valueOf(500 + i)));
            }
        }
        assertEquals(500, rows.size());
        return csv(rows).getBytes(StandardCharsets.UTF_8);
    }

    private static final String[] WRITTEN_TABLES = {"package", "package_session", "enroll_invite", "payment_option",
            "payment_plan", "package_session_learner_invitation_to_payment_option", "commerce_product",
            "commerce_product_translation", "commerce_variant", "commerce_variant_option_value",
            "commerce_product_option", "commerce_product_attribute_value", "commerce_product_collection",
            "commerce_product_media", "commerce_audit", "commerce_import_job", "commerce_import_job_file",
            "commerce_import_image_queue"};

    private Map<String, Long> rowCounts() {
        Map<String, Long> counts = new LinkedHashMap<>();
        for (String table : WRITTEN_TABLES) {
            counts.put(table, count("SELECT count(*) FROM " + table));
        }
        return counts;
    }

    private ImportJobResponse runImport(String fileName, byte[] file) throws InterruptedException {
        ImportJobResponse started = importService.start(instB, actor, fileName, file);
        long deadline = System.currentTimeMillis() + 600_000;
        while (true) {
            ImportJobResponse now = importService.get(instB, started.getJobId());
            if (!"QUEUED".equals(now.getStatus()) && !"RUNNING".equals(now.getStatus())) {
                return now;
            }
            assertTrue(System.currentTimeMillis() < deadline, "the import finished within ten minutes");
            Thread.sleep(250);
        }
    }

    @Test
    @Order(9)
    void import_validateWritesNothing_commitCreates_aSecondRunCreatesNothing() throws Exception {
        note("");
        note("== product import (shop B)");
        String size = attributeService.create(instB, actor, AttributeDTO.builder().code("size")
                .nameI18n(Map.of("en", "Size")).kind("TEXT").isFilterable(true).build()).getId();
        attributeService.createValue(instB, actor, size, AttributeValueDTO.builder().code("s").labelI18n(Map.of("en", "S")).build());
        attributeService.createValue(instB, actor, size, AttributeValueDTO.builder().code("m").labelI18n(Map.of("en", "M")).build());
        String fabric = attributeService.create(instB, actor, AttributeDTO.builder().code("fabric")
                .nameI18n(Map.of("en", "Fabric")).kind("TEXT").isFilterable(true).build()).getId();
        attributeService.createValue(instB, actor, fabric, AttributeValueDTO.builder().code("khadi").labelI18n(Map.of("en", "Khadi")).build());
        collectionService.create(instB, actor, CollectionDTO.builder().slug("kurtas").nameI18n(Map.of("en", "Kurtas")).build());

        byte[] file = fiveHundredRows();
        Map<String, Long> before = rowCounts();
        long t0 = System.currentTimeMillis();
        ImportValidationResponse checked = importService.validate(instB, "products.csv", file);
        long validateMs = System.currentTimeMillis() - t0;
        note("-- validate: " + json.writeValueAsString(checked));
        assertEquals(0, checked.getErrorCount(), String.valueOf(checked.getIssues()));
        assertEquals(500, checked.getRowsTotal());
        assertEquals(300, checked.getProductsTotal());
        assertEquals(300, checked.getProductsToCreate());
        assertEquals(0, checked.getProductsToUpdate());
        assertEquals(500, checked.getVariantsToCreate());
        assertEquals(before, rowCounts(), "validate wrote no row in any of " + WRITTEN_TABLES.length + " tables");
        note("-- validate-only (" + validateMs + " ms): row counts of " + WRITTEN_TABLES.length + " tables unchanged: " + before);

        t0 = System.currentTimeMillis();
        ImportJobResponse first = runImport("products.csv", file);
        long commitMs = System.currentTimeMillis() - t0;
        note("-- commit (" + commitMs + " ms): " + json.writeValueAsString(first));
        assertEquals("COMPLETED", first.getStatus(), String.valueOf(first.getIssues()));
        assertEquals(300, first.getProductsCreated());
        assertEquals(0, first.getProductsUpdated());
        assertEquals(0, first.getProductsFailed());
        assertEquals(500, first.getVariantsCreated());
        assertEquals(500, first.getRowsDone());
        assertEquals(300, count("SELECT count(*) FROM commerce_product WHERE institute_id = ? AND slug LIKE ?", instB, "imp-" + run + "-%"));
        assertEquals(300, count("SELECT count(*) FROM commerce_product WHERE institute_id = ? AND slug LIKE ? AND status = 'ACTIVE' AND tax_class_id = ?", instB, "imp-" + run + "-%", taxClassB));
        assertEquals(500, count("SELECT count(*) FROM commerce_variant WHERE institute_id = ? AND sku LIKE ?", instB, "I" + run + "-%"));
        assertEquals(600, count("SELECT count(*) FROM commerce_product_translation WHERE institute_id = ? AND package_id IN "
                + "(SELECT package_id FROM commerce_product WHERE institute_id = ? AND slug LIKE ?)", instB, instB, "imp-" + run + "-%"));
        sql("one imported product with two sizes", "SELECT p.slug, p.status, p.external_ref, v.sku, v.external_ref AS variant_ref, v.weight_grams, pl.actual_price, pl.elevated_price "
                + "FROM commerce_product p JOIN commerce_variant v ON v.package_id = p.package_id "
                + "JOIN package_session_learner_invitation_to_payment_option l ON l.package_session_id = v.package_session_id "
                + "JOIN payment_plan pl ON pl.payment_option_id = l.payment_option_id WHERE p.institute_id = ? AND p.slug = ? ORDER BY v.sku", instB, "imp-" + run + "-7");
        assertEquals(0, count("SELECT count(*) FROM commerce_import_job_file WHERE institute_id = ?", instB), "a clean job keeps no file");
        // The public shop of B now lists them (its own earlier product included).
        snapshotLoader.evict(instB);
        assertEquals(301, storefront.list(instB, query(null, null, null, 1, 24, false, "en")).getTotal());
        assertEquals(300, storefront.list(instB, query(null, Map.of("fabric", List.of("khadi")), null, 1, 24, false, "en")).getTotal());

        // The same file again: nothing new.
        Map<String, Long> afterFirst = rowCounts();
        ImportValidationResponse recheck = importService.validate(instB, "products.csv", file);
        assertEquals(0, recheck.getProductsToCreate());
        assertEquals(300, recheck.getProductsToUpdate());
        assertEquals(0, recheck.getVariantsToCreate());
        ImportJobResponse second = runImport("products.csv", file);
        note("-- second run of the same file: " + json.writeValueAsString(second));
        assertEquals("COMPLETED", second.getStatus(), String.valueOf(second.getIssues()));
        assertEquals(0, second.getProductsCreated());
        assertEquals(0, second.getVariantsCreated());
        assertEquals(300, second.getProductsUpdated());
        assertEquals(0, second.getProductsFailed());
        Map<String, Long> afterSecond = rowCounts();
        for (String table : WRITTEN_TABLES) {
            if (table.equals("commerce_audit") || table.equals("commerce_import_job")) {
                continue; // the run itself is recorded
            }
            assertEquals(afterFirst.get(table), afterSecond.get(table), table + " has the same number of rows after the second run");
        }
        note("-- row counts after the first run:  " + afterFirst);
        note("-- row counts after the second run: " + afterSecond);

        noDriftInTheseShops("the import");
        // One import at a time per shop is a database rule.
        assertEquals(1, count("SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_commerce_import_job_active'"));
    }

    @Test
    @Order(10)
    void import_aProductThatFailsDoesNotRollBackTheOthers() throws Exception {
        note("");
        note("== import with a product that fails while it is written");
        String bad = "bad-" + run;
        // The database refuses this one product at INSERT time: the plan cannot see it coming.
        db.execute("CREATE OR REPLACE FUNCTION proof_refuse_bad_product() RETURNS trigger AS $$ BEGIN "
                + "IF NEW.slug = '" + bad + "' THEN RAISE EXCEPTION 'proof: this product is refused by the database'; END IF; "
                + "RETURN NEW; END $$ LANGUAGE plpgsql");
        db.execute("CREATE TRIGGER proof_refuse_bad_product BEFORE INSERT ON commerce_product "
                + "FOR EACH ROW EXECUTE FUNCTION proof_refuse_bad_product()");
        List<Map<ImportColumn, String>> rows = new ArrayList<>();
        rows.add(productRow("good-one-" + run, "G1-" + run, "500"));
        rows.add(productRow(bad, "BAD-" + run, "500"));
        Map<ImportColumn, String> planError = productRow("no-collection-" + run, "NC-" + run, "500");
        planError.put(ImportColumn.COLLECTIONS, "does-not-exist");
        planError.put(ImportColumn.IMAGE_URLS, "https://old-shop.example/wp-content/x.jpg");
        rows.add(planError);
        Map<ImportColumn, String> last = productRow("good-two-" + run, "G2-" + run, "500");
        last.put(ImportColumn.IMAGE_URLS, "https://old-shop.example/wp-content/kurta.jpg|https://old-shop.example/wp-content/kurta-2.jpg");
        rows.add(last);
        byte[] file = csv(rows).getBytes(StandardCharsets.UTF_8);

        long packagesBefore = count("SELECT count(*) FROM package");
        ImportJobResponse job;
        try {
            job = runImport("mixed.csv", file);
        } finally {
            db.execute("DROP TRIGGER IF EXISTS proof_refuse_bad_product ON commerce_product");
        }
        note("-- job: " + json.writeValueAsString(job));
        assertEquals("COMPLETED_WITH_ERRORS", job.getStatus());
        assertEquals(2, job.getProductsCreated());
        assertEquals(2, job.getProductsFailed());
        assertEquals(2, job.getRowsFailed());
        assertEquals(2, job.getImageUrlsQueued());
        sql("the four products of the file", "SELECT slug, status FROM commerce_product WHERE institute_id = ? AND slug IN (?, ?, ?, ?) ORDER BY slug",
                instB, "good-one-" + run, bad, "no-collection-" + run, "good-two-" + run);
        assertEquals(2, count("SELECT count(*) FROM commerce_product WHERE institute_id = ? AND slug IN (?, ?)", instB, "good-one-" + run, "good-two-" + run));
        assertEquals(0, count("SELECT count(*) FROM commerce_product WHERE institute_id = ? AND slug IN (?, ?)", instB, bad, "no-collection-" + run));
        assertEquals(0, count("SELECT count(*) FROM commerce_variant WHERE sku IN (?, ?)", "BAD-" + run, "NC-" + run), "nothing of the failed products is left");
        assertEquals(packagesBefore + 2, count("SELECT count(*) FROM package"), "the failed product left no package row behind");
        assertEquals(2, count("SELECT count(*) FROM commerce_import_image_queue WHERE institute_id = ? AND status = 'PENDING'", instB));
        // The rows that were left out can be downloaded, with the reason.
        assertTrue(job.getErrorRowsAvailable());
        String errorRows = new String(importService.jobErrorRows(instB, job.getJobId()), StandardCharsets.UTF_8);
        assertTrue(errorRows.contains(bad) && errorRows.contains("no-collection-" + run), errorRows);
        assertFalse(errorRows.contains("good-one-" + run));
        note("-- error rows file:");
        errorRows.lines().forEach(line -> note("   " + (line.length() > 400 ? line.substring(0, 400) + "..." : line)));
        // A job of another shop is not found.
        assertThrows(RuntimeException.class, () -> importService.get(instA, job.getJobId()));
        sql("audit rows of the imports", "SELECT kind, count(*) FROM commerce_audit WHERE institute_id = ? AND kind LIKE 'IMPORT%' GROUP BY kind ORDER BY kind", instB);
    }

    // ------------------------------------------------------------------ renditions

    private Map<String, Object> renditionState(String mediaRowId) throws Exception {
        String raw = db.queryForObject("SELECT CAST(renditions_json AS TEXT) FROM commerce_product_media WHERE id = ?",
                String.class, mediaRowId);
        return raw == null ? null : json.readValue(raw, new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Object>>() { });
    }

    private Map<String, Object> waitForStatus(String mediaRowId, String status) throws Exception {
        long deadline = System.currentTimeMillis() + 30_000;
        while (true) {
            Map<String, Object> state = renditionState(mediaRowId);
            if (state != null && status.equals(state.get("_status"))) {
                return state;
            }
            assertTrue(System.currentTimeMillis() < deadline, "gallery row reached " + status + "; it is " + state);
            Thread.sleep(100);
        }
    }

    @Test
    @Order(11)
    void renditions_theStateColumnIsWrittenByTheSwapStatements_andOnlyUrlsAreShownToShoppers() throws Exception {
        note("");
        note("== rendition state on commerce_product_media");
        String mediaId = UUID.randomUUID().toString();
        ProductMediaDTO attached = productMediaService.attach(instA, actor, ProductMediaDTO.builder()
                .packageId(khadi.getPackageId()).mediaId(mediaId).altI18n(Map.of("en", "Khadi kurta")).build());
        Map<String, Object> ready = waitForStatus(attached.getId(), "READY");
        // The media service is told whom the file must belong to: this institute, or this product.
        org.mockito.Mockito.verify(renditionClient).generate(mediaId, List.of(instA, khadi.getPackageId()));
        sql("the gallery row after the upload", "SELECT media_id, kind, width, height, CAST(renditions_json AS TEXT) AS renditions_json FROM commerce_product_media WHERE id = ?", attached.getId());
        for (String width : List.of("320", "640", "960", "1600")) {
            assertEquals("https://cdn.test/COMMERCE_RENDITION/v1/" + mediaId + "/w" + width + ".webp", ready.get(width));
        }
        assertEquals(mediaId, ready.get("_media_id"));
        assertEquals(2000, db.queryForObject("SELECT width FROM commerce_product_media WHERE id = ?", Integer.class, attached.getId()));
        assertEquals(2500, db.queryForObject("SELECT height FROM commerce_product_media WHERE id = ?", Integer.class, attached.getId()));

        // A shopper sees widths and addresses, never the job state.
        snapshotLoader.evict(instA);
        StorefrontDtos.ProductDetail detail = storefront.detail(instA, khadi.getSlug(), "en");
        assertEquals(1, detail.getMedia().size());
        assertEquals(List.of(320, 640, 960, 1600),
                detail.getMedia().get(0).getRenditions().stream().map(StorefrontDtos.Rendition::getWidth).toList());
        String publicJson = json.writeValueAsString(detail);
        assertFalse(publicJson.contains("_status") || publicJson.contains("_media_id") || publicJson.contains("_attempts"), publicJson);
        note("-- public media of the product: " + json.writeValueAsString(detail.getMedia()));

        // A gallery edit does not touch the state.
        productMediaService.update(instA, actor, attached.getId(), ProductMediaDTO.builder().altI18n(Map.of("en", "Front")).build());
        assertEquals("READY", renditionState(attached.getId()).get("_status"));

        // The media service cannot be reached: the row waits for a later try.
        when(renditionClient.generate(anyString(), any())).thenThrow(new CommerceRenditionException("MEDIA_SERVICE_UNREACHABLE", true, "connection refused"));
        renditionService.retryOne(instA, actor, attached.getId());
        Map<String, Object> waiting = waitForStatus(attached.getId(), "PENDING");
        assertEquals(1, ((Number) waiting.get("_attempts")).intValue());
        assertEquals("MEDIA_SERVICE_UNREACHABLE", waiting.get("_error"));
        assertNull(waiting.get("640"), "no old address is kept");
        // A job pass (which works on every shop) leaves it alone: it is not due before its next try.
        renditionService.processDue(60, System.currentTimeMillis() + 10_000);
        assertEquals(waiting, renditionState(attached.getId()), "not due before its next try");
        note("-- media service unreachable: " + waiting);

        // The file itself is refused: FAILED at once.
        org.mockito.Mockito.reset(renditionClient);
        when(renditionClient.generate(anyString(), any())).thenThrow(new CommerceRenditionException("UNSUPPORTED_FORMAT", false, "not an image"));
        renditionService.retryOne(instA, actor, attached.getId());
        Map<String, Object> failed = waitForStatus(attached.getId(), "FAILED");
        assertEquals("UNSUPPORTED_FORMAT", failed.get("_error"));
        assertEquals(1L, renditionService.statusCounts(instA).get("FAILED"));
        note("-- file refused: " + failed);

        // Backfill queues it again and the job pass makes it READY.
        org.mockito.Mockito.reset(renditionClient);
        when(renditionClient.generate(anyString(), any())).thenAnswer(call -> renditionsOf(call.getArgument(0)));
        assertEquals(1, renditionService.requeue(instA, actor, null, false));
        assertTrue(renditionService.processDue(60, System.currentTimeMillis() + 10_000) >= 1);
        assertEquals("READY", renditionState(attached.getId()).get("_status"));
        assertEquals(1L, renditionService.statusCounts(instA).get("READY"));
        assertEquals(0, renditionService.requeue(instA, actor, null, false), "nothing to queue when all are READY");
        assertEquals(1, renditionService.requeue(instA, actor, khadi.getPackageId(), true), "force queues a READY row again");
        assertEquals("PENDING", renditionState(attached.getId()).get("_status"));
        assertTrue(renditionService.processDue(60, System.currentTimeMillis() + 10_000) >= 1);
        assertEquals("READY", renditionState(attached.getId()).get("_status"));

        // A row written without the attach call (an import) has NULL and is picked up by the job.
        String imported = UUID.randomUUID().toString();
        db.update("INSERT INTO commerce_product_media (id, institute_id, package_id, media_id, kind, position) VALUES (?, ?, ?, ?, 'IMAGE', 5)",
                imported, instA, khadi.getPackageId(), UUID.randomUUID().toString());
        assertEquals(1L, renditionService.statusCounts(instA).get("PENDING"));
        assertTrue(renditionService.processDue(60, System.currentTimeMillis() + 10_000) >= 1);
        assertEquals("READY", renditionState(imported).get("_status"));

        // Another file on the row: the old addresses go in the same save.
        String newFile = UUID.randomUUID().toString();
        productMediaService.update(instA, actor, attached.getId(), ProductMediaDTO.builder().mediaId(newFile).build());
        Map<String, Object> replaced = waitForStatus(attached.getId(), "READY");
        assertEquals(newFile, replaced.get("_media_id"));
        assertTrue(String.valueOf(replaced.get("640")).contains(newFile));
        sql("rendition audit rows", "SELECT kind, count(*) FROM commerce_audit WHERE institute_id = ? AND kind LIKE 'MEDIA_REND%' GROUP BY kind ORDER BY kind", instA);
        note("-- final state counts: " + renditionService.statusCounts(instA));
    }

    @Test
    @Order(12)
    void reviewRound3_variantLabels_detailTexts_hiddenMedia_andTheBoundedShopCopy() throws Exception {
        note("");
        note("== review round 3: variant label on the cart line, long texts per product, refused media, cache weight");

        // Two variants of one product, told apart by their option value.
        String sizeAttribute = attribute(instA, "size", "Size", "साइज़", new String[] {"m", "l"});
        ProductRequest request = ProductRequest.builder().slug("sized-kurta-" + run)
                .translations(List.of(
                        ProductTranslationDTO.builder().locale("hi").name("नाप वाला कुर्ता " + run)
                                .descriptionHtml("<p>हिंदी विवरण</p>")
                                .contentBlocks(List.of(Map.of("code", "care", "html", "<p>ठंडे पानी में धोएं</p>"))).build(),
                        ProductTranslationDTO.builder().locale("en").name("Sized Kurta " + run)
                                .descriptionHtml("<p>English description</p><script>alert(1)</script>")
                                .contentBlocks(List.of(Map.of("code", "care", "html", "<p>Wash cold</p>"),
                                        Map.of("code", "story", "html", "<p>Woven by hand</p>"))).build()))
                .taxClassId(taxClassA).status("ACTIVE").optionAttributeIds(List.of(sizeAttribute))
                .variants(List.of(
                        VariantRequest.builder().sku("SK-M-" + run).price(new BigDecimal("900.00")).weightGrams(250)
                                .optionValues(Map.of(sizeAttribute, valueIds.get("size=m"))).build(),
                        VariantRequest.builder().sku("SK-L-" + run).price(new BigDecimal("900.00")).weightGrams(250)
                                .optionValues(Map.of(sizeAttribute, valueIds.get("size=l"))).build()))
                .build();
        ProductResponse sized = productService.save(instA, actor, request);
        String m = sized.getVariants().get(0).getPackageSessionId();
        String l = sized.getVariants().get(1).getPackageSessionId();
        receive(m, 10);
        receive(l, 10);
        sql("what the variants are called in the legacy row (the SKU)",
                "SELECT v.sku, ps.name FROM commerce_variant v JOIN package_session ps ON ps.id = v.package_session_id "
                        + "WHERE v.package_id = ? ORDER BY v.sku", sized.getPackageId());

        CartPriceRequest both = cart("208001", null, "PREPAID");
        both.setLocale("en");
        both.setLines(List.of(CartPriceRequest.Line.builder().variantId(m).quantity(1).build(),
                CartPriceRequest.Line.builder().variantId(l).quantity(1).build()));
        CommerceOrderService.CartPrice priced = orderService.priceCart(instA, both);
        assertEquals(List.of("Sized Kurta " + run + " - m", "Sized Kurta " + run + " - l"),
                priced.view().getLines().stream().map(CartPriceDtos.Line::getName).toList());
        assertEquals(List.of("m", "l"),
                priced.view().getLines().stream().map(CartPriceDtos.Line::getVariantLabel).toList());
        assertEquals("Sized Kurta " + run + " - m", priced.snapshot().getLines().get(0).getName());
        assertEquals("Sized Kurta " + run + " - l", priced.snapshot().getTaxRequest().getLines().get(1).getDescription(),
                "the tax line, which the invoice line prints, names the variant");
        note("-- cart lines: " + priced.view().getLines().stream().map(CartPriceDtos.Line::getName).toList());

        // The stock count of a variant between the low threshold and the shop maximum stays private.
        CartPriceDtos.UnavailableLine twelve = orderService.priceCart(instA, CartPriceRequest.builder().lines(List.of(
                CartPriceRequest.Line.builder().variantId(m).quantity(12).build())).build()).view().getUnavailable().get(0);
        assertEquals("INSUFFICIENT_STOCK", twelve.getReason());
        assertNull(twelve.getAvailableQuantity(), "10 on hand is above the threshold of 3 and is not told");

        // The shop copy carries no long text; the product page reads it per product.
        snapshotLoader.evict(instA);
        var inCopy = snapshotLoader.snapshot(instA).bySlug().get(sized.getSlug());
        assertNull(inCopy.translations().get("en").descriptionHtml(), "no description in the shop copy");
        assertTrue(inCopy.translations().get("en").contentBlocks().isEmpty(), "no content blocks in the shop copy");
        StorefrontDtos.ProductDetail en = storefront.detail(instA, sized.getSlug(), "en");
        assertTrue(en.getDescriptionHtml().contains("English description"), "read per product: " + en.getDescriptionHtml());
        assertFalse(en.getDescriptionHtml().contains("alert(1)") || en.getDescriptionHtml().contains("<script"),
                "and sanitised: " + en.getDescriptionHtml());
        assertEquals(List.of("care", "story"), en.getContentBlocks().stream().map(StorefrontDtos.ContentBlock::getCode).toList());
        StorefrontDtos.ProductDetail hi = storefront.detail(instA, sized.getSlug(), "hi");
        assertTrue(hi.getDescriptionHtml().contains("हिंदी विवरण"));
        assertEquals(List.of("care"), hi.getContentBlocks().stream().map(StorefrontDtos.ContentBlock::getCode).toList());
        assertEquals(List.of("m", "l"), en.getVariants().stream().map(StorefrontDtos.Variant::getLabel).toList());
        note("-- detail of " + sized.getSlug() + ": description and " + en.getContentBlocks().size()
                + " content blocks read per product; the shop copy of " + snapshotLoader.snapshot(instA).products().size()
                + " products holds neither");

        // A gallery row whose file the media service refused (not this shop's product image) is never shown.
        String refusedFile = UUID.randomUUID().toString();
        when(renditionClient.generate(anyString(), any())).thenThrow(
                new CommerceRenditionException("NOT_PUBLIC", false, "this file cannot be used as a product image"));
        ProductMediaDTO refused = productMediaService.attach(instA, actor, ProductMediaDTO.builder()
                .packageId(sized.getPackageId()).mediaId(refusedFile).build());
        Map<String, Object> state = waitForStatus(refused.getId(), "FAILED");
        assertEquals("NOT_PUBLIC", state.get("_error"));
        snapshotLoader.evict(instA);
        String detailJson = json.writeValueAsString(storefront.detail(instA, sized.getSlug(), "en"));
        assertFalse(detailJson.contains(refusedFile), "a refused file is not in the public product");
        String listJson = json.writeValueAsString(storefront.list(instA, query("sized kurta", null, null, 1, 24, false, "en")));
        assertFalse(listJson.contains(refusedFile), "nor on its card");
        note("-- gallery row refused as NOT_PUBLIC: " + state + "; absent from the public card and product page");
        org.mockito.Mockito.reset(renditionClient);
        when(renditionClient.generate(anyString(), any())).thenAnswer(call -> renditionsOf(call.getArgument(0)));
    }
}
