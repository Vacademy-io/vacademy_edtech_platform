/**
 * A tap stored for a reload is repeated only for the account that made it.
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
    challengeApprove: vi.fn(async () => ({ remote_token: 'r', room_name: 'Room' })),
    challengeDescribe: vi.fn(async () => ({
        room_name: 'Room',
        institute_id: 'inst-a',
        institute_name: 'Alpha',
        match_options: [11, 22, 33],
    })),
    challengeInfo: vi.fn(async () => ({
        state: 'PENDING',
        institute_id: 'inst-a',
        institute_name: 'Alpha',
        theme_code: null,
    })),
    resolveInstitute: vi.fn(async () => null),
}));
const who = vi.hoisted(() => ({ id: 'teacher-b' }));

vi.mock('../lib/api', () => api);
vi.mock('../lib/auth', () => ({
    useAuth: () => ({ signedIn: true, name: 'Teacher' }),
    currentUserId: () => who.id,
}));
vi.mock('../lib/remoteStore', () => ({ setRemote: vi.fn() }));
vi.mock('../lib/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../components/SignInForm', () => ({ SignInForm: () => <div>sign in</div> }));

import { ApproveScreen } from './ApproveScreen';

const route = (tappedBy?: string) => ({ kind: 'approve', t: 'tok', tapped: 42, tappedBy }) as const;

describe('ApproveScreen stored tap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        who.id = 'teacher-b';
    });

    it('repeats for the account that tapped', async () => {
        render(<ApproveScreen route={route('teacher-b')} onSignOutRetry={vi.fn()} />);
        await waitFor(() => expect(api.challengeApprove).toHaveBeenCalledTimes(1));
        expect(api.challengeApprove).toHaveBeenCalledWith(
            expect.objectContaining({ t: 'tok', match_code: 42 })
        );
    });

    it('asks again for any other account', async () => {
        render(<ApproveScreen route={route('teacher-a')} onSignOutRetry={vi.fn()} />);
        await waitFor(() => expect(api.challengeDescribe).toHaveBeenCalledTimes(1));
        expect(api.challengeApprove).not.toHaveBeenCalled();
    });

    it('asks again when the stored tap names nobody', async () => {
        render(<ApproveScreen route={route()} onSignOutRetry={vi.fn()} />);
        await waitFor(() => expect(api.challengeDescribe).toHaveBeenCalledTimes(1));
        expect(api.challengeApprove).not.toHaveBeenCalled();
    });
});
