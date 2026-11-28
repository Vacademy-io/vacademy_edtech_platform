package vacademy.io.auth_service.feature.user.repository;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;
import vacademy.io.common.auth.entity.User;

import java.util.List;

/**
 * Username lookups that live in auth-service rather than the shared UserRepository, so a new
 * query here ships with auth-service itself instead of waiting for the common library to publish.
 */
@org.springframework.stereotype.Repository
public interface UsernameLookupRepository extends Repository<User, String> {

    /** The given usernames that already belong to an account (exact match, as uk_users_username). */
    @Query("SELECT u.username FROM User u WHERE u.username IN :usernames")
    List<String> findExistingUsernames(@Param("usernames") List<String> usernames);
}
