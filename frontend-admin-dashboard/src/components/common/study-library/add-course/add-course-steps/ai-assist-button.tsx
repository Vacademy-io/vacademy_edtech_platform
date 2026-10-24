import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { CircleNotch, Sparkle } from '@phosphor-icons/react';
import { isAxiosError } from 'axios';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { plansToastAction } from '@/components/common/ai-credits/PlanEntryPoints';
import { useInstituteBrand } from '@/components/assist-dock/useInstituteBrand';
import {
    AI_IMAGE_CREDIT_COST,
    AI_TEXT_CREDIT_COST,
    AssistImageKind,
    AssistTextField,
    assistImageToFile,
    generateCourseFieldImage,
    generateCourseFieldText,
} from '@/services/ai-course-assist';

type AiAssistButtonProps = {
    /** Shown in the popover heading and used to name generated image files. */
    fieldLabel: string;
    getCourseName?: () => string | undefined;
    disabled?: boolean;
} & (
    | {
          mode: 'text';
          field: AssistTextField;
          getExistingHtml?: () => string | undefined;
          onGenerated: (html: string) => void;
      }
    | {
          mode: 'image';
          imageKind: AssistImageKind;
          aspectRatio?: string;
          onGenerated: (file: File) => void | Promise<void>;
      }
);

/** Sparkle button + prompt popover: writes rich copy (1 credit) or artwork
 * (5 credits) for one Add Course field via the ai_service assist endpoints. */
export const AiAssistButton = (props: AiAssistButtonProps) => {
    const { fieldLabel, getCourseName, disabled } = props;
    const [open, setOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [useBranding, setUseBranding] = useState(true);
    const brand = useInstituteBrand();
    const { t: tPlans } = useTranslation('aiPlans');

    const creditCost = props.mode === 'text' ? AI_TEXT_CREDIT_COST : AI_IMAGE_CREDIT_COST;
    const brandingAvailable = props.mode === 'image' && !!(brand.themeColor || brand.logoUrl);

    const handleGenerate = async () => {
        if (!prompt.trim() || isGenerating) return;
        setIsGenerating(true);
        try {
            if (props.mode === 'text') {
                const result = await generateCourseFieldText({
                    prompt: prompt.trim(),
                    field: props.field,
                    course_name: getCourseName?.() || undefined,
                    existing_html: props.getExistingHtml?.() || undefined,
                });
                // TipTap's external-value sync bails while the editor is
                // focused — blur first so the generated html always lands.
                (document.activeElement as HTMLElement | null)?.blur?.();
                props.onGenerated(result.html);
            } else {
                const applyBranding = brandingAvailable && useBranding;
                const result = await generateCourseFieldImage({
                    prompt: prompt.trim(),
                    kind: props.imageKind,
                    course_name: getCourseName?.() || undefined,
                    aspect_ratio: props.aspectRatio,
                    brand_colors:
                        applyBranding && brand.themeColor ? [brand.themeColor] : undefined,
                    logo_url: (applyBranding && brand.logoUrl) || undefined,
                });
                await props.onGenerated(
                    assistImageToFile(result, `ai-${props.imageKind}-${Date.now()}`)
                );
            }
            setOpen(false);
            setPrompt('');
        } catch (error) {
            const detail = isAxiosError(error) ? error.response?.data?.detail : undefined;
            const insufficient = isAxiosError(error) && error.response?.status === 402;
            toast.error(insufficient ? 'Not enough AI credits' : 'Generation failed', {
                description:
                    typeof detail === 'string'
                        ? detail
                        : insufficient
                          ? `This needs ${creditCost} AI credit${creditCost > 1 ? 's' : ''}. Please top up and try again.`
                          : 'Something went wrong. Please try again.',
                // Admins with the AI plan storefront on also get "See AI plans".
                action: insufficient ? plansToastAction(tPlans('entry.seePlans')) : undefined,
            });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <Popover open={open} onOpenChange={(next) => !isGenerating && setOpen(next)}>
            <PopoverTrigger asChild>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    layoutVariant="default"
                    disable={disabled}
                    className="gap-1 text-primary-500"
                >
                    <Sparkle className="size-4" weight="duotone" />
                    Generate with AI
                </MyButton>
            </PopoverTrigger>
            {/* Inline zIndex (dynamic layering): the hosting Add Course dialog
                sits at z-index 10000; the default z-50 portal would paint this
                popover underneath it. */}
            <PopoverContent align="end" className="w-80 space-y-3" style={{ zIndex: 10001 }}>
                <div className="space-y-1">
                    <p className="text-sm font-semibold text-neutral-700">
                        Generate {fieldLabel} with AI
                    </p>
                    <p className="text-xs text-neutral-500">
                        {props.mode === 'text'
                            ? 'Describe what to write — existing content is refined, not lost.'
                            : 'Describe the image you want.'}
                    </p>
                </div>
                <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleGenerate();
                        }
                    }}
                    placeholder={
                        props.mode === 'text'
                            ? 'e.g. Emphasize hands-on typing practice and job readiness'
                            : 'e.g. A modern desk with a keyboard, clean minimal style'
                    }
                    className="min-h-20 text-sm"
                    disabled={isGenerating}
                    autoFocus
                />
                {brandingAvailable && (
                    <div className="flex items-center gap-2">
                        <Checkbox
                            id={`ai-branding-${fieldLabel}`}
                            checked={useBranding}
                            onCheckedChange={(checked) => setUseBranding(checked === true)}
                            disabled={isGenerating}
                        />
                        <Label
                            htmlFor={`ai-branding-${fieldLabel}`}
                            className="cursor-pointer text-xs font-normal text-neutral-600"
                        >
                            Use institute branding
                            {brand.themeColor && brand.logoUrl
                                ? ' (logo & colors)'
                                : brand.logoUrl
                                  ? ' (logo)'
                                  : ' (colors)'}
                        </Label>
                    </div>
                )}
                <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-500">
                        Uses {creditCost} AI credit{creditCost > 1 ? 's' : ''}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="small"
                        layoutVariant="default"
                        disable={!prompt.trim() || isGenerating}
                        onClick={handleGenerate}
                        className="gap-1"
                    >
                        {isGenerating ? (
                            <>
                                <CircleNotch className="size-4 animate-spin" />
                                Generating…
                            </>
                        ) : (
                            <>
                                <Sparkle className="size-4" />
                                Generate
                            </>
                        )}
                    </MyButton>
                </div>
            </PopoverContent>
        </Popover>
    );
};
