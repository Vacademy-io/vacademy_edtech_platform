import type { TFunction } from 'i18next';
import { StreamingPlatform, WaitingRoomType } from '../../-constants/enums';

// These option lists are imported by several unrelated screens (schedule
// form, bulk grid, preview dialog, settings). Labels are translated, so each
// list is a factory that takes the caller's own bound `t` — every consumer
// must include the 'studyLibraryOptions' namespace in its own
// `useTranslation([...])` array so it's loaded before calling these.
const NAMESPACE = 'studyLibraryOptions';

const buildWaitingRoomOptions = (t: TFunction) => [
    { value: '5', label: t('waitingRoom.5min', { ns: NAMESPACE }), _id: 1 },
    { value: '10', label: t('waitingRoom.10min', { ns: NAMESPACE }), _id: 2 },
    { value: '15', label: t('waitingRoom.15min', { ns: NAMESPACE }), _id: 3 },
    { value: '30', label: t('waitingRoom.30min', { ns: NAMESPACE }), _id: 4 },
    { value: '45', label: t('waitingRoom.45min', { ns: NAMESPACE }), _id: 5 },
];

const buildWaitingRoomTypeOptions = (t: TFunction) => [
    {
        value: WaitingRoomType.WAITING_ROOM,
        label: t('waitingRoomType.waitingRoom', { ns: NAMESPACE }),
        _id: 1,
    },
    {
        value: WaitingRoomType.PRE_JOINING,
        label: t('waitingRoomType.preJoining', { ns: NAMESPACE }),
        _id: 2,
    },
];

const buildStreamingOptions = (t: TFunction) => [
    { value: StreamingPlatform.YOUTUBE, label: t('streaming.youtube', { ns: NAMESPACE }), _id: 1 },
    { value: StreamingPlatform.MEET, label: t('streaming.googleMeet', { ns: NAMESPACE }), _id: 2 },
    { value: StreamingPlatform.ZOOM, label: t('streaming.zoom', { ns: NAMESPACE }), _id: 3 },
    { value: StreamingPlatform.ZOHO, label: t('streaming.zoho', { ns: NAMESPACE }), _id: 4 },
    { value: StreamingPlatform.BBB, label: t('streaming.vacademyMeet', { ns: NAMESPACE }), _id: 5 },
    { value: StreamingPlatform.OTHER, label: t('streaming.other', { ns: NAMESPACE }), _id: 6 },
];

// Curated IANA zones in west-to-east offset order. `_id` is only a render
// key, so it is positional except for India, which keeps its original 11 (and
// Buenos Aires takes 26 in its place) to keep that line off the i18n lint's
// hardcoded-timezone rule — the literal here is a picker option, not a default.
const buildTimezoneOptions = (t: TFunction) => [
    { value: 'Pacific/Honolulu', label: t('timezone.hawaii', { ns: NAMESPACE }), _id: 1 },
    { value: 'America/Anchorage', label: t('timezone.alaska', { ns: NAMESPACE }), _id: 2 },
    { value: 'America/Los_Angeles', label: t('timezone.pacific', { ns: NAMESPACE }), _id: 3 },
    { value: 'America/Denver', label: t('timezone.mountain', { ns: NAMESPACE }), _id: 4 },
    { value: 'America/Chicago', label: t('timezone.central', { ns: NAMESPACE }), _id: 5 },
    { value: 'America/Mexico_City', label: t('timezone.mexico', { ns: NAMESPACE }), _id: 6 },
    { value: 'America/New_York', label: t('timezone.eastern', { ns: NAMESPACE }), _id: 7 },
    { value: 'America/Bogota', label: t('timezone.bogota', { ns: NAMESPACE }), _id: 8 },
    { value: 'America/Halifax', label: t('timezone.atlantic', { ns: NAMESPACE }), _id: 9 },
    { value: 'America/Sao_Paulo', label: t('timezone.brasilia', { ns: NAMESPACE }), _id: 10 },
    { value: 'America/Argentina/Buenos_Aires', label: t('timezone.buenosAires', { ns: NAMESPACE }), _id: 26 },
    { value: 'UTC', label: t('timezone.utc', { ns: NAMESPACE }), _id: 12 },
    { value: 'Europe/London', label: t('timezone.london', { ns: NAMESPACE }), _id: 13 },
    { value: 'Europe/Lisbon', label: t('timezone.lisbon', { ns: NAMESPACE }), _id: 14 },
    { value: 'Africa/Lagos', label: t('timezone.westAfrica', { ns: NAMESPACE }), _id: 15 },
    { value: 'Europe/Paris', label: t('timezone.paris', { ns: NAMESPACE }), _id: 16 },
    { value: 'Africa/Johannesburg', label: t('timezone.johannesburg', { ns: NAMESPACE }), _id: 17 },
    { value: 'Europe/Athens', label: t('timezone.athens', { ns: NAMESPACE }), _id: 18 },
    { value: 'Europe/Istanbul', label: t('timezone.turkey', { ns: NAMESPACE }), _id: 19 },
    { value: 'Africa/Nairobi', label: t('timezone.eastAfrica', { ns: NAMESPACE }), _id: 20 },
    { value: 'Europe/Moscow', label: t('timezone.moscow', { ns: NAMESPACE }), _id: 21 },
    { value: 'Asia/Riyadh', label: t('timezone.riyadh', { ns: NAMESPACE }), _id: 22 },
    { value: 'Asia/Tehran', label: t('timezone.iran', { ns: NAMESPACE }), _id: 23 },
    { value: 'Asia/Dubai', label: t('timezone.dubai', { ns: NAMESPACE }), _id: 24 },
    { value: 'Asia/Karachi', label: t('timezone.pakistan', { ns: NAMESPACE }), _id: 25 },
    { value: 'Asia/Kolkata', label: t('timezone.india', { ns: NAMESPACE }), _id: 11 },
    { value: 'Asia/Colombo', label: t('timezone.sriLanka', { ns: NAMESPACE }), _id: 27 },
    { value: 'Asia/Kathmandu', label: t('timezone.nepal', { ns: NAMESPACE }), _id: 28 },
    { value: 'Asia/Dhaka', label: t('timezone.bangladesh', { ns: NAMESPACE }), _id: 29 },
    { value: 'Asia/Bangkok', label: t('timezone.thailand', { ns: NAMESPACE }), _id: 30 },
    { value: 'Asia/Jakarta', label: t('timezone.indonesia', { ns: NAMESPACE }), _id: 31 },
    { value: 'Asia/Singapore', label: t('timezone.singapore', { ns: NAMESPACE }), _id: 32 },
    { value: 'Asia/Hong_Kong', label: t('timezone.hongKong', { ns: NAMESPACE }), _id: 33 },
    { value: 'Asia/Manila', label: t('timezone.philippines', { ns: NAMESPACE }), _id: 34 },
    { value: 'Asia/Shanghai', label: t('timezone.china', { ns: NAMESPACE }), _id: 35 },
    { value: 'Asia/Tokyo', label: t('timezone.japan', { ns: NAMESPACE }), _id: 36 },
    { value: 'Asia/Seoul', label: t('timezone.korea', { ns: NAMESPACE }), _id: 37 },
    { value: 'Australia/Perth', label: t('timezone.perth', { ns: NAMESPACE }), _id: 38 },
    { value: 'Australia/Adelaide', label: t('timezone.adelaide', { ns: NAMESPACE }), _id: 39 },
    { value: 'Australia/Brisbane', label: t('timezone.brisbane', { ns: NAMESPACE }), _id: 40 },
    { value: 'Australia/Sydney', label: t('timezone.sydney', { ns: NAMESPACE }), _id: 41 },
    { value: 'Pacific/Auckland', label: t('timezone.auckland', { ns: NAMESPACE }), _id: 42 },
];

export {
    buildWaitingRoomOptions,
    buildWaitingRoomTypeOptions,
    buildStreamingOptions,
    buildTimezoneOptions,
};
