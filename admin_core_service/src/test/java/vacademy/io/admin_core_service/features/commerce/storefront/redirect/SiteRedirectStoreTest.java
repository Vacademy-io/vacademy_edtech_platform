package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.common.exceptions.ConflictException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SiteRedirectStoreTest {

    private static SiteRedirectPlanner.Change update(String id) {
        return new SiteRedirectPlanner.Change(2, id, "EXACT", "/a", "/p/x", 301, "/p/old", 301);
    }

    @Test
    void anUpdateThatMissesARowIsAConflictSoTheCommitRollsBack() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        SiteRedirectStore store = new SiteRedirectStore(jdbc);
        when(jdbc.batchUpdate(anyString(), anyList())).thenReturn(new int[]{1, 0});
        assertThrows(ConflictException.class, () -> store.update("inst-1", List.of(update("id-1"), update("id-2"))));

        when(jdbc.batchUpdate(anyString(), anyList())).thenReturn(new int[]{1, 1});
        assertDoesNotThrow(() -> store.update("inst-1", List.of(update("id-1"), update("id-2"))));
        // A driver that does not report counts per statement is not taken as a miss.
        when(jdbc.batchUpdate(anyString(), anyList())).thenReturn(new int[]{-2, -2});
        assertDoesNotThrow(() -> store.update("inst-1", List.of(update("id-1"), update("id-2"))));
    }

    @Test
    void removingRowsThatAreGoneIsAConflict() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        SiteRedirectStore store = new SiteRedirectStore(jdbc);
        when(jdbc.batchUpdate(anyString(), anyList())).thenReturn(new int[]{1, 0, 1});
        assertThrows(ConflictException.class, () -> store.deleteAll("inst-1", List.of("a", "b", "c")));
        when(jdbc.batchUpdate(anyString(), anyList())).thenReturn(new int[]{1, 1, 1});
        assertDoesNotThrow(() -> store.deleteAll("inst-1", List.of("a", "b", "c")));
    }
}
