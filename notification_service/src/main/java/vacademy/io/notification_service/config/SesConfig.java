package vacademy.io.notification_service.config;

import com.amazonaws.auth.AWSStaticCredentialsProvider;
import com.amazonaws.auth.BasicAWSCredentials;
import com.amazonaws.services.simpleemail.AmazonSimpleEmailService;
import com.amazonaws.services.simpleemail.AmazonSimpleEmailServiceClientBuilder;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Builds the AWS SES (v1 SDK) client used ONLY for sender-identity verification
 * (verifyEmailIdentity / verifyDomainDkim / getIdentityVerificationAttributes).
 * Actual mail sending still happens over SMTP via {@link org.springframework.mail.javamail.JavaMailSender}.
 *
 * <p>The bean is created only when {@code aws.ses.verification.enabled=true}, so local/dev
 * deployments without SES-capable AWS credentials start cleanly and the feature reports
 * itself as unavailable to the admin UI (mirrors the white-label "not available" gate).
 *
 * <p>Credentials are reused from the existing {@code aws.accessKey}/{@code aws.secretKey}
 * (SQS_AWS_*). Those IAM credentials must additionally grant the SES verify/get identity
 * actions AND belong to the same AWS account+region that the SES SMTP endpoint sends from.
 */
@Configuration
@ConditionalOnProperty(name = "aws.ses.verification.enabled", havingValue = "true", matchIfMissing = false)
public class SesConfig {

    @Value("${aws.ses.verification.accessKey}")
    private String accessKey;

    @Value("${aws.ses.verification.secretKey}")
    private String secretKey;

    @Value("${aws.ses.verification.region}")
    private String region;

    @Bean(name = "sesVerificationClient")
    public AmazonSimpleEmailService sesVerificationClient() {
        BasicAWSCredentials credentials = new BasicAWSCredentials(accessKey, secretKey);
        return AmazonSimpleEmailServiceClientBuilder.standard()
                .withCredentials(new AWSStaticCredentialsProvider(credentials))
                .withRegion(region)
                .build();
    }
}
