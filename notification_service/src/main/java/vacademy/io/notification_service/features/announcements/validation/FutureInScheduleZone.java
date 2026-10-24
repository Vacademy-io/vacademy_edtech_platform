package vacademy.io.notification_service.features.announcements.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.*;

/**
 * Checks that a schedule's startDate is in the future, reading it in the schedule's own
 * timezone. A plain @Future compares the wall-clock value against the UTC server clock.
 */
@Documented
@Constraint(validatedBy = FutureInScheduleZoneValidator.class)
@Target({ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface FutureInScheduleZone {
    String message() default "Start date must be in the future";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
