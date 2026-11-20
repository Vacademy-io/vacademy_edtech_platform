package vacademy.io.admin_core_service.features.commerce.parallelrun;

import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.Figures;
import vacademy.io.admin_core_service.features.commerce.pos.service.PosSaleService;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportJdbcTemplate;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Location;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRange;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRunner;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The platform side of the parallel run. The day list calls it inside {@code ReportRunner.screen}
 * (read-only transaction on the replica, statement timeout, the pod's report slots); saving a day
 * calls it inside its own write transaction on the primary after {@link #limitStatementTime()}.
 * Three statements per call whatever the number of days.
 *
 * <ul>
 *   <li>Bills, sales value, tax and returns: the sales report's documents with channel POS at the
 *       location ({@code MoneyReportRepository.salesDocuments}), so the figures equal
 *       {@code GET /reports/sales?groupBy=day&locationId=&channel=POS} on the same data.</li>
 *   <li>Cash (this class's own query, {@link #CASH_SQL}): CASH tenders less CASH refunds taken in a
 *       counter session at the location; staff-order and online cash outside a session is left out,
 *       as it is from the bills. A tender is counted on its India received day, except the cash of
 *       a paper bill (a bill-book entry), which is counted on the bill's date, the day the money
 *       went into the drawer. Refunds by {@code paid_on}, else the India day they were processed.
 *       Cash in and out of the drawer are not sales and are left out. The day book and the
 *       Z-report keep the received time.</li>
 *   <li>Open sessions: counter sessions at the location still OPEN that covered the day
 *       ({@code MoneyReportRepository.footerSessions}).</li>
 * </ul>
 */
@Repository
public class ParallelRunReadRepository {

    static final String POS = "POS";
    static final String CASH = "CASH";

    /** India date of a stored (UTC wall) timestamp; never the JVM zone. */
    private static String indiaDay(String column) {
        return " (" + column + " AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date ";
    }

    /*
     * Cash per India day at one location. A paper bill is keyed up to
     * PosSaleService.BILL_BOOK_MAX_AGE_DAYS after its date, so tenders are read that much past the
     * range. Fragments start with a space: nothing glues to the token before it.
     */
    static final String CASH_SQL = "SELECT x.day, SUM(x.amount) AS cash FROM ("
            + " SELECT COALESCE(bb.document_date," + indiaDay("t.received_at") + ") AS day, t.amount"
            + " FROM commerce_order_tender t"
            + " JOIN pos_session ps ON ps.id = t.pos_session_id AND ps.institute_id = t.institute_id"
            + " JOIN commerce_order o ON o.id = t.order_id"
            + " LEFT JOIN LATERAL (SELECT MIN(i.document_date) AS document_date FROM invoice i"
            + " WHERE i.commerce_order_id = o.id AND i.institute_id = :instituteId"
            + " AND i.document_type IS NOT NULL AND i.external_invoice_number IS NOT NULL"
            + " AND i.cancelled_at IS NULL) bb ON o.channel = 'POS'"
            + " WHERE t.institute_id = :instituteId AND ps.location_id = :locationId"
            + " AND t.status = 'RECEIVED' AND t.mode = 'CASH'"
            + " AND t.received_at >= :storedFrom AND t.received_at < :storedToLate"
            + " UNION ALL"
            + " SELECT COALESCE(f.paid_on," + indiaDay("f.processed_at") + ") AS day, -f.amount"
            + " FROM commerce_refund f"
            + " JOIN pos_session ps ON ps.id = f.pos_session_id AND ps.institute_id = f.institute_id"
            + " WHERE f.institute_id = :instituteId AND ps.location_id = :locationId"
            + " AND f.status = 'PROCESSED' AND f.method = 'CASH'"
            + " AND ((f.paid_on IS NOT NULL AND f.paid_on >= :from AND f.paid_on <= :to)"
            + " OR (f.paid_on IS NULL AND f.processed_at >= :storedFrom AND f.processed_at < :storedTo))"
            + " ) x"
            + " WHERE x.day >= :from AND x.day <= :to"
            + " GROUP BY x.day";

    private final MoneyReportRepository money;
    private final NamedParameterJdbcTemplate jdbc;

    public ParallelRunReadRepository(MoneyReportRepository money, NamedParameterJdbcTemplate jdbc) {
        this.money = money;
        this.jdbc = ReportJdbcTemplate.named(jdbc);
    }

    /**
     * The reports' statement time limit for the rest of the current transaction only
     * ({@code SET LOCAL}; safe with a transaction-mode pooler). For a read outside the report
     * runner, such as saving a day.
     */
    public void limitStatementTime() {
        jdbc.getJdbcOperations().execute(ReportRunner.SCREEN_TIMEOUT);
    }

    /** Ids of every location of the institute. */
    public List<String> locationIds(String instituteId) {
        List<String> ids = new ArrayList<>();
        for (Location location : money.locations(instituteId)) {
            ids.add(location.id());
        }
        return ids;
    }

    /** The platform figures of each day from {@code from} to {@code to} (both included; a day without sales is zero). */
    public Map<LocalDate, Figures> figures(String instituteId, String locationId, LocalDate from, LocalDate to) {
        Map<LocalDate, Sums> days = new LinkedHashMap<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            days.put(day, new Sums());
        }
        Set<String> location = Set.of(locationId);

        money.salesDocuments(new DocFilter(instituteId, from, to, null, location, POS, null), d -> {
            Sums sums = days.get(d.day());
            if (sums == null) {
                return;
            }
            if ("NOTE".equals(d.kind())) {
                sums.returns = sums.returns.add(d.total());
            } else {
                sums.bills++;
                sums.sales = sums.sales.add(d.total());
                sums.tax = sums.tax.add(d.tax());
            }
        });

        MapSqlParameterSource cash = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("locationId", locationId)
                .addValue("from", from)
                .addValue("to", to)
                .addValue("storedFrom", ReportRange.storedStartOf(from))
                .addValue("storedTo", ReportRange.storedStartOf(to.plusDays(1)))
                .addValue("storedToLate", ReportRange.storedStartOf(
                        to.plusDays(1L + PosSaleService.BILL_BOOK_MAX_AGE_DAYS)));
        jdbc.query(CASH_SQL, cash, (RowCallbackHandler) rs -> {
            java.sql.Date day = rs.getDate("day");
            Sums sums = day == null ? null : days.get(day.toLocalDate());
            if (sums != null && rs.getBigDecimal("cash") != null) {
                sums.cash = sums.cash.add(rs.getBigDecimal("cash"));
            }
        });

        DocFilter atLocation = new DocFilter(instituteId, from, to, null, location, null, null);

        money.footerSessions(atLocation, ReportRange.storedStartOf(from), ReportRange.storedStartOf(to.plusDays(1)),
                s -> {
                    if (!"OPEN".equals(s.status())) {
                        return;
                    }
                    days.forEach((day, sums) -> {
                        if (s.openedDay() == null || !s.openedDay().isAfter(day)) {
                            sums.openSessions++;
                        }
                    });
                });

        Map<LocalDate, Figures> out = new LinkedHashMap<>();
        days.forEach((day, s) -> out.put(day, new Figures(s.bills, s.sales, s.tax, s.cash, s.returns, s.openSessions)));
        return out;
    }

    private static final class Sums {
        long bills;
        BigDecimal sales = BigDecimal.ZERO;
        BigDecimal tax = BigDecimal.ZERO;
        BigDecimal cash = BigDecimal.ZERO;
        BigDecimal returns = BigDecimal.ZERO;
        int openSessions;
    }
}
