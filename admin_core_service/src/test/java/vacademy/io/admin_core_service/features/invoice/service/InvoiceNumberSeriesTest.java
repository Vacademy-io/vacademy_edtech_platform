package vacademy.io.admin_core_service.features.invoice.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberAllocation;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberConfig;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberContext;
import vacademy.io.admin_core_service.features.invoice.repository.InvoiceRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * An institute with two branches numbers each branch's receipts from its own counter, picked
 * by the learner's branch field; anyone else stays on the main series.
 */
class InvoiceNumberSeriesTest {

    private static final String INST = "inst-1";
    private static final String FIELD = "field-branch";

    private InvoiceRepository invoiceRepository;
    private InvoiceNumberService service;

    @BeforeEach
    void setUp() {
        invoiceRepository = mock(InvoiceRepository.class);
        EntityManager entityManager = mock(EntityManager.class);
        Query released = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(released);
        when(released.setParameter(any(Integer.class), any())).thenReturn(released);
        when(released.getResultList()).thenReturn(List.of());
        when(invoiceRepository.highestSeqNo(eq(INST), anyString())).thenReturn(0L);

        service = new InvoiceNumberService();
        ReflectionTestUtils.setField(service, "invoiceRepository", invoiceRepository);
        ReflectionTestUtils.setField(service, "entityManager", entityManager);
    }

    /** Main series = branch A from 7115; series B from 2318 for "Branch B" / "Branch B East". */
    private static InvoiceNumberConfig config() {
        return InvoiceNumberConfig.fromInvoiceSettings(Map.of(
                "numbering", Map.of("format", "RCPT-A-{{seq}}", "seqScope", "NEVER",
                        "seqPadding", 1, "startFrom", 7115),
                "numberingSeries", List.of(Map.of(
                        "key", "b", "format", "RCPT-B-{{seq}}", "startFrom", 2318,
                        "learnerFieldId", FIELD, "values", List.of("Branch B", "Branch B East")))));
    }

    private static InvoiceNumberContext context(Function<String, String> lookup) {
        return InvoiceNumberContext.builder().instituteId(INST).date(LocalDate.of(2026, 10, 15))
                .learnerFieldLookup(lookup).build();
    }

    @Test
    @DisplayName("a learner of branch B gets the B series and its own counter")
    void branchSeries() {
        InvoiceNumberAllocation a = service.generate(config(), context(id -> FIELD.equals(id) ? " branch b east " : null));
        assertEquals("RCPT-B-2318", a.number());
        assertEquals("SERIES_B:ALL", a.scopeKey());
        assertEquals(2318L, a.seqNo());
    }

    @Test
    @DisplayName("branch A, no branch, no learner or a failed lookup stay on the main series")
    void mainSeries() {
        assertEquals("RCPT-A-7115", service.generate(config(), context(id -> "Branch A")).number());
        assertEquals("ALL", service.generate(config(), context(id -> "Branch A")).scopeKey());
        assertEquals("RCPT-A-7115", service.generate(config(), context(id -> null)).number());
        assertEquals("RCPT-A-7115", service.generate(config(), context(null)).number());
        assertEquals("RCPT-A-7115", service.generate(config(), context(id -> {
            throw new IllegalStateException("db down");
        })).number());
    }

    @Test
    @DisplayName("each series counts on from its own highest number")
    void countersAreIndependent() {
        when(invoiceRepository.highestSeqNo(INST, "SERIES_B:ALL")).thenReturn(2320L);
        when(invoiceRepository.highestSeqNo(INST, "ALL")).thenReturn(7200L);
        assertEquals("RCPT-B-2321", service.generate(config(), context(id -> "Branch B")).number());
        assertEquals("RCPT-A-7201", service.generate(config(), context(id -> "Branch A")).number());
    }

    @Test
    @DisplayName("preview and collision retry use the same series as generate")
    void previewAndRetryAgree() {
        assertEquals("RCPT-B-2318", service.preview(config(), context(id -> "Branch B")));
        assertEquals("RCPT-B-2319", service.nextAfterCollision(config(), context(id -> "Branch B"), 1).number());
    }

    @Test
    @DisplayName("a document with its own namespace (proforma) ignores the series")
    void namespaceWins() {
        InvoiceNumberContext ctx = context(id -> "Branch B");
        ctx.setSeqNamespace("PRO");
        InvoiceNumberAllocation a = service.generate(config(), ctx);
        assertEquals("PRO:ALL", a.scopeKey());
        assertEquals("RCPT-A-7115", a.number());
    }

    @Test
    @DisplayName("bad series entries are skipped; no setting means no series")
    void parsing() {
        List<InvoiceNumberConfig.Series> parsed = InvoiceNumberConfig.parseSeries(List.of(
                Map.of("key", "OK", "format", "X-{{seq}}", "learnerFieldId", FIELD, "values", List.of("v")),
                Map.of("key", "THIS_KEY_IS_TOO_LONG", "format", "X-{{seq}}", "learnerFieldId", FIELD, "values", List.of("v")),
                Map.of("key", "NOFMT", "learnerFieldId", FIELD, "values", List.of("v")),
                Map.of("key", "NOVALUES", "format", "X-{{seq}}", "learnerFieldId", FIELD, "values", List.of()),
                "not a map"));
        assertEquals(1, parsed.size());
        assertEquals("OK", parsed.get(0).getKey());
        assertTrue(InvoiceNumberConfig.legacyDefault().getSeries().isEmpty());
        assertTrue(InvoiceNumberConfig.fromInvoiceSettings(Map.of()).getSeries().isEmpty());
        assertTrue(InvoiceNumberConfig.parseSeries(null).isEmpty());
    }

    @Test
    @DisplayName("the ask-on-first-payment policy is off unless set, and needs a series")
    void policy() {
        assertFalse(InvoiceNumberConfig.fromInvoiceSettings(Map.of()).asksOnFirstPayment());
        assertFalse(config().asksOnFirstPayment());
        Map<String, Object> on = new java.util.HashMap<>(Map.of(
                "numberingSeriesPolicy", Map.of("askOnFirstPayment", true, "required", true)));
        assertFalse(InvoiceNumberConfig.fromInvoiceSettings(on).asksOnFirstPayment(), "no series, nothing to ask");
        on.put("numberingSeries", List.of(Map.of("key", "B", "format", "RCPT-B-{{seq}}",
                "learnerFieldId", FIELD, "values", List.of("Branch B"))));
        InvoiceNumberConfig c = InvoiceNumberConfig.fromInvoiceSettings(on);
        assertTrue(c.asksOnFirstPayment());
        assertTrue(c.getSeriesPolicy().isRequired());
        assertEquals(FIELD, c.askFieldId());
    }

    @Test
    @DisplayName("an institute without series numbers exactly as before")
    void noSeriesUnchanged() {
        InvoiceNumberContext ctx = context(id -> "Branch B");
        InvoiceNumberAllocation a = service.generate(InvoiceNumberConfig.legacyDefault(), ctx);
        assertEquals("INV-20261015-0001", a.number());
        assertNull(ctx.getSeqNamespace());
    }
}
