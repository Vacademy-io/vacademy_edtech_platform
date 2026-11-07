package vacademy.io.admin_core_service.features.platform_billing.service;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentInformation;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformCreditNote;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoice;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformInvoiceLineItem;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPayment;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformPaymentConfig;
import vacademy.io.admin_core_service.features.platform_billing.enums.BrandMode;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentItemKind;
import vacademy.io.admin_core_service.features.platform_billing.enums.PlatformPaymentResult;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformInvoiceRepository;
import vacademy.io.admin_core_service.features.platform_billing.repository.PlatformPaymentRepository;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Renders real PDFs and reads them back with PDFBox: a NEUTRAL document never contains the
 * platform brand (text or metadata) but always names the legal supplier and its GSTIN; a
 * VACADEMY document carries the trade name next to the legal supplier.
 */
class PlatformInvoicePdfServiceTest {

    static final Pattern BRAND = Pattern.compile("(?i)vacademy");

    PlatformInvoiceRepository invoiceRepo = mock(PlatformInvoiceRepository.class);
    PlatformInvoiceLineItemRepository lineRepo = mock(PlatformInvoiceLineItemRepository.class);
    PlatformPaymentRepository paymentRepo = mock(PlatformPaymentRepository.class);
    PlatformPaymentConfigService configService = mock(PlatformPaymentConfigService.class);
    BrandModeService brand = mock(BrandModeService.class);
    PlatformInvoicePdfService pdf;

    @BeforeEach
    void setUp() {
        pdf = new PlatformInvoicePdfService(invoiceRepo, lineRepo);
        pdf.setCollaborators(paymentRepo, configService, brand);
        PlatformPaymentConfig cfg = PlatformInvoiceServiceTest.config();
        cfg.setTradeName("Vacademy");
        when(configService.load()).thenReturn(cfg);
        when(lineRepo.findByPlatformInvoiceId(anyString())).thenReturn(List.of(line()));
        PlatformPayment p = PlatformInvoiceServiceTest.paidPayment("INR", 500_000L, 90_000L);
        when(paymentRepo.findById(anyString())).thenReturn(Optional.of(p));
    }

    static PlatformInvoice subscriptionInvoice() {
        PlatformInvoice inv = new PlatformInvoice();
        inv.setId("inv-1");
        inv.setPlatformPaymentId("pp-1");
        inv.setInvoiceNumber("VT/2627/I00042");
        inv.setSupplierLegalName("Vidyayatan Technologies LLP");
        inv.setSupplierGstin("23AAYFV8247N1Z3");
        inv.setSupplierStateCode("23");
        inv.setSupplierAddress("Indore, Madhya Pradesh");
        inv.setBuyerInstituteId("inst-1");
        inv.setBuyerLegalName("Shiksha Academy Pvt Ltd");
        inv.setBuyerStateCode("27");
        inv.setPlaceOfSupply("27");
        inv.setIsExport(false);
        inv.setCurrency("INR");
        inv.setBaseAmountMinor(500_000L);
        inv.setCgstAmountMinor(0L);
        inv.setSgstAmountMinor(0L);
        inv.setIgstAmountMinor(90_000L);
        inv.setTotalAmountMinor(590_000L);
        // 00:15 IST on 1 April 2027 (still 31 March in UTC)
        inv.setIssuedAt(LocalDateTime.parse("2027-03-31T18:45:00"));
        inv.setIssuedAtTz(Instant.parse("2027-03-31T18:45:00Z"));
        inv.setSourceKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
        inv.setServicePeriodStart(Instant.parse("2027-03-31T18:30:00Z"));
        inv.setServicePeriodEnd(Instant.parse("2027-04-30T18:30:00Z"));
        return inv;
    }

    static PlatformInvoiceLineItem line() {
        PlatformInvoiceLineItem l = new PlatformInvoiceLineItem();
        l.setDescription("AI Pro subscription, 01-04-2027 to 30-04-2027");
        l.setHsnSacCode("998315");
        l.setQuantity(BigDecimal.ONE);
        l.setBaseAmountMinor(500_000L);
        l.setCgstRateBps(0);
        l.setCgstAmountMinor(0L);
        l.setSgstRateBps(0);
        l.setSgstAmountMinor(0L);
        l.setIgstRateBps(1800);
        l.setIgstAmountMinor(90_000L);
        l.setTotalAmountMinor(590_000L);
        return l;
    }

    static String text(byte[] bytes) throws Exception {
        try (PDDocument doc = PDDocument.load(bytes)) {
            PDDocumentInformation info = doc.getDocumentInformation();
            StringBuilder meta = new StringBuilder();
            for (String v : new String[] { info.getTitle(), info.getAuthor(), info.getSubject(), info.getKeywords(),
                    info.getCreator(), info.getProducer() }) {
                if (v != null) {
                    meta.append(' ').append(v);
                }
            }
            return new PDFTextStripper().getText(doc) + "\n#META#" + meta;
        }
    }

    @Test
    void neutralInvoiceHasNoBrandButNamesTheLegalSupplier() throws Exception {
        PlatformInvoice inv = subscriptionInvoice();
        inv.setBrandMode("NEUTRAL");
        String t = text(pdf.renderPdf(inv));
        assertFalse(BRAND.matcher(t).find(), "brand leaked into a NEUTRAL invoice:\n" + t);
        assertTrue(t.contains("Vidyayatan Technologies LLP"));
        assertTrue(t.contains("23AAYFV8247N1Z3"));
        assertTrue(t.contains("TAX INVOICE"));
        assertTrue(t.contains("VT/2627/I00042"));
        assertTrue(t.contains("01 Apr 2027"), "v2 invoices print the IST date");
        assertTrue(t.contains("Subscription to hosted AI software services"));
        assertTrue(t.contains("PAID"));
        assertTrue(t.contains("Maharashtra (27)"));
        verify(brand, never()).resolve(anyString(), any());
    }

    @Test
    void neutralPackInvoiceFooterHasNoBrand() throws Exception {
        PlatformInvoice inv = subscriptionInvoice();
        inv.setInvoiceNumber("INV-AICRED-202611-0007");
        inv.setIssuedAtTz(null);
        inv.setSourceKind(PlatformPaymentItemKind.CREDIT_PACK);
        inv.setServicePeriodStart(null);
        inv.setServicePeriodEnd(null);
        inv.setBrandMode(null);
        when(brand.resolve(eq("inst-1"), any())).thenReturn(BrandMode.NEUTRAL);
        String t = text(pdf.renderPdf(inv));
        assertFalse(BRAND.matcher(t).find(), t);
        assertTrue(t.contains("Prepaid AI credits for hosted AI software services"));
        assertTrue(t.contains("31 Mar 2027"), "legacy invoices keep printing the stored date");
    }

    @Test
    void vacademyInvoiceShowsTradeNameNextToLegalSupplier() throws Exception {
        PlatformInvoice inv = subscriptionInvoice();
        inv.setBrandMode("VACADEMY");
        String t = text(pdf.renderPdf(inv));
        assertTrue(t.contains("Trade name: Vacademy"), t);
        assertTrue(t.contains("Vidyayatan Technologies LLP"));
        assertTrue(t.contains("23AAYFV8247N1Z3"));
    }

    @Test
    void vacademyPackInvoiceKeepsTheOriginalFooter() {
        PlatformInvoice inv = subscriptionInvoice();
        inv.setSourceKind(PlatformPaymentItemKind.CREDIT_PACK);
        String html = pdf.buildHtml(inv, List.of(line()), null, pdf.brandIdentity(BrandMode.VACADEMY));
        assertTrue(html.contains("Supply of AI credits for use on the Vacademy platform. Credits are "
                + "non-transferable and non-refundable once consumed."));
    }

    @Test
    void badgeComesFromThePayment() {
        PlatformPayment p = PlatformInvoiceServiceTest.paidPayment("INR", 1L, 0L);
        assertEquals("PAID", PlatformInvoicePdfService.badge(p));
        p.setVendor("MANUAL");
        assertEquals("PAID (OFFLINE)", PlatformInvoicePdfService.badge(p));
        p.setPaymentStatus(PlatformPaymentResult.PAYMENT_PENDING);
        assertNull(PlatformInvoicePdfService.badge(p));
        assertNull(PlatformInvoicePdfService.badge(null));
        String html = pdf.buildHtml(subscriptionInvoice(), List.of(line()));
        assertFalse(html.contains("class=\"badge\""), "no payment, no badge");
    }

    @Test
    void fileNamesHaveNoSlash() {
        assertEquals("VT-2627-I00042.pdf", pdf.fileName(subscriptionInvoice()));
        PlatformInvoice legacy = subscriptionInvoice();
        legacy.setInvoiceNumber("INV-AICRED-202611-0007");
        assertEquals("INV-AICRED-202611-0007.pdf", pdf.fileName(legacy));
    }

    static PlatformCreditNote creditNote(String brandMode) {
        PlatformCreditNote cn = new PlatformCreditNote();
        cn.setId("cn-1");
        cn.setCreditNoteNumber("VT/2627/C00003");
        cn.setFy("2627");
        cn.setInvoiceId("inv-1");
        cn.setInvoiceNumber("VT/2627/I00042");
        cn.setInvoiceIssuedAt(Instant.parse("2027-03-31T18:45:00Z"));
        cn.setPlatformPaymentId("pp-1");
        cn.setVendorRefundId("rfnd_ABC123");
        cn.setItemKind(PlatformPaymentItemKind.AI_SUBSCRIPTION);
        cn.setBrandMode(brandMode);
        cn.setReason("Refund of unused plan");
        cn.setSupplierLegalName("Vidyayatan Technologies LLP");
        cn.setSupplierGstin("23AAYFV8247N1Z3");
        cn.setSupplierStateCode("23");
        cn.setSupplierAddress("Indore, Madhya Pradesh");
        cn.setBuyerInstituteId("inst-1");
        cn.setBuyerLegalName("Shiksha Academy Pvt Ltd");
        cn.setBuyerStateCode("27");
        cn.setPlaceOfSupply("27");
        cn.setTaxHead("IGST");
        cn.setCurrency("INR");
        cn.setDescription("AI Pro subscription, 01-04-2027 to 30-04-2027");
        cn.setHsnSacCode("998315");
        cn.setBaseAmountMinor(100_000L);
        cn.setIgstRateBps(1800);
        cn.setIgstAmountMinor(18_000L);
        cn.setTotalAmountMinor(118_000L);
        cn.setIssuedAt(Instant.parse("2027-04-10T06:00:00Z"));
        return cn;
    }

    @Test
    void neutralCreditNoteLinksTheInvoiceAndHasNoBrand() throws Exception {
        when(invoiceRepo.findById("inv-1")).thenReturn(Optional.of(subscriptionInvoice()));
        PlatformCreditNote cn = creditNote("NEUTRAL");
        String t = text(pdf.renderCreditNotePdf(cn));
        assertFalse(BRAND.matcher(t).find(), t);
        assertTrue(t.contains("CREDIT NOTE"));
        assertTrue(t.contains("VT/2627/C00003"));
        assertTrue(t.contains("VT/2627/I00042"));
        assertTrue(t.contains("01 Apr 2027"), "original invoice date");
        assertTrue(t.contains("10 Apr 2027"));
        assertTrue(t.contains("Section 34"));
        assertTrue(t.contains("1,180.00"), "credited total in rupees");
        assertTrue(t.contains("Vidyayatan Technologies LLP"));
        assertTrue(t.contains("Refund of unused plan"));
        assertEquals("VT-2627-C00003.pdf", pdf.fileName(cn));
    }

    @Test
    void vacademyCreditNoteShowsTradeName() throws Exception {
        when(invoiceRepo.findById("inv-1")).thenReturn(Optional.of(subscriptionInvoice()));
        String t = text(pdf.renderCreditNotePdf(creditNote("VACADEMY")));
        assertTrue(t.contains("Trade name: Vacademy"));
    }

    @Test
    void logoIsOnlyFetchedOverHttps() {
        assertNull(pdf.logoDataUri("http://example.com/logo.png"));
        assertNull(pdf.logoDataUri(null));
        assertNull(pdf.logoDataUri("file:///etc/passwd"));
    }
}
