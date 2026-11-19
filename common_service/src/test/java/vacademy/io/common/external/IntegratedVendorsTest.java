package vacademy.io.common.external;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class IntegratedVendorsTest {

    @Test
    void hostsMatchExactlyOrAsSubdomains() {
        assertTrue(IntegratedVendors.isIntegrated("api.plivo.com"));
        assertTrue(IntegratedVendors.isIntegrated("API.Exotel.com."));
        assertTrue(IntegratedVendors.isIntegrated("live-mt-server.wati.io"));
        assertTrue(IntegratedVendors.isIntegrated("serper"));
        assertFalse(IntegratedVendors.isIntegrated("notplivo.com"));
        assertFalse(IntegratedVendors.isIntegrated("vacademy.io"));
        assertFalse(IntegratedVendors.isIntegrated(""));
        assertFalse(IntegratedVendors.isIntegrated(null));
    }

    @Test
    void sqlConditionIsBuiltFromTheConstants() {
        String sql = IntegratedVendors.sqlCondition("vendor");
        assertTrue(sql.startsWith("(lower(vendor) IN ('serper', 'aws-ses', 'email-smtp') OR "), sql);
        assertTrue(sql.contains("lower(vendor) LIKE '%.api.plivo.com'"), sql);
    }
}
