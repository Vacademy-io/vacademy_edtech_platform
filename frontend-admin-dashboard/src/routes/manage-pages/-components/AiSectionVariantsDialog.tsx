import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sparkle, ArrowClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useToast } from '@/hooks/use-toast';
import { generateSectionVariants, SectionVariant } from '../-services/ai-page-service';
import { renderComponentPreview } from './ComponentPreviews';
import { componentLabel } from '../-utils/component-labels';
import { describeKeptSettings } from '../-utils/section-edits';
import type { Component } from '../-types/editor-types';

/**
 * Three treatments of ONE section, side by side, applied in place.
 *
 * The editor's smallest unit of AI iteration used to be the whole page, so a
 * section that came out wrong meant hand-fixing it or re-rolling the page and
 * losing the parts that were right. Choosing between rendered options is a
 * different experience from describing a change and hoping — especially for an
 * admin who can see that something is off but can't say what.
 *
 * The server discards any version that would render broken, so fewer cards than
 * requested is a good sign, not a failure.
 *
 * `previewOf` turns a version into the section the editor will really get
 * (what Apply writes), so the preview matches the result; each card also says
 * which settings the version leaves out and will be kept.
 */
export const AiSectionVariantsDialog = ({
    open,
    onOpenChange,
    component,
    page,
    globalSettings,
    instituteName,
    terminology,
    onApply,
    previewOf,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    component: Component | null;
    page: { id: string; components: Component[] };
    globalSettings?: Record<string, any>;
    instituteName?: string;
    terminology?: Record<string, string>;
    onApply: (next: Component) => void;
    previewOf?: (next: Component) => { component: Component; kept: string[] };
}) => {
    const { t } = useTranslation('managePagesPropertyPanel');
    const { toast } = useToast();
    const [instruction, setInstruction] = useState('');
    const [loading, setLoading] = useState(false);
    const [variants, setVariants] = useState<SectionVariant[] | null>(null);
    const [selected, setSelected] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);

    const run = async () => {
        if (!component) return;
        setLoading(true);
        setVariants(null);
        setNotice(null);
        try {
            const res = await generateSectionVariants({
                page,
                component_id: component.id,
                instruction: instruction.trim() || undefined,
                variant_count: 3,
                institute_name: instituteName,
                terminology,
                global_settings: globalSettings,
            });
            setVariants(res.variants);
            setSelected(0);
            if (res.warnings.length) setNotice(res.warnings.join(' '));
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast({
                title: 'Could not generate versions',
                description:
                    typeof detail === 'string'
                        ? detail
                        : 'Something went wrong — please try again in a moment.',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const apply = () => {
        const picked = variants?.[selected];
        if (!picked) return;
        onApply(picked.component);
        onOpenChange(false);
        setVariants(null);
        setInstruction('');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-dialog-tall w-dialog-xl flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkle className="size-5 text-primary-500" weight="fill" />
                        Try another version of this section
                    </DialogTitle>
                </DialogHeader>

                <p className="text-caption text-gray-500">
                    {component
                        ? `Rewriting the “${componentLabel(component.type)}” section. Everything else on the page stays as it is.`
                        : 'Select a section first.'}
                </p>

                <div className="flex items-center gap-2">
                    <Input
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                        placeholder="Optional — e.g. make it more editorial, or show it as a comparison"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !loading) run();
                        }}
                        disabled={loading}
                    />
                    <Button onClick={run} disabled={loading || !component} className="shrink-0">
                        <ArrowClockwise className="mr-1.5 size-4" />
                        {variants ? 'Try again' : 'Show me options'}
                    </Button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    {loading && (
                        <div className="py-12">
                            <DashboardLoader />
                            <p className="mt-2 text-center text-caption text-gray-500">
                                Designing three versions…
                            </p>
                        </div>
                    )}

                    {!loading && !variants && (
                        <div className="rounded-lg border border-dashed border-neutral-200 py-12 text-center">
                            <p className="text-sm text-gray-500">
                                You&apos;ll get a few different treatments of this section to choose
                                from.
                            </p>
                            <p className="mt-1 text-caption text-gray-400">Costs 15 credits.</p>
                        </div>
                    )}

                    {!loading && variants && variants.length === 0 && (
                        <div className="rounded-lg border border-warning-200 bg-warning-50 py-10 text-center">
                            <p className="text-sm text-warning-700">
                                Nothing usable came back. Try describing the change you want.
                            </p>
                        </div>
                    )}

                    {!loading && variants && variants.length > 0 && (
                        <div className="space-y-3">
                            {notice && (
                                <p className="flex items-center gap-1.5 text-caption text-gray-500">
                                    <WarningCircle className="size-3.5 text-warning-600" />
                                    {notice}
                                </p>
                            )}
                            {variants.map((v, i) => {
                                const preview = previewOf?.(v.component as Component);
                                const kept = describeKeptSettings(preview?.kept ?? []);
                                return (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => setSelected(i)}
                                        className={`block w-full rounded-lg border p-3 text-start transition-colors ${
                                            selected === i
                                                ? 'border-primary-400 bg-primary-50'
                                                : 'border-neutral-200 hover:border-neutral-300'
                                        }`}
                                    >
                                        <div className="mb-2 flex items-center gap-2">
                                            {selected === i ? (
                                                <CheckCircle
                                                    className="size-4 shrink-0 text-primary-500"
                                                    weight="fill"
                                                />
                                            ) : (
                                                <span className="size-4 shrink-0 rounded-full border border-neutral-300" />
                                            )}
                                            <span className="text-sm font-medium text-gray-800">
                                                {v.label}
                                            </span>
                                            <span className="truncate text-caption text-gray-500">
                                                {v.rationale}
                                            </span>
                                        </div>
                                        {/* Non-interactive preview: this is a picker, and a live
                                        component inside a radio row would swallow the click. */}
                                        <div className="pointer-events-none overflow-hidden rounded border border-neutral-100 bg-white">
                                            {renderComponentPreview(
                                                preview?.component ?? (v.component as Component)
                                            )}
                                        </div>
                                        {kept.length > 0 && (
                                            <p className="mt-2 text-caption text-gray-500">
                                                {t('sectionVersion.keepsNote', {
                                                    count: kept.length,
                                                    names: kept.join(', '),
                                                })}
                                            </p>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={apply} disabled={!variants || variants.length === 0}>
                        Use this version
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
