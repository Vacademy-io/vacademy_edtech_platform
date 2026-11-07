package vacademy.io.admin_core_service.features.enroll_invite.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import org.springframework.beans.factory.annotation.Value;

import java.sql.Date;
import java.sql.Timestamp;
import java.util.List;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public interface EnrollInviteWithSessionsProjection {

    // Standard getters for EnrollInvite fields
    String getId();
    String getName();
    Date getEndDate();
    Date getStartDate();
    String getInviteCode();
    String getStatus();
    String getInstituteId();
    String getVendor();
    String getVendorId();
    String getCurrency();
    String getTag();

    String getWebPageMetaDataJson();
    Timestamp getCreatedAt();
    Timestamp getUpdatedAt();
    String getCreatedByUserId();
    String getUpdatedByUserId();

    @JsonIgnore
    String getShortUrl();

    @Value("#{@shortUrlManagementService.getAbsoluteShortUrl(target.instituteId, target.shortUrl)}")
    @JsonProperty("short_url")
    String getAbsoluteShortUrl();

    // This getter receives the raw comma-separated string from the query.
    // The alias in the query MUST match this getter name (packageSessionIdsCsv).
    List<String>getPackageSessionIds();
    // This uses Spring Expression Language (SpEL) to transform the raw string into a Lis
}