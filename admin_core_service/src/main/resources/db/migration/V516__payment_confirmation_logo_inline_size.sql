-- Payment-confirmation email: size the institute logo ON the <img>, and drop the one external
-- image URL the template depended on.
--
-- 1. Logo. The seeded DEFAULT template (V422) constrains the logo solely through a stylesheet
--    rule (`.logo-container img { max-width: 140px; }`). Many mail clients drop or ignore <head>
--    styles — Gmail's apps for non-Google accounts, Outlook, some webmail — and then render the
--    logo at its natural size. Institute logos are uploaded at print resolution (one live logo is
--    2160 x 2160), so the "small logo above the receipt" became a full-width banner. A width
--    attribute plus an inline style is honoured everywhere the stylesheet is not. The rendered
--    size also drops from 140px to 120px: at 140 a square emblem out-scaled the headline above it.
--
-- 2. Success mark. The green tick in the header was an <img> pointing at a Google image-cache
--    thumbnail (encrypted-tbn0.gstatic.com) — a URL nobody controls, that can vanish, and that
--    was the only hard-coded external address in an otherwise institute-driven mail. It becomes an
--    inline-styled check glyph tinted with the institute's own theme colour, so the mail carries
--    no fixed URLs at all.
--
-- Idempotent: each replace() is a no-op once its markup is gone, and the WHERE guard keeps this
-- from touching any institute's own override template.
UPDATE templates
SET content = replace(
        replace(
            replace(
                replace(
                    content,
                    '<img src="{{institute_logo_url}}" alt="{{institute_name}} Logo">',
                    '<img src="{{institute_logo_url}}" alt="{{institute_name}} Logo" width="120" style="display: block; margin: 0 auto; width: 120px; height: auto;">'
                ),
                '.logo-container img { max-width: 140px; }',
                '.logo-container img { max-width: 120px; height: auto; }'
            ),
            '<img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRbi1i-616xg-52ZV-8D5_B5pSg2IYd_Y1K-g&s" alt="Success" class="success-icon">',
            '<div style="display: inline-block; width: 64px; height: 64px; line-height: 64px; border-radius: 32px; background: #ffffff; color: {{theme_color}}; font-size: 36px; font-weight: 700; text-align: center; margin-bottom: 15px;">&#10003;</div>'
        ),
        '        .header img.success-icon { width: 64px; height: 64px; margin-bottom: 15px; }' || chr(10),
        ''
    ),
    updated_at = now()
WHERE id = 'default-payment-confirmation-email'
  AND institute_id = 'DEFAULT'
  AND (
        content LIKE '%<img src="{{institute_logo_url}}" alt="{{institute_name}} Logo">%'
     OR content LIKE '%encrypted-tbn0.gstatic.com%'
  );
