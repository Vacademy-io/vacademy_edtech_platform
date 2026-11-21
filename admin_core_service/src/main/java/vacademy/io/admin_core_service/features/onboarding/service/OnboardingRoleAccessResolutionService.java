package vacademy.io.admin_core_service.features.onboarding.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.AllArgsConstructor;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.service.AudienceRoleAccessService;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingRoleAccessDTO;
import vacademy.io.admin_core_service.features.onboarding.dto.OnboardingStepFieldConfigDTO;
import vacademy.io.admin_core_service.features.onboarding.entity.OnboardingStep;
import vacademy.io.admin_core_service.features.onboarding.enums.OnboardingRoleKey;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingFlowRepository;
import vacademy.io.admin_core_service.features.onboarding.repository.OnboardingStepRepository;
import vacademy.io.admin_core_service.features.parent_link.service.ParentLinkService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Resolves the effective view/edit access for a role at step and field level.
 * ADMIN always short-circuits to full access. For any other role, a field-level entry (if
 * present) overrides the step-level default; absence of any entry defaults to
 * can_view=true, can_edit=false (safe default: visible, not editable).
 *
 * <p>{@code role_key} is NOT limited to the {@link OnboardingRoleKey} trio. Besides
 * ADMIN/STUDENT/PARENT -- the three the learner surface resolves itself to -- a grid entry may
 * name ANY institute role from auth_service (COUNSELLOR, a custom role, ...), which is how a
 * non-admin staff member is given a step to work on. {@link #resolveStaffRoleKeyForStep}
 * resolves such a caller to the single role they act as; only then do the methods below apply,
 * so by the time one of them sees a non-built-in role key, that role is already known to be a
 * participant in the step, and the "visible, not editable" fallback reads as "this role is on
 * the step but this particular field wasn't singled out for them".
 *
 * <p>Role access (and the FORM step's field list) is stored as JSON directly on
 * {@link OnboardingStep#getRoleAccess()} / {@link OnboardingStep#getFieldsConfig()} rather than
 * in separate join tables -- both are small, bounded sets always read/written as a whole.
 */
@Service
@RequiredArgsConstructor
public class OnboardingRoleAccessResolutionService {

    private final OnboardingStepRepository onboardingStepRepository;
    private final OnboardingFlowRepository onboardingFlowRepository;
    private final ParentLinkService parentLinkService;
    private final AudienceRoleAccessService audienceRoleAccessService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @AllArgsConstructor
    public static class EffectiveAccess {
        public final boolean canView;
        public final boolean canEdit;
    }

    /**
     * The role a STAFF caller effectively acts as on one step, or {@code null} if this step
     * grants none of their roles anything -- in which case they have no business on it.
     *
     * <p>Why one key rather than the caller's whole role set: every downstream check
     * ({@link #resolveStepAccess}, {@link #resolveFieldAccess}, the step handler's per-field
     * re-check) is defined as "this role's entry, falling back to the step default". Resolving
     * the caller to a single role once, here, keeps all of those consistent with each other --
     * the caller acts AS that role throughout the request, and that is also what gets stamped
     * into {@code completed_by_role}. A caller holding two granted roles acts as the more
     * permissive one (edit &gt; view-only), which is the same most-permissive-wins rule
     * {@link AudienceRoleAccessService} already applies to CRM-Leads role config.
     *
     * <p>ADMIN outranks everything (product decision, see {@code CounsellorScopeService}): an
     * admin -- including one who also holds COUNSELLOR -- always resolves to ADMIN and keeps
     * unconditional access, whatever the grid says.
     *
     * <p>Candidate roles are drawn from the step-level grid AND every field-level grid, because
     * a field-level entry overrides the step default: a role granted edit on one field but
     * absent from the step-level grid is still a genuine participant in the step.
     */
    public String resolveStaffRoleKeyForStep(CustomUserDetails user, String instituteId, String stepId) {
        Set<String> callerRoles = staffRoles(user, instituteId);
        if (callerRoles.contains(OnboardingRoleKey.ADMIN.name())) {
            return OnboardingRoleKey.ADMIN.name();
        }
        Optional<OnboardingStep> step = onboardingStepRepository.findById(stepId);
        if (step.isEmpty() || callerRoles.isEmpty()) return null;
        return bestGrantedRole(step.get(), callerRoles);
    }

    /** Uppercased role names the caller holds in this institute (JWT-fallback included). */
    public Set<String> staffRoles(CustomUserDetails user, String instituteId) {
        if (user == null) return Set.of();
        // resolvedCallerRoles mixes role names with permission names -- harmless here, since a
        // name only matters when it also appears in a step's role_access grid, and that grid is
        // populated from the institute's role list.
        return audienceRoleAccessService.resolvedCallerRoles(user, instituteId);
    }

    /**
     * The caller's most permissive granted role on this step, or null. Scores each candidate by
     * the best access it gets anywhere on the step (step-level entry or any field-level entry):
     * edit beats view-only beats nothing.
     */
    private String bestGrantedRole(OnboardingStep step, Set<String> callerRoles) {
        Map<String, Integer> scoreByRole = new LinkedHashMap<>();
        for (OnboardingRoleAccessDTO row : parseRoleAccess(step.getRoleAccess())) {
            score(scoreByRole, callerRoles, row);
        }
        for (OnboardingStepFieldConfigDTO field : parseFieldConfigs(step.getFieldsConfig())) {
            if (field.getRoleAccess() == null) continue;
            for (OnboardingRoleAccessDTO row : field.getRoleAccess()) {
                score(scoreByRole, callerRoles, row);
            }
        }
        return scoreByRole.entrySet().stream()
                .filter(e -> e.getValue() > 0)
                .max(Map.Entry.comparingByValue())
                .map(Map.Entry::getKey)
                .orElse(null);
    }

    private void score(Map<String, Integer> scoreByRole, Set<String> callerRoles, OnboardingRoleAccessDTO row) {
        if (row == null || !StringUtils.hasText(row.getRoleKey())) return;
        String key = row.getRoleKey().trim().toUpperCase();
        if (!callerRoles.contains(key)) return;
        int score = Boolean.TRUE.equals(row.getCanEdit()) ? 2 : (Boolean.TRUE.equals(row.getCanView()) ? 1 : 0);
        scoreByRole.merge(key, score, Math::max);
    }

    /**
     * Does this staff caller have ANY grant across the flow's active steps? Gates the
     * flow-scoped reads (a flow's definition, an instance's progress) that aren't tied to one
     * particular step. ADMIN always true.
     */
    public boolean hasAnyGrantInFlow(CustomUserDetails user, String instituteId, String flowId) {
        Set<String> callerRoles = staffRoles(user, instituteId);
        if (callerRoles.contains(OnboardingRoleKey.ADMIN.name())) return true;
        if (callerRoles.isEmpty()) return false;
        return onboardingStepRepository.findByFlowIdAndStatusOrderByStepOrderAsc(flowId, "ACTIVE")
                .stream().anyMatch(step -> bestGrantedRole(step, callerRoles) != null);
    }

    /**
     * Does this staff caller have ANY grant anywhere in the institute? Gates the institute-wide
     * reads that name no flow at all -- the onboarding dashboard, and a subject's side-view
     * (which spans whatever flows that subject happens to be on). ADMIN always true.
     *
     * <p>Scans the institute's ACTIVE flows and their steps rather than reading a denormalized
     * flag: role_access lives only inside each step's JSON (V383 deliberately keeps it there),
     * so there is nothing cheaper to consult. Flow/step counts are in the tens per institute,
     * and this runs once per request -- revisit if a tenant ever builds hundreds of steps.
     */
    public boolean hasAnyGrantInInstitute(CustomUserDetails user, String instituteId) {
        Set<String> callerRoles = staffRoles(user, instituteId);
        if (callerRoles.contains(OnboardingRoleKey.ADMIN.name())) return true;
        if (callerRoles.isEmpty()) return false;
        return onboardingFlowRepository.findByInstituteIdAndStatus(instituteId, "ACTIVE").stream()
                .flatMap(flow -> onboardingStepRepository
                        .findByFlowIdAndStatusOrderByStepOrderAsc(flow.getId(), "ACTIVE").stream())
                .anyMatch(step -> bestGrantedRole(step, callerRoles) != null);
    }

    /** Resolves whether the caller is ADMIN/STUDENT/PARENT for onboarding purposes.
     *  ADMIN is any caller acting through the institute-admin surface (not a lead/learner);
     *  STUDENT/PARENT are resolved from the auth_service user's is_parent/linked_parent_id
     *  linkage: a user with is_parent=true is PARENT, everyone else acting as the subject
     *  (or a linked child) is STUDENT. */
    public String resolveRoleKey(boolean callerIsAdminSurface, UserDTO callerUser) {
        if (callerIsAdminSurface) {
            return OnboardingRoleKey.ADMIN.name();
        }
        if (callerUser != null && Boolean.TRUE.equals(callerUser.getIsParent())) {
            return OnboardingRoleKey.PARENT.name();
        }
        return OnboardingRoleKey.STUDENT.name();
    }

    /**
     * True if {@code callerId} is the linked guardian (parent) of {@code subjectUserId}, per
     * auth_service's {@code users.linked_parent_id} -- lets a parent with their OWN separate
     * login act on a child's onboarding instance, not just the exact subject/resolved-subject
     * account itself. Pure DB-relationship check (no JWT authority / institute / enrolment
     * assumptions), consistent with how {@link #resolveRoleKey} already trusts the DB
     * {@code is_parent} flag rather than any JWT claim.
     */
    public boolean isLinkedGuardianOf(String callerId, String subjectUserId) {
        if (!StringUtils.hasText(callerId) || !StringUtils.hasText(subjectUserId)) return false;
        UserDTO parent = parentLinkService.getParentOfStudent(subjectUserId);
        return parent != null && callerId.equals(parent.getId());
    }

    public EffectiveAccess resolveStepAccess(String stepId, String roleKey) {
        if (OnboardingRoleKey.ADMIN.name().equals(roleKey)) {
            return new EffectiveAccess(true, true);
        }
        Optional<OnboardingStep> step = onboardingStepRepository.findById(stepId);
        List<OnboardingRoleAccessDTO> rows = step.map(s -> parseRoleAccess(s.getRoleAccess())).orElse(List.of());
        return effectiveFrom(rows, roleKey).orElse(new EffectiveAccess(true, false));
    }

    /** {@code instituteCustomFieldId} identifies the field entry within the step's fields_config JSON. */
    public EffectiveAccess resolveFieldAccess(String stepId, String instituteCustomFieldId, String roleKey) {
        if (OnboardingRoleKey.ADMIN.name().equals(roleKey)) {
            return new EffectiveAccess(true, true);
        }
        Optional<OnboardingStep> step = onboardingStepRepository.findById(stepId);
        List<OnboardingRoleAccessDTO> fieldRows = step
                .map(OnboardingStep::getFieldsConfig)
                .map(this::parseFieldConfigs)
                .orElse(List.of()).stream()
                .filter(f -> instituteCustomFieldId.equals(f.getInstituteCustomFieldId()))
                .findFirst()
                .map(f -> f.getRoleAccess() != null ? f.getRoleAccess() : List.<OnboardingRoleAccessDTO>of())
                .orElse(List.of());
        Optional<EffectiveAccess> fieldAccess = effectiveFrom(fieldRows, roleKey);
        return fieldAccess.orElseGet(() -> resolveStepAccess(stepId, roleKey));
    }

    private Optional<EffectiveAccess> effectiveFrom(List<OnboardingRoleAccessDTO> rows, String roleKey) {
        // Case-insensitive: the built-in keys are stored uppercase, but a custom institute role
        // is whatever auth_service's roles.role_name holds, and the caller's resolved role names
        // are uppercased on the way in.
        return rows.stream()
                .filter(r -> r.getRoleKey() != null && r.getRoleKey().trim().equalsIgnoreCase(roleKey))
                .findFirst()
                .map(r -> new EffectiveAccess(
                        Boolean.TRUE.equals(r.getCanView()), Boolean.TRUE.equals(r.getCanEdit())));
    }

    private List<OnboardingRoleAccessDTO> parseRoleAccess(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return List.of(objectMapper.readValue(json, OnboardingRoleAccessDTO[].class));
        } catch (Exception e) {
            return List.of();
        }
    }

    private List<OnboardingStepFieldConfigDTO> parseFieldConfigs(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return List.of(objectMapper.readValue(json, OnboardingStepFieldConfigDTO[].class));
        } catch (Exception e) {
            return List.of();
        }
    }
}
