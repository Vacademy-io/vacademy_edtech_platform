package vacademy.io.admin_core_service.features.invoice.util;

import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.institute.dto.template.TemplateResponse;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Picks which institute template renders an invoice (PDF layout or email body).
 *
 * <p>An admin can mark one template of each type as the default from Settings &gt; Invoice;
 * its id is stored in {@code INVOICE_SETTING} under {@link #PDF_SETTING_KEY} /
 * {@link #EMAIL_SETTING_KEY}. When no default is set, or it no longer exists (deleted),
 * the newest template wins, which is the behaviour before defaults existed.
 *
 * <p>Pure — no Spring, no DB.
 */
public final class InvoiceDefaultTemplatePicker {

    /** INVOICE_SETTING key holding the default INVOICE (PDF layout) template id. */
    public static final String PDF_SETTING_KEY = "defaultInvoiceTemplateId";
    /** INVOICE_SETTING key holding the default INVOICE_EMAIL template id. */
    public static final String EMAIL_SETTING_KEY = "defaultInvoiceEmailTemplateId";

    private InvoiceDefaultTemplatePicker() {
    }

    /** The default id stored under {@code key}, or null when absent or not a string. */
    public static String defaultIdFrom(Object invoiceSettingData, String key) {
        if (!(invoiceSettingData instanceof Map<?, ?> map)) {
            return null;
        }
        Object value = map.get(key);
        return value instanceof String s && StringUtils.hasText(s) ? s : null;
    }

    /**
     * @param newestFirst templates of one type, newest first (as
     *                    {@code findByInstituteIdAndTypeOrderByCreatedAtDesc} returns them)
     * @param defaultId   the admin-chosen default, or null
     * @return the default template when it is in the list and has content, else the newest
     */
    public static Optional<TemplateResponse> pick(List<TemplateResponse> newestFirst, String defaultId) {
        if (newestFirst == null || newestFirst.isEmpty()) {
            return Optional.empty();
        }
        if (StringUtils.hasText(defaultId)) {
            for (TemplateResponse template : newestFirst) {
                if (template != null && defaultId.equals(template.getId())
                        && StringUtils.hasText(template.getContent())) {
                    return Optional.of(template);
                }
            }
        }
        return Optional.ofNullable(newestFirst.get(0));
    }
}
