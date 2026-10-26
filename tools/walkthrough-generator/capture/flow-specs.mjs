/**
 * flow-specs — step scripts for capture-flow.mjs. Each step yields ONE real frame.
 * A step's `clickText`/`openIcon` names the element the cursor points at on THAT
 * frame; after the frame is shot, that element is clicked to reach the next frame.
 * `final:true` = last frame, no click.
 *
 * Step fields:
 *   goto      navigate to this path first (full navigation)
 *   path      override the address-bar path shown for this frame
 *   caption   one short line (bold key nouns with <b>)
 *   clickText text of the element the cursor targets next
 *   openIcon  true → target the learners-list "open profile" icon
 *   rightmost / minX  disambiguate text matches to the right-hand slide-over
 *   settle/after  extra wait (ms) after goto / after the click
 *   final     last frame (no click)
 */

export const LEARNER_PROFILE_FLOW = {
    slug: 'learner-profile-view',
    title: 'View a learner’s full profile',
    steps: [
        // 1 — Dashboard (always start here), point at Manage Contacts
        { goto: '/dashboard', caption: 'Start on your <b>Dashboard</b>.', clickText: 'Manage Contacts', after: 900 },
        // 2 — Manage Contacts expanded → point at the Learners list entry
        { path: '/dashboard', caption: 'Open <b>Manage Contacts</b>.', clickText: 'Linked Course Contacts', after: 2200 },
        // 3 — Learners list → point at the first learner's open icon
        { path: '/manage-students/students-list', caption: 'This is your <b>Learners</b> list.', openIcon: true, after: 2000 },
        // 4 — Profile slide-over (Overview) → point at Courses tab
        { path: '/manage-students/students-list', caption: 'Open a learner to see their <b>profile</b>.', clickText: 'Courses', rightmost: true, minX: 850, after: 1400 },
        // 5 — Courses tab → point at Progress
        { path: '/manage-students/students-list', caption: 'See the courses they’re <b>enrolled</b> in.', clickText: 'Progress', rightmost: true, minX: 850, after: 1400 },
        // 6 — Progress tab → point at Tests
        { path: '/manage-students/students-list', caption: 'Track their <b>learning progress</b>.', clickText: 'Tests', rightmost: true, minX: 850, after: 1400 },
        // 7 — Tests tab → point at Payment History
        { path: '/manage-students/students-list', caption: 'Review their <b>test</b> results.', clickText: 'Payment History', rightmost: true, minX: 850, after: 1400 },
        // 8 — Payment History tab → final
        { path: '/manage-students/students-list', caption: 'And their <b>payment history</b> — all in one profile.', final: true },
    ],
};
