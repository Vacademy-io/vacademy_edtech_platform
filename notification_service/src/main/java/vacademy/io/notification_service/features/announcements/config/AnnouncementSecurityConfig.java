package vacademy.io.notification_service.features.announcements.config;

import org.springframework.context.annotation.Configuration;

/**
 * Documentation of how the announcement APIs are secured. The rules live in WebSecurityConfig
 * and the controllers.
 *
 * <ul>
 *   <li>{@code /notification-service/v1/announcements/**} (dashboard): needs a JWT. Each endpoint
 *       then requires staff (or ADMIN for approve/reject) of the target institute, see
 *       AnnouncementAccessGuard. On create, the creator id and role come from the token.</li>
 *   <li>{@code /notification-service/v1/announcements/admin/**} (service-to-service): needs the
 *       calling service's clientName + Signature headers, see InternalClientGuard. Services call
 *       it through InternalClientUtils (Java) or internal_auth_headers (ai_service).</li>
 *   <li>{@code /notification-service/v1/user-messages/**} (learner and staff apps): needs a JWT;
 *       the user id is taken from the token and any other id in the path or body is refused,
 *       see UserMessageAccessGuard.</li>
 * </ul>
 */
@Configuration
public class AnnouncementSecurityConfig {

    // This class serves as documentation only
    // Actual security configuration is in WebSecurityConfig.java

}
