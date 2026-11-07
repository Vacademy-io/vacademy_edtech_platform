/**
 * What other panel screens use from the device layer. Importing this file does not
 * start anything; boot.tsx starts the sync loop.
 */
export { SignInCard, type SignInCardProps } from './SignInCard';
export type { SignInOutcome } from './signInFlow';
export { getWebViewMajor } from './deviceInfo';
export {
    getPanelFlags,
    getPanelPolicy,
    getServerNow,
    getSyncSnapshot,
    subscribeSync,
    syncNow,
    useSyncSnapshot,
} from './syncLoop';
export {
    isMeetingOpen,
    isPanelDateWrong,
    notePanelActivity,
    setMeetingOpen,
    setOpenedClassEnd,
} from './activity';
export {
    readActiveDevice,
    readDevice,
    subscribeDeviceEvents,
    useDeviceRecord,
    usesDeviceAuth,
    type PanelDeviceEvent,
    type PanelDeviceRecord,
} from './store';
export { canUseDeviceSettings, isDeviceInstituteAdmin } from '../lib/session';
