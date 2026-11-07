package vacademy.io.admin_core_service.features.platform_billing.service;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.regex.Pattern;

/**
 * Number series v2 for platform tax documents (V590 {@code platform_document_sequence}).
 *
 * <ul>
 *   <li>Invoices: {@code VT/{FY}/I{NNNNN}}, e.g. {@code VT/2627/I00042} (14 characters).</li>
 *   <li>Credit notes: {@code VT/{FY}/C{NNNNN}}, e.g. {@code VT/2627/C00003}.</li>
 * </ul>
 *
 * Rule 46(b) CGST Rules: at most 16 characters (letters, digits, "-" and "/"), consecutive and
 * unique within a financial year. FY is computed in Asia/Kolkata ({@code 2627} = 1 Apr 2026 to
 * 31 Mar 2027 IST), so an invoice issued at 00:10 IST on 1 April is in the new year even though
 * it is still 31 March in UTC.
 *
 * <p>Allocation is one atomic upsert with RETURNING. It must run inside the caller's transaction
 * ({@link Propagation#MANDATORY}) so a rolled-back invoice also rolls back its number — no gaps.
 * The row lock the upsert takes serialises concurrent issuers until their transactions end; that
 * is a transaction-scoped lock, which is safe under pgbouncer transaction pooling.
 *
 * <p>{@code next_no} holds the next number to issue; the value allocated is {@code next_no - 1}
 * after the increment. The first allocation in a series/FY inserts {@code next_no = 2} and gets 1.
 */
@Service
public class PlatformDocumentSequenceService {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    public static final int MAX_LENGTH = 16;
    public static final Pattern ALLOWED = Pattern.compile("^[A-Z0-9/-]+$");
    static final String PREFIX = "VT";

    /** Document series and its one-letter key (the {@code series_key} column). */
    public enum Series {
        INVOICE("I"),
        CREDIT_NOTE("C");

        private final String key;

        Series(String key) {
            this.key = key;
        }

        public String key() {
            return key;
        }
    }

    // Plain string concatenation (no text block) so no trailing space is stripped between clauses.
    static final String ALLOCATE_SQL =
            "INSERT INTO platform_document_sequence (series_key, fy, next_no) "
          + "VALUES (:k, :fy, 2) "
          + "ON CONFLICT (series_key, fy) "
          + "DO UPDATE SET next_no = platform_document_sequence.next_no + 1 "
          + "RETURNING next_no - 1";

    @PersistenceContext
    private EntityManager entityManager;

    /** Allocates the next number of {@code series} for the financial year containing {@code at}. */
    @Transactional(propagation = Propagation.MANDATORY)
    public String next(Series series, Instant at) {
        String fy = financialYear(at);
        Object result = entityManager.createNativeQuery(ALLOCATE_SQL)
                .setParameter("k", series.key())
                .setParameter("fy", fy)
                .getSingleResult();
        long n = ((Number) result).longValue();
        return format(series, fy, n);
    }

    /** {@code 2026-04-01T00:00 IST} to {@code 2027-03-31T23:59:59 IST} gives {@code "2627"}. */
    public static String financialYear(Instant at) {
        ZonedDateTime ist = at.atZone(IST);
        int start = ist.getMonthValue() >= 4 ? ist.getYear() : ist.getYear() - 1;
        return String.format("%02d%02d", start % 100, (start + 1) % 100);
    }

    /** Formats and validates a document number; throws when it would break Rule 46(b). */
    public static String format(Series series, String fy, long n) {
        if (n < 1) {
            throw new VacademyException("Invalid document sequence value: " + n);
        }
        String number = PREFIX + "/" + fy + "/" + series.key() + String.format("%05d", n);
        if (number.length() > MAX_LENGTH || !ALLOWED.matcher(number).matches()) {
            throw new VacademyException("Document number " + number + " exceeds the 16-character GST limit");
        }
        return number;
    }

    /** True for numbers of this series (legacy INV-AICRED-* invoices return false). */
    public static boolean isSeriesV2(String documentNumber) {
        return documentNumber != null && documentNumber.startsWith(PREFIX + "/");
    }
}
