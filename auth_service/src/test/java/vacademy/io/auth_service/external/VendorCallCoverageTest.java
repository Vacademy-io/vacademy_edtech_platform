package vacademy.io.auth_service.external;

import org.junit.jupiter.api.Test;
import vacademy.io.common.external.VendorCallCoverage;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Every class here that talks to an integrated third-party API records its failures with
 * VendorCallLog.failed, so they show on the platform health dashboard. A class that names a
 * vendor but makes no call says why in a "// vendor-call-log: ..." comment.
 */
class VendorCallCoverageTest {

    @Test
    void everyVendorCallRecordsItsFailures() throws Exception {
        List<String> missing = VendorCallCoverage.unrecorded(Path.of("src/main/java"));
        assertEquals(List.of(), missing, "Record failures with VendorCallLog.failed(...) in these files, or say "
                + "why not with a '// vendor-call-log: ...' comment");
    }
}
