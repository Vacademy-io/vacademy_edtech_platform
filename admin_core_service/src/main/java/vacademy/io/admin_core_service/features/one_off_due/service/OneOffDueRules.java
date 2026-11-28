package vacademy.io.admin_core_service.features.one_off_due.service;

import vacademy.io.common.exceptions.VacademyException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.regex.Pattern;

/** Validation and status rules for one-off charges. No I/O, so they are unit tested directly. */
public final class OneOffDueRules {

    public static final String STATUS_DUE = "DUE";
    public static final String STATUS_PAID = "PAID";
    public static final String STATUS_CANCELLED = "CANCELLED";

    static final int MAX_TITLE = 200;
    static final int MAX_NOTE = 2000;
    static final int MAX_REASON = 500;
    /** Same ceiling as the invoice columns (NUMERIC(10,2)). */
    static final BigDecimal MAX_AMOUNT = new BigDecimal("99999999.99");
    static final int MAX_DAYS_BACK = 366;
    static final int MAX_DAYS_AHEAD = 3 * 366;

    private static final Pattern SOURCE_TYPE = Pattern.compile("[A-Z][A-Z0-9_]{0,39}");

    private OneOffDueRules() {
    }

    /** A cleaned-up request, ready to save. */
    public record Clean(BigDecimal amount, LocalDate dueDate, String title, String note,
                        String sourceType, String sourceId) {
    }

    public static Clean validate(BigDecimal amount, LocalDate dueDate, String title, String note,
                                 String sourceType, String sourceId, LocalDate today) {
        if (amount == null || amount.signum() <= 0) {
            throw new VacademyException("Enter an amount above zero.");
        }
        if (amount.stripTrailingZeros().scale() > 2) {
            throw new VacademyException("The amount can have at most two decimal places.");
        }
        if (amount.compareTo(MAX_AMOUNT) > 0) {
            throw new VacademyException("The amount is too large.");
        }
        String cleanTitle = title == null ? "" : title.trim();
        if (cleanTitle.isEmpty()) {
            throw new VacademyException("Give the charge a title, for example \"Bridge class\".");
        }
        if (cleanTitle.length() > MAX_TITLE) {
            throw new VacademyException("The title can be at most " + MAX_TITLE + " characters.");
        }
        String cleanNote = note == null || note.isBlank() ? null : note.trim();
        if (cleanNote != null && cleanNote.length() > MAX_NOTE) {
            throw new VacademyException("The note can be at most " + MAX_NOTE + " characters.");
        }
        if (dueDate == null) {
            throw new VacademyException("Choose a due date.");
        }
        if (today != null && dueDate.isBefore(today.minusDays(MAX_DAYS_BACK))) {
            throw new VacademyException("The due date is more than a year in the past.");
        }
        if (today != null && dueDate.isAfter(today.plusDays(MAX_DAYS_AHEAD))) {
            throw new VacademyException("The due date is more than three years away.");
        }
        String cleanSource = sourceType == null || sourceType.isBlank() ? "MANUAL" : sourceType.trim().toUpperCase();
        if (!SOURCE_TYPE.matcher(cleanSource).matches()) {
            throw new VacademyException("Unknown source type: " + sourceType);
        }
        String cleanSourceId = sourceId == null || sourceId.isBlank() ? null : sourceId.trim();
        if (cleanSourceId != null && cleanSourceId.length() > 255) {
            throw new VacademyException("The source id is too long.");
        }
        return new Clean(amount.setScale(2), dueDate, cleanTitle, cleanNote, cleanSource, cleanSourceId);
    }

    /** The charge's status, read from its invoice. A missing invoice (deleted) reads as cancelled. */
    public static String statusOf(String invoiceStatus) {
        if (invoiceStatus == null) return STATUS_CANCELLED;
        return switch (invoiceStatus.toUpperCase()) {
            case "PENDING_PAYMENT" -> STATUS_DUE;
            case "PAID" -> STATUS_PAID;
            default -> STATUS_CANCELLED;
        };
    }

    /** Only an unpaid charge can be cancelled. */
    public static void requireCancellable(String status) {
        if (STATUS_PAID.equals(status)) {
            throw new VacademyException("This charge is already paid, so it cannot be cancelled.");
        }
        if (STATUS_CANCELLED.equals(status)) {
            throw new VacademyException("This charge is already cancelled.");
        }
    }

    public static String cleanReason(String reason) {
        if (reason == null || reason.isBlank()) return null;
        String r = reason.trim();
        return r.length() > MAX_REASON ? r.substring(0, MAX_REASON) : r;
    }
}
