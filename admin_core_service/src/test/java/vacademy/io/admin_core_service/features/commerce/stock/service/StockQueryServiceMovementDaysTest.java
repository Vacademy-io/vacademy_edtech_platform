package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import vacademy.io.admin_core_service.features.commerce.stock.repository.CommercePieceRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockLevelRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockMovementRepository;
import vacademy.io.admin_core_service.features.commerce.stock.repository.StockVariantRepository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.TimeZone;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The movements list filters India days, like its CSV export: on a UTC server (production) the
 * day 18 Nov starts at 17 Nov 18:30 UTC and ends at 18 Nov 18:30 UTC, never at UTC midnight.
 */
class StockQueryServiceMovementDaysTest {

    private TimeZone saved;

    @BeforeEach
    void utcLikeProduction() {
        saved = TimeZone.getDefault();
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
    }

    @AfterEach
    void restore() {
        TimeZone.setDefault(saved);
    }

    @Test
    void theListUsesIndiaDaysLikeTheExport() {
        StockMovementRepository movements = mock(StockMovementRepository.class);
        when(movements.search(anyString(), anyBoolean(), any(), any(), any(), any(), any(), any(Pageable.class)))
                .thenReturn(Page.empty());
        StockQueryService service = new StockQueryService(mock(StockLevelRepository.class), movements,
                mock(CommercePieceRepository.class), mock(StockVariantRepository.class));

        LocalDate day = LocalDate.of(2026, 11, 18);
        service.movements("inst-1", null, null, null, day, day, false, 0, 50);

        ArgumentCaptor<LocalDateTime> from = ArgumentCaptor.forClass(LocalDateTime.class);
        ArgumentCaptor<LocalDateTime> to = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(movements).search(eq("inst-1"), eq(true), any(), isNull(), isNull(), from.capture(), to.capture(),
                any(Pageable.class));
        assertEquals(LocalDateTime.of(2026, 11, 17, 18, 30), from.getValue());
        assertEquals(LocalDateTime.of(2026, 11, 18, 18, 30), to.getValue());
        // The export's window for the same day is the same.
        assertEquals(from.getValue(), StockClock.storedStartOf(day));
        assertEquals(to.getValue(), StockClock.storedStartOf(day.plusDays(1)));
    }
}
