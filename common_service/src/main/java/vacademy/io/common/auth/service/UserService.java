package vacademy.io.common.auth.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.common.auth.dto.*;
import vacademy.io.common.auth.entity.Role;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.enums.UserRoleStatus;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.RoleRepository;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.core.i18n.LocaleRegistry;
import vacademy.io.common.exceptions.*;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

@Service
@Slf4j
public class UserService {

    @Autowired
    UserRepository userRepository;

    @Autowired
    RoleRepository roleRepository;

    @Autowired
    UserRoleRepository userRoleRepository;

    @Value("${spring.application.name:unknown}")
    private String applicationName;

    public List<User> getUsersFromUserIds(List<String> userIds) {
        List<User> users = new ArrayList<>();

        userRepository.findAllById(userIds).forEach(u -> {
            if (u != null)
                users.add(u);
        });

        return users;
    }

    public User createUser(User user) {
        String username = user.getUsername().toLowerCase();
        user.setUsername(username);
        return userRepository.save(user);
    }

    @Transactional
    public void deleteUser(User user) {
        userRepository.delete(user);
    }

    public User updateUser(User user) {
        if (!StringUtils.hasText(user.getId()))
            throw new EmployeeNotFoundException("user id is null");

        return userRepository.save(user);
    }

    public void addRoleToUser(UserRoleRequestDTO userRoleRequestDTO) {

        String userId = userRoleRequestDTO.getUserId();
        String roleId = userRoleRequestDTO.getRoleId();

        if (userId == null || roleId == null) {
            throw new InvalidRequestException("userId and roleId are required.");
        }

        if (!ifRoleExist(roleId)) {
            throw new RoleNotFoundException("Role with Id " + roleId + " not found");
        } else if (!ifUserExist(userId)) {
            throw new UserNotFoundException("User with Id" + userId + "not found");
        }
        userRepository.addRoleToUser(userId, roleId);
    }

    public void addPermissionToUser(UserPermissionRequestDTO userPermissionRequestDTO) {

        String userId = userPermissionRequestDTO.getUserId();
        String permissionId = userPermissionRequestDTO.getPermissionId();

        if (userId == null || permissionId == null) {
            throw new InvalidRequestException("userId and permissionId are required");
        }

        if (!ifUserExist(userId)) {
            throw new UserNotFoundException("User with Id " + userId + " not found");
        } else if (!ifPermissionExist(permissionId)) {
            throw new UserWithPermissionNotFoundException("Permission with Id " + permissionId + "not found");

        }
        userRepository.addPermissionToUser(userId, permissionId);
    }

    public UserDTO getUserDetailsById(String userId) {

        List<User> results = userRepository.findUserDetailsById(userId);

        if (results.isEmpty()) {
            throw new UserNotFoundException("User with Id " + userId + " not found");
        }

        User user = results.get(0);
        return new UserDTO(user);
    }

    public List<UserDTO> getUserDetailsByIds(List<String> userIds) {

        List<User> users = userRepository.findUserDetailsByIds(userIds);

        return users.stream()
                .map(UserDTO::new)
                .collect(Collectors.toList());
    }

    /**
     * userId -> roles held AT THIS INSTITUTE (ACTIVE only, upper-cased).
     *
     * Callers making an authorisation decision must use this, never UserDTO.roles,
     * which is cross-institute and includes INVITED memberships.
     */
    public Map<String, List<String>> getInstituteRoles(String instituteId, List<String> userIds) {
        if (instituteId == null || instituteId.isBlank() || userIds == null || userIds.isEmpty()) {
            return Map.of();
        }
        Map<String, List<String>> out = new HashMap<>();
        for (Object[] row : userRepository.findInstituteRoleRows(instituteId, userIds)) {
            String userId = String.valueOf(row[0]);
            String role = row[1] == null ? null : String.valueOf(row[1]);
            if (role == null) continue;
            out.computeIfAbsent(userId, k -> new ArrayList<>()).add(role);
        }
        return out;
    }

    /**
     * Every ACTIVE holder of the given roles at an institute, for recipient
     * expansion in scheduled reporting.
     *
     * Role names are upper-cased before the lookup because production holds both
     * 'ADMIN' and 'Admin'; matching exactly drops the second group silently.
     */
    public List<UserDTO> getUsersByInstituteAndRoles(String instituteId, List<String> roles) {
        if (instituteId == null || instituteId.isBlank() || roles == null || roles.isEmpty()) {
            return List.of();
        }
        List<String> upper = roles.stream()
                .filter(r -> r != null && !r.isBlank())
                .map(r -> r.trim().toUpperCase())
                .distinct()
                .collect(Collectors.toList());
        if (upper.isEmpty()) return List.of();

        return userRepository
                .findByInstituteAndRoleNames(instituteId, upper, List.of(UserRoleStatus.ACTIVE.name()))
                .stream()
                .map(UserDTO::new)
                .collect(Collectors.toList());
    }

    public User getUserDetailsByUsername(String username) {

        List<User> results = userRepository.findUserDetailsByUsername(username);

        if (results.isEmpty()) {
            return null;
        }

        User user = results.get(0);
        return user;
    }

    public User getUserDetailsByEmail(String email) {

        List<User> results = userRepository.findUserDetailsByEmail(email);

        if (results.isEmpty()) {
            return null;
        }

        User user = results.get(0);
        return user;
    }

    public void removeRoleFromUser(UserRoleRequestDTO userRoleRequestDTO) {

        String userId = userRoleRequestDTO.getUserId();
        String roleId = userRoleRequestDTO.getRoleId();

        if (userId == null || roleId == null) {
            throw new InvalidRequestException("userId and RoleId are Required");
        }
        if (!ifRoleAndUserExist(userId, roleId)) {
            throw new UserWithRoleNotFoundException("User with Id " + userId + " and role Id " + roleId + " not found");
        }
        userRepository.removeRoleFromUser(userId, roleId);
    }

    public void removePermissionFromUser(UserPermissionRequestDTO userPermissionRequestDTO) {

        String userId = userPermissionRequestDTO.getUserId();
        String permissionId = userPermissionRequestDTO.getPermissionId();
        if (userId == null || permissionId == null) {
            throw new InvalidRequestException("userId and permissionId are Required");
        }

        if (!ifPermissionAndUserExist(userId, permissionId)) {
            throw new UserWithPermissionNotFoundException(
                    "User with Id " + userId + " and Permission Id " + permissionId + " not found");
        }
        userRepository.removePermissionFromUser(userId, permissionId);
    }

    private boolean ifPermissionAndUserExist(String userId, String permissionId) {

        return userRepository.existsByUserIdAndPermissionId(userId, permissionId);
    }

    private boolean ifRoleAndUserExist(String userId, String roleId) {

        return userRepository.existsByUserIdAndRoleId(userId, roleId);
    }

    public boolean ifUserExistByUserName(String userName) {
        return userRepository.existsByUserName(userName);
    }

    public boolean ifRoleExist(String roleId) {

        return userRepository.existsByRoleId(roleId);
    }

    public boolean ifUserExist(String userId) {

        return userRepository.existsByUserId(userId);
    }

    public boolean ifPermissionExist(String permissionId) {
        return userRepository.existsByPermissionId(permissionId);
    }

    public User createUserFromUserDto(UserDTO userDTO) {
        String normalizedEmail = userDTO.getEmail() != null ? userDTO.getEmail().toLowerCase() : null;
        Optional<User> optionalUser = userRepository.findFirstByEmailOrderByCreatedAtDesc(normalizedEmail);
        if (optionalUser.isPresent()) {
            User user = optionalUser.get();
            userDTO.setFullName(user.getFullName());
            userDTO.setUsername(user.getUsername());
            userDTO.setPassword(user.getPassword());
            userDTO.setEmail(user.getEmail());
            return user;
        } else {
            return createNewUserFromUserDto(userDTO);
        }
    }

    /**
     * The newest account registered with this email (lower-cased, as accounts are stored),
     * or empty for a blank email — a blank email must never "match" whichever account
     * happens to have none.
     */
    public Optional<User> findExistingUserByEmail(String email) {
        if (!StringUtils.hasText(email)) {
            return Optional.empty();
        }
        return userRepository.findFirstByEmailOrderByCreatedAtDesc(email.trim().toLowerCase());
    }

    /** Always a NEW account from the DTO (no lookup by email); sets the DTO's id. */
    public User createNewUserFromUserDto(UserDTO userDTO) {
        String normalizedEmail = userDTO.getEmail() != null ? userDTO.getEmail().toLowerCase() : null;
        User user = new User();
        user.setUsername(userDTO.getUsername());
        user.setPassword(userDTO.getPassword());
        user.setEmail(normalizedEmail);
        user.setFullName(userDTO.getFullName());
        user.setAddressLine(userDTO.getAddressLine());
        user.setCity(userDTO.getCity());
        user.setPinCode(userDTO.getPinCode());
        user.setMobileNumber(userDTO.getMobileNumber());
        user.setDateOfBirth(userDTO.getDateOfBirth());
        user.setGender(userDTO.getGender());
        user.setRootUser(true);
        user.setAuthorSubtitle(userDTO.getAuthorSubtitle());
        user.setAuthorDescription(userDTO.getAuthorDescription());
        User savedUser = userRepository.save(user);
        userDTO.setId(savedUser.getId());
        return user;
    }

    public List<UserRole> addUserRoles(String instituteId, List<String> roles, User user, String status) {

        List<Role> rolesEntity = roleRepository.findByNameIn(roles);

        List<UserRole> userRoles = new ArrayList<>();

        if (user.getRoles() != null && !user.getRoles().isEmpty()) {
            userRoles = new ArrayList<>(user.getRoles());
        }

        for (Role role : rolesEntity) {
            UserRole userRole = new UserRole();
            userRole.setRole(role);
            userRole.setInstituteId(instituteId);
            userRole.setUser(user);
            userRole.setStatus(status);
            userRoles.add(userRole);
        }

        user.setRoles(new HashSet<>(userRoles));
        userRepository.save(user);
        return userRoles;
    }

    public List<UserWithRolesDTO> getUserDetailsByInstituteId(String instituteId, CustomUserDetails user) {
        return userRepository.findUsersWithRolesByInstituteId(instituteId).stream().map(UserWithRolesDTO::new)
                .collect(Collectors.toList());
    }

    public List<UserWithRolesDTO> getUserDetailsByInstituteId(String instituteId, List<String> roles,
            CustomUserDetails user) {
        return userRepository
                .findUsersWithRolesByInstituteIdAndStatuses(instituteId, roles,
                        List.of(UserRoleStatus.ACTIVE.name(), UserRoleStatus.DISABLED.name()))
                .stream().map(UserWithRolesDTO::new).collect(Collectors.toList());
    }

    public UserCredentials getUserCredentials(String userId, CustomUserDetails user) {
        User userEntity = userRepository.findById(userId)
                .orElseThrow(() -> new UserNotFoundException("User with Id " + userId + " not found"));
        UserCredentials userCredentials = new UserCredentials();
        userCredentials.setUsername(userEntity.getUsername());
        userCredentials.setPassword(userEntity.getPassword());
        return userCredentials;
    }

    public List<UserCredentials> getUsersCredentials(List<String> userIds) {
        Iterable<User> userEntities = userRepository.findAllById(userIds);
        return StreamSupport.stream(userEntities.spliterator(), false)
                .map(user -> new UserCredentials(user.getUsername(), user.getPassword(), user.getId(),
                        user.getProfilePicFileId()))
                .collect(Collectors.toList());
    }

    public List<UserWithRolesDTO> getUsersByInstituteIdAndStatus(String instituteId, List<String> statuses,
            List<String> roles, CustomUserDetails userDetails) {
        return userRepository.findUsersByStatusAndInstitute(statuses, roles, instituteId)
                .stream()
                .map(UserWithRolesDTO::new).collect(Collectors.toList());
    }

    public User getUserById(String userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new UserNotFoundException("User with Id " + userId + " not found"));
    }

    public List<UserWithRolesDTO> getUsersByInstituteIdAndStatus(String instituteId, List<String> statuses,
            List<String> roles) {
        return userRepository.findUsersByStatusAndInstitute(statuses, roles, instituteId)
                .stream()
                .map(UserWithRolesDTO::new).collect(Collectors.toList());
    }

    /**
     * Maps a User to {@link UserWithRolesDTO} and additionally copies the (plaintext) password.
     * Deliberately NOT folded into the shared {@code UserWithRolesDTO(User)} constructor: that
     * constructor also feeds the UNAUTHENTICATED {@code /auth-service/public/v1/users-of-status}
     * endpoint, so copying the password there would leak every user's credential with no auth.
     * Only the authenticated, paged Teams listing uses this helper, so admins can surface the
     * credential in the Teams "Password" column.
     */
    private UserWithRolesDTO toUserWithRolesDtoWithPassword(User user) {
        UserWithRolesDTO dto = new UserWithRolesDTO(user);
        dto.setPassword(user.getPassword());
        // Lets the Teams page tag members who have never signed in ("Not signed in yet").
        dto.setLastLoginTime(user.getLastLoginTime());
        return dto;
    }

    public PagedUserWithRolesResponse getUsersByInstituteIdAndStatusPaged(String instituteId, List<String> statuses,
            List<String> roles, String searchName, int pageNumber, int pageSize, CustomUserDetails userDetails) {
        org.springframework.data.domain.Pageable pageable = org.springframework.data.domain.PageRequest.of(pageNumber,
                pageSize);

        String name = null;
        String email = null;
        String mobile = null;

        if (searchName != null && !searchName.trim().isEmpty()) {
            if (searchName.contains("@")) {
                email = searchName;
            } else if (searchName.matches("^[0-9+\\-\\s]+$")) {
                mobile = searchName;
            } else {
                name = searchName;
            }
        }

        boolean applyStatusFilter = statuses != null && !statuses.isEmpty();
        boolean applyRoleFilter = roles != null && !roles.isEmpty();
        List<String> statusesParam = applyStatusFilter ? statuses : java.util.List.of("__none__");
        List<String> rolesParam = !applyRoleFilter ? java.util.List.of("__none__")
                : roles.stream().map(String::toLowerCase).collect(Collectors.toList());

        List<User> users = userRepository.findUsersByStatusAndInstitutePaged(applyStatusFilter, statusesParam,
                applyRoleFilter, rolesParam, instituteId, name, email, mobile, pageable);
        long totalElements = userRepository.countUsersByStatusAndInstitute(applyStatusFilter, statusesParam,
                applyRoleFilter, rolesParam, instituteId, name, email, mobile);

        List<UserWithRolesDTO> content = users.stream()
                .map(this::toUserWithRolesDtoWithPassword)
                .collect(Collectors.toList());

        int totalPages = (int) Math.ceil((double) totalElements / pageSize);

        return PagedUserWithRolesResponse.builder()
                .content(content)
                .pageNumber(pageNumber)
                .pageSize(pageSize)
                .totalElements(totalElements)
                .totalPages(totalPages)
                .first(pageNumber == 0)
                .last(pageNumber >= totalPages - 1)
                .build();
    }

    /**
     * Same as {@link #getUsersByInstituteIdAndStatusPaged} but additionally restricts results
     * to users whose id is in {@code userIds}. Used by the sub-org team listing flow where the
     * caller pre-resolves the eligible user IDs from FSPSSM.
     * <p>
     * If {@code userIds} is null or empty, returns an empty page (no users in scope).
     */
    public PagedUserWithRolesResponse getUsersByInstituteIdAndStatusPagedAndUserIds(String instituteId,
            List<String> statuses, List<String> roles, List<String> userIds, String searchName,
            int pageNumber, int pageSize, CustomUserDetails userDetails) {
        if (userIds == null || userIds.isEmpty()) {
            return PagedUserWithRolesResponse.builder()
                    .content(java.util.Collections.emptyList())
                    .pageNumber(pageNumber)
                    .pageSize(pageSize)
                    .totalElements(0L)
                    .totalPages(0)
                    .first(true)
                    .last(true)
                    .build();
        }

        org.springframework.data.domain.Pageable pageable = org.springframework.data.domain.PageRequest.of(pageNumber,
                pageSize);

        String name = null;
        String email = null;
        String mobile = null;

        if (searchName != null && !searchName.trim().isEmpty()) {
            if (searchName.contains("@")) {
                email = searchName;
            } else if (searchName.matches("^[0-9+\\-\\s]+$")) {
                mobile = searchName;
            } else {
                name = searchName;
            }
        }

        boolean applyStatusFilter = statuses != null && !statuses.isEmpty();
        boolean applyRoleFilter = roles != null && !roles.isEmpty();
        List<String> statusesParam = applyStatusFilter ? statuses : java.util.List.of("__none__");
        List<String> rolesParam = !applyRoleFilter ? java.util.List.of("__none__")
                : roles.stream().map(String::toLowerCase).collect(Collectors.toList());

        List<User> users = userRepository.findUsersByStatusAndInstituteAndUserIdsPaged(applyStatusFilter, statusesParam,
                applyRoleFilter, rolesParam, instituteId, userIds, name, email, mobile, pageable);
        long totalElements = userRepository.countUsersByStatusAndInstituteAndUserIds(applyStatusFilter, statusesParam,
                applyRoleFilter, rolesParam, instituteId, userIds, name, email, mobile);

        List<UserWithRolesDTO> content = users.stream()
                .map(this::toUserWithRolesDtoWithPassword)
                .collect(Collectors.toList());

        int totalPages = (int) Math.ceil((double) totalElements / pageSize);

        return PagedUserWithRolesResponse.builder()
                .content(content)
                .pageNumber(pageNumber)
                .pageSize(pageSize)
                .totalElements(totalElements)
                .totalPages(totalPages)
                .first(pageNumber == 0)
                .last(pageNumber >= totalPages - 1)
                .build();
    }

    public User updateUser(User user, UserDTO userDTO) {
        if (StringUtils.hasText(userDTO.getUsername()))
            user.setUsername(userDTO.getUsername());
        if (StringUtils.hasText(userDTO.getEmail()))
            user.setEmail(userDTO.getEmail().toLowerCase());
        if (StringUtils.hasText(userDTO.getFullName()))
            user.setFullName(userDTO.getFullName());
        if (StringUtils.hasText(userDTO.getAddressLine()))
            user.setAddressLine(userDTO.getAddressLine());
        if (StringUtils.hasText(userDTO.getCity()))
            user.setCity(userDTO.getCity());
        if (StringUtils.hasText(userDTO.getPinCode()))
            user.setPinCode(userDTO.getPinCode());
        if (StringUtils.hasText(userDTO.getMobileNumber()))
            user.setMobileNumber(userDTO.getMobileNumber());
        if (userDTO.getDateOfBirth() != null)
            user.setDateOfBirth(userDTO.getDateOfBirth());
        if (StringUtils.hasText(userDTO.getGender()))
            user.setGender(userDTO.getGender());
        if (StringUtils.hasText(userDTO.getProfilePicFileId()))
            user.setProfilePicFileId(userDTO.getProfilePicFileId());
        // Normalize to a supported tag ("hi-IN" → "hi", garbage → "en") before persisting
        if (StringUtils.hasText(userDTO.getPreferredLocale()))
            user.setPreferredLocale(LocaleRegistry.normalize(userDTO.getPreferredLocale()));

        // Only set password if it's provided
        if (StringUtils.hasText(userDTO.getPassword()))
            user.setPassword(userDTO.getPassword());

        if (userDTO.getAuthorSubtitle() != null)
            user.setAuthorSubtitle(userDTO.getAuthorSubtitle());
        if (userDTO.getAuthorDescription() != null)
            user.setAuthorDescription(userDTO.getAuthorDescription());
        // isRootUser is primitive boolean, so check if change is desired
        user.setRootUser(userDTO.isRootUser());
        return userRepository.save(user);
    }

    public Optional<User> getOptionalUserById(String userId) {
        return userRepository.findById(userId);
    }

    @Transactional
    public String updateUserDetails(CustomUserDetails customUserDetails, UserTopLevelDto request, String userId,
            String instituteId) {
        try {
            Optional<User> userOptional = userRepository.findById(userId);
            if (userOptional.isEmpty())
                throw new VacademyException("User Not Found");

            updateIfNotNull(request.getEmail(), userOptional.get()::setEmail);
            updateIfNotNull(request.getMobileNumber(), userOptional.get()::setMobileNumber);
            userOptional.get().setProfilePicFileId(request.getProfilePicFileId());
            updateIfNotNull(request.getAuthorSubtitle(), userOptional.get()::setAuthorSubtitle);
            updateIfNotNull(request.getAuthorDescription(), userOptional.get()::setAuthorDescription);
            updateIfNotNull(request.getPinCode(), userOptional.get()::setPinCode);
            updateIfNotNull(request.getCity(), userOptional.get()::setCity);
            updateIfNotNull(request.getGender(), userOptional.get()::setGender);
            updateIfNotNull(request.getFullName(), userOptional.get()::setFullName);
            updateIfNotNull(request.getDateOfBirth(), userOptional.get()::setDateOfBirth);
            updateIfNotNull(request.getAddressLine(), userOptional.get()::setAddressLine);
            // Normalize to a supported tag ("hi-IN" → "hi", garbage → "en") before persisting
            if (StringUtils.hasText(request.getPreferredLocale()))
                userOptional.get().setPreferredLocale(LocaleRegistry.normalize(request.getPreferredLocale()));

            User savedUser = userRepository.save(userOptional.get());

            updateRolesOfUser(savedUser, request, instituteId);

            return "Done";
        } catch (Exception e) {
            throw new VacademyException("Failed To Update: " + e.getMessage());
        }
    }

    private void updateRolesOfUser(User savedUser, UserTopLevelDto request, String instituteId) {
        List<UserRole> allDeleteRequestUserRoles = StreamSupport
                .stream(userRoleRepository.findAllById(request.getDeleteUserRoleRequest()).spliterator(), false)
                .toList();

        allDeleteRequestUserRoles.forEach(userRole -> {
            userRole.setStatus(UserRoleStatus.DELETED.name());
        });
        userRoleRepository.saveAll(allDeleteRequestUserRoles);

        createOrUpdateUserRole(savedUser, request.getAddUserRoleRequest(), instituteId);
    }

    public void createOrUpdateUserRole(User savedUser, List<String> addUserRoleRequest, String instituteId) {
        List<String> newRoleNames = new ArrayList<>();
        List<UserRole> updateStatusRoles = new ArrayList<>();

        addUserRoleRequest.forEach(roleName -> {
            Optional<UserRole> userRole = userRoleRepository.findFirstByUserIdAndInstituteIdAndRoleNamesAndStatuses(
                    savedUser.getId(), instituteId, List.of(roleName), List.of(UserRoleStatus.ACTIVE.name()));
            if (userRole.isPresent()) {
                userRole.get().setStatus(UserRoleStatus.ACTIVE.name());
                updateStatusRoles.add(userRole.get());
            } else
                newRoleNames.add(roleName);
        });

        userRoleRepository.saveAll(updateStatusRoles);
        createNewRolesForRoleName(savedUser, newRoleNames, instituteId);
    }

    private void createNewRolesForRoleName(User savedUser, List<String> newRoleNames, String instituteId) {
        List<UserRole> roles = new ArrayList<>();

        newRoleNames.forEach(name -> {
            Optional<Role> role = roleRepository.findByName(name);
            if (role.isPresent()) {
                UserRole newRole = new UserRole();
                newRole.setRole(role.get());
                newRole.setStatus(UserRoleStatus.ACTIVE.name());
                newRole.setInstituteId(instituteId);
                newRole.setUser(savedUser);

                roles.add(newRole);
            }
        });

        userRoleRepository.saveAll(roles);
    }

    private <T> void updateIfNotNull(T value, java.util.function.Consumer<T> setterMethod) {
        if (value != null) {
            setterMethod.accept(value);
        }
    }

    public UserTopLevelDto getUserTopLevelDetails(CustomUserDetails customUserDetails, String userId,
            String instituteId) {
        Optional<User> userOptional = userRepository.findById(userId);

        if (userOptional.isEmpty()) {
            throw new VacademyException("User Not Found");
        }

        // Get the full DTO
        UserTopLevelDto userTopLevelDto = userOptional.get().getUserTopLevelDto();

        // Filter roles based on matching instituteId
        List<UserRoleDTO> filteredRoles = userTopLevelDto.getRoles()
                .stream()
                .filter(role -> instituteId.equals(role.getInstituteId()))
                .filter(role -> !role.getStatus().equals(UserRoleStatus.DELETED.name()))
                .toList(); // or .collect(Collectors.toList()) in Java 8

        // Set the filtered roles back
        userTopLevelDto.setRoles(filteredRoles);

        return userTopLevelDto;
    }

    public UserJwtUpdateDetail getUserJwtUpdateDetail(CustomUserDetails userDetails, String userId) {
        UserJwtUpdateDetail userJwtUpdateDetail = new UserJwtUpdateDetail();
        Optional<User> user = userRepository.findById(userId);
        if (user.isPresent()) {
            userJwtUpdateDetail.setUpdatedAt(user.get().getLastTokenUpdateTime());
        }
        return userJwtUpdateDetail;
    }

    public void updateLastTokenUpdatedTime(List<String> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return;
        }
        userRepository.updateLastTokenUpdateTime(userIds);
    }

    public UserDTO updateUserDetails(UserDTO userDTO, String userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new VacademyException("User Not Found with id " + userId));
        user = updateUser(user, userDTO);
        return new UserDTO(user);
    }

    public List<UserDTO> findUsersOfRolesOfInstitute(List<String> roles, String instituteId, int inactiveDays) {
        LocalDate localTargetDate = LocalDate.now().minusDays(inactiveDays);
        Date targetDate = Date.from(localTargetDate.atStartOfDay(ZoneId.systemDefault()).toInstant());
        List<User> users = userRepository.findUsersInactiveOnDate(
                instituteId,
                roles,
                List.of(UserRoleStatus.ACTIVE.name()),
                targetDate);
        return users.stream().map(UserDTO::new).toList();
    }

    public List<UserDTO> findUsersInactiveForDaysOrMore(List<String> roles, String instituteId, int inactiveDays) {
        LocalDate localTargetDate = LocalDate.now().minusDays(inactiveDays);
        Date targetDate = Date.from(localTargetDate.atStartOfDay(ZoneId.systemDefault()).toInstant());
        List<User> users = userRepository.findUsersInactiveForDaysOrMore(
                instituteId,
                roles,
                List.of(UserRoleStatus.ACTIVE.name()),
                targetDate);
        return users.stream().map(UserDTO::new).toList();
    }

    public void updateLastLoginTimeForUser(String userId) {
        if (!"auth_service".equals(applicationName)) {
            return;
        }
        try {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new VacademyException("User Not Found with id " + userId));
            user.setLastLoginTime(new Date());
            userRepository.save(user);
        } catch (Exception e) {
        }
    }

    public List<UserDTO> autoSuggestUsers(String instituteId, List<String> roleNames, String query) {
        List<User> users;
        if (roleNames == null || roleNames.isEmpty()) {
            users = userRepository.autoSuggestUsersAllRoles(instituteId, query);
        } else {
            users = userRepository.autoSuggestUsers(instituteId, roleNames, query);
        }
        return users.stream().map(UserDTO::new).collect(Collectors.toList());
    }

    /**
     * Get users with their linked children.
     * For each parent user ID provided, fetches the parent and their linked child
     * (if any).
     * 
     * @param parentUserIds List of parent user IDs to fetch
     * @return List of ParentWithChildDTO containing parent and child user
     *         information
     */
    public List<ParentWithChildDTO> getUsersWithChildren(List<String> parentUserIds) {
        if (parentUserIds == null || parentUserIds.isEmpty()) {
            return Collections.emptyList();
        }

        // Fetch all parent users
        List<User> parents = userRepository.findByIdIn(parentUserIds);
        Map<String, User> parentMap = parents.stream()
                .collect(Collectors.toMap(User::getId, user -> user, (a, b) -> a));

        // Fetch all children linked to these parents
        List<User> children = userRepository.findByLinkedParentIdIn(parentUserIds);

        // Group children by parent ID
        Map<String, List<User>> childrenByParentId = children.stream()
                .filter(child -> child.getLinkedParentId() != null)
                .collect(Collectors.groupingBy(User::getLinkedParentId));

        // Build ParentWithChildDTO for each requested parent ID
        List<ParentWithChildDTO> result = new ArrayList<>();
        for (String parentId : parentUserIds) {
            User parent = parentMap.get(parentId);
            if (parent != null) {
                List<User> linkedChildren = childrenByParentId.get(parentId);

                if (linkedChildren != null && !linkedChildren.isEmpty()) {
                    // Add an entry for each child
                    for (User child : linkedChildren) {
                        ParentWithChildDTO dto = ParentWithChildDTO.builder()
                                .parent(new UserDTO(parent))
                                .child(new UserDTO(child))
                                .build();
                        result.add(dto);
                    }
                } else {
                    // Parent found but no children linked
                    ParentWithChildDTO dto = ParentWithChildDTO.builder()
                            .parent(new UserDTO(parent))
                            .child(null)
                            .build();
                    result.add(dto);
                }
            }
        }

        log.info("Fetched {} parent-child entries for {} requested IDs", result.size(), parentUserIds.size());
        return result;
    }

}
