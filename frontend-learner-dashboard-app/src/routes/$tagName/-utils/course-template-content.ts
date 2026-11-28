/**
 * Markup for the structured `{{course.*}}` tokens of an HTML course template.
 *
 * The admin fills plain text, lists and images in Add / Edit Course → Course page →
 * "Page template content" (stored in course_page_json.template), plus the FAQs and the
 * course's authors. A template cannot loop, so the cards / reviews / FAQs / instructors
 * are rendered here into fixed markup the template's CSS styles:
 *
 *   framework_html            p.tc-eyebrow, h2, p…, div.tc-framework-grid >
 *                               article.tc-framework-card (div.tc-card-heading > span.tc-card-number +
 *                               div (h3, p.tc-card-subtitle); p, h4, ul, p.tc-card-takeaway)
 *   learning_experience_html  p.tc-eyebrow, h2, p…, div.tc-learning-grid >
 *                               article.tc-learning-card (span.tc-learning-label, h3, p),
 *                               div.tc-callout (p.tc-eyebrow, h3, rich text)
 *   testimonials_html         blockquote.tc-testimonial (div.tc-stars, p.tc-testimonial-quote, cite > span, p…)
 *   instructors_html          article.tc-instructor (div.tc-instructor-profile: img, p.tc-eyebrow, h3,
 *                               p.tc-instructor-signature; div.tc-instructor-details:
 *                               p.tc-instructor-role, div.tc-instructor-bio)
 *   inclusions_html           h3, ul
 *   faqs_html                 div.tc-faq-item (h3, div.tc-faq-answer)
 *
 * `labels` are the template's own words (headings, button text) the admin types per course;
 * each becomes `{{course.label_<key>}}`.
 *
 * Plain text is escaped; rich text (FAQ answers, author bios, callout, enrolment
 * description) is the admin's editor HTML and goes through the page sanitiser with the
 * rest of the page. A section with nothing to show renders '' so `{{#course.x}}` hides it.
 */

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Editor HTML with no visible text (TipTap's empty value is `<p></p>`). */
const blankHtml = (html: string): boolean =>
  !/<img\b/i.test(html) && html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").trim().length === 0;
const richOrEmpty = (v: unknown): string => {
  const html = str(v);
  return html && !blankHtml(html) ? html : "";
};

/** Plain text → paragraphs: a blank line starts a new one, a single newline is a line break. */
const paragraphs = (text: string, cls?: string): string =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${cls ? ` class="${cls}"` : ""}>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

const ul = (items: string[]): string => (items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : "");

export interface CourseTemplateContent {
  tagline: string;
  shortDescription: string;
  frameworkHtml: string;
  learningExperienceHtml: string;
  testimonialsHtml: string;
  enrolmentDescription: string;
  /** media-service id (or URL) — resolved by the host like the other image tokens. */
  enrolmentImage: string;
  /** Optional main image for the template only; empty falls back to the course image. */
  heroImage: string;
  /** Optional About image for the template only; empty falls back to the course banner. */
  aboutImage: string;
  inclusionsHtml: string;
  /** Label key → text, e.g. { about: "About the course" } → {{course.label_about}}. */
  labels: Record<string, string>;
}

const EMPTY: CourseTemplateContent = {
  tagline: "",
  shortDescription: "",
  frameworkHtml: "",
  learningExperienceHtml: "",
  testimonialsHtml: "",
  enrolmentDescription: "",
  enrolmentImage: "",
  heroImage: "",
  aboutImage: "",
  inclusionsHtml: "",
  labels: {},
};

const readJson = (raw: unknown): Record<string, unknown> | null => {
  if (isObject(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const eyebrow = (text: string): string => (text ? `<p class="tc-eyebrow">${esc(text)}</p>` : "");

const renderFramework = (fw: Record<string, unknown>, labels: Record<string, string>): string => {
  const cards = list(fw.cards)
    .map((c, i) => {
      const title = str(c.title);
      const subtitle = str(c.subtitle);
      const body = str(c.body);
      const points = strings(c.points);
      const takeaway = str(c.takeaway);
      if (!title && !subtitle && !body && !points.length && !takeaway) return "";
      const pointsHeading = points.length ? labels.points_heading : "";
      const takeawayLabel = labels.takeaway;
      return (
        `<article class="tc-framework-card"><div class="tc-card-heading">` +
        `<span class="tc-card-number">${String(i + 1).padStart(2, "0")}</span><div>` +
        (title ? `<h3>${esc(title)}</h3>` : "") +
        (subtitle ? `<p class="tc-card-subtitle">${esc(subtitle)}</p>` : "") +
        `</div></div>` +
        paragraphs(body) +
        (pointsHeading ? `<h4>${esc(pointsHeading)}</h4>` : "") +
        ul(points) +
        (takeaway
          ? `<p class="tc-card-takeaway">${takeawayLabel ? `<strong>${esc(takeawayLabel)}</strong> ` : ""}${esc(takeaway)}</p>`
          : "") +
        `</article>`
      );
    })
    .filter(Boolean);
  const intro = paragraphs(str(fw.intro));
  if (!cards.length && !intro) return "";
  const heading = str(fw.heading);
  return (
    eyebrow(str(fw.eyebrow)) +
    (heading ? `<h2>${esc(heading)}</h2>` : "") +
    intro +
    (cards.length ? `<div class="tc-framework-grid">${cards.join("")}</div>` : "")
  );
};

const renderLearning = (le: Record<string, unknown>): string => {
  const cards = list(le.cards)
    .map((c) => {
      const label = str(c.label);
      const title = str(c.title);
      const body = str(c.body);
      if (!label && !title && !body) return "";
      return (
        `<article class="tc-learning-card">` +
        (label ? `<span class="tc-learning-label">${esc(label)}</span>` : "") +
        (title ? `<h3>${esc(title)}</h3>` : "") +
        paragraphs(body) +
        `</article>`
      );
    })
    .filter(Boolean);
  const intro = paragraphs(str(le.intro));
  const callout = richOrEmpty(le.callout);
  const calloutEyebrow = str(le.callout_eyebrow);
  const calloutHeading = str(le.callout_heading);
  const hasCallout = !!(callout || calloutEyebrow || calloutHeading);
  if (!cards.length && !intro && !hasCallout) return "";
  const heading = str(le.heading);
  return (
    eyebrow(str(le.eyebrow)) +
    (heading ? `<h2>${esc(heading)}</h2>` : "") +
    intro +
    (cards.length ? `<div class="tc-learning-grid">${cards.join("")}</div>` : "") +
    (hasCallout
      ? `<div class="tc-callout">${eyebrow(calloutEyebrow)}${calloutHeading ? `<h3>${esc(calloutHeading)}</h3>` : ""}${callout}</div>`
      : "")
  );
};

/** Stored as a number or numeric text; anything outside 1 to 5 shows no stars. */
const renderStars = (raw: unknown): string => {
  const stars = Number(raw);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return "";
  return `<div class="tc-stars" aria-label="${stars}/5">${"★".repeat(stars)}</div>`;
};

const renderTestimonials = (items: unknown): string =>
  list(items)
    .map((r) => {
      const quote = str(r.quote);
      const name = str(r.name);
      if (!quote || !name) return "";
      const details = str(r.details);
      return (
        `<blockquote class="tc-testimonial">` +
        renderStars(r.stars) +
        `<p class="tc-testimonial-quote">${esc(quote)}</p>` +
        `<cite>${esc(name)}${details ? `<span>${esc(details)}</span>` : ""}</cite>` +
        paragraphs(str(r.review)) +
        `</blockquote>`
      );
    })
    .join("");

// Starts with a letter: token names only, never `__proto__` and the like.
const LABEL_KEY_RE = /^[a-z][a-z_]{0,39}$/;
const LABEL_MAX_LENGTH = 120;

const readLabels = (raw: unknown): Record<string, string> => {
  if (!isObject(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const text = str(value).slice(0, LABEL_MAX_LENGTH);
    if (LABEL_KEY_RE.test(key) && text) out[key] = text;
  }
  return out;
};

const renderInclusions = (inc: Record<string, unknown>): string => {
  const items = strings(inc.items);
  if (!items.length) return "";
  const heading = str(inc.heading);
  return `${heading ? `<h3>${esc(heading)}</h3>` : ""}${ul(items)}`;
};

/** course_page_json → the template tokens' values. Malformed input reads as empty. */
export const courseTemplateContent = (coursePageJson: unknown): CourseTemplateContent => {
  const data = readJson(coursePageJson);
  const t = data && isObject(data.template) ? data.template : null;
  if (!t) return EMPTY;
  const enrolment = isObject(t.enrolment) ? t.enrolment : {};
  const labels = readLabels(t.labels);
  return {
    tagline: str(t.tagline),
    shortDescription: str(t.short_description),
    frameworkHtml: renderFramework(isObject(t.framework) ? t.framework : {}, labels),
    learningExperienceHtml: renderLearning(isObject(t.learning_experience) ? t.learning_experience : {}),
    testimonialsHtml: renderTestimonials(t.testimonials),
    enrolmentDescription: richOrEmpty(enrolment.description),
    enrolmentImage: str(enrolment.image_id),
    heroImage: str(t.hero_image_id),
    aboutImage: str(t.about_image_id),
    inclusionsHtml: renderInclusions(isObject(t.inclusions) ? t.inclusions : {}),
    labels,
  };
};

/** FAQs from course_page_json (admin "Course page" → FAQs). */
export const renderFaqsHtml = (coursePageJson: unknown): string => {
  const data = readJson(coursePageJson);
  return list(data?.faqs)
    .map((f) => {
      const q = str(f.q);
      const a = richOrEmpty(f.a);
      if (!q || !a) return "";
      return `<div class="tc-faq-item"><h3>${esc(q)}</h3><div class="tc-faq-answer">${a}</div></div>`;
    })
    .join("");
};

/** One author as the course page has them (see course-authors.ts). */
export interface TemplateInstructor {
  name: string;
  subtitle?: string;
  role?: string;
  /** Rich text from the author profile. */
  description?: string;
  profilePicId?: string;
}

/**
 * Authors → instructor cards. `photos` maps a profile-pic id to its resolved URL.
 * The signature names one person, so it shows only when the course has one instructor.
 */
export const renderInstructorsHtml = (
  instructors: ReadonlyArray<TemplateInstructor> | null | undefined,
  photos: Record<string, string> = {},
  words: { eyebrow?: string; signature?: string } = {},
): string => {
  const named = (instructors ?? []).filter((inst) => str(inst.name));
  const signature = named.length === 1 ? str(words.signature) : "";
  return named
    .map((inst) => {
      const name = str(inst.name);
      const photo = inst.profilePicId ? photos[inst.profilePicId] || "" : "";
      const role = str(inst.subtitle) || str(inst.role);
      const bio = richOrEmpty(inst.description);
      return (
        `<article class="tc-instructor"><div class="tc-instructor-profile">` +
        (photo ? `<img src="${esc(photo)}" alt="${esc(name)}" loading="lazy">` : "") +
        eyebrow(str(words.eyebrow)) +
        `<h3>${esc(name)}</h3>` +
        (signature ? `<p class="tc-instructor-signature">${esc(signature)}</p>` : "") +
        `</div>` +
        (role || bio
          ? `<div class="tc-instructor-details">` +
            (role ? `<p class="tc-instructor-role">${esc(role)}</p>` : "") +
            (bio ? `<div class="tc-instructor-bio">${bio}</div>` : "") +
            `</div>`
          : "") +
        `</article>`
      );
    })
    .join("");
};

/** True when the markup lists instructors ({{course.instructors_html}}). */
export const usesInstructorsToken = (html: string): boolean => /\{\{\s*course\.instructors_html\s*\}\}/.test(html);

/** Profile-pic ids the instructor cards need resolved (only when the markup uses them). */
export const instructorPhotoIds = (
  html: string,
  instructors: ReadonlyArray<TemplateInstructor> | null | undefined,
): string[] =>
  usesInstructorsToken(html)
    ? [...new Set((instructors ?? []).map((i) => i.profilePicId || "").filter(Boolean))]
    : [];
