package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.Data;

import java.util.List;

/** Authoring payload for a slot plus the items inside it. */
@Data
public class EngagementSlotRequest {
    private String id;
    private String title;
    /** yyyy-MM-dd, institute-local. */
    private String startDate;
    private String endDate;
    /** HH:mm, institute-local wall clock. */
    private String startTime;
    private String endTime;
    /** Mon=1..Sun=64 bitmask; null/0 = every day in the range. */
    private Integer dowMask;
    /** RELATIVE plans: 1-based first/last day after the learner joins (endDay defaults to startDay). */
    private Integer startDay;
    private Integer endDay;
    private String revealTime;
    private String notifyTime;
    private Integer sortOrder;
    private List<EngagementItemRequest> items;
}
