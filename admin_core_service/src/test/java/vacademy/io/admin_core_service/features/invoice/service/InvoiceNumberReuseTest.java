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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * A number freed by a permanent invoice delete: by default it stays retired and the series counts
 * on past it. With {@code neverReuseDeletedNumbers} off it is issued again — lowest first, only in
 * its own series, never below the start-number floor.
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

    private InvoiceNumberConfig settingOff() {
        InvoiceNumberConfig config = InvoiceNumberConfig.legacyDefault();
        config.setNeverReuseDeletedNumbers(false);
        return config;
    }

    // ------------------------------------------------------------------ setting ON (default)

    @Test
    @DisplayName("default: a number freed from the middle is not issued again")
    void freedMiddleNumberStaysRetired() {
        when(releasedQuery.getResultList()).thenReturn(List.of(5L));
        when(releasedQuery.getSingleResult()).thenReturn(5L);

        InvoiceNumberAllocation a = service.generate(InvoiceNumberConfig.legacyDefault(), context());

        assertEquals(10L, a.seqNo());
        assertEquals("INV-20260925-0010", a.number());
        assertEquals("INV-20260925-0010", service.preview(InvoiceNumberConfig.legacyDefault(), context()));
    }

    @Test
    @DisplayName("default: deleting the newest invoice does not hand its number back through MAX")
    void freedNewestNumberStaysRetired() {
        when(releasedQuery.getSingleResult()).thenReturn(12L);

        InvoiceNumberAllocation a = service.generate(InvoiceNumberConfig.legacyDefault(), context());

        assertEquals(13L, a.seqNo());
        assertEquals("INV-20260925-0013", a.number());
        assertEquals(12L, service.highestIssuedSequence(InvoiceNumberConfig.legacyDefault(), INST, DAY));
    }

    @Test
    @DisplayName("default: the start-number floor still applies")
    void floorStillAppliesWhenRetiring() {
        when(releasedQuery.getSingleResult()).thenReturn(12L);
        InvoiceNumberConfig config = InvoiceNumberConfig.legacyDefault();
        config.setStartFrom(100);

        assertEquals(100L, service.generate(config, context()).seqNo());
    }

    @Test
    @DisplayName("default: a failing lookup never blocks an invoice")
    void highestReleasedLookupFailureFallsBack() {
        when(releasedQuery.getSingleResult()).thenThrow(new RuntimeException("relation does not exist"));

        assertEquals(10L, service.generate(InvoiceNumberConfig.legacyDefault(), context()).seqNo());
    }

    @Test
    @DisplayName("a retired number never collides after a clash either")
    void collisionRetryStaysPastRetired() {
        when(releasedQuery.getSingleResult()).thenReturn(12L);

        assertEquals(14L, service.nextAfterCollision(InvoiceNumberConfig.legacyDefault(), context(), 1).seqNo());
    }

    // ------------------------------------------------------------------ setting OFF (old flow)

    @Test
    @DisplayName("off: a freed position is issued again, with this series' format")
    void reusesReleasedNumber() {
        when(releasedQuery.getResultList()).thenReturn(List.of(5L));

        InvoiceNumberAllocation a = service.generate(settingOff(), context());

        assertEquals(5L, a.seqNo());
        assertEquals("INV-20260925-0005", a.number());
        assertEquals("INV-20260925-0005", service.preview(settingOff(), context()));
    }

    @Test
    @DisplayName("off: with nothing freed, numbering counts on from the highest on an invoice")
    void countsOnWhenNothingReleased() {
        when(releasedQuery.getResultList()).thenReturn(List.of());
        when(releasedQuery.getSingleResult()).thenReturn(12L);

        InvoiceNumberAllocation a = service.generate(settingOff(), context());

        assertEquals(10L, a.seqNo());
        assertEquals("INV-20260925-0010", a.number());
    }

    @Test
    @DisplayName("off: a freed number that is somehow taken is skipped, not duplicated")
    void skipsTakenReleasedNumber() {
        when(releasedQuery.getResultList()).thenReturn(List.of(5L));
        when(invoiceRepository.existsByInstituteIdAndInvoiceNumber(INST, "INV-20260925-0005")).thenReturn(true);

        assertEquals(10L, service.generate(settingOff(), context()).seqNo());
    }

    @Test
    @DisplayName("off: a failing lookup never blocks an invoice")
    void lookupFailureFallsBack() {
        when(releasedQuery.getResultList()).thenThrow(new RuntimeException("relation does not exist"));

        assertEquals(10L, service.generate(settingOff(), context()).seqNo());
    }

    @Test
    @DisplayName("off survives an invalid stored format falling back to the default one")
    void offSurvivesFormatFallback() {
        when(releasedQuery.getResultList()).thenReturn(List.of(5L));
        InvoiceNumberConfig config = settingOff();
        config.setFormat("NO-SEQUENCE-TOKEN");

        assertEquals(5L, service.generate(config, context()).seqNo());
    }

    // ------------------------------------------------------------------ reading the setting

    @Test
    @DisplayName("the setting is on unless it is explicitly off")
    void defaultsToOn() {
        assertTrue(InvoiceNumberConfig.fromInvoiceSettings(null).isNeverReuseDeletedNumbers());
        assertTrue(InvoiceNumberConfig.fromInvoiceSettings(Map.of()).isNeverReuseDeletedNumbers());
        assertTrue(InvoiceNumberConfig.fromInvoiceSettings(Map.of("numbering", Map.of("seqPadding", 4)))
                .isNeverReuseDeletedNumbers());
        assertFalse(InvoiceNumberConfig
                .fromInvoiceSettings(Map.of("numbering", Map.of("neverReuseDeletedNumbers", false)))
                .isNeverReuseDeletedNumbers());
    }

    @Test
    @DisplayName("receipt formats and numbering series keep the institute's choice")
    void derivedConfigsKeepTheChoice() {
        InvoiceNumberConfig off = settingOff();
        InvoiceNumberConfig.Series series = InvoiceNumberConfig.Series.builder()
                .key("BRANCH").format("B-{{seq}}").learnerFieldId("f").values(List.of("x")).build();

        assertFalse(off.withFormat("RCT-{{seq}}").isNeverReuseDeletedNumbers());
        assertFalse(off.forSeries(series).isNeverReuseDeletedNumbers());
        assertTrue(InvoiceNumberConfig.legacyDefault().withFormat("RCT-{{seq}}").isNeverReuseDeletedNumbers());
        assertTrue(InvoiceNumberConfig.legacyDefault().forSeries(series).isNeverReuseDeletedNumbers());
    }
}
