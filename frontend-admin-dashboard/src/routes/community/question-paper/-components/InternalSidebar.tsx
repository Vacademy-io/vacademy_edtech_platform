import { MyButton } from '@/components/design-system/button';
import { getTageByQuestionPaperId, addPublicQuestionPaperToPrivate } from '../-service/utils';
import { useEffect, useState } from 'react';
import { QuestionPaperData } from '@/types/community/filters/types';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export function InternalSidebar({ id }: { id: string }) {
    const { t } = useTranslation('communityInternalSidebar');
    const [data, setData] = useState<QuestionPaperData>();
    const fetch = async () => {
        const responseData = await getTageByQuestionPaperId(id);
        setData(responseData);
    };
    useEffect(() => {
        fetch();
    }, []);

    const addToPrivateQuestionBank = async () => {
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const tokenData = getTokenDecodedData(accessToken);
        const INSTITUTE_ID = tokenData && Object.keys(tokenData.authorities)[0];
        let response;
        if (INSTITUTE_ID) response = await addPublicQuestionPaperToPrivate(INSTITUTE_ID, id);
        if (response) toast.message(t('addedToPrivateCollection'));
        else toast.error(t('errorOccurred'));
    };
    return (
        <div className="sticky top-[72px] flex max-h-[calc(100vh-72px)] w-[300px] flex-col justify-between border-r p-4">
            <div>
                {/* TODO : Add image when available */}
                {/* <div className="size-full w-full rounded-md"></div> */}
                <div className="flex flex-col gap-2">
                    <div className="text-title font-bold">{data?.questionPaper.title}</div>
                    <div className="flex flex-row flex-wrap gap-3">
                        {data?.tags.map((tag) => (
                            <div
                                key={tag.tagId}
                                className="w-fit cursor-pointer rounded-md border p-2"
                            >
                                {tag.tagName}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            <div className="flex flex-col gap-4">
                <MyButton buttonType="secondary">{t('share')}</MyButton>
                <MyButton buttonType="primary" onClick={addToPrivateQuestionBank}>
                    {t('addToQuestionBank')}
                </MyButton>
            </div>
        </div>
    );
}
