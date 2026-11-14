package vacademy.io.admin_core_service.features.live_session.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.live_session.client.InstituteRoleUserClient;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionRoleVisibilityConfigDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionVisibilityScope;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.enums.LiveSessionVisibilityModeEnum;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionInstructorRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.*;

/**
 * Resolves, per caller, how much of an institute's live-session list they may
 * see — the read side of the V524 role-based visibility feature.
 *
 * <h2>Configuration</h2>
 * {@code LIVE_SESSION_SETTING.roleVisibility} is a map of role name to
 * {@code {mode, roles[]}}. A role with no entry means {@link
 * LiveSessionVisibilityModeEnum#ALL}, so an institute that never touches the
 * setting behaves exactly as it did before this feature existed.
 *
 * <h2>Combining a caller's roles</h2>
 * A caller holding several roles gets the <b>most permissive</b> of their
 * rules. This is deliberate and is the safety property that makes the feature
 * additive: restricting TEACHER cannot accidentally restrict the person who is
 * both a TEACHER and an ADMIN, because ADMIN has no rule and therefore means
 * ALL. Restricting somebody genuinely requires restricting every role they
 * hold.
 *
 * <h2>Failure behaviour</h2>
 * A missing or malformed setting resolves to ALL — an unreadable rule must not
 * blank out an institute's schedule. A failed <i>role membership</i> lookup
 * resolves the other way, down to OWN: the admin's intent to restrict is
 * already established at that point, so the safe degradation is to show less,
 * not more. See {@link InstituteRoleUserClient}.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LiveSessionVisibilityService {

    private static final String LIVE_SESSION_SETTING_KEY = "LIVE_SESSION_SETTING";
    private static final String ROLE_VISIBILITY_NODE = "roleVisibility";

    private final InstituteSettingService instituteSettingService;
    private final InstituteRoleUserClient instituteRoleUserClient;
    private final LiveSessionInstructorRepository instructorRepository;
    private final LiveSessionRepository liveSessionRepository;
    private final ObjectMapper objectMapper;

    /**
     * The caller's scope for one institute. Callers pass the result straight
     * into the repository queries; nothing else needs to know the rules.
     */
    public LiveSessionVisibilityScope resolveScope(String instituteId, CustomUserDetails user) {
        String callerId = user != null ? user.getUserId() : null;

        if (!StringUtils.hasText(instituteId) || user == null || !StringUtils.hasText(callerId)) {
            return LiveSessionVisibilityScope.unrestricted(callerId);
        }
        // Deliberately NO is_root_user bypass. On this platform that flag is set
        // for every invited staff account (InviteUserService.setRootUser(true);
        // 13 of 13 staff on the first institute checked), so it means "admin
        // portal user", not "institute owner". Exempting it would make every
        // rule a no-op. Owners are already protected by the ALL default: an
        // ADMIN role with no rule always sees everything.

        Map<String, LiveSessionRoleVisibilityConfigDTO> rules = readRoleVisibilityRules(instituteId);
        if (rules.isEmpty()) {
            return LiveSessionVisibilityScope.unrestricted(callerId);
        }

        // Only consulted once the institute has configured at least one rule,
        // so unconfigured institutes pay no cross-service call here.
        Optional<Set<String>> callerRolesLookup =
                instituteRoleUserClient.findRolesOfUser(instituteId, callerId);
        if (callerRolesLookup.isEmpty()) {
            // Can't tell what the caller is, and the institute has asked for
            // restrictions: show them their own work rather than everything.
            log.warn("live_session.visibility.caller_roles_unknown_degraded_to_own instituteId={} userId={}",
                    instituteId, callerId);
            return new LiveSessionVisibilityScope(true, callerId, Set.of(callerId));
        }
        Set<String> callerRoles = callerRolesLookup.get();
        if (callerRoles.isEmpty()) {
            // No role at this institute at all: nothing to apply a rule to.
            return LiveSessionVisibilityScope.unrestricted(callerId);
        }

        // Most-permissive wins. A role with no rule is ALL, which short-circuits.
        LiveSessionVisibilityModeEnum effectiveMode = LiveSessionVisibilityModeEnum.OWN;
        Set<String> visibleRoleNames = new HashSet<>();
        for (String roleName : callerRoles) {
            LiveSessionRoleVisibilityConfigDTO rule = rules.get(roleName);
            LiveSessionVisibilityModeEnum mode =
                    rule == null ? LiveSessionVisibilityModeEnum.ALL : rule.resolveMode();
            if (mode == LiveSessionVisibilityModeEnum.ALL) {
                return LiveSessionVisibilityScope.unrestricted(callerId);
            }
            if (mode == LiveSessionVisibilityModeEnum.SPECIFIC_ROLES) {
                effectiveMode = LiveSessionVisibilityModeEnum.SPECIFIC_ROLES;
                if (rule.getRoles() != null) {
                    rule.getRoles().stream()
                            .filter(StringUtils::hasText)
                            .map(r -> r.trim().toUpperCase())
                            .forEach(visibleRoleNames::add);
                }
            }
        }

        Set<String> allowedUserIds = new HashSet<>();
        allowedUserIds.add(callerId);

        if (effectiveMode == LiveSessionVisibilityModeEnum.SPECIFIC_ROLES && !visibleRoleNames.isEmpty()) {
            Optional<Set<String>> roleMembers =
                    instituteRoleUserClient.findUserIdsWithRoles(instituteId, visibleRoleNames);
            if (roleMembers.isPresent()) {
                allowedUserIds.addAll(roleMembers.get());
            } else {
                // Degrade to OWN rather than to ALL — see class javadoc.
                log.warn("live_session.visibility.degraded_to_own instituteId={} userId={}",
                        instituteId, callerId);
            }
        }

        return new LiveSessionVisibilityScope(true, callerId, Set.copyOf(allowedUserIds));
    }

    /**
     * Guards the by-id reads and the edit/delete writes. Filtering the lists
     * alone would leave every session reachable by anyone who has its URL.
     *
     * @throws VacademyException when the session is out of the caller's scope
     */
    public void assertCanAccessSession(String sessionId, CustomUserDetails user) {
        if (!StringUtils.hasText(sessionId)) {
            return;
        }
        LiveSession session = liveSessionRepository.findById(sessionId).orElse(null);
        if (session == null) {
            // Absent sessions are the caller's problem to report, not ours.
            return;
        }
        if (!canAccess(session, user)) {
            throw new VacademyException("You do not have access to this live session");
        }
    }

    /** Non-throwing form of {@link #assertCanAccessSession}. */
    public boolean canAccess(LiveSession session, CustomUserDetails user) {
        if (session == null) {
            return true;
        }
        LiveSessionVisibilityScope scope = resolveScope(session.getInstituteId(), user);
        if (!scope.restricted()) {
            return true;
        }
        if (StringUtils.hasText(scope.callerUserId())
                && scope.callerUserId().equals(session.getCreatedByUserId())) {
            return true;
        }

        List<String> instructorIds = instructorRepository.findActiveUserIdsBySessionId(session.getId());
        if (instructorIds.isEmpty()) {
            // Creator-as-implicit-instructor fallback (pre-V524 sessions).
            return scope.allowedUserIds().contains(session.getCreatedByUserId());
        }
        return instructorIds.stream().anyMatch(scope.allowedUserIds()::contains);
    }

    /** Role-name-keyed rules, upper-cased. Empty map means "no rules configured". */
    private Map<String, LiveSessionRoleVisibilityConfigDTO> readRoleVisibilityRules(String instituteId) {
        try {
            Object rawData = instituteSettingService.getSettingByInstituteIdAndKey(
                    instituteId, LIVE_SESSION_SETTING_KEY);
            if (rawData == null) {
                return Map.of();
            }
            JsonNode node = objectMapper.valueToTree(rawData).path(ROLE_VISIBILITY_NODE);
            if (!node.isObject() || node.isEmpty()) {
                return Map.of();
            }
            Map<String, LiveSessionRoleVisibilityConfigDTO> rules = new HashMap<>();
            Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
            while (fields.hasNext()) {
                Map.Entry<String, JsonNode> entry = fields.next();
                if (!StringUtils.hasText(entry.getKey()) || !entry.getValue().isObject()) {
                    continue;
                }
                LiveSessionRoleVisibilityConfigDTO rule = objectMapper.treeToValue(
                        entry.getValue(), LiveSessionRoleVisibilityConfigDTO.class);
                if (rule != null) {
                    rules.put(entry.getKey().trim().toUpperCase(), rule);
                }
            }
            return rules;
        } catch (Exception e) {
            // Unreadable config means ALL: never blank out a schedule over a parse error.
            log.warn("live_session.visibility.settings_read_failed instituteId={}: {}",
                    instituteId, e.getMessage());
            return Map.of();
        }
    }
}
