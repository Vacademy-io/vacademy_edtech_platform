package vacademy.io.admin_core_service.features.catalogue_analytics.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.catalogue_analytics.dto.CatalogueAnalyticsResponse;
import vacademy.io.admin_core_service.features.catalogue_analytics.repository.CataloguePageEventRepository;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

@Service
public class CatalogueAnalyticsQueryService {

    /** A year of daily points is already more than any chart should render. */
    private static final int MAX_DAYS = 365;

    @Autowired
    private CataloguePageEventRepository repository;

    @Autowired
    private InstituteAccessValidator accessValidator;

    public CatalogueAnalyticsResponse summary(CustomUserDetails user, String instituteId, int days) {
        // instituteId comes from the caller, so it MUST be checked against the
        // caller's own authorities — otherwise any admin could read any
        // institute's traffic by changing one query parameter.
        accessValidator.validateUserAccess(user, instituteId);

        int window = Math.max(1, Math.min(days, MAX_DAYS));
        Instant to = Instant.now();
        Instant from = to.minus(window, ChronoUnit.DAYS);
        Timestamp tsFrom = Timestamp.from(from);
        Timestamp tsTo = Timestamp.from(to);

        List<Object[]> totals = repository.totals(instituteId, tsFrom, tsTo);
        long views = 0, visitors = 0, sessions = 0;
        if (!totals.isEmpty() && totals.get(0) != null) {
            Object[] row = totals.get(0);
            views = num(row, 0);
            visitors = num(row, 1);
            sessions = num(row, 2);
        }

        List<CatalogueAnalyticsResponse.DailyPoint> daily = new ArrayList<>();
        for (Object[] r : repository.dailyTotals(instituteId, tsFrom, tsTo)) {
            daily.add(CatalogueAnalyticsResponse.DailyPoint.builder()
                    .day(String.valueOf(r[0]))
                    .views(num(r, 1))
                    .visitors(num(r, 2))
                    .build());
        }

        return CatalogueAnalyticsResponse.builder()
                .views(views)
                .visitors(visitors)
                .sessions(sessions)
                .leads(0)
                .daily(daily)
                .pages(named(repository.byPage(instituteId, tsFrom, tsTo)))
                .sources(named(repository.bySource(instituteId, tsFrom, tsTo)))
                .build();
    }

    private List<CatalogueAnalyticsResponse.NamedCount> named(List<Object[]> rows) {
        List<CatalogueAnalyticsResponse.NamedCount> out = new ArrayList<>();
        for (Object[] r : rows) {
            out.add(CatalogueAnalyticsResponse.NamedCount.builder()
                    .name(r[0] == null ? "" : String.valueOf(r[0]))
                    .views(num(r, 1))
                    .visitors(num(r, 2))
                    .build());
        }
        return out;
    }

    /** Native COUNT() comes back as Long on Postgres and BigInteger elsewhere. */
    private long num(Object[] row, int i) {
        Object v = row.length > i ? row[i] : null;
        return v instanceof Number n ? n.longValue() : 0L;
    }
}
