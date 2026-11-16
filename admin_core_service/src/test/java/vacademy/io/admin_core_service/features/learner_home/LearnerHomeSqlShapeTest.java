package vacademy.io.admin_core_service.features.learner_home;

import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeBlockRepository;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeJdbc;
import vacademy.io.admin_core_service.features.learner_home.repository.LearnerHomeLayoutRepository;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The SQL each statement actually sends: no keywords glued by a text block, no ':' outside bind
 * parameters, and the partial-index status filters as literals.
 */
class LearnerHomeSqlShapeTest {

    private static final Pattern GLUED = Pattern.compile(
            "(?i)(SELECT|FROM|WHERE|JOIN|AND|OR|ON|BY|SET|VALUES|LIMIT|IN)(SELECT|FROM|WHERE|JOIN|AND|ORDER|GROUP|LIMIT|SET|VALUES)\\b");
    private static final Pattern BIND = Pattern.compile(":[A-Za-z][A-Za-z0-9]*\\b");

    static Map<String, String> statements() throws Exception {
        Map<String, String> out = new LinkedHashMap<>();
        for (Field f : LearnerHomeJdbc.class.getDeclaredFields()) {
            if (Modifier.isStatic(f.getModifiers()) && f.getType() == String.class && f.getName().endsWith("_SQL")) {
                out.put(f.getName(), (String) f.get(null));
            }
        }
        for (Class<?> repo : new Class<?>[] {LearnerHomeLayoutRepository.class, LearnerHomeBlockRepository.class}) {
            for (Method m : repo.getDeclaredMethods()) {
                Query q = m.getAnnotation(Query.class);
                if (q != null) out.put(repo.getSimpleName() + "." + m.getName(), q.value());
            }
        }
        return out;
    }

    @Test
    void everyStatementKeepsItsWordsApartAndHasNoStrayColon() throws Exception {
        Map<String, String> all = statements();
        assertTrue(all.size() >= 30, "statements found: " + all.keySet());
        for (Map.Entry<String, String> e : all.entrySet()) {
            String sql = e.getValue();
            assertFalse(GLUED.matcher(sql).find(), () -> "glued keywords in " + e.getKey() + ": " + sql);
            String unbound = BIND.matcher(sql).replaceAll("");
            assertFalse(unbound.contains(":"), () -> "bare ':' in " + e.getKey() + ": " + sql);
        }
    }

    @Test
    void enrolmentQueryUsesTheStatusLiteralsOfThePartialIndex() {
        String q1 = LearnerHomeJdbc.ENROLMENTS_SQL;
        assertTrue(q1.contains("ssigm.status = 'ACTIVE'"));
        assertTrue(q1.contains("ssigm.user_id = :userId"));
        assertTrue(q1.contains("ps.status IN ('ACTIVE', 'HIDDEN')"));
        assertTrue(q1.contains("p.status = 'ACTIVE'"));
        assertFalse(q1.contains(":status"));
        assertTrue(q1.contains("ORDER BY ssigm.enrolled_date DESC NULLS LAST"));
        assertTrue(LearnerHomeJdbc.TAGS_SQL.contains("ut.status = 'ACTIVE'"));
        assertTrue(LearnerHomeJdbc.STATE_SQL.contains("institute_id = :instituteId AND user_id = :userId"));
    }

    @Test
    void viewUpsertAddsToTheExistingTotal() {
        String sql = LearnerHomeJdbc.UPSERT_VIEWS_SQL;
        assertTrue(sql.contains("ON CONFLICT (institute_id, day, block_key, item_key, device)"));
        assertTrue(sql.contains("views = learner_home_view_daily.views + EXCLUDED.views"));
    }
}
