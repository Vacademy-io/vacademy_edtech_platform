package vacademy.io.admin_core_service.features.catalogue_blog.dto;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A site visitor liking (liked = true) or unliking a post. visitor_key is the
 * random id the browser keeps for this site; it is what makes one browser count
 * once.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public class BlogLikeRequest {
    private String instituteId;
    private String postId;
    private String visitorKey;
    private Boolean liked;
}
