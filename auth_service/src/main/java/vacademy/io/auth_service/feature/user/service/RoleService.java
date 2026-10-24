package vacademy.io.auth_service.feature.user.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.auth_service.feature.user.dto.ModifyUserRolesDTO;
import vacademy.io.auth_service.feature.user.dto.UserRoleFilterDTO;
import vacademy.io.common.auth.dto.PagedUserWithRolesResponse;
import vacademy.io.common.auth.dto.RoleCountProjection;
import vacademy.io.common.auth.dto.UserWithRolesDTO;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.auth.service.UserService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class RoleService {

    private final RoleRepository roleRepository;
    private final UserRepository userRepository;
    private final UserRoleRepository userRoleRepository;
    private final UserService userService;
    private final UserOperationService userOperationService;

    public RoleService(RoleRepository roleRepository, UserRepository userRepository,
            UserRoleRepository userRoleRepository, UserService userService, UserOperationService userOperationService) {
        this.roleRepository = roleRepository;
        this.userRepository = userRepository;
        this.userRoleRepository = userRoleRepository;
        this.userService = userService;
        this.userOperationService = userOperationService;
    }

    @Transactional
    public String addRolesToUser(ModifyUserRolesDTO addRolesToUserDTO, Optional<String> roleStatus,
            CustomUserDetails customUserDetails) {
        User user = getUserById(addRolesToUserDTO.getUserId());
        String instituteId = addRolesToUserDTO.getInstituteId();
        List<Role> roles = rolesUsableIn(roleRepository.findByNameIn(addRolesToUserDTO.getRoles()), instituteId);

        List<UserRole> userRoles = new ArrayList<>();
        for (Role role : roles) {
            // Already ACTIVE in THIS institute: nothing to add. The same role held in another
            // institute is a different membership and must not swallow this grant.
            boolean activeHere = userRoleRepository.findByUserAndStatusAndRoleName(user,
                    UserRoleStatus.ACTIVE.name(), role.getName()).stream()
                    .anyMatch(ur -> Objects.equals(ur.getInstituteId(), instituteId));
            if (activeHere) {
                continue;
            }
            userRoles.add(createUserRole(user, role, roleStatus, instituteId));
        }

        userRoleRepository.saveAll(userRoles);
        userService.updateLastTokenUpdatedTime(List.of(addRolesToUserDTO.getUserId()));
        return "Roles added successfully";
    }

    /**
     * What {@link #grantActiveRoles} did, by role name. A role can appear in more than one
     * list when the name resolves to a built-in role and this institute's custom role.
     */
    public record RoleGrant(List<String> added, List<String> activated, List<String> alreadyActive,
            List<String> paused, List<String> unknown) {
        public boolean changed() {
            return !added.isEmpty() || !activated.isEmpty();
        }
    }

    /**
     * Makes {@code user} an ACTIVE holder of {@code roleNames} in ONE institute — the grant
     * behind every team invite. Per role, against the user's rows in {@code instituteId} only:
     * <ul>
     *   <li>already ACTIVE: nothing (no duplicate row);</li>
     *   <li>INVITED (an invite from before members were active on creation): turned ACTIVE;</li>
     *   <li>DISABLED / INACTIVE: left paused — an invite never re-enables access an admin
     *       paused; that is "Enable access";</li>
     *   <li>none, or only removed rows (DELETED, CANCEL, ...): a new ACTIVE row.</li>
     * </ul>
     * Names resolve to the built-in role and this institute's own custom role of that name
     * ({@link #rolesUsableIn}), never another institute's. Unknown names are reported, not
     * created.
     */
    @Transactional
    public RoleGrant grantActiveRoles(User user, String instituteId, Collection<String> roleNames) {
        if (user == null || user.getId() == null || instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "user and institute are required to grant roles");
        }
        List<String> names = distinctNames(roleNames);
        List<String> added = new ArrayList<>();
        List<String> activated = new ArrayList<>();
        List<String> alreadyActive = new ArrayList<>();
        List<String> paused = new ArrayList<>();
        if (names.isEmpty()) {
            return new RoleGrant(added, activated, alreadyActive, paused, List.of());
        }
        List<Role> roles = rolesUsableIn(roleRepository.findByNameIn(names), instituteId);
        Set<String> resolved = new HashSet<>();
        roles.forEach(r -> resolved.add(r.getName()));
        List<String> unknown = names.stream().filter(n -> !resolved.contains(n)).toList();

        List<UserRole> here = new ArrayList<>();
        for (UserRole ur : userRoleRepository.findByUser(user)) {
            if (instituteId.equals(ur.getInstituteId()) && ur.getRole() != null) {
                here.add(ur);
            }
        }
        List<UserRole> toSave = new ArrayList<>();
        for (Role role : roles) {
            List<UserRole> rows = here.stream()
                    .filter(ur -> Objects.equals(ur.getRole().getId(), role.getId()))
                    .toList();
            if (rows.stream().anyMatch(ur -> UserRoleStatus.ACTIVE.name().equals(ur.getStatus()))) {
                alreadyActive.add(role.getName());
                continue;
            }
            List<UserRole> invited = rows.stream()
                    .filter(ur -> UserRoleStatus.INVITED.name().equals(ur.getStatus()))
                    .toList();
            if (!invited.isEmpty()) {
                invited.forEach(ur -> ur.setStatus(UserRoleStatus.ACTIVE.name()));
                toSave.addAll(invited);
                activated.add(role.getName());
                continue;
            }
            if (rows.stream().anyMatch(ur -> PAUSED_STATUSES.contains(ur.getStatus()))) {
                paused.add(role.getName());
                continue;
            }
            toSave.add(createUserRole(user, role, Optional.of(UserRoleStatus.ACTIVE.name()), instituteId));
            added.add(role.getName());
        }
        if (!toSave.isEmpty()) {
            userRoleRepository.saveAll(toSave);
            // Same as addRolesToUser: an existing account's open sessions pick up the new
            // institute on their next token refresh.
            userService.updateLastTokenUpdatedTime(List.of(user.getId()));
            evictCachedIdentities(instituteId, List.of(user.getId()));
        }
        return new RoleGrant(added, activated, alreadyActive, paused, unknown);
    }

    private static List<String> distinctNames(Collection<String> roleNames) {
        if (roleNames == null) {
            return List.of();
        }
        return roleNames.stream()
                // Exact names (no trim): the admin-grant guard compares them as given.
                .filter(n -> n != null && !n.isBlank())
                .collect(Collectors.toCollection(LinkedHashSet::new))
                .stream().toList();
    }

    private User getUserById(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new VacademyException("User not found for ID: " + userId));
    }

    private Iterable<Role> getRolesByIds(String commaSeparatedRoleIds) {
        List<String> roleIds = parseRoleIds(commaSeparatedRoleIds);
        return roleRepository.findAllById(roleIds);
    }

    private List<String> parseRoleIds(String commaSeparatedRoleIds) {
        if (commaSeparatedRoleIds == null || commaSeparatedRoleIds.trim().isEmpty()) {
            throw new VacademyException("Invalid Request. Provide role IDs.");
        }

        List<String> roleIds = new ArrayList<>();
        for (String id : commaSeparatedRoleIds.trim().split(",")) {
            roleIds.add(id.trim());
        }
        return roleIds;
    }

    private UserRole createUserRole(User user, Role role, Optional<String> userRoleStatus, String instituteId) {
        return createUserRole(user, role, userRoleStatus, instituteId, null, null);
    }

    private UserRole createUserRole(User user, Role role, Optional<String> userRoleStatus, String instituteId,
            String sourceType, String sourceId) {
        UserRole userRole = new UserRole();
        userRole.setUser(user);
        userRole.setRole(role);
        userRole.setInstituteId(instituteId);
        userRole.setSourceType(sourceType);
        userRole.setSourceId(sourceId);
        if (userRoleStatus.isPresent()) {
            userRole.setStatus(userRoleStatus.get());
        }
        return userRole;
    }

    /**
     * Roles a grant in {@code instituteId} may use: the built-in ones (institute_id NULL) and
     * that institute's own custom roles. Role names are only unique per institute, so a bare
     * name lookup also returns other institutes' custom roles of the same name, and granting
     * one of those would attach this user to a role (and its permissions) another institute
     * defined.
     */
    static List<Role> rolesUsableIn(List<Role> candidates, String instituteId) {
        if (candidates == null) {
            return List.of();
        }
        return candidates.stream()
                .filter(r -> r.getInstituteId() == null || r.getInstituteId().equals(instituteId))
                .toList();
    }

    /**
     * Deletes the user's rows of these roles in ONE institute. It used to delete them in every
     * institute the user belongs to, so an admin of one institute removing "TEACHER" from a
     * shared user also removed it everywhere else.
     */
    @Transactional
    public String removeRolesFromUser(ModifyUserRolesDTO modifyUserRolesDTO, CustomUserDetails customUserDetails) {
        String instituteId = modifyUserRolesDTO.getInstituteId();
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id is required to remove roles");
        }
        List<String> names = modifyUserRolesDTO.getRoles() == null ? List.of() : modifyUserRolesDTO.getRoles();
        User user = getUserById(modifyUserRolesDTO.getUserId());
        List<UserRole> rows = new ArrayList<>();
        for (UserRole ur : userRoleRepository.findByUser(user)) {
            if (instituteId.equals(ur.getInstituteId()) && ur.getRole() != null
                    && names.contains(ur.getRole().getName())) {
                rows.add(ur);
            }
        }
        userRoleRepository.deleteAll(rows);
        evictCachedIdentities(instituteId, List.of(user.getId()));
        return "Roles removed successfully";
    }

    /**
     * Pauses (DISABLED) or restores (ACTIVE) ONLY the named roles of one user in one institute,
     * for a service that manages a single kind of member (admin_core's public calling API manages
     * counsellors and nothing else). Same transitions as
     * {@link #updateUserRoleStatusByInstituteIdAndUserId}: disable moves live rows (ACTIVE /
     * INVITED), enable moves paused rows (DISABLED / INACTIVE); deleted rows never come back.
     * Role names match ignoring case.
     *
     * @return how many rows changed
     */
    @Transactional
    public int updateRoleStatusForRoles(String instituteId, String userId, List<String> roleNames, String newStatus) {
        if (instituteId == null || instituteId.isBlank() || userId == null || userId.isBlank()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "instituteId and userId are required");
        }
        if (roleNames == null || roleNames.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Name the roles to update");
        }
        List<String> from;
        if (UserRoleStatus.DISABLED.name().equals(newStatus)) {
            from = UserRoleService.ACCESS_GRANTING_STATUSES;
        } else if (UserRoleStatus.ACTIVE.name().equals(newStatus)) {
            from = PAUSED_STATUSES;
        } else {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "status must be ACTIVE or DISABLED");
        }
        User user = getUserById(userId);
        List<UserRole> changed = new ArrayList<>();
        for (UserRole ur : userRoleRepository.findByUser(user)) {
            // Role names are matched ignoring case: institutes hold "COUNSELLOR", "Counsellor"
            // and "COUNSELOR", and a caller that checked one spelling must change them all.
            if (instituteId.equals(ur.getInstituteId()) && ur.getRole() != null && ur.getRole().getName() != null
                    && roleNames.stream().anyMatch(ur.getRole().getName()::equalsIgnoreCase)
                    && from.contains(ur.getStatus())) {
                ur.setStatus(newStatus);
                changed.add(ur);
            }
        }
        if (!changed.isEmpty()) {
            userRoleRepository.saveAll(changed);
        }
        // Like the dashboard's update-role-status: only this institute's cached identity is
        // dropped, so the change applies to the member's next request HERE. The user-wide
        // "token updated" stamp is deliberately not bumped — it is one value for every
        // institute the user belongs to.
        evictCachedIdentities(instituteId, List.of(userId));
        return changed.size();
    }

    public List<RoleCountProjection> geRolesCountByInstituteId(String instituteId, CustomUserDetails userDetails) {
        return userRoleRepository.getUserRoleCountsByInstituteId(instituteId);
    }

    public List<UserWithRolesDTO> getUsersByInstituteIdAndStatus(String instituteId, UserRoleFilterDTO filterDTO,
            CustomUserDetails customUserDetails) {
        return userService.getUsersByInstituteIdAndStatus(instituteId, filterDTO.getStatus(), filterDTO.getRoles(),
                customUserDetails);
    }

    public PagedUserWithRolesResponse getUsersByInstituteIdAndStatusPaged(String instituteId,
            UserRoleFilterDTO filterDTO,
            CustomUserDetails customUserDetails) {
        int pageNumber = filterDTO.getPageNumber() != null ? filterDTO.getPageNumber() : 0;
        int pageSize = filterDTO.getPageSize() != null ? filterDTO.getPageSize() : 10;
        // When userIds is provided, route to the user-id-restricted variant. Existing callers
        // that don't set userIds keep the original behaviour.
        if (filterDTO.getUserIds() != null) {
            return userService.getUsersByInstituteIdAndStatusPagedAndUserIds(instituteId, filterDTO.getStatus(),
                    filterDTO.getRoles(), filterDTO.getUserIds(), filterDTO.getName(), pageNumber, pageSize,
                    customUserDetails);
        }
        return userService.getUsersByInstituteIdAndStatusPaged(instituteId, filterDTO.getStatus(), filterDTO.getRoles(),
                filterDTO.getName(), pageNumber, pageSize, customUserDetails);
    }

    public String updateUserRoleStatusByInstituteIdAndUserId(String newStatus, String instituteId, List<String> userIds,
            CustomUserDetails user) {
        if (UserRoleStatus.DISABLED.name().equals(newStatus)) {
            // Pause only live roles. Deleted/cancelled rows keep their status, so a later
            // "Enable access" cannot bring back a role the admin removed.
            userRoleRepository.updateUserRoleStatusFromStatuses(newStatus,
                    UserRoleService.ACCESS_GRANTING_STATUSES, instituteId, userIds);
        } else if (UserRoleStatus.ACTIVE.name().equals(newStatus)) {
            // Restore exactly what a disable paused.
            userRoleRepository.updateUserRoleStatusFromStatuses(newStatus, PAUSED_STATUSES, instituteId,
                    userIds);
        } else {
            int rowsUpdated = userRoleRepository.updateUserRoleStatusByInstituteIdAndUserId(newStatus, instituteId,
                    userIds);
            if (rowsUpdated == 0) {
                throw new VacademyException("No role found to update the status!!!");
            }
        }
        // Enable/disable is idempotent: repeating it (double click, retry) is not an error.
        evictCachedIdentities(instituteId, userIds);
        return "Status updated successfully";
    }

    private static final List<String> PAUSED_STATUSES = List.of(UserRoleStatus.DISABLED.name(), "INACTIVE");
    private static final String AUTH_USER_DETAILS_CACHE = "authUserDetails";

    // Field-injected and optional so the explicit constructor above (and anything that builds
    // this service by hand) is unchanged.
    @Autowired(required = false)
    private CacheManager cacheManager;

    /**
     * Drops the cached caller identity ({@code username_instituteId}) that
     * /auth-service/v1/internal/user serves to every other service, so a disable blocks the
     * member's very next request instead of after the 5-minute TTL. Other services keep their
     * own short-lived copies; those expire on their own. Best effort: a cache that cannot be
     * evicted must not fail the status change.
     */
    private void evictCachedIdentities(String instituteId, List<String> userIds) {
        if (cacheManager == null || userIds == null || userIds.isEmpty()) {
            return;
        }
        try {
            Cache cache = cacheManager.getCache(AUTH_USER_DETAILS_CACHE);
            if (cache == null) {
                return;
            }
            for (User member : userRepository.findAllById(userIds)) {
                if (member.getUsername() != null) {
                    cache.evict(member.getUsername() + "_" + instituteId);
                }
            }
        } catch (Exception ignored) {
            // The entry expires within 5 minutes regardless.
        }
    }

    public List<UserWithRolesDTO> getUsersByInstituteIdAndStatus(String instituteId, UserRoleFilterDTO filterDTO) {
        return userService.getUsersByInstituteIdAndStatus(instituteId, filterDTO.getStatus(), filterDTO.getRoles());
    }
}
