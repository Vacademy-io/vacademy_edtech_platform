package vacademy.io.admin_core_service.features.workflow.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.workflow.spel.SpelEvaluator;
import vacademy.io.admin_core_service.features.workflow.spel.WorkflowDateFunctions;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/**
 * A retry starts from {@code seed_context}, where users are snake_case maps. Node expressions
 * written against a live {@code UserDTO} must still resolve on the re-run.
 */
class WorkflowSubjectResolverRetryContextTest {

    private static final String FIRST_NAME_EXPRESSION =
            "#ctx['user'].fullName != null ? #ctx['user'].fullName.split(' ')[0] : ''";

    private final WorkflowSubjectResolver resolver = new WorkflowSubjectResolver(new ObjectMapper());
    private final SpelEvaluator spel = new SpelEvaluator(mock(WorkflowDateFunctions.class));

    private static Map<String, Object> storedUser() {
        Map<String, Object> user = new HashMap<>();
        user.put("id", "u-1");
        user.put("email", "asha@example.com");
        user.put("username", "asha@example.com");
        user.put("full_name", "Asha Rao");
        user.put("password", "pw-1");
        user.put("root_user", true);
        user.put("is_parent", null);
        user.put("roles", List.of("STUDENT"));
        user.put("date_of_birth", "2026-10-14T00:00:00.000+00:00");
        return user;
    }

    private Map<String, Object> retryContextWith(String key, Object value) {
        Map<String, Object> seed = new HashMap<>();
        seed.put(key, value);
        return resolver.toRetryContext(seed);
    }

    @Test
    void storedUserIsRebuiltAsUserDto() {
        Object user = retryContextWith("user", storedUser()).get("user");

        UserDTO dto = assertInstanceOf(UserDTO.class, user);
        assertEquals("Asha Rao", dto.getFullName());
        assertEquals("pw-1", dto.getPassword());
        assertEquals(List.of("STUDENT"), dto.getRoles());
        assertNotNull(dto.getDateOfBirth());
    }

    @Test
    void multiWordFieldExpressionsResolveOnRetry() {
        Map<String, Object> ctx = retryContextWith("user", storedUser());

        assertEquals("Asha", spel.evaluate(FIRST_NAME_EXPRESSION, ctx));
        assertEquals("Asha Rao", spel.evaluate("#ctx['user']['fullName']", ctx));
        assertEquals("asha@example.com", spel.evaluate("#ctx['user']['email']", ctx));
    }

    @Test
    void liveUserAndStoredRoundTripBehaveTheSame() {
        UserDTO live = UserDTO.builder().id("u-1").email("asha@example.com").fullName("Asha Rao").build();
        Map<String, Object> seed = new HashMap<>();
        seed.put("user", live);

        Map<String, Object> ctx = resolver.toRetryContext(resolver.toStorableContext(seed));

        assertEquals("Asha", spel.evaluate(FIRST_NAME_EXPRESSION, ctx));
    }

    @Test
    void everyUserKeyIsRebuilt() {
        for (String key : List.of("user", "member", "subOrgAdmin", "enrolledBy", "admin")) {
            assertInstanceOf(UserDTO.class, retryContextWith(key, storedUser()).get(key), key);
        }
    }

    @Test
    void unconvertibleUserStaysAsMap() {
        Map<String, Object> broken = storedUser();
        broken.put("date_of_birth", "not-a-date");

        assertSame(broken, retryContextWith("user", broken).get("user"));
    }

    @Test
    void otherMapsAreLeftAloneAndBookkeepingIsStripped() {
        Map<String, Object> lmsConfig = Map.of("courseId", "75");
        Map<String, Object> seed = new HashMap<>();
        seed.put("lmsConfig", lmsConfig);
        seed.put("executionId", "e-1");

        Map<String, Object> ctx = resolver.toRetryContext(seed);

        assertSame(lmsConfig, ctx.get("lmsConfig"));
        assertFalse(ctx.containsKey("executionId"));
    }

    @Test
    void nullSeedGivesEmptyContext() {
        assertTrue(resolver.toRetryContext(null).isEmpty());
    }
}
