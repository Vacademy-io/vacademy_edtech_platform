import {
    AddressBook,
    BookOpen,
    Buildings,
    ChartBar,
    ChartLineUp,
    ChatCircleDots,
    Certificate,
    CurrencyInr,
    EnvelopeSimple,
    Exam,
    FolderSimple,
    GraduationCap,
    Phone,
    Sparkle,
    SquaresFour,
    TextAa,
    UsersThree,
    VideoCamera,
    WhatsappLogo,
    type Icon,
} from '@phosphor-icons/react';
import { getSidebarItemsData } from '@/components/common/layout-container/sidebar/utils';

/** Icon for a section, picked from its (stored, English) name. */
export function sectionIcon(name: string): Icon {
    const n = name.toLowerCase();
    if (/whatsapp/.test(n)) return WhatsappLogo;
    if (/lead|enquir|inquir|audience|contact|crm/.test(n)) return UsersThree;
    if (/email|campaign|mail/.test(n)) return EnvelopeSimple;
    if (/call|dialer|phone/.test(n)) return Phone;
    if (/live|session|webinar|class/.test(n)) return VideoCamera;
    if (/assess|test|exam|quiz/.test(n)) return Exam;
    if (/payment|fee|invoice|price/.test(n)) return CurrencyInr;
    if (/certificate/.test(n)) return Certificate;
    if (/course|batch|program/.test(n)) return BookOpen;
    if (/doubt/.test(n)) return ChatCircleDots;
    if (/monitor|track|progress|learning/.test(n)) return ChartLineUp;
    if (/report|analytic/.test(n)) return ChartBar;
    if (/nam|setting|terminolog/.test(n)) return TextAa;
    return FolderSimple;
}

/** Icon for a module (module path level 1). */
export function moduleIcon(root: string): Icon {
    const r = root.toLowerCase();
    if (r === 'lms') return GraduationCap;
    if (r === 'crm') return AddressBook;
    if (r === 'ai') return Sparkle;
    if (r === 'erp') return Buildings;
    return SquaresFour;
}

/**
 * Starter questions per module. They are search queries against English video text, so they
 * stay English in every UI language; the popup only shows the ones that return a video, and
 * rewrites them with the institute's naming settings. Add CRM ones here as videos land.
 */
export const POPULAR_QUESTIONS: Record<string, string[]> = {
    lms: [
        'How do I schedule a live class?',
        'Add students to a batch',
        'Take fees for a course',
        'Create a quiz with AI',
        'Who attended my class?',
        'Where do students join the class?',
        'Class recording kaha milega?',
        'Check answer sheets',
        'Create a discount coupon',
        'Rename course to program',
    ],
    crm: [
        'Add a new lead',
        'Import leads from Excel',
        'Create an enquiry form',
        'Send a WhatsApp message to leads',
        'Set a follow-up reminder',
        'Assign leads to a counsellor',
        'Create an audience list',
        'Track calls with leads',
    ],
};

/**
 * Which admin module (CRM / LMS / AI) the current page belongs to, using the same sidebar data
 * the category rail uses — so opening Training from a CRM page lands on CRM videos.
 */
export function moduleForPath(pathname: string): string | null {
    let best: { len: number; category: string } | null = null;
    for (const item of getSidebarItemsData()) {
        if (item.id === 'settings') continue;
        const links = [item.to, ...(item.subItems || []).map((s) => s.subItemLink)]
            .filter((l): l is string => !!l && l !== '/')
            .map((l) => l.split('?')[0]!);
        for (const link of links)
            if (pathname.startsWith(link) && (!best || link.length > best.len))
                best = { len: link.length, category: item.category || 'CRM' };
    }
    return best?.category ?? null;
}
