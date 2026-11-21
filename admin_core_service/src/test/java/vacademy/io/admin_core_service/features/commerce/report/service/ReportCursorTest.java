package vacademy.io.admin_core_service.features.commerce.report.service;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.report.repository.ReportRows.Keyset;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The register cursor: what the server writes comes back; anything else is a 400 before any SQL. */
class ReportCursorTest {

    private static String raw(String text) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(StandardCharsets.UTF_8));
    }

    private static void refused(String cursor) {
        InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> ReportCursor.decode(cursor));
        assertTrue(e.getMessage().startsWith("VALIDATION:"));
    }

    @Test
    void whatTheServerWritesComesBack() {
        LocalDate day = LocalDate.of(2026, 11, 19);
        for (String number : new String[] {"INV/2627-00012", "RA162627-00003", "ORD-000019",
                "2026-11-19T17:12:00.123456"}) {
            Keyset k = ReportCursor.decode(ReportCursor.encode(day, number, "3f1c9a0e-1111-4222-8333-944455556666"));
            assertEquals(day, k.date());
            assertEquals(number, k.number());
        }
        assertNull(ReportCursor.decode(null));
        assertNull(ReportCursor.decode(" "));
    }

    @Test
    void aChangedOrHostileCursorIsRefused() {
        refused("not base64 !");
        refused(raw("2026-11-19|INV\u0000-1|id-1"));
        refused(raw("2026-11-19|INV-1|id\u0000"));
        refused(raw("2026-11-19|INV-1|id with spaces"));
        refused(raw("19-11-2026|INV-1|id-1"));
        refused(raw("2026-11-19|" + "9".repeat(101) + "|id-1"));
        refused(raw("2026-11-19|INV-1|"));
        refused("A".repeat(ReportCursor.MAX_LENGTH + 1));
    }
}
