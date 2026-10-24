import { createLazyFileRoute, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlowBuilder } from './-components/flow-builder';
import { useChatbotFlowStore } from './-stores/chatbot-flow-store';
import { getChatbotFlow } from './-services/chatbot-flow-api';
import { getInstituteId } from '@/constants/helper';
import { toast } from 'sonner';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';

export const Route = createLazyFileRoute('/automation/chatbot-flows/$flowId')({
    component: ChatbotFlowBuilderWrapper,
});

function ChatbotFlowBuilderWrapper() {
    const { t } = useTranslation('automationFlowIdIndex');
    const { flowId } = useParams({ from: '/automation/chatbot-flows/$flowId' });
    const loadFlow = useChatbotFlowStore((s) => s.loadFlow);
    const reset = useChatbotFlowStore((s) => s.reset);
    const setInstituteId = useChatbotFlowStore((s) => s.setInstituteId);

    useEffect(() => {
        const instituteId = getInstituteId() || '';

        if (flowId === 'new') {
            reset();
            queueMicrotask(() => setInstituteId(instituteId));
        } else {
            getChatbotFlow(flowId)
                .then((data) => {
                    loadFlow(data);
                })
                .catch((err) => {
                    toast.error(t('toast.loadFailed'));
                    console.error(err);
                });
        }

        return () => {
            reset();
        };
    }, [flowId, loadFlow, reset, setInstituteId, t]);

    return (
        <LayoutContainer intrnalMargin={false}>
            <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
                <FlowBuilder />
            </div>
        </LayoutContainer>
    );
}
