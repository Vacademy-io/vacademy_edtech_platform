package vacademy.io.admin_core_service.features.ai_models.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.ai_models.ModelDefaults;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Which models a feature uses, read from {@code ai_model_defaults} (the table the
 * super-admin portal edits). Java twin of ai_service's {@code model_selection.resolve_models}.
 *
 * <p>The chain is [default, fallback], plus {@link ModelDefaults#NON_GLM_FALLBACK} when the
 * chain has no non-GLM model. Nothing else is appended: a failure no longer spills into
 * every recommended or active model.
 *
 * <p>Rows are cached per use case for 60 s, so a portal change reaches every pod within a
 * minute. When the read fails, the last good chain is kept; with none, the code constants
 * answer ([GLM_DEFAULT, NON_GLM_FALLBACK]). A missing row gets the constants too.
 */
@Slf4j
@Component
public class AiModelDefaultsResolver {

    static final Duration TTL = Duration.ofSeconds(60);

    private static final String SQL =
            "SELECT default_model_id, fallback_model_id FROM ai_model_defaults WHERE use_case = ?";

    /**
     * @param useCase      the ai_model_defaults key
     * @param models       ordered, distinct, never empty
     * @param fromDatabase false when the code constants answered (no row, or the read failed)
     */
    public record ModelChain(String useCase, List<String> models, boolean fromDatabase) {

        public String primary() {
            return models.get(0);
        }

        /**
         * An explicit pick (user, institute, wizard) goes first; the use case's chain stays
         * behind it as failover. A blank pick changes nothing.
         */
        public ModelChain withPreferred(String preferred) {
            if (preferred == null || preferred.isBlank()) {
                return this;
            }
            LinkedHashSet<String> ordered = new LinkedHashSet<>();
            ordered.add(preferred.trim());
            ordered.addAll(models);
            return new ModelChain(useCase, List.copyOf(ordered), fromDatabase);
        }
    }

    private record Cached(ModelChain chain, long loadedAt) {
        boolean fresh(long now) {
            return now - loadedAt < TTL.toMillis();
        }
    }

    private final JdbcTemplate jdbcTemplate;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();

    public AiModelDefaultsResolver(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** Never null, never empty. */
    public ModelChain resolve(String useCase) {
        String key = useCase == null ? "" : useCase.trim();
        if (key.isEmpty()) {
            return constants(key);
        }
        long now = System.currentTimeMillis();
        Cached cached = cache.get(key);
        if (cached != null && cached.fresh(now)) {
            return cached.chain();
        }
        ModelChain chain;
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(SQL, key);
            if (rows.isEmpty()) {
                log.debug("[ModelDefaults] No ai_model_defaults row for '{}'; using {}", key,
                        ModelDefaults.GLM_DEFAULT);
                chain = constants(key);
            } else {
                Map<String, Object> row = rows.get(0);
                chain = new ModelChain(key, buildChain(asText(row.get("default_model_id")),
                        asText(row.get("fallback_model_id"))), true);
            }
        } catch (Exception e) {
            if (cached != null) {
                log.warn("[ModelDefaults] Could not read '{}' ({}); keeping the last chain {}",
                        key, e.getMessage(), cached.chain().models());
                chain = cached.chain();
            } else {
                log.warn("[ModelDefaults] Could not read '{}' ({}); using the code defaults",
                        key, e.getMessage());
                chain = constants(key);
            }
        }
        cache.put(key, new Cached(chain, now));
        return chain;
    }

    /** Drop the cache, e.g. after a test changes rows. Production relies on the TTL. */
    public void invalidate() {
        cache.clear();
    }

    /** [default or GLM, fallback] + NON_GLM_FALLBACK when every model so far is GLM. */
    static List<String> buildChain(String defaultModel, String fallbackModel) {
        LinkedHashSet<String> ordered = new LinkedHashSet<>();
        ordered.add(isBlank(defaultModel) ? ModelDefaults.GLM_DEFAULT : defaultModel.trim());
        if (!isBlank(fallbackModel)) {
            ordered.add(fallbackModel.trim());
        }
        boolean hasNonGlm = ordered.stream().anyMatch(m -> !ModelDefaults.isGlm(m));
        if (!hasNonGlm) {
            ordered.add(ModelDefaults.NON_GLM_FALLBACK);
        }
        return Collections.unmodifiableList(new ArrayList<>(ordered));
    }

    private static ModelChain constants(String useCase) {
        return new ModelChain(useCase, buildChain(null, null), false);
    }

    private static String asText(Object value) {
        return value == null ? null : value.toString();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
