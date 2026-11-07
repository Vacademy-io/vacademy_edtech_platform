package vacademy.io.admin_core_service.features.live_session.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class SessionSearchRequest {

    // Required
    @NotNull(message = "Institute ID is required")
    private String instituteId;

    // Pagination
    @Min(0)
    private Integer page = 0;

    @Min(1)
    @Max(100)
    private Integer size = 20;

    // Sorting: meetingDate, startTime, title, createdAt
    private String sortBy = "meetingDate";

    // ASC or DESC
    private String sortDirection = "ASC";

    // Status & Session Filters
    // LIVE, DRAFT - if empty, show all except DELETED
    private List<String> statuses;

    // Specific session IDs - if empty, show all
    private List<String> sessionIds;

    // Date & Time Filters
    // If null: for upcoming -> next month, for past -> last month
    private LocalDate startDate;
    private LocalDate endDate;

    // Filter by start time of day (e.g., morning sessions)
    private LocalTime startTimeOfDay;
    private LocalTime endTimeOfDay;

    // Recurrence & Access
    // ONE_TIME, DAILY, WEEKLY, MONTHLY, etc.
    private List<String> recurrenceTypes;

    // PUBLIC, PRIVATE
    private List<String> accessLevels;

    // Participant Filters
    // Sessions assigned to these batches
    private List<String> batchIds;

    // Sessions assigned to these users
    private List<String> userIds;

    // Search Filters
    // Search across title and subject
    private String searchQuery;

    // Timezone filter
    private List<String> timezones;

    // Schedule Filters
    private List<String> scheduleIds;

    // Streaming service type
    private List<String> streamingServiceTypes;

    // Booking & Source Filters
    private List<String> bookingTypeIds;
    private String source;
    private String sourceId;

    // Time Status Filter: UPCOMING, LIVE, PAST
    private String timeStatus;

    // Server-side only, never read from JSON, so the public /search contract is unchanged.
    // Classes these users teach: an ACTIVE instructor, or the creator when there is none.
    @JsonIgnore
    private List<String> instructorUserIds;

    // Server-side only. True means "meeting_date is today in the session's own timezone" and
    // takes the place of every date default and of startDate/endDate.
    @JsonIgnore
    private Boolean todayInSessionTimezone;
}
