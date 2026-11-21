import { useTranslation } from 'react-i18next';
import { NODE_TYPE_REGISTRY, ChatbotNodeType } from '@/types/chatbot-flow/chatbot-flow-types';
import { useChatbotFlowStore } from '../-stores/chatbot-flow-store';

export function NodePalette() {
    const { t } = useTranslation('automationNodePalette');
    const addNode = useChatbotFlowStore((s) => s.addNode);

    return (
        <div className="w-56 shrink-0 border-r bg-gray-50 p-3 overflow-y-auto">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                {t('heading')}
            </h3>
            <div className="space-y-2">
                {NODE_TYPE_REGISTRY.map((info) => (
                    <button
                        key={info.type}
                        onClick={() => addNode(info.type as ChatbotNodeType)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all text-left"
                    >
                        <span
                            className="w-8 h-8 rounded-md flex items-center justify-center text-lg"
                            style={{ backgroundColor: `${info.color}20` }}
                        >
                            {info.icon}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{info.label}</p>
                            <p className="text-xs text-gray-500 truncate">{info.description}</p>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    );
}
