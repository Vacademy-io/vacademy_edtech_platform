import {
    ArrowSquareOut,
    BookOpen,
    CalendarBlank,
    EnvelopeSimple,
    Megaphone,
    Phone,
    UserCircle,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/formatters';
import type { CourseCard, SiteAssistantCard } from '../-utils/cards';

/**
 * The visitor-facing cards (SPEC §4.4) drawn simply and read-only for the
 * admin: what the visitor was shown, not the learner app's styled widget.
 * Links open in a new tab; they are already limited to https / site paths.
 */

const LinkOut = ({ href, children }: { href: string | null; children: React.ReactNode }) =>
    href ? (
        <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-caption font-medium text-primary-500 hover:underline"
        >
            {children}
            <ArrowSquareOut className="size-3" />
        </a>
    ) : (
        <span className="text-caption text-neutral-500">{children}</span>
    );

const CourseRow = ({ course }: { course: CourseCard }) => (
    <div className="flex gap-3 rounded-md border border-neutral-200 bg-white p-2">
        {course.imageUrl ? (
            <img
                src={course.imageUrl}
                alt=""
                className="size-12 shrink-0 rounded-md object-cover"
                loading="lazy"
            />
        ) : (
            <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-neutral-100">
                <BookOpen className="size-5 text-neutral-400" />
            </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate text-sm font-medium text-neutral-800">{course.title}</p>
            {course.subtitle && (
                <p className="truncate text-caption text-neutral-500">{course.subtitle}</p>
            )}
            <div className="flex flex-wrap items-center gap-1">
                {course.priceLabel && (
                    <span className="text-caption font-medium text-neutral-700">
                        {course.priceLabel}
                    </span>
                )}
                {[...course.badges, ...course.formatLabels, ...course.languages].map((b, i) => (
                    <Badge key={`${b}-${i}`} variant="secondary" className="text-caption">
                        {b}
                    </Badge>
                ))}
            </div>
            {course.url && <LinkOut href={course.url}>Open course</LinkOut>}
        </div>
    </div>
);

const Frame = ({
    icon,
    title,
    children,
}: {
    icon?: React.ReactNode;
    title?: string;
    children: React.ReactNode;
}) => (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
        {title && (
            <p className="flex items-center gap-1.5 text-caption font-medium uppercase tracking-wide text-neutral-500">
                {icon}
                {title}
            </p>
        )}
        {children}
    </div>
);

const when = (iso: string | null) => (iso ? formatDateTime(iso) : '');

export const CardView = ({ card }: { card: SiteAssistantCard }) => {
    switch (card.type) {
        case 'course':
            return <CourseRow course={card.course} />;
        case 'course_list':
            return (
                <Frame title="Courses">
                    {card.items.map((c) => (
                        <CourseRow key={c.id} course={c} />
                    ))}
                    {card.moreUrl && <LinkOut href={card.moreUrl}>See more courses</LinkOut>}
                </Frame>
            );
        case 'compare':
            return (
                <Frame title="Comparison">
                    <div className="overflow-x-auto">
                        <table className="w-full text-caption">
                            <thead>
                                <tr>
                                    <th className="p-1 text-start font-medium text-neutral-500" />
                                    {card.courses.map((c) => (
                                        <th
                                            key={c.id}
                                            className="p-1 text-start font-medium text-neutral-700"
                                        >
                                            {c.title}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {card.rows.map((r, i) => (
                                    <tr
                                        key={`${r.label}-${i}`}
                                        className="border-t border-neutral-200"
                                    >
                                        <td className="p-1 font-medium text-neutral-600">
                                            {r.label}
                                        </td>
                                        {r.values.map((v, j) => (
                                            <td key={j} className="p-1 text-neutral-700">
                                                {v}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Frame>
            );
        case 'path':
            return (
                <Frame title={card.name || 'Learning path'}>
                    <ol className="space-y-1">
                        {card.steps.map((st) => (
                            <li
                                key={st.position}
                                className="flex items-baseline gap-2 text-caption"
                            >
                                <span className="font-medium text-neutral-500">{st.position}.</span>
                                <LinkOut href={st.url}>{st.title}</LinkOut>
                                {st.priceLabel && (
                                    <span className="text-neutral-500">{st.priceLabel}</span>
                                )}
                            </li>
                        ))}
                    </ol>
                </Frame>
            );
        case 'page_link':
            return (
                <Frame>
                    <LinkOut href={card.href}>{card.title || card.href || 'Page'}</LinkOut>
                    {card.snippet && (
                        <p className="text-caption text-neutral-500">{card.snippet}</p>
                    )}
                </Frame>
            );
        case 'live_class_list':
            return (
                <Frame title="Live classes" icon={<CalendarBlank className="size-3.5" />}>
                    {card.items.length === 0 && (
                        <p className="text-caption text-neutral-500">No upcoming public classes.</p>
                    )}
                    {card.items.map((it, i) => (
                        <div key={`${it.title}-${i}`} className="space-y-0.5">
                            <p className="text-sm font-medium text-neutral-800">{it.title}</p>
                            <p className="text-caption text-neutral-500">
                                {when(it.startsAt)}
                                {it.timezone ? ` (${it.timezone})` : ''} ·{' '}
                                {it.isPaid ? it.priceLabel || 'Paid' : 'Free'}
                            </p>
                            {it.registrationUrl && (
                                <LinkOut href={it.registrationUrl}>Register</LinkOut>
                            )}
                        </div>
                    ))}
                </Frame>
            );
        case 'notice':
            return (
                <Frame title="Notice" icon={<Megaphone className="size-3.5" />}>
                    <p className="text-sm font-medium text-neutral-800">{card.title}</p>
                    <p className="whitespace-pre-line text-caption text-neutral-600">{card.body}</p>
                    {card.endsAt && (
                        <p className="text-caption text-neutral-400">Until {when(card.endsAt)}</p>
                    )}
                </Frame>
            );
        case 'contact_info':
            return (
                <Frame title="Contact details">
                    {card.phone && (
                        <p className="flex items-center gap-1.5 text-caption text-neutral-700">
                            <Phone className="size-3.5" /> {card.phone}
                        </p>
                    )}
                    {card.whatsapp && (
                        <p className="flex items-center gap-1.5 text-caption text-neutral-700">
                            <Phone className="size-3.5" /> WhatsApp {card.whatsapp}
                        </p>
                    )}
                    {card.email && (
                        <p className="flex items-center gap-1.5 text-caption text-neutral-700">
                            <EnvelopeSimple className="size-3.5" /> {card.email}
                        </p>
                    )}
                    {card.address && (
                        <p className="text-caption text-neutral-600">{card.address}</p>
                    )}
                    {card.loginUrl && <LinkOut href={card.loginUrl}>Log in</LinkOut>}
                </Frame>
            );
        case 'contact_form':
            return (
                <Frame
                    title={card.kind === 'SUPPORT' ? 'Support request form' : 'Contact form'}
                    icon={<UserCircle className="size-3.5" />}
                >
                    {card.reason && <p className="text-caption text-neutral-600">{card.reason}</p>}
                    <ul className="flex flex-wrap gap-1">
                        {card.fields.map((f) => (
                            <li key={f.key}>
                                <Badge variant="outline" className="text-caption">
                                    {f.label}
                                    {f.required ? ' *' : ''}
                                </Badge>
                            </li>
                        ))}
                    </ul>
                    {card.consentText && (
                        <p className="text-caption text-neutral-400">{card.consentText}</p>
                    )}
                </Frame>
            );
        default:
            return null;
    }
};

export const CardsView = ({ cards }: { cards: SiteAssistantCard[] }) =>
    cards.length === 0 ? null : (
        <div className="space-y-2">
            {cards.map((card, i) => (
                <CardView key={i} card={card} />
            ))}
        </div>
    );
