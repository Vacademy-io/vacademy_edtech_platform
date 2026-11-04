package vacademy.io.admin_core_service.features.product_config.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.sql.Timestamp;

@Entity
@Table(name = "platform_product")
@Getter
@Setter
public class PlatformProduct {
    @Id
    @Column(name = "product_key")
    private String productKey;
    @Column(name = "display_name")
    private String displayName;
    @Column(name = "from_email")
    private String fromEmail;
    @Column(name = "from_name")
    private String fromName;
    @Column(name = "website_url")
    private String websiteUrl;
    @Column(name = "contact_email")
    private String contactEmail;
    @Column(name = "theme_color")
    private String themeColor;
    @Column(name = "logo_url")
    private String logoUrl;
    @Column(name = "app_path")
    private String appPath;
    @Column(name = "login_url")
    private String loginUrl;
    @Column(name = "trial_days")
    private Integer trialDays;
    @Column(name = "self_signup_enabled")
    private Boolean selfSignupEnabled;
    @Column(name = "return_hosts")
    private String returnHosts;
    @Column(name = "updated_by")
    private String updatedBy;
    @Column(name = "updated_at")
    private Timestamp updatedAt;
}
