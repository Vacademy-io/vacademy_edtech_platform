// EmailConfig.java
package vacademy.io.notification_service.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;

import java.util.Properties;

// vendor-call-log: builds the JavaMailSender bean; sends are recorded in EmailService
@Configuration
public class EmailConfig {

    @Value("${spring.mail.host}")
    private String host;

    @Value("${spring.mail.port}")
    private int port;

    @Value("${spring.mail.username}")
    private String username;

    @Value("${spring.mail.password}")
    private String password;

    @Value("${spring.mail.properties.mail.smtp.auth:false}")
    private boolean smtpAuth;

    @Value("${spring.mail.properties.mail.smtp.starttls.enable:false}")
    private boolean starttlsEnable;

    @Bean
    public JavaMailSender javaMailSender() {
        JavaMailSenderImpl mailSender = new JavaMailSenderImpl();
        mailSender.setHost(host);
        mailSender.setPort(port);
        mailSender.setUsername(username);
        mailSender.setPassword(password);

        Properties props = mailSender.getJavaMailProperties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.auth", Boolean.toString(smtpAuth));
        props.put("mail.smtp.starttls.enable", Boolean.toString(starttlsEnable));
        // Disabled mail.debug to prevent excessive SMTP protocol logs (can flood logs
        // with 50+ emails/second)
        props.put("mail.debug", "false");

        // Connection timeout settings to prevent [EOF] authentication failures
        props.put("mail.smtp.connectiontimeout", "10000"); // 10 seconds to establish connection
        props.put("mail.smtp.timeout", "10000"); // 10 seconds for read operations
        props.put("mail.smtp.writetimeout", "10000"); // 10 seconds for write operations

        // Prevent using stale connections that cause EOF errors
        props.put("mail.smtp.ssl.checkserveridentity", "true");
        props.put("mail.smtp.starttls.required", Boolean.toString(starttlsEnable));

        // Connection pool management - close connections after each send to avoid stale
        // connections
        props.put("mail.smtp.quitwait", "false"); // Don't wait for server response on QUIT command

        return mailSender;
    }
}