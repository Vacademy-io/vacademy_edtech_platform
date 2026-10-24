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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A number freed by a permanent invoice delete is issued again — lowest first, only in its own
 * series, never below the start-number floor — and generation counts on from MAX otherwise.
 */
class InvoiceNumberReuseTest {

    private static final String INST = "inst-1";
    private static final LocalDate DAY = LocalDate.of(2026, 9, 25);

    private InvoiceRepository invoiceRepository;
    private EntityManager entityManager;
    private Query releasedQuery;
    private InvoiceNumberService service;

    @BeforeEach
    void setUp() {
        invoiceRepository = mock(InvoiceRepository.class);
        entityManager = mock(EntityManager.class);
        releasedQuery = mock(Query.class);
        when(entityManager.createNativeQuery(anyString())).thenReturn(releasedQuery);
        when(releasedQuery.setParameter(any(Integer.class), any())).thenReturn(releasedQuery);
        when(invoiceRepository.highestSeqNo(eq(INST), anyString())).thenReturn(9L);

        service = new InvoiceNumberService();
        ReflectionTestUtils.setField(service, "invoiceRepository", invoiceRepository);
        ReflectionTestUtils.setField(service, "entityManager", entityManager);
    }

    private InvoiceNumberContext context() {
        return InvoiceNumberContext.builder().instituteId(INST).date(DAY).build();
    }

    @Test
    @DisplayName("a freed position is issued again, with this series' format")
    void reusesReleasedNumber() {
        when(releasedQuery.getResultList()).thenReturn(List.of(5L));

        InvoiceNumberAllocation a = service.generate(InvoiceNumberConfig.legacyDefault(), context());

        assertEquals(5L, a.seqNo());
        assertEquals("INV-20260925-0005", a.number());
        assertEquals("INV-20260925-0005", service.preview(InvoiceNumberConfig.legacyDefault(), context()));
    }

    @Test
    @DisplayName("with nothing freed, numbering counts on from the highest issued — unchanged")
    void countsOnWhenNothingReleased() {
        when(releasedQuery.getResultList()).thenReturn(List.of());

        InvoiceNumberAllocation a = service.generate(InvoiceNumberConfig.legacyDefault(), context());

        assertEquals(10L, a.seqNo());
        assertEquals("INV-20260925-0010", a.number());
    }

    @Test
    @DisplayName("a freed number that is somehow taken is skipped, not duplicated")
    void skipsTakenReleasedNumber() {
        when(releasedQuery.getResultList()).thenReturn(List.of(5L));
        when(invoiceRepository.existsByInstituteIdAndInvoiceNumber(INST, "INV-20260925-0005")).thenReturn(true);

        assertEquals(10L, service.generate(InvoiceNumberConfig.legacyDefault(), context()).seqNo());
    }

    @Test
    @DisplayName("a failing lookup never blocks an invoice")
    void lookupFailureFallsBack() {
        when(releasedQuery.getResultList()).thenThrow(new RuntimeException("relation does not exist"));

        assertEquals(10L, service.generate(InvoiceNumberConfig.legacyDefault(), context()).seqNo());
    }
}
