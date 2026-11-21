package vacademy.io.admin_core_service.features.commerce.stock.service;

import java.time.LocalDate;

/**
 * The period lock, implemented by the accounts work. A stock
 * document with a typed date asks it before posting; with no bean in the context nothing is
 * locked.
 */
public interface StockPeriodGuard {

    /** Throws 409 PERIOD_LOCKED when {@code date} is on or before the institute's lock. */
    void assertOpen(String instituteId, LocalDate date);
}
