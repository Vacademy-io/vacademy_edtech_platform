/**
 * Form Template gallery — picks the whole-page look of the public response
 * form (`formAppearance.template`).
 *
 * Each tile is a miniature of the learner page drawn in plain blocks, tinted
 * with the institute's own `primary-*` scale, so what the admin clicks is what
 * the visitor gets. The learner renderer is
 * `audience-response/-components/audience-form-template-shell.tsx`; keep the
 * miniatures in step with it.
 *
 * Not behind the Form Appearance institute switch: choosing a look is a
 * per-campaign decision every admin can make. A template only changes the page
 * shell — the heading text, fields and submit label still come from the other
 * cards, so switching templates never loses anything that was typed.
 */
import type { ReactNode } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
    FORM_TEMPLATES,
    type AudienceFormAppearance,
    type AudienceFormTemplate,
} from '@/services/audience-form-appearance';

// ─── Miniature building blocks ───────────────────────────────────────────────

/** A line of text. `light` for copy on a coloured surface. */
const Line = ({ className, light }: { className?: string; light?: boolean }) => (
    <div className={cn('h-1 rounded-full', light ? 'bg-white/80' : 'bg-neutral-300', className)} />
);

const Heading = ({ light, className }: { light?: boolean; className?: string }) => (
    <div className={cn('flex flex-col gap-1', className)}>
        <div className={cn('h-1.5 w-3/4 rounded-full', light ? 'bg-white' : 'bg-neutral-700')} />
        <Line light={light} className="w-1/2" />
    </div>
);

const Field = () => <div className="h-2 rounded-sm border border-neutral-200 bg-white" />;

const Fields = ({ count = 3 }: { count?: number }) => (
    <div className="flex flex-col gap-1">
        {Array.from({ length: count }, (_, index) => (
            <Field key={index} />
        ))}
    </div>
);

const Submit = ({ full }: { full?: boolean }) => (
    <div className={cn('h-2 rounded-sm bg-primary-500', full ? 'w-full' : 'ml-auto w-8')} />
);

/** The white form card, as most templates draw it. */
const FormCard = ({ className, full }: { className?: string; full?: boolean }) => (
    <div className={cn('flex flex-col gap-1.5 rounded-md bg-white p-2 shadow-sm', className)}>
        <Line className="w-1/3 bg-neutral-500" />
        <Fields />
        <Submit full={full} />
    </div>
);

/** The institute logo bar at the top of the page. */
const HeaderBar = ({ dark }: { dark?: boolean }) => (
    <div
        className={cn(
            'flex h-3 shrink-0 items-center gap-1 px-2',
            dark ? 'bg-neutral-900' : 'border-b border-neutral-200 bg-white'
        )}
    >
        <div className="size-1.5 rounded-full bg-primary-500" />
        <div className={cn('h-1 w-6 rounded-full', dark ? 'bg-white/60' : 'bg-neutral-400')} />
    </div>
);

// ─── The seven miniatures ────────────────────────────────────────────────────

const THUMBNAILS: Record<AudienceFormTemplate, ReactNode> = {
    standard: (
        <div className="flex h-full flex-col bg-neutral-100">
            <HeaderBar />
            <div className="flex flex-1 flex-col gap-2 p-2">
                <Heading />
                <FormCard />
            </div>
        </div>
    ),
    banner: (
        <div className="flex h-full flex-col bg-neutral-100">
            <HeaderBar />
            <div className="h-12 shrink-0 bg-primary-500 p-2">
                <Heading light />
            </div>
            <div className="-mt-5 px-3">
                <FormCard className="shadow-md" />
            </div>
        </div>
    ),
    split: (
        <div className="flex h-full flex-col bg-white">
            <HeaderBar />
            <div className="flex flex-1">
                <div className="flex w-2/5 flex-col justify-center gap-1.5 bg-primary-500 p-2">
                    <Heading light />
                    <Line light className="w-2/3" />
                </div>
                <div className="flex flex-1 flex-col justify-center gap-1.5 p-2">
                    <Fields count={4} />
                    <Submit full />
                </div>
            </div>
        </div>
    ),
    framed: (
        <div className="flex h-full flex-col bg-neutral-100">
            <HeaderBar />
            <div className="flex flex-1 justify-center p-2">
                <div className="flex w-4/5 flex-col overflow-hidden rounded-md bg-white shadow-md">
                    <div className="bg-primary-500 p-2">
                        <Heading light />
                    </div>
                    <div className="flex flex-col gap-1.5 p-2">
                        <Fields count={2} />
                        <Submit full />
                    </div>
                </div>
            </div>
        </div>
    ),
    minimal: (
        <div className="flex h-full flex-col bg-white">
            <HeaderBar />
            <div className="mx-auto flex w-3/5 flex-1 flex-col justify-center gap-1.5 py-2">
                <Heading />
                <div className="h-px bg-neutral-200" />
                <Fields />
                <Submit full />
            </div>
        </div>
    ),
    gradient: (
        <div className="flex h-full flex-col bg-gradient-to-br from-primary-500 via-primary-400 to-primary-300">
            <HeaderBar />
            <div className="mx-auto flex w-4/5 flex-1 flex-col justify-center gap-2 py-2">
                <Heading light />
                <FormCard className="shadow-lg" />
            </div>
        </div>
    ),
    dark: (
        <div className="relative flex h-full flex-col overflow-hidden bg-neutral-900">
            <div className="absolute -top-6 left-1/2 size-16 -translate-x-1/2 rounded-full bg-primary-500 opacity-40 blur-xl" />
            <HeaderBar dark />
            <div className="relative flex flex-1 items-center gap-2 p-2">
                <div className="flex w-2/5 flex-col gap-1.5">
                    <Heading light />
                    <Line light className="w-2/3" />
                </div>
                <FormCard className="flex-1" />
            </div>
        </div>
    ),
    logo: (
        <div className="relative flex h-full flex-col overflow-hidden bg-neutral-100">
            <HeaderBar />
            {/* A stand-in "logo": brand-coloured mark, blurred, behind the card. */}
            <div className="absolute inset-x-0 bottom-0 top-3 flex items-center justify-center">
                <div className="flex size-20 items-center justify-center rounded-full bg-primary-300 opacity-60 blur-sm">
                    <div className="size-10 rounded-md bg-primary-500" />
                </div>
            </div>
            <div className="relative mx-auto flex w-4/5 flex-1 flex-col justify-center gap-2 py-2">
                <Heading />
                <FormCard className="bg-white/70 shadow-md backdrop-blur-sm" />
            </div>
        </div>
    ),
};

const TEMPLATE_COPY: Record<AudienceFormTemplate, { name: string; hint: string }> = {
    standard: { name: 'Standard', hint: 'Heading above a white form card' },
    banner: { name: 'Brand Banner', hint: 'Coloured band, form card overlapping it' },
    split: { name: 'Split Screen', hint: 'Brand panel left, form right' },
    framed: { name: 'Framed Card', hint: 'One card with a coloured header strip' },
    minimal: { name: 'Minimal', hint: 'White page, no card, full-width button' },
    gradient: { name: 'Gradient', hint: 'Brand gradient behind a frosted card' },
    dark: { name: 'Dark', hint: 'Dark page, heading beside the form' },
    logo: { name: 'Logo Backdrop', hint: 'Your institute logo, faded behind the form' },
};

// ─── Picker ──────────────────────────────────────────────────────────────────

interface FormTemplatePickerProps {
    value: AudienceFormAppearance;
    onChange: (next: AudienceFormAppearance) => void;
    title?: string;
    description?: string;
    disabled?: boolean;
}

export const FormTemplatePicker = ({
    value,
    onChange,
    title = 'Form Template',
    description = 'How the public form page looks when someone opens the link.',
    disabled = false,
}: FormTemplatePickerProps) => (
    <Card className="rounded-sm bg-neutral-50/50 shadow-none">
        <CardHeader className="border-b bg-neutral-100/50 p-4">
            <CardTitle className="text-base font-semibold text-neutral-800">{title}</CardTitle>
            <p className="text-xs text-neutral-500">{description}</p>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
            <div
                role="radiogroup"
                aria-label={title}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
            >
                {FORM_TEMPLATES.map((template) => {
                    const selected = value.template === template;
                    const copy = TEMPLATE_COPY[template];
                    return (
                        <button
                            key={template}
                            // type="button" is mandatory: this sits inside the
                            // campaign <form>, and a bare <button> submits it.
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled}
                            onClick={() => onChange({ ...value, template })}
                            className={cn(
                                'group flex flex-col overflow-hidden rounded-md border bg-white text-left transition-all',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                                'disabled:cursor-not-allowed disabled:opacity-60',
                                selected
                                    ? 'border-primary-500 ring-2 ring-primary-500'
                                    : 'border-neutral-200 hover:border-primary-300 hover:shadow-sm'
                            )}
                        >
                            <div
                                aria-hidden="true"
                                className="pointer-events-none h-28 w-full overflow-hidden border-b border-neutral-200 [&>div]:w-full"
                            >
                                {THUMBNAILS[template]}
                            </div>
                            <div className="flex items-start justify-between gap-2 p-2">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-neutral-800">
                                        {copy.name}
                                    </p>
                                    <p className="text-xs text-neutral-500">{copy.hint}</p>
                                </div>
                                {selected && (
                                    <CheckCircle
                                        weight="fill"
                                        className="size-5 shrink-0 text-primary-500"
                                    />
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
            <p className="text-xs text-neutral-500">
                The template sets the page layout, background and card. Your heading text,
                fields and button text stay the same. A cover image is shown behind the
                heading in Brand Banner, Split Screen and Framed Card. Logo Backdrop uses the
                institute logo from Settings.
            </p>
        </CardContent>
    </Card>
);

export default FormTemplatePicker;
