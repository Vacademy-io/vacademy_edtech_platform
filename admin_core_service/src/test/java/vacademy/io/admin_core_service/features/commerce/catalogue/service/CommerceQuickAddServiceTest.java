package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductRequest;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.ProductTranslationDTO;
import vacademy.io.admin_core_service.features.commerce.catalogue.dto.VariantResponse;
import vacademy.io.admin_core_service.features.commerce.catalogue.entity.CommerceProduct;
import vacademy.io.admin_core_service.features.commerce.catalogue.repository.CommerceProductRepository;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceQuickAddService.QuickAddAnswer;
import vacademy.io.admin_core_service.features.commerce.catalogue.service.CommerceQuickAddService.QuickAddRequest;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequest;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestGuard;
import vacademy.io.admin_core_service.features.commerce.common.request.CommerceRequestRepository;
import vacademy.io.admin_core_service.features.commerce.stock.service.CommerceCounterService;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Quick add: a DRAFT product with one TRACKED variant and no price; a tax class only in the
 * REGULAR mode; a SKU from the QA counter when none is given. A repeat of the same request
 * answers the stored product and writes nothing (a manager may have priced or published it); the
 * same key with another body is refused (L2).
 */
class CommerceQuickAddServiceTest {

    private static final String INST = "inst-1";
    private static final String KEY = "quick-add-0001";

    private final CommerceProductService productService = mock(CommerceProductService.class);
    private final CommerceProductRepository productRepository = mock(CommerceProductRepository.class);
    private final CommerceTaxSettingService taxSettings = mock(CommerceTaxSettingService.class);
    private final CommerceCounterService counters = mock(CommerceCounterService.class);
    private final CommerceAuditService audit = mock(CommerceAuditService.class);
    private final CommerceRequestRepository requests = mock(CommerceRequestRepository.class);
    private CommerceQuickAddService service;

    @BeforeEach
    void setUp() {
        service = new CommerceQuickAddService(productService, productRepository, taxSettings, counters, audit,
                new CommerceRequestGuard(requests, mock(PlatformTransactionManager.class)));
        when(requests.findByInstituteIdAndClientRequestId(anyString(), anyString())).thenReturn(Optional.empty());
        mode(TaxMode.REGULAR);
        when(productRepository.findByInstituteIdAndExternalRef(anyString(), anyString())).thenReturn(Optional.empty());
        when(counters.nextNumber(INST, CommerceCounterService.SCOPE_QUICK_ADD)).thenReturn("QA-000007");
        when(productService.save(eq(INST), anyString(), any(ProductRequest.class))).thenAnswer(call -> {
            ProductRequest request = call.getArgument(2);
            return ProductResponse.builder().packageId("pkg-1").stockMode(request.getStockMode())
                    .unit(request.getUnit()).qtyScale(request.getQtyScale())
                    .status(request.getStatus() == null ? "DRAFT" : request.getStatus())
                    .variants(List.of(VariantResponse.builder().packageSessionId("ps-1")
                            .sku(request.getVariants().get(0).getSku())
                            .externalRef(request.getVariants().get(0).getExternalRef()).build()))
                    .build();
        });
    }

    private void mode(TaxMode mode) {
        when(taxSettings.context(INST)).thenReturn(CommerceTaxContext.builder().configured(true).mode(mode)
                .fyStartMonth(4).build());
    }

    private static QuickAddRequest ask(Map<String, String> name, String taxClass, String unit, String mode,
                                       Integer scale, String sku) {
        return new QuickAddRequest(KEY, name, taxClass, unit, mode, scale, sku, null);
    }

    private ProductRequest saved() {
        ArgumentCaptor<ProductRequest> request = ArgumentCaptor.forClass(ProductRequest.class);
        verify(productService).save(eq(INST), eq("wh-1"), request.capture());
        return request.getValue();
    }

    @Test
    void aDraftWithOneTrackedVariantAndNoPrice() {
        QuickAddAnswer answer = service.quickAdd(INST, "wh-1", ask(Map.of("en", "Jute mat", "hi", "जूट की चटाई"),
                "tc-1", "pcs", null, null, null));
        ProductRequest request = saved();
        assertEquals("DRAFT", request.getStatus());
        assertEquals("QUANTITY", request.getStockMode());
        assertEquals("PCS", request.getUnit());
        assertEquals(1, request.getQtyScale());
        assertEquals("QA:" + KEY, request.getExternalRef());
        assertEquals(1, request.getVariants().size());
        assertEquals("TRACKED", request.getVariants().get(0).getStockPolicy());
        assertNull(request.getVariants().get(0).getPrice(), "no price: a manager sets it");
        assertEquals("QA-000007", request.getVariants().get(0).getSku());
        assertEquals(2, request.getTranslations().size());
        assertTrue(request.getTranslations().stream().map(ProductTranslationDTO::getLocale).toList()
                .containsAll(List.of("en", "hi")));
        assertEquals("ps-1", answer.packageSessionId());
        assertEquals("QA-000007", answer.sku());
        assertEquals("DRAFT", answer.status());
        assertNull(answer.replayed());
        verify(audit).record(eq(INST), eq("wh-1"), eq(null), eq("PRODUCT_QUICK_ADDED"), eq("PRODUCT"), eq("pkg-1"),
                eq(null), anyString(), eq(null));
    }

    @Test
    void aTaxClassIsNeededInTheRegularModeOnly() {
        InvalidRequestException refused = assertThrows(InvalidRequestException.class, () -> service.quickAdd(INST,
                "wh-1", ask(Map.of("en", "Jute mat"), null, null, null, null, null)));
        assertTrue(refused.getMessage().startsWith("VALIDATION: choose a tax class"), refused.getMessage());
        verify(productService, never()).save(anyString(), anyString(), any());
        mode(TaxMode.COMPOSITION);
        service.quickAdd(INST, "wh-1", ask(Map.of("en", "Jute mat"), null, null, null, null, null));
        assertNull(saved().getTaxClassId());
    }

    @Test
    void theRequestIsCheckedBeforeAnyNumberIsTaken() {
        for (QuickAddRequest bad : List.of(
                ask(Map.of(), "tc-1", null, null, null, null),
                ask(Map.of("en", "x".repeat(121)), "tc-1", null, null, null, null),
                ask(Map.of("en", "Jute mat"), "tc-1", "metre-1", null, null, null),
                ask(Map.of("en", "Jute mat"), "tc-1", null, "BUNDLE", null, null),
                ask(Map.of("en", "Jute mat"), "tc-1", "PCS", "QUANTITY", 10, null),
                ask(Map.of("en", "Jute mat"), "tc-1", "MTR", "PIECE", 10, null),
                ask(Map.of("en", "Jute mat"), "tc-1", null, null, null, "two words"))) {
            InvalidRequestException refused = assertThrows(InvalidRequestException.class,
                    () -> service.quickAdd(INST, "wh-1", bad));
            assertTrue(refused.getMessage().startsWith("VALIDATION"), refused.getMessage());
        }
        assertThrows(InvalidRequestException.class, () -> service.quickAdd(INST, "wh-1",
                new QuickAddRequest("short", Map.of("en", "Jute mat"), "tc-1", null, null, null, null, null)));
        verify(counters, never()).nextNumber(anyString(), anyString());
        verify(productService, never()).save(anyString(), anyString(), any());
    }

    @Test
    void clothByTheMetreAndAGivenSku() {
        service.quickAdd(INST, "wh-1", ask(Map.of("en", "Cotton cloth"), "tc-1", "mtr", "QUANTITY", 10, "CLOTH-9"));
        ProductRequest request = saved();
        assertEquals("MTR", request.getUnit());
        assertEquals(10, request.getQtyScale());
        assertEquals("CLOTH-9", request.getVariants().get(0).getSku());
        verify(counters, never()).nextNumber(anyString(), anyString());
    }

    /** The guard row a finished quick add left, with the hash of {@code body}. */
    private void finished(QuickAddRequest body) {
        CommerceRequest row = new CommerceRequest();
        row.setInstituteId(INST);
        row.setClientRequestId(KEY);
        row.setAction(CommerceQuickAddService.ACTION_QUICK_ADD);
        row.setRequestHash(CommerceRequestGuard.hash(CommerceQuickAddService.ACTION_QUICK_ADD, body));
        when(requests.findByInstituteIdAndClientRequestId(INST, KEY)).thenReturn(Optional.of(row));
        CommerceProduct earlier = new CommerceProduct();
        earlier.setPackageId("pkg-1");
        when(productRepository.findByInstituteIdAndExternalRef(INST, "QA:" + KEY)).thenReturn(Optional.of(earlier));
        // Since the first call a manager priced and published it.
        when(productService.get(INST, "pkg-1")).thenReturn(ProductResponse.builder().packageId("pkg-1")
                .status("ACTIVE").stockMode("QUANTITY").unit("PCS").qtyScale(1)
                .variants(List.of(VariantResponse.builder().packageSessionId("ps-1").sku("QA-000003")
                        .externalRef("QA:" + KEY).build()))
                .build());
    }

    @Test
    void aRepeatAnswersTheStoredProductAndChangesNothing() {
        QuickAddRequest body = ask(Map.of("en", "Jute mat"), "tc-1", null, null, null, null);
        finished(body);
        QuickAddAnswer answer = service.quickAdd(INST, "wh-1", body);
        assertEquals(Boolean.TRUE, answer.replayed());
        assertEquals("pkg-1", answer.productId());
        assertEquals("QA-000003", answer.sku());
        assertEquals("ACTIVE", answer.status(), "the product as it is now");
        verify(productService, never()).save(anyString(), anyString(), any());
        verify(counters, never()).nextNumber(anyString(), anyString());
        verify(audit, never()).record(anyString(), anyString(), any(), anyString(), anyString(), anyString(), any(),
                any(), any());
    }

    @Test
    void theSameKeyWithAnotherBodyIsRefusedAndChangesNothing() {
        finished(ask(Map.of("en", "Jute mat"), "tc-1", null, null, null, null));
        // Warehouse staff try to rename, re-tax and re-code a live product through the replay path.
        ConflictException refused = assertThrows(ConflictException.class, () -> service.quickAdd(INST, "wh-1",
                ask(Map.of("en", "anything"), "tc-0", null, "PIECE", null, "X-1")));
        assertTrue(refused.getMessage().startsWith("IDEMPOTENCY_MISMATCH"), refused.getMessage());
        verify(productService, never()).save(anyString(), anyString(), any());
    }

    @Test
    void aProductMadeUnderTheKeyBeforeTheGuardRowIsAnsweredNotRewritten() {
        CommerceProduct earlier = new CommerceProduct();
        earlier.setPackageId("pkg-1");
        when(productRepository.findByInstituteIdAndExternalRef(INST, "QA:" + KEY)).thenReturn(Optional.of(earlier));
        when(productService.get(INST, "pkg-1")).thenReturn(ProductResponse.builder().packageId("pkg-1")
                .status("DRAFT").variants(List.of(VariantResponse.builder().packageSessionId("ps-1").sku("QA-000003")
                        .build())).build());
        QuickAddAnswer answer = service.quickAdd(INST, "wh-1", ask(Map.of("en", "Other name"), "tc-1", null, null,
                null, null));
        assertEquals(Boolean.TRUE, answer.replayed());
        assertEquals("QA-000003", answer.sku());
        verify(productService, never()).save(anyString(), anyString(), any());
        verify(counters, never()).nextNumber(anyString(), anyString());
    }
}
