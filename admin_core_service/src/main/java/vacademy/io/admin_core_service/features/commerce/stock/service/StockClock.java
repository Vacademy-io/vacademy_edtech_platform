package vacademy.io.admin_core_service.features.commerce.stock.service;

import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * The institute's date for stock documents. The JVM runs in UTC, so the JVM default is never
 * used. Stand-in for the CommerceClock of the design (not built yet): every institute is in
 * Asia/Kolkata today.
 */
@Component
public class StockClock {

    private static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    public LocalDate today(String instituteId) {
        return LocalDate.now(ZONE);
    }

    /**
     * The start of an India day as the stored timestamps hold it (they are in the JVM's zone, UTC
     * in production): a date filter of the screens is a day in India, never a UTC day.
     */
    public static LocalDateTime storedStartOf(LocalDate day) {
        return day.atStartOfDay(ZONE).withZoneSameInstant(ZoneId.systemDefault()).toLocalDateTime();
    }
}
