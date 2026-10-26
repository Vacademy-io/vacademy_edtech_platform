/**
 * authored — hand-authored, end-to-end flow specs run by engine.mjs.
 * Each flow performs the COMPLETE real task (navigate → click → fill → every step
 * → submit → result). Shared screens (e.g. 'dashboard') are captured once via the
 * engine's screen cache and reused across flows.
 *
 * Run:  node capture/authored.mjs                 # all authored flows
 *       node capture/authored.mjs --slugs=a,b     # specific flows
 */
import { runFlows } from './engine.mjs';

// reusable dashboard opener: frame 1 of every flow (cached image, per-flow cursor)
const fromDashboard = (railText, navCaption) => ({
    goto: '/dashboard', screen: 'dashboard', path: '/dashboard',
    caption: navCaption, point: { text: `^${railText}$|^${railText}`, region: 'rail' }, then: { clickPoint: true },
});

export const FLOWS = [
    {
        slug: 'admin-how-to-invite-team-members',
        title: 'invite a team member',
        steps: [
            fromDashboard('CRM', 'From the <b>Dashboard</b>, open the <b>CRM</b> workspace to reach <b>Manage Institute → Teams</b>.'),
            { goto: '/manage-institute/teams', path: '/manage-institute/teams',
              caption: 'On the <b>Teams</b> page, click <b>Invite Users</b>.',
              point: { text: 'Invite User', region: 'content' }, then: { clickPoint: true } },
            { path: '/manage-institute/teams', caption: "Enter the new member's <b>name and email</b>.",
              point: { firstField: true }, then: { fill: true } },
            { path: '/manage-institute/teams', caption: 'Open the <b>role</b> picker.',
              point: { text: 'Select option', region: 'content' }, then: { select: { trigger: 'Select option', option: 'Admin', caption: 'Choose <b>Admin</b> from the list.' } } },
            { path: '/manage-institute/teams', caption: 'Then click <b>Invite User</b> to send the invite.',
              point: { submit: true, submitText: 'Invite User' }, then: { submit: { text: 'Invite User' } } },
            { path: '/manage-institute/teams', caption: 'Done — the <b>invite</b> is sent.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-create-a-course',
        title: 'create a course',
        steps: [
            fromDashboard('LMS', 'From the <b>Dashboard</b>, open <b>Courses</b>.'),
            { goto: '/study-library/courses', path: '/study-library/courses',
              caption: 'On <b>Courses</b>, click <b>Create Course</b>.',
              point: { text: 'Create Course', region: 'content' }, then: { clickPoint: true } },
            { path: '/study-library/courses', caption: 'Step 1 — name your <b>course</b> and add a description.',
              point: { firstField: true }, then: { fill: true } },
            { path: '/study-library/courses', caption: 'Fill the overview, then click <b>Next</b>.',
              point: { submit: true, submitText: '^Next' }, then: { submit: { text: '^Next' } } },
            { path: '/study-library/courses', caption: 'Step 2 — pick a <b>structure</b>. Keep it simple: <b>no sessions</b>…',
              point: { sel: '#sessions-no', scroll: true }, then: { clickSel: '#sessions-no', wait: 900 } },
            { path: '/study-library/courses', caption: '…and <b>no levels</b> — a flat course you can fill with content later.',
              point: { sel: '#levels-no', scroll: true }, then: { clickSel: '#levels-no', wait: 900 } },
            { path: '/study-library/courses', caption: 'Now click <b>Create</b> — the button enables once the structure is set.',
              point: { submit: true, submitText: 'Create' }, then: { submit: { text: '^\\+?\\s*Create$|Create' }, wait: 5000 } },
            { path: '/study-library/courses', caption: 'Done — your new <b>course</b> opens, ready to add content.', final: true },
        ],
    },

    // ---- first-10 admin onboarding flows ------------------------------------
    // Settings screens are deep-linked via ?selectedTab=<value> (see
    // src/routes/settings/-constants/terms.ts → SettingsTabs). No clicking through
    // the Settings home grid — the deep-link renders the exact tab.
    {
        slug: 'admin-how-to-navigate-the-admin-dashboard',
        title: 'navigate the admin dashboard',
        steps: [
            { goto: '/dashboard', screen: 'dashboard', path: '/dashboard', settle: 2200,
              caption: 'This is your <b>admin dashboard</b>. The left rail switches workspaces — <b>CRM</b> for contacts & leads.',
              point: { text: '^CRM$', region: 'rail' } },
            { screen: 'dashboard', path: '/dashboard',
              caption: '<b>LMS</b> holds your courses, study library, and content.',
              point: { text: '^LMS$', region: 'rail' } },
            { screen: 'dashboard', path: '/dashboard',
              caption: 'The <b>AI</b> workspace gives you AI-powered tools.',
              point: { text: '^AI$', region: 'rail' } },
            { screen: 'dashboard', path: '/dashboard',
              caption: '<b>Recent</b> jumps you back to pages you visited.',
              point: { text: '^Recent$', region: 'rail' } },
            { screen: 'dashboard', path: '/dashboard',
              caption: 'And <b>Settings</b> is where you configure your whole institute.',
              point: { text: '^Settings$', region: 'rail' }, final: true },
        ],
    },
    {
        slug: 'admin-how-to-set-up-white-label-branding',
        title: 'set up white-label branding',
        steps: [
            { goto: '/settings?selectedTab=whiteLabel', path: '/settings', settle: 2800,
              caption: 'Open <b>Settings → White-Label Setup</b> to brand your institute portal.',
              point: { field: 'myschool|learn\\.' } },
            { path: '/settings', caption: 'Each audience can have its own <b>domain</b>. Open a domain’s <b>Settings</b> to reveal branding.',
              point: { text: '^Settings$', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Set the <b>tab title, icon, theme, and font</b> for that branded portal.',
              point: { field: 'theme|#4F46E5' }, final: true },
        ],
    },
    {
        slug: 'admin-how-to-upload-your-institute-logo',
        title: 'upload your institute logo',
        steps: [
            { goto: '/settings?selectedTab=whiteLabel', path: '/settings', settle: 2800,
              caption: 'Open <b>Settings → White-Label Setup</b>.',
              point: { field: 'myschool|learn\\.' } },
            { path: '/settings', caption: 'Open a domain’s <b>Settings</b> to reveal its branding controls.',
              point: { text: '^Settings$', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Use <b>Tab Icon</b> to upload the logo shown on the browser tab.',
              point: { field: 'file UUID|UUID' }, final: true },
        ],
    },
    {
        slug: 'admin-how-to-set-theme-primary-color',
        title: 'set theme primary color',
        steps: [
            { goto: '/settings?selectedTab=whiteLabel', path: '/settings', settle: 2800,
              caption: 'Open <b>Settings → White-Label Setup</b>.',
              point: { field: 'myschool|learn\\.' } },
            { path: '/settings', caption: 'Open a domain’s <b>Settings</b> panel.',
              point: { text: '^Settings$', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Enter your brand’s <b>primary color</b> in the <b>Theme / Color</b> field.',
              point: { field: 'theme|#4F46E5' }, then: { type: { field: 'theme|#4F46E5', value: '#F5A700' } } },
            { path: '/settings', caption: 'That color now themes your branded portal.',
              point: { field: 'theme|#4F46E5' }, final: true },
        ],
    },
    {
        slug: 'admin-how-to-set-up-a-custom-domain',
        title: 'set up a custom domain',
        steps: [
            { goto: '/settings?selectedTab=whiteLabel', path: '/settings', settle: 2800,
              caption: 'Open <b>Settings → White-Label Setup</b> and find a <b>Domain</b> field.',
              point: { field: 'myschool|learn\\.' } },
            { path: '/settings', caption: 'Enter the <b>custom domain</b> learners will use to reach your portal.',
              point: { field: 'myschool|learn\\.' }, then: { type: { field: 'myschool|learn\\.', value: 'learn.myinstitute.com' } } },
            { path: '/settings', caption: 'Save to start <b>DNS</b> verification and routing. (Demo stops here — DNS is not submitted.)',
              point: { field: 'myschool|learn\\.' }, final: true },
        ],
    },
    {
        slug: 'admin-how-to-upload-favicon-and-email-logo',
        title: 'upload favicon and email logo',
        steps: [
            { goto: '/settings?selectedTab=whiteLabel', path: '/settings', settle: 2800,
              caption: 'In <b>White-Label Setup</b>, pick the <b>domain</b> whose favicon you’re setting.',
              point: { field: 'myschool|learn\\.' } },
            { path: '/settings', caption: 'Open a domain’s <b>Settings</b> panel.',
              point: { text: '^Settings$', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'The <b>Tab Icon</b> sets the browser favicon and email logo for that domain.',
              point: { field: 'file UUID|UUID' }, final: true },
        ],
    },
    {
        slug: 'admin-how-to-set-your-time-zone-and-currency',
        title: 'set your currency',
        steps: [
            { goto: '/settings?selectedTab=invoice', path: '/settings', settle: 5200,
              caption: 'Open <b>Settings → Invoice Settings</b>.',
              point: { field: 'currency' } },
            { path: '/settings', caption: 'Pick your <b>currency</b> in the General section — it’s used on every invoice.',
              point: { field: 'currency' }, final: true },
        ],
    },
    {
        slug: 'admin-how-to-rename-system-terminology',
        title: 'rename system terminology',
        steps: [
            { goto: '/settings?selectedTab=naming', path: '/settings', settle: 2800,
              caption: 'Open <b>Settings → Naming</b> to relabel system terms.',
              point: { firstField: true } },
            { path: '/settings', caption: 'Type your institute’s wording in the <b>Custom</b> column — e.g. call a “Course” a “Programme”.',
              point: { firstField: true }, final: true },
        ],
    },
    {
        slug: 'admin-how-to-configure-lead-scoring-rules',
        title: 'configure lead settings',
        steps: [
            { goto: '/settings?selectedTab=leadSettings', path: '/settings', settle: 3200,
              caption: 'Open <b>Settings → Lead Settings</b> to control your CRM’s lead engine.',
              point: { text: 'Lead Settings', region: 'sidebar' } },
            { path: '/settings', caption: 'Tune <b>scoring weights</b> — plus statuses, SLAs, and distribution pools.',
              point: { firstField: true }, final: true },
        ],
    },
];

// CLI
const arg = process.argv.find((a) => a.startsWith('--slugs='));
const onlySlugs = arg ? arg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
await runFlows(FLOWS, { onlySlugs });
