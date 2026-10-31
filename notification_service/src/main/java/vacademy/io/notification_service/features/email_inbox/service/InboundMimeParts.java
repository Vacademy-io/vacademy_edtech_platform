package vacademy.io.notification_service.features.email_inbox.service;

import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.internet.ContentType;
import jakarta.mail.internet.MimeUtility;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.BiPredicate;

/**
 * Pure MIME helpers shared by ingest (index an inbound email's parts) and the inbox (serve one
 * part, render the HTML body). A part id is the 1-based child position at each multipart level
 * joined by dots ("2", "2.1"; a single-part message is "1"), so the same raw .eml always yields
 * the same ids — the index written at ingest stays valid when the part is served later.
 */
public final class InboundMimeParts {

    /** One file a person attached (or an inline image the HTML body references by cid). */
    public record Attachment(String id, String filename, String contentType, long size,
                             boolean inline, String contentId) {}

    /** Diagnostic parts a mail system adds to bounces — not files anyone attached. */
    private static final Set<String> DSN_TYPES = Set.of(
            "message/delivery-status", "text/rfc822-headers",
            "message/disposition-notification", "message/feedback-report");

    /** In a bounce, the returned copy of the original message (full or headers only). */
    private static final Set<String> RETURNED_MESSAGE_TYPES = Set.of("message/rfc822", "text/rfc822-headers");

    private static final Map<String, String> EXTENSIONS = Map.of(
            "application/pdf", ".pdf",
            "image/png", ".png",
            "image/jpeg", ".jpg",
            "image/gif", ".gif",
            "image/webp", ".webp",
            "text/calendar", ".ics",
            "message/rfc822", ".eml");

    private static final int MAX_FILENAME = 200;

    private InboundMimeParts() {}

    /** Every attachment in document order. Never throws; an unreadable part is skipped. */
    public static List<Attachment> listAttachments(Part root) {
        List<Attachment> out = new ArrayList<>();
        boolean bounce = isReport(root);
        walk(root, "", (part, id) -> {
            // A bounce (multipart/report) returns a copy of OUR email as message/rfc822 — not a
            // file anyone sent us. A person forwarding an email as an attachment still counts.
            if (bounce && RETURNED_MESSAGE_TYPES.contains(baseType(part))) return false;
            Attachment a = toAttachment(part, id, out.size() + 1);
            if (a != null) out.add(a);
            return false;
        });
        return out;
    }

    /** message_payload key holding the attachment index; its presence means "indexed". */
    public static final String ATTACHMENTS_KEY = "attachments";
    public static final String HAS_HTML_KEY = "hasHtml";
    public static final String S3_BUCKET_KEY = "s3Bucket";
    public static final String S3_KEY_KEY = "s3Key";

    /**
     * The fields an inbound row's message_payload carries about its raw email: the attachment
     * index (the inbox lists it without touching S3) and whether an HTML body exists.
     */
    public static Map<String, Object> indexFields(Part root) {
        List<Map<String, Object>> attachments = new ArrayList<>();
        for (Attachment a : listAttachments(root)) {
            Map<String, Object> m = new java.util.LinkedHashMap<>();
            m.put("id", a.id());
            m.put("filename", a.filename());
            m.put("contentType", a.contentType());
            m.put("size", a.size());
            m.put("inline", a.inline());
            if (a.contentId() != null) m.put("contentId", a.contentId());
            attachments.add(m);
        }
        Map<String, Object> fields = new java.util.LinkedHashMap<>();
        fields.put(ATTACHMENTS_KEY, attachments);
        fields.put(HAS_HTML_KEY, hasHtmlBody(root));
        return fields;
    }

    /** The leaf part with this id, if any. */
    public static Optional<Part> findPart(Part root, String id) {
        if (id == null || id.isBlank()) return Optional.empty();
        Part[] found = new Part[1];
        walk(root, "", (part, partId) -> {
            if (id.equals(partId)) {
                found[0] = part;
                return true;
            }
            return false;
        });
        return Optional.ofNullable(found[0]);
    }

    /** The first text/html body part that is not itself an attachment, decoded to a String. */
    public static Optional<String> htmlBody(Part root) {
        String[] html = new String[1];
        walk(root, "", (part, id) -> {
            try {
                if (part.isMimeType("text/html") && !isAttachmentPart(part)) {
                    Object content = part.getContent();
                    if (content instanceof String s) {
                        html[0] = s;
                        return true;
                    }
                }
            } catch (Exception ignored) {
                // An undecodable part is not the body; keep looking.
            }
            return false;
        });
        return Optional.ofNullable(html[0]);
    }

    /** True when the message has an HTML body worth rendering. */
    public static boolean hasHtmlBody(Part root) {
        return htmlBody(root).isPresent();
    }

    /** Content-ID without the angle brackets, or null. */
    public static String contentId(Part part) {
        try {
            String[] values = part.getHeader("Content-ID");
            if (values == null || values.length == 0 || values[0] == null) return null;
            String v = values[0].trim();
            if (v.startsWith("<") && v.endsWith(">")) v = v.substring(1, v.length() - 1);
            return v.isBlank() ? null : v;
        } catch (Exception e) {
            return null;
        }
    }

    /** Lower-case base type ("application/pdf"), falling back to application/octet-stream. */
    public static String baseType(Part part) {
        try {
            String raw = part.getContentType();
            if (raw == null) return "application/octet-stream";
            return new ContentType(raw).getBaseType().toLowerCase(Locale.ROOT);
        } catch (Exception e) {
            return "application/octet-stream";
        }
    }

    /** Decoded file name, path-free and length-capped, or null when the part names none. */
    public static String filename(Part part) {
        try {
            String raw = part.getFileName();
            if (raw == null || raw.isBlank()) return null;
            String decoded = MimeUtility.decodeText(raw);
            return sanitizeFilename(decoded);
        } catch (Exception e) {
            return null;
        }
    }

    static String sanitizeFilename(String name) {
        if (name == null) return null;
        String s = name.replace('\\', '/');
        int slash = s.lastIndexOf('/');
        if (slash >= 0) s = s.substring(slash + 1);
        s = s.replaceAll("[\\p{Cntrl}]", "").trim();
        if (s.isEmpty() || s.equals(".") || s.equals("..")) return null;
        return s.length() > MAX_FILENAME ? s.substring(s.length() - MAX_FILENAME) : s;
    }

    /** Decoded byte count of a part (streams it; no buffering). -1 when unreadable. */
    public static long decodedSize(Part part) {
        try (InputStream in = part.getInputStream()) {
            long total = 0;
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) total += n;
            return total;
        } catch (Exception e) {
            return -1;
        }
    }

    public static byte[] readBytes(Part part) throws IOException {
        try (InputStream in = part.getInputStream()) {
            return in.readAllBytes();
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("Could not read MIME part", e);
        }
    }

    // ── internals ────────────────────────────────────────────────────────────

    private static Attachment toAttachment(Part part, String id, int ordinal) {
        if (!isAttachmentPart(part)) return null;
        String type = baseType(part);
        String name = filename(part);
        if (name == null && type.equals("message/rfc822")) name = forwardedMessageName(part);
        if (name == null) name = "attachment-" + ordinal + EXTENSIONS.getOrDefault(type, "");
        String cid = contentId(part);
        boolean inline = cid != null && !Part.ATTACHMENT.equalsIgnoreCase(disposition(part));
        return new Attachment(id, name, type, decodedSize(part), inline, cid);
    }

    /** "<subject>.eml" for a forwarded email, or null. */
    private static String forwardedMessageName(Part part) {
        try {
            if (part.getContent() instanceof jakarta.mail.Message inner) {
                String subject = inner.getSubject();
                if (subject != null && !subject.isBlank()) {
                    String safe = sanitizeFilename(subject.replace('/', '-').replace('\\', '-'));
                    if (safe != null) {
                        return (safe.length() > MAX_FILENAME - 4 ? safe.substring(0, MAX_FILENAME - 4) : safe) + ".eml";
                    }
                }
            }
        } catch (Exception ignored) {
            // Unparseable forwarded message: the generic name is used.
        }
        return null;
    }

    private static boolean isReport(Part root) {
        try {
            return root.isMimeType("multipart/report");
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * A leaf is an attachment when it says so (disposition / file name), or when it is anything
     * other than the text/plain or text/html body (an inline image, a forwarded message, a
     * calendar invite). Bounce diagnostics are never attachments.
     */
    static boolean isAttachmentPart(Part part) {
        String type = baseType(part);
        if (DSN_TYPES.contains(type)) return false;
        if (Part.ATTACHMENT.equalsIgnoreCase(disposition(part))) return true;
        if (filename(part) != null) return true;
        return !type.equals("text/plain") && !type.equals("text/html");
    }

    private static String disposition(Part part) {
        try {
            return part.getDisposition();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Depth-first over leaves. The visitor returns true to stop. multipart/* is descended;
     * everything else (message/rfc822 included — a forwarded email is one file) is a leaf.
     */
    private static boolean walk(Part part, String id, BiPredicate<Part, String> visitor) {
        try {
            if (part.isMimeType("multipart/*")) {
                Object content = part.getContent();
                if (content instanceof Multipart mp) {
                    for (int i = 0; i < mp.getCount(); i++) {
                        String childId = id.isEmpty() ? String.valueOf(i + 1) : id + "." + (i + 1);
                        if (walk(mp.getBodyPart(i), childId, visitor)) return true;
                    }
                }
                return false;
            }
        } catch (Exception e) {
            return false;
        }
        return visitor.test(part, id.isEmpty() ? "1" : id);
    }
}
