package vacademy.io.admin_core_service.features.platform_billing.service;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import vacademy.io.admin_core_service.features.credits.entity.CreditPack;
import vacademy.io.admin_core_service.features.credits.repository.CreditPackRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentItem;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PlatformInvoiceServiceTest {

    static final String PP = "pp-1";
    static final String INST = "inst-1";
    static final Instant NOW = Instant.parse("2026-11-05T10:00:00Z");

    PlatformPaymentRepository paymentRepo = mock(PlatformPaymentRepository.class);
    PlatformPaymentItemRepository itemRepo = mock(PlatformPaymentItemRepository.class);
    PlatformInvoiceRepository invoiceRepo = mock(PlatformInvoiceRepository.class);
    PlatformInvoiceLineItemRepository lineRepo = mock(PlatformInvoiceLineItemRepository.class);
    InstituteRepository instituteRepo = mock(InstituteRepository.class);
    CreditPackRepository packRepo = mock(CreditPackRepository.class);
    PlatformPaymentConfigService configService = mock(PlatformPaymentConfigService.class);
    PlatformBillingFlags flags = mock(PlatformBillingFlags.class);
    PlatformDocumentSequenceService sequence = mock(PlatformDocumentSequenceService.class);
    BrandModeService brand = mock(BrandModeService.class);
    EntityManager em = mock(EntityManager.class, Mockito.RETURNS_DEEP_STUBS);

    PlatformInvoiceService service;
    List<PlatformInvoiceLineItem> savedLines = new ArrayList<>();

    @BeforeEach
    void setUp() {
        service = new PlatformInvoiceService(paymentRepo, itemRepo, invoiceRepo, lineRepo, instituteRepo,
                packRepo, configService);
        service.setCollaborators(flags, sequence, brand, em, Clock.fixed(NOW, ZoneOffset.UTC));
        when(configService.load()).thenReturn(config());
        when(invoiceRepo.findByPlatformPaymentId(PP)).thenReturn(Optional.empty());
        when(invoiceRepo.saveAndFlush(any())).thenAnswer(a -> {
            PlatformInvoice inv = a.getArgument(0);
            inv.setId("inv-1");
            return inv;
        });
        when(invoiceRepo.save(any())).thenAnswer(a -> a.getArgument(0));
        when(lineRepo.save(any())).thenAnswer(a -> {
            savedLines.add(a.getArgument(0));
            return a.getArgument(0);
        });
        when(brand.resolve(eq(INST), any())).thenReturn(BrandMode.NEUTRAL);
        // legacy INV-AICRED counter + the advisory lock
        when(em.createNativeQuery(anyString()).setParameter(anyString(), any()).getSingleResult()).thenReturn(7);
    }

    static PlatformPaymentConfig config() {
        PlatformPaymentConfig c = new PlatformPaymentConfig();
        c.setSupplierLegalName("Vidyayatan Technologies LLP");
        c.setSupplierGstin("23AAYFV8247N1Z3");
        c.setSupplierStateCode("23");
        c.setSupplierAddress("Indore, Madhya Pradesh");
        return c;
    }

    static PlatformPayment paidPayment(String currency, long base, long tax) {
        PlatformPayment p = new PlatformPayment();
        p.setId(PP);
        p.setInstituteId(INST);
        p.setVendor("RAZORPAY");
        p.setCurrency(currency);
        p.setBaseAmountMinor(base);
        p.setTaxAmountMinor(tax);
        p.setTotalAmountMinor(base + tax);
        p.setPaymentStatus(PlatformPaymentResult.PAID);
        return p;
    }

    static PlatformPaymentItem packItem(String packId, long base, long tax) {
        PlatformPaymentItem i = new PlatformPaymentItem();
        i.setId("item-1");
        i.setPlatformPaymentId(PP);
        i.setPackId(packId);
        i.setPackCodeSnapshot("PRO");
        i.setCredits(new BigDecimal("500.00"));
        i.setCurrency("INR");
        i.setBaseAmountMinor(base);
        i.setTaxRateBps(1800);
        i.setTaxAmountMinor(tax);
        i.setTotalAmountMinor(base + tax);
        i.setHsnSacSnapshot("998313");
        return i;
    }

    static PlatformPaymentItem subItem(long base, long total) {
        PlatformPaymentItem i = new PlatformPaymentItem();
        i.setId("item-s");
        i.setPlatformPaymentId(PP);
        i.setItemKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
        i.setSubscriptionChargeId("charge-1");
        i.setPackCodeSnapshot("AI_SUB:pro");
        i.setCredits(BigDecimal.ZERO);
        i.setCurrency("INR");
        i.setBaseAmountMinor(base);
        i.setTaxRateBps(1800);
        i.setTaxAmountMinor(total - base);
        i.setTotalAmountMinor(total);
        i.setHsnSacSnapshot("998315");
        i.setDescriptionSnapshot("AI Pro subscription, 05-11-2026 to 04-12-2026");
        i.setServicePeriodStart(Instant.parse("2026-11-04T18:30:00Z"));
        i.setServicePeriodEnd(Instant.parse("2026-12-04T18:30:00Z"));
        return i;
    }

    static Institute institute(String state, String gstin) {
        Institute i = new Institute();
        i.setId(INST);
        i.setInstituteName("Shiksha Academy");
        i.setStateCode(state);
        i.setGstin(gstin);
        i.setAddress("12 MG Road");
        i.setCity("Pune");
        return i;
    }

    // ── credit packs, all flags at default: behaviour as before ──

    @Test
    void legacyPackInvoiceIsUnchangedWithFlagsOff() {
        when(paymentRepo.findById(PP)).thenReturn(Optional.of(paidPayment("INR", 46_500L, 8_370L)));
        when(itemRepo.findByPlatformPaymentId(PP)).thenReturn(List.of(packItem("pack-1", 46_500L, 8_370L)));
        when(instituteRepo.findById(INST)).thenReturn(Optional.of(institute("27", null)));
        CreditPack pack = new CreditPack();
        pack.setName("Pro");
        when(packRepo.findById("pack-1")).thenReturn(Optional.of(pack));

        PlatformInvoice inv = service.generateInvoice(PP);

        assertEquals("INV-AICRED-202611-0007", inv.getInvoiceNumber());
        assertNull(inv.getSeriesKey());
        verifyNoInteractions(sequence);
        assertEquals("27", inv.getPlaceOfSupply());
        assertEquals("Shiksha Academy", inv.getBuyerLegalName());
        assertEquals("12 MG Road, Pune", inv.getBuyerAddress());
        assertEquals(8_370L, inv.getIgstAmountMinor());
        assertEquals(0L, inv.getCgstAmountMinor());
        assertEquals(54_870L, inv.getTotalAmountMinor());
        assertEquals(LocalDateTime.parse("2026-11-05T10:00:00"), inv.getIssuedAt());
        assertEquals(PlatformPaymentItemKind.CREDIT_PACK, inv.getSourceKind());
        assertEquals(1, savedLines.size());
        assertEquals("Pro — 500 AI credits", savedLines.get(0).getDescription());
        assertEquals(1800, savedLines.get(0).getIgstRateBps());
    }

    @Test
    void legacyIntraStatePackSplitsTaxAsBefore() {
        when(paymentRepo.findById(PP)).thenReturn(Optional.of(paidPayment("INR", 46_500L, 8_370L)));
        when(itemRepo.findByPlatformPaymentId(PP)).thenReturn(List.of(packItem("pack-1", 46_500L, 8_370L)));
        when(instituteRepo.findById(INST)).thenReturn(Optional.of(institute("23", "23ABCDE1234F1Z5")));
        when(packRepo.findById("pack-1")).thenReturn(Optional.empty());

        PlatformInvoice inv = service.generateInvoice(PP);
        assertEquals(4_185L, inv.getCgstAmountMinor());
        assertEquals(4_185L, inv.getSgstAmountMinor());
        assertEquals("23ABCDE1234F1Z5", inv.getBuyerGstin());
        assertEquals("PRO — 500 AI credits", savedLines.get(0).getDescription(), "deleted pack falls back to the code");
    }

    @Test
    void packWithoutPackIdUsesDescriptionSnapshot() {
        PlatformPaymentItem item = packItem(null, 46_500L, 8_370L);
        item.setDescriptionSnapshot("Starter top-up — 500 AI credits");
        when(paymentRepo.findById(PP)).thenReturn(Optional.of(paidPayment("INR", 46_500L, 8_370L)));
        when(itemRepo.findByPlatformPaymentId(PP)).thenReturn(List.of(item));
        when(instituteRepo.findById(INST)).thenReturn(Optional.of(institute("27", null)));

        service.generateInvoice(PP);
        assertEquals("Starter top-up — 500 AI credits", savedLines.get(0).getDescription());
        verify(packRepo, never()).findById(isNull());
    }

    @Test
    void seriesV2FlagSwitchesPackNumbering() {
        when(flags.invoiceSeriesV2Enabled()).thenReturn(true);
        when(sequence.next(PlatformDocumentSequenceService.Series.INVOICE, NOW)).thenReturn("VT/2627/I00001");
        when(paymentRepo.findById(PP)).thenReturn(Optional.of(paidPayment("INR", 46_500L, 8_370L)));
        when(itemRepo.findByPlatformPaymentId(PP)).thenReturn(List.of(packItem("pack-1", 46_500L, 8_370L)));
        when(instituteRepo.findById(INST)).thenReturn(Optional.of(institute("27", null)));

        PlatformInvoice inv = service.generateInvoice(PP);
        assertEquals("VT/2627/I00001", inv.getInvoiceNumber());
        assertEquals("I", inv.getSeriesKey());
        assertEquals("2627", inv.getFy());
        assertEquals(NOW, inv.getIssuedAtTz());
    }

    // ── subscriptions: snapshot only, series v2 always ──

    @Test
    void subscriptionInvoiceUsesSnapshotAndSeriesV2EvenWithFlagOff() {
        PlatformPayment p = paidPayment("INR", 500_000L, 90_000L);
        p.setBuyerLegalName("Shiksha Academy Pvt Ltd");
        p.setBuyerStateCode("23");
        p.setBuyerGstin("23ABCDE1234F1Z5");
        p.setBuyerAddress("Bhopal");
        p.setPlaceOfSupply("23");
        p.setTaxHead("CGST_SGST");
        p.setBrandMode("NEUTRAL");
        when(paymentRepo.findById(PP)).thenReturn(Optional.of(p));
        // inclusive-price item: total 5,900.01 listed, base back-calculated
        when(itemRepo.findByPlatformPaymentId(PP)).thenReturn(List.of(subItem(500_000L, 590_001L)));
        when(sequence.next(PlatformDocumentSequenceService.Series.INVOICE, NOW)).thenReturn("VT/2627/I00042");

        PlatformInvoice inv = service.generateInvoice(PP);

        assertEquals("VT/2627/I00042", inv.getInvoiceNumber());
        assertTrue(inv.getInvoiceNumber().length() <= 16);
        assertEquals(PlatformPaymentItemKind.AI_SUBSCRIPTION, inv.getSourceKind());
        assertEquals("Shiksha Academy Pvt Ltd", inv.getBuyerLegalName());
        assertEquals("23", inv.getPlaceOfSupply());
        assertEquals(45_000L, inv.getCgstAmountMinor());
        assertEquals(45_001L, inv.getSgstAmountMinor(), "SGST takes the odd paisa");
        assertEquals(590_001L, inv.getTotalAmountMinor(), "tax = total - base");
        assertEquals(Instant.parse("2026-11-04T18:30:00Z"), inv.getServicePeriodStart());
        assertEquals("AI Pro subscription, 05-11-2026 to 04-12-2026", savedLines.get(0).getDescription());
        assertEquals(900, savedLines.get(0).getCgstRateBps());
        verifyNoInteractions(instituteRepo);
        verify(flags, never()).invoiceSeriesV2Enabled();
    }

    @Test
    void subscriptionWithoutBuyerStateIsRefused() {
        PlatformPayment p = paidPayment("INR", 500_000L, 90_000L);
        p.setTaxHead("IGST");
        p.setBuyerLegalName("X");
        when(paymentRepo.findById(PP)).thenReturn(Optional.of(p));
        when(itemRepo.findByPlatformPaymentId(PP)).thenReturn(List.of(subItem(500_000L, 590_000L)));
        VacademyException ex = assertThrows(VacademyException.class, () -> service.generateInvoice(PP));
        assertTrue(ex.getMessage().contains("BUYER_STATE_REQUIRED"));
        verifyNoInteractions(sequence);
    }

    @Test
    void subscriptionWithoutSnapshotIsRefused() {
        when(paymentRepo.findById(PP)).thenReturn(Optional.of(paidPayment("INR", 500_000L, 90_000L)));
        when(itemRepo.findByPlatformPaymentId(PP)).thenReturn(List.of(subItem(500_000L, 590_000L)));
        assertThrows(VacademyException.class, () -> service.generateInvoice(PP));
        verify(invoiceRepo, never()).saveAndFlush(any());
    }

    // ── guards ──

    @Test
    void duplicateOrLatePaymentIsNeverInvoiced() {
        for (PlatformPaymentDisposition d : new PlatformPaymentDisposition[] {
                PlatformPaymentDisposition.DUPLICATE, PlatformPaymentDisposition.LATE }) {
            PlatformPayment p = paidPayment("INR", 1L, 0L);
            p.setDisposition(d);
            when(paymentRepo.findById(PP)).thenReturn(Optional.of(p));
            PlatformInvoiceService.NotInvoiceableException ex = assertThrows(
                    PlatformInvoiceService.NotInvoiceableException.class, () -> service.generateInvoice(PP));
            assertEquals("NOT_INVOICEABLE", ex.getCode());
            assertFalse(PlatformInvoiceService.isInvoiceable(p));
        }
        verify(invoiceRepo, never()).saveAndFlush(any());
    }

    @Test
    void unpaidPaymentIsNeverInvoiced() {
        PlatformPayment p = paidPayment("INR", 1L, 0L);
        p.setPaymentStatus(PlatformPaymentResult.PAYMENT_PENDING);
        when(paymentRepo.findById(PP)).thenReturn(Optional.of(p));
        assertEquals("NOT_PAID", assertThrows(PlatformInvoiceService.NotInvoiceableException.class,
                () -> service.generateInvoice(PP)).getCode());
    }

    @Test
    void existingInvoiceIsReturnedWithoutAllocatingANumber() {
        PlatformInvoice existing = new PlatformInvoice();
        existing.setInvoiceNumber("INV-AICRED-202610-0001");
        when(invoiceRepo.findByPlatformPaymentId(PP)).thenReturn(Optional.of(existing));
        assertSame(existing, service.generateInvoice(PP));
        verifyNoInteractions(sequence, paymentRepo);
    }

    @Test
    void secondIssuerWaitsOnTheLockThenReturnsTheFirstInvoice() {
        PlatformInvoice first = new PlatformInvoice();
        when(invoiceRepo.findByPlatformPaymentId(PP)).thenReturn(Optional.empty(), Optional.of(first));
        assertSame(first, service.generateInvoice(PP));
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(em, atLeastOnce()).createNativeQuery(sql.capture());
        assertTrue(sql.getAllValues().contains(PlatformInvoiceService.LOCK_SQL));
        verify(invoiceRepo, never()).saveAndFlush(any());
    }
}
