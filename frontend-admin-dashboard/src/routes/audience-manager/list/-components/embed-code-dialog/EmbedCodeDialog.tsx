import { useState, useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Check, Copy, Code, FrameCorners, Palette } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CampaignItem } from '../../-services/get-campaigns-list';
import createCampaignLink from '../../-utils/createCampaignLink';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

interface EmbedCodeDialogProps {
    isOpen: boolean;
    onClose: () => void;
    campaign: CampaignItem;
}

interface EmbedCustomization {
    buttonText: string;
    buttonBgColor: string;
    buttonTextColor: string;
    buttonBorderRadius: string;
    popupTitle: string;
    iframeWidth: string;
    iframeHeight: string;
}

// Default colors for the user-customizable embed widget. They seed a native
// <input type="color"> (which requires literal #rrggbb) and are baked into the generated
// <style> block copied onto the customer's own site, so they can't reference our internal
// --token CSS variables.
const DEFAULT_BUTTON_BG_COLOR = '#6366f1'; // design-lint-ignore: portable literal color, see comment above
const DEFAULT_BUTTON_TEXT_COLOR = '#ffffff'; // design-lint-ignore: portable literal color, see comment above

const buildDefaultCustomization = (t: TFunction): EmbedCustomization => ({
    buttonText: t('defaults.buttonText'),
    buttonBgColor: DEFAULT_BUTTON_BG_COLOR,
    buttonTextColor: DEFAULT_BUTTON_TEXT_COLOR,
    buttonBorderRadius: '8',
    popupTitle: t('defaults.popupTitle'),
    iframeWidth: '100%',
    iframeHeight: '600',
});

// Static chrome colors for the generated embed-code <style> block below — this string is
// copied onto external customer sites, so it must stay portable literal CSS rather than
// referencing our internal --token CSS variables.
const EMBED_MODAL_BORDER_COLOR = '#e5e7eb'; // design-lint-ignore: portable literal color, see comment above
const EMBED_MODAL_TEXT_COLOR = '#111827'; // design-lint-ignore: portable literal color, see comment above
const EMBED_MODAL_MUTED_TEXT_COLOR = '#6b7280'; // design-lint-ignore: portable literal color, see comment above

/**
 * Sizes the embedded iframe to the form. The form page posts its height
 * (`vacademy-form-height`) whenever it changes — fields revealed, errors shown,
 * the thank-you screen — so the frame never cuts a long form off or leaves a
 * short one floating in empty space. The height set above is only the size
 * before the form has loaded. Messages from any other frame are ignored.
 */
const autoHeightScript = (frameId: string) => `<script>
  (function () {
    var frame = document.getElementById('${frameId}');
    window.addEventListener('message', function (e) {
      if (!frame || e.source !== frame.contentWindow) return;
      var d = e.data;
      if (d && d.type === 'vacademy-form-height' && d.height > 0) {
        frame.style.height = Math.ceil(d.height) + 'px';
      }
    });
  })();
</script>`;

export const EmbedCodeDialog = ({ isOpen, onClose, campaign }: EmbedCodeDialogProps) => {
    const { t } = useTranslation('audienceManagerEmbedCodeDialog');
    const [copiedSection, setCopiedSection] = useState<string | null>(null);
    const [customization, setCustomization] = useState<EmbedCustomization>(() =>
        buildDefaultCustomization(t)
    );
    const { instituteDetails } = useInstituteDetailsStore();

    const campaignId = campaign.id || campaign.campaign_id || campaign.audience_id || '';
    // Per-snippet suffix for the auto-height frame id, so the same form pasted
    // twice on one page still gets two distinct frames.
    const frameSuffix = useMemo(() => Math.random().toString(36).slice(2, 7), []);
    const formUrl = useMemo(() => {
        return createCampaignLink(campaignId, instituteDetails?.learner_portal_base_url);
    }, [campaignId, instituteDetails?.learner_portal_base_url]);

    const handleCopy = async (text: string, section: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedSection(section);
            toast.success(t('toasts.copiedToClipboard'));
            setTimeout(() => setCopiedSection(null), 2000);
        } catch (error) {
            toast.error(t('toasts.copyFailed'));
        }
    };

    // Button + Popup Embed Code
    const buttonPopupCode = useMemo(() => {
        return `<!-- Vacademy Form Embed - Button with Popup -->
<style>
  .vacademy-embed-btn {
    background-color: ${customization.buttonBgColor};
    color: ${customization.buttonTextColor};
    border: none;
    padding: 12px 24px;
    font-size: 16px;
    font-weight: 600;
    border-radius: ${customization.buttonBorderRadius}px;
    cursor: pointer;
    transition: opacity 0.2s ease;
  }
  .vacademy-embed-btn:hover {
    opacity: 0.9;
  }
  .vacademy-modal-overlay {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    padding: 16px;
    box-sizing: border-box;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9999;
    justify-content: center;
    align-items: center;
  }
  .vacademy-modal-overlay.active {
    display: flex;
  }
  .vacademy-modal-content {
    background: white;
    border-radius: 12px;
    max-width: 600px;
    width: 100%;
    max-height: calc(100vh - 32px);
    max-height: calc(100dvh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .vacademy-modal-header {
    flex-shrink: 0;
    padding: 16px 20px;
    border-bottom: 1px solid ${EMBED_MODAL_BORDER_COLOR};
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .vacademy-modal-title {
    font-size: 18px;
    font-weight: 600;
    color: ${EMBED_MODAL_TEXT_COLOR};
    margin: 0;
  }
  .vacademy-modal-close {
    background: none;
    border: none;
    font-size: 24px;
    cursor: pointer;
    color: ${EMBED_MODAL_MUTED_TEXT_COLOR};
    padding: 0;
    line-height: 1;
  }
  .vacademy-modal-close:hover {
    color: ${EMBED_MODAL_TEXT_COLOR};
  }
  .vacademy-modal-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .vacademy-modal-body iframe {
    display: block;
    width: 100%;
    height: 500px;
    border: none;
  }
</style>

<button class="vacademy-embed-btn" onclick="document.getElementById('vacademy-modal-${campaignId.slice(0, 8)}').classList.add('active')">
  ${customization.buttonText}
</button>

<div id="vacademy-modal-${campaignId.slice(0, 8)}" class="vacademy-modal-overlay" onclick="if(event.target === this) this.classList.remove('active')">
  <div class="vacademy-modal-content">
    <div class="vacademy-modal-header">
      <h3 class="vacademy-modal-title">${customization.popupTitle}</h3>
      <button class="vacademy-modal-close" onclick="document.getElementById('vacademy-modal-${campaignId.slice(0, 8)}').classList.remove('active')">&times;</button>
    </div>
    <div class="vacademy-modal-body">
      <iframe id="vacademy-form-${campaignId.slice(0, 8)}-${frameSuffix}" src="${formUrl}" title="${campaign.campaign_name} Form"></iframe>
    </div>
  </div>
</div>
${autoHeightScript(`vacademy-form-${campaignId.slice(0, 8)}-${frameSuffix}`)}`;
    }, [customization, campaignId, formUrl, campaign.campaign_name, frameSuffix]);

    // Direct iFrame Embed Code
    const iframeCode = useMemo(() => {
        return `<!-- Vacademy Form Embed - Direct iFrame -->
<iframe
  id="vacademy-iframe-${campaignId.slice(0, 8)}-${frameSuffix}"
  src="${formUrl}"
  title="${campaign.campaign_name} Form"
  width="${customization.iframeWidth}"
  height="${customization.iframeHeight}"
  frameborder="0"
  style="border: none; border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);"
  allow="clipboard-write"
></iframe>
${autoHeightScript(`vacademy-iframe-${campaignId.slice(0, 8)}-${frameSuffix}`)}`;
    }, [
        formUrl,
        campaign.campaign_name,
        campaignId,
        frameSuffix,
        customization.iframeWidth,
        customization.iframeHeight,
    ]);

    const updateCustomization = (key: keyof EmbedCustomization, value: string) => {
        setCustomization((prev) => ({ ...prev, [key]: value }));
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="w-dialog-xl max-h-dialog-tall overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Code className="size-5" />
                        {t('dialogTitle', { campaignName: campaign.campaign_name })}
                    </DialogTitle>
                    <DialogDescription>{t('dialogDescription')}</DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="button-popup" className="mt-4">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="button-popup" className="flex items-center gap-2">
                            <Palette className="size-4" />
                            {t('tabs.buttonPopup')}
                        </TabsTrigger>
                        <TabsTrigger value="iframe" className="flex items-center gap-2">
                            <FrameCorners className="size-4" />
                            {t('tabs.directEmbed')}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="button-popup" className="mt-4">
                        <div className="grid gap-6 lg:grid-cols-2">
                            {/* Customization Panel */}
                            <div className="space-y-4 rounded-lg border bg-neutral-50 p-4">
                                <h4 className="flex items-center gap-2 font-medium">
                                    <Palette className="size-4" />
                                    {t('buttonPanel.heading')}
                                </h4>

                                <div className="space-y-3">
                                    <div>
                                        <Label htmlFor="buttonText">
                                            {t('buttonPanel.buttonTextLabel')}
                                        </Label>
                                        <Input
                                            id="buttonText"
                                            value={customization.buttonText}
                                            onChange={(e) =>
                                                updateCustomization('buttonText', e.target.value)
                                            }
                                            placeholder={t('defaults.buttonText')}
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <Label htmlFor="buttonBgColor">
                                                {t('buttonPanel.bgColorLabel')}
                                            </Label>
                                            <div className="flex gap-2">
                                                <Input
                                                    id="buttonBgColor"
                                                    type="color"
                                                    value={customization.buttonBgColor}
                                                    onChange={(e) =>
                                                        updateCustomization(
                                                            'buttonBgColor',
                                                            e.target.value
                                                        )
                                                    }
                                                    className="h-10 w-14 cursor-pointer p-1"
                                                />
                                                <Input
                                                    value={customization.buttonBgColor}
                                                    onChange={(e) =>
                                                        updateCustomization(
                                                            'buttonBgColor',
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="#6366f1" // design-lint-ignore: literal hex-format hint for a hex color input
                                                    className="flex-1"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <Label htmlFor="buttonTextColor">
                                                {t('buttonPanel.textColorLabel')}
                                            </Label>
                                            <div className="flex gap-2">
                                                <Input
                                                    id="buttonTextColor"
                                                    type="color"
                                                    value={customization.buttonTextColor}
                                                    onChange={(e) =>
                                                        updateCustomization(
                                                            'buttonTextColor',
                                                            e.target.value
                                                        )
                                                    }
                                                    className="h-10 w-14 cursor-pointer p-1"
                                                />
                                                <Input
                                                    value={customization.buttonTextColor}
                                                    onChange={(e) =>
                                                        updateCustomization(
                                                            'buttonTextColor',
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="#ffffff" // design-lint-ignore: literal hex-format hint for a hex color input
                                                    className="flex-1"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <Label htmlFor="buttonBorderRadius">
                                            {t('buttonPanel.borderRadiusLabel')}
                                        </Label>
                                        <Input
                                            id="buttonBorderRadius"
                                            type="number"
                                            value={customization.buttonBorderRadius}
                                            onChange={(e) =>
                                                updateCustomization(
                                                    'buttonBorderRadius',
                                                    e.target.value
                                                )
                                            }
                                            placeholder="8"
                                        />
                                    </div>

                                    <div>
                                        <Label htmlFor="popupTitle">
                                            {t('buttonPanel.popupTitleLabel')}
                                        </Label>
                                        <Input
                                            id="popupTitle"
                                            value={customization.popupTitle}
                                            onChange={(e) =>
                                                updateCustomization('popupTitle', e.target.value)
                                            }
                                            placeholder={t('defaults.popupTitle')}
                                        />
                                    </div>
                                </div>

                                {/* Preview */}
                                <div className="mt-4 rounded-lg border bg-white p-4">
                                    <p className="mb-2 text-xs font-medium text-neutral-500">
                                        {t('buttonPanel.previewLabel')}
                                    </p>
                                    <button
                                        style={{
                                            backgroundColor: customization.buttonBgColor,
                                            color: customization.buttonTextColor,
                                            borderRadius: `${customization.buttonBorderRadius}px`,
                                            border: 'none',
                                            padding: '12px 24px',
                                            fontSize: '16px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {customization.buttonText}
                                    </button>
                                </div>
                            </div>

                            {/* Code Output */}
                            <div className="relative">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="absolute right-2 top-2 z-10"
                                    onClick={() => handleCopy(buttonPopupCode, 'button-popup')}
                                >
                                    {copiedSection === 'button-popup' ? (
                                        <>
                                            <Check className="mr-2 size-4" />
                                            {t('copyButton.copied')}
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="mr-2 size-4" />
                                            {t('copyButton.copy')}
                                        </>
                                    )}
                                </Button>
                                <pre className="max-h-96 overflow-auto rounded-lg bg-neutral-900 p-4 text-xs text-neutral-100">
                                    <code>{buttonPopupCode}</code>
                                </pre>
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="iframe" className="mt-4">
                        <div className="grid gap-6 lg:grid-cols-2">
                            {/* Customization Panel */}
                            <div className="space-y-4 rounded-lg border bg-neutral-50 p-4">
                                <h4 className="flex items-center gap-2 font-medium">
                                    <FrameCorners className="size-4" />
                                    {t('iframePanel.heading')}
                                </h4>

                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <Label htmlFor="iframeWidth">
                                                {t('iframePanel.widthLabel')}
                                            </Label>
                                            <Input
                                                id="iframeWidth"
                                                value={customization.iframeWidth}
                                                onChange={(e) =>
                                                    updateCustomization(
                                                        'iframeWidth',
                                                        e.target.value
                                                    )
                                                }
                                                placeholder="100%"
                                            />
                                        </div>

                                        <div>
                                            <Label htmlFor="iframeHeight">
                                                {t('iframePanel.heightLabel')}
                                            </Label>
                                            <Input
                                                id="iframeHeight"
                                                value={customization.iframeHeight}
                                                onChange={(e) =>
                                                    updateCustomization(
                                                        'iframeHeight',
                                                        e.target.value
                                                    )
                                                }
                                                placeholder="600"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Preview */}
                                <div className="mt-4 rounded-lg border bg-white p-4">
                                    <p className="mb-2 text-xs font-medium text-neutral-500">
                                        {t('iframePanel.previewScaledLabel')}
                                    </p>
                                    <div
                                        className="overflow-hidden rounded border bg-neutral-100"
                                        style={{
                                            width: '100%',
                                            height: '150px',
                                        }}
                                    >
                                        <iframe
                                            src={formUrl}
                                            title={t('iframePanel.formPreviewTitle')}
                                            style={{
                                                width: '200%',
                                                height: '300px',
                                                transform: 'scale(0.5)',
                                                transformOrigin: 'top left',
                                                border: 'none',
                                            }}
                                        />
                                    </div>
                                </div>

                                <p className="text-xs text-neutral-500">
                                    {t('iframePanel.tipPrefix')} <code>100%</code>{' '}
                                    {t('iframePanel.tipSuffix')} <code>600</code>.
                                </p>
                            </div>

                            {/* Code Output */}
                            <div className="relative">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="absolute right-2 top-2 z-10"
                                    onClick={() => handleCopy(iframeCode, 'iframe')}
                                >
                                    {copiedSection === 'iframe' ? (
                                        <>
                                            <Check className="mr-2 size-4" />
                                            {t('copyButton.copied')}
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="mr-2 size-4" />
                                            {t('copyButton.copy')}
                                        </>
                                    )}
                                </Button>
                                <pre className="max-h-96 overflow-auto rounded-lg bg-neutral-900 p-4 text-xs text-neutral-100">
                                    <code>{iframeCode}</code>
                                </pre>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};
