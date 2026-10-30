package vacademy.io.admin_core_service.features.usage_metering.config;

import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.BasicAWSCredentials;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * S3 client for the usage reports (S3 Inventory, S3 access logs) and the CloudFront
 * access logs. Uses its own read-only key (IAM user vacademy-usage-reader), never the
 * media key; with the key unset the client is null and metering is skipped.
 */
@Configuration
public class UsageS3Config {

    @Value("${usage.s3.region:ap-south-1}")
    private String region;

    @Value("${usage.s3.access-key:}")
    private String accessKey;

    @Value("${usage.s3.secret-key:}")
    private String secretKey;

    @Bean(name = "usageS3Client")
    public UsageS3Client usageS3Client() {
        if (accessKey == null || accessKey.isBlank() || secretKey == null || secretKey.isBlank()) {
            return new UsageS3Client(null);
        }
        AmazonS3 s3 = AmazonS3ClientBuilder.standard()
                .withRegion(region)
                .withCredentials(new AWSStaticCredentialsProvider(new BasicAWSCredentials(accessKey, secretKey)))
                .build();
        return new UsageS3Client(s3);
    }

    /** Holder so the app starts without the key; {@link #s3()} is null when unconfigured. */
    public record UsageS3Client(AmazonS3 s3) {
        public boolean configured() {
            return s3 != null;
        }
    }
}
