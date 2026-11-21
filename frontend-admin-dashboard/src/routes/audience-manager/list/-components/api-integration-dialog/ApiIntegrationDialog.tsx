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
import { Check, Copy, Code, FileText } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CampaignItem } from '../../-services/get-campaigns-list';
import { generateCurlCommand } from '../../-services/submit-audience-lead';
import { SUBMIT_AUDIENCE_LEAD_URL } from '@/constants/urls';
import { useGetCampaignById } from '../../-hooks/useGetCampaignById';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';

interface ApiIntegrationDialogProps {
    isOpen: boolean;
    onClose: () => void;
    campaign: CampaignItem;
}

export const ApiIntegrationDialog = ({ isOpen, onClose, campaign }: ApiIntegrationDialogProps) => {
    const { t } = useTranslation('audienceManagerApiIntegrationDialog');
    const [copiedSection, setCopiedSection] = useState<string | null>(null);
    const { instituteDetails } = useInstituteDetailsStore();

    const campaignId = campaign.id || campaign.campaign_id || campaign.audience_id || '';
    const instituteId = instituteDetails?.id || campaign.institute_id || '';

    // The campaigns-list endpoint doesn't return institute_custom_fields (only
    // get-by-id does), so fetch the full campaign when the prop lacks them —
    // same fallback pattern as LeadBulkImportDialog.
    const needsFetch = !campaign.institute_custom_fields?.length;
    const { data: fetchedCampaign } = useGetCampaignById({
        instituteId,
        audienceId: campaignId,
        enabled: isOpen && needsFetch,
    });

    const customFieldsSource = campaign.institute_custom_fields?.length
        ? campaign.institute_custom_fields
        : (fetchedCampaign as CampaignItem | undefined)?.institute_custom_fields;

    // Extract custom fields from campaign
    const customFields = useMemo(() => {
        if (!customFieldsSource) return [];
        return customFieldsSource.map((field: any) => ({
            id: field.custom_field?.id || field.id,
            fieldName: field.custom_field?.fieldName || field.custom_field?.field_name || '',
            fieldKey: field.custom_field?.fieldKey || field.custom_field?.field_key || '',
            fieldType: field.custom_field?.fieldType || field.custom_field?.field_type || 'TEXT',
            isMandatory: field.custom_field?.isMandatory ?? true,
        }));
    }, [customFieldsSource]);

    const curlCommand = useMemo(() => {
        return generateCurlCommand(campaignId, customFields);
    }, [campaignId, customFields]);

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

    const documentationMarkdown = `
## ${t('markdown.guideHeading')}

### ${t('markdown.endpointHeading')}
\`\`\`
POST ${SUBMIT_AUDIENCE_LEAD_URL}
\`\`\`

### ${t('markdown.headersHeading')}
| ${t('markdown.headersTable.header')} | ${t('markdown.headersTable.value')} |
|--------|-------|
| Content-Type | application/json |
| Accept | application/json |

### ${t('markdown.requestBodyHeading')}

\`\`\`json
{
  "audience_id": "${campaignId}",
  "source_type": "AUDIENCE_CAMPAIGN",
  "source_id": "${campaignId}",
  "custom_field_values": {
    // Key-value pairs where key is field ID
${customFields.map((f) => `    "${f.id}": "<value>" // ${f.fieldName}${f.isMandatory ? ' (Required)' : ''}`).join('\n')}
  },
  "user_dto": {
    "username": "<email>",
    "email": "<email>",
    "full_name": "<full_name>",
    "mobile_number": "<phone_with_country_code>"
  }
}
\`\`\`

### ${t('markdown.customFieldsHeading')}

| ${t('markdown.customFieldsTable.fieldId')} | ${t('markdown.customFieldsTable.fieldName')} | ${t('markdown.customFieldsTable.type')} | ${t('markdown.customFieldsTable.required')} |
|----------|------------|------|----------|
${customFields.map((f) => `| \`${f.id}\` | ${f.fieldName} | ${f.fieldType} | ${f.isMandatory ? t('common.yes') : t('common.no')} |`).join('\n')}

### ${t('markdown.responseHeading')}

**${t('markdown.successLabel')} (200 OK)**
\`\`\`json
{
  "success": true,
  "response_id": "<generated_response_id>"
}
\`\`\`

**${t('markdown.errorLabel')} (4xx/5xx)**
\`\`\`json
{
  "error": "<error_message>"
}
\`\`\`

### ${t('markdown.integrationExamplesHeading')}

#### ${t('markdown.zapierHeading')}
1. ${t('markdown.zapierSteps.createZap')}
2. ${t('markdown.zapierSteps.chooseTrigger')}
3. ${t('markdown.zapierSteps.addWebhooks')}
4. ${t('markdown.zapierSteps.selectPostMethod')}
5. ${t('markdown.zapierSteps.pasteUrl')}
6. ${t('markdown.zapierSteps.setContentType')}
7. ${t('markdown.zapierSteps.mapFields')}

#### ${t('markdown.makeHeading')}
1. ${t('markdown.makeSteps.createScenario')}
2. ${t('markdown.makeSteps.addTrigger')}
3. ${t('markdown.makeSteps.addHttpModule')}
4. ${t('markdown.makeSteps.configure')}
`;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-dialog-tall w-dialog-xl overflow-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Code className="size-5" />
                        {t('dialogTitle', { campaignName: campaign.campaign_name })}
                    </DialogTitle>
                    <DialogDescription>{t('dialogDescription')}</DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="curl" className="mt-4">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="curl" className="flex items-center gap-2">
                            <Code className="size-4" />
                            {t('tabs.curl')}
                        </TabsTrigger>
                        <TabsTrigger value="docs" className="flex items-center gap-2">
                            <FileText className="size-4" />
                            {t('tabs.docs')}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="curl" className="mt-4">
                        <div className="relative">
                            <Button
                                variant="outline"
                                size="sm"
                                className="absolute right-2 top-2 z-10"
                                onClick={() => handleCopy(curlCommand, 'curl')}
                            >
                                {copiedSection === 'curl' ? (
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
                            <pre className="max-h-96 overflow-auto rounded-lg bg-neutral-900 p-4 text-sm text-neutral-100">
                                <code>{curlCommand}</code>
                            </pre>
                        </div>
                        <p className="mt-3 text-sm text-neutral-600">
                            {t('curlTab.replaceHintPrefix')}{' '}
                            <code className="rounded bg-neutral-100 px-1">&lt;email&gt;</code>
                            {t('curlTab.replaceHintSuffix')}
                        </p>
                    </TabsContent>

                    <TabsContent value="docs" className="mt-4">
                        <div className="relative">
                            <Button
                                variant="outline"
                                size="sm"
                                className="absolute right-2 top-2 z-10"
                                onClick={() => handleCopy(documentationMarkdown, 'docs')}
                            >
                                {copiedSection === 'docs' ? (
                                    <>
                                        <Check className="mr-2 size-4" />
                                        {t('copyButton.copied')}
                                    </>
                                ) : (
                                    <>
                                        <Copy className="mr-2 size-4" />
                                        {t('copyButton.copyMarkdown')}
                                    </>
                                )}
                            </Button>
                            <div className="prose prose-sm max-h-96 max-w-none overflow-auto rounded-lg border bg-white p-4">
                                <h2 className="text-lg font-semibold">{t('docsPanel.heading')}</h2>

                                <h3 className="mt-4 text-base font-medium">
                                    {t('docsPanel.endpointHeading')}
                                </h3>
                                <code className="block rounded bg-neutral-100 p-2 text-sm">
                                    POST {SUBMIT_AUDIENCE_LEAD_URL}
                                </code>

                                <h3 className="mt-4 text-base font-medium">
                                    {t('docsPanel.headersHeading')}
                                </h3>
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="py-2 text-start">
                                                {t('docsPanel.headersTable.header')}
                                            </th>
                                            <th className="py-2 text-start">
                                                {t('docsPanel.headersTable.value')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="py-1">Content-Type</td>
                                            <td className="py-1">application/json</td>
                                        </tr>
                                        <tr>
                                            <td className="py-1">Accept</td>
                                            <td className="py-1">application/json</td>
                                        </tr>
                                    </tbody>
                                </table>

                                <h3 className="mt-4 text-base font-medium">
                                    {t('docsPanel.customFieldsHeading')}
                                </h3>
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="border-b">
                                            <th className="py-2 text-start">
                                                {t('docsPanel.customFieldsTable.fieldId')}
                                            </th>
                                            <th className="py-2 text-start">
                                                {t('docsPanel.customFieldsTable.name')}
                                            </th>
                                            <th className="py-2 text-start">
                                                {t('docsPanel.customFieldsTable.type')}
                                            </th>
                                            <th className="py-2 text-start">
                                                {t('docsPanel.customFieldsTable.required')}
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {customFields.map((field) => (
                                            <tr key={field.id} className="border-b">
                                                <td className="py-1">
                                                    <code className="text-xs">{field.id}</code>
                                                </td>
                                                <td className="py-1">{field.fieldName}</td>
                                                <td className="py-1">{field.fieldType}</td>
                                                <td className="py-1">
                                                    {field.isMandatory
                                                        ? t('common.yes')
                                                        : t('common.no')}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                <h3 className="mt-4 text-base font-medium">
                                    {t('docsPanel.integrationExamplesHeading')}
                                </h3>
                                <div className="rounded-lg bg-blue-50 p-3">
                                    <p className="font-medium text-blue-800">
                                        {t('docsPanel.zapierHeading')}
                                    </p>
                                    <ol className="mt-2 list-decimal pl-4 text-blue-700">
                                        <li>{t('docsPanel.zapierSteps.createZap')}</li>
                                        <li>{t('docsPanel.zapierSteps.chooseTrigger')}</li>
                                        <li>{t('docsPanel.zapierSteps.addWebhooks')}</li>
                                        <li>{t('docsPanel.zapierSteps.selectPostMethod')}</li>
                                        <li>{t('docsPanel.zapierSteps.pasteUrl')}</li>
                                        <li>{t('docsPanel.zapierSteps.mapFields')}</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};
