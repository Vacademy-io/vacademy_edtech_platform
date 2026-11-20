package vacademy.io.auth_service.feature.selfsignup.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.auth_service.feature.auth.service.AuthService;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.entity.UserRole;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.product.ProductConfigDTO;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The login mail of a product "Buy <plan>" account, sent once its plan is paid (the sign-up itself
 * sends none). Called by admin-core, which makes sure it asks only once per institute.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductPaidWelcomeService {

    /** The institute's owner: its first admin, the account the sign-up created. */
    static final String OWNER = "SELECT ur.user_id FROM user_role ur JOIN roles r ON r.id = ur.role_id "
            + "JOIN users u ON u.id = ur.user_id WHERE ur.institute_id = ? AND r.role_name = 'ADMIN' "
            + "ORDER BY u.created_at ASC LIMIT 1";

    private final JdbcTemplate jdbcTemplate;
    private final UserRepository userRepository;
    private final AuthService authService;
    private final ProductConfigClient productConfigClient;

    @Transactional(readOnly = true)
    public void sendWelcome(String productKey, String instituteId) {
        if (!StringUtils.hasText(productKey) || !StringUtils.hasText(instituteId)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "product and instituteId are required");
        }
        ProductConfigDTO product = productConfigClient.get(productKey)
                .orElseThrow(() -> new VacademyException(HttpStatus.BAD_REQUEST, "Unknown product " + productKey));
        List<String> owner = jdbcTemplate.queryForList(OWNER, String.class, instituteId);
        if (owner.isEmpty()) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "No admin for institute " + instituteId);
        }
        User user = userRepository.findById(owner.get(0))
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND, "No admin for institute " + instituteId));
        Set<UserRole> roles = user.getRoles() == null ? Set.of() : user.getRoles().stream()
                .filter(r -> instituteId.equals(r.getInstituteId()))
                .collect(Collectors.toSet());
        authService.sendWelcomeMailToUser(user, instituteId, roles, product);
        log.info("[self-signup] paid_welcome_sent product={} institute={} user={}", productKey, instituteId, user.getId());
    }
}
