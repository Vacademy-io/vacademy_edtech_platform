-- Products sold under their own name on this platform (institutes.product points here).
-- Who their mail comes from, their trial and whether self sign-up is open are edited from the
-- super-admin portal, not deployed. An institute whose product has no row behaves as before.
CREATE TABLE IF NOT EXISTS public.platform_product (
    product_key          varchar(32)  PRIMARY KEY,
    display_name         varchar(100) NOT NULL,
    from_email           varchar(255) NOT NULL,
    from_name            varchar(100) NOT NULL,
    website_url          varchar(255) NULL,
    contact_email        varchar(255) NULL,
    theme_color          varchar(16)  NULL,
    logo_url             varchar(512) NULL,
    app_path             varchar(100) NOT NULL DEFAULT '/',
    login_url            varchar(255) NULL,
    trial_days           integer      NOT NULL DEFAULT 3,
    self_signup_enabled  boolean      NOT NULL DEFAULT false,
    return_hosts         text         NULL,
    updated_by           varchar(255) NULL,
    created_at           timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_product_trial_days_check CHECK (trial_days BETWEEN 0 AND 365)
);

INSERT INTO public.platform_product
    (product_key, display_name, from_email, from_name, website_url, contact_email, theme_color,
     logo_url, app_path, trial_days, self_signup_enabled, return_hosts)
VALUES
    ('evalezy', 'Evalezy', 'hello@evalezy.com', 'Evalezy', 'https://evalezy.com', 'hello@evalezy.com', '#D61C28',
     '/evalezy-logo.svg', '/evalezy', 3, true, 'vacademy.io,evalezy.com')
ON CONFLICT (product_key) DO NOTHING;
