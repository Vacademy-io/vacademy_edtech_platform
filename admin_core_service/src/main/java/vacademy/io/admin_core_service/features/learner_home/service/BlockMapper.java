package vacademy.io.admin_core_service.features.learner_home.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeBlock;
import vacademy.io.admin_core_service.features.learner_home.entity.LearnerHomeLayout;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Block;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.BlockType;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.BuiltinWidget;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Devices;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Placement;
import vacademy.io.admin_core_service.features.learner_home.model.HomeModel.Settings;
import vacademy.io.admin_core_service.features.learner_home.model.HomeParser;
import vacademy.io.admin_core_service.features.learner_home.model.HomeWriter;
import vacademy.io.admin_core_service.features.learner_home.model.Issue;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Rows to the typed model and back. */
@Slf4j
public final class BlockMapper {

    private BlockMapper() {
    }

    /**
     * Stored rows were validated on save. A row that no longer reads cleanly (bad JSON, an unknown
     * condition kind or mode, any parse issue in its audience or config) is skipped and reported in
     * {@code issues}: it is never served, and in particular never served to everyone because its
     * audience could not be read.
     */
    public static List<Block> fromEntities(List<LearnerHomeBlock> rows, List<Issue> issues) {
        List<Block> out = new ArrayList<>();
        for (LearnerHomeBlock row : rows) {
            Block b = fromEntity(row, issues);
            if (b != null) out.add(b);
        }
        return out;
    }

    public static Block fromEntity(LearnerHomeBlock row, List<Issue> issues) {
        String key = row.getBlockKey();
        try {
            BlockType type = BlockType.valueOf(row.getType());
            BuiltinWidget widget = row.getBuiltinWidget() == null ? null : BuiltinWidget.valueOf(row.getBuiltinWidget());
            if (type == BlockType.BUILTIN && widget == null) {
                return unreadable(key, "builtin_widget", "A BUILTIN block without its widget", issues);
            }
            JsonNode audience = HomeWriter.readTreeStrict(row.getAudienceJson());
            if (audience == null || !audience.isObject() || !audience.path("mode").isTextual()) {
                return unreadable(key, "audience", "Stored audience could not be read", issues);
            }
            JsonNode config = HomeWriter.readTreeStrict(row.getConfigJson());
            if (config == null || !config.isObject()) {
                return unreadable(key, "config", "Stored config could not be read", issues);
            }
            List<Issue> own = new ArrayList<>();
            Block b = new HomeParser(own).parseStored(key, type, widget,
                    Placement.valueOf(row.getDesktopPlacement()), Devices.valueOf(row.getDevices()), row.isEnabled(),
                    row.getAdminLabel(), row.getStartsAt(), row.getEndsAt(), audience, config);
            if (!own.isEmpty()) {
                issues.addAll(own);
                log.warn("[learner-home] stored block {} of layout {} skipped: {}", key, row.getLayoutId(), own.get(0));
                return null;
            }
            return b;
        } catch (IllegalArgumentException | NullPointerException e) {
            return unreadable(key, "", "Stored block could not be read", issues);
        }
    }

    private static Block unreadable(String key, String path, String message, List<Issue> issues) {
        issues.add(new Issue(key, path, "UNREADABLE", message));
        log.warn("[learner-home] stored block {} skipped: {}", key, message);
        return null;
    }

    public static List<LearnerHomeBlock> toEntities(List<Block> blocks, String layoutId, String instituteId,
                                                    Instant now) {
        List<LearnerHomeBlock> out = new ArrayList<>();
        for (int i = 0; i < blocks.size(); i++) {
            Block b = blocks.get(i);
            out.add(LearnerHomeBlock.builder()
                    .id(UUID.randomUUID().toString())
                    .layoutId(layoutId)
                    .instituteId(instituteId)
                    .blockKey(b.blockKey())
                    .type(b.type().name())
                    .builtinWidget(b.builtinWidget() == null ? null : b.builtinWidget().name())
                    .position(i)
                    .desktopPlacement(b.placement().name())
                    .devices(b.devices().name())
                    .enabled(b.enabled())
                    .adminLabel(b.adminLabel())
                    .startsAt(b.startsAt())
                    .endsAt(b.endsAt())
                    .audienceJson(HomeWriter.toJson(HomeWriter.audience(b.audience())))
                    .configJson(HomeWriter.toJson(HomeWriter.config(b.config())))
                    .schemaVersion((short) HomeModel.SCHEMA_VERSION)
                    .createdAt(now)
                    .updatedAt(now)
                    .build());
        }
        return out;
    }

    public static Settings settings(LearnerHomeLayout layout) {
        return new HomeParser(new ArrayList<>()).parseSettings(HomeWriter.readTree(layout.getSettingsJson()));
    }
}
