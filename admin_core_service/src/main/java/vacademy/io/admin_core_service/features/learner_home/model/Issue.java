package vacademy.io.admin_core_service.features.learner_home.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One validation or publish-check finding. {@code blockKey} is null for a layout-level finding
 * (settings, limits). {@code path} is relative to the block, e.g. {@code config.slides[0].image.alt}.
 */
public record Issue(@JsonProperty("block_key") String blockKey, @JsonProperty("path") String path,
                    @JsonProperty("code") String code, @JsonProperty("message") String message) {
}
