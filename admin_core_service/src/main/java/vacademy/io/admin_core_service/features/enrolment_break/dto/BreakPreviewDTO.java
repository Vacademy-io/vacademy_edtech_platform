package vacademy.io.admin_core_service.features.enrolment_break.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.util.Date;
import java.util.List;

/** What a new break, or a resume, would do. Saves nothing. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BreakPreviewDTO {
    private String kind;
    private String courseLabel;
    private LocalDate startsOn;
    private LocalDate endsOn;
    private boolean startsToday;
    /** Days the break lasts (null when it has no last day). */
    private Integer days;
    private boolean stopClassReminders;
    private boolean stopFeeReminders;
    private boolean removeAccess;
    private boolean stopBilling;
    /** Membership dates now and after the resume (pause only; null when unknown). */
    private Date planEndNow;
    private Date planEndAfter;
    private Date nextChargeNow;
    private Date nextChargeAfter;
    private int unpaidInstalmentsMoved;
    /** Paused days counted so far (resume preview only). */
    private Integer pausedDays;
    /** Codes of problems that block saving; the UI words them (e.g. OVERLAP, END_BEFORE_START). */
    private List<String> blockers;
    /** Codes of things the admin should know that do not block (e.g. NO_MEMBERSHIP, AUTOPAY_ON). */
    private List<String> warnings;
}
