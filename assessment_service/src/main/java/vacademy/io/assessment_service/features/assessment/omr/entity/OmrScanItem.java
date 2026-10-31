package vacademy.io.assessment_service.features.assessment.omr.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.UuidGenerator;

import java.util.Date;
import java.util.List;

/**
 * One uploaded file (a FILE row, page_no null) or one sheet = one page of it (a SHEET
 * row, page_no set). A file is first counted, then split into one PENDING sheet per
 * page and marked SPLIT; from then on only its sheets carry a status of their own.
 */
@Entity
@Table(name = "omr_scan_item")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OmrScanItem {

    // FILE rows
    public static final String PENDING = "PENDING";
    public static final String COUNTING = "COUNTING";
    public static final String SPLIT = "SPLIT";
    // SHEET rows
    public static final String READING = "READING";
    public static final String GRADED = "GRADED";
    public static final String NEEDS_REVIEW = "NEEDS_REVIEW";
    // both
    public static final String FAILED = "FAILED";
    public static final String SKIPPED = "SKIPPED";

    /** Still being worked on by the runner. */
    public static final List<String> ACTIVE = List.of(PENDING, COUNTING, READING);

    // reason codes
    public static final String R_NO_MARKERS = "NO_MARKERS";
    public static final String R_ROLL_BLANK = "ROLL_BLANK";
    public static final String R_ROLL_MULTI = "ROLL_MULTI";
    public static final String R_ROLL_LOW_CONFIDENCE = "ROLL_LOW_CONFIDENCE";
    public static final String R_ROLL_UNMATCHED = "ROLL_UNMATCHED";
    public static final String R_ROLL_AMBIGUOUS = "ROLL_AMBIGUOUS";
    public static final String R_SET_MISMATCH = "SET_MISMATCH";
    public static final String R_SET_BLANK = "SET_BLANK";
    public static final String R_DUPLICATE_IN_BATCH = "DUPLICATE_IN_BATCH";
    public static final String R_ALREADY_HAS_ATTEMPT = "ALREADY_HAS_ATTEMPT";
    public static final String R_READ_ERROR = "READ_ERROR";

    @Id
    @UuidGenerator
    @Column(name = "id")
    private String id;

    @Column(name = "batch_id", nullable = false)
    private String batchId;

    @Column(name = "parent_item_id")
    private String parentItemId;

    @Column(name = "file_id", nullable = false)
    private String fileId;

    @Column(name = "file_name")
    private String fileName;

    @Column(name = "page_no")
    private Integer pageNo;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "reason_code")
    private String reasonCode;

    @Column(name = "reason")
    private String reason;

    @Column(name = "sheet_image_file_id")
    private String sheetImageFileId;

    @Column(name = "marked_image_file_id")
    private String markedImageFileId;

    @Column(name = "name_crop_file_id")
    private String nameCropFileId;

    @Column(name = "read_roll")
    private String readRoll;

    @Column(name = "read_set")
    private String readSet;

    @Column(name = "answers_json")
    private String answersJson;

    @Column(name = "flags_json")
    private String flagsJson;

    @Column(name = "fixes_json")
    private String fixesJson;

    @Builder.Default
    @Column(name = "roll_low_confidence", nullable = false)
    private Boolean rollLowConfidence = false;

    @Column(name = "matched_user_id")
    private String matchedUserId;

    @Column(name = "matched_name")
    private String matchedName;

    @Column(name = "registration_id")
    private String registrationId;

    @Column(name = "attempt_id")
    private String attemptId;

    @Column(name = "resolved_by")
    private String resolvedBy;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Date createdAt;

    @Column(name = "updated_at", insertable = false)
    private Date updatedAt;

    @PreUpdate
    void touch() {
        updatedAt = new Date();
    }

    public boolean isSheet() {
        return pageNo != null;
    }
}
