/**
 * The pair step: an installer gets its linked schools and a claim that waits for the
 * school, a school where the account is ADMIN always keeps the admin flow, and every
 * other account keeps the admin flow exactly as before.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhoneApiError } from '../lib/http';
import { STRINGS } from '../strings';

const PREVIEW = {
    model: 'Board',
    manufacturer: 'Maker',
    webview_major: 66,
    match_options: [11, 22, 33],
    expires_in_s: 300,
};

const api = vi.hoisted(() => ({
    pairPreview: vi.fn(),
    adminInstitutes: vi.fn(),
    installerProbe: vi.fn(),
    partnerCustomers: vi.fn(),
    partnerRooms: vi.fn(),
    partnerClaim: vi.fn(),
    adminRooms: vi.fn(),
    deviceClaim: vi.fn(),
    resolveInstitute: vi.fn(async () => ({ instituteName: 'Own School' })),
}));
const route = vi.hoisted(() => ({ setRoute: vi.fn(), clearRoute: vi.fn() }));

vi.mock('../lib/api', () => api);
vi.mock('../lib/route', () => route);
vi.mock('../lib/theme', () => ({ applyTheme: vi.fn() }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ signedIn: true, name: 'Someone' }) }));
vi.mock('../components/SignInForm', () => ({ SignInForm: () => <div>sign in</div> }));

import { PairScreen } from './PairScreen';

const s = STRINGS.en;
const PAIR = { kind: 'pair', code: 'PANEL234' } as const;
const CLAIMED = { device_id: 'd1', status: 'CLAIMED', room: { id: 'r2', name: 'Room 2' } };

const renderPair = () => render(<PairScreen route={PAIR} onSignOutRetry={vi.fn()} />);

describe('PairScreen, installer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.pairPreview.mockResolvedValue(PREVIEW);
        // An installer that is ADMIN nowhere: the installer form opens directly.
        api.adminInstitutes.mockResolvedValue([]);
        api.installerProbe.mockResolvedValue({ id: 'p1', name: 'Install Org' });
        api.partnerCustomers.mockResolvedValue([
            { institute_id: 'inst-a', institute_name: 'Alpha School', install_until: null },
            { institute_id: 'inst-b', institute_name: null, install_until: null },
        ]);
        api.partnerRooms.mockResolvedValue([
            { id: 'r1', name: 'Room 1', has_panel: true },
            { id: 'r2', name: 'Room 2', has_panel: false },
        ]);
        api.partnerClaim.mockResolvedValue(CLAIMED);
    });

    it('lists linked schools instead of admin institutes and claims with no replace', async () => {
        renderPair();
        const school = (await screen.findByLabelText(s.school)) as HTMLSelectElement;
        expect([...school.options].map((option) => option.text)).toEqual([
            'Alpha School',
            s.schoolNameLoading,
        ]);
        await waitFor(() => expect(api.partnerRooms).toHaveBeenCalledWith('inst-a'));
        // The free room is picked, never the one with a panel.
        expect((screen.getByLabelText(s.room) as HTMLSelectElement).value).toBe('r2');
        expect(screen.getByText('Room 1 (has a panel)')).toBeTruthy();
        expect(api.adminRooms).not.toHaveBeenCalled();
        expect(api.resolveInstitute).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('22'));
        fireEvent.click(screen.getByText(s.pair));

        await waitFor(() => expect(api.partnerClaim).toHaveBeenCalledTimes(1));
        expect(api.partnerClaim).toHaveBeenCalledWith({
            code: 'PANEL234',
            match_code: 22,
            institute_id: 'inst-a',
            room_id: 'r2',
        });
        expect(api.deviceClaim).not.toHaveBeenCalled();
        expect(
            await screen.findByText(
                'After you confirm, Room 2 waits for Alpha School to approve it in Settings → Classroom Panels.'
            )
        ).toBeTruthy();
    });

    it('loads the rooms of the school picked and can name a new room', async () => {
        api.partnerRooms.mockImplementation(async (id: string) =>
            id === 'inst-b' ? [] : [{ id: 'r1', name: 'Room 1', has_panel: true }]
        );
        renderPair();
        const school = await screen.findByLabelText(s.school);
        fireEvent.change(school, { target: { value: 'inst-b' } });
        await waitFor(() => expect(api.partnerRooms).toHaveBeenCalledWith('inst-b'));
        expect(await screen.findByText(s.emptyRooms)).toBeTruthy();
        fireEvent.change(screen.getByLabelText(s.newRoomName), {
            target: { value: '  Lab 3 ' },
        });
        fireEvent.click(screen.getByText('11'));
        fireEvent.click(screen.getByText(s.pair));
        await waitFor(() =>
            expect(api.partnerClaim).toHaveBeenCalledWith({
                code: 'PANEL234',
                match_code: 11,
                institute_id: 'inst-b',
                new_room_name: 'Lab 3',
            })
        );
    });

    it('defaults to a new room when every room has a panel', async () => {
        api.partnerRooms.mockResolvedValue([{ id: 'r1', name: 'Room 1', has_panel: true }]);
        renderPair();
        await screen.findByLabelText(s.newRoomName);
        expect((screen.getByLabelText(s.room) as HTMLSelectElement).value).toBe('__new__');
    });

    it('tells the installer to ask the school when the room has a panel', async () => {
        api.partnerClaim.mockRejectedValue(
            new PhoneApiError('api', 409, 'ROOM_OCCUPIED', { code: 'ROOM_OCCUPIED' })
        );
        renderPair();
        await screen.findByLabelText(s.room);
        fireEvent.click(screen.getByText('33'));
        fireEvent.click(screen.getByText(s.pair));
        expect(await screen.findByText(s.installerRoomTaken)).toBeTruthy();
        expect(screen.queryByText(s.replaceConfirm)).toBeNull();
        expect(api.partnerClaim).toHaveBeenCalledTimes(1);
    });

    it('reads NOT_INSTALLER on claim as this school no longer allowing set-up', async () => {
        api.partnerClaim.mockRejectedValue(
            new PhoneApiError('api', 403, 'NOT_INSTALLER', { code: 'NOT_INSTALLER' })
        );
        renderPair();
        await screen.findByLabelText(s.room);
        fireEvent.click(screen.getByText('33'));
        fireEvent.click(screen.getByText(s.pair));
        expect(await screen.findByText(s.installerNotLinked)).toBeTruthy();
    });

    it('says when the school no longer lets this installer set up panels', async () => {
        api.partnerClaim.mockRejectedValue(
            new PhoneApiError('api', 403, 'FORBIDDEN', { code: 'FORBIDDEN' })
        );
        renderPair();
        await screen.findByLabelText(s.room);
        fireEvent.click(screen.getByText('33'));
        fireEvent.click(screen.getByText(s.pair));
        expect(await screen.findByText(s.installerNotLinked)).toBeTruthy();
    });

    it('needs a number before claiming', async () => {
        renderPair();
        await screen.findByLabelText(s.room);
        fireEvent.click(screen.getByText(s.pair));
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(api.partnerClaim).not.toHaveBeenCalled();
    });

    it('sends an installer with no schools to add one, keeping this panel code', async () => {
        api.partnerCustomers.mockResolvedValue([]);
        renderPair();
        fireEvent.click(await screen.findByText(s.enterSchoolCode));
        expect(route.setRoute).toHaveBeenCalledWith({ kind: 'installer', resume: 'PANEL234' });
        expect(api.partnerRooms).not.toHaveBeenCalled();
    });

    it('shows the wrong-number screen', async () => {
        api.partnerClaim.mockRejectedValue(
            new PhoneApiError('api', 403, 'WRONG_NUMBER', { code: 'WRONG_NUMBER' })
        );
        renderPair();
        await screen.findByLabelText(s.room);
        fireEvent.click(screen.getByText('11'));
        fireEvent.click(screen.getByText(s.pair));
        expect(await screen.findByText(s.pairWrongNumber)).toBeTruthy();
    });
});

describe('PairScreen, installer who is also an ADMIN', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.pairPreview.mockResolvedValue(PREVIEW);
        api.adminInstitutes.mockResolvedValue([{ institute_id: 'own-school' }]);
        api.installerProbe.mockResolvedValue({ id: 'p1', name: 'Install Org' });
        api.partnerCustomers.mockResolvedValue([
            { institute_id: 'inst-a', institute_name: 'Alpha School', install_until: null },
        ]);
        api.adminRooms.mockResolvedValue({
            rooms: [{ id: 'r9', name: 'Hall', status: 'ACTIVE', device_id: null }],
            next_unpaired_room_id: 'r9',
        });
        api.deviceClaim.mockResolvedValue({ ...CLAIMED, room: { id: 'r9', name: 'Hall' } });
        api.partnerRooms.mockResolvedValue([{ id: 'r2', name: 'Room 2', has_panel: false }]);
        api.partnerClaim.mockResolvedValue(CLAIMED);
    });

    it('offers the school it administers with the admin claim', async () => {
        renderPair();
        await screen.findByLabelText(s.room);
        expect(api.adminRooms).toHaveBeenCalledWith('own-school');
        expect(api.partnerRooms).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('22'));
        fireEvent.click(screen.getByText(s.pair));
        await waitFor(() =>
            expect(api.deviceClaim).toHaveBeenCalledWith({
                code: 'PANEL234',
                match_code: 22,
                institute_id: 'own-school',
                room_id: 'r9',
                replace_existing: false,
            })
        );
        expect(api.partnerClaim).not.toHaveBeenCalled();
        expect(await screen.findByText('Hall is ready once you confirm.')).toBeTruthy();
    });

    it('can switch to a linked school, which uses the installer claim, and back', async () => {
        renderPair();
        await screen.findByLabelText(s.room);
        fireEvent.click(screen.getByText(s.installerLinkedSchool));
        const school = (await screen.findByLabelText(s.school)) as HTMLSelectElement;
        expect([...school.options].map((option) => option.value)).toEqual(['inst-a']);
        await waitFor(() => expect(api.partnerRooms).toHaveBeenCalledWith('inst-a'));
        fireEvent.click(screen.getByText(s.installerBackToAdmin));
        expect(await screen.findByText(s.installerLinkedSchool)).toBeTruthy();
        fireEvent.click(screen.getByText(s.installerLinkedSchool));
        await screen.findByLabelText(s.school);
        await screen.findByLabelText(s.room);
        fireEvent.click(screen.getByText('11'));
        fireEvent.click(screen.getByText(s.pair));
        await waitFor(() =>
            expect(api.partnerClaim).toHaveBeenCalledWith({
                code: 'PANEL234',
                match_code: 11,
                institute_id: 'inst-a',
                room_id: 'r2',
            })
        );
        expect(api.deviceClaim).not.toHaveBeenCalled();
    });

    it('lists a school that is both administered and linked once, with the admin path', async () => {
        api.partnerCustomers.mockResolvedValue([
            { institute_id: 'own-school', institute_name: 'Own School', install_until: null },
        ]);
        renderPair();
        await screen.findByLabelText(s.room);
        // Nothing is left for the installer path, so it is not offered.
        expect(screen.queryByText(s.installerLinkedSchool)).toBeNull();
        expect(screen.queryByLabelText(s.school)).toBeNull();
        fireEvent.click(screen.getByText('33'));
        fireEvent.click(screen.getByText(s.pair));
        await waitFor(() =>
            expect(api.deviceClaim).toHaveBeenCalledWith(
                expect.objectContaining({ institute_id: 'own-school', replace_existing: false })
            )
        );
        expect(api.partnerRooms).not.toHaveBeenCalled();
    });
});

describe('PairScreen, everyone else', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.pairPreview.mockResolvedValue(PREVIEW);
        api.adminInstitutes.mockResolvedValue([{ institute_id: 'own-school' }]);
        api.installerProbe.mockResolvedValue(null);
        api.adminRooms.mockResolvedValue({
            rooms: [{ id: 'r9', name: 'Hall', status: 'ACTIVE', device_id: null }],
            next_unpaired_room_id: 'r9',
        });
        api.deviceClaim.mockResolvedValue({ ...CLAIMED, room: { id: 'r9', name: 'Hall' } });
    });

    it('keeps the admin flow: admin rooms, admin claim, replace_existing false', async () => {
        renderPair();
        await screen.findByLabelText(s.room);
        expect(screen.queryByLabelText(s.school)).toBeNull();
        expect(api.partnerCustomers).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('22'));
        fireEvent.click(screen.getByText(s.pair));
        await waitFor(() =>
            expect(api.deviceClaim).toHaveBeenCalledWith({
                code: 'PANEL234',
                match_code: 22,
                institute_id: 'own-school',
                room_id: 'r9',
                replace_existing: false,
            })
        );
        expect(api.partnerClaim).not.toHaveBeenCalled();
        expect(await screen.findByText('Hall is ready once you confirm.')).toBeTruthy();
    });

    it('still refuses an account that is neither admin nor installer', async () => {
        api.adminInstitutes.mockResolvedValue([]);
        renderPair();
        expect(await screen.findByText(s.pairNotAdmin)).toBeTruthy();
    });

    it('offers a retry, not the admin flow, when the installer question gets no answer', async () => {
        api.installerProbe.mockRejectedValue(new PhoneApiError('network', null, null, null));
        renderPair();
        expect(await screen.findByText(s.noConnection)).toBeTruthy();
        expect(api.adminRooms).not.toHaveBeenCalled();
    });
});
