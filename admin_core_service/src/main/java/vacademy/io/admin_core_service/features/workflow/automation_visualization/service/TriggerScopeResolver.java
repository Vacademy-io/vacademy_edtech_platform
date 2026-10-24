package vacademy.io.admin_core_service.features.workflow.automation_visualization.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.enroll_invite.repository.EnrollInviteRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.common.institute.entity.session.PackageSession;

import java.util.ArrayList;
import java.util.List;

/**
 * Turns the entity ids stored on a workflow_trigger row into names a human recognises.
 *
 * <p>The diagram used to show a trigger as the bare word "TRIGGER" -- no event, no applied
 * type, and certainly not which audience or batch the workflow actually fires for. An admin
 * looking at a live automation could not answer "does this run for my JEE campaign?" without
 * reading the database. Every lookup here is best-effort: an id that no longer resolves is
 * surfaced as the id itself rather than dropped, because a dangling reference is exactly the
 * thing someone reading the diagram needs to notice.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TriggerScopeResolver {

    private final AudienceRepository audienceRepository;
    private final PackageSessionRepository packageSessionRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final EnrollInviteRepository enrollInviteRepository;

    /**
     * @param eventAppliedType AUDIENCE / PACKAGE_SESSION / LIVE_SESSION / ENROLL_INVITE, or
     *                         anything else (returns the ids unchanged)
     * @param eventIds         entity ids from the trigger rows; empty means "fires for everything"
     */
    public List<String> resolveLabels(String eventAppliedType, List<String> eventIds) {
        List<String> labels = new ArrayList<>();
        if (eventIds == null || eventIds.isEmpty()) {
            return labels;
        }
        for (String id : eventIds) {
            if (id == null || id.isBlank()) {
                continue;
            }
            labels.add(resolveOne(eventAppliedType, id));
        }
        return labels;
    }

    private String resolveOne(String eventAppliedType, String id) {
        try {
            if (eventAppliedType == null) {
                return id;
            }
            String name = switch (eventAppliedType.toUpperCase()) {
                case "AUDIENCE" -> audienceRepository.findById(id)
                        .map(a -> blankToNull(a.getCampaignName()))
                        .orElse(null);
                case "PACKAGE_SESSION" -> packageSessionRepository.findById(id)
                        .map(this::describePackageSession)
                        .orElse(null);
                case "LIVE_SESSION" -> liveSessionRepository.findById(id)
                        .map(s -> blankToNull(s.getTitle()))
                        .orElse(null);
                case "ENROLL_INVITE" -> enrollInviteRepository.findById(id)
                        .map(i -> blankToNull(i.getName()))
                        .orElse(null);
                default -> null;
            };
            return name != null ? name : id;
        } catch (Exception e) {
            // A diagram must render even when a lookup blows up -- it is a read-only view.
            log.warn("Could not resolve {} entity {} for the workflow diagram: {}",
                    eventAppliedType, id, e.getMessage());
            return id;
        }
    }

    private String describePackageSession(PackageSession ps) {
        StringBuilder sb = new StringBuilder();
        if (ps.getPackageEntity() != null && ps.getPackageEntity().getPackageName() != null) {
            sb.append(ps.getPackageEntity().getPackageName());
        }
        if (ps.getLevel() != null && ps.getLevel().getLevelName() != null) {
            if (sb.length() > 0) sb.append(" — ");
            sb.append(ps.getLevel().getLevelName());
        }
        if (ps.getSession() != null && ps.getSession().getSessionName() != null) {
            if (sb.length() > 0) sb.append(" / ");
            sb.append(ps.getSession().getSessionName());
        }
        return sb.length() > 0 ? sb.toString() : blankToNull(ps.getName());
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }
}
