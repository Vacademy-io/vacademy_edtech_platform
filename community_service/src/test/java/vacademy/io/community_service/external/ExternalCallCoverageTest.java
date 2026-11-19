package vacademy.io.community_service.external;

import org.junit.jupiter.api.Test;
import vacademy.io.common.external.ExternalCallCoverage;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Every HTTP client in this service records its failed third-party calls for the health
 * dashboard. A client built without ExternalCallLog fails this test and is named here; wrap it
 * (see ExternalCallLog's javadoc), or mark a file that never calls a vendor with the comment
 * "external-call-log: not a vendor (reason)".
 */
class ExternalCallCoverageTest {

    @Test
    void everyHttpClientRecordsItsFailures() throws Exception {
        List<String> uncovered = ExternalCallCoverage.uncovered(Path.of("src/main/java"));
        assertTrue(uncovered.isEmpty(), "HTTP clients that would fail out of sight of the dashboard:\n  "
                + String.join("\n  ", uncovered));
    }
}
