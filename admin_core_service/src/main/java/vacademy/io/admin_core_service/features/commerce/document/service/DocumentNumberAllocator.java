package vacademy.io.admin_core_service.features.commerce.document.service;

import vacademy.io.common.exceptions.ConflictException;

/**
 * Hands out the next number of a SYSTEM series.
 *
 * <p>The rule that makes numbers consecutive is in the store, not here: {@link
 * CounterStore#lockNextValue} takes the row lock on the series and holds it until the caller's
 * transaction ends. Every other issuer of the same series waits on that lock, reads the value
 * the winner wrote, and takes the one after it. When the document's transaction rolls back, the
 * counter update rolls back with it, so a failed document leaves no gap. There is no MAX+1, no
 * retry on a unique-constraint failure and no random suffix.
 *
 * <p>A number is {@code prefix + year token + "-" + sequence}, the sequence padded to five
 * digits: prefix "INV/" in 2026-27 gives "INV/2627-00001". The year is inside the number because
 * an invoice number must be unique for the institute across years. A GST document number may be
 * at most 16 characters; a series that would pass that is exhausted and must be replaced.
 */
public final class DocumentNumberAllocator {

    public static final int MAX_NUMBER_LENGTH = 16;
    public static final int SEQUENCE_WIDTH = 5;

    /** The counter of a series. The database-backed one runs inside the caller's transaction. */
    public interface CounterStore {

        /**
         * Locks the series row until the transaction ends and returns its next value, or null
         * when the row does not exist, is not ACTIVE, or is not a SYSTEM series of this institute.
         */
        Long lockNextValue(String instituteId, String seriesId);

        /** Writes the value the next caller will take. Called only while the lock is held. */
        void storeNextValue(String seriesId, long nextValue);
    }

    /** What was allocated. */
    public record Allocation(String seriesId, long value, String number) {
    }

    private final CounterStore store;

    public DocumentNumberAllocator(CounterStore store) {
        this.store = store;
    }

    public Allocation allocate(String instituteId, String seriesId, String prefix, String financialYear) {
        Long value = store.lockNextValue(instituteId, seriesId);
        if (value == null) {
            throw new ConflictException("SERIES_NOT_ACTIVE: the document series is closed or does not exist");
        }
        String number = format(prefix, financialYear, value);
        if (number.length() > MAX_NUMBER_LENGTH) {
            throw new ConflictException("SERIES_EXHAUSTED: the document series has no numbers left;"
                    + " open a new series with another prefix");
        }
        store.storeNextValue(seriesId, value + 1);
        return new Allocation(seriesId, value, number);
    }

    /** The printed number for a sequence value. Also used for a bill-book page number. */
    public static String format(String prefix, String financialYear, long value) {
        return prefix + FinancialYear.token(financialYear) + "-"
                + String.format("%0" + SEQUENCE_WIDTH + "d", value);
    }
}
