import { describe, expect, it } from 'vitest';
import * as Phosphor from '@phosphor-icons/react';
import { SHORTCUT_ICON_NAMES } from './icons';

/**
 * Copy of the server's ShortcutIcon enum (spec 7.5). Keep the three lists
 * (this fixture, the learner app's icons.ts and the Java enum) identical.
 */
const SERVER_ENUM_FIXTURE = [
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
];

describe('shortcut icons', () => {
    it('has 40 unique names matching the server enum', () => {
        expect(SHORTCUT_ICON_NAMES).toHaveLength(40);
        expect(new Set(SHORTCUT_ICON_NAMES).size).toBe(40);
        expect([...SHORTCUT_ICON_NAMES].sort()).toEqual([...SERVER_ENUM_FIXTURE].sort());
    });

    it('every name is a phosphor icon', () => {
        const lib = Phosphor as unknown as Record<string, unknown>;
        for (const name of SHORTCUT_ICON_NAMES) expect(lib[name], name).toBeTruthy();
    });
});
