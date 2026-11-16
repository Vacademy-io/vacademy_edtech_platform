package vacademy.io.admin_core_service.features.commerce.document.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import vacademy.io.admin_core_service.features.commerce.audit.CommerceAuditService;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteDTO;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteLineRequest;
import vacademy.io.admin_core_service.features.commerce.document.dto.CreditNoteRequest;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNote;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceCreditNoteLine;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommerceDocumentPdfService;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteLineRepository;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceCreditNoteRepository;
import vacademy.io.admin_core_service.features.commerce.tax.enums.InvoiceAt;
import vacademy.io.admin_core_service.features.commerce.tax.enums.RoundTotalTo;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabBasis;
import vacademy.io.admin_core_service.features.commerce.tax.enums.SlabCompare;
import vacademy.io.admin_core_service.features.commerce.tax.enums.TaxMode;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxContext;
import vacademy.io.admin_core_service.features.commerce.tax.service.CommerceTaxSettingService;
import vacademy.io.admin_core_service.features.invoice.entity.Invoice;
import vacademy.io.admin_core_service.features.invoice.entity.InvoiceLineItem;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceLineItemRepository;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.ResourceNotFoundException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** A credit note references its invoice, mirrors its lines and takes a number from its own series. */
class CommerceCreditNoteServiceTest {

    private static final String INST = "inst-1";

    private CommerceCreditNoteRepository notes;
    private CommerceCreditNoteLineRepository noteLines;
    private InvoiceRepository invoices;
    private InvoiceLineItemRepository invoiceLines;
    private CommerceDocumentNumberService numberService;
    private CommerceDocumentPdfService pdfService;
    private CommerceCreditNoteService service;

    private Invoice invoice;
    private final List<CommerceCreditNote> savedNotes = new ArrayList<>();
    private final List<CommerceCreditNoteLine> savedLines = new ArrayList<>();

    @BeforeEach
    void setUp() {
        notes = mock(CommerceCreditNoteRepository.class);
        noteLines = mock(CommerceCreditNoteLineRepository.class);
        invoices = mock(InvoiceRepository.class);
        invoiceLines = mock(InvoiceLineItemRepository.class);
        numberService = mock(CommerceDocumentNumberService.class);
        pdfService = mock(CommerceDocumentPdfService.class);
        CommerceTaxSettingService taxSettings = mock(CommerceTaxSettingService.class);
        DocumentClock clock = mock(DocumentClock.class);
        when(clock.today(anyString())).thenReturn(LocalDate.of(2026, 11, 20));
        when(taxSettings.context(INST)).thenReturn(CommerceTaxContext.builder().configured(true)
                .mode(TaxMode.REGULAR).slabBasis(SlabBasis.NET_UNIT_PRICE).slabCompare(SlabCompare.TAX_EXCLUSIVE)
                .roundTotalTo(RoundTotalTo.RUPEE).invoiceAt(InvoiceAt.PACKED).fyStartMonth(4).build());

        // Invoice: 3 pieces for 1000.00 at 5% (TEST rate), shipping 118.00 at 18% (TEST rate),
        // rounded: 1118.00 + 0.00. A round-off of 0.40 is stored to see where it goes.
        invoice = new Invoice();
        invoice.setId("inv-1");
        invoice.setInstituteId(INST);
        invoice.setInvoiceNumber("CC/2627-00042");
        invoice.setDocumentType("TAX_INVOICE");
        invoice.setDocumentDate(LocalDate.of(2026, 11, 14));
        invoice.setTaxHead("CGST_SGST");
        invoice.setSellerGstin("09AAACH7409R1ZZ");
        invoice.setSellerStateCode("09");
        invoice.setPlaceOfSupplyState("09");
        invoice.setLocationId("loc-1");
        invoice.setChannel("ONLINE");
        invoice.setCommerceOrderId("order-1");
        invoice.setCurrency("INR");
        invoice.setRoundOff(new BigDecimal("0.40"));
        invoice.setTotalAmount(new BigDecimal("1118.40"));
        when(invoices.lockForCredit(INST, "inv-1")).thenReturn("inv-1");
        when(invoices.findById("inv-1")).thenReturn(Optional.of(invoice));
        when(invoiceLines.findByInvoiceId("inv-1")).thenReturn(List.of(
                line("il-1", 3, "1000.00", "952.38", "23.81", "23.81", "5", "0000"),
                line("il-2", 1, "118.00", "100.00", "9.00", "9.00", "18", "9999")));

        when(notes.findByInstituteIdAndInvoiceIdOrderByCreatedAtAsc(INST, "inv-1"))
                .thenAnswer(inv -> new ArrayList<>(savedNotes));
        when(noteLines.findByInstituteIdAndCreditNoteIdIn(eq(INST), anyCollection()))
                .thenAnswer(inv -> new ArrayList<>(savedLines));
        when(notes.findByInstituteIdAndClientRequestId(eq(INST), anyString())).thenAnswer(inv ->
                savedNotes.stream().filter(n -> inv.getArgument(1).equals(n.getClientRequestId())).findFirst());
        when(notes.findByInstituteIdAndId(eq(INST), anyString())).thenAnswer(inv ->
                savedNotes.stream().filter(n -> inv.getArgument(1).equals(n.getId())).findFirst());
        when(noteLines.findByInstituteIdAndCreditNoteIdOrderByCreatedAtAsc(eq(INST), anyString())).thenAnswer(inv ->
                savedLines.stream().filter(l -> inv.getArgument(1).equals(l.getCreditNoteId())).toList());
        when(notes.saveAndFlush(any(CommerceCreditNote.class))).thenAnswer(inv -> {
            CommerceCreditNote note = inv.getArgument(0);
            note.setId("cn-" + (savedNotes.size() + 1));
            savedNotes.add(note);
            return note;
        });
        when(noteLines.saveAll(anyList())).thenAnswer(inv -> {
            List<CommerceCreditNoteLine> lines = inv.getArgument(0);
            savedLines.addAll(lines);
            return lines;
        });
        when(numberService.allocate(eq(INST), eq(DocumentType.CREDIT_NOTE), anyString(), any(), any(), any(),
                anyString())).thenAnswer(inv -> new DocumentNumberAllocator.Allocation("series-cn",
                savedNotes.size() + 1, "CN/2627-0000" + (savedNotes.size() + 1)));

        service = new CommerceCreditNoteService(notes, noteLines, invoices, invoiceLines, numberService,
                taxSettings, clock, mock(CommerceAuditService.class), pdfService);
    }

    private static InvoiceLineItem line(String id, int quantity, String amount, String taxable, String cgst,
                                        String sgst, String rate, String hsn) {
        InvoiceLineItem item = new InvoiceLineItem();
        item.setId(id);
        item.setQuantity(quantity);
        item.setDescription("Line " + id);
        item.setAmount(new BigDecimal(amount));
        item.setTaxableValue(new BigDecimal(taxable));
        item.setCgst(new BigDecimal(cgst));
        item.setSgst(new BigDecimal(sgst));
        item.setIgst(new BigDecimal("0.00"));
        item.setCess(new BigDecimal("0.00"));
        item.setTaxRate(new BigDecimal(rate));
        item.setHsnCode(hsn);
        item.setPackageSessionId("ps-" + id);
        return item;
    }

    @Test
    void aFullCreditNoteMirrorsTheInvoiceAndUsesTheCreditNoteSeries() {
        CreditNoteDTO note = service.issue(INST, "manager-1",
                CreditNoteRequest.builder().clientRequestId("req-1").invoiceId("inv-1").full(true).reason("RTO").returnId("ret-1").build());

        assertEquals("CN/2627-00001", note.getCreditNoteNumber());
        assertEquals("inv-1", note.getInvoiceId());
        assertEquals("CC/2627-00042", note.getInvoiceNumber());
        assertEquals("ret-1", note.getReturnId());
        assertEquals("CGST_SGST", note.getTaxHead());
        assertEquals(LocalDate.of(2026, 11, 20), note.getDocumentDate());
        assertEquals(0, new BigDecimal("1118.40").compareTo(note.getTotal()));
        assertEquals(0, new BigDecimal("0.40").compareTo(note.getRoundOff()));
        assertEquals(0, new BigDecimal("1052.38").compareTo(note.getTaxableValue()));
        assertEquals(0, new BigDecimal("32.81").compareTo(note.getCgst()));
        assertEquals(2, note.getLines().size());
        assertEquals("0000", note.getLines().get(0).getHsnCode());
        assertEquals(3, note.getLines().get(0).getQuantity().intValue());
        assertEquals("ps-il-1", savedLines.get(0).getPackageSessionId());
        assertEquals("series-cn", savedNotes.get(0).getSeriesId());

        InOrder order = inOrder(invoices, numberService, notes);
        order.verify(invoices).lockForCredit(INST, "inv-1");
        order.verify(numberService).allocate(INST, DocumentType.CREDIT_NOTE, "2026-27", "09AAACH7409R1ZZ", "loc-1",
                null, "ONLINE");
        order.verify(notes).saveAndFlush(any(CommerceCreditNote.class));
        verify(pdfService).storeCreditNotePdfAfterCommit("cn-1");
    }

    @Test
    void partCreditNotesNeverPassTheInvoiceAndTheLastOneTakesWhatIsLeft() {
        CreditNoteDTO first = service.issue(INST, "manager-1", CreditNoteRequest.builder().clientRequestId("req-2").invoiceId("inv-1")
                .lines(List.of(CreditNoteLineRequest.builder().invoiceLineItemId("il-1").quantity(2)
                        .costTotal(new BigDecimal("400.00")).build()))
                .build());
        assertEquals(0, new BigDecimal("666.67").compareTo(first.getTotal()));
        assertEquals(0, BigDecimal.ZERO.compareTo(first.getRoundOff()), "no round-off on a part credit");
        assertEquals(0, new BigDecimal("400.00").compareTo(savedLines.get(0).getCostTotal()));

        // Two of three are credited: a third piece is fine, a second one on top is not.
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, "manager-1",
                CreditNoteRequest.builder().clientRequestId("req-3").invoiceId("inv-1")
                        .lines(List.of(CreditNoteLineRequest.builder().invoiceLineItemId("il-1").quantity(2).build()))
                        .build()));

        CreditNoteDTO rest = service.issue(INST, "manager-1",
                CreditNoteRequest.builder().clientRequestId("req-4").invoiceId("inv-1").full(true).build());
        assertEquals(0, new BigDecimal("1118.40").compareTo(first.getTotal().add(rest.getTotal())));
        assertEquals(0, new BigDecimal("0.40").compareTo(rest.getRoundOff()));
        assertEquals(0, new BigDecimal("1052.38")
                .compareTo(first.getTaxableValue().add(rest.getTaxableValue())));

        // Nothing is left.
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, "manager-1",
                CreditNoteRequest.builder().clientRequestId("req-5").invoiceId("inv-1").full(true).build()));
    }

    @Test
    void aRepeatedRequestGetsTheFirstNoteBackAndCreditsNothingMore() {
        // A line of 3 units; credit 1; the browser sends the same request again after a timeout.
        CreditNoteRequest oneUnit = CreditNoteRequest.builder().clientRequestId("cn-req-1").invoiceId("inv-1")
                .lines(List.of(CreditNoteLineRequest.builder().invoiceLineItemId("il-1").quantity(1).build()))
                .build();
        CreditNoteDTO first = service.issue(INST, "manager-1", oneUnit);
        CreditNoteDTO again = service.issue(INST, "manager-1", oneUnit);

        assertEquals(first.getId(), again.getId());
        assertEquals(first.getCreditNoteNumber(), again.getCreditNoteNumber());
        assertEquals(1, savedNotes.size(), "one credit note, not a second one for one more unit");
        assertEquals(1, savedLines.size());
        verify(numberService, org.mockito.Mockito.times(1)).allocate(any(), any(), any(), any(), any(), any(), any());
        assertEquals("cn-req-1", savedNotes.get(0).getClientRequestId());

        // The same key for something else is refused, not answered with the first note.
        CreditNoteRequest twoUnits = CreditNoteRequest.builder().clientRequestId("cn-req-1").invoiceId("inv-1")
                .lines(List.of(CreditNoteLineRequest.builder().invoiceLineItemId("il-1").quantity(2).build()))
                .build();
        assertTrue(assertThrows(ConflictException.class, () -> service.issue(INST, "manager-1", twoUnits))
                .getMessage().startsWith("REQUEST_KEY_REUSED"));
        assertEquals(1, savedNotes.size());
    }

    @Test
    void aRequestWithoutAKeyOrDatedAfterTodayIsRefusedBeforeANumberIsTaken() {
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, "m",
                CreditNoteRequest.builder().invoiceId("inv-1").full(true).build()));
        // Today is 2026-11-20. A date in April 2027 would open the 2027-28 series and take its number 1.
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, "m",
                CreditNoteRequest.builder().clientRequestId("cn-req-2").invoiceId("inv-1").full(true)
                        .documentDate(LocalDate.of(2027, 4, 2)).build()));

        verify(numberService, never()).allocate(any(), any(), any(), any(), any(), any(), any());
        assertTrue(savedNotes.isEmpty());
    }

    @Test
    void onlyALiveCommerceInvoiceOfThisInstituteCanBeCredited() {
        when(invoices.lockForCredit("another-institute", "inv-1")).thenReturn(null);
        assertThrows(ResourceNotFoundException.class, () -> service.issue("another-institute", "m",
                CreditNoteRequest.builder().clientRequestId("req-6").invoiceId("inv-1").full(true).build()));

        assertThrows(InvalidRequestException.class, () -> service.issue(INST, "m", CreditNoteRequest.builder().clientRequestId("req-7").invoiceId("inv-1")
                .lines(List.of(CreditNoteLineRequest.builder().invoiceLineItemId("il-of-another").quantity(1).build()))
                .build()));
        assertThrows(InvalidRequestException.class, () -> service.issue(INST, "m", CreditNoteRequest.builder().clientRequestId("req-8").invoiceId("inv-1").full(true).documentDate(LocalDate.of(2026, 11, 13)).build()),
                "dated before its invoice");

        invoice.setCancelledAt(java.time.LocalDateTime.now());
        assertThrows(ConflictException.class, () -> service.issue(INST, "m",
                CreditNoteRequest.builder().clientRequestId("req-9").invoiceId("inv-1").full(true).build()));

        invoice.setCancelledAt(null);
        invoice.setDocumentType(null);
        assertThrows(ResourceNotFoundException.class, () -> service.issue(INST, "m",
                CreditNoteRequest.builder().clientRequestId("req-10").invoiceId("inv-1").full(true).build()), "a course invoice");

        verify(numberService, never()).allocate(any(), any(), any(), any(), any(), any(), any());
        assertNull(savedNotes.isEmpty() ? null : savedNotes.get(0));
    }
}
