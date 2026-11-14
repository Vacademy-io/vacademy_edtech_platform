package vacademy.io.admin_core_service.features.product_config.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.product_config.dto.AlertResultDTO;
import vacademy.io.admin_core_service.features.product_config.dto.AlertTemplateDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupEventDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Tells the team about a new sign-up, by mail and WhatsApp, to the people on the product's settings.
 * Never in the way of the sign-up: every failure is recorded per recipient and nothing is thrown.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProductAlertService {

    static final String DEFAULT_TEMPLATE = "product_signup_alert";
    static final String DEFAULT_LANGUAGE = "en";
    /** Variables are the same for every product, so one approved template serves them all. */
    static final String DEFAULT_BODY = "New {{1}} sign-up.\n\n"
            + "Name: {{2}}\n"
            + "Institute: {{3}}\n"
            + "Email: {{4}}\n"
            + "Phone: {{5}}\n"
            + "Signed up with: {{6}}\n"
            + "Trial ends: {{7}}\n\n"
            + "Automatic alert from your product settings.";
    static final int VARIABLE_COUNT = 7;
    private static final List<String> SAMPLES = List.of("Evalezy", "Rahul Sharma", "Sunrise School",
            "rahul@example.com", "919876543210", "Email OTP", "8 Nov 2026");
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{(\\d+)}}");
    private static final int MAX_VARIABLE_LENGTH = 200;

    private final PlatformProductService products;
    private final PlatformWhatsAppClient whatsApp;
    private final NotificationService notifications;

    public AlertResultDTO signupCompleted(String productKey, SignupEventDTO event) {
        return send(products.get(productKey), event, false);
    }

    /** A sample alert to the saved recipients, to check the setup end to end. */
    public AlertResultDTO sendTest(String productKey) {
        SignupEventDTO sample = SignupEventDTO.builder()
                .fullName("Test sign-up")
                .instituteName("Test institute")
                .email("test@example.com")
                .phone("919876543210")
                .method("Test alert")
                .trialEnds("-")
                .build();
        return send(products.get(productKey), sample, true);
    }

    public AlertTemplateDTO template(String productKey) {
        ProductSettingsDTO product = products.get(productKey);
        String name = templateName(product);
        String language = language(product);
        if (!StringUtils.hasText(product.getWhatsappWabaId())) {
            return AlertTemplateDTO.builder().name(name).language(language).body(DEFAULT_BODY)
                    .status("NOT_REGISTERED").build();
        }
        AlertTemplateDTO found = meta(() -> whatsApp.findTemplate(product.getWhatsappWabaId(), name, language));
        if (found.getBody() == null) {
            found.setBody(DEFAULT_BODY);
        }
        return found;
    }

    public AlertTemplateDTO registerTemplate(String productKey, String body) {
        ProductSettingsDTO product = products.get(productKey);
        if (!StringUtils.hasText(product.getWhatsappWabaId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Save the WhatsApp Business Account id first");
        }
        String text = StringUtils.hasText(body) ? body.trim() : DEFAULT_BODY;
        requireAllVariables(text);
        String name = templateName(product);
        String language = language(product);
        meta(() -> {
            whatsApp.createTemplate(product.getWhatsappWabaId(), name, language, text, SAMPLES);
            return null;
        });
        return template(productKey);
    }

    /** {{1}} to {{7}}, each at least once and nothing else: alerts always send all seven. */
    static void requireAllVariables(String body) {
        boolean[] seen = new boolean[VARIABLE_COUNT + 1];
        Matcher matcher = PLACEHOLDER.matcher(body);
        while (matcher.find()) {
            int n = Integer.parseInt(matcher.group(1));
            if (n < 1 || n > VARIABLE_COUNT) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "Only {{1}} to {{7}} can be used");
            }
            seen[n] = true;
        }
        for (int n = 1; n <= VARIABLE_COUNT; n++) {
            if (!seen[n]) {
                throw new VacademyException(HttpStatus.BAD_REQUEST, "The message must use {{" + n + "}}");
            }
        }
    }

    private AlertResultDTO send(ProductSettingsDTO product, SignupEventDTO event, boolean test) {
        AlertResultDTO result = new AlertResultDTO();
        String subject = (test ? "[Test] " : "") + "New " + oneLine(product.getDisplayName()) + " sign-up: "
                + oneLine(event.getInstituteName());
        String html = mailBody(product, event);
        for (String to : split(product.getSignupAlertEmails())) {
            result.add("EMAIL", to, sendMail(product, event, to, subject, html));
        }
        List<String> variables = variables(product, event);
        for (String to : split(product.getSignupAlertWhatsapp())) {
            result.add("WHATSAPP", to, sendWhatsApp(product, to, variables));
        }
        result.getDeliveries().stream().filter(d -> !d.isSent()).forEach(d ->
                log.warn("[signup-alert] {} {} not sent for product {}: {}", d.getChannel(), mask(d.getTo()),
                        product.getProductKey(), d.getError()));
        return result;
    }

    private String sendMail(ProductSettingsDTO product, SignupEventDTO event, String to, String subject, String html) {
        try {
            notifications.sendUnified(UnifiedSendRequest.builder()
                    .instituteId(event.getInstituteId() != null ? event.getInstituteId() : "")
                    .channel("EMAIL")
                    .recipients(List.of(UnifiedSendRequest.Recipient.builder().email(to).build()))
                    .options(UnifiedSendRequest.SendOptions.builder()
                            .emailSubject(subject)
                            .emailBody(html)
                            .emailType("UTILITY_EMAIL")
                            .fromEmail(product.getFromEmail())
                            .fromName(product.getFromName())
                            .source("product-signup-alert")
                            .build())
                    .build());
            return null;
        } catch (Exception e) {
            return "The mail could not be sent";
        }
    }

    private String sendWhatsApp(ProductSettingsDTO product, String to, List<String> variables) {
        try {
            return whatsApp.sendTemplate(to, templateName(product), language(product), variables);
        } catch (Exception e) {
            return "WhatsApp could not be reached";
        }
    }

    /** The sign-up form is public, so everything in the mail is escaped. */
    private static String mailBody(ProductSettingsDTO product, SignupEventDTO event) {
        StringBuilder rows = new StringBuilder();
        row(rows, "Name", event.getFullName());
        row(rows, "Institute", event.getInstituteName());
        row(rows, "Email", event.getEmail());
        row(rows, "Phone", event.getPhone());
        row(rows, "Signed up with", event.getMethod());
        row(rows, "Came from", event.getSource());
        row(rows, "Trial ends", event.getTrialEnds());
        return "<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#111\">"
                + "<p><strong>New " + HtmlUtils.htmlEscape(valueOr(product.getDisplayName())) + " sign-up</strong></p>"
                + "<table cellpadding=\"6\" style=\"border-collapse:collapse\">" + rows + "</table></div>";
    }

    private static void row(StringBuilder rows, String label, String value) {
        if (StringUtils.hasText(value)) {
            rows.append("<tr><td style=\"color:#555\">").append(label).append("</td><td>")
                    .append(HtmlUtils.htmlEscape(value)).append("</td></tr>");
        }
    }

    /** Meta refuses a blank variable, line breaks, tabs and long runs of spaces. */
    static List<String> variables(ProductSettingsDTO product, SignupEventDTO event) {
        return List.of(variable(product.getDisplayName()), variable(event.getFullName()),
                variable(event.getInstituteName()), variable(event.getEmail()), variable(event.getPhone()),
                variable(event.getMethod()), variable(event.getTrialEnds()));
    }

    private static String variable(String value) {
        String clean = oneLine(value);
        if (clean.isEmpty()) {
            return "-";
        }
        return clean.length() <= MAX_VARIABLE_LENGTH ? clean : clean.substring(0, MAX_VARIABLE_LENGTH);
    }

    private static String oneLine(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim();
    }

    private static String valueOr(String value) {
        return value == null ? "" : value;
    }

    private static List<String> split(String list) {
        if (!StringUtils.hasText(list)) {
            return List.of();
        }
        return Arrays.stream(list.split(",")).map(String::trim).filter(StringUtils::hasText).toList();
    }

    private static String mask(String to) {
        return to.length() <= 4 ? "****" : "****" + to.substring(to.length() - 4);
    }

    private static String templateName(ProductSettingsDTO product) {
        return StringUtils.hasText(product.getSignupAlertTemplate()) ? product.getSignupAlertTemplate() : DEFAULT_TEMPLATE;
    }

    private static String language(ProductSettingsDTO product) {
        return StringUtils.hasText(product.getSignupAlertLanguage()) ? product.getSignupAlertLanguage() : DEFAULT_LANGUAGE;
    }

    private static <T> T meta(java.util.function.Supplier<T> call) {
        try {
            return call.get();
        } catch (IllegalStateException e) {
            throw new VacademyException(HttpStatus.BAD_GATEWAY, e.getMessage());
        }
    }
}
