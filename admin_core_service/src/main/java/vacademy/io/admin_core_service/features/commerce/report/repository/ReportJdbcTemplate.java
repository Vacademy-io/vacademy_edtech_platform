package vacademy.io.admin_core_service.features.commerce.report.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

import javax.sql.DataSource;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * The JDBC template of the report repositories: rows are fetched 1,000 at a time (a large read
 * streams instead of loading the whole result), and every statement gets the time left of the
 * request's {@link ReportDeadline} as its query timeout. Same data source as the application's
 * template, so it joins the runner's read-only transaction (replica, {@code SET LOCAL}).
 */
public class ReportJdbcTemplate extends JdbcTemplate {

    public static final int FETCH_SIZE = 1000;

    public ReportJdbcTemplate(DataSource dataSource) {
        super(dataSource);
        setFetchSize(FETCH_SIZE);
    }

    /** A named-parameter template over a report template on the same data source as {@code jdbc}. */
    public static NamedParameterJdbcTemplate named(NamedParameterJdbcTemplate jdbc) {
        return new NamedParameterJdbcTemplate(new ReportJdbcTemplate(jdbc.getJdbcTemplate().getDataSource()));
    }

    @Override
    protected void applyStatementSettings(Statement stmt) throws SQLException {
        super.applyStatementSettings(stmt);
        int seconds = ReportDeadline.secondsForNextStatement();
        if (seconds > 0) {
            stmt.setQueryTimeout(seconds);
        }
    }
}
