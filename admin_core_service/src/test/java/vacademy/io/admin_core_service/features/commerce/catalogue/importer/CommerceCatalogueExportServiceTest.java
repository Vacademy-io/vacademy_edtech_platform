package vacademy.io.admin_core_service.features.commerce.catalogue.importer;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProductMedia;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportColumn;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportFileParser;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportLimits;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.file.ImportRow;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlan;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportPlanner;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.ProductInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.importer.plan.ImportReferenceData.VariantInfo;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductMediaRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceProductService;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.INSTITUTE;
import static vacademy.io.admin_core_service.features.commerce.catalogue.importer.ImportTestSupport.reference;

class CommerceCatalogueExportServiceTest {

    private ImportReferenceLoader loader;
    private CommerceProductService productService;
    private CommerceProductMediaRepository mediaRepository;
    private CommerceAuditService auditService;
    private CommerceCatalogueExportService service;
    private ImportReferenceData reference;

    @BeforeEach
    void setUp() {
        loader = mock(ImportReferenceLoader.class);
        productService = mock(CommerceProductService.class);
        mediaRepository = mock(CommerceProductMediaRepository.class);
        auditService = mock(CommerceAuditService.class);
        service = new CommerceCatalogueExportService(loader, productService, mediaRepository, auditService);

        reference = reference()
                .addProduct(new ProductInfo("pkg-kurta", "khadi-kurta", "woo-1", "tax-1", "QUANTITY", "PCS", 1, "ACTIVE", true))
                .addVariant(new VariantInfo("ps-m", "pkg-kurta", "KK-M", "8901234567890", "woo-1-m", "TRACKED", "ACTIVE"))
                .addVariant(new VariantInfo("ps-l", "pkg-kurta", "KK-L", null, null, "TRACKED", "ACTIVE"))
                .addProduct(new ProductInfo("pkg-draft", "a-draft", null, null, "QUANTITY", "PCS", 1, "DRAFT", false));
        when(loader.load(INSTITUTE)).thenReturn(reference);

        when(productService.get(INSTITUTE, "pkg-kurta")).thenReturn(ProductResponse.builder()
                .packageId("pkg-kurta").slug("khadi-kurta").externalRef("woo-1").status("ACTIVE")
                .stockMode("QUANTITY").unit("PCS").qtyScale(1).qtyStep(1).taxClassId("tax-1").brand("@ExampleBrand")
                .originLocationId("loc-1")
                .translations(List.of(
                        ProductTranslationDTO.builder().locale("hi").name("खादी कुर्ता")
                                .shortDescription("हाथ से काता, हाथ से बुना").build(),
                        ProductTranslationDTO.builder().locale("en").name("=HYPERLINK(\"http://evil\")")
                                .descriptionHtml("<p>Pure khadi</p>").build()))
                .optionAttributeIds(List.of("attr-size"))
                .attributeValueIds(List.of("val-khadi"))
                .collectionIds(List.of("col-kurtas", "col-new"))
                .variants(List.of(
                        VariantResponse.builder().packageSessionId("ps-m").sku("KK-M").barcode("8901234567890")
                                .externalRef("woo-1-m").name("M").stockPolicy("TRACKED").status("ACTIVE")
                                .price(BigDecimal.valueOf(1350.0)).mrp(BigDecimal.valueOf(1500.0))
                                .costPrice(new BigDecimal("777.77")).weightGrams(250)
                                .optionValues(Map.of("attr-size", "val-m")).build(),
                        VariantResponse.builder().packageSessionId("ps-l").sku("KK-L").name("L")
                                .stockPolicy("TRACKED").status("ACTIVE")
                                .price(BigDecimal.valueOf(1349.5)).mrp(BigDecimal.valueOf(1500.0))
                                .costPrice(new BigDecimal("777.77")).mediaId("media-l")
                                .optionValues(Map.of("attr-size", "val-l")).build()))
                .build());
        when(productService.get(INSTITUTE, "pkg-draft")).thenReturn(ProductResponse.builder()
                .packageId("pkg-draft").slug("a-draft").status("DRAFT").stockMode("QUANTITY").unit("PCS")
                .qtyScale(1).qtyStep(1)
                .translations(List.of(ProductTranslationDTO.builder().locale("en").name("A draft").build()))
                .build());
        CommerceProductMedia gallery = new CommerceProductMedia();
        gallery.setMediaId("media-1");
        gallery.setKind("IMAGE");
        CommerceProductMedia ofVariant = new CommerceProductMedia();
        ofVariant.setMediaId("media-l");
        ofVariant.setKind("IMAGE");
        ofVariant.setPackageSessionId("ps-l");
        when(mediaRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(INSTITUTE, "pkg-kurta"))
                .thenReturn(List.of(gallery, ofVariant));
        when(mediaRepository.findByInstituteIdAndPackageIdOrderByPositionAsc(INSTITUTE, "pkg-draft"))
                .thenReturn(List.of());
    }

    @Test
    void theExportIsTheTemplateWithOneRowPerVariantAndNoCostOrStock() throws IOException {
        byte[] file = export(null, null);
        String text = new String(file, StandardCharsets.UTF_8);

        assertFalse(text.contains("777.77"), "cost never leaves in an export");
        assertFalse(text.toLowerCase().contains("cost"));
        assertFalse(text.toLowerCase().contains("stock_level"));
        assertTrue(text.contains("'=HYPERLINK"), "a name that is a formula goes out as text");
        assertTrue(text.contains("'@ExampleBrand"));

        List<ImportRow> rows = new ImportFileParser().parse("export.csv", file).rows();
        assertEquals(3, rows.size());
        // Sorted by handle: the draft first.
        ImportRow draft = rows.get(0);
        assertEquals("a-draft", draft.get(ImportColumn.HANDLE));
        assertEquals("A draft", draft.get(ImportColumn.NAME_EN));
        assertNull(draft.get(ImportColumn.SKU), "a product without variants is a product row");

        ImportRow medium = rows.get(1);
        assertEquals("khadi-kurta", medium.get(ImportColumn.HANDLE));
        assertEquals("woo-1", medium.get(ImportColumn.EXTERNAL_REF));
        assertEquals("खादी कुर्ता", medium.get(ImportColumn.NAME_HI));
        assertEquals("=HYPERLINK(\"http://evil\")", medium.get(ImportColumn.NAME_EN));
        assertEquals("men/kurtas|new-arrivals", medium.get(ImportColumn.COLLECTIONS));
        assertEquals("fabric=khadi", medium.get(ImportColumn.ATTRIBUTES));
        assertEquals("garments", medium.get(ImportColumn.TAX_CLASS_CODE));
        assertEquals("6205", medium.get(ImportColumn.HSN));
        assertEquals("WORKSHOP1", medium.get(ImportColumn.ORIGIN_LOCATION_CODE));
        assertEquals("media-1", medium.get(ImportColumn.IMAGE_MEDIA_IDS), "the variant's own image is not gallery");
        assertEquals("size", medium.get(ImportColumn.OPTION1_NAME));
        assertEquals("m", medium.get(ImportColumn.OPTION1_VALUE));
        assertEquals("1350", medium.get(ImportColumn.PRICE));
        assertEquals("1500", medium.get(ImportColumn.MRP));
        assertEquals("8901234567890", medium.get(ImportColumn.BARCODE));
        assertEquals("250", medium.get(ImportColumn.WEIGHT_GRAMS));

        ImportRow large = rows.get(2);
        assertEquals("khadi-kurta", large.get(ImportColumn.HANDLE));
        assertNull(large.get(ImportColumn.NAME_HI), "product columns are on the first row only");
        assertEquals("l", large.get(ImportColumn.OPTION1_VALUE));
        assertEquals("1349.5", large.get(ImportColumn.PRICE));
        assertEquals("media-l", large.get(ImportColumn.VARIANT_IMAGE_MEDIA_ID));
    }

    @Test
    void anExportedFileImportsBackAsUpdatesWithoutAnError() throws IOException {
        List<ImportRow> rows = new ImportFileParser().parse("export.csv", export(null, null)).rows();

        ImportPlan plan = new ImportPlanner().plan(rows, reference);

        assertTrue(plan.blockedRows().isEmpty(), plan.issues().toString());
        assertEquals(0, plan.productsToCreate());
        assertEquals(2, plan.productsToUpdate());
        assertEquals(0, plan.variantsToCreate());
        assertEquals(2, plan.variantsToUpdate());
    }

    @Test
    void theStatusFilterAndTheIdFilterStayInsideTheInstitute() throws IOException {
        List<ImportRow> active = new ImportFileParser().parse("e.csv", export("active", null)).rows();
        assertEquals(2, active.size());
        verify(productService, never()).get(INSTITUTE, "pkg-draft");

        CommerceCatalogueExportService.Selection selection =
                service.select(INSTITUTE, null, List.of("pkg-draft", "pkg-of-another-institute"));
        assertEquals(1, selection.products().size());
        assertEquals("pkg-draft", selection.products().get(0).packageId());
        assertEquals(1, selection.expectedRows());

        assertThrows(InvalidRequestException.class, () -> service.select(INSTITUTE, "LIVE", null));
        List<String> tooMany = new ArrayList<>();
        for (int i = 0; i <= ImportLimits.MAX_EXPORT_IDS; i++) {
            tooMany.add("pkg-" + i);
        }
        assertThrows(InvalidRequestException.class, () -> service.select(INSTITUTE, null, tooMany));
    }

    @Test
    void anExportOverTheRowCapIsRefusedBeforeAnythingIsWritten() {
        ImportReferenceData big = reference();
        for (int i = 0; i <= ImportLimits.MAX_EXPORT_ROWS; i++) {
            big.addProduct(new ProductInfo("pkg-" + i, "p-" + i, null, null, "QUANTITY", "PCS", 1, "DRAFT", false));
        }
        when(loader.load(INSTITUTE)).thenReturn(big);

        InvalidRequestException e = assertThrows(InvalidRequestException.class,
                () -> service.select(INSTITUTE, null, null));
        assertTrue(e.getMessage().contains(String.valueOf(ImportLimits.MAX_EXPORT_ROWS)));
        verify(productService, never()).get(anyString(), anyString());
    }

    @Test
    void anExportIsAudited() {
        CommerceCatalogueExportService.Selection selection = service.select(INSTITUTE, "active", null);
        service.audit(selection, "user-1", "active");
        verify(auditService).record(eq(INSTITUTE), eq("user-1"), eq("CATALOGUE_EXPORTED"), eq("CATALOGUE"),
                isNull(), eq("{\"products\":1,\"rows\":2,\"status\":\"ACTIVE\"}"));
    }

    private byte[] export(String status, List<String> packageIds) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        service.write(service.select(INSTITUTE, status, packageIds), out);
        return out.toByteArray();
    }
}
