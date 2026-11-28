package vacademy.io.auth_service.feature.auth.service;

import lombok.RequiredArgsConstructor;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.repository.UserRoleRepository;
import vacademy.io.common.auth.service.UserRoleService;
import vacademy.io.common.exceptions.AccessRevokedException;

import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class UserDetailsCacheService {

    private final UserRepository userRepository;
    private final UserRoleRepository userRoleRepository;

    /**
     * Resolve CustomUserDetails for the given username (without institute) and instituteId.
     * Cached for 5 minutes via Caffeine per CacheConfiguration.
     */
    @Cacheable(value = "authUserDetails", key = "#usernameWithoutInstitute + '_' + #instituteId")
    @Transactional(readOnly = true)
    public CustomUserDetails getCustomUserDetails(String usernameWithoutInstitute, String instituteId) {
        Optional<User> user = userRepository.findByUsername(usernameWithoutInstitute);
        if (user.isEmpty()) {
            throw new UsernameNotFoundException("could not found user..!!");
        }

        List<UserRole> userRoles = userRoleRepository.findByUser(user.get());
        // Every other service resolves the caller through here on each request, so this is
        // where a disabled or removed team member is stopped — including sessions that are
        // still holding a token issued before access was taken away. Nothing is cached on
        // the throw, so re-enabling takes effect on the next request.
        if (UserRoleService.isStaffAccessRevoked(userRoles, instituteId)) {
            throw new AccessRevokedException("access to this institute has been disabled for this user");
        }
        CustomUserDetails customUserDetails = new CustomUserDetails(user.get(), instituteId, userRoles);
        // Do not expose user password in payload
        customUserDetails.setPassword(null);
        return customUserDetails;
    }
}


