package vacademy.io.admin_core_service.features.doubts.service;

import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.doubts.dtos.DoubtStatusDto;
import vacademy.io.admin_core_service.features.doubts.entity.Doubts;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtStatusEnum;
import vacademy.io.admin_core_service.features.doubts.enums.DoubtStatusKindEnum;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.doubt_management.DoubtManagementSettingDataDto.WorkflowStatusConfig;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Pure helpers over the institute's configurable workflow statuses (DOUBT_MANAGEMENT_SETTING.statuses).
 *
 * <p>Two statuses are built in and always present: {@link #PENDING} (kind OPEN) and
 * {@link #RESOLVED} (kind RESOLVED). Legacy rows have {@code workflow_status = NULL}; their effective
 * status is derived from the coarse {@code status} column so nothing needs a backfill and every
 * existing ACTIVE/RESOLVED consumer (learner app, notifications, filters) keeps working.</p>
 */
public final class DoubtStatusCatalog {

    public static final String PENDING = "PENDING";
    public static final String RESOLVED = "RESOLVED";

    private DoubtStatusCatalog() {}

    /** The two built-ins, used when nothing is configured and to guarantee they exist when it is. */
    public static List<WorkflowStatusConfig> defaults() {
        List<WorkflowStatusConfig> list = new ArrayList<>();
        list.add(WorkflowStatusConfig.builder().key(PENDING).label("Pending").learnerLabel("Pending")
                .kind(DoubtStatusKindEnum.OPEN.name()).enabled(true).isSystem(true).build());
        list.add(WorkflowStatusConfig.builder().key(RESOLVED).label("Resolved").learnerLabel("Resolved")
                .kind(DoubtStatusKindEnum.RESOLVED.name()).enabled(true).isSystem(true).build());
        return list;
    }

    /**
     * The institute's catalog with the built-ins guaranteed: configured entries in their stored
     * order, PENDING prepended / RESOLVED appended when the stored blob lacks them. Entries without
     * a key are dropped; an entry's kind defaults to OPEN (RESOLVED for the RESOLVED key).
     */
    public static List<WorkflowStatusConfig> resolve(DoubtManagementSettingDataDto setting) {
        List<WorkflowStatusConfig> configured = setting == null || setting.getStatuses() == null
                ? List.of() : setting.getStatuses();
        List<WorkflowStatusConfig> result = new ArrayList<>();
        boolean hasPending = false;
        boolean hasResolved = false;
        for (WorkflowStatusConfig cfg : configured) {
            if (cfg == null || !StringUtils.hasText(cfg.getKey())) continue;
            String key = cfg.getKey().trim().toUpperCase();
            if (PENDING.equals(key)) hasPending = true;
            if (RESOLVED.equals(key)) hasResolved = true;
            result.add(WorkflowStatusConfig.builder()
                    .key(key)
                    .label(StringUtils.hasText(cfg.getLabel()) ? cfg.getLabel() : humanize(key))
                    .learnerLabel(cfg.getLearnerLabel())
                    .kind(normalizeKind(cfg.getKind(), key))
                    .color(cfg.getColor())
                    .enabled(cfg.getEnabled() == null || cfg.getEnabled())
                    .isSystem(PENDING.equals(key) || RESOLVED.equals(key) || Boolean.TRUE.equals(cfg.getIsSystem()))
                    .build());
        }
        List<WorkflowStatusConfig> defaults = defaults();
        if (!hasPending) result.add(0, defaults.get(0));
        if (!hasResolved) result.add(defaults.get(1));
        return result;
    }

    public static Optional<WorkflowStatusConfig> find(List<WorkflowStatusConfig> catalog, String key) {
        if (!StringUtils.hasText(key)) return Optional.empty();
        return catalog.stream().filter(c -> c.getKey().equalsIgnoreCase(key.trim())).findFirst();
    }

    /**
     * The status a doubt is effectively in: its stored workflow key, or — for rows written before
     * workflow statuses existed — RESOLVED / PENDING from the coarse status column.
     */
    public static String effectiveKey(Doubts doubt) {
        if (doubt == null) return PENDING;
        if (StringUtils.hasText(doubt.getWorkflowStatus())) return doubt.getWorkflowStatus();
        return DoubtStatusEnum.RESOLVED.name().equals(doubt.getStatus()) ? RESOLVED : PENDING;
    }

    public static DoubtStatusKindEnum kindOf(WorkflowStatusConfig cfg) {
        if (cfg == null) return DoubtStatusKindEnum.OPEN;
        try {
            return DoubtStatusKindEnum.valueOf(normalizeKind(cfg.getKind(), cfg.getKey()));
        } catch (IllegalArgumentException e) {
            return DoubtStatusKindEnum.OPEN;
        }
    }

    /** The coarse doubts.status value a workflow status implies. */
    public static String coarseStatusFor(WorkflowStatusConfig cfg) {
        return kindOf(cfg) == DoubtStatusKindEnum.RESOLVED
                ? DoubtStatusEnum.RESOLVED.name() : DoubtStatusEnum.ACTIVE.name();
    }

    /** Learner-facing projection: learner label (falls back to the internal label) + kind. */
    public static DoubtStatusDto toLearnerStatus(List<WorkflowStatusConfig> catalog, Doubts doubt) {
        String key = effectiveKey(doubt);
        WorkflowStatusConfig cfg = find(catalog, key).orElse(null);
        if (cfg == null) {
            // Unknown key (status removed from settings after use) — degrade to the coarse state so
            // the learner still sees something truthful rather than a raw key.
            boolean resolved = DoubtStatusEnum.RESOLVED.name().equals(doubt.getStatus());
            return DoubtStatusDto.builder()
                    .key(key)
                    .label(resolved ? "Resolved" : "Pending")
                    .kind(resolved ? DoubtStatusKindEnum.RESOLVED.name() : DoubtStatusKindEnum.OPEN.name())
                    .build();
        }
        return DoubtStatusDto.builder()
                .key(cfg.getKey())
                .label(StringUtils.hasText(cfg.getLearnerLabel()) ? cfg.getLearnerLabel() : cfg.getLabel())
                .kind(kindOf(cfg).name())
                .build();
    }

    private static String normalizeKind(String raw, String key) {
        // The built-ins have a fixed meaning whatever the stored blob says — the learner app and
        // every ACTIVE/RESOLVED consumer depend on it.
        if (PENDING.equals(key)) return DoubtStatusKindEnum.OPEN.name();
        if (RESOLVED.equals(key)) return DoubtStatusKindEnum.RESOLVED.name();
        if (StringUtils.hasText(raw)) {
            String upper = raw.trim().toUpperCase();
            for (DoubtStatusKindEnum k : DoubtStatusKindEnum.values()) {
                if (k.name().equals(upper)) return upper;
            }
        }
        return RESOLVED.equals(key) ? DoubtStatusKindEnum.RESOLVED.name() : DoubtStatusKindEnum.OPEN.name();
    }

    private static String humanize(String key) {
        String[] words = key.toLowerCase().split("[_\\s]+");
        StringBuilder sb = new StringBuilder();
        for (String w : words) {
            if (w.isEmpty()) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
        }
        return sb.toString();
    }
}
