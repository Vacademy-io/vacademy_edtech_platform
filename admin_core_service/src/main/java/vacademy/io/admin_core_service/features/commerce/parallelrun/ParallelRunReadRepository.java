package vacademy.io.admin_core_service.features.commerce.parallelrun;

import org.springframework.stereotype.Repository;
import vacademy.io.admin_core_service.features.commerce.parallelrun.ParallelRunMath.Figures;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyReportRepository;
import vacademy.io.admin_core_service.features.commerce.report.repository.MoneyRows.Location;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.DocFilter;
import vacademy.io.admin_core_service.features.commerce.report.service.ReportRange;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The platform side of the parallel run, read through the reports' own reads
 * ({@link MoneyReportRepository}; nothing here writes SQL of its own). Call it inside
 * {@code ReportRunner.screen}: read-only transaction on the replica, statement timeout, the pod's
 * report slots. Three statements per call whatever the number of days.
 *
 * <ul>
 *   <li>Bills, sales value, tax and returns: the sales report's documents with channel POS at the
 *       location ({@code salesDocuments}), so the figures equal
 *       {@code GET /reports/sales?groupBy=day&locationId=&channel=POS} on the same data.</li>
 *   <li>Cash: the day book's money events at the location ({@code moneyRows}): CASH tenders
 *       received less CASH refunds paid, by their India day. Cash in and out of the drawer are not
 *       sales and are left out.</li>
 *   <li>Open sessions: counter sessions at the location still OPEN that covered the day
 *       ({@code footerSessions}).</li>
 * </ul>
 */
@Repository
public class ParallelRunReadRepository {

    static final String POS = "POS";
    static final String CASH = "CASH";

    private final MoneyReportRepository money;

    public ParallelRunReadRepository(MoneyReportRepository money) {
        this.money = money;
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

        DocFilter atLocation = new DocFilter(instituteId, from, to, null, location, null, null);
        money.moneyRows(atLocation, ReportRange.storedStartOf(from), ReportRange.storedStartOf(to.plusDays(1)), r -> {
            Sums sums = days.get(r.day());
            if (sums == null || !CASH.equals(r.mode())) {
                return;
            }
            if ("TENDER".equals(r.source())) {
                sums.cash = sums.cash.add(r.amount());
            } else if ("REFUND".equals(r.source()) && "REFUND_PAID".equals(r.kind())) {
                sums.cash = sums.cash.subtract(r.amount());
            }
        });

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
