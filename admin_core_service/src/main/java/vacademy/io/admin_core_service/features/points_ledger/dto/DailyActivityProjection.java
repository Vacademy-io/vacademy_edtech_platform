package vacademy.io.admin_core_service.features.points_ledger.dto;

import java.sql.Date;

/** One learner-day of activity: the unit ACTIVITY points are awarded on. */
public interface DailyActivityProjection {
    String getUserId();
    Date getActivityDate();
    Long getMillis();
}
