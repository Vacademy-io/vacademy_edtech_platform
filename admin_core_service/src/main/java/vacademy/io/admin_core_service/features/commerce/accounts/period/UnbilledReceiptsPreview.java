package vacademy.io.admin_core_service.features.commerce.accounts.period;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewItem;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewSample;

import java.time.LocalDate;
import java.util.List;

/** Posted goods receipts from a supplier that are not (fully) billed yet, received on or before the date. */
@Component
public class UnbilledReceiptsPreview implements PeriodLockPreviewContributor {

    public static final String KIND = "UNBILLED_RECEIPTS";
    static final int SAMPLE = 10;

    // Text blocks would strip trailing spaces: every fragment below starts with a space.
    private static final String FILTER = " FROM stock_receipt"
            + " WHERE institute_id = :instituteId AND status = 'POSTED'"
            + " AND bill_status IN ('UNBILLED', 'PARTLY_BILLED') AND received_date <= :through";
    static final String COUNT_SQL = "SELECT COUNT(*)" + FILTER;
    static final String SAMPLE_SQL = "SELECT id, receipt_number, received_date" + FILTER
            + " ORDER BY received_date, receipt_number LIMIT " + SAMPLE;

    private final NamedParameterJdbcTemplate jdbc;

    public UnbilledReceiptsPreview(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public String kind() {
        return KIND;
    }

    @Override
    public PreviewItem items(String instituteId, LocalDate through) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("instituteId", instituteId)
                .addValue("through", through);
        Long count = jdbc.queryForObject(COUNT_SQL, params, Long.class);
        List<PreviewSample> sample = jdbc.query(SAMPLE_SQL, params, (rs, i) -> new PreviewSample(
                rs.getString("id"), rs.getString("receipt_number"), rs.getObject("received_date", LocalDate.class)));
        return new PreviewItem(KIND, count == null ? 0 : count, sample);
    }
}
