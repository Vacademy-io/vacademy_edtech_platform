import axios from "axios";
import { BASE_URL } from "@/constants/urls";

/**
 * Public reads of Access Passes for the catalogue `accessPassGrid` section. Only
 * ACTIVE (published) passes come back. A pass is bought through the existing
 * enroll-by-invite flow with its `invite_code` — see buildPassCheckoutUrl.
 */

const publicAxios = axios.create({ withCredentials: false });

const API_BASE = `${BASE_URL}/admin-core-service/open/v1/access-pass`;

export interface PublicAccessPassItem {
  package_session_id: string;
  package_id?: string;
  package_name?: string;
  level_name?: string;
  session_name?: string;
  thumbnail_file_id?: string;
  course_preview_image_media_id?: string;
}

export interface PublicAccessPassPrice {
  type?: string;
  min_price?: number;
  max_price?: number;
  currency?: string;
  min_validity_in_days?: number;
  plan_count?: number;
}

export interface PublicAccessPass {
  id: string;
  name: string;
  slug: string;
  short_description?: string;
  description?: string;
  cover_image_url?: string;
  tags?: string[];
  invite_code?: string;
  course_count?: number;
  price?: PublicAccessPassPrice;
  items?: PublicAccessPassItem[];
}

export const listPublicAccessPasses = async (
  instituteId: string,
  tag?: string,
): Promise<PublicAccessPass[]> =>
  (
    await publicAxios.get<PublicAccessPass[]>(`${API_BASE}/list`, {
      params: { instituteId, tag: tag?.trim() || undefined },
    })
  ).data;

export const getPublicAccessPassBySlug = async (
  instituteId: string,
  slug: string,
): Promise<PublicAccessPass> =>
  (
    await publicAxios.get<PublicAccessPass>(`${API_BASE}/by-slug`, {
      params: { instituteId, slug },
    })
  ).data;

/** Same entry MyMembershipWidget uses to send a learner into an invite's checkout. */
export const buildPassCheckoutUrl = (instituteId: string, inviteCode: string) =>
  `/learner-invitation-response?instituteId=${encodeURIComponent(
    instituteId,
  )}&inviteCode=${encodeURIComponent(inviteCode)}`;

export const formatPublicPassPrice = (
  price?: PublicAccessPassPrice,
  freeLabel = "Free",
): string | null => {
  if (!price) return null;
  if (price.type === "FREE" || price.min_price === 0) return freeLabel;
  if (price.min_price == null) return null;
  const fmt = (v: number) => {
    if (!price.currency) return String(v);
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: price.currency,
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return `${price.currency} ${v}`;
    }
  };
  return price.max_price != null && price.max_price !== price.min_price
    ? `${fmt(price.min_price)} – ${fmt(price.max_price)}`
    : fmt(price.min_price);
};
