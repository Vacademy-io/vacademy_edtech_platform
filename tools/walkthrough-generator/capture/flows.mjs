/**
 * Flow specs for batch capture. Each flow = ordered steps.
 *
 * Step verbs:
 *   { goto: '/path', shot: 'name' }        navigate by route (most reliable) + screenshot
 *   { click: 'Visible Text', shot }         click a button/link/text, optional screenshot
 *   { fillPlaceholder: 'ph', value }        fill an input by its placeholder
 *   { pickBelow: 'Option', shot }           click a dropdown option positioned below the trigger
 *   { submit: 'Button Text', shot }         click a submit button (ONLY if flow.submit === true
 *                                           AND the button is enabled; payment/domain/comms still
 *                                           blocked at the network layer regardless)
 *   { wait: ms }                            pause
 *   { shot: 'name' }                        screenshot only
 *
 * flow.submit: true  → permit the (non-destructive) submit step for this flow.
 * Routes are the real admin-app paths; the LLM recreates the sidebar cursor
 * navigation from these screens, so we navigate by URL for reliability.
 */
export const FLOWS = [
    {
        slug: 'teams-invite',
        title: 'Invite a teammate',
        submit: true, // invite is the approved non-destructive submit (test email)
        steps: [
            { goto: '/dashboard', shot: 'dashboard' },
            { goto: '/manage-institute/teams', shot: 'teams' },
            { click: 'Invite Users', shot: 'invite-modal' },
            { fillPlaceholder: 'Full name (First and Last)', value: 'Priya Sharma' },
            { fillPlaceholder: 'Enter Email', value: 'walkthrough.demo@example.com', shot: 'filled' },
            { click: 'Select options', shot: 'role-open' },
            { pickBelow: 'Admin', shot: 'role-picked' },
            { submit: 'Invite User', shot: 'success' },
        ],
    },
    {
        slug: 'manage-batches',
        title: 'Manage batches',
        submit: false,
        steps: [
            { goto: '/dashboard', shot: 'dashboard' },
            { goto: '/manage-institute/batches', shot: 'batches' },
        ],
    },
    {
        slug: 'manage-sessions',
        title: 'Manage sessions',
        submit: false,
        steps: [
            { goto: '/manage-institute/sessions', shot: 'sessions' },
        ],
    },
    {
        slug: 'learners-list',
        title: 'View your learners',
        submit: false,
        steps: [
            { goto: '/dashboard', shot: 'dashboard' },
            { goto: '/manage-students/students-list', shot: 'learners' },
        ],
    },
    {
        slug: 'manage-contacts',
        title: 'Manage contacts',
        submit: false,
        steps: [
            { goto: '/manage-contacts', shot: 'contacts' },
        ],
    },
    {
        slug: 'study-library-courses',
        title: 'Your courses',
        submit: false,
        steps: [
            { goto: '/study-library/courses', shot: 'courses' },
        ],
    },
];
