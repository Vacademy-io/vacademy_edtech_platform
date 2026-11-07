import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { InviteLinkFormValues } from '../GenerateInviteLinkSchema';
import { CodeSimple } from '@phosphor-icons/react';

interface InviteViaEmailCardProps {
    form: UseFormReturn<InviteLinkFormValues>;
}

const CustomHTMLCard = ({ form }: InviteViaEmailCardProps) => {
    const { t } = useTranslation('manageStudentsCustomHTMLCard');
    return (
        <Card className="mb-4">
            <CardHeader>
                <div className="flex items-center gap-2">
                    <div>
                        <div className="flex items-center gap-2">
                            <CodeSimple size={22} />
                            <CardTitle className="text-2xl font-bold">{t('card.title')}</CardTitle>
                        </div>
                        <span className="text-sm text-gray-600">{t('card.helperText')}</span>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Textarea
                    value={form.watch('customHtml') ?? ''}
                    onChange={(e) => form.setValue('customHtml', e.target.value)}
                    placeholder={t('textarea.placeholder')}
                    rows={5}
                    className="font-mono text-sm"
                />
            </CardContent>
        </Card>
    );
};

export default CustomHTMLCard;
