package vacademy.io.admin_core_service.features.commerce.accounts.period;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewItem;
import vacademy.io.admin_core_service.features.commerce.accounts.period.PeriodLockDtos.PreviewSample;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The unbilled-receipts preview: its filter and its answer. */
class UnbilledReceiptsPreviewTest {

    @Test
    void sqlFiltersPostedUnbilledReceiptsOfTheInstituteUpToTheDate() {
        for (String sql : List.of(UnbilledReceiptsPreview.COUNT_SQL, UnbilledReceiptsPreview.SAMPLE_SQL)) {
            assertTrue(sql.contains(" FROM stock_receipt WHERE institute_id = :instituteId AND status = 'POSTED'"),
                    sql);
            assertTrue(sql.contains(" AND bill_status IN ('UNBILLED', 'PARTLY_BILLED') AND received_date <= :through"),
                    sql);
            assertFalse(sql.contains("  "), "no glued or doubled fragments: " + sql);
        }
        assertTrue(UnbilledReceiptsPreview.SAMPLE_SQL.endsWith(" ORDER BY received_date, receipt_number LIMIT 10"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void answersTheCountAndTheSample() {
        NamedParameterJdbcTemplate jdbc = mock(NamedParameterJdbcTemplate.class);
        LocalDate day = LocalDate.of(2026, 10, 31);
        when(jdbc.queryForObject(eq(UnbilledReceiptsPreview.COUNT_SQL), any(SqlParameterSource.class), eq(Long.class)))
                .thenReturn(12L);
        when(jdbc.query(eq(UnbilledReceiptsPreview.SAMPLE_SQL), any(SqlParameterSource.class), any(RowMapper.class)))
                .thenReturn(List.of(new PreviewSample("r1", "GRN-000001", day)));
        PreviewItem item = new UnbilledReceiptsPreview(jdbc).items("inst-1", day);
        assertEquals("UNBILLED_RECEIPTS", item.getKind());
        assertEquals(12, item.getCount());
        assertEquals("GRN-000001", item.getSample().get(0).getNumber());
    }
}
