package vacademy.io.admin_core_service.features.commerce.document.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceLineExtra;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CommerceInvoiceSnapshot;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.ReissueB2bRequest;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentPdfService;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.admin_core_service.features.commerce.tax.calc.CommerceTaxCalculator;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxLineInput;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxRequest;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TaxResult;
import vacademy.io.admin_core_service.features.commerce.tax.calc.TestTaxData;
import vacademy.io.admin_core_service.features.commerce.tax.enums.InvoiceAt;
import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabBasis;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabCompare;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxLineType;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.enroll_invite.entity.EnrollInvite;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoicePaymentLogMappingRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.admin_core_service.features.user_subscription.entity.PaymentLog;
import vacademy.io.admin_core_service.features.user_subscription.entity.UserPlan;
import vacademy.io.admin_core_service.features.user_subscription.repository.PaymentLogRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyIterable;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Issue, bill-book entry, cancel and reissue. Rates come from {@link TestTaxData} (TEST placeholders). */
class CommerceInvoiceServiceTest {

    private static final String INST = "inst-1";
    private static final String UP = "09";
    /** Sample numbers with a valid check character; not parties to anything. */
    private static final String SELLER_GSTIN = "09AAACH7409R1ZZ";
    private static final String BUYER_GSTIN = "27AAPFU0939F1ZV";

    private InvoiceRepository invoices;
    private InvoicePaymentLogMappingRepository mappings;
    private PaymentLogRepository paymentLogs;
    private CommerceDocumentSeriesRepository seriesRepository;
    private CommerceDocumentNumberService numberService;
    private CommerceTaxSettingService taxSettings;
    private CommerceSellerLookup sellerLookup;
    private CommerceCreditNoteService creditNotes;
    private CommerceAuditService audit;
    private CommerceDocumentPdfService pdfService;
    private CommerceInvoiceService service;

    private final CommerceTaxCalculator calculator = new CommerceTaxCalculator();

    @BeforeEach
    void setUp() {
        invoices = mock(InvoiceRepository.class);
        mappings = mock(InvoicePaymentLogMappingRepository.class);
        paymentLogs = mock(PaymentLogRepository.class);
        seriesRepository = mock(CommerceDocumentSeriesRepository.class);
        numberService = mock(CommerceDocumentNumberService.class);
        taxSettings = mock(CommerceTaxSettingService.class);
        sellerLookup = mock(CommerceSellerLookup.class);
        creditNotes = mock(CommerceCreditNoteService.class);
        audit = mock(CommerceAuditService.class);
        pdfService = mock(CommerceDocumentPdfService.class);
        DocumentClock clock = mock(DocumentClock.class);
        when(clock.today(anyString())).thenReturn(LocalDate.of(2026, 11, 14));

        when(invoices.saveAndFlush(any(Invoice.class))).thenAnswer(inv -> {
            Invoice invoice = inv.getArgument(0);
            if (invoice.getId() == null) {
                invoice.setId("inv-new");
            }
            return invoice;
        });
        when(invoices.save(any(Invoice.class))).thenAnswer(inv -> inv.getArgument(0));
        when(mappings.findCommerceDocumentsByPaymentLogIds(anyCollection())).thenReturn(List.of());
        when(paymentLogs.lockIdsInOrder(anyCollection()))
                .thenAnswer(inv -> new ArrayList<>((java.util.Collection<String>) inv.getArgument(0)));
        when(paymentLogs.findAllById(anyIterable())).thenAnswer(inv -> {
            List<PaymentLog> logs = new ArrayList<>();
            for (Object id : (Iterable<?>) inv.getArgument(0)) {
                logs.add(log((String) id, INST));
            }
            return logs;
        });
        settings(TaxMode.REGULAR, true);
        when(sellerLookup.resolve(eq(INST), any(), any())).thenReturn(CommerceSellerLookup.Seller.builder()
                .gstin(SELLER_GSTIN).stateCode(UP).legalName("Test Seller TEST").address("1 Test Road").build());
        when(numberService.allocate(eq(INST), any(), anyString(), any(), any(), any(), anyString()))
                .thenReturn(new DocumentNumberAllocator.Allocation("series-1", 42, "CC/2627-00042"));

        service = new CommerceInvoiceService(invoices, mappings, paymentLogs, seriesRepository, numberService,
                taxSettings, sellerLookup, creditNotes, clock, audit, pdfService);
    }

    private void settings(TaxMode mode, boolean configured) {
        when(taxSettings.context(INST)).thenReturn(CommerceTaxContext.builder()
                .configured(configured).mode(mode)
                .slabBasis(SlabBasis.NET_UNIT_PRICE).slabCompare(SlabCompare.TAX_EXCLUSIVE)
                .roundTotalTo(RoundTotalTo.NONE).invoiceAt(InvoiceAt.PACKED)
                .sellerGstin(SELLER_GSTIN).sellerStateCode(UP).fyStartMonth(4).build());
    }

    private static PaymentLog log(String id, String instituteId) {
        EnrollInvite invite = new EnrollInvite();
        invite.setInstituteId(instituteId);
        UserPlan plan = new UserPlan();
        plan.setEnrollInvite(invite);
        PaymentLog paymentLog = new PaymentLog();
        paymentLog.setId(id);
        paymentLog.setUserPlan(plan);
        return paymentLog;
    }

    private TaxResult tax(TaxMode mode) {
        return calculator.calculate(TaxRequest.builder()
                .mode(mode).sellerStateCode(UP).placeOfSupplyState(UP).date(TestTaxData.DATE_TEST)
                .lines(List.of(
                        TaxLineInput.builder().lineRef("line-1").lineType(TaxLineType.ITEM).description("Item one")
                                .unitPrice(new BigDecimal("525.00")).quantity(2)
                                .taxClass(TestTaxData.slabbedClassTest()).build(),
                        TaxLineInput.builder().lineRef("line-2").lineType(TaxLineType.SHIPPING)
                                .description("Shipping").unitPrice(new BigDecimal("118.00")).quantity(1)
                                .taxClass(TestTaxData.flatClassTest()).build()))
                .build());
    }

    private CommerceInvoiceRequest request(TaxMode mode) {
        return CommerceInvoiceRequest.builder()
                .commerceOrderId("order-1").orderNumber("ORD-1001").channel("ONLINE").locationId("loc-1")
                .userId("user-1").buyerName("Buyer TEST").buyerPhone("9000000000")
                .billingAddress("2 Test Street").tax(tax(mode))
                .lineExtras(List.of(CommerceInvoiceLineExtra.builder().lineRef("line-1").sku("SKU-1")
                        .packageSessionId("ps-1").pieceId("piece-1").build()))
                .paymentLogIds(List.of("pl-1", "pl-2"))
                .build();
    }

    // ------------------------------------------------------------------ issue

    @Test
    void issueRunsOnlyInsideTheCallersTransaction() throws Exception {
        Transactional issue = CommerceInvoiceService.class
                .getMethod("issue", String.class, CommerceInvoiceRequest.class).getAnnotation(Transactional.class);
        assertEquals(Propagation.MANDATORY, issue.propagation(),
                "a number taken in its own transaction would survive the rollback of its document");
        Transactional allocate = CommerceDocumentNumberService.class.getMethod("allocate", String.class,
                DocumentType.class, String.class, String.class, String.class, String.class, String.class)
                .getAnnotation(Transactional.class);
        assertEquals(Propagation.MANDATORY, allocate.propagation());
    }

    @Test
    void aRegularSellerGetsATaxInvoiceWithATaxSnapshotPerLineAndAMappingPerLog() {
        CommerceInvoiceService.Issued issued = service.issue(INST, request(TaxMode.REGULAR));

        Invoice invoice = issued.invoice();
        assertFalse(issued.alreadyExisted());
        assertEquals("TAX_INVOICE", invoice.getDocumentType());
        assertTrue(invoice.isCommerceDocument());
        assertEquals("CC/2627-00042", invoice.getInvoiceNumber());
        assertEquals("series-1", invoice.getSeriesId());
        assertEquals("CGST_SGST", invoice.getTaxHead());
        assertEquals(SELLER_GSTIN, invoice.getSellerGstin());
        assertEquals(UP, invoice.getSellerStateCode());
        assertEquals(UP, invoice.getPlaceOfSupplyState());
        assertEquals("order-1", invoice.getCommerceOrderId());
        assertEquals("ONLINE", invoice.getChannel());
        assertEquals("loc-1", invoice.getLocationId());
        assertEquals(LocalDate.of(2026, 11, 14), invoice.getDocumentDate());
        assertEquals(0, new BigDecimal("1168.00").compareTo(invoice.getTotalAmount()));
        assertEquals(0, new BigDecimal("1100.00").compareTo(invoice.getSubtotal()));
        assertEquals(0, new BigDecimal("68.00").compareTo(invoice.getTaxAmount()));
        assertNull(invoice.getSeqNo(), "the course numbering counter is not touched");

        assertEquals(2, invoice.getLineItems().size());
        InvoiceLineItem item = invoice.getLineItems().get(0);
        assertEquals("COMMERCE_ITEM", item.getItemType());
        assertEquals("line-1", item.getSourceId());
        assertEquals("0000", item.getHsnCode());
        assertEquals(2, item.getQuantity().intValue());
        assertEquals(0, new BigDecimal("1000.00").compareTo(item.getTaxableValue()));
        assertEquals(0, new BigDecimal("25.00").compareTo(item.getCgst()));
        assertEquals(0, new BigDecimal("25.00").compareTo(item.getSgst()));
        assertEquals(0, new BigDecimal("1050.00").compareTo(item.getAmount()));
        assertEquals("ps-1", item.getPackageSessionId());
        assertEquals("piece-1", item.getPieceId());
        assertEquals("COMMERCE_SHIPPING", invoice.getLineItems().get(1).getItemType());

        assertEquals(2, invoice.getPaymentLogMappings().size(), "one mapping row for every log of the order");
        assertEquals("pl-1", invoice.getPaymentLogMappings().get(0).getPaymentLog().getId());

        CommerceInvoiceSnapshot snapshot = CommerceInvoiceService.readSnapshot(invoice);
        assertTrue(snapshot.isCommerce());
        assertEquals("ORD-1001", snapshot.getOrderNumber());
        assertEquals(0, new BigDecimal("1168.00").compareTo(snapshot.getTax().getTotal()));
        assertEquals(2, snapshot.getTax().getRateRows().size());
        verify(pdfService).storeInvoicePdfAfterCommit("inv-new");
    }

    @Test
    void theNumberIsTakenLastAfterEveryCheckAndRightBeforeTheInsert() {
        service.issue(INST, request(TaxMode.REGULAR));

        InOrder order = inOrder(taxSettings, sellerLookup, paymentLogs, numberService, invoices);
        order.verify(taxSettings).context(INST);
        order.verify(sellerLookup).resolve(eq(INST), eq("loc-1"), any());
        order.verify(paymentLogs).findAllById(anyIterable());
        order.verify(numberService).allocate(INST, DocumentType.TAX_INVOICE, "2026-27", SELLER_GSTIN, "loc-1", null,
                "ONLINE");
        order.verify(invoices).saveAndFlush(any(Invoice.class));
    }

    @Test
    void compositionGetsABillOfSupplyAndUnregisteredAPlainInvoice() {
        settings(TaxMode.COMPOSITION, true);
        Invoice bill = service.issue(INST, request(TaxMode.COMPOSITION)).invoice();
        assertEquals("BILL_OF_SUPPLY", bill.getDocumentType());
        assertEquals("NONE", bill.getTaxHead());
        assertEquals(0, BigDecimal.ZERO.compareTo(bill.getTaxAmount()));
        assertEquals(0, BigDecimal.ZERO.compareTo(bill.getLineItems().get(0).getCgst()));

        settings(TaxMode.UNREGISTERED, true);
        when(sellerLookup.resolve(eq(INST), any(), any())).thenReturn(CommerceSellerLookup.Seller.builder().build());
        Invoice plain = service.issue(INST, request(TaxMode.UNREGISTERED)).invoice();
        assertEquals("INVOICE", plain.getDocumentType());
        assertNull(plain.getSellerGstin());
        verify(numberService).allocate(eq(INST), eq(DocumentType.INVOICE), anyString(), isNull(), any(), any(),
                anyString());
    }

    @Test
    void aB2bSaleCarriesTheBuyerGstinAndABadOneIsRefusedBeforeANumberIsTaken() {
        CommerceInvoiceRequest b2b = request(TaxMode.REGULAR);
        b2b.setBuyerGstin(BUYER_GSTIN.toLowerCase());
        assertEquals(BUYER_GSTIN, service.issue(INST, b2b).invoice().getBuyerGstin());

        CommerceInvoiceRequest bad = request(TaxMode.REGULAR);
        bad.setBuyerGstin("27AAPFU0939F1ZX");
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, bad));
        verify(numberService).allocate(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void anOrderThatAlreadyHasALiveDocumentGetsItBackAndNoSecondNumber() {
        Invoice existing = new Invoice();
        existing.setId("inv-old");
        existing.setInstituteId(INST);
        existing.setDocumentType("TAX_INVOICE");
        existing.setTotalAmount(new BigDecimal("1168.00"));
        when(mappings.findCommerceDocumentsByPaymentLogIds(anyCollection())).thenReturn(List.of(existing));
        when(creditNotes.hasCreditNotes(INST, "inv-old")).thenReturn(false);

        CommerceInvoiceService.Issued issued = service.issue(INST, request(TaxMode.REGULAR));

        assertTrue(issued.alreadyExisted());
        assertSame(existing, issued.invoice());
        verify(numberService, never()).allocate(any(), any(), any(), any(), any(), any(), any());
        verify(invoices, never()).saveAndFlush(any());
    }

    @Test
    void theOrdersPaymentLogsAreLockedBeforeTheLiveDocumentIsLookedFor() {
        // Two issuers of one order (the pack step and the retry job) must run one after the
        // other: without the lock both read "no live document" and both take a number.
        service.issue(INST, request(TaxMode.REGULAR));

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(paymentLogs, mappings, numberService);
        order.verify(paymentLogs).lockIdsInOrder(anyCollection());
        order.verify(mappings).findCommerceDocumentsByPaymentLogIds(anyCollection());
        order.verify(numberService).allocate(eq(INST), any(), anyString(), any(), any(), any(), anyString());
    }

    @Test
    void aPaymentLogThatCannotBeLockedStopsTheDocument() {
        when(paymentLogs.lockIdsInOrder(anyCollection())).thenReturn(List.of());

        assertThrows(vacademy.io.common.exceptions.InvalidRequestException.class,
                () -> service.issue(INST, request(TaxMode.REGULAR)));
        verify(numberService, never()).allocate(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void aCancelledDocumentDoesNotBlockANewOne() {
        Invoice cancelled = new Invoice();
        cancelled.setId("inv-cancelled");
        cancelled.setInstituteId(INST);
        cancelled.setDocumentType("TAX_INVOICE");
        cancelled.setCancelledAt(java.time.LocalDateTime.now());
        when(mappings.findCommerceDocumentsByPaymentLogIds(anyCollection())).thenReturn(List.of(cancelled));

        assertFalse(service.issue(INST, request(TaxMode.REGULAR)).alreadyExisted());
    }

    @Test
    void anOrderWhoseInvoiceWasCreditedInFullGetsNoSecondInvoice() {
        // A returned order: the retry job, or a second pack click, must not bill it again.
        Invoice cancelled = new Invoice();
        cancelled.setId("inv-cancelled");
        cancelled.setInstituteId(INST);
        cancelled.setDocumentType("TAX_INVOICE");
        cancelled.setCancelledAt(java.time.LocalDateTime.now());
        Invoice credited = new Invoice();
        credited.setId("inv-credited");
        credited.setInstituteId(INST);
        credited.setDocumentType("TAX_INVOICE");
        credited.setTotalAmount(new BigDecimal("1168.00"));
        when(mappings.findCommerceDocumentsByPaymentLogIds(anyCollection())).thenReturn(List.of(cancelled, credited));
        when(creditNotes.hasCreditNotes(INST, "inv-credited")).thenReturn(true);
        when(creditNotes.creditedTotal(INST, "inv-credited")).thenReturn(new BigDecimal("1168.00"));

        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, request(TaxMode.REGULAR)))
                .getMessage().startsWith("INVOICE_FULLY_CREDITED"));
        verify(numberService, never()).allocate(any(), any(), any(), any(), any(), any(), any());
        verify(invoices, never()).saveAndFlush(any(Invoice.class));
    }

    @Test
    void theRepackOfAnUnpackedOrderGetsANewInvoiceOnlyWithTheFlag() {
        // Unpack credited the first invoice in full; the order desk re-packs it with the flag.
        Invoice credited = new Invoice();
        credited.setId("inv-credited");
        credited.setInstituteId(INST);
        credited.setDocumentType("TAX_INVOICE");
        credited.setTotalAmount(new BigDecimal("1168.00"));
        when(mappings.findCommerceDocumentsByPaymentLogIds(anyCollection())).thenReturn(List.of(credited));
        when(creditNotes.hasCreditNotes(INST, "inv-credited")).thenReturn(true);
        when(creditNotes.creditedTotal(INST, "inv-credited")).thenReturn(new BigDecimal("1168.00"));

        assertFalse(request(TaxMode.REGULAR).isAllowAfterFullCredit(), "the flag is off unless the desk sets it");
        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, request(TaxMode.REGULAR)))
                .getMessage().startsWith("INVOICE_FULLY_CREDITED"));

        CommerceInvoiceRequest repack = request(TaxMode.REGULAR);
        repack.setAllowAfterFullCredit(true);
        assertFalse(service.issue(INST, repack).alreadyExisted(), "a second invoice is issued");
        verify(invoices).saveAndFlush(any(Invoice.class));
    }

    @Test
    void afterAB2bReissueTheOrderStillHasItsLiveInvoice() {
        Invoice credited = new Invoice();
        credited.setId("inv-credited");
        credited.setInstituteId(INST);
        credited.setDocumentType("TAX_INVOICE");
        credited.setTotalAmount(new BigDecimal("1168.00"));
        Invoice reissued = new Invoice();
        reissued.setId("inv-b2b");
        reissued.setInstituteId(INST);
        reissued.setDocumentType("TAX_INVOICE");
        reissued.setTotalAmount(new BigDecimal("1168.00"));
        when(mappings.findCommerceDocumentsByPaymentLogIds(anyCollection())).thenReturn(List.of(credited, reissued));
        when(creditNotes.hasCreditNotes(INST, "inv-credited")).thenReturn(true);
        when(creditNotes.creditedTotal(INST, "inv-credited")).thenReturn(new BigDecimal("1168.00"));

        CommerceInvoiceService.Issued issued = service.issue(INST, request(TaxMode.REGULAR));

        assertTrue(issued.alreadyExisted());
        assertEquals("inv-b2b", issued.invoice().getId());
    }

    @Test
    void nothingIsNumberedWhenTheDocumentCannotBeIssued() {
        // Tax settings never saved.
        settings(TaxMode.REGULAR, false);
        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, request(TaxMode.REGULAR)))
                .getMessage().startsWith("TAX_NOT_CONFIGURED"));

        // The order was taxed for another seller state than the location is in.
        settings(TaxMode.REGULAR, true);
        when(sellerLookup.resolve(eq(INST), any(), any())).thenReturn(CommerceSellerLookup.Seller.builder()
                .gstin(BUYER_GSTIN).stateCode("27").build());
        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, request(TaxMode.REGULAR)))
                .getMessage().startsWith("TAX_SNAPSHOT_STALE"));

        // A regular seller without a GSTIN.
        when(sellerLookup.resolve(eq(INST), any(), any())).thenReturn(CommerceSellerLookup.Seller.builder().build());
        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, request(TaxMode.REGULAR)))
                .getMessage().startsWith("SELLER_GSTIN_MISSING"));

        verify(numberService, never()).allocate(any(), any(), any(), any(), any(), any(), any());
        verify(invoices, never()).saveAndFlush(any());
    }

    @Test
    void aSnapshotThatDoesNotAddUpOrAForeignPaymentLogIsRefused() {
        CommerceInvoiceRequest broken = request(TaxMode.REGULAR);
        broken.getTax().setTotal(new BigDecimal("1.00"));
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, broken));

        CommerceInvoiceRequest noLogs = request(TaxMode.REGULAR);
        noLogs.setPaymentLogIds(List.of());
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, noLogs));

        when(paymentLogs.findAllById(anyIterable())).thenReturn(List.of(log("pl-1", "another-institute"),
                log("pl-2", INST)));
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, request(TaxMode.REGULAR)));

        when(paymentLogs.findAllById(anyIterable())).thenReturn(List.of(log("pl-1", INST)));
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, request(TaxMode.REGULAR)),
                "a log that was not found");

        verify(numberService, never()).allocate(any(), any(), any(), any(), any(), any(), any());
    }

    // ------------------------------------------------------------------ bill book

    private CommerceDocumentSeries book(long from, long to) {
        CommerceDocumentSeries book = new CommerceDocumentSeries();
        book.setId("book-1");
        book.setInstituteId(INST);
        book.setKind("MANUAL_BOOK");
        book.setStatus("ACTIVE");
        book.setDocumentType("TAX_INVOICE");
        book.setLocationId("loc-1");
        book.setPrefix("BK1/");
        book.setFinancialYear("2026-27");
        book.setBookFrom(from);
        book.setBookTo(to);
        return book;
    }

    @Test
    void aBillBookEntryKeepsThePaperNumberAndMovesNoCounter() {
        when(seriesRepository.findByInstituteIdAndDocumentTypeAndStatus(INST, "TAX_INVOICE", "ACTIVE"))
                .thenReturn(List.of(book(101, 150)));
        CommerceInvoiceRequest entry = request(TaxMode.REGULAR);
        entry.setChannel("POS");
        entry.setExternalInvoiceNumber("117");
        entry.setDocumentDate(LocalDate.of(2026, 11, 10));

        Invoice invoice = service.issue(INST, entry).invoice();

        assertEquals("117", invoice.getExternalInvoiceNumber());
        assertEquals("BK1/2627-00117", invoice.getInvoiceNumber());
        assertEquals("book-1", invoice.getSeriesId());
        assertEquals(LocalDate.of(2026, 11, 10), invoice.getDocumentDate());
        verify(numberService, never()).allocate(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void aPaperNumberOutsideARegisteredBookOrAlreadyEnteredIsRefused() {
        when(seriesRepository.findByInstituteIdAndDocumentTypeAndStatus(INST, "TAX_INVOICE", "ACTIVE"))
                .thenReturn(List.of(book(101, 150)));
        CommerceInvoiceRequest outside = request(TaxMode.REGULAR);
        outside.setExternalInvoiceNumber("151");
        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, outside))
                .getMessage().startsWith("BILL_BOOK_NOT_REGISTERED"));

        when(invoices.existsByInstituteIdAndInvoiceNumber(INST, "BK1/2627-00117")).thenReturn(true);
        CommerceInvoiceRequest used = request(TaxMode.REGULAR);
        used.setExternalInvoiceNumber("117");
        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, used))
                .getMessage().startsWith("BILL_BOOK_NUMBER_USED"));
        verify(invoices, never()).saveAndFlush(any());
    }

    @Test
    void m7_aPaperBillGoesToTheBookOfItsDatesFinancialYear() {
        // The 2025-26 book 1..200 is still ACTIVE next to the 2026-27 book 1..200, same location.
        CommerceDocumentSeries old = book(1, 200);
        old.setId("book-old");
        old.setPrefix("BK0/");
        old.setFinancialYear("2025-26");
        CommerceDocumentSeries current = book(1, 200);
        current.setId("book-new");
        when(seriesRepository.findByInstituteIdAndDocumentTypeAndStatus(INST, "TAX_INVOICE", "ACTIVE"))
                .thenReturn(List.of(old, current));
        CommerceInvoiceRequest april = request(TaxMode.REGULAR);
        april.setChannel("POS");
        april.setExternalInvoiceNumber("57");
        april.setDocumentDate(LocalDate.of(2026, 4, 2));
        Invoice invoice = service.issue(INST, april).invoice();
        assertEquals("book-new", invoice.getSeriesId(), "FY 2026-27 by the bill's date");
        assertEquals("BK1/2627-00057", invoice.getInvoiceNumber());

        CommerceInvoiceRequest march = request(TaxMode.REGULAR);
        march.setChannel("POS");
        march.setExternalInvoiceNumber("57");
        march.setDocumentDate(LocalDate.of(2026, 3, 30));
        assertEquals("book-old", service.issue(INST, march).invoice().getSeriesId(), "FY 2025-26");

        // No book of the bill's year: refused, never filed in another year's book.
        when(seriesRepository.findByInstituteIdAndDocumentTypeAndStatus(INST, "TAX_INVOICE", "ACTIVE"))
                .thenReturn(List.of(old));
        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, april)).getMessage()
                .startsWith("BILL_BOOK_NOT_REGISTERED"));
    }

    // ------------------------------------------------------------------ cancel, reissue

    private Invoice issuedInvoice() {
        Invoice invoice = service.issue(INST, request(TaxMode.REGULAR)).invoice();
        invoice.setId("inv-1");
        when(invoices.findById("inv-1")).thenReturn(Optional.of(invoice));
        when(invoices.lockForCredit(INST, "inv-1")).thenReturn("inv-1");
        when(mappings.findPaymentLogIdsByInvoiceId("inv-1")).thenReturn(List.of("pl-1", "pl-2"));
        return invoice;
    }

    @Test
    void cancelKeepsTheRowAndItsNumber() {
        Invoice invoice = issuedInvoice();

        Invoice cancelled = service.cancel(INST, "manager-1", "inv-1", "voided in the same session");

        assertNotNull(cancelled.getCancelledAt());
        assertEquals("CANCELLED", cancelled.getStatus());
        assertEquals("CC/2627-00042", cancelled.getInvoiceNumber());
        verify(invoices, never()).delete(any());
        verify(audit).record(eq(INST), eq("manager-1"), eq("loc-1"), eq("INVOICE_CANCELLED"), eq("INVOICE"),
                eq("inv-1"), isNull(), anyString(), eq("voided in the same session"));

        when(creditNotes.hasCreditNotes(INST, "inv-1")).thenReturn(true);
        invoice.setCancelledAt(null);
        assertThrows(ConflictException.class, () -> service.cancel(INST, "manager-1", "inv-1", "again"));
    }

    @Test
    void aCourseInvoiceOrAnotherInstitutesInvoiceIsNotFoundHere() {
        Invoice course = new Invoice();
        course.setId("inv-course");
        course.setInstituteId(INST);
        when(invoices.findById("inv-course")).thenReturn(Optional.of(course));
        assertThrows(vacademy.io.common.exceptions.ResourceNotFoundException.class,
                () -> service.requireDocument(INST, "inv-course"));

        issuedInvoice();
        assertThrows(vacademy.io.common.exceptions.ResourceNotFoundException.class,
                () -> service.requireDocument("another-institute", "inv-1"));
    }

    @Test
    void reissueAsB2bCreditsTheFirstInvoiceInFullThenIssuesANewOneWithTheGstin() {
        issuedInvoice();
        when(numberService.allocate(eq(INST), any(), anyString(), any(), any(), any(), anyString()))
                .thenReturn(new DocumentNumberAllocator.Allocation("series-1", 43, "CC/2627-00043"));
        when(invoices.saveAndFlush(any(Invoice.class))).thenAnswer(inv -> {
            Invoice invoice = inv.getArgument(0);
            invoice.setId("inv-2");
            return invoice;
        });

        CommerceInvoiceDTO reissued = service.reissueAsB2b(INST, "manager-1", "inv-1",
                ReissueB2bRequest.builder().buyerGstin(BUYER_GSTIN).buyerName("Buyer Pvt Ltd TEST").build());

        ArgumentCaptor<CreditNoteRequest> credit = ArgumentCaptor.forClass(CreditNoteRequest.class);
        InOrder order = inOrder(creditNotes, numberService);
        order.verify(creditNotes).issue(eq(INST), eq("manager-1"), credit.capture());
        order.verify(numberService).allocate(eq(INST), eq(DocumentType.TAX_INVOICE), anyString(), any(), any(),
                any(), anyString());
        assertEquals("inv-1", credit.getValue().getInvoiceId());
        assertEquals(Boolean.TRUE, credit.getValue().getFull());

        assertEquals("inv-2", reissued.getId());
        assertEquals("CC/2627-00043", reissued.getInvoiceNumber());
        assertEquals(BUYER_GSTIN, reissued.getBuyerGstin());
        assertEquals(0, new BigDecimal("1168.00").compareTo(reissued.getTotal()));

        ArgumentCaptor<Invoice> saved = ArgumentCaptor.forClass(Invoice.class);
        verify(invoices, org.mockito.Mockito.atLeastOnce()).saveAndFlush(saved.capture());
        Invoice second = saved.getValue();
        assertEquals(2, second.getPaymentLogMappings().size());
        CommerceInvoiceSnapshot snapshot = CommerceInvoiceService.readSnapshot(second);
        assertEquals("CC/2627-00042", snapshot.getReplacesInvoiceNumber());
        assertEquals("Buyer Pvt Ltd TEST", snapshot.getBuyerName());
        assertEquals("SKU-1", snapshot.getLineExtras().get(0).getSku());
    }

    @Test
    void reissueIsRefusedForABadGstinAnInvoiceThatHasOneOrOneWithACreditNote() {
        Invoice invoice = issuedInvoice();

        assertThrows(InvalidRequestException.class, () -> service.reissueAsB2b(INST, "m", "inv-1",
                ReissueB2bRequest.builder().buyerGstin("not-a-gstin").build()));

        when(creditNotes.hasCreditNotes(INST, "inv-1")).thenReturn(true);
        assertThrows(ConflictException.class, () -> service.reissueAsB2b(INST, "m", "inv-1",
                ReissueB2bRequest.builder().buyerGstin(BUYER_GSTIN).build()));

        when(creditNotes.hasCreditNotes(INST, "inv-1")).thenReturn(false);
        invoice.setBuyerGstin(BUYER_GSTIN);
        assertThrows(ConflictException.class, () -> service.reissueAsB2b(INST, "m", "inv-1",
                ReissueB2bRequest.builder().buyerGstin(BUYER_GSTIN).build()));

        verify(creditNotes, never()).issue(any(), any(), any());
    }
}
