/**
 * #installer: who gets the page, adding a school with its code, and going back to a
 * panel code once the school is added.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneApiError } from '../lib/http';
import { STRINGS } from '../strings';

const api = vi.hoisted(() => ({
    installerProbe: vi.fn(),
    redeemPartnerCode: vi.fn(),
}));
const route = vi.hoisted(() => ({ setRoute: vi.fn() }));

vi.mock('../lib/api', () => api);
vi.mock('../lib/route', () => route);
const auth = vi.hoisted(() => ({ signedIn: true, listeners: new Set<() => void>() }));
vi.mock('../lib/auth', async () => {
    const { useSyncExternalStore } = await import('react');
    const subscribe = (listener: () => void) => {
        auth.listeners.add(listener);
        return () => {
            auth.listeners.delete(listener);
        };
    };
    return {
        useAuth: () => ({
            signedIn: useSyncExternalStore(subscribe, () => auth.signedIn),
            name: 'Installer',
        }),
    };
});
vi.mock('../components/SignInForm', () => ({ SignInForm: () => <div>sign in</div> }));

import { InstallerScreen } from './InstallerScreen';

const s = STRINGS.en;
const PARTNER = { id: 'p1', name: 'Install Org' };

const typeCode = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('InstallerScreen', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.signedIn = true;
        api.installerProbe.mockResolvedValue(PARTNER);
    });

    it('a refused sign-in shows the sign-in form, not a refusal or an error', async () => {
        api.installerProbe.mockImplementation(async () => {
            // What expireSignIn does before the probe rejects.
            auth.signedIn = false;
            auth.listeners.forEach((listener) => listener());
            throw new PhoneApiError('sign-in', 401, null, null);
        });
        render(<InstallerScreen route={{ kind: 'installer' }} onSignOutRetry={vi.fn()} />);
        expect(await screen.findByText('sign in')).toBeTruthy();
        expect(screen.queryByText(s.notInstallerTitle)).toBeNull();
        expect(screen.queryByText(s.retry)).toBeNull();
    });

    it('refuses an account that is not an installer, with a way to switch account', async () => {
        api.installerProbe.mockResolvedValue(null);
        const signOut = vi.fn();
        render(<InstallerScreen route={{ kind: 'installer' }} onSignOutRetry={signOut} />);
        expect(await screen.findByText(s.notInstallerTitle)).toBeTruthy();
        fireEvent.click(screen.getByText(s.signOutTryAnother));
        expect(signOut).toHaveBeenCalled();
        expect(api.redeemPartnerCode).not.toHaveBeenCalled();
    });

    it('offers a retry when the question gets no answer', async () => {
        api.installerProbe
            .mockRejectedValueOnce(new PhoneApiError('network', null, null, null))
            .mockResolvedValueOnce(PARTNER);
        render(<InstallerScreen route={{ kind: 'installer' }} onSignOutRetry={vi.fn()} />);
        fireEvent.click(await screen.findByText(s.retry));
        expect(await screen.findByText(s.installerTitle)).toBeTruthy();
        expect(screen.getByText('Installing for Install Org')).toBeTruthy();
    });

    it('adds a school from its code, normalised, and shows the name once known', async () => {
        api.redeemPartnerCode.mockResolvedValue({
            link_id: 'l1',
            institute_id: 'inst-a',
            institute_name: null,
            install_until: '2030-01-31T00:00:00Z',
        });
        render(<InstallerScreen route={{ kind: 'installer' }} onSignOutRetry={vi.fn()} />);
        await screen.findByText(s.installerTitle);
        typeCode(s.schoolCodeLabel, 'k7qf-2m9x');
        fireEvent.click(screen.getByText(s.addSchool));
        await waitFor(() => expect(api.redeemPartnerCode).toHaveBeenCalledWith('K7QF2M9X'));
        expect(await screen.findByText('School (name loading) is added')).toBeTruthy();
        // Nothing to go back to without a panel code.
        expect(screen.queryByText(s.continuePanel)).toBeNull();
    });

    it('says when the school code did not work', async () => {
        api.redeemPartnerCode.mockRejectedValue(
            new PhoneApiError('api', 404, 'INVITE_INVALID', { code: 'INVITE_INVALID' })
        );
        render(<InstallerScreen route={{ kind: 'installer' }} onSignOutRetry={vi.fn()} />);
        await screen.findByText(s.installerTitle);
        typeCode(s.schoolCodeLabel, 'ABCD2345');
        fireEvent.click(screen.getByText(s.addSchool));
        expect(await screen.findByText(s.schoolCodeWrong)).toBeTruthy();
    });

    it('rejects a code of the wrong length without asking the server', async () => {
        render(<InstallerScreen route={{ kind: 'installer' }} onSignOutRetry={vi.fn()} />);
        await screen.findByText(s.installerTitle);
        typeCode(s.schoolCodeLabel, 'ABC');
        fireEvent.click(screen.getByText(s.addSchool));
        expect(await screen.findByText(s.codeInvalid)).toBeTruthy();
        expect(api.redeemPartnerCode).not.toHaveBeenCalled();
    });

    it('goes back to the panel it came from once the school is added', async () => {
        api.redeemPartnerCode.mockResolvedValue({
            link_id: 'l1',
            institute_id: 'inst-a',
            institute_name: 'Alpha School',
            install_until: null,
        });
        render(
            <InstallerScreen
                route={{ kind: 'installer', resume: 'PANEL234' }}
                onSignOutRetry={vi.fn()}
            />
        );
        await screen.findByText(s.installerTitle);
        typeCode(s.schoolCodeLabel, 'ABCD2345');
        fireEvent.click(screen.getByText(s.addSchool));
        fireEvent.click(await screen.findByText(s.continuePanel));
        expect(route.setRoute).toHaveBeenCalledWith({ kind: 'pair', code: 'PANEL234' });
    });

    it('opens the pair step from a typed panel code', async () => {
        render(<InstallerScreen route={{ kind: 'installer' }} onSignOutRetry={vi.fn()} />);
        await screen.findByText(s.installerTitle);
        typeCode(s.panelCodeLabel, 'pane l234');
        fireEvent.click(screen.getByText(s.continue));
        await waitFor(() =>
            expect(route.setRoute).toHaveBeenCalledWith({ kind: 'pair', code: 'PANEL234' })
        );
    });
});
