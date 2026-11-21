package vacademy.io.admin_core_service.features.engagement.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/** Admin-facing slot. Items here are UNREDACTED — this endpoint is teacher-only. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EngagementSlotDTO {
    private String id;
    private String planId;
    private String title;
    private String startDate;
    /** RELATIVE plans only; startDate/endDate are then virtual. */
    private Integer startDay;
    private Integer endDay;
    private String endDate;
    private String startTime;
    private String endTime;
    private Integer dowMask;
    private String revealTime;
    private String notifyTime;
    private Integer sortOrder;
    private String status;
    private List<EngagementItemDTO> items;
    /**
     * Active learners in the plan's batch, so a task row can read
     * "{completedCount} / {learnerCount} learners". Optional.
     */
    private Long learnerCount;
}
