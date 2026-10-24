package vacademy.io.admin_core_service.features.doubts.dtos;

import com.fasterxml.jackson.databind.PropertyNamingStrategy;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/** Timeline entry for the admin/teacher "Activity" view of a doubt. Never returned to learners. */
@JsonNaming(PropertyNamingStrategy.SnakeCaseStrategy.class)
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class DoubtActivityDto {
    private String id;
    private String doubtId;
    private String action;
    private String actorType;
    private String actorUserId;
    private String targetUserId;
    private String fromValue;
    private String toValue;
    private String ruleSource;
    private String remark;
    private Date createdAt;
}
