package vacademy.io.admin_core_service.features.ai_models.service;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import vacademy.io.admin_core_service.features.ai_models.ModelDefaults;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiModelDefaultsResolverTest {

    private static final String GLM = ModelDefaults.GLM_DEFAULT;
    private static final String GEMINI = ModelDefaults.NON_GLM_FALLBACK;

    /** ai_model_defaults as a map use_case -> [default, fallback]; null map = the read throws. */
    private static final class FakeDefaults extends JdbcTemplate {
        final AtomicReference<Map<String, String[]>> rows = new AtomicReference<>(new HashMap<>());
        final AtomicInteger reads = new AtomicInteger();

        @Override
        public List<Map<String, Object>> queryForList(String sql, Object... args) {
            reads.incrementAndGet();
            Map<String, String[]> table = rows.get();
            if (table == null) {
                throw new IllegalStateException("db down");
            }
            String[] row = table.get((String) args[0]);
            if (row == null) {
                return List.of();
            }
            Map<String, Object> out = new HashMap<>();
            out.put("default_model_id", row[0]);
            out.put("fallback_model_id", row[1]);
            return List.of(out);
        }
    }

    @Test
    void chainIsDefaultThenFallback() {
        FakeDefaults db = new FakeDefaults();
        db.rows.get().put("analytics", new String[]{GLM, "openai/gpt-5.6-luna"});
        AiModelDefaultsResolver.ModelChain chain = new AiModelDefaultsResolver(db).resolve("analytics");
        assertEquals(List.of(GLM, "openai/gpt-5.6-luna"), chain.models(),
                "a non-GLM fallback already exists, so nothing is appended");
        assertTrue(chain.fromDatabase());
        assertEquals(GLM, chain.primary());
    }

    @Test
    void allGlmChainGetsTheNonGlmFallback() {
        FakeDefaults db = new FakeDefaults();
        db.rows.get().put("chatbot_flow", new String[]{GLM, null});
        db.rows.get().put("engagement", new String[]{GLM, "z-ai/glm-5.3-flash:batch"});
        AiModelDefaultsResolver resolver = new AiModelDefaultsResolver(db);
        assertEquals(List.of(GLM, GEMINI), resolver.resolve("chatbot_flow").models());
        assertEquals(List.of(GLM, "z-ai/glm-5.3-flash:batch", GEMINI), resolver.resolve("engagement").models());
    }

    @Test
    void nonGlmDefaultWithoutFallbackIsLeftAlone() {
        FakeDefaults db = new FakeDefaults();
        db.rows.get().put("student_report", new String[]{"openai/gpt-5.6-luna", null});
        assertEquals(List.of("openai/gpt-5.6-luna"),
                new AiModelDefaultsResolver(db).resolve("student_report").models());
    }

    @Test
    void duplicateFallbackIsDropped() {
        FakeDefaults db = new FakeDefaults();
        db.rows.get().put("copilot", new String[]{GEMINI, GEMINI});
        assertEquals(List.of(GEMINI), new AiModelDefaultsResolver(db).resolve("copilot").models());
    }

    @Test
    void missingRowOrBlankUseCaseUsesTheConstants() {
        FakeDefaults db = new FakeDefaults();
        AiModelDefaultsResolver resolver = new AiModelDefaultsResolver(db);
        AiModelDefaultsResolver.ModelChain chain = resolver.resolve("workflow_draft");
        assertEquals(List.of(GLM, GEMINI), chain.models());
        assertFalse(chain.fromDatabase());
        assertEquals(List.of(GLM, GEMINI), resolver.resolve("  ").models());
        assertEquals(List.of(GLM, GEMINI), resolver.resolve(null).models());
    }

    @Test
    void blankDefaultColumnFallsBackToGlm() {
        FakeDefaults db = new FakeDefaults();
        db.rows.get().put("agent_assist", new String[]{" ", GEMINI});
        assertEquals(List.of(GLM, GEMINI), new AiModelDefaultsResolver(db).resolve("agent_assist").models());
    }

    @Test
    void dbErrorWithNoHistoryUsesTheConstants() {
        FakeDefaults db = new FakeDefaults();
        db.rows.set(null);
        AiModelDefaultsResolver.ModelChain chain = new AiModelDefaultsResolver(db).resolve("admin_agent");
        assertEquals(List.of(GLM, GEMINI), chain.models());
        assertFalse(chain.fromDatabase());
    }

    @Test
    void cachedWithinTheTtlAndLastGoodKeptOnError() {
        FakeDefaults db = new FakeDefaults();
        db.rows.get().put("copilot", new String[]{"openai/gpt-5.6-luna", null});
        AiModelDefaultsResolver resolver = new AiModelDefaultsResolver(db);
        AiModelDefaultsResolver.ModelChain first = resolver.resolve("copilot");
        assertSame(first, resolver.resolve("copilot"), "second read inside the TTL is the cache");
        assertEquals(1, db.reads.get());

        // A portal change shows up once the cache is gone.
        db.rows.get().put("copilot", new String[]{GLM, GEMINI});
        resolver.invalidate();
        assertEquals(List.of(GLM, GEMINI), resolver.resolve("copilot").models());
    }

    @Test
    void explicitPickGoesFirstAndKeepsTheChainBehind() {
        AiModelDefaultsResolver.ModelChain chain =
                new AiModelDefaultsResolver.ModelChain("admin_agent", List.of(GLM, GEMINI), true);
        assertEquals(List.of("anthropic/claude-sonnet-4.5", GLM, GEMINI),
                chain.withPreferred("anthropic/claude-sonnet-4.5").models());
        assertEquals(List.of(GEMINI, GLM), chain.withPreferred(GEMINI).models(), "no duplicate");
        assertSame(chain, chain.withPreferred(" "));
        assertSame(chain, chain.withPreferred(null));
    }

    @Test
    void registryServiceDelegatesWithoutTheRecommendedSpill() {
        FakeDefaults db = new FakeDefaults();
        db.rows.get().put("analytics", new String[]{GLM, "openai/gpt-5.6-luna"});
        AIModelRegistryService registry = new AIModelRegistryService(new AiModelDefaultsResolver(db));
        assertEquals(List.of(GLM, "openai/gpt-5.6-luna"), registry.getModelPriority("analytics"));
        assertTrue(registry.getModelPriority("").isEmpty());
    }

    @Test
    void glmDetection() {
        assertTrue(ModelDefaults.isGlm("z-ai/glm-5.3-flash"));
        assertTrue(ModelDefaults.isGlm("glm-5.3-flash"));
        assertTrue(ModelDefaults.isGlm("z-ai/glm-5.3-flash:batch"));
        assertFalse(ModelDefaults.isGlm("google/gemini-2.5-flash"));
        assertFalse(ModelDefaults.isGlm(null));
    }
}
