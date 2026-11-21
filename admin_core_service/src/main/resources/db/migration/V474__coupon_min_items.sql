-- Quantity condition for a coupon: the smallest basket it may be used on.
--
-- NULL means no condition, which is every coupon that exists today — so this is
-- inert until an admin sets it.
ALTER TABLE coupon_code ADD COLUMN IF NOT EXISTS min_items INTEGER;

COMMENT ON COLUMN coupon_code.min_items IS
    'Minimum number of courses in the basket for this coupon to apply. NULL = no minimum.';
