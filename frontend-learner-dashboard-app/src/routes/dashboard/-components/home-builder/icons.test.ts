import { describe, expect, it } from "vitest";
import { SHORTCUT_ICONS, shortcutIcon } from "./icons";

// Copy of the server's ShortcutIcon enum (API contract section 1). The server
// rejects any other name, so the two lists must stay identical.
const SERVER_ENUM = `Books BookOpen Notebook Megaphone VideoCamera PlayCircle Broadcast Exam ClipboardText Trophy
Medal Certificate Calendar CalendarCheck ChatCircle ChatsCircle Question Download Folder Users
UserCircle Student ChalkboardTeacher Gift ShoppingCart Storefront Star Bell MapPin Phone
WhatsappLogo TelegramLogo YoutubeLogo InstagramLogo Globe Lightning Target ChartBar Robot GraduationCap`
  .split(/\s+/)
  .filter(Boolean);

describe("shortcut icons", () => {
  it("match the server enum exactly (40 names)", () => {
    expect(SERVER_ENUM).toHaveLength(40);
    expect(Object.keys(SHORTCUT_ICONS).sort()).toEqual([...SERVER_ENUM].sort());
  });

  it("every name resolves to a component", () => {
    for (const name of SERVER_ENUM) expect(SHORTCUT_ICONS[name]).toBeTruthy();
  });

  it("an unknown or inherited name falls back instead of crashing", () => {
    expect(shortcutIcon("NoSuchIcon")).toBe(SHORTCUT_ICONS.Star);
    expect(shortcutIcon("constructor")).toBe(SHORTCUT_ICONS.Star);
    expect(shortcutIcon(null)).toBe(SHORTCUT_ICONS.Star);
  });
});
