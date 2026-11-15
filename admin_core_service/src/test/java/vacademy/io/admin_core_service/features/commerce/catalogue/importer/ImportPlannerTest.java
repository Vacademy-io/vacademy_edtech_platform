package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportIssue;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlanner;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ProductInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.VariantInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ProductPlan;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.SAMPLE_CSV;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.reference;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.row;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.utf8;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn.*;

class ImportPlannerTest {

    private final ImportPlanner planner = new ImportPlanner();

    // ------------------------------------------------------------ the sample

    @Test
    void theSampleBecomesTwoNewProductsWithResolvedIds() {
        ImportPlan plan = planner.plan(new ImportFileParser().parse("s.csv", utf8(SAMPLE_CSV)).rows(), reference());

        assertEquals(2, plan.products().size());
        assertEquals(2, plan.productsToCreate());
        assertEquals(0, plan.productsToUpdate());
        assertEquals(3, plan.variantsToCreate());
        assertTrue(plan.blockedRows().isEmpty(), plan.issues().toString());

        ProductPlan kurta = plan.products().get(0);
        ProductRequest request = kurta.getRequest();
        assertEquals("khadi-kurta", request.getSlug());
        assertEquals("woo-1", request.getExternalRef());
        assertEquals("tax-1", request.getTaxClassId());
        assertEquals("DRAFT", request.getStatus());
        assertEquals(List.of("col-kurtas", "col-new"), request.getCollectionIds());
        assertEquals(List.of("val-khadi"), request.getAttributeValueIds());
        assertEquals(List.of("attr-size"), request.getOptionAttributeIds());
        assertEquals("hi", request.getTranslations().get(0).getLocale(), "Hindi is first: it names the legacy row");
        assertEquals("खादी कुर्ता", request.getTranslations().get(0).getName());
        assertEquals("हाथ से काता, हाथ से बुना", request.getTranslations().get(0).getShortDescription());
        assertEquals("Khadi Kurta", request.getTranslations().get(1).getName());
        assertEquals(List.of("media-1", "media-2"), kurta.getGalleryMediaIds());
        assertEquals(List.of("https://old-shop.example/a.jpg"), kurta.getImageUrls());

        VariantRequest medium = request.getVariants().get(0);
        assertEquals("KK-M", medium.getSku());
        assertEquals(new BigDecimal("1350"), medium.getPrice());
        assertEquals(new BigDecimal("1500"), medium.getMrp());
        assertEquals(250, medium.getWeightGrams());
        assertEquals("8901234567890", medium.getBarcode());
        assertEquals(Map.of("attr-size", "val-m"), medium.getOptionValues());
        assertNull(medium.getPackageSessionId());
        VariantRequest large = request.getVariants().get(1);
        assertEquals(new BigDecimal("1350.50"), large.getPrice());
        assertEquals(Map.of("attr-size", "val-l"), large.getOptionValues());

        ProductPlan saree = plan.products().get(1);
        assertEquals("सूती-साड़ी", saree.getHandle());
        assertEquals(1, saree.getRequest().getTranslations().size());
        assertNull(saree.getRequest().getOptionAttributeIds());
        assertTrue(codes(saree, ImportIssue.WARNING).contains("NO_LEAD_PHOTO"));
        assertTrue(codes(kurta, ImportIssue.WARNING).contains("IMAGE_URLS_QUEUED"));
    }

    // --------------------------------------------------------------- grouping

    @Test
    void rowsWithTheSameHandleAreOneProductWhereverTheyStand() {
        ImportPlan plan = planner.plan(List.of(
                row(2, HANDLE, "kurta", NAME_EN, "Kurta", OPTION1_NAME, "size", SKU, "K-M", OPTION1_VALUE, "m"),
                row(3, HANDLE, "saree", NAME_EN, "Saree", SKU, "S-1"),
                row(4, HANDLE, "KURTA", SKU, "K-L", OPTION1_VALUE, "l")), reference());

        assertEquals(2, plan.products().size());
        ProductPlan kurta = plan.products().get(0);
        assertEquals("kurta", kurta.getHandle());
        assertEquals(List.of(2, 4), kurta.getRows().stream().map(ImportRow::rowNumber).toList());
        assertEquals(2, kurta.getRequest().getVariants().size());
        assertEquals(3, plan.rowsTotal());
    }

    @Test
    void aProductRowFollowedByVariantRowsIsOneProduct() {
        ImportPlan plan = planner.plan(List.of(
                row(2, HANDLE, "kurta", NAME_HI, "कुर्ता", OPTION1_NAME, "size"),
                row(3, HANDLE, "kurta", SKU, "K-M", OPTION1_VALUE, "m", PRICE, "100"),
                row(4, HANDLE, "kurta", SKU, "K-L", OPTION1_VALUE, "l", PRICE, "100")), reference());

        ProductPlan kurta = plan.products().get(0);
        assertFalse(kurta.hasErrors(), kurta.getIssues().toString());
        assertEquals(2, kurta.getRequest().getVariants().size());
        assertEquals(2, kurta.getVariantsToCreate());
    }

    @Test
    void aProductWithNoVariantRowIsStillPlanned() {
        ProductPlan plan = only(row(2, HANDLE, "kurta", NAME_EN, "Kurta"));
        assertFalse(plan.hasErrors());
        assertNull(plan.getRequest().getVariants());
    }

    @Test
    void productColumnsMayRepeatButNotDiffer() {
        ProductPlan same = planner.plan(List.of(
                row(2, HANDLE, "kurta", NAME_EN, "Kurta", BRAND, "CC", OPTION1_NAME, "size", SKU, "A", OPTION1_VALUE, "m"),
                row(3, HANDLE, "kurta", NAME_EN, "Kurta", BRAND, "CC", OPTION1_NAME, "size", SKU, "B", OPTION1_VALUE, "l")),
                reference()).products().get(0);
        assertFalse(same.hasErrors(), same.getIssues().toString());

        ProductPlan differs = planner.plan(List.of(
                row(2, HANDLE, "kurta", NAME_EN, "Kurta", OPTION1_NAME, "size", SKU, "A", OPTION1_VALUE, "m"),
                row(3, HANDLE, "kurta", NAME_EN, "Kurta 2", OPTION1_NAME, "size", SKU, "B", OPTION1_VALUE, "l")),
                reference()).products().get(0);
        assertError(differs, 3, NAME_EN, "CONFLICT");
        assertNull(differs.getRequest(), "a product with an error has nothing to write");
    }

    @Test
    void aRowWithoutAHandleIsItsOwnFailure() {
        ImportPlan plan = planner.plan(List.of(
                row(2, NAME_EN, "Kurta", SKU, "A"),
                row(3, HANDLE, "saree", NAME_EN, "Saree", SKU, "S-1")), reference());
        assertEquals(2, plan.products().size());
        assertError(plan.products().get(0), 2, HANDLE, "REQUIRED");
        assertFalse(plan.products().get(1).hasErrors());
        assertEquals(java.util.Set.of(2), plan.blockedRows());
    }

    // ----------------------------------------------------------- idempotency

    @Test
    void aProductKnownByExternalRefIsAnUpdateAndItsVariantsAreMatched() {
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "khadi-kurta", "woo-1", "tax-1", "QUANTITY", "PCS", 1, "DRAFT", false))
                .addVariant(new VariantInfo("ps-m", "pkg-1", "KK-M", "8901234567890", null, "TRACKED", "ACTIVE"))
                .addVariant(new VariantInfo("ps-l", "pkg-1", "KK-L", null, null, "TRACKED", "ACTIVE"))
                .addProduct(new ProductInfo("pkg-2", "सूती-साड़ी", "woo-2", null, "QUANTITY", "PCS", 1, "DRAFT", false))
                .addVariant(new VariantInfo("ps-s", "pkg-2", "SS-1", null, null, "TRACKED", "ACTIVE"));

        ImportPlan plan = planner.plan(new ImportFileParser().parse("s.csv", utf8(SAMPLE_CSV)).rows(), ref);

        assertTrue(plan.blockedRows().isEmpty(), plan.issues().toString());
        assertEquals(0, plan.productsToCreate());
        assertEquals(2, plan.productsToUpdate());
        assertEquals(0, plan.variantsToCreate());
        assertEquals(3, plan.variantsToUpdate());
        ProductPlan kurta = plan.products().get(0);
        assertEquals("pkg-1", kurta.getExistingPackageId());
        assertEquals("ps-m", kurta.getRequest().getVariants().get(0).getPackageSessionId());
        assertEquals("ps-l", kurta.getRequest().getVariants().get(1).getPackageSessionId());
    }

    @Test
    void withoutExternalRefTheHandleFindsTheProduct() {
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "kurta", null, null, "QUANTITY", "PCS", 1, "DRAFT", false))
                .addVariant(new VariantInfo("ps-1", "pkg-1", "K-1", null, "v-1", "TRACKED", "ACTIVE"));

        ProductPlan plan = planner.plan(List.of(
                row(2, HANDLE, "kurta", SKU, "K-1-NEW", VARIANT_EXTERNAL_REF, "v-1", PRICE, "500")), ref)
                .products().get(0);

        assertFalse(plan.hasErrors(), plan.getIssues().toString());
        assertEquals("pkg-1", plan.getExistingPackageId());
        assertNull(plan.getRequest().getTranslations(), "blank name cells leave the stored names alone");
        assertEquals("ps-1", plan.getRequest().getVariants().get(0).getPackageSessionId(),
                "matched by variant_external_ref, so the sku is renamed, not duplicated");
        assertEquals(1, plan.getVariantsToUpdate());
    }

    @Test
    void aHandleOwnedByAnotherProductIsRefused() {
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "kurta", "old-9", null, "QUANTITY", "PCS", 1, "DRAFT", false));
        assertError(planner.plan(List.of(row(2, HANDLE, "kurta", EXTERNAL_REF, "woo-1", NAME_EN, "Kurta")), ref)
                .products().get(0), 2, HANDLE, "HANDLE_TAKEN");
    }

    @Test
    void aKnownProductMayChangeItsHandle() {
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "old-kurta", "woo-1", null, "QUANTITY", "PCS", 1, "DRAFT", false));
        ProductPlan plan = planner.plan(List.of(row(2, HANDLE, "new-kurta", EXTERNAL_REF, "woo-1")), ref)
                .products().get(0);
        assertFalse(plan.hasErrors(), plan.getIssues().toString());
        assertEquals("pkg-1", plan.getExistingPackageId());
        assertEquals("new-kurta", plan.getRequest().getSlug());
    }

    // ------------------------------------------------------- validation rules

    @Test
    void handleRules() {
        assertError(only(row(2, HANDLE, "khadi kurta!", NAME_EN, "K")), 2, HANDLE, "INVALID");
        assertError(only(row(2, HANDLE, "-kurta", NAME_EN, "K")), 2, HANDLE, "INVALID");

        List<ImportRow> many = new ArrayList<>();
        for (int i = 0; i <= ImportLimits.MAX_ROWS_PER_PRODUCT; i++) {
            many.add(row(i + 2, HANDLE, "kurta", NAME_EN, "K"));
        }
        assertError(planner.plan(many, reference()).products().get(0), 2, HANDLE, "TOO_MANY_ROWS");
    }

    @Test
    void nameRules() {
        assertError(only(row(2, HANDLE, "kurta", SKU, "A")), 2, NAME_HI, "REQUIRED");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", SHORT_DESCRIPTION_HI, "विवरण")), 2, NAME_HI, "REQUIRED");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "x".repeat(256))), 2, NAME_EN, "INVALID");

        ProductPlan englishOnly = only(row(2, HANDLE, "kurta", NAME_EN, "Kurta"));
        assertFalse(englishOnly.hasErrors());
        assertTrue(codes(englishOnly, ImportIssue.WARNING).contains("MISSING_HINDI_NAME"));
        assertFalse(codes(only(row(2, HANDLE, "kurta", NAME_HI, "कुर्ता")), ImportIssue.WARNING)
                .contains("MISSING_HINDI_NAME"));
    }

    @Test
    void externalRefRules() {
        ImportPlan plan = planner.plan(List.of(
                row(2, HANDLE, "kurta", EXTERNAL_REF, "woo-1", NAME_EN, "Kurta"),
                row(3, HANDLE, "saree", EXTERNAL_REF, "woo-1", NAME_EN, "Saree")), reference());
        assertFalse(plan.products().get(0).hasErrors());
        assertError(plan.products().get(1), 3, EXTERNAL_REF, "DUPLICATE_EXTERNAL_REF");
        assertError(only(row(2, HANDLE, "kurta", EXTERNAL_REF, "x".repeat(256), NAME_EN, "K")), 2, EXTERNAL_REF, "INVALID");
    }

    @Test
    void taxClassAndHsnRules() {
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", TAX_CLASS_CODE, "nope")), 2, TAX_CLASS_CODE, "UNKNOWN_TAX_CLASS");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", HSN, "6205")), 2, HSN, "HSN_WITHOUT_TAX_CLASS");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", TAX_CLASS_CODE, "garments", HSN, "5208")), 2, HSN, "HSN_MISMATCH");
        assertFalse(only(row(2, HANDLE, "kurta", NAME_EN, "K", TAX_CLASS_CODE, "GARMENTS", HSN, "6205")).hasErrors());
    }

    @Test
    void anActiveProductNeedsATaxClassInRegularModeOnly() {
        ImportRow active = row(2, HANDLE, "kurta", NAME_EN, "K", STATUS, "active", SKU, "A", PRICE, "100");
        assertFalse(planner.plan(List.of(active), reference()).products().get(0).hasErrors());

        ProductPlan regular = planner.plan(List.of(active), reference().taxClassRequiredToPublish(true))
                .products().get(0);
        assertError(regular, 2, TAX_CLASS_CODE, "MISSING_TAX_CLASS");

        ImportRow withTax = row(2, HANDLE, "kurta", NAME_EN, "K", STATUS, "ACTIVE", SKU, "A", PRICE, "100",
                TAX_CLASS_CODE, "garments");
        assertFalse(planner.plan(List.of(withTax), reference().taxClassRequiredToPublish(true))
                .products().get(0).hasErrors());
    }

    @Test
    void anActiveProductNeedsAPricedActiveVariant() {
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", STATUS, "ACTIVE", SKU, "A")), 2, PRICE, "PRICE_REQUIRED");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", STATUS, "ACTIVE", SKU, "A", PRICE, "0")), 2, PRICE, "PRICE_REQUIRED");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", STATUS, "ACTIVE")), 2, STATUS, "NO_ACTIVE_VARIANT");

        ProductPlan draft = only(row(2, HANDLE, "kurta", NAME_EN, "K", SKU, "A"));
        assertFalse(draft.hasErrors());
        assertTrue(codes(draft, ImportIssue.WARNING).contains("NO_PRICE"));
    }

    @Test
    void statusAndEnumRules() {
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", STATUS, "LIVE")), 2, STATUS, "INVALID");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", STOCK_MODE, "ROLL")), 2, STOCK_MODE, "INVALID");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", SKU, "A", STOCK_POLICY, "MAYBE")), 2, STOCK_POLICY, "INVALID");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", SKU, "A", VARIANT_STATUS, "GONE")), 2, VARIANT_STATUS, "INVALID");
        assertError(only(row(2, HANDLE, "kurta", NAME_EN, "K", STOCK_MODE, "PIECE", SKU, "A", STOCK_POLICY, "UNTRACKED")),
                2, STOCK_POLICY, "INVALID");
    }

    @Test
    void measuredGoodsRules() {
        ProductPlan fabric = only(row(2, HANDLE, "khadi-than", NAME_EN, "Khadi fabric", UNIT, "mtr", QTY_SCALE, "10",
                QTY_STEP, "5", SKU, "KF-1", PRICE, "45"));
        assertFalse(fabric.hasErrors(), fabric.getIssues().toString());
        assertEquals("MTR", fabric.getRequest().getUnit());
        assertEquals(10, fabric.getRequest().getQtyScale());
        assertEquals(5, fabric.getRequest().getQtyStep());
        // The file says 45 a metre; one base unit is a tenth of a metre.
        assertEquals(0, new BigDecimal("4.50").compareTo(fabric.getRequest().getVariants().get(0).getPrice()));

        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", QTY_SCALE, "0")), 2, QTY_SCALE, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", QTY_STEP, "1.5")), 2, QTY_STEP, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", UNIT, "x".repeat(33))), 2, UNIT, "INVALID");

        ImportReferenceData published = reference()
                .addProduct(new ProductInfo("pkg-1", "khadi-than", null, null, "QUANTITY", "MTR", 10, "ACTIVE", true));
        ProductPlan changed = planner.plan(List.of(row(2, HANDLE, "khadi-than", QTY_SCALE, "100", UNIT, "MTR")),
                published).products().get(0);
        assertError(changed, 2, QTY_SCALE, "MEASURE_LOCKED");
        assertEquals(1, changed.getIssues().stream().filter(ImportIssue::isError).count(),
                "the unchanged unit is not an error");
    }

    @Test
    void originLocationRules() {
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", ORIGIN_LOCATION_CODE, "NOWHERE")), 2, ORIGIN_LOCATION_CODE, "UNKNOWN_LOCATION");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", ORIGIN_LOCATION_CODE, "SHOP")), 2, ORIGIN_LOCATION_CODE, "NOT_A_SOURCE");
        assertEquals("loc-1", only(row(2, HANDLE, "k", NAME_EN, "K", ORIGIN_LOCATION_CODE, "workshop1"))
                .getRequest().getOriginLocationId());
    }

    @Test
    void collectionRules() {
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", COLLECTIONS, "women/kurtas")), 2, COLLECTIONS, "UNKNOWN_COLLECTION");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", COLLECTIONS, "sarees")), 2, COLLECTIONS, "UNKNOWN_COLLECTION");
        assertEquals(List.of("col-kurtas", "col-men"),
                only(row(2, HANDLE, "k", NAME_EN, "K", COLLECTIONS, "kurtas | men > kurtas | men"))
                        .getRequest().getCollectionIds(), "a bare slug, a full path and a repeat");
    }

    @Test
    void attributeRules() {
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", ATTRIBUTES, "weave=plain")), 2, ATTRIBUTES, "UNKNOWN_ATTRIBUTE");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", ATTRIBUTES, "fabric=silk")), 2, ATTRIBUTES, "UNKNOWN_ATTRIBUTE_VALUE");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", ATTRIBUTES, "fabric")), 2, ATTRIBUTES, "INVALID");
        assertEquals(List.of("val-khadi", "val-m"),
                only(row(2, HANDLE, "k", NAME_EN, "K", ATTRIBUTES, "Fabric=Khadi|size:m")).getRequest().getAttributeValueIds());
    }

    @Test
    void optionRules() {
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", OPTION1_NAME, "weave", SKU, "A", OPTION1_VALUE, "x")),
                2, OPTION1_NAME, "UNKNOWN_ATTRIBUTE");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", OPTION2_NAME, "size", SKU, "A", OPTION2_VALUE, "m")),
                2, OPTION2_NAME, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", OPTION1_NAME, "size", OPTION2_NAME, "size", SKU, "A",
                OPTION1_VALUE, "m", OPTION2_VALUE, "m")), 2, OPTION2_NAME, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", OPTION1_NAME, "size", SKU, "A", OPTION1_VALUE, "xxl")),
                2, OPTION1_VALUE, "UNKNOWN_ATTRIBUTE_VALUE");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", OPTION1_NAME, "size", SKU, "A")), 2, OPTION1_VALUE, "REQUIRED");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", OPTION1_VALUE, "m")), 2, OPTION1_VALUE, "OPTION_WITHOUT_NAME");

        ImportPlan sameValues = planner.plan(List.of(
                row(2, HANDLE, "k", NAME_EN, "K", OPTION1_NAME, "size", SKU, "A", OPTION1_VALUE, "m"),
                row(3, HANDLE, "k", SKU, "B", OPTION1_VALUE, "M")), reference());
        assertError(sameValues.products().get(0), 3, OPTION1_VALUE, "DUPLICATE_OPTION_VALUES");

        ImportPlan noOptions = planner.plan(List.of(
                row(2, HANDLE, "k", NAME_EN, "K", SKU, "A"),
                row(3, HANDLE, "k", SKU, "B")), reference());
        assertError(noOptions.products().get(0), 3, OPTION1_VALUE, "OPTIONS_REQUIRED");

        ImportPlan archivedTwin = planner.plan(List.of(
                row(2, HANDLE, "k", NAME_EN, "K", SKU, "A"),
                row(3, HANDLE, "k", SKU, "B", VARIANT_STATUS, "ARCHIVED")), reference());
        assertFalse(archivedTwin.products().get(0).hasErrors(), "an archived variant does not count");
    }

    @Test
    void skuAndBarcodeRules() {
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", PRICE, "100")), 2, SKU, "REQUIRED");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "x".repeat(101))), 2, SKU, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", BARCODE, "9".repeat(101))), 2, BARCODE, "INVALID");

        ImportPlan inFile = planner.plan(List.of(
                row(2, HANDLE, "kurta", NAME_EN, "Kurta", SKU, "SAME", BARCODE, "111"),
                row(3, HANDLE, "saree", NAME_EN, "Saree", SKU, "SAME", BARCODE, "111")), reference());
        assertFalse(inFile.products().get(0).hasErrors(), "the first use is fine");
        assertError(inFile.products().get(1), 3, SKU, "DUPLICATE_SKU");
        assertError(inFile.products().get(1), 3, BARCODE, "DUPLICATE_BARCODE");

        ImportReferenceData taken = reference()
                .addProduct(new ProductInfo("pkg-9", "other", null, null, "QUANTITY", "PCS", 1, "DRAFT", false))
                .addVariant(new VariantInfo("ps-9", "pkg-9", "TAKEN", "222", null, "TRACKED", "ACTIVE"));
        ProductPlan inShop = planner.plan(List.of(row(2, HANDLE, "kurta", NAME_EN, "Kurta", SKU, "TAKEN", BARCODE, "222")),
                taken).products().get(0);
        assertError(inShop, 2, SKU, "DUPLICATE_SKU");
        assertError(inShop, 2, BARCODE, "DUPLICATE_BARCODE");

        ImportPlan sameVariantTwice = planner.plan(List.of(
                row(2, HANDLE, "other", SKU, "TAKEN"),
                row(3, HANDLE, "other", SKU, "NEW", VARIANT_EXTERNAL_REF, "v")), taken);
        assertFalse(sameVariantTwice.products().get(0).hasErrors(), "its own sku is not a duplicate");
    }

    @Test
    void priceAndNumberRules() {
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", PRICE, "1500", MRP, "1350")), 2, MRP, "MRP_BELOW_PRICE");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", PRICE, "1,350")), 2, PRICE, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", PRICE, "-5")), 2, PRICE, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", PRICE, "10.999")), 2, PRICE, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", MRP, "abc")), 2, MRP, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", WEIGHT_GRAMS, "0.5")), 2, WEIGHT_GRAMS, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", LENGTH_MM, "-1")), 2, LENGTH_MM, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", LEAD_TIME_DAYS, "soon")), 2, LEAD_TIME_DAYS, "INVALID");
        ProductPlan fine = only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", PRICE, "1350", MRP, "1350", WEIGHT_GRAMS, "0"));
        assertFalse(fine.hasErrors());
        assertEquals(0, fine.getRequest().getVariants().get(0).getWeightGrams());
    }

    @Test
    void anExistingVariantKeepsItsStockPolicy() {
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "kurta", null, null, "QUANTITY", "PCS", 1, "DRAFT", false))
                .addVariant(new VariantInfo("ps-1", "pkg-1", "K-1", null, null, "TRACKED", "ACTIVE"));
        assertError(planner.plan(List.of(row(2, HANDLE, "kurta", SKU, "K-1", STOCK_POLICY, "UNTRACKED")), ref)
                .products().get(0), 2, STOCK_POLICY, "POLICY_LOCKED");
        assertFalse(planner.plan(List.of(row(2, HANDLE, "kurta", SKU, "K-1", STOCK_POLICY, "tracked")), ref)
                .products().get(0).hasErrors());
    }

    @Test
    void imageRules() {
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", IMAGE_MEDIA_IDS, "ok-1|../../etc/passwd")), 2, IMAGE_MEDIA_IDS, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", SKU, "A", VARIANT_IMAGE_MEDIA_ID, "https://x.example/a.jpg")),
                2, VARIANT_IMAGE_MEDIA_ID, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", IMAGE_URLS, "file:///etc/passwd")), 2, IMAGE_URLS, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", IMAGE_URLS, "ftp://old.example/a.jpg")), 2, IMAGE_URLS, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", IMAGE_URLS, "https://user:pw@old.example/a.jpg")), 2, IMAGE_URLS, "INVALID");
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", IMAGE_URLS, "javascript:alert(1)")), 2, IMAGE_URLS, "INVALID");

        // An address of the internal network is shape-valid and is only stored: nothing here opens it.
        ProductPlan queued = only(row(2, HANDLE, "k", NAME_EN, "K",
                IMAGE_URLS, "https://old.example/a.jpg|http://169.254.169.254/latest https://old.example/a.jpg"));
        assertFalse(queued.hasErrors());
        assertEquals(List.of("https://old.example/a.jpg", "http://169.254.169.254/latest"), queued.getImageUrls());
        assertTrue(codes(queued, ImportIssue.WARNING).contains("IMAGE_URLS_QUEUED"));
        assertFalse(codes(queued, ImportIssue.WARNING).contains("NO_LEAD_PHOTO"));

        StringBuilder tooMany = new StringBuilder();
        for (int i = 0; i <= ImportLimits.MAX_IMAGES_PER_PRODUCT; i++) {
            tooMany.append("m").append(i).append('|');
        }
        assertError(only(row(2, HANDLE, "k", NAME_EN, "K", IMAGE_MEDIA_IDS, tooMany.toString())), 2, IMAGE_MEDIA_IDS, "TOO_MANY_IMAGES");
    }

    // ------------------------------------------------------------------ helpers

    private ProductPlan only(ImportRow row) {
        return planner.plan(List.of(row), reference()).products().get(0);
    }

    private static List<String> codes(ProductPlan plan, String severity) {
        return plan.getIssues().stream().filter(i -> severity.equals(i.getSeverity())).map(ImportIssue::getCode).toList();
    }

    private static void assertError(ProductPlan plan, int row, ImportColumn column, String code) {
        boolean found = plan.getIssues().stream().anyMatch(i -> i.isError() && i.getRow() == row
                && column.header().equals(i.getColumn()) && code.equals(i.getCode()));
        assertTrue(found, "expected " + code + " on row " + row + " column " + column.header() + " but got "
                + plan.getIssues());
        assertTrue(plan.hasErrors());
    }

    @Test
    void thePriceOfMeasuredGoodsIsReadPerUnitAndStoredPerBaseUnit() {
        // Cloth at 450 a metre with an MRP of 500, sold in tenths of a metre.
        ProductPlan fabric = only(row(2, HANDLE, "khadi-than", NAME_EN, "Khadi fabric", UNIT, "MTR", QTY_SCALE, "10",
                QTY_STEP, "5", SKU, "KF-1", PRICE, "450", MRP, "500"));
        assertFalse(fabric.hasErrors(), fabric.getIssues().toString());
        VariantRequest variant = fabric.getRequest().getVariants().get(0);
        assertEquals(0, new BigDecimal("45.00").compareTo(variant.getPrice()), "2.5 m then cost 1,125, not 11,250");
        assertEquals(0, new BigDecimal("50.00").compareTo(variant.getMrp()));

        // 449.99 a metre has no price to the paisa for a tenth of a metre.
        assertError(only(row(2, HANDLE, "khadi-than", NAME_EN, "Khadi fabric", UNIT, "MTR", QTY_SCALE, "10",
                SKU, "KF-1", PRICE, "449.99")), 2, PRICE, "PRICE_NOT_DIVISIBLE");

        // An existing measured product keeps its scale when the file leaves the column out.
        ImportReferenceData ref = reference()
                .addProduct(new ProductInfo("pkg-1", "khadi-than", null, null, "QUANTITY", "MTR", 10, "DRAFT", false));
        ProductPlan update = planner.plan(List.of(row(2, HANDLE, "khadi-than", SKU, "KF-2", PRICE, "300")), ref)
                .products().get(0);
        assertFalse(update.hasErrors(), update.getIssues().toString());
        assertEquals(0, new BigDecimal("30.00").compareTo(update.getRequest().getVariants().get(0).getPrice()));

        // Goods sold by the piece are untouched.
        ProductPlan kurta = only(row(2, HANDLE, "kurta", NAME_EN, "Kurta", SKU, "K-1", PRICE, "1349.99"));
        assertEquals(new BigDecimal("1349.99"), kurta.getRequest().getVariants().get(0).getPrice());
    }

    @Test
    void careAndStoryTextComeInAsContentBlocksOfTheirLanguage() {
        ProductPlan plan = only(row(2, HANDLE, "kurta", NAME_HI, "कुर्ता", NAME_EN, "Kurta", SKU, "K-1", PRICE, "900",
                ImportColumn.BLOCK_CARE_HI, "<p>ठंडे पानी में धोएं</p>", ImportColumn.BLOCK_CARE_EN, "<p>Wash cold</p>",
                ImportColumn.BLOCK_STORY_EN, "<p>Woven by hand</p>"));
        assertFalse(plan.hasErrors(), plan.getIssues().toString());

        assertEquals(List.of(Map.of("code", "care", "html", "<p>ठंडे पानी में धोएं</p>")),
                plan.getRequest().getTranslations().get(0).getContentBlocks());
        assertEquals(List.of(Map.of("code", "care", "html", "<p>Wash cold</p>"),
                        Map.of("code", "story", "html", "<p>Woven by hand</p>")),
                plan.getRequest().getTranslations().get(1).getContentBlocks());
        // No block cell filled: nothing is sent, so stored blocks are kept as they are.
        assertNull(only(row(2, HANDLE, "kurta", NAME_EN, "Kurta", SKU, "K-1", PRICE, "900")).getRequest()
                .getTranslations().get(0).getContentBlocks());
    }
}
