package vacademy.io.admin_core_service.features.telephony.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.telephony.controller.dto.TelephonyCounsellorEndpointDTO;
import vacademy.io.admin_core_service.features.telephony.controller.dto.TelephonyEndpointUserDTO;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;

import vacademy.io.common.auth.dto.UserRoleDTO;
import vacademy.io.common.auth.dto.UserWithRolesDTO;

import java.util.Comparator;
import java.util.List;
import java.util.Set;

/**
 * Admin API to map a platform user to their per-provider endpoint (extension +
 * DID) for no-pool providers (Airtel). JWT-gated (not in the public allowlist).
 *
 * <p>Every route is limited to staff of the institute it touches (the path
 * institute, or the row's own institute for a delete). JWT alone only proved the
 * caller was signed in somewhere: any user could list, re-point or delete another
 * institute's extensions, and an upsert could move a user's row into a different
 * institute (the row is unique per user + provider).
 *
 * <p>The table column is still {@code counsellor_user_id} — it predates admins
 * having extensions — but the row is just "the person who dials from this
 * extension". Counsellors calling leads and admins calling learners from the LMS
 * side-view both resolve through the same map, so no schema change was needed.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/counsellor-endpoints")
public class TelephonyCounsellorEndpointController {

    /** Both spellings, both casings: the seed data and the frontend gates disagree
     *  on COUNSELLOR/COUNSELOR and on ADMIN vs "Admin" (role_id 1 is stored as
     *  "Admin" on several institutes), and users-of-status matches role name
     *  exactly. Querying the union is cheaper than being wrong on one institute. */
    public static final List<String> ENDPOINT_ELIGIBLE_ROLES =
            List.of("COUNSELLOR", "COUNSELOR", "ADMIN", "Admin");

    @Autowired private TelephonyCounsellorEndpointRepository repo;
    @Autowired private AuthService authService;
    @Autowired private InstituteAccessValidator instituteAccessValidator;

    @GetMapping("/{instituteId}")
    public List<TelephonyCounsellorEndpointDTO> list(
            @PathVariable String instituteId,
            @RequestParam(value = "providerType", required = false, defaultValue = "AIRTEL") String providerType,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        return repo.findByInstituteIdAndProviderType(instituteId, providerType.trim().toUpperCase())
                .stream().map(TelephonyCounsellorEndpointDTO::from).toList();
    }

    @PutMapping("/{instituteId}")
    @Transactional
    public TelephonyCounsellorEndpointDTO upsert(
            @PathVariable String instituteId,
            @RequestBody TelephonyCounsellorEndpointDTO body,
            @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        requireNonBlank(body.getCounsellorUserId(), "counsellorUserId is required");
        requireNonBlank(body.getProviderType(), "providerType is required");
        String providerType = body.getProviderType().trim().toUpperCase();

        TelephonyCounsellorEndpoint e = repo
                .findByCounsellorUserIdAndProviderType(body.getCounsellorUserId(), providerType)
                .orElseGet(TelephonyCounsellorEndpoint::new);
        // One row per user + provider: an existing row of another institute is that
        // institute's, never re-homed here.
        if (e.getInstituteId() != null && !instituteId.equals(e.getInstituteId())) {
            throw new ConflictException("This user's extension is managed by another institute.");
        }
        // A new row is only for someone who may hold one HERE (the same set the picker
        // offers), so nobody can squat another institute's user on the unique key.
        if (e.getId() == null && !isEligibleUser(instituteId, body.getCounsellorUserId())) {
            throw new VacademyException("This user is not a counsellor or admin of this institute");
        }
        // An extension identifies the caller on the institute's Airtel account; two people on
        // one extension would make every imported call record ambiguous.
        String extension = body.getExtension() == null ? null : blankToNull(body.getExtension());
        String holder = extension == null ? null
                : extensionHolder(repo, instituteId, providerType, extension, body.getCounsellorUserId());
        if (holder != null) {
            throw new ConflictException("Extension " + extension + " is already mapped to "
                    + describeUser(authService, holder) + ". Remove it there first.");
        }
        e.setInstituteId(instituteId);
        e.setCounsellorUserId(body.getCounsellorUserId());
        e.setProviderType(providerType);
        if (body.getExtension() != null) e.setExtension(blankToNull(body.getExtension()));
        if (body.getProviderUserId() != null) e.setProviderUserId(blankToNull(body.getProviderUserId()));
        if (body.getDid() != null) e.setDid(blankToNull(body.getDid()));
        if (body.getEnabled() != null) e.setEnabled(body.getEnabled());

        return TelephonyCounsellorEndpointDTO.from(repo.save(e));
    }

    /**
     * The people an admin may hand an extension to: this institute's ACTIVE
     * counsellors AND admins.
     *
     * <p>Not {@code /lead-counsellor-options}: that endpoint answers "who can a
     * lead be assigned to", so it is COUNSELLOR-role only and hierarchy-scoped.
     * An extension is a phone-system fact, not a lead-routing one — an admin who
     * never touches the CRM still needs one to call a learner from the LMS
     * side-view, and the counsellor picker could never offer them.
     */
    @GetMapping("/{instituteId}/eligible-users")
    public List<TelephonyEndpointUserDTO> eligibleUsers(@PathVariable String instituteId,
                                                        @RequestAttribute("user") CustomUserDetails user) {
        instituteAccessValidator.requireInstituteStaff(user, instituteId);
        List<UserWithRolesDTO> users =
                authService.getActiveUsersByRoles(instituteId, ENDPOINT_ELIGIBLE_ROLES);
        return users.stream()
                .filter(u -> u.getId() != null && !u.getId().isBlank())
                .map(u -> TelephonyEndpointUserDTO.builder()
                        .id(u.getId())
                        .fullName(displayName(u))
                        .email(u.getEmail())
                        .roles(instituteRoles(u, instituteId))
                        .build())
                // Stable, human order — the picker is a flat list an admin scans by name.
                .sorted(Comparator.comparing(TelephonyEndpointUserDTO::getFullName,
                        String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    /** Role names this user holds IN THIS institute, uppercased and deduped. A
     *  user's role set spans every institute they belong to, so filtering by
     *  institute keeps the badge honest for multi-institute staff. */
    private static List<String> instituteRoles(UserWithRolesDTO u, String instituteId) {
        Set<UserRoleDTO> roles = u.getRoles();
        if (roles == null) return List.of();
        return roles.stream()
                .filter(r -> r.getRoleName() != null)
                .filter(r -> r.getInstituteId() == null || instituteId.equals(r.getInstituteId()))
                .map(r -> r.getRoleName().toUpperCase())
                .distinct()
                .sorted()
                .toList();
    }

    private static String displayName(UserWithRolesDTO u) {
        if (u.getFullName() != null && !u.getFullName().isBlank()) return u.getFullName();
        if (u.getEmail() != null && !u.getEmail().isBlank()) return u.getEmail();
        if (u.getUsername() != null && !u.getUsername().isBlank()) return u.getUsername();
        return u.getId();
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable String id,
                                       @RequestAttribute("user") CustomUserDetails user) {
        TelephonyCounsellorEndpoint row = repo.findById(id).orElse(null);
        // Unknown id: nothing to delete (same 204 as before, so a retry stays harmless).
        if (row == null) return ResponseEntity.noContent().build();
        instituteAccessValidator.requireInstituteStaff(user, row.getInstituteId());
        repo.delete(row);
        return ResponseEntity.noContent().build();
    }

    /**
     * Another user of this institute whose ENABLED mapping uses {@code extension} on this
     * provider, or null. A disabled mapping attributes no calls (the importer reads enabled
     * rows only), so it does not block the extension.
     */
    public static String extensionHolder(TelephonyCounsellorEndpointRepository repo, String instituteId,
                                         String providerType, String extension, String userId) {
        if (extension == null || extension.isBlank()) return null;
        return repo.findByInstituteIdAndProviderTypeAndExtension(instituteId, providerType, extension.trim()).stream()
                .filter(e -> !Boolean.FALSE.equals(e.getEnabled()))
                .map(TelephonyCounsellorEndpoint::getCounsellorUserId)
                .filter(u -> u != null && !u.equals(userId))
                .findFirst().orElse(null);
    }

    /** "Name (email)" of a user of this institute for a conflict message; the id when unknown. */
    public static String describeUser(AuthService authService, String userId) {
        try {
            List<vacademy.io.common.auth.dto.UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            if (users != null) {
                for (vacademy.io.common.auth.dto.UserDTO u : users) {
                    if (u == null || !userId.equals(u.getId())) continue;
                    String name = u.getFullName() == null || u.getFullName().isBlank() ? null : u.getFullName().trim();
                    String email = u.getEmail() == null || u.getEmail().isBlank() ? null : u.getEmail().trim();
                    if (name != null && email != null) return name + " (" + email + ")";
                    if (name != null || email != null) return name != null ? name : email;
                }
            }
        } catch (RuntimeException ignored) {
            // A name is a courtesy in an error message; the id still identifies the person.
        }
        return "user " + userId;
    }

    private boolean isEligibleUser(String instituteId, String userId) {
        return authService.getActiveUsersByRoles(instituteId, ENDPOINT_ELIGIBLE_ROLES).stream()
                .anyMatch(u -> u != null && userId.equals(u.getId()));
    }

    private static void requireNonBlank(String s, String msg) {
        if (s == null || s.isBlank()) throw new VacademyException(msg);
    }

    private static String blankToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}
