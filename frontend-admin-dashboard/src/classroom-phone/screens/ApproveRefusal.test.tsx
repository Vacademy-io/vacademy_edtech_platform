/**
 * A panel that cannot start a session: the phone names the reason instead of a retry.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneApiError } from '../lib/http';
import { STRINGS } from '../strings';

const api = vi.hoisted(() => ({
    challengeApprove: vi.fn(),
    challengeDescribe: vi.fn(),
    challengeInfo: vi.fn(),
    resolveInstitute: vi.fn(async () => null),
}));
const route = vi.hoisted(() => ({
    clearRoute: vi.fn(),
    forgetStash: vi.fn(),
    rememberTap: vi.fn(),
    setRoute: vi.fn(),
}));

vi.mock('../lib/api', () => api);
vi.mock('../lib/route', () => route);
vi.mock('../lib/auth', () => ({
    useAuth: () => ({ signedIn: true, name: 'Teacher' }),
    currentUserId: () => 'teacher-a',
}));
vi.mock('../lib/remoteStore', () => ({ setRemote: vi.fn() }));
vi.mock('../lib/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../components/SignInForm', () => ({ SignInForm: () => <div>sign in</div> }));

import { ApproveScreen } from './ApproveScreen';

const s = STRINGS.en;

describe('ApproveScreen refusals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.challengeInfo.mockResolvedValue({
            state: 'PENDING',
            institute_id: 'inst-a',
            institute_name: 'Alpha',
            theme_code: null,
        });
    });

    it.each([
        ['LICENCE_REQUIRED', s.refusedLicenceTitle, s.refusedLicenceBody],
        ['AWAITING_APPROVAL', s.refusedAwaitingTitle, s.refusedAwaitingBody],
        ['UPDATE_REQUIRED', s.refusedUpdateTitle, s.refusedUpdateBody],
        ['PANEL_DISABLED', s.refusedOffTitle, s.refusedOffBody],
    ])('%s gets its own message and forgets the stored step', async (code, title, body) => {
        api.challengeApprove.mockRejectedValue(new PhoneApiError('api', 403, code, { code }));
        render(
            <ApproveScreen
                route={{ kind: 'approve', t: 'tok', tapped: 42, tappedBy: 'teacher-a' }}
                onSignOutRetry={vi.fn()}
            />
        );
        expect(await screen.findByText(title)).toBeTruthy();
        expect(screen.getByText(body)).toBeTruthy();
        expect(screen.queryByText(s.retry)).toBeNull();
        expect(route.forgetStash).toHaveBeenCalled();
    });

    it('keeps the old retry for other failures', async () => {
        api.challengeApprove.mockRejectedValue(new PhoneApiError('api', 500, null, null));
        render(
            <ApproveScreen
                route={{ kind: 'approve', t: 'tok', tapped: 42, tappedBy: 'teacher-a' }}
                onSignOutRetry={vi.fn()}
            />
        );
        expect(await screen.findByText(s.retry)).toBeTruthy();
    });
});
