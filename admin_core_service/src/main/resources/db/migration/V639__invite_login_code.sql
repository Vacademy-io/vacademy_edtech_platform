-- Enroll invites reuse the product-page one-time login code ("log the buyer in
-- after purchase"). A code now belongs to a product page OR an enroll invite.
ALTER TABLE product_page_login_code ALTER COLUMN product_page_id DROP NOT NULL;
ALTER TABLE product_page_login_code ADD COLUMN IF NOT EXISTS enroll_invite_id VARCHAR(255);
