package vacademy.io.admin_core_service.external;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import vacademy.io.common.external.IntegratedVendors;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The integrated-vendor list is repeated in ai_service and voice_bot_service (Python). A vendor
 * added here but not there would have its failures dropped by those services, so every domain
 * here must appear in both. Skipped when the sibling folders are not checked out.
 */
class IntegratedVendorListsInSyncTest {

    @Test
    void pythonServicesKnowEveryIntegratedVendor() throws Exception {
        for (String file : new String[]{"../ai_service/app/services/integrated_vendors.py",
                "../voice_bot_service/app/vendor_failures.py"}) {
            Path path = Path.of(file);
            Assumptions.assumeTrue(Files.exists(path), file + " not checked out");
            String text = Files.readString(path);
            for (String domain : IntegratedVendors.DOMAINS) {
                assertTrue(text.contains("\"" + domain + "\""), domain + " is missing from " + file);
            }
        }
    }
}
