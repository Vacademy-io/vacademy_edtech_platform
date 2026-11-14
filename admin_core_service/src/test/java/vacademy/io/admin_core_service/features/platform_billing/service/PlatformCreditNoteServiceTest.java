package vacademy.io.admin_core_service.features.platform_billing.service;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentDisposition;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformCreditNoteRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformCreditNoteService.CreditNoteException;
import vacademy.io.admin_core_service.features.platform_billing.service.PlatformCreditNoteService.Split;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PlatformCreditNoteServiceTest {

    static final Instant NOW = Instant.parse("2026-12-01T06:00:00Z");

    PlatformCreditNoteRepository cnRepo = mock(PlatformCreditNoteRepository.class);
    PlatformInvoiceRepository invoiceRepo = mock(PlatformInvoiceRepository.class);
    PlatformInvoiceLineItemRepository lineRepo = mock(PlatformInvoiceLineItemRepository.class);
    PlatformPaymentRepository paymentRepo = mock(PlatformPaymentRepository.class);
    PlatformDocumentSequenceService sequence = mock(PlatformDocumentSequenceService.class);
    BrandModeService brand = mock(BrandModeService.class);
    EntityManager em = mock(EntityManager.class, Mockito.RETURNS_DEEP_STUBS);
    PlatformCreditNoteService service;
    List<PlatformCreditNote> issued = new ArrayList<>();

    @BeforeEach
    void setUp() {
        service = new PlatformCreditNoteService(cnRepo, invoiceRepo, lineRepo, paymentRepo, sequence, brand);
        service.setTestHooks(em, Clock.fixed(NOW, ZoneOffset.UTC));
        when(cnRepo.findByVendorRefundId(anyString())).thenReturn(Optional.empty());
        when(cnRepo.findByInvoiceIdOrderByIssuedAtAsc("inv-1")).thenAnswer(a -> new ArrayList<>(issued));
        when(cnRepo.saveAndFlush(any())).thenAnswer(a -> {
            PlatformCreditNote cn = a.getArgument(0);
            cn.setId("cn-" + (issued.size() + 1));
            issued.add(cn);
            return cn;
        });
        int[] n = { 0 };
        when(sequence.next(eq(PlatformDocumentSequenceService.Series.CREDIT_NOTE), any()))
                .thenAnswer(a -> PlatformDocumentSequenceService.format(
                        PlatformDocumentSequenceService.Series.CREDIT_NOTE, "2627", ++n[0]));
        when(brand.resolve(anyString(), any())).thenReturn(BrandMode.NEUTRAL);
        PlatformInvoiceLineItem line = PlatformInvoicePdfServiceTest.line();
        when(lineRepo.findByPlatformInvoiceId("inv-1")).thenReturn(List.of(line));
    }

    static PlatformInvoice invoice(long base, long cgst, long sgst, long igst) {
        PlatformInvoice inv = PlatformInvoicePdfServiceTest.subscriptionInvoice();
        inv.setBaseAmountMinor(base);
        inv.setCgstAmountMinor(cgst);
        inv.setSgstAmountMinor(sgst);
        inv.setIgstAmountMinor(igst);
        inv.setTotalAmountMinor(base + cgst + sgst + igst);
        inv.setBrandMode("NEUTRAL");
        return inv;
    }

    PlatformPayment payment(PlatformPaymentDisposition d) {
        PlatformPayment p = PlatformInvoiceServiceTest.paidPayment("INR", 500_000L, 90_000L);
        p.setDisposition(d);
        p.setTaxHead("IGST");
        return p;
    }

    // ── amounts ──

    @Test
    void partialIgstRefundSplitsInTheInvoiceRatio() {
        Split s = PlatformCreditNoteService.split(invoice(500_000L, 0, 0, 90_000L), List.of(), 118_000L);
        assertEquals(100_000L, s.base());
        assertEquals(18_000L, s.igst());
        assertEquals(118_000L, s.total());
    }

    @Test
    void partialIntraStateRefundSplitsCgstAndSgst() {
        Split s = PlatformCreditNoteService.split(invoice(500_000L, 45_000L, 45_000L, 0), List.of(), 100_001L);
        assertEquals(84_747L, s.base());
        assertEquals(15_254L, s.cgst() + s.sgst());
        assertTrue(s.sgst() - s.cgst() <= 1);
        assertEquals(100_001L, s.total());
    }

    @Test
    void cumulativePartialsThenRemainderReverseTheInvoiceExactly() {
        PlatformInvoice inv = invoice(499_999L, 45_000L, 45_000L, 0);  // odd base to stress rounding
        PlatformPayment p = payment(PlatformPaymentDisposition.NORMAL);
        p.setTaxHead("CGST_SGST");
        when(paymentRepo.findById("pp-1")).thenReturn(Optional.of(p));
        when(invoiceRepo.findByPlatformPaymentId("pp-1")).thenReturn(Optional.of(inv));

        service.issueForRefund("pp-1", "rfnd_1", 33_333L, "partial", "staff");
        service.issueForRefund("pp-1", "rfnd_2", 77_777L, "partial", "staff");
        service.issueForRefund("pp-1", "rfnd_3", inv.getTotalAmountMinor() - 33_333L - 77_777L, "rest", "staff");

        assertEquals(3, issued.size());
        assertEquals(inv.getBaseAmountMinor(), issued.stream().mapToLong(PlatformCreditNote::getBaseAmountMinor).sum());
        assertEquals(inv.getCgstAmountMinor(), issued.stream().mapToLong(PlatformCreditNote::getCgstAmountMinor).sum());
        assertEquals(inv.getSgstAmountMinor(), issued.stream().mapToLong(PlatformCreditNote::getSgstAmountMinor).sum());
        assertEquals(inv.getTotalAmountMinor(), issued.stream().mapToLong(PlatformCreditNote::getTotalAmountMinor).sum());
        for (PlatformCreditNote cn : issued) {
            assertEquals(cn.getTotalAmountMinor(),
                    cn.getBaseAmountMinor() + cn.getCgstAmountMinor() + cn.getSgstAmountMinor() + cn.getIgstAmountMinor(),
                    "ck_pcn_total");
            assertTrue(cn.getCreditNoteNumber().length() <= 16);
            assertEquals("CGST_SGST", cn.getTaxHead());
            assertEquals(900, cn.getCgstRateBps());
        }
        assertEquals(List.of("VT/2627/C00001", "VT/2627/C00002", "VT/2627/C00003"),
                issued.stream().map(PlatformCreditNote::getCreditNoteNumber).toList());
        // nothing left to credit
        assertEquals(PlatformCreditNoteService.EXCEEDS_INVOICE, assertThrows(CreditNoteException.class,
                () -> service.issueForRefund("pp-1", "rfnd_4", 1L, "more", "staff")).getCode());
    }

    @Test
    void creditAboveTheInvoiceIsRefused() {
        assertThrows(CreditNoteException.class,
                () -> PlatformCreditNoteService.split(invoice(500_000L, 0, 0, 90_000L), List.of(), 590_001L));
        assertThrows(CreditNoteException.class, () -> service.issue(invoice(1L, 0, 0, 0), null, null, 0L, "x", "y"));
    }

    // ── links, snapshot, idempotency ──

    @Test
    void creditNoteCopiesTheInvoiceAndLinksIt() {
        PlatformInvoice inv = invoice(500_000L, 0, 0, 90_000L);
        when(paymentRepo.findById("pp-1")).thenReturn(Optional.of(payment(PlatformPaymentDisposition.NORMAL)));
        when(invoiceRepo.findByPlatformPaymentId("pp-1")).thenReturn(Optional.of(inv));

        PlatformCreditNote cn = service.issueForRefund("pp-1", "rfnd_X", 590_000L, null, "system").orElseThrow();

        assertEquals("inv-1", cn.getInvoiceId());
        assertEquals("VT/2627/I00042", cn.getInvoiceNumber());
        assertEquals(inv.getIssuedAtTz(), cn.getInvoiceIssuedAt());
        assertEquals("pp-1", cn.getPlatformPaymentId());
        assertEquals("rfnd_X", cn.getVendorRefundId());
        assertEquals("Refund", cn.getReason());
        assertEquals("Vidyayatan Technologies LLP", cn.getSupplierLegalName());
        assertEquals("Shiksha Academy Pvt Ltd", cn.getBuyerLegalName());
        assertEquals("27", cn.getPlaceOfSupply());
        assertEquals("IGST", cn.getTaxHead());
        assertEquals(PlatformPaymentItemKind.AI_SUBSCRIPTION, cn.getItemKind());
        assertEquals("NEUTRAL", cn.getBrandMode());
        assertEquals("998315", cn.getHsnSacCode());
        assertEquals(500_000L, cn.getBaseAmountMinor());
        assertEquals(90_000L, cn.getIgstAmountMinor());
        assertEquals(1800, cn.getIgstRateBps());
        assertEquals("2627", cn.getFy());
        assertEquals(NOW, cn.getIssuedAt());
    }

    @Test
    void sameRefundIdReturnsTheExistingNote() {
        PlatformCreditNote existing = new PlatformCreditNote();
        when(cnRepo.findByVendorRefundId("rfnd_dup")).thenReturn(Optional.of(existing));
        assertSame(existing, service.issueForRefund("pp-1", "rfnd_dup", 100L, "r", "a").orElseThrow());
        verifyNoInteractions(sequence);
        verify(cnRepo, never()).saveAndFlush(any());
    }

    @Test
    void duplicateOrLatePaymentGetsNoCreditNote() {
        when(paymentRepo.findById("pp-1")).thenReturn(Optional.of(payment(PlatformPaymentDisposition.DUPLICATE)));
        assertTrue(service.issueForRefund("pp-1", "rfnd_d", 100L, "r", "a").isEmpty());
        when(paymentRepo.findById("pp-1")).thenReturn(Optional.of(payment(PlatformPaymentDisposition.LATE)));
        assertTrue(service.issueForRefund("pp-1", "rfnd_l", 100L, "r", "a").isEmpty());
        verifyNoInteractions(sequence);
    }

    @Test
    void paymentWithoutInvoiceGetsNoCreditNote() {
        when(paymentRepo.findById("pp-1")).thenReturn(Optional.of(payment(PlatformPaymentDisposition.NORMAL)));
        when(invoiceRepo.findByPlatformPaymentId("pp-1")).thenReturn(Optional.empty());
        assertTrue(service.issueForRefund("pp-1", "rfnd_n", 100L, "r", "a").isEmpty());
    }

    @Test
    void staffCreditNoteNeedsAReasonAndHasNoRefundId() {
        PlatformInvoice inv = invoice(500_000L, 0, 0, 90_000L);
        when(invoiceRepo.findById("inv-1")).thenReturn(Optional.of(inv));
        assertThrows(CreditNoteException.class, () -> service.issueStaffCreditNote("inv-1", 100L, " ", "a"));
        PlatformCreditNote cn = service.issueStaffCreditNote("inv-1", 11_800L, "Waived after invoicing", "staff-1");
        assertNull(cn.getVendorRefundId());
        assertEquals(10_000L, cn.getBaseAmountMinor());
        assertEquals(1_800L, cn.getIgstAmountMinor());
        assertEquals("staff-1", cn.getCreatedBy());
    }

    @Test
    void legacyInvoiceDateIsTakenAsUtcWallClock() {
        PlatformInvoice inv = invoice(500_000L, 0, 0, 90_000L);
        inv.setIssuedAtTz(null);
        inv.setIssuedAt(java.time.LocalDateTime.parse("2026-10-01T20:00:00"));
        when(invoiceRepo.findById("inv-1")).thenReturn(Optional.of(inv));
        PlatformCreditNote cn = service.issueStaffCreditNote("inv-1", 100L, "fix", "a");
        assertEquals(Instant.parse("2026-10-01T20:00:00Z"), cn.getInvoiceIssuedAt());
    }
}
