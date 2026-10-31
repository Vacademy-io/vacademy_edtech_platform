package vacademy.io.admin_core_service.features.live_session.repository;

import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.SpelQueryContext;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionInstituteGroupMappingRepository;

import java.lang.reflect.Method;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

/**
 * Spring Data parses every {@code @Query} string for quotes and {@code :params}
 * when the repository proxy is built; an unbalanced quote (an apostrophe inside a
 * SQL comment is the classic way) fails the bean and crash-loops the pod, and no
 * Mockito test can see it. Same scan Spring runs at boot, over the live-session
 * repositories touched by the guest BBB-join change.
 */
class LiveSessionRepositoryQueryStringsTest {

    @Test
    void liveSessionQueryStringsParse() {
        for (Class<?> repo : List.of(SessionGuestRegistrationRepository.class, LiveSessionLogsRepository.class,
                LiveSessionParticipantRepository.class, LiveSessionRepository.class,
                StudentSessionInstituteGroupMappingRepository.class)) {
            for (Method m : repo.getDeclaredMethods()) {
                Query q = m.getAnnotation(Query.class);
                if (q == null) continue;
                for (String sql : List.of(q.value(), q.countQuery())) {
                    if (sql == null || sql.isBlank()) continue;
                    assertDoesNotThrow(() -> SpelQueryContext
                                    .of((index, expression) -> "?" + index, (prefix, name) -> prefix + name)
                                    .parse(sql),
                            repo.getSimpleName() + "#" + m.getName());
                }
            }
        }
    }
}
