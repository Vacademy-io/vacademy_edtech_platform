import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { BASE_URL } from '@/constants/urls';
import { getPublicUrl } from '@/services/upload_file';
import {
  buildTutorialGuideHtml,
  type TutorialGuideBranding,
} from './guide-html';
import { saveFile } from '@/lib/download/save-file';

const RENDER_PDF_URL = `${BASE_URL}/admin-core-service/institute/v1/tutorial-guide/render-pdf`;

async function resolveBranding(): Promise<TutorialGuideBranding> {
  let instituteName = 'Your Institute';
  let logoUrl: string | null = null;

  try {
    const { Preferences } = await import('@capacitor/preferences');
    const stored = await Preferences.get({ key: 'InstituteDetails' });
    const institute = stored.value ? JSON.parse(stored.value) : null;
    if (institute?.institute_name) instituteName = institute.institute_name;
    if (institute?.institute_logo_file_id) {
      logoUrl = await getPublicUrl(institute.institute_logo_file_id);
    }
  } catch (error) {
    console.warn('Tutorial guide: could not resolve institute branding', error);
  }

  // The institute's theme is applied as CSS variables at runtime — read the
  // live primary token so the PDF matches the app's branding color. Must be
  // converted to hex: openhtmltopdf (the PDF renderer) does not parse hsl().
  let accentColor: string | null = null;
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--primary-500')
      .trim();
    if (raw) accentColor = hslTripletToHex(raw);
  } catch {
    // fall back to the builder's default accent
  }

  return { instituteName, logoUrl, accentColor };
}

// Converts a shadcn-style HSL triplet ("24 85% 54%" or "24, 85%, 54%") to hex.
function hslTripletToHex(raw: string): string | null {
  const parts = raw.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  const h = parseFloat(parts[0]!);
  const s = parseFloat(parts[1]!) / 100;
  const l = parseFloat(parts[2]!) / 100;
  if ([h, s, l].some((n) => Number.isNaN(n))) return null;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`;
}

/**
 * Compose the institute-branded how-to guide (chapters = the tutorial
 * checkpoints enabled by the institute), render it to PDF on the backend,
 * and hand the file to the browser as a download.
 */
export async function downloadTutorialGuidePdf(
  enabledTours: string[]
): Promise<void> {
  const branding = await resolveBranding();
  const html = buildTutorialGuideHtml(enabledTours, branding);
  const fileName = `${branding.instituteName.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-learner-app-guide.pdf`;

  const response = await authenticatedAxiosInstance.post(
    RENDER_PDF_URL,
    { html, file_name: fileName },
    { responseType: 'blob' }
  );

  const blob = new Blob([response.data], { type: 'application/pdf' });
  await saveFile(blob, fileName);
}
