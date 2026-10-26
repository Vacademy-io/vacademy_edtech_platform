/**
 * authored-v2 — NEW walkthrough flows (the v2 convention).
 *
 * Two differences from authored.mjs (the original 10, kept in `walkthroughs/`):
 *
 *   1. FULL NAVIGATION. Every flow STARTS on the Dashboard and walks the COMPLETE
 *      path step-by-step (Dashboard → Settings → the tab → the action) instead of
 *      deep-linking straight to a tab. The viewer learns how to GET there, not just
 *      what the destination looks like. Use the `dashToSettings()` helper below.
 *
 *   2. SEPARATE OUTPUT. The finished .html is built into a different folder so the
 *      original 10 are untouched:
 *        node capture/build-video.mjs <slug> --out=walkthroughs-v2
 *
 * Frames + manifest still land in screenshots/flows/<slug>/ (shared intermediate);
 * only the .html goes to the v2 folder. Give each new flow its OWN slug so it never
 * collides with the original 10.
 *
 * Run:
 *   node capture/authored-v2.mjs                  # capture every v2 flow
 *   node capture/authored-v2.mjs --slugs=a,b      # specific flows
 *   node capture/build-video.mjs <slug> --out=walkthroughs-v2
 */
import { runFlows } from './engine.mjs';
import { fileURLToPath } from 'node:url';

// Make a created entity's name unique per run, so re-captures don't hit the backend's
// "name already exists" guard (the demo accumulates real data across runs).
const uniq = (base) => `${base} ${Date.now().toString().slice(-5)}`;

/**
 * Dashboard → Settings → <tab card>. The shared "how you get there" opener every
 * v2 settings flow begins with. Returns the two nav frames; spread them in front of
 * the flow's own action steps.
 *
 * `tabValue` MUST be the EXACT card label from
 * frontend-admin-dashboard/src/routes/settings/-utils/utils.ts → getAvailableSettingsTabs()
 * e.g. 'White-Label Setup', 'Lead Settings', 'Invoice Settings', 'Naming Settings',
 *      'Custom Fields', 'Coupon Settings', 'Notification Settings', …
 *
 * Opening Settings from the rail lands on the tabbed layout with a left SIDEBAR
 * listing every tab (alphabetical). We click the tab in that sidebar; it's a long
 * list, so the click uses `scroll:true` to bring the item into view before the shot.
 */
export const dashToSettings = (tabLabel, opts = {}) => ([
    { goto: '/dashboard', screen: 'dashboard', path: '/dashboard', settle: 2200,
      caption: opts.dashCaption || 'Start on your <b>Dashboard</b> — open <b>Settings</b> from the left rail.',
      point: { text: '^Settings$', region: 'rail' }, then: { clickPoint: true, wait: 1800 } },
    // Pass opts.tab (the SettingsTabs value, e.g. 'invoice') to deep-link the tab via goto —
    // reliable even on a cold start. Without it, fall back to clicking the sidebar item.
    opts.tab
        ? { goto: `/settings?selectedTab=${opts.tab}`, path: '/settings', settle: opts.tabWait || 3200,
            caption: opts.gridCaption || `Open <b>${tabLabel}</b> from the settings menu.`,
            point: { text: tabLabel, region: 'sidebar', scroll: true } }
        : { path: '/settings', caption: opts.gridCaption || `In the <b>Settings</b> sidebar, open <b>${tabLabel}</b>.`,
            point: { text: tabLabel, region: 'sidebar', scroll: true }, then: { clickPoint: true, wait: opts.tabWait || 2400 } },
]);

/**
 * Dashboard → a workspace (rail icon) → goto the screen → click the create trigger.
 * For NON-settings flows (CRM/LMS/Manage). `railText` is the rail label (CRM/LMS/AI/
 * Settings); `route` is the real path; `trigger` is the visible text of the button that
 * opens the create form. Shows the Dashboard start + lands reliably via goto, then opens.
 */
export const dashToRoute = (railText, route, trigger, opts = {}) => ([
    { goto: '/dashboard', screen: 'dashboard', path: '/dashboard', settle: 2200,
      caption: opts.dashCaption || `From the <b>Dashboard</b>, open the <b>${railText}</b> workspace.`,
      point: { text: `^${railText}$`, region: 'rail' }, then: { clickPoint: true, wait: 1500 } },
    { goto: route, path: opts.path || route.split('?')[0], settle: opts.settle || 2800,
      caption: opts.landCaption || `Click <b>${trigger}</b> to start.`,
      point: { text: trigger, region: 'content', scroll: true }, then: { clickPoint: true, wait: opts.openWait || 1400 } },
]);

// END-TO-END RULE: every flow must MOVE each frame — navigate, click in, type, open,
// then show the result. Never two near-identical stills. Each frame is the next step
// of the previous one, and the whole thing reads as a complete how-to.

export const FLOWS = [
    // Template: shows the COMPLETE path from the Dashboard + a real edit.
    {
        slug: 'admin-how-to-set-your-portal-tab-title',
        title: 'set your portal tab title',
        steps: [
            ...dashToSettings('White-Label Setup', { tabWait: 2800 }),
            { path: '/settings', caption: 'Open a domain’s <b>Settings</b> to reveal its branding controls.',
              point: { text: '^Settings$', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Type a new <b>Tab Title</b> — the name shown on the browser tab.',
              point: { field: 'My School|tab title' }, then: { type: { field: 'My School|tab title', value: 'Acme Academy', clear: true } } },
            { path: '/settings', caption: 'That title now appears on your portal’s browser tab.',
              point: { text: '^Settings$', region: 'content' }, final: true },
        ],
    },

    // Rename a system term end-to-end: navigate → click the field → clear & retype → Save.
    {
        slug: 'admin-how-to-rename-system-terminology',
        title: 'rename system terminology',
        steps: [
            ...dashToSettings('Naming Settings', { tabWait: 2600 }),
            { path: '/settings', caption: 'Every system term has an editable <b>Singular</b> & <b>Plural</b> label.',
              point: { field: '^Course$' } },
            { path: '/settings', caption: 'Rename “Course” to your institute’s word — here, <b>Programme</b>.',
              point: { field: '^Course$' }, then: { type: { field: '^Course$', value: 'Programme', clear: true } } },
            { path: '/settings', caption: 'Then click <b>Save Changes</b> to apply it across your institute.',
              point: { text: 'Save Changes', region: 'content' }, final: true },
        ],
    },

    // Set the invoice currency end-to-end: navigate → open the dropdown → show options → result.
    {
        slug: 'admin-how-to-set-your-time-zone-and-currency',
        title: 'set your invoice currency',
        steps: [
            ...dashToSettings('Invoice Settings', { tabWait: 5200 }),
            { path: '/settings', caption: 'In the <b>General</b> section, open the <b>Currency</b> dropdown.',
              point: { field: 'currency' },
              then: { select: { trigger: 'Indian Rupee|INR|₹', caption: 'Pick the currency every invoice will use.', commit: false }, wait: 600 } },
            { path: '/settings', caption: 'Your invoices now use the <b>currency</b> you chose.',
              point: { field: 'currency' }, final: true },
        ],
    },

    // Tour Lead Settings end-to-end: navigate → master toggle → badge visibility → scoring weights.
    {
        slug: 'admin-how-to-configure-lead-scoring-rules',
        title: 'configure lead settings',
        steps: [
            ...dashToSettings('Lead Settings', { tabWait: 3200 }),
            { path: '/settings', caption: 'Lead Settings opens on <b>Configuration</b> — the master switch is up top.',
              point: { text: '^Configuration$', region: 'content' } },
            { path: '/settings', caption: '<b>Score Badge Visibility</b> chooses where HOT/WARM/COLD badges appear.',
              point: { coords: [440, 436] } },
            { path: '/settings', caption: 'Under <b>Scoring Weights</b>, set how much each factor counts (they sum to 100).',
              point: { firstField: true }, final: true },
        ],
    },

    // ===== Batch 2: more end-to-end creates (Dashboard → action → real success) =====

    {
        slug: 'admin-how-to-add-a-tax-rate',
        title: 'add a tax rate',
        steps: [
            ...dashToSettings('Invoice Settings', { tab: 'invoice', tabWait: 5500 }),
            { path: '/settings', caption: 'Open the <b>Country & Tax</b> tab.',
              point: { text: 'Country & Tax', region: 'content' }, then: { clickPoint: true, wait: 1500 } },
            { path: '/settings', caption: 'Click <b>Add tax component</b>.',
              point: { text: 'Add tax component', region: 'content', scroll: true }, then: { clickPoint: true, wait: 1000 } },
            { path: '/settings', caption: 'Name the tax — e.g. <b>CGST</b>.',
              point: { field: 'CGST|^Label', scroll: true }, then: { type: { field: 'CGST|^Label', value: 'CGST' } } },
            { path: '/settings', caption: 'Set its <b>rate</b> (%).',
              point: { field: '^Rate$|Rate' }, then: { type: { field: '^Rate$|Rate', value: '9' } } },
            { path: '/settings', caption: 'Then <b>Save Invoice Settings</b>.',
              point: { submit: true, submitText: 'Save Invoice Settings|^Save', scroll: true }, then: { submit: { text: 'Save Invoice Settings|^Save' }, wait: 2500 } },
            { path: '/settings', caption: 'Done — your <b>tax rate</b> is saved.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-set-up-custom-lead-statuses',
        title: 'set up a custom lead status',
        expect: 'statuses saved|status saved|saved',
        steps: [
            ...dashToSettings('Lead Settings', { tab: 'leadSettings', tabWait: 3500 }),
            { path: '/settings', caption: 'Scroll to <b>Lead Statuses</b> and click <b>Add status</b>.',
              point: { text: 'Add status', region: 'content', scroll: true }, then: { clickPoint: true, wait: 1100 } },
            { path: '/settings', caption: 'Name the new status — e.g. <b>Interested</b>.',
              point: { field: 'Status name|Interested', scroll: true }, then: { type: { field: 'Status name|Interested', value: 'Interested' } } },
            { path: '/settings', caption: 'Then click <b>Save statuses</b>.',
              point: { text: 'Save statuses', region: 'content' }, then: { submit: { text: 'Save statuses' }, wait: 2000 } },
            { path: '/settings', caption: 'Done — your custom <b>lead status</b> is saved.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-create-a-payment-plan',
        title: 'create a payment plan',
        steps: [
            ...dashToSettings('Payment Settings', { tab: 'payment', tabWait: 3200 }),
            { path: '/settings', caption: 'Click <b>Add Payment Plan</b>.',
              point: { text: 'Add Payment Plan', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Name your plan.',
              point: { field: 'plan name|Enter plan' }, then: { type: { field: 'plan name|Enter plan', value: 'Free Access Plan' } } },
            { path: '/settings', caption: 'Pick a plan type — a <b>Free Plan</b>.',
              point: { sel: '#free', scroll: true }, then: { clickSel: '#free', wait: 900 } },
            { path: '/settings', caption: 'Continue to the next step.',
              point: { submit: true, submitText: '^Next$|Continue' }, then: { submit: { text: '^Next$|Continue' }, wait: 1600 } },
            { path: '/settings', caption: 'Then <b>Create</b> the plan.',
              point: { submit: true, submitText: 'Create Plan|Create Payment Plan|^Create$' }, then: { submit: { text: 'Create Plan|Create Payment Plan|^Create$' }, wait: 2800 } },
            { path: '/settings', caption: 'Done — your <b>payment plan</b> is created.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-create-a-custom-field',
        title: 'create a custom field',
        expect: 'saved|added|created',
        steps: [
            ...dashToSettings('Custom Fields', { tab: 'customFields', tabWait: 3200 }),
            { path: '/settings', caption: 'Click <b>Add Custom Field</b>.',
              point: { text: 'Add Custom Field', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Name the field.',
              point: { sel: '#fieldName' }, then: { type: { field: 'Enter field name|fieldName', value: uniq('Guardian Phone') } } },
            { path: '/settings', caption: 'Click <b>Add Field</b> to add it.',
              point: { text: '^Add Field$', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Then <b>Save</b> to persist your changes.',
              point: { text: '^Save$', region: 'content', scroll: true }, then: { submit: { text: '^Save$' }, wait: 2200 } },
            { path: '/settings', caption: 'Done — your custom <b>field</b> is added.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-create-a-coupon',
        title: 'create a coupon',
        steps: [
            ...dashToSettings('Coupon Settings', { tab: 'coupons', tabWait: 3200 }),
            { path: '/settings', caption: 'Click <b>Create coupon</b> to open the form.',
              point: { text: 'Create coupon', region: 'content' }, then: { clickPoint: true, wait: 1500 } },
            { path: '/settings', caption: 'Enter a <b>coupon code</b>.',
              point: { field: 'SAVE20' }, then: { type: { field: 'SAVE20', value: 'WELCOME20' } } },
            { path: '/settings', caption: 'Set the discount <b>value</b> (%).',
              point: { field: '^20$|percent|value', scroll: true }, then: { type: { field: '^20$|percent|value', value: '20' } } },
            { path: '/settings', caption: 'For a percentage, set a <b>max cap</b>.',
              point: { field: '1000|cap', scroll: true }, then: { type: { field: '1000|cap', value: '500' } } },
            { path: '/settings', caption: 'Give it an <b>expiry date</b>.',
              point: { sel: 'input[type="date"]', nth: 1, scroll: true }, then: { set: { sel: 'input[type="date"]', nth: 1, value: '2026-12-31' } } },
            { path: '/settings', caption: 'Then <b>Create coupon</b>.',
              point: { submit: true, submitText: 'Create coupon', scroll: true }, then: { submit: { text: 'Create coupon' }, wait: 2800 } },
            { path: '/settings', caption: 'Done — your <b>coupon</b> is created.', final: true },
        ],
    },

    // ----- non-settings creates (dashToRoute: Dashboard → rail → route → form) -----
    {
        slug: 'admin-how-to-create-a-session',
        title: 'create a session',
        expect: 'added successfully|session added|added',
        steps: [
            ...dashToRoute('CRM', '/manage-institute/sessions', 'Add New Session', { settle: 3000, openWait: 1600 }),
            { path: '/manage-institute/sessions', caption: 'Name the <b>session</b> — e.g. 2025-2026.',
              point: { field: '2024-2025|Eg\\.|session name' }, then: { type: { field: '2024-2025|Eg\\.|session name', value: '2025-2026' } } },
            { path: '/manage-institute/sessions', caption: 'Set a <b>start date</b>.',
              point: { sel: 'input[type="date"]', scroll: true }, then: { set: { sel: 'input[type="date"]', value: '2025-06-01' } } },
            { path: '/manage-institute/sessions', caption: 'Pick at least one <b>level</b> from your courses.',
              point: { sel: 'button[role="checkbox"]', scroll: true }, then: { clickSel: 'button[role="checkbox"]', wait: 800 } },
            { path: '/manage-institute/sessions', caption: 'Then click <b>Add</b>.',
              point: { submit: true, submitText: '^Add$', scroll: true }, then: { submit: { text: '^Add$' }, wait: 2800 } },
            { path: '/manage-institute/sessions', caption: 'Done — your <b>session</b> is created.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-create-an-audience-list',
        title: 'create an audience list',
        expect: 'created successfully|Campaign created',
        steps: [
            ...dashToRoute('CRM', '/audience-manager/list', 'Add Audience List', { settle: 3200, openWait: 2600 }),
            { path: '/audience-manager/list', caption: 'Name your <b>campaign</b>.',
              point: { field: 'Enter campaign name' }, then: { type: { field: 'Enter campaign name', value: uniq('Summer Drive') } } },
            { path: '/audience-manager/list', caption: 'Pick a <b>campaign type</b> — e.g. Website. (Dates are pre-filled.)',
              point: { text: 'Select campaign type', region: 'content', scroll: true }, then: { select: { trigger: 'Select campaign type', option: 'Website', caption: 'Choose <b>Website</b>.' }, wait: 900 } },
            { path: '/audience-manager/list', caption: 'Then <b>Create Audience List</b>.',
              point: { submit: true, submitText: 'Create Audience List|^Create', scroll: true }, then: { submit: { text: 'Create Audience List|^Create' }, wait: 5000 } },
            { path: '/audience-manager/list', caption: 'Done — your <b>audience list</b> is created.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-create-a-custom-role',
        title: 'create a custom role',
        expect: 'Role created successfully|created successfully',
        steps: [
            ...dashToSettings('Display Settings', { tab: 'roleDisplay', tabWait: 3200 }),
            { path: '/settings', caption: 'Switch to the <b>Custom Role</b> tab.',
              point: { text: '^Custom Role$', region: 'content' }, then: { clickPoint: true, wait: 1100 } },
            { path: '/settings', caption: 'Click <b>+</b> to add a new role.',
              point: { sel: '[aria-label="Add new role"]', scroll: true }, then: { clickSel: '[aria-label="Add new role"]', wait: 900 } },
            { path: '/settings', caption: 'Name the role — e.g. <b>Content Reviewer</b>.',
              point: { field: 'Enter role name' }, then: { type: { field: 'Enter role name', value: uniq('Content Reviewer') } } },
            { path: '/settings', caption: 'Then click <b>Create</b>.',
              point: { submit: true, submitText: '^Create$' }, then: { submit: { text: '^Create$' }, wait: 2200 } },
            { path: '/settings', caption: 'Done — your custom <b>role</b> is created.', final: true },
        ],
    },

    // ===== Batch 3: more settings creates/saves (clear success toasts) =====
    {
        slug: 'admin-how-to-create-a-doubt-category',
        title: 'create a doubt category',
        expect: 'Doubt management settings saved|settings saved|saved',
        steps: [
            ...dashToSettings('Doubt Management', { tab: 'doubtManagement', tabWait: 3200 }),
            { path: '/settings', caption: 'Click <b>Add query type</b>.',
              point: { sel: 'button:has-text("Add query type")', scroll: true }, then: { clickSel: 'button:has-text("Add query type")', wait: 1000 } },
            { path: '/settings', caption: 'Name the category.',
              point: { field: 'Type name', scroll: true }, then: { type: { field: 'Type name', value: uniq('Refund Request') } } },
            { path: '/settings', caption: 'Then <b>Save settings</b>.',
              point: { text: 'Save settings', region: 'content', scroll: true }, then: { submit: { text: 'Save settings' }, wait: 2200 } },
            { path: '/settings', caption: 'Done — your <b>doubt category</b> is saved.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-set-up-content-protection',
        title: 'set up content protection',
        expect: 'permissions saved|protection saved|saved',
        steps: [
            ...dashToSettings('Content Protection', { tab: 'contentProtection', tabWait: 3200 }),
            { path: '/settings', caption: 'Toggle a <b>download permission</b> — e.g. for PDFs.',
              point: { sel: '#slide-dl-ADMIN-DOCUMENT_PDF', scroll: true }, then: { clickSel: '#slide-dl-ADMIN-DOCUMENT_PDF', wait: 800 } },
            { path: '/settings', caption: 'Then <b>Save</b> the download rules.',
              point: { text: '^Save$', region: 'content', scroll: true }, then: { clickPoint: true, wait: 4000 } },
            { path: '/settings', caption: 'Done — your <b>content protection</b> rules are saved.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-configure-assessment-settings',
        title: 'configure assessment settings',
        expect: 'Assessment settings saved|settings saved|saved successfully',
        steps: [
            ...dashToSettings('Assessment Settings', { tab: 'assessment', tabWait: 3200 }),
            { path: '/settings', caption: 'Toggle a setting to change it.',
              point: { sel: 'button[role="switch"]', scroll: true }, then: { clickSel: 'button[role="switch"]', wait: 800 } },
            { path: '/settings', caption: 'Then <b>Save Changes</b>.',
              point: { text: 'Save Changes', region: 'content', scroll: true }, then: { submit: { text: 'Save Changes' }, wait: 2200 } },
            { path: '/settings', caption: 'Done — your <b>assessment settings</b> are saved.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-create-a-lead-distribution-pool',
        title: 'create a lead distribution pool',
        expect: 'Pool .*created|created successfully|pool created',
        steps: [
            ...dashToSettings('Lead Settings', { tab: 'leadSettings', tabWait: 3500 }),
            { path: '/settings', caption: 'Open the <b>Pools</b> tab.',
              point: { text: '^Pools$', region: 'content' }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Click <b>+ Create Pool</b>.',
              point: { text: 'Create Pool', region: 'content', scroll: true }, then: { clickPoint: true, wait: 1600 } },
            { path: '/settings/leads/pools/new', caption: 'Name your <b>pool</b>.',
              point: { field: 'pool-name|Pool name|Enter pool name|Class 11 Counselors' }, then: { type: { field: 'pool-name|Pool name|Enter pool name|Class 11 Counselors', value: uniq('North Zone Pool') } } },
            { path: '/settings/leads/pools/new', caption: 'Then <b>Create Pool</b>.',
              point: { submit: true, submitText: 'Create Pool' }, then: { submit: { text: 'Create Pool' }, wait: 2600 } },
            { path: '/settings/leads/pools', caption: 'Done — your <b>distribution pool</b> is created.', final: true },
        ],
    },

    // ===== multi-step wizards (lower first-pass yield; diagnose-fix loop converges them) =====
    {
        slug: 'admin-how-to-create-a-custom-team',
        title: 'create a custom team',
        expect: 'Sub-organization created|created with subscription|created successfully',
        steps: [
            ...dashToRoute('CRM', '/manage-custom-teams', 'Create Sub-Organization', { settle: 3000, openWait: 1600 }),
            { path: '/manage-custom-teams', caption: 'Name your <b>sub-organization</b>.',
              point: { field: 'Sub-Org Name|sub.?org|organization name|Enter.*name' }, then: { type: { field: 'Sub-Org Name|sub.?org|organization name|Enter.*name', value: uniq('North Campus') } } },
            { path: '/manage-custom-teams', caption: 'Continue.',
              point: { submit: true, submitText: '^Next|Continue' }, then: { submit: { text: '^Next|Continue' }, wait: 1500 } },
            { path: '/manage-custom-teams', caption: 'Click <b>Skip (No Subscription)</b> — that creates the sub-org.',
              point: { text: '^Skip', region: 'content', scroll: true }, then: { clickPoint: true, wait: 3200 } },
            { path: '/manage-custom-teams', caption: 'Done — your <b>sub-organization</b> is created.', final: true },
        ],
    },
    {
        slug: 'admin-how-to-create-a-batch',
        title: 'create a batch',
        expect: 'Batch created|created successfully',
        steps: [
            ...dashToRoute('CRM', '/manage-institute/batches', 'Create Batch', { settle: 3000, openWait: 1600 }),
            { path: '/manage-institute/batches', caption: 'Use an <b>existing course</b>.',
              point: { sel: '#existing-course', scroll: true }, then: { clickSel: '#existing-course', wait: 700 } },
            { path: '/manage-institute/batches', caption: 'Pick the course.',
              point: { text: 'Select a Course', region: 'content', scroll: true }, then: { select: { trigger: 'Select a Course', option: 'Foundation Science' }, wait: 700 } },
            { path: '/manage-institute/batches', caption: 'Continue.',
              point: { submit: true, submitText: '^Next' }, then: { submit: { text: '^Next' }, wait: 1300 } },
            { path: '/manage-institute/batches', caption: 'Use an <b>existing session</b>.',
              point: { sel: '#existing-session', scroll: true }, then: { clickSel: '#existing-session', wait: 700 } },
            { path: '/manage-institute/batches', caption: 'Pick the session.',
              point: { text: 'Select a Session', region: 'content', scroll: true }, then: { select: { trigger: 'Select a Session', option: '2025-26' }, wait: 700 } },
            { path: '/manage-institute/batches', caption: 'Continue.',
              point: { submit: true, submitText: '^Next' }, then: { submit: { text: '^Next' }, wait: 1300 } },
            { path: '/manage-institute/batches', caption: 'Use an <b>existing level</b>.',
              point: { sel: '#existing-level', scroll: true }, then: { clickSel: '#existing-level', wait: 700 } },
            { path: '/manage-institute/batches', caption: 'Pick the level.',
              point: { text: 'Select a Level', region: 'content', scroll: true }, then: { select: { trigger: 'Select a Level', option: 'Beginner' }, wait: 700 } },
            { path: '/manage-institute/batches', caption: 'Then <b>Create Batch</b>.',
              point: { submit: true, submitText: 'Create Batch' }, then: { submit: { text: 'Create Batch' }, wait: 3200 } },
            { path: '/manage-institute/batches', caption: 'Done — your <b>batch</b> is created.', final: true },
        ],
    },

    // ===== settings configure-and-save flows (the high-yield pattern: toggle → Save → toast) =====
    ...[
        ['admin-how-to-configure-student-display-settings', 'configure student display settings', 'Student Display', 'studentDisplay'],
        ['admin-how-to-configure-notification-settings', 'configure notification settings', 'Notification Settings', 'notification'],
        ['admin-how-to-configure-lms-settings', 'configure LMS settings', 'LMS Settings', 'lms'],
        ['admin-how-to-configure-live-session-settings', 'configure live session settings', 'Live Session Settings', 'liveSession'],
        ['admin-how-to-configure-course-settings', 'configure course settings', 'Course Settings', 'course'],
    ].map(([slug, title, label, tab]) => ({
        slug, title,
        expect: 'saved|updated|success',
        steps: [
            ...dashToSettings(label, { tab, tabWait: 3200 }),
            { path: '/settings', caption: 'Change a setting to enable saving.',
              point: { sel: 'button[role="switch"]', scroll: true }, then: { clickSel: 'button[role="switch"]', wait: 900 } },
            { path: '/settings', caption: 'Then <b>Save</b> your changes.',
              point: { text: 'Save now|Save Changes|^Save$', region: 'content', scroll: true }, then: { clickPoint: true, wait: 1900 } },
            { path: '/settings', caption: 'Done — your settings are saved.', final: true },
        ],
    })),
    {
        slug: 'admin-how-to-create-a-referral-reward',
        title: 'create a referral reward',
        expect: 'Referral program created|program created|created successfully',
        steps: [
            ...dashToSettings('Referral Settings', { tab: 'referral', tabWait: 3200 }),
            { path: '/settings', caption: 'Click <b>Create New Program</b>.',
              point: { text: 'Create New Program|Create Program', region: 'content', scroll: true }, then: { clickPoint: true, wait: 1300 } },
            { path: '/settings', caption: 'Name the <b>referral program</b>.',
              point: { field: 'name for your referral|referral program|program name|Enter a name' }, then: { type: { field: 'name for your referral|referral program|program name|Enter a name', value: uniq('Refer & Earn') } } },
            { path: '/settings', caption: 'Add your first <b>reward tier</b>.',
              point: { text: 'Add Your First Tier|Add Tier|Add Reward', region: 'content', scroll: true }, then: { clickPoint: true, wait: 1000 } },
            { path: '/settings', caption: 'Label the tier.',
              point: { field: 'First Referral|tier name|Referrals' }, then: { type: { field: 'First Referral|tier name|Referrals', value: 'First Referral' } } },
            { path: '/settings', caption: 'Then <b>Create Program</b>.',
              point: { submit: true, submitText: 'Create Program|Create New Program', scroll: true }, then: { submit: { text: 'Create Program|Create New Program' }, wait: 3200 } },
            { path: '/settings', caption: 'Done — your <b>referral program</b> is created.', final: true },
        ],
    },
];

// CLI — only when run directly (so grind.mjs can `import { FLOWS }` without capturing)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const arg = process.argv.find((a) => a.startsWith('--slugs='));
    const onlySlugs = arg ? arg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean) : null;
    await runFlows(FLOWS, { onlySlugs });
}
