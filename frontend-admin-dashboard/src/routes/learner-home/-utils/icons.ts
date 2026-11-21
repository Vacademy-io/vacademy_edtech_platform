/**
 * The curated shortcut-tile icons (spec 7.5): 40 phosphor names. The same list
 * lives in the learner app (home-builder/icons.ts) and in the server's
 * ShortcutIcon enum (HomeModel.java); icons.test.ts compares this list with a
 * copy of the enum. Order is the order of the picker grid.
 */
export const SHORTCUT_ICON_NAMES = [
    'Books',
    'BookOpen',
    'Notebook',
    'Megaphone',
    'VideoCamera',
    'PlayCircle',
    'Broadcast',
    'Exam',
    'ClipboardText',
    'Trophy',
    'Medal',
    'Certificate',
    'Calendar',
    'CalendarCheck',
    'ChatCircle',
    'ChatsCircle',
    'Question',
    'Download',
    'Folder',
    'Users',
    'UserCircle',
    'Student',
    'ChalkboardTeacher',
    'Gift',
    'ShoppingCart',
    'Storefront',
    'Star',
    'Bell',
    'MapPin',
    'Phone',
    'WhatsappLogo',
    'TelegramLogo',
    'YoutubeLogo',
    'InstagramLogo',
    'Globe',
    'Lightning',
    'Target',
    'ChartBar',
    'Robot',
    'GraduationCap',
] as const;

export type ShortcutIconName = (typeof SHORTCUT_ICON_NAMES)[number];

export const isShortcutIconName = (name: unknown): name is ShortcutIconName =>
    typeof name === 'string' && (SHORTCUT_ICON_NAMES as readonly string[]).includes(name);
