package vacademy.io.admin_core_service.features.live_session.repository;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** Session search only honours ASC or DESC as the sort direction. */
class SessionSearchSortDirectionTest {

    @Test
    void ascAndDescInAnyCaseAreKept() {
        assertEquals("ASC", LiveSessionRepositoryCustomImpl.normalizeSortDirection("ASC"));
        assertEquals("ASC", LiveSessionRepositoryCustomImpl.normalizeSortDirection("asc"));
        assertEquals("DESC", LiveSessionRepositoryCustomImpl.normalizeSortDirection("DESC"));
        assertEquals("DESC", LiveSessionRepositoryCustomImpl.normalizeSortDirection("desc"));
        assertEquals("DESC", LiveSessionRepositoryCustomImpl.normalizeSortDirection(" Desc "));
    }

    @Test
    void anythingElseFallsBackToAsc() {
        assertEquals("ASC", LiveSessionRepositoryCustomImpl.normalizeSortDirection(null));
        assertEquals("ASC", LiveSessionRepositoryCustomImpl.normalizeSortDirection(""));
        assertEquals("ASC", LiveSessionRepositoryCustomImpl.normalizeSortDirection("descending"));
        assertEquals("ASC", LiveSessionRepositoryCustomImpl.normalizeSortDirection("ASC, s.title"));
        assertEquals("ASC", LiveSessionRepositoryCustomImpl.normalizeSortDirection("DESC; select 1"));
    }
}
