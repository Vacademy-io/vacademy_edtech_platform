package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAuditWriter;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiKeyService;
import vacademy.io.admin_core_service.features.telephony.controller.TelephonyCounsellorEndpointController;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyCounsellorEndpoint;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCounsellorEndpointRepository;
import vacademy.io.common.auth.dto.UserDTO;

import java.util.*;
import java.util.regex.Pattern;

/**
 * Counsellor management through the public API (Telleo API v1.3, scope counsellors:manage):
 * add a counsellor (a dashboard login with the COUNSELLOR role in this institute), read one,
 * change their name / mobile / Airtel extension, deactivate and reactivate them.
 *
 * <p>Users and roles live only in auth_service; everything here goes through its
 * HMAC-internal endpoints, strictly (an auth_service failure is a 503, never "no such user").
 *
 * <p>Rules (owner decisions, 2026-10):
 * <ul>
 *   <li><b>New email:</b> a new account, ACTIVE at once, COUNSELLOR role here, and (unless
 *       {@code send_welcome_email: false}) the platform's welcome email with the dashboard
 *       login and a generated password. The mobile number is set after the account exists,
 *       never sent to the create call: an institute that logs in by PHONE would otherwise
 *       match the number to some other account (a learner's) and grant THAT account the role.</li>
 *   <li><b>Existing email:</b> the same account gets the COUNSELLOR role here; its name,
 *       mobile and password are never changed and NO email is sent (the only existing
 *       "you have an account" template mails the stored password).</li>
 *   <li><b>Only counsellors are managed.</b> The API grants COUNSELLOR and nothing else, and
 *       edits / deactivates only users whose roles here are COUNSELLOR / COUNSELOR only — an
 *       admin, a teacher or a learner is 403 counsellor_not_manageable.</li>
 *   <li><b>Shared accounts:</b> a name or mobile change is refused (409 shared_account) when
 *       the account also belongs to another institute: the email and mobile number are the
 *       person's global login, and another institute's admin would see them change.</li>
 *   <li><b>Deactivate:</b> COUNSELLOR rows here → DISABLED (other institutes untouched),
 *       INACTIVE in every lead pool of this institute (their leads stay assigned), removed from
 *       this institute's IVR "ring these people" lists; the inbound last-counsellor route skips
 *       them. Reactivate restores the role only: pool rows stay INACTIVE (an admin may have
 *       paused some on purpose before; nothing records which) and IVR lists are not refilled.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CounsellorApiService {

    static final String GRANTED_ROLE = "COUNSELLOR";
    static final List<String> COUNSELLOR_ROLES = List.of("COUNSELLOR", "COUNSELOR");
    static final Set<String> ELIGIBLE_ROLES = Set.of("COUNSELLOR", "COUNSELOR", "ADMIN");
    static final Set<String> LIVE = Set.of("ACTIVE", "INVITED");
    static final Set<String> PAUSED = Set.of("DISABLED", "INACTIVE");
    static final String OP_CREATE = "counsellor.create";
    static final int MAX_NAME = 120;
    static final int MAX_EMAIL = 254;
    static final Pattern EMAIL = Pattern.compile(
            "^[A-Za-z0-9._%+'\\-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$");
    static final Pattern EXTENSION = Pattern.compile("^[0-9A-Za-z*#_\\-]{1,32}$");
    static final String DEACTIVATED = "This counsellor is deactivated.";

    private final AuthService authService;
    private final HumanCallApiService humanCalls;
    private final TelephonyCounsellorEndpointRepository endpoints;
    private final NamedParameterJdbcTemplate jdbc;
    private final ApiIdempotencyStore idempotency;
    private final InstituteApiAuditWriter audit;
    private final ObjectMapper mapper = new ObjectMapper();

    // ── Inputs ───────────────────────────────────────────────────────────────────

    public record CreateInput(String name, String email, String mobileNumber, String airtelExtension,
                              Boolean sendWelcomeEmail) {
    }

    /** PATCH: each *Set flag says the field was present in the JSON (null airtel_extension = remove). */
    public record PatchInput(String name, boolean nameSet, String mobileNumber, boolean mobileSet,
                             String airtelExtension, boolean extensionSet, Boolean active) {
    }

    /** The normalised create request, also what its Idempotency-Key is checked against. */
    record NewCounsellor(String name, String email, String mobile, String extension, boolean sendWelcome) {
    }

    // ── Standing in the institute ────────────────────────────────────────────────

    /** {@code role} upper-cased for comparisons; {@code rawRole} as stored (auth_service matches it). */
    record Membership(String instituteId, String role, String rawRole, String status) {
    }

    /**
     * A user's non-deleted role rows, here and everywhere, and whether they once belonged here
     * (a DELETED row in this institute).
     */
    record Standing(String instituteId, List<Membership> here, List<Membership> all, boolean deletedHere) {

        Standing(String instituteId, List<Membership> here, List<Membership> all) {
            this(instituteId, here, all, false);
        }

        /** The stored names of the counsellor roles held here, for auth_service. */
        List<String> counsellorRoleNamesHere() {
            List<String> names = new ArrayList<>(COUNSELLOR_ROLES);
            here.stream().filter(m -> COUNSELLOR_ROLES.contains(m.role())).map(Membership::rawRole)
                    .filter(r -> !names.contains(r)).forEach(names::add);
            return names;
        }

        boolean pausedCounsellorHere() {
            return here.stream().anyMatch(m -> COUNSELLOR_ROLES.contains(m.role()) && PAUSED.contains(m.status()));
        }

        boolean eligibleHere() {
            return here.stream().anyMatch(m -> ELIGIBLE_ROLES.contains(m.role()));
        }

        /** Every role row here is a counsellor role: the only users the API may change. */
        boolean counsellorOnlyHere() {
            return !here.isEmpty() && here.stream().allMatch(m -> COUNSELLOR_ROLES.contains(m.role()));
        }

        boolean onlyThisInstitute() {
            return all.stream().allMatch(m -> instituteId.equals(m.instituteId()));
        }

        boolean liveCounsellorHere() {
            return here.stream().anyMatch(m -> COUNSELLOR_ROLES.contains(m.role()) && LIVE.contains(m.status()));
        }

        /** active | invited | inactive, from the eligible rows here. */
        String status() {
            List<Membership> eligible = here.stream().filter(m -> ELIGIBLE_ROLES.contains(m.role())).toList();
            if (eligible.stream().anyMatch(m -> "ACTIVE".equals(m.status()))) return "active";
            if (eligible.stream().anyMatch(m -> "INVITED".equals(m.status()))) return "invited";
            return "inactive";
        }

        List<String> rolesHere() {
            return here.stream().map(Membership::role).distinct().sorted().toList();
        }
    }

    Standing standing(String instituteId, String userId) {
        List<Map<String, String>> rows;
        try {
            rows = authService.getRoleMembershipsStrict(userId);
        } catch (RuntimeException e) {
            log.warn("counsellor-api: membership lookup failed for {}: {}", userId, e.getMessage());
            throw unavailable();
        }
        List<Membership> all = new ArrayList<>();
        boolean deletedHere = false;
        for (Map<String, String> r : rows == null ? List.<Map<String, String>>of() : rows) {
            if (r == null || r.get("institute_id") == null || r.get("role_name") == null) continue;
            String status = r.get("status") == null ? "" : r.get("status").toUpperCase(Locale.ROOT);
            if ("DELETED".equals(status)) {
                deletedHere |= instituteId.equals(r.get("institute_id"));
                continue;
            }
            all.add(new Membership(r.get("institute_id"), r.get("role_name").toUpperCase(Locale.ROOT),
                    r.get("role_name"), status));
        }
        List<Membership> here = all.stream().filter(m -> instituteId.equals(m.instituteId())).toList();
        return new Standing(instituteId, here, all, deletedHere);
    }

    // ── Read ─────────────────────────────────────────────────────────────────────

    /** GET /v1/counsellors/{id}: a counsellor or admin of this institute, active or not. */
    public Map<String, Object> getCounsellor(AiCallingApiAuth.Principal p, String id) {
        String userId = requireId(id);
        Standing st = standing(p.instituteId(), userId);
        if (!st.eligibleHere()) throw notFound(userId);
        return view(p, userId, st, user(userId).orElseThrow(() -> notFound(userId)));
    }

    Map<String, Object> view(AiCallingApiAuth.Principal p, String userId, Standing st, UserDTO u) {
        String instituteId = p.instituteId();
        String status = st.status();
        String name = displayName(u, userId);
        String mobile = blankToNull(u.getMobileNumber());
        String blocked = DEACTIVATED;
        if (!"inactive".equals(status)) {
            blocked = humanCalls.blockedReason(instituteId, humanCalls.primaryProvider(instituteId),
                    new HumanCallApiService.Counsellor(userId, name, blankToNull(u.getEmail()), mobile, st.rolesHere()));
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", userId);
        m.put("object", "counsellor");
        m.put("name", name);
        m.put("email", blankToNull(u.getEmail()));
        m.put("roles", st.rolesHere());
        m.put("status", status);
        m.put("can_call", blocked == null);
        m.put("blocked_reason", blocked);
        if (p.has(InstituteApiKeyService.SCOPE_COUNSELLORS_MANAGE)) {
            // A login shared with another institute is that person's identity there too: its
            // mobile number is never shown through this account's key.
            m.put("mobile_number", st.onlyThisInstitute() ? mobile : null);
            m.put("airtel_extension", extensionOf(instituteId, userId));
            m.put("manageable", st.counsellorOnlyHere());
            m.put("shared_account", !st.onlyThisInstitute());
        }
        return m;
    }

    // ── Create ───────────────────────────────────────────────────────────────────

    public ApiIdempotencyStore.Outcome createCounsellor(AiCallingApiAuth.Principal p, CreateInput in, String idemKey) {
        NewCounsellor n = validateCreate(in);
        return idempotency.run(p.instituteId(), p.keyId(), OP_CREATE, idemKey, n,
                () -> doCreate(p, n),
                userId -> getCounsellor(p, userId));
    }

    NewCounsellor validateCreate(CreateInput in) {
        List<Map<String, String>> errors = new ArrayList<>();
        String name = blankToNull(in == null ? null : in.name());
        if (name == null) errors.add(err("name", "name is required."));
        else if (name.length() > MAX_NAME) errors.add(err("name", "name is at most " + MAX_NAME + " characters."));
        String email = blankToNull(in == null ? null : in.email());
        if (email == null) {
            errors.add(err("email", "email is required: it is the counsellor's dashboard login."));
        } else if (email.length() > MAX_EMAIL || !EMAIL.matcher(email).matches()) {
            errors.add(err("email", "email is not a valid email address."));
        }
        String mobile = null;
        if (in != null && blankToNull(in.mobileNumber()) != null) {
            mobile = AiCallingApiService.normalisePhone(in.mobileNumber());
            if (mobile == null) errors.add(err("mobile_number", "mobile_number must be in E.164 format, e.g. +919876543210."));
        }
        String ext = in == null ? null : blankToNull(in.airtelExtension());
        if (ext != null && !EXTENSION.matcher(ext).matches()) {
            errors.add(err("airtel_extension", "airtel_extension is 1-32 letters, digits, *, #, - or _."));
        }
        if (!errors.isEmpty()) throw AiCallingApiException.invalid(errors.get(0).get("message"), Map.of("errors", errors));
        return new NewCounsellor(name, email.toLowerCase(Locale.ROOT), mobile, ext,
                in.sendWelcomeEmail() == null || in.sendWelcomeEmail());
    }

    /**
     * Serialises creates of the same email (across institutes and pods): two concurrent
     * requests would otherwise both find no account and both create one, and auth_service's
     * create of the second finds the first and mails it a "you already have an account" email
     * WITH the stored password. The lock is a row, not a transaction, because the work in
     * between is HTTP calls to auth_service.
     */
    ApiIdempotencyStore.Created doCreate(AiCallingApiAuth.Principal p, NewCounsellor n) {
        String lock = ApiIdempotencyStore.hash("counsellor-email:" + n.email());
        if (!idempotency.tryLock(EMAIL_LOCK_SCOPE, lock)) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "request_in_progress",
                    "Another request is adding this email right now. Retry in 5 seconds.", null, 5);
        }
        try {
            return createLocked(p, n);
        } finally {
            try {
                idempotency.unlock(EMAIL_LOCK_SCOPE, lock);
            } catch (RuntimeException e) {
                log.warn("counsellor-api: could not release the email lock: {}", e.getMessage());
            }
        }
    }

    static final String EMAIL_LOCK_SCOPE = "global";

    private ApiIdempotencyStore.Created createLocked(AiCallingApiAuth.Principal p, NewCounsellor n) {
        String instituteId = p.instituteId();
        Optional<UserDTO> existing;
        try {
            existing = authService.findUserByEmailStrict(n.email());
        } catch (RuntimeException e) {
            log.warn("counsellor-api: email lookup failed: {}", e.getMessage());
            throw unavailable();
        }
        List<Map<String, String>> warnings = new ArrayList<>();
        String userId;
        boolean existingAccount = existing.isPresent() && blankToNull(existing.get().getId()) != null;
        boolean added = true;
        boolean emailSent = false;
        if (existingAccount) {
            UserDTO u = existing.get();
            userId = u.getId();
            Standing st = standing(instituteId, userId);
            if (st.liveCounsellorHere() && st.counsellorOnlyHere()) {
                added = false;
                warnings.add(warning("already_counsellor", "This email is already a counsellor of this account; nothing was changed."));
                // A retry of a create that died after the account was made but before its mobile
                // number was set: fill it in (only a missing one, only on an account of ours alone).
                if (n.mobile() != null && blankToNull(u.getMobileNumber()) == null && st.onlyThisInstitute()) {
                    setMobile(userId, u.isRootUser(), n.mobile(), warnings);
                }
            } else if (!st.here().isEmpty() && !st.counsellorOnlyHere()) {
                throw new AiCallingApiException(HttpStatus.CONFLICT, "account_has_other_role",
                        "This email belongs to a member of this account with another role (" + String.join(", ", st.rolesHere())
                                + "). The API only adds counsellors; give them the counsellor role in the dashboard.",
                        Map.of("counsellor_id", userId, "roles", st.rolesHere()));
            } else if (!st.here().isEmpty()) {
                throw new AiCallingApiException(HttpStatus.CONFLICT, "counsellor_inactive",
                        "This counsellor was deactivated. Reactivate them with PATCH /v1/counsellors/" + userId
                                + " and {\"active\": true}.", Map.of("counsellor_id", userId));
            } else if (!st.deletedHere() || !st.all().isEmpty()) {
                // The login exists but is not this institute's: attaching it would expose the
                // person's details (name, mobile) to this key and confirm the account. Only an
                // admin, in the dashboard, adds someone from outside.
                throw new AiCallingApiException(HttpStatus.CONFLICT, "email_in_use_elsewhere",
                        "This email already has a login on the platform that does not belong to this account. "
                                + "Use a different email, or ask an admin to add them from the dashboard.");
            } else {
                // A former member of THIS institute (only deleted rows here, no other membership).
                requireExtensionFree(instituteId, userId, n.extension());
                grantRole(instituteId, userId);
                if (n.mobile() != null && !sameNumber(n.mobile(), u.getMobileNumber())) {
                    warnings.add(warning("mobile_number_ignored", "This email already has an account; its mobile number "
                            + "was kept. Change it with PATCH when the account belongs to this account only."));
                }
                if (!n.name().equals(displayName(u, null))) {
                    warnings.add(warning("name_ignored", "This email already has an account; its name was kept."));
                }
            }
        } else {
            requireExtensionFree(instituteId, null, n.extension());
            UserDTO dto = new UserDTO();
            dto.setFullName(n.name());
            dto.setEmail(n.email());
            dto.setRoles(List.of(GRANTED_ROLE));
            dto.setRootUser(true);
            UserDTO created;
            try {
                created = authService.createUserFromAuthService(dto, instituteId, n.sendWelcome());
            } catch (RuntimeException e) {
                log.warn("counsellor-api: create failed for institute {}: {}", instituteId, e.getMessage());
                throw unavailable();
            }
            if (created == null || blankToNull(created.getId()) == null) throw unavailable();
            userId = created.getId();
            emailSent = n.sendWelcome();
            if (n.mobile() != null) setMobile(userId, created.isRootUser(), n.mobile(), warnings);
        }
        if (added) {
            Standing after = standing(instituteId, userId);
            if (!after.liveCounsellorHere()) {
                log.error("counsellor-api: COUNSELLOR role not present for {} in {} after grant", userId, instituteId);
                throw new AiCallingApiException(HttpStatus.INTERNAL_SERVER_ERROR, "role_unavailable",
                        "The counsellor role could not be granted in this account. Contact support with the request_id.");
            }
        }
        if (n.extension() != null && added) setExtension(instituteId, userId, n.extension());

        Map<String, Object> body = getCounsellor(p, userId);
        String provider = humanCalls.primaryProvider(instituteId);
        if (body.get("mobile_number") == null
                && (ProviderType.EXOTEL.equals(provider) || ProviderType.PLIVO.equals(provider))) {
            warnings.add(warning("mobile_number_missing", "This counsellor has no mobile number. Their phone rings "
                    + "first on a call, so add one before they can take calls."));
        }
        body.put("created", added);
        body.put("existing_account", existingAccount);
        body.put("welcome_email_sent", emailSent);
        body.put("warnings", warnings);
        if (added) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("email", n.email());
            payload.put("existing_account", existingAccount);
            payload.put("welcome_email_sent", emailSent);
            safeAudit(p, userId, "COUNSELLOR_ADD", "Counsellor added through the API", payload);
        }
        return new ApiIdempotencyStore.Created(userId, body, added);
    }

    private void grantRole(String instituteId, String userId) {
        try {
            authService.addRolesToUserStrict(userId, List.of(GRANTED_ROLE), instituteId);
        } catch (RuntimeException e) {
            log.warn("counsellor-api: role grant failed for {}: {}", userId, e.getMessage());
            throw unavailable();
        }
    }

    /** Stores the mobile as digits with the country code (what auth_service's create path stores). */
    private void setMobile(String userId, boolean rootUser, String e164, List<Map<String, String>> warnings) {
        String digits = e164.replaceAll("[^0-9]", "");
        Optional<UserDTO> holder = authService.getUserByMobile(digits);
        if (holder.isPresent() && holder.get().getId() != null && !holder.get().getId().equals(userId)) {
            warnings.add(warning("mobile_number_shared", "Another account on the platform already uses this mobile "
                    + "number. It was saved, but a login by mobile number OTP may pick either account."));
        }
        UserDTO patch = new UserDTO();
        patch.setMobileNumber(digits);
        patch.setRootUser(rootUser);
        try {
            authService.updateUser(patch, userId);
        } catch (RuntimeException e) {
            log.warn("counsellor-api: mobile update failed for {}: {}", userId, e.getMessage());
            warnings.add(warning("mobile_number_not_saved", "The mobile number could not be saved. Retry with PATCH."));
        }
    }

    // ── Update ───────────────────────────────────────────────────────────────────

    public Map<String, Object> patchCounsellor(AiCallingApiAuth.Principal p, String id, PatchInput in) {
        String instituteId = p.instituteId();
        String userId = requireId(id);
        if (in == null || (!in.nameSet() && !in.mobileSet() && !in.extensionSet() && in.active() == null)) {
            throw AiCallingApiException.invalid("Send at least one of name, mobile_number, airtel_extension, active.");
        }
        Standing st = requireManageable(instituteId, userId);
        List<Map<String, String>> errors = new ArrayList<>();
        String name = null;
        if (in.nameSet()) {
            name = blankToNull(in.name());
            if (name == null) errors.add(err("name", "name cannot be empty."));
            else if (name.length() > MAX_NAME) errors.add(err("name", "name is at most " + MAX_NAME + " characters."));
        }
        String mobile = null;
        if (in.mobileSet()) {
            if (blankToNull(in.mobileNumber()) == null) {
                errors.add(err("mobile_number", "mobile_number cannot be removed through the API; send a new number."));
            } else {
                mobile = AiCallingApiService.normalisePhone(in.mobileNumber());
                if (mobile == null) errors.add(err("mobile_number", "mobile_number must be in E.164 format, e.g. +919876543210."));
            }
        }
        String ext = in.extensionSet() ? blankToNull(in.airtelExtension()) : null;
        if (ext != null && !EXTENSION.matcher(ext).matches()) {
            errors.add(err("airtel_extension", "airtel_extension is 1-32 letters, digits, *, #, - or _."));
        }
        if (!errors.isEmpty()) throw AiCallingApiException.invalid(errors.get(0).get("message"), Map.of("errors", errors));
        if ((in.nameSet() || in.mobileSet()) && !st.onlyThisInstitute()) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "shared_account",
                    "This counsellor's account also belongs to another account on the platform. Their name and mobile "
                            + "number are their own login details there too, so only they can change them (in their "
                            + "profile). airtel_extension and active can still be changed.",
                    Map.of("counsellor_id", userId));
        }
        if (ext != null) requireExtensionFree(instituteId, userId, ext);

        List<Map<String, String>> warnings = new ArrayList<>();
        Map<String, Object> changes = new LinkedHashMap<>();
        if (name != null || mobile != null) {
            UserDTO current = user(userId).orElseThrow(() -> notFound(userId));
            UserDTO patch = new UserDTO();
            patch.setRootUser(current.isRootUser());
            if (name != null) {
                patch.setFullName(name);
                changes.put("name", name);
            }
            if (mobile != null) {
                String digits = mobile.replaceAll("[^0-9]", "");
                Optional<UserDTO> holder = authService.getUserByMobile(digits);
                if (holder.isPresent() && holder.get().getId() != null && !holder.get().getId().equals(userId)) {
                    warnings.add(warning("mobile_number_shared", "Another account on the platform already uses this "
                            + "mobile number. It was saved, but a login by mobile number OTP may pick either account."));
                }
                patch.setMobileNumber(digits);
                changes.put("mobile_number", mobile);
            }
            try {
                authService.updateUser(patch, userId);
            } catch (RuntimeException e) {
                log.warn("counsellor-api: profile update failed for {}: {}", userId, e.getMessage());
                throw unavailable();
            }
        }
        if (in.extensionSet()) {
            if (ext == null) removeExtension(instituteId, userId);
            else setExtension(instituteId, userId, ext);
            changes.put("airtel_extension", ext);
        }
        Map<String, Object> effects = null;
        if (in.active() != null) {
            effects = Boolean.TRUE.equals(in.active()) ? reactivate(instituteId, userId, st)
                    : deactivate(instituteId, userId, st);
            changes.put("active", in.active());
        }
        safeAudit(p, userId, "COUNSELLOR_UPDATE", "Counsellor updated through the API", changes);
        Map<String, Object> body = getCounsellor(p, userId);
        if (effects != null) body.put("effects", effects);
        body.put("warnings", warnings);
        return body;
    }

    // ── Deactivate / reactivate ──────────────────────────────────────────────────

    /** DELETE /v1/counsellors/{id}: deactivation, idempotent. */
    public Map<String, Object> deactivateCounsellor(AiCallingApiAuth.Principal p, String id) {
        String userId = requireId(id);
        Standing st = requireManageable(p.instituteId(), userId);
        Map<String, Object> effects = deactivate(p.instituteId(), userId, st);
        safeAudit(p, userId, "COUNSELLOR_DEACTIVATE", "Counsellor deactivated through the API", effects);
        Map<String, Object> body = getCounsellor(p, userId);
        body.put("effects", effects);
        return body;
    }

    Map<String, Object> deactivate(String instituteId, String userId, Standing st) {
        int roles;
        try {
            roles = authService.updateRoleStatusForRoles(instituteId, userId, st.counsellorRoleNamesHere(), "DISABLED");
        } catch (RuntimeException e) {
            log.warn("counsellor-api: disable failed for {}: {}", userId, e.getMessage());
            throw unavailable();
        }
        if (roles == 0 && st.liveCounsellorHere()) {
            // A live counsellor role that did not change: never half-apply (pools and IVR lists
            // would be stripped from someone who can still sign in and take calls).
            log.error("counsellor-api: disable changed no role row for {} in {} (roles {})", userId, instituteId,
                    st.rolesHere());
            throw new AiCallingApiException(HttpStatus.INTERNAL_SERVER_ERROR, "role_update_failed",
                    "The counsellor's role could not be disabled, so nothing was changed. Contact support with the request_id.");
        }
        int pools = jdbc.update("""
                UPDATE counselor_pool_member SET status = 'INACTIVE', updated_at = NOW()
                 WHERE counselor_user_id = :u AND status = 'ACTIVE'
                   AND pool_id IN (SELECT p.id FROM counselor_pool p WHERE p.institute_id = :i)
                """, new MapSqlParameterSource().addValue("u", userId).addValue("i", instituteId));
        List<Map<String, Object>> ivr = removeFromIvrDialLists(instituteId, userId);
        Map<String, Object> effects = new LinkedHashMap<>();
        effects.put("role_disabled", roles > 0);
        // Only this account's sign-in is cut (its cached identity is dropped); the person stays
        // signed in to any other account they belong to.
        effects.put("sessions_revoked", "this_account");
        effects.put("pool_memberships_deactivated", pools);
        effects.put("ivr_dial_steps_updated", ivr);
        effects.put("leads_reassigned", 0);
        return effects;
    }

    Map<String, Object> reactivate(String instituteId, String userId, Standing st) {
        int roles;
        try {
            roles = authService.updateRoleStatusForRoles(instituteId, userId, st.counsellorRoleNamesHere(), "ACTIVE");
        } catch (RuntimeException e) {
            log.warn("counsellor-api: enable failed for {}: {}", userId, e.getMessage());
            throw unavailable();
        }
        if (roles == 0 && st.pausedCounsellorHere()) {
            log.error("counsellor-api: enable changed no role row for {} in {}", userId, instituteId);
            throw new AiCallingApiException(HttpStatus.INTERNAL_SERVER_ERROR, "role_update_failed",
                    "The counsellor's role could not be restored. Contact support with the request_id.");
        }
        Map<String, Object> effects = new LinkedHashMap<>();
        effects.put("role_restored", roles > 0);
        effects.put("pool_memberships_restored", false);
        effects.put("ivr_dial_lists_restored", false);
        effects.put("note", "Lead pool memberships stay inactive and IVR ring lists are not refilled: "
                + "turn them back on in the dashboard where this counsellor should take leads and calls again.");
        return effects;
    }

    /**
     * Takes the user out of every "ring these people" list (ivr_node.dial_user_ids) of this
     * institute's IVR menus. Returns the steps changed; {@code no_one_left} flags a step that
     * now rings nobody (no other person and no fixed number).
     */
    List<Map<String, Object>> removeFromIvrDialLists(String instituteId, String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT n.id AS node_id, n.menu_id AS menu_id, m.name AS menu_name, n.label AS label,
                       n.dial_user_ids AS dial_user_ids, n.dial_targets AS dial_targets
                  FROM ivr_node n JOIN ivr_menu m ON m.id = n.menu_id
                 WHERE m.institute_id = :i AND n.dial_user_ids IS NOT NULL
                   AND POSITION(CAST(:u AS text) IN n.dial_user_ids) > 0
                """, new MapSqlParameterSource().addValue("i", instituteId).addValue("u", userId));
        List<Map<String, Object>> changed = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            List<String> ids = readList((String) r.get("dial_user_ids"));
            if (!ids.remove(userId)) continue;
            while (ids.remove(userId)) {
                // drop duplicates too
            }
            String json;
            try {
                json = mapper.writeValueAsString(ids);
            } catch (Exception e) {
                continue;
            }
            jdbc.update("""
                    UPDATE ivr_node SET dial_user_ids = :j, updated_at = NOW()
                     WHERE id = :n AND menu_id = :m
                    """, new MapSqlParameterSource().addValue("j", json).addValue("n", r.get("node_id"))
                    .addValue("m", r.get("menu_id")));
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("menu_id", r.get("menu_id"));
            m.put("menu_name", r.get("menu_name"));
            m.put("step_id", r.get("node_id"));
            m.put("step_label", r.get("label"));
            m.put("no_one_left", ids.isEmpty() && readList((String) r.get("dial_targets")).isEmpty());
            changed.add(m);
        }
        return changed;
    }

    // ── Airtel extension ─────────────────────────────────────────────────────────

    String extensionOf(String instituteId, String userId) {
        return endpoints.findByCounsellorUserIdAndProviderType(userId, ProviderType.AIRTEL)
                .filter(e -> instituteId.equals(e.getInstituteId()))
                .map(TelephonyCounsellorEndpoint::getExtension).orElse(null);
    }

    /** 409 when another user of the institute has the extension, or another institute owns the user's row. */
    void requireExtensionFree(String instituteId, String userId, String extension) {
        if (extension == null) return;
        String holder = TelephonyCounsellorEndpointController.extensionHolder(endpoints, instituteId,
                ProviderType.AIRTEL, extension, userId);
        if (holder != null) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("airtel_extension", extension);
            d.put("held_by", holder);
            throw new AiCallingApiException(HttpStatus.CONFLICT, "extension_taken",
                    "Airtel extension " + extension + " is already mapped to "
                            + TelephonyCounsellorEndpointController.describeUser(authService, holder)
                            + " in this account.", d);
        }
        if (userId != null) {
            endpoints.findByCounsellorUserIdAndProviderType(userId, ProviderType.AIRTEL)
                    .filter(e -> e.getInstituteId() != null && !instituteId.equals(e.getInstituteId()))
                    .ifPresent(e -> {
                        throw new AiCallingApiException(HttpStatus.CONFLICT, "extension_managed_elsewhere",
                                "This counsellor's Airtel extension is managed by another account on the platform.");
                    });
        }
    }

    void setExtension(String instituteId, String userId, String extension) {
        TelephonyCounsellorEndpoint row = endpoints.findByCounsellorUserIdAndProviderType(userId, ProviderType.AIRTEL)
                .orElseGet(() -> TelephonyCounsellorEndpoint.builder()
                        .instituteId(instituteId).counsellorUserId(userId).providerType(ProviderType.AIRTEL)
                        .enabled(true).build());
        if (row.getInstituteId() != null && !instituteId.equals(row.getInstituteId())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "extension_managed_elsewhere",
                    "This counsellor's Airtel extension is managed by another account on the platform.");
        }
        row.setExtension(extension);
        endpoints.save(row);
    }

    void removeExtension(String instituteId, String userId) {
        endpoints.findByCounsellorUserIdAndProviderType(userId, ProviderType.AIRTEL)
                .filter(e -> instituteId.equals(e.getInstituteId()))
                .ifPresent(endpoints::delete);
    }

    // ── Internals ────────────────────────────────────────────────────────────────

    Standing requireManageable(String instituteId, String userId) {
        Standing st = standing(instituteId, userId);
        if (st.here().isEmpty()) throw notFound(userId);
        if (!st.counsellorOnlyHere()) {
            throw new AiCallingApiException(HttpStatus.FORBIDDEN, "counsellor_not_manageable",
                    "This person is an admin or other staff of this account (" + String.join(", ", st.rolesHere())
                            + "). The API only changes counsellors; manage them in the dashboard.",
                    Map.of("counsellor_id", userId, "roles", st.rolesHere()));
        }
        return st;
    }

    Optional<UserDTO> user(String userId) {
        try {
            List<UserDTO> users = authService.getUsersFromAuthServiceByUserIds(List.of(userId));
            return users == null ? Optional.empty()
                    : users.stream().filter(u -> u != null && userId.equals(u.getId())).findFirst();
        } catch (RuntimeException e) {
            log.warn("counsellor-api: user lookup failed for {}: {}", userId, e.getMessage());
            throw unavailable();
        }
    }

    private void safeAudit(AiCallingApiAuth.Principal p, String userId, String action, String description,
                           Map<String, Object> payload) {
        try {
            audit.recordApi(p.instituteId(), p.keyId(), "COUNSELLOR", userId, action, description, payload, null);
        } catch (RuntimeException e) {
            log.warn("counsellor-api: audit write failed for {}: {}", userId, e.getMessage());
        }
    }

    private List<String> readList(String json) {
        if (json == null || json.isBlank()) return new ArrayList<>();
        try {
            List<String> l = mapper.readValue(json, new TypeReference<List<String>>() {
            });
            return l == null ? new ArrayList<>() : new ArrayList<>(l);
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }

    private static boolean sameNumber(String e164, String stored) {
        if (stored == null) return false;
        String a = e164.replaceAll("[^0-9]", "");
        String b = stored.replaceAll("[^0-9]", "");
        return a.equals(b) || (b.length() >= 10 && a.endsWith(b));
    }

    static String displayName(UserDTO u, String fallback) {
        if (u.getFullName() != null && !u.getFullName().isBlank()) return u.getFullName().trim();
        if (u.getEmail() != null && !u.getEmail().isBlank()) return u.getEmail().trim();
        if (u.getUsername() != null && !u.getUsername().isBlank()) return u.getUsername().trim();
        return fallback;
    }

    private static String requireId(String id) {
        String s = blankToNull(id);
        if (s == null) throw AiCallingApiException.invalid("A counsellor id is required.");
        return s;
    }

    static AiCallingApiException notFound(String id) {
        return new AiCallingApiException(HttpStatus.NOT_FOUND, "counsellor_not_found",
                "No counsellor " + id + " in this account. List them with GET /v1/counsellors.");
    }

    static AiCallingApiException unavailable() {
        return new AiCallingApiException(HttpStatus.SERVICE_UNAVAILABLE, "temporarily_unavailable",
                "Could not reach the account directory right now. Retry shortly.", null, 5);
    }

    static Map<String, String> warning(String code, String message) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("message", message);
        return m;
    }

    private static Map<String, String> err(String field, String message) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("field", field);
        m.put("message", message);
        return m;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
