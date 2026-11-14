package vacademy.io.admin_core_service.features.audience;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.audience.dto.LeadFilterDTO;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;

import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * With "Show duplicates only in Duplicate Leads" on, the lists that hide duplicates (or list
 * only them) place a lead at its latest enquiry. Every other list, and every institute with the
 * setting off, keeps its order and date filter.
 */
class LeadRepeatDatesTest {

    private static boolean uses(String filter, Boolean followUpPending, boolean tabOnly) throws Exception {
        Method m = AudienceService.class.getDeclaredMethod("usesRepeatDates", String.class, Boolean.class,
                BooleanSupplier.class);
        m.setAccessible(true);
        return (boolean) m.invoke(null, filter, followUpPending, (BooleanSupplier) () -> tabOnly);
    }

    private static String sortBy(String sortBy, boolean repeatDates) throws Exception {
        Method m = AudienceService.class.getDeclaredMethod("repeatDatesSortBy", String.class, boolean.class);
        m.setAccessible(true);
        return (String) m.invoke(null, sortBy, repeatDates);
    }

    /** All Leads (EXCLUDE) and Duplicate Leads (ONLY) use it while the setting is on. */
    @Test
    void onForHiddenAndOnlyDuplicateListsWithTheSetting() throws Exception {
        assertTrue(uses("EXCLUDE", null, true));
        assertTrue(uses("ONLY", false, true));
    }

    /** Setting off: nothing changes. */
    @Test
    void offWithoutTheSetting() throws Exception {
        assertFalse(uses("EXCLUDE", null, false));
        assertFalse(uses("ONLY", null, false));
    }

    /**
     * No filter named by the route (duplicates listed, or exports / reports that leave it to
     * the setting) keeps submitted_at.
     */
    @Test
    void offWithoutARouteFilter() throws Exception {
        AtomicInteger reads = new AtomicInteger();
        Method m = AudienceService.class.getDeclaredMethod("usesRepeatDates", String.class, Boolean.class,
                BooleanSupplier.class);
        m.setAccessible(true);
        assertFalse((boolean) m.invoke(null, null, null, (BooleanSupplier) () -> {
            reads.incrementAndGet();
            return true;
        }));
        // The setting is not even read then.
        assertEquals(0, reads.get());
    }

    /** Follow-up queues keep their own order (priority first, then schedule). */
    @Test
    void offForFollowUpQueues() throws Exception {
        assertFalse(uses("EXCLUDE", true, true));
    }

    private static boolean forRequest(Boolean latest, String duplicateFilter, Boolean followUpPending,
                                      boolean tabOnly) throws Exception {
        Method m = AudienceService.class.getDeclaredMethod("usesRepeatDates", LeadFilterDTO.class,
                BooleanSupplier.class);
        m.setAccessible(true);
        LeadFilterDTO f = new LeadFilterDTO();
        f.setLatestEnquiryDates(latest);
        f.setDuplicateFilter(duplicateFilter);
        f.setFollowUpPending(followUpPending);
        return (boolean) m.invoke(null, f, (BooleanSupplier) () -> tabOnly);
    }

    /** Only a tab whose route opts in (enquiryDates=latest) and names the filter. */
    @Test
    void requestNeedsTheRouteOptIn() throws Exception {
        assertTrue(forRequest(true, "exclude", null, true));
        assertTrue(forRequest(true, "ONLY", null, true));
        // Every list today: no opt-in, so nothing changes, setting on or off.
        assertFalse(forRequest(null, "EXCLUDE", null, true));
        assertFalse(forRequest(false, "ONLY", null, true));
        // Opted in but no filter named (exports, reports, lead board) or duplicates listed.
        assertFalse(forRequest(true, null, null, true));
        assertFalse(forRequest(true, "INCLUDE", null, true));
        // Setting off, or a follow-up queue.
        assertFalse(forRequest(true, "EXCLUDE", null, false));
        assertFalse(forRequest(true, "EXCLUDE", true, true));
    }

    /** Default and Submitted sorts become latest-enquiry; any other sort is kept. */
    @Test
    void sortByLatestEnquiryOnlyReplacesTheDateSort() throws Exception {
        assertEquals("LATEST_ENQUIRY", sortBy(null, true));
        assertEquals("LATEST_ENQUIRY", sortBy("", true));
        assertEquals("LATEST_ENQUIRY", sortBy("SUBMITTED_AT", true));
        assertEquals("LEAD_SCORE", sortBy("LEAD_SCORE", true));
        assertEquals("SUBMITTED_AT", sortBy("SUBMITTED_AT", false));
        assertEquals(null, sortBy(null, false));
    }

    /** No sort named was always newest first; that stays so whatever direction came with it. */
    @Test
    void defaultSortStaysNewestFirst() throws Exception {
        Method m = AudienceService.class.getDeclaredMethod("repeatDatesSortDirection", String.class,
                String.class, boolean.class);
        m.setAccessible(true);
        assertEquals("DESC", m.invoke(null, null, "ASC", true));
        assertEquals("DESC", m.invoke(null, "", null, true));
        // A named sort keeps its direction, and nothing changes with repeat dates off.
        assertEquals("ASC", m.invoke(null, "SUBMITTED_AT", "ASC", true));
        assertEquals("ASC", m.invoke(null, null, "ASC", false));
    }
}
