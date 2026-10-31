package vacademy.io.assessment_service.features.learner_assessment.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.*;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.MarksRankDto;

import java.util.Date;
import java.util.List;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@Builder
public class StudentComparisonDto {
    // Attempt metadata
    private Date startTime;
    private Date submitTime;
    // Scores & comparison
    private Integer studentRank;
    private Double studentPercentile;
    private Double studentMarks;
    private Double totalMarks;
    private Long totalParticipants;
    private Double averageMarks;
    private Double highestMarks;
    private Double lowestMarks;
    private Double averageDuration;
    private Long studentDuration;
    private Double studentAccuracy;
    private Double classAccuracy;
    private List<MarksRankDto> marksDistribution;
    private List<SectionComparisonDto> sectionWiseComparison;
    private SmartLeaderboardDto leaderboard;
    /** Report option: the institute hides per-question items (answer review) for this assessment. */
    private Boolean questionWiseHidden;
}
