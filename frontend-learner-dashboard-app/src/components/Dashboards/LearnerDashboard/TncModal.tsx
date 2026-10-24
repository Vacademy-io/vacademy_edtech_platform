import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { PdfViewerComponent } from '@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/pdf-viewer-component';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { ACCEPT_TNC, BASE_URL } from '@/constants/urls';
import { useInstituteFeatureStore } from '@/stores/insititute-feature-store';
import { fetchUserData } from '@/routes/dashboard/-lib/utils';

interface TncModalProps {
    tncUrl: string;
    onAccepted: () => void;
    prefillName?: boolean;
}

const TNC_SETTING_KEY = 'STUDENT_TNC_SETTING';

export function TncModal({ tncUrl, onAccepted, prefillName: prefillNameProp = false }: TncModalProps) {
    const { t } = useTranslation('dashboard');
    const { instituteId } = useInstituteFeatureStore();
    const [hasRead, setHasRead] = useState(false);
    const [name, setName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLocked, setIsLocked] = useState<boolean>(prefillNameProp);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            // Resolve whether prefill is enabled: prop wins if true, else fetch the T&C setting directly.
            let shouldPrefill = prefillNameProp;
            if (!shouldPrefill) {
                try {
                    const userData = await fetchUserData();
                    const resolvedInstituteId = instituteId || userData?.institute_id;
                    if (resolvedInstituteId) {
                        const res = await authenticatedAxiosInstance.get<{
                            data: { prefillLearnerName?: boolean } | null;
                        }>(`${BASE_URL}/admin-core-service/institute/setting/v1/get`, {
                            params: { instituteId: resolvedInstituteId, settingKey: TNC_SETTING_KEY },
                        });
                        shouldPrefill = Boolean(res.data?.data?.prefillLearnerName);
                    }
                } catch (error) {
                    console.error('Failed to fetch T&C prefill setting:', error);
                }
            }

            if (cancelled) return;
            setIsLocked(shouldPrefill);

            if (!shouldPrefill) return;

            try {
                const userData = await fetchUserData();
                const fullName = userData?.full_name?.trim();
                if (!cancelled && fullName) {
                    setName(fullName);
                }
            } catch (error) {
                console.error('Failed to prefill learner name:', error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [prefillNameProp, instituteId]);

    const handleAccept = async () => {
        if (!hasRead) {
            toast.error(t('tnc.toast.needConfirmRead'));
            return;
        }
        if (!name.trim()) {
            toast.error(t('tnc.toast.needName'));
            return;
        }

        setIsSubmitting(true);
        try {
            await authenticatedAxiosInstance.post(ACCEPT_TNC, {
                institute_id: instituteId || '',
                name: name.trim()
            });
            toast.success(t('tnc.toast.success'));
            onAccepted();
        } catch (error) {
            console.error('Failed to accept T&C:', error);
            toast.error(t('tnc.toast.failure'));
            setIsSubmitting(false); // we keep modal open to let them retry
        }
    };

    return (
        <Dialog open={true} onOpenChange={() => {}}>
            <DialogContent className="max-w-4xl h-screen-90 flex flex-col p-4 bg-white" onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle className="text-xl">{t('tnc.title')}</DialogTitle>
                    <DialogDescription>
                        {t('tnc.description')}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0 border rounded-md relative bg-gray-50 flex flex-col">
                    <PdfViewerComponent
                        pdfUrl={tncUrl}
                        handleDocumentLoad={() => {}}
                        handlePageChange={() => {}}
                    />
                    <div className="absolute inset-x-0 bottom-0 pointer-events-none p-4 bg-gradient-to-t from-white/90 to-transparent flex justify-center pb-8 opacity-0 hover:opacity-100 transition-opacity">
                        <span className="bg-black/60 text-white px-3 py-1 text-xs rounded-full pointer-events-auto shadow-sm">
                            {t('tnc.scrollToRead')}
                        </span>
                    </div>
                </div>

                <div className="pt-4 border-t space-y-4">
                    <div className="flex items-center space-x-2">
                        <Checkbox
                            id="tnc-read-check"
                            checked={hasRead}
                            onCheckedChange={(checked) => setHasRead(checked as boolean)}
                        />
                        <Label htmlFor="tnc-read-check" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            {t('tnc.readAgree')}
                        </Label>
                    </div>

                    {hasRead && (
                        <div className="rounded-md bg-primary-50 p-4 border border-primary-100 animate-in fade-in slide-in-from-bottom-2">
                            <Label htmlFor="tnc-name" className="text-sm font-medium text-primary-900 mb-1.5 block">
                                {t('tnc.digitalSignature')}
                            </Label>
                            <Input
                                id="tnc-name"
                                placeholder={t('tnc.namePlaceholder')}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="bg-white"
                                autoFocus={!isLocked}
                                readOnly={isLocked}
                                aria-readonly={isLocked}
                            />
                            <p className="text-xs text-primary-600 mt-2">
                                {isLocked
                                    ? t('tnc.signaturePrefilled')
                                    : t('tnc.signatureManual')}
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter className="mt-2">
                    <Button
                        disabled={!hasRead || !name.trim() || isSubmitting}
                        onClick={handleAccept}
                        className="w-full sm:w-auto"
                    >
                        {isSubmitting ? t('tnc.accepting') : t('tnc.acceptButton')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
