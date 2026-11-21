package vacademy.io.admin_core_service.features.commerce.document.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.document.entity.CommerceDocumentSeries;
import vacademy.io.admin_core_service.features.commerce.document.enums.DocumentType;
import vacademy.io.admin_core_service.features.commerce.document.repository.CommerceDocumentSeriesRepository;
import vacademy.io.common.exceptions.ConflictException;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Which series a document takes its number from, across the turn of a financial year. The
 * repository is a small in-memory stand-in; the statements themselves are proven on a database
 * in CommerceDocumentSeriesDatabaseIT and CommerceM1StockTaxDatabaseProofIT.
 */
class CommerceDocumentNumberServiceTest {

    private static final String INST = "inst-1";
    private static final String DELHI = "loc-delhi";

    private final List<CommerceDocumentSeries> rows = new ArrayList<>();
    private CommerceDocumentSeriesRepository repository;
    private CommerceDocumentNumberService service;

    @BeforeEach
    void setUp() {
        repository = mock(CommerceDocumentSeriesRepository.class);
        when(repository.findByInstituteIdAndDocumentType(INST, "TAX_INVOICE"))
                .thenAnswer(inv -> new ArrayList<>(rows));
        when(repository.findByInstituteIdAndDocumentTypeAndFinancialYearAndStatus(eq(INST), eq("TAX_INVOICE"),
                anyString(), eq("ACTIVE"))).thenAnswer(inv -> rows.stream()
                .filter(s -> s.getFinancialYear().equals(inv.getArgument(2)) && "ACTIVE".equals(s.getStatus()))
                .toList());
        // INSERT ... SELECT ... ON CONFLICT (institute, prefix, year) DO NOTHING
        when(repository.openForYear(eq(INST), anyString(), anyString(), anyString())).thenAnswer(inv -> {
            CommerceDocumentSeries source = rows.stream().filter(s -> s.getId().equals(inv.getArgument(1)))
                    .findFirst().orElseThrow();
            String year = inv.getArgument(3);
            if (rows.stream().anyMatch(s -> s.getPrefix().equals(source.getPrefix())
                    && s.getFinancialYear().equals(year))) {
                return 0;
            }
            rows.add(series(inv.getArgument(2), source.getPrefix(), year, source.getLocationId(), "ACTIVE"));
            return 1;
        });
        when(repository.lockNextValue(eq(INST), anyString())).thenReturn(1L);
        service = new CommerceDocumentNumberService(repository);
    }

    private static CommerceDocumentSeries series(String id, String prefix, String year, String locationId,
                                                 String status) {
        CommerceDocumentSeries series = new CommerceDocumentSeries();
        series.setId(id);
        series.setInstituteId(INST);
        series.setDocumentType("TAX_INVOICE");
        series.setKind("SYSTEM");
        series.setChannel("ALL");
        series.setPrefix(prefix);
        series.setFinancialYear(year);
        series.setLocationId(locationId);
        series.setStatus(status);
        return series;
    }

    private String number(String year, String locationId, String channel) {
        return service.allocate(INST, DocumentType.TAX_INVOICE, year, null, locationId, null, channel).number();
    }

    /**
     * 2026-27 has CC/ (general) and DEL/ (the Delhi store). The first document of 2027-28 is an
     * online order. Before the fix only CC/ was opened for the new year, the Delhi store then
     * matched it, and DEL/ was never opened: which series a store used depended on who billed first.
     */
    @Test
    void theFirstDocumentOfAYearOpensEverySeriesSoAStoreKeepsItsOwn() {
        rows.add(series("s-cc", "CC/", "2026-27", null, "ACTIVE"));
        rows.add(series("s-del", "DEL/", "2026-27", DELHI, "ACTIVE"));

        assertEquals("CC/2728-00001", number("2027-28", null, "ONLINE"));
        assertEquals("DEL/2728-00001", number("2027-28", DELHI, "POS"));

        assertEquals(2, rows.stream().filter(s -> s.getFinancialYear().equals("2027-28")).count());
    }

    @Test
    void theOrderOfTheFirstTwoDocumentsDoesNotMatter() {
        rows.add(series("s-cc", "CC/", "2026-27", null, "ACTIVE"));
        rows.add(series("s-del", "DEL/", "2026-27", DELHI, "ACTIVE"));

        assertEquals("DEL/2728-00001", number("2027-28", DELHI, "POS"));
        assertEquals("CC/2728-00001", number("2027-28", null, "ONLINE"));
    }

    @Test
    void aSeriesMissingFromAYearThatAlreadyHasOthersIsStillOpened() {
        // The state the old code left behind: CC/ opened for 2027-28, DEL/ not.
        rows.add(series("s-cc", "CC/", "2026-27", null, "ACTIVE"));
        rows.add(series("s-del", "DEL/", "2026-27", DELHI, "ACTIVE"));
        rows.add(series("s-cc-new", "CC/", "2027-28", null, "ACTIVE"));

        assertEquals("DEL/2728-00001", number("2027-28", DELHI, "POS"));
    }

    @Test
    void aSeriesClosedInTheNewYearOrInTheOldOneIsNotOpenedAgain() {
        rows.add(series("s-cc", "CC/", "2026-27", null, "ACTIVE"));
        rows.add(series("s-del", "DEL/", "2026-27", DELHI, "ACTIVE"));
        rows.add(series("s-old", "OLD/", "2026-27", DELHI, "CLOSED"));
        rows.add(series("s-cc-new", "CC/", "2027-28", null, "ACTIVE"));
        rows.add(series("s-del-new", "DEL/", "2027-28", DELHI, "CLOSED"));

        // The store's own series was closed for this year by a person: it falls back to CC/.
        assertEquals("CC/2728-00001", number("2027-28", DELHI, "POS"));
        verify(repository, never()).openForYear(anyString(), anyString(), anyString(), anyString());
        assertTrue(rows.stream().noneMatch(s -> s.getPrefix().equals("OLD/") && s.getFinancialYear().equals("2027-28")));
    }

    @Test
    void withinAYearNothingIsOpenedAndTheMostSpecificSeriesWins() {
        rows.add(series("s-cc", "CC/", "2026-27", null, "ACTIVE"));
        rows.add(series("s-del", "DEL/", "2026-27", DELHI, "ACTIVE"));

        assertEquals("DEL/2627-00001", number("2026-27", DELHI, "POS"));
        assertEquals("CC/2627-00001", number("2026-27", "loc-other", "POS"));
        verify(repository, never()).openForYear(anyString(), anyString(), anyString(), anyString());
        verify(repository, never()).storeNextValue(eq("s-never"), anyLong());
    }

    @Test
    void noSeriesAtAllIsAConflictNotANumber() {
        assertTrue(assertThrows(ConflictException.class, () -> number("2027-28", null, "ONLINE"))
                .getMessage().startsWith("SERIES_NOT_CONFIGURED"));
    }
}
