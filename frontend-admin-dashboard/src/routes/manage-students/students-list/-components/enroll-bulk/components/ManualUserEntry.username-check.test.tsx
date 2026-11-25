import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ManualUserEntry } from './ManualUserEntry';

const { checkUsernameAvailability, toastError } = vi.hoisted(() => ({
    checkUsernameAvailability: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, opts?: Record<string, unknown>) =>
            opts?.username ? `${key}:${String(opts.username)}` : key,
    }),
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
vi.mock('@/services/username-availability', () => ({ checkUsernameAvailability }));
vi.mock('@/services/user-identifier-setting', () => ({
    useUserIdentifierSetting: () => ({ data: 'EMAIL' }),
}));
vi.mock('@/services/student-display-settings', () => ({
    useLearnerUsernamePolicy: () => ({ strategy: undefined, applies: false, overridesTyped: false }),
}));
vi.mock('@/services/custom-field-settings', () => ({
    getCustomFieldSettings: vi.fn(() => new Promise(() => undefined)),
    getCustomFieldSettingsFromCache: () => ({ systemFields: [], customFields: [] }),
    getEnrollmentFormCustomFields: () => [],
}));
vi.mock('@/services/domain-routing', () => ({
    getPreferredPhoneCountries: () => ({ defaultCountry: 'in', preferredCountries: ['in'] }),
}));
vi.mock('@/components/common/layout-container/sidebar/utils', () => ({
    getTerminology: () => 'Learner',
}));

const fillRow = (email: string, name: string, username: string) => {
    fireEvent.change(screen.getByPlaceholderText('core.emailPlaceholder'), {
        target: { value: email },
    });
    fireEvent.change(screen.getByPlaceholderText('core.fullNamePlaceholder'), {
        target: { value: name },
    });
    const usernameInput = document.querySelector(
        'input[name="learner_username_0"]'
    ) as HTMLInputElement;
    fireEvent.change(usernameInput, { target: { value: username } });
    return usernameInput;
};

const addButton = () => screen.getByRole('button', { name: /actions\.addLearners/ });

describe('ManualUserEntry username availability', () => {
    beforeEach(() => {
        checkUsernameAvailability.mockReset();
        toastError.mockReset();
    });

    it('shows "taken" under the field when the admin leaves a username someone else has', async () => {
        checkUsernameAvailability.mockResolvedValue(false);
        render(<ManualUserEntry onAdd={vi.fn()} />);

        const input = fillRow('new@yahoo.com', 'New Learner', 'Sahil');
        fireEvent.blur(input);

        expect(await screen.findByText('core.usernameTaken')).toBeTruthy();
        expect(checkUsernameAvailability).toHaveBeenCalledWith({
            username: 'Sahil',
            email: 'new@yahoo.com',
            mobile_number: '',
        });
    });

    it('blocks Add with a toast and keeps the row when the username is taken', async () => {
        checkUsernameAvailability.mockResolvedValue(false);
        const onAdd = vi.fn();
        render(<ManualUserEntry onAdd={onAdd} />);

        fillRow('new@yahoo.com', 'New Learner', 'Sahil');
        fireEvent.click(addButton());

        await waitFor(() =>
            expect(toastError).toHaveBeenCalledWith('toast.usernameTaken:Sahil')
        );
        expect(onAdd).not.toHaveBeenCalled();
        expect(
            (document.querySelector('input[name="learner_username_0"]') as HTMLInputElement).value
        ).toBe('Sahil');
        expect(screen.getByText('core.usernameTaken')).toBeTruthy();
    });

    it('adds the learner when the username is free', async () => {
        checkUsernameAvailability.mockResolvedValue(true);
        const onAdd = vi.fn();
        render(<ManualUserEntry onAdd={onAdd} />);

        fillRow('new@yahoo.com', 'New Learner', 'sahil.new');
        fireEvent.click(addButton());

        await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
        expect(onAdd.mock.calls[0][0][0]).toMatchObject({
            email: 'new@yahoo.com',
            username: 'sahil.new',
        });
        expect(toastError).not.toHaveBeenCalled();
    });

    it('does not call the check when the username is left blank', async () => {
        const onAdd = vi.fn();
        render(<ManualUserEntry onAdd={onAdd} />);

        fillRow('new@yahoo.com', 'New Learner', '');
        fireEvent.click(addButton());

        await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
        expect(checkUsernameAvailability).not.toHaveBeenCalled();
    });

    it('lets the row through when the check itself fails', async () => {
        checkUsernameAvailability.mockRejectedValue(new Error('network'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onAdd = vi.fn();
        render(<ManualUserEntry onAdd={onAdd} />);

        fillRow('new@yahoo.com', 'New Learner', 'Sahil');
        fireEvent.click(addButton());

        await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
        expect(toastError).not.toHaveBeenCalled();
    });
});
