package vacademy.io.assessment_service.features.rich_text.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.*;
import org.hibernate.annotations.UuidGenerator;
import vacademy.io.assessment_service.features.rich_text.dto.AssessmentRichTextDataDTO;

@Entity
@Table(name = "assessment_rich_text_data")
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class AssessmentRichTextData {

    @Id
    @Column(name = "id", nullable = false)
    @UuidGenerator
    private String id;

    @Column(name = "type", nullable = false)
    private String type;

    @Column(name = "content", nullable = false)
    private String content;

    // Static method to create entity from DTO
    //
    // A NEW row with no content is stored empty: `content` is NOT NULL, and one
    // blank field (a question text, an explanation, an option) used to fail the
    // whole paper with a 511. An existing row (id set) is left as it was, so an
    // edit that omits content can't blank text that's already saved.
    public static AssessmentRichTextData fromDTO(AssessmentRichTextDataDTO dto) {
        if (dto == null) return null;
        if (dto.getId() == null) {
            return new AssessmentRichTextData(
                    null,
                    dto.getType() != null ? dto.getType() : "HTML",
                    dto.getContent() != null ? dto.getContent() : "");
        }
        return new AssessmentRichTextData(dto.getId(), dto.getType(), dto.getContent());
    }

    // Conversion method to DTO
    public AssessmentRichTextDataDTO toDTO() {
        return new AssessmentRichTextDataDTO(this.id, this.type, this.content);
    }
}
