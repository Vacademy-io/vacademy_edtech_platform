package vacademy.io.auth_service.feature.user.service;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.auth_service.feature.user.dto.CustomRoleDTO;
import vacademy.io.auth_service.feature.user.dto.CreateRoleDTO;
import vacademy.io.auth_service.feature.user.dto.PermissionDTO;
import vacademy.io.auth_service.feature.user.dto.UpdateRoleDTO;
import vacademy.io.auth_service.feature.user.repository.PermissionRepository;
import vacademy.io.common.auth.entity.Permissions;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.auth.repository.UserRoleRepository;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class CustomRoleService {

    @Autowired
    private RoleRepository roleRepository;

    @Autowired
    private PermissionRepository permissionRepository;

    @Autowired
    private UserRoleRepository userRoleRepository;

    @Transactional
    public CustomRoleDTO createCustomRole(String instituteId, CreateRoleDTO createRoleDTO) {
        // Check uniqueness for the institute
        if (roleRepository.findByNameAndInstituteId(createRoleDTO.getName(), instituteId).isPresent()) {
            throw new VacademyException("Role with this name already exists in this institute.");
        }

        rejectSystemRoleName(createRoleDTO.getName());

        Role role = new Role();
        role.setName(createRoleDTO.getName());
        role.setInstituteId(instituteId);

        List<Permissions> permissionsList = (List<Permissions>) permissionRepository
                .findAllById(createRoleDTO.getPermissionIds());
        Set<Permissions> permissions = new HashSet<>(permissionsList);
        role.setAuthorities(permissions);

        Role savedRole = roleRepository.save(role);
        return mapToDTO(savedRole);
    }

    @Transactional
    public CustomRoleDTO updateCustomRole(String instituteId, String roleId, UpdateRoleDTO updateRoleDTO) {
        Role role = roleRepository.findById(roleId)
                .orElseThrow(() -> new VacademyException("Role not found"));

        if (!instituteId.equals(role.getInstituteId())) {
            throw new VacademyException("You cannot modify this role.");
        }

        // If name is changing, check for uniqueness
        if (!role.getName().equals(updateRoleDTO.getName())) {
            if (roleRepository.findByNameAndInstituteId(updateRoleDTO.getName(), instituteId).isPresent()) {
                throw new VacademyException("Role with this name already exists in this institute.");
            }
            rejectSystemRoleName(updateRoleDTO.getName());
        }

        role.setName(updateRoleDTO.getName());
        List<Permissions> permissionsList = (List<Permissions>) permissionRepository
                .findAllById(updateRoleDTO.getPermissionIds());
        Set<Permissions> permissions = new HashSet<>(permissionsList);
        role.setAuthorities(permissions);

        Role savedRole = roleRepository.save(role);
        return mapToDTO(savedRole);
    }

    @Transactional
    public void deleteCustomRole(String instituteId, String roleId) {
        Role role = roleRepository.findById(roleId)
                .orElseThrow(() -> new VacademyException("Role not found"));

        if (!instituteId.equals(role.getInstituteId())) {
            throw new VacademyException("You cannot delete this role.");
        }

        // Check if role is assigned to any user
        // Note: This needs a method in UserRoleRepository to check existance.
        // Assuming we want to block deletion if assigned.
        // We can't easily check this efficiently without a repository method
        // modification or custom query,
        // relying on FK constraint might be cleaner but throws DB error.
        // For now, let's process delete and let DB constraints handle it or add check
        // later.

        roleRepository.delete(role);
    }

    // Role names reach the token's authorities uppercased, so a custom role called "admin"
    // would read as ADMIN everywhere authorities are checked. Compare ignoring case (the
    // unused legacy rows only by exact name, as before).
    private void rejectSystemRoleName(String name) {
        if (name != null && roleRepository.findAllByInstituteIdIsNull().stream()
                .anyMatch(role -> name.equals(role.getName()) || (!LEGACY_ROLE_NAMES.contains(role.getName())
                        && name.trim().equalsIgnoreCase(role.getName())))) {
            throw new VacademyException("Role name conflicts with a system role.");
        }
    }

    // Global rows seeded in 2024 that are no longer used. "Admin" (id 1) duplicates the
    // real "ADMIN" (id 5) and every one of them showed up in the role pickers, so admins
    // kept assigning them. Exact-case match: role_name is unique, so these never hit
    // ADMIN or an institute's custom role.
    private static final Set<String> LEGACY_ROLE_NAMES = Set.of("Admin", "User", "Moderator", "Guest");

    public List<CustomRoleDTO> getRolesForInstitute(String instituteId) {
        // System roles have institute_id IS NULL
        List<Role> systemRoles = roleRepository.findAllByInstituteIdIsNull().stream()
                .filter(role -> !LEGACY_ROLE_NAMES.contains(role.getName()))
                .collect(Collectors.toList());
        List<Role> customRoles = roleRepository.findAllByInstituteId(instituteId);

        List<Role> allRoles = new java.util.ArrayList<>(systemRoles);
        allRoles.addAll(customRoles);

        return allRoles.stream().map(this::mapToDTO).collect(Collectors.toList());
    }

    private CustomRoleDTO mapToDTO(Role role) {
        List<PermissionDTO> permissionDTOs = role.getAuthorities().stream()
                .map(p -> new PermissionDTO(p.getId(), p.getName(), p.getTag()))
                .collect(Collectors.toList());
        return new CustomRoleDTO(role.getId(), role.getName(), role.getInstituteId(), permissionDTOs);
    }
}
