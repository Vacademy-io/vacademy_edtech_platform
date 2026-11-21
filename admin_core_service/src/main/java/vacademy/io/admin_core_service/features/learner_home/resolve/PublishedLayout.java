package vacademy.io.admin_core_service.features.learner_home.resolve;

import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Settings;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** The parsed PUBLISHED layout of one institute, as held in the per-pod cache. */
public record PublishedLayout(String layoutId, int version, Settings settings, List<Block> blocks,
                              Map<String, Block> byKey, Set<String> eventKeys) {
}
