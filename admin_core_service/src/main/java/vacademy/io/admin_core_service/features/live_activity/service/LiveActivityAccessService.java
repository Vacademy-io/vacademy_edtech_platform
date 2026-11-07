package vacademy.io.admin_core_service.features.live_activity.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.live_activity.enums.LiveActivityCategory;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Which feed categories a caller's role may see.
 *
 * <p>This is the enforcement point for per-category gating. It is deliberately server-side:
 * a UI-only category filter would still stream payment amounts down the SSE connection to a
 * counsellor's browser, where anyone can read them off the network tab.
 *
 * <p>Configuration lives in {@code ROLE_DISPLAY_SETTINGS.liveActivityRoleAccess} as
 * {@code {"ROLE_NAME": ["CALL", "LEAD_FORM"]}}, following the same
 * purpose-built-sibling-field approach as {@code audienceRoleAccess} rather than trying to
 * parse the generic per-role sidebar blob.
 *
 * <p><b>Reaching this code already means the caller passed the gate.</b> Visibility is
 * controlled by one Display Settings switch per role on the sidebar tab, which ships hidden.
 * So an unconfigured or unreadable setting here yields every category rather than a subset:
 * a role that was granted the tab should not find half the page silently empty.
 *
 * <p>The narrowing machinery is kept for the day some role needs payments or counsellor
 * activity withheld -- populate {@code liveActivityRoleAccess} and it takes effect without
 * any other change.
 */
@Service
public class LiveActivityAccessService {

    private static final Logger log = LoggerFactory.getLogger(LiveActivityAccessService.class);

    private static final String ROLE_DISPLAY_SETTINGS_KEY = "ROLE_DISPLAY_SETTINGS";
    private static final String LIVE_ACTIVITY_FIELD = "liveActivityRoleAccess";

    private static final String ADMIN_ROLE = "ADMIN";

    /** Everything. Admins are not configurable through this setting, matching Audience. */
    private static final Set<String> ALL_CATEGORIES = Arrays.stream(LiveActivityCategory.values())
            .map(Enum::name)
            .collect(Collectors.toCollection(LinkedHashSet::new));

    /**
     * What a role sees with nothing configured: everything.
     *
     * <p>Access is gated by a SINGLE Display Settings switch per role -- the sidebar tab has
     * no sub-items, and the category tabs on the page are in-page state rather than
     * navigation. So the tab being on IS the grant, and splitting categories here would mean
     * a role could hold the tab yet find half of it mysteriously empty.
     *
     * <p>The per-category plumbing is kept deliberately: the stream token still carries the
     * permitted set and {@code LiveActivityBus} still filters every frame against it. If
     * payments or counsellor activity later need narrowing for some role, it is a change to
     * the map below and nothing else.
     *
     * <p>Worth stating plainly: with one switch, turning the tab on for a role exposes
     * prospect PII AND payment amounts to that role.
     */
    private static final Set<String> DEFAULT_CATEGORIES = ALL_CATEGORIES;

    private final InstituteSettingService instituteSettingService;
    private final AudienceRoleAccessService audienceRoleAccessService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    public LiveActivityAccessService(InstituteSettingService instituteSettingService,
                                     AudienceRoleAccessService audienceRoleAccessService) {
        this.instituteSettingService = instituteSettingService;
        this.audienceRoleAccessService = audienceRoleAccessService;
    }

    /**
     * Resolve the caller's visible categories.
     *
     * <p>Role names come from {@link AudienceRoleAccessService#resolvedCallerRoles} rather
     * than a local reimplementation, because that method already carries the JWT-decode
     * fallback needed when {@code getAuthorities()} comes back empty -- which happens when
     * JwtAuthFilter could not determine the institute. The roles cannot be looked up from
     * the database here either: {@code user_role} lives in the auth_service schema, not this
     * one.
     *
     * <p>Note it also avoids {@code CustomUserDetails#isRootUser()}, which is not a usable
     * signal in this tenant -- auth-service flags nearly every user as root.
     */
    public Set<String> allowedCategories(CustomUserDetails user, String instituteId) {
        Set<String> roles = audienceRoleAccessService.resolvedCallerRoles(user, instituteId);

        // Case-insensitive on purpose: role_id 1 is stored as "Admin" in some institutes and
        // "ADMIN" in others, and a case-sensitive compare silently denies the wrong ones.
        boolean isAdmin = roles.stream().anyMatch(r -> ADMIN_ROLE.equalsIgnoreCase(r));
        if (isAdmin) {
            return ALL_CATEGORIES;
        }

        Map<String, List<String>> configured = readConfig(instituteId);
        if (configured == null || configured.isEmpty()) {
            return DEFAULT_CATEGORIES;
        }

        // Most-permissive wins across the caller's roles, matching how Audience resolves a
        // user who holds several configured roles.
        Set<String> granted = new LinkedHashSet<>();
        for (Map.Entry<String, List<String>> entry : configured.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) {
                continue;
            }
            boolean holdsRole = roles.stream().anyMatch(r -> r.equalsIgnoreCase(entry.getKey()));
            if (!holdsRole) {
                continue;
            }
            for (String category : entry.getValue()) {
                if (category != null && ALL_CATEGORIES.contains(category.trim().toUpperCase())) {
                    granted.add(category.trim().toUpperCase());
                }
            }
        }

        // No role of the caller is configured -> fall back to the tab-level grant.
        return granted.isEmpty() ? DEFAULT_CATEGORIES : granted;
    }

    public boolean canSee(CustomUserDetails user, String instituteId, LiveActivityCategory category) {
        return allowedCategories(user, instituteId).contains(category.name());
    }

    @SuppressWarnings("unchecked")
    private Map<String, List<String>> readConfig(String instituteId) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(
                    instituteId, ROLE_DISPLAY_SETTINGS_KEY);
            if (!(data instanceof Map)) {
                return null;
            }
            Object section = ((Map<String, Object>) data).get(LIVE_ACTIVITY_FIELD);
            if (section == null) {
                return null;
            }
            return objectMapper.convertValue(section, Map.class);
        } catch (Exception e) {
            // Fail closed -- see the class javadoc.
            log.warn("Failed to read {} from ROLE_DISPLAY_SETTINGS for institute {}: {}",
                    LIVE_ACTIVITY_FIELD, instituteId, e.getMessage());
            return null;
        }
    }
}
