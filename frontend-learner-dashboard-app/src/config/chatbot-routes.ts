/**
 * Page categories mapped to route patterns.
 * Each category has route prefixes that match learner app routes.
 */
const PAGE_CATEGORY_ROUTES: Record<string, string[]> = {
  // The daily-tasks page is part of the learner's home: the tutor helps
  // there ("Why was I wrong?" after a reveal, the Buddy line).
  dashboard: ['/dashboard', '/engagement'],
  all_courses: ['/study-library'],
  course_details: ['/study-library/courses'],
  study_material: ['/study-library/courses/course-details'],
  catalogue: ['/$tagName', '/catalogue'],
};

// Always hide on these routes regardless of settings
const ALWAYS_HIDDEN_ROUTES = [
  '/login', '/signup', '/register', '/privacy-policy',
  '/terms-and-conditions', '/referral', '/institute-selection',
  '/delete-user', '/change-password', '/logout',
  '/learner-invitation-response', '/payment-result', '/audience-response',
  '/live-class-guest',
  // The Site Assistant's own iframe on an institute's website.
  '/site-assistant-embed',
  // Assessment brief → preview → live test. An AI assistant floating over a
  // proctored paper is an integrity problem, and its launcher sits exactly
  // where the exam's own bottom-right controls are. The catalogue fallback
  // below would otherwise match '/assessment' for institutes that enable the
  // catalogue page category.
  '/assessment',
];

// Active enabled page categories (set from admin settings)
let activePages: string[] = ['dashboard', 'all_courses', 'course_details', 'study_material'];

/**
 * Update enabled page categories from admin settings.
 */
export function setChatbotPages(pages: string[]): void {
  activePages = pages.length > 0 ? pages : ['dashboard', 'all_courses', 'course_details', 'study_material'];
}

/**
 * Check if chatbot should be visible on the given route.
 */
export function isChatbotVisibleOnRoute(pathname: string): boolean {
  // 1. Always hide on auth/system routes
  if (ALWAYS_HIDDEN_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))) {
    return false;
  }

  // 2. Check if any enabled page category matches this route
  for (const pageKey of activePages) {
    const routes = PAGE_CATEGORY_ROUTES[pageKey];
    if (!routes) continue;

    for (const route of routes) {
      // Handle dynamic route segments (e.g., /$tagName)
      if (route.startsWith('/$')) {
        // Catalogue pages: any top-level dynamic route that's not a known system route
        // Match pattern: /something where 'something' is not a known route prefix
        const firstSegment = '/' + pathname.split('/').filter(Boolean)[0];
        if (firstSegment && !ALWAYS_HIDDEN_ROUTES.includes(firstSegment) &&
            !Object.values(PAGE_CATEGORY_ROUTES).flat().some(r => !r.startsWith('/$') && firstSegment.startsWith(r))) {
          return true;
        }
      } else if (pathname === route || pathname.startsWith(route + '/') || pathname.startsWith(route + '?')) {
        return true;
      }
    }
  }

  // 3. Home page ("/") — hide by default
  if (pathname === '/') return false;

  // 4. Default: hide (only show on explicitly enabled categories)
  return false;
}

// Keep old exports for backwards compatibility
export const CHATBOT_DISABLED_ROUTES = ALWAYS_HIDDEN_ROUTES;
export const CHATBOT_ENABLED_ROUTES: string[] = [];
