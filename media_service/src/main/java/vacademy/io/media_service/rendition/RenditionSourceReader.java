package vacademy.io.media_service.rendition;

import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/**
 * Reads the three columns of a stored file that the rendition pipeline needs.
 *
 * <p>Plain JDBC on purpose: the connection goes back to the pool when the statement ends. A
 * read through the JPA repository would bind a connection to the request for as long as the
 * request lasts (open-in-view), and a rendition request lasts for a download, a decode and
 * several encodes while the pool has five connections for every upload of every institute.
 */
@Component
@RequiredArgsConstructor
public class RenditionSourceReader {

    /** Storage key, upload source and the id the upload was made for. */
    public record Source(String key, String source, String sourceId) {
    }

    private final JdbcTemplate jdbcTemplate;

    public Optional<Source> find(String fileId) {
        List<Source> rows = jdbcTemplate.query(
                "SELECT key, source, source_id FROM file_metadata WHERE id = ?",
                (rs, n) -> new Source(rs.getString(1), rs.getString(2), rs.getString(3)), fileId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }
}
