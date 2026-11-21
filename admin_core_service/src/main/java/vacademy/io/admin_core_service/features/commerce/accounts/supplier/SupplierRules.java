package vacademy.io.admin_core_service.features.commerce.accounts.supplier;

import org.springframework.http.HttpStatus;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.RegistrationType;
import vacademy.io.admin_core_service.features.commerce.accounts.enums.SupplierStatus;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.SupplierRequest;
import vacademy.io.admin_core_service.features.commerce.accounts.supplier.SupplierDtos.Warning;
import vacademy.io.admin_core_service.features.commerce.tax.service.GstinValidator;
import vacademy.io.admin_core_service.features.platform_billing.service.IndianStates;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.StringJoiner;
import java.util.regex.Pattern;

/**
 * Checks of a supplier body, without any database read. Text is trimmed and blank becomes null.
 * Failures are 400 {@code VALIDATION: ...}, or 422 for a GSTIN or PAN that is not valid. Messages
 * never repeat a PAN.
 */
public final class SupplierRules {

    public static final String DEFAULT_GROUP = "SUPPLIER";
    public static final String DEFAULT_COUNTRY = "IN";
    public static final String INVALID_GSTIN = "INVALID_GSTIN";
    public static final String GSTIN_STATE_MISMATCH = "GSTIN_STATE_MISMATCH";
    public static final String INVALID_PAN = "INVALID_PAN";
    public static final String PAN_DIFFERS_FROM_GSTIN = "PAN_DIFFERS_FROM_GSTIN";

    static final Pattern CODE = Pattern.compile("^[A-Za-z0-9_-]{1,32}$");
    static final Pattern GROUP = Pattern.compile("^[A-Z0-9_]{1,32}$");
    static final Pattern PHONE = Pattern.compile("^[+0-9 -]{6,20}$");
    static final Pattern COUNTRY = Pattern.compile("^[A-Z]{2}$");
    static final Pattern TDS_CODE = Pattern.compile("^[A-Z0-9_]{1,32}$");
    static final Pattern UPI = Pattern.compile("^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9]{2,64}$");
    static final Pattern PAN = Pattern.compile("^[A-Z]{5}[0-9]{4}[A-Z]$");
    private static final int MAX_ID = 36;

    private SupplierRules() {
    }

    /** What the request does to the stored PAN. */
    public enum PanAction { UNCHANGED, REMOVE, SET }

    /** A checked, normalised supplier body. {@code code} null = generate one (create) or keep (edit). */
    public static final class Draft {
        public String code;
        public String name;
        public String legalName;
        public String nameAlt;
        public String groupCode;
        public String phone;
        public String email;
        public String addressLine1;
        public String addressLine2;
        public String city;
        public String countryCode;
        public String stateCode;
        public String pincode;
        public RegistrationType registrationType;
        public String gstin;
        public int paymentTermsDays;
        public boolean tdsApplicable;
        public String defaultTdsCode;
        public String upiId;
        public String paymentNote;
        public String defaultHeadId;
        public String customerId;
        public String externalRef;
        public String notes;
        public PanAction panAction = PanAction.UNCHANGED;
        /** The PAN to store when {@link #panAction} is SET; never logged. */
        public String pan;
        public final List<Warning> warnings = new ArrayList<>();

        @Override
        public String toString() {
            return "SupplierRules.Draft{code=" + code + ", panAction=" + panAction + "}";
        }
    }

    public static Draft check(SupplierRequest request) {
        if (request == null) {
            throw new InvalidRequestException("VALIDATION: request body is required");
        }
        Draft d = new Draft();
        d.name = text(request.getName(), "name", 255);
        if (d.name == null) {
            throw validation("name is required");
        }
        d.legalName = text(request.getLegalName(), "legal_name", 255);
        d.nameAlt = text(request.getNameAlt(), "name_alt", 255);

        String code = trim(request.getCode());
        if (code != null) {
            if (!CODE.matcher(code).matches()) {
                throw validation("code must be 1 to 32 letters, digits, hyphens or underscores");
            }
            d.code = code.toUpperCase(Locale.ROOT);
        }

        String group = trim(request.getGroupCode());
        if (group == null) {
            d.groupCode = DEFAULT_GROUP;
        } else {
            group = group.toUpperCase(Locale.ROOT);
            if (!GROUP.matcher(group).matches()) {
                throw validation("group_code must be 1 to 32 capital letters, digits or underscores");
            }
            d.groupCode = group;
        }

        d.phone = text(request.getPhone(), "phone", 20);
        if (d.phone != null && !PHONE.matcher(d.phone).matches()) {
            throw validation("phone must be 6 to 20 digits, spaces, hyphens or a leading +");
        }
        d.email = text(request.getEmail(), "email", 255);
        if (d.email != null && !isEmail(d.email)) {
            throw validation("email is not a valid address");
        }
        d.addressLine1 = text(request.getAddressLine1(), "address_line1", 255);
        d.addressLine2 = text(request.getAddressLine2(), "address_line2", 255);
        d.city = text(request.getCity(), "city", 100);
        d.pincode = text(request.getPincode(), "pincode", 10);

        String country = trim(request.getCountryCode());
        d.countryCode = country == null ? DEFAULT_COUNTRY : country.toUpperCase(Locale.ROOT);
        if (!COUNTRY.matcher(d.countryCode).matches()) {
            throw validation("country_code must be two letters");
        }
        boolean india = DEFAULT_COUNTRY.equals(d.countryCode);
        String state = trim(request.getStateCode());

        d.gstin = GstinValidator.normalise(request.getGstin());
        if (d.gstin != null && state == null && india && d.gstin.length() >= 2) {
            state = d.gstin.substring(0, 2);
        }
        String type = trim(request.getRegistrationType());
        if (type == null) {
            d.registrationType = d.gstin != null ? RegistrationType.REGULAR : RegistrationType.UNREGISTERED;
        } else {
            try {
                d.registrationType = RegistrationType.valueOf(type.toUpperCase(Locale.ROOT));
            } catch (IllegalArgumentException e) {
                throw validation("registration_type must be REGULAR, COMPOSITION or UNREGISTERED");
            }
        }
        if (d.registrationType == RegistrationType.UNREGISTERED) {
            if (d.gstin != null) {
                throw validation("gstin must be empty for an unregistered supplier");
            }
        } else {
            if (d.gstin == null) {
                throw validation("gstin is required for a registered supplier");
            }
            if (!india) {
                throw validation("a GSTIN needs country_code IN");
            }
            if (!isValidSupplierGstin(d.gstin)) {
                throw new VacademyException(HttpStatus.UNPROCESSABLE_ENTITY,
                        INVALID_GSTIN + ": gstin is not a valid GSTIN");
            }
        }

        if (india) {
            if (state == null) {
                throw validation("state_code is required for a supplier in India");
            }
            if (!IndianStates.isValidCode(state)) {
                throw validation("state_code is not a known state code");
            }
            if (d.gstin != null && !d.gstin.startsWith(state)) {
                throw new VacademyException(HttpStatus.UNPROCESSABLE_ENTITY,
                        GSTIN_STATE_MISMATCH + ": the GSTIN belongs to another state than state_code");
            }
        } else if (state != null) {
            throw validation("state_code is only for suppliers in India");
        }
        d.stateCode = state;

        Integer terms = request.getPaymentTermsDays();
        d.paymentTermsDays = terms == null ? 0 : terms;
        if (d.paymentTermsDays < 0 || d.paymentTermsDays > 365) {
            throw validation("payment_terms_days must be between 0 and 365");
        }
        d.tdsApplicable = Boolean.TRUE.equals(request.getTdsApplicable());
        String tds = trim(request.getDefaultTdsCode());
        if (tds != null) {
            tds = tds.toUpperCase(Locale.ROOT);
            if (!TDS_CODE.matcher(tds).matches()) {
                throw validation("default_tds_code must be 1 to 32 capital letters, digits or underscores");
            }
        }
        d.defaultTdsCode = tds;
        d.upiId = text(request.getUpiId(), "upi_id", 100);
        if (d.upiId != null && !UPI.matcher(d.upiId).matches()) {
            throw validation("upi_id is not a valid UPI id");
        }
        d.paymentNote = text(request.getPaymentNote(), "payment_note", 500);
        d.defaultHeadId = text(request.getDefaultHeadId(), "default_head_id", MAX_ID);
        d.customerId = text(request.getCustomerId(), "customer_id", MAX_ID);
        d.externalRef = text(request.getExternalRef(), "external_ref", 100);
        d.notes = text(request.getNotes(), "notes", 2000);

        String pan = request.getPan();
        if (pan != null) {
            String cleaned = pan.trim().toUpperCase(Locale.ROOT);
            if (cleaned.isEmpty()) {
                d.panAction = PanAction.REMOVE;
            } else if (!PAN.matcher(cleaned).matches()) {
                throw new VacademyException(HttpStatus.UNPROCESSABLE_ENTITY, INVALID_PAN + ": pan is not a valid PAN");
            } else {
                d.panAction = PanAction.SET;
                d.pan = cleaned;
                if (d.gstin != null && !cleaned.equals(d.gstin.substring(2, 12))) {
                    d.warnings.add(Warning.of(PAN_DIFFERS_FROM_GSTIN));
                }
            }
        }
        return d;
    }

    /** Checksum (commerce GSTIN rule) and a known state code. */
    public static boolean isValidSupplierGstin(String gstin) {
        return GstinValidator.isValid(gstin) && IndianStates.isValidCode(gstin.substring(0, 2));
    }

    /** ACTIVE or INACTIVE. */
    public static SupplierStatus status(String raw) {
        String value = trim(raw);
        if (value == null) {
            throw validation("status is required");
        }
        try {
            return SupplierStatus.valueOf(value.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw validation("status must be ACTIVE or INACTIVE");
        }
    }

    /** Lower-case join of name, legal name, other name, code, phone and GSTIN. */
    public static String searchText(String name, String legalName, String nameAlt, String code, String phone,
                                    String gstin) {
        StringJoiner joiner = new StringJoiner(" ");
        for (String part : new String[]{name, legalName, nameAlt, code, phone, gstin}) {
            if (part != null && !part.isBlank()) {
                joiner.add(part.trim());
            }
        }
        return joiner.toString().toLowerCase(Locale.ROOT);
    }

    /** {@code %}, {@code _} and {@code \} escaped by a backslash, lower-cased, inside {@code %...%}. */
    public static String likePattern(String query) {
        StringBuilder out = new StringBuilder("%");
        for (char c : query.toLowerCase(Locale.ROOT).toCharArray()) {
            if (c == '%' || c == '_' || c == '\\') {
                out.append('\\');
            }
            out.append(c);
        }
        return out.append('%').toString();
    }

    static String trim(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static String text(String value, String field, int max) {
        String trimmed = trim(value);
        if (trimmed != null && trimmed.length() > max) {
            throw validation(field + " must be at most " + max + " characters");
        }
        return trimmed;
    }

    private static boolean isEmail(String value) {
        int at = value.indexOf('@');
        return at > 0 && at == value.lastIndexOf('@') && at < value.length() - 1
                && value.chars().noneMatch(Character::isWhitespace);
    }

    static InvalidRequestException validation(String message) {
        return new InvalidRequestException("VALIDATION: " + message);
    }
}
