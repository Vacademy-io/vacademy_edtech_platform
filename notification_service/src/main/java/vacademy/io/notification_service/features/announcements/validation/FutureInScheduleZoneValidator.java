package vacademy.io.notification_service.features.announcements.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import vacademy.io.notification_service.features.announcements.dto.CreateAnnouncementRequest;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.ZoneId;

/**
 * Validator for {@link FutureInScheduleZone}. Violations are attached to the startDate /
 * timezone fields so the API keeps returning them as field errors (e.g. scheduling.startDate).
 */
public class FutureInScheduleZoneValidator
        implements ConstraintValidator<FutureInScheduleZone, CreateAnnouncementRequest.SchedulingRequest> {

    @Override
    public boolean isValid(CreateAnnouncementRequest.SchedulingRequest scheduling, ConstraintValidatorContext context) {
        if (scheduling == null || scheduling.getStartDate() == null) {
            return true;
        }

        ZoneId zone;
        try {
            zone = ZoneId.of(scheduling.getTimezone() != null ? scheduling.getTimezone() : "UTC");
        } catch (DateTimeException e) {
            addViolation(context, "timezone", "Invalid timezone");
            return false;
        }

        if (!scheduling.getStartDate().atZone(zone).toInstant().isAfter(Instant.now())) {
            addViolation(context, "startDate", context.getDefaultConstraintMessageTemplate());
            return false;
        }
        return true;
    }

    private void addViolation(ConstraintValidatorContext context, String field, String message) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message)
                .addPropertyNode(field)
                .addConstraintViolation();
    }
}
