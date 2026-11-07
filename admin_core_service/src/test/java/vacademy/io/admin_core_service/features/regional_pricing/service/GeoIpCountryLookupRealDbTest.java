package vacademy.io.admin_core_service.features.regional_pricing.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Runs only when GEOIP_TEST_DB points at a downloaded DB-IP country database
 * (https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz, gunzipped), so CI
 * never downloads anything. Confirms the reader and the record shape against the real file.
 */
@EnabledIfEnvironmentVariable(named = "GEOIP_TEST_DB", matches = ".+")
class GeoIpCountryLookupRealDbTest {

    @Test
    void looksUpCountriesFromTheRealDatabase() throws Exception {
        GeoIpCountryLookup lookup = new GeoIpCountryLookup();
        ReflectionTestUtils.setField(lookup, "path", System.getenv("GEOIP_TEST_DB"));
        ReflectionTestUtils.setField(lookup, "maxAgeDays", 100_000); // use the file as is, never download
        ReflectionTestUtils.setField(lookup, "urlTemplate", "http://127.0.0.1:9/%s");

        // First call starts the background load and returns no country (never blocks a request).
        assertTrue(lookup.countryOf("8.8.8.8").isEmpty());
        for (int i = 0; i < 50 && lookup.countryOf("8.8.8.8").isEmpty(); i++) {
            Thread.sleep(100);
        }
        assertEquals(Optional.of("US"), lookup.countryOf("8.8.8.8"));
        assertEquals(Optional.of("AU"), lookup.countryOf("1.1.1.1"));
        assertTrue(lookup.countryOf("10.0.0.1").isEmpty());
        lookup.close();
    }
}
