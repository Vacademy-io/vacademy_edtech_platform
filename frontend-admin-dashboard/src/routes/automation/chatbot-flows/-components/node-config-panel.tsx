import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatbotFlowStore } from '../-stores/chatbot-flow-store';
import { NODE_TYPE_REGISTRY, VariableMapping } from '@/types/chatbot-flow/chatbot-flow-types';
import {
    fetchWhatsAppTemplates,
    fetchChatbotFlowAiUsage,
    WhatsAppTemplateInfo,
} from '../-services/chatbot-flow-api';
import { getInstituteId } from '@/constants/helper';
import { Plus, Trash, CaretUp, CaretDown } from '@phosphor-icons/react';
import { VariableMappingEditor } from './VariableMappingEditor';
import { AskFieldConfig, CrmLeadCheckConfig, SaveToCrmConfig } from './crm-node-config';

export function NodeConfigPanel() {
    const { t } = useTranslation('automationNodeConfigPanel');
    const selectedNodeId = useChatbotFlowStore((s) => s.selectedNodeId);
    const nodes = useChatbotFlowStore((s) => s.nodes);
    const updateNodeConfig = useChatbotFlowStore((s) => s.updateNodeConfig);
    const updateNodeName = useChatbotFlowStore((s) => s.updateNodeName);

    const selectedNode = nodes.find((n) => n.id === selectedNodeId);
    if (!selectedNode) {
        return (
            <div className="w-80 shrink-0 border-l bg-gray-50 p-4 flex items-center justify-center">
                <p className="text-sm text-gray-400">{t('panel.selectNode')}</p>
            </div>
        );
    }

    const { nodeType, name, config, color } = selectedNode.data;
    const info = NODE_TYPE_REGISTRY.find((n) => n.type === nodeType);

    const handleConfigChange = (keyOrBatch: string | Record<string, unknown>, value?: unknown) => {
        if (typeof keyOrBatch === 'string') {
            updateNodeConfig(selectedNodeId!, { ...config, [keyOrBatch]: value });
        } else {
            // Batch update: merge all keys at once
            updateNodeConfig(selectedNodeId!, { ...config, ...keyOrBatch });
        }
    };

    return (
        <div className="w-80 shrink-0 border-l bg-gray-50 overflow-y-auto">
            {/* Header */}
            <div className="p-4 border-b" style={{ backgroundColor: `${color}10` }}>
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{info?.icon}</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                        {nodeType.replaceAll('_', ' ')}
                    </span>
                </div>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => updateNodeName(selectedNodeId!, e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border rounded bg-white"
                    placeholder={t('panel.nodeNamePlaceholder')}
                />
            </div>

            {/* Config form */}
            <div className="p-4 space-y-4">
                {nodeType === 'TRIGGER' && <TriggerConfig config={config} onChange={handleConfigChange} />}
                {nodeType === 'SEND_MESSAGE' && <SendMessageConfig config={config} onChange={handleConfigChange} />}
                {nodeType === 'SEND_TEMPLATE' && <SendTemplateConfig config={config} onChange={handleConfigChange} />}
                {nodeType === 'SEND_INTERACTIVE' && <SendInteractiveConfig config={config} onChange={handleConfigChange} />}
                {nodeType === 'CONDITION' && <ConditionConfig config={config} onChange={handleConfigChange} nodeId={selectedNodeId!} />}
                {nodeType === 'DELAY' && <DelayConfig config={config} onChange={handleConfigChange} />}
                {nodeType === 'WORKFLOW_ACTION' && <WorkflowConfig config={config} onChange={handleConfigChange} />}
                {nodeType === 'HTTP_WEBHOOK' && <WebhookConfig config={config} onChange={handleConfigChange} />}
                {nodeType === 'AI_RESPONSE' && <AiResponseConfig config={config} onChange={handleConfigChange} />}
                {nodeType === 'CRM_LEAD_CHECK' && (
                    <CrmLeadCheckConfig
                        config={config}
                        onChange={handleConfigChange}
                        nodeId={selectedNodeId!}
                    />
                )}
                {nodeType === 'ASK_FIELD' && (
                    <AskFieldConfig
                        config={config}
                        onChange={handleConfigChange}
                        nodeId={selectedNodeId!}
                    />
                )}
                {nodeType === 'SAVE_TO_CRM' && (
                    <SaveToCrmConfig
                        config={config}
                        onChange={handleConfigChange}
                        nodeId={selectedNodeId!}
                    />
                )}
            </div>
        </div>
    );
}

// ==================== Section Label ====================
function SectionLabel({ children }: { children: React.ReactNode }) {
    return <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">{children}</label>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
    return <label className="block text-xs font-medium text-gray-600 mt-2">{children}</label>;
}

// ==================== TRIGGER ====================
function TriggerConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    return (
        <>
            <SectionLabel>{t('trigger.sectionLabel')}</SectionLabel>
            <FieldLabel>{t('trigger.typeLabel')}</FieldLabel>
            <select value={(config.triggerType as string) || 'KEYWORD_MATCH'} onChange={(e) => onChange('triggerType', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded">
                <option value="KEYWORD_MATCH">{t('trigger.type.keywordMatch')}</option>
                <option value="FIRST_CONTACT">{t('trigger.type.firstContact')}</option>
                <option value="BUTTON_REPLY">{t('trigger.type.buttonReply')}</option>
            </select>

            {config.triggerType !== 'FIRST_CONTACT' && (
                <>
                    <FieldLabel>{t('trigger.keywordsLabel')}</FieldLabel>
                    <input type="text" value={((config.keywords as string[]) || []).join(', ')} onChange={(e) => onChange('keywords', e.target.value.split(',').map((k) => k.trim()).filter(Boolean))} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('trigger.keywordsPlaceholder')} />

                    <FieldLabel>{t('trigger.matchTypeLabel')}</FieldLabel>
                    <select value={(config.matchType as string) || 'contains'} onChange={(e) => onChange('matchType', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded">
                        <option value="exact">{t('trigger.matchType.exact')}</option>
                        <option value="contains">{t('trigger.matchType.contains')}</option>
                        <option value="regex">{t('trigger.matchType.regex')}</option>
                    </select>
                </>
            )}

            <FieldLabel>{t('trigger.priorityLabel')}</FieldLabel>
            <input type="number" value={(config.priority as number) || 10} onChange={(e) => onChange('priority', parseInt(e.target.value) || 10)} className="w-full px-2 py-1.5 text-sm border rounded" min={1} max={100} />
        </>
    );
}

// ==================== SEND_MESSAGE (free-form, no template needed) ====================
function SendMessageConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    const msgType = (config.messageType as string) || 'text';

    return (
        <>
            <SectionLabel>{t('sendMessage.sectionLabel')}</SectionLabel>
            <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">
                {t('sendMessage.noTemplateNotice')}
            </div>

            <FieldLabel>{t('sendMessage.typeLabel')}</FieldLabel>
            <select value={msgType} onChange={(e) => onChange('messageType', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded">
                <option value="text">{t('sendMessage.type.text')}</option>
                <option value="image">{t('sendMessage.type.image')}</option>
                <option value="video">{t('sendMessage.type.video')}</option>
                <option value="document">{t('sendMessage.type.document')}</option>
                <option value="audio">{t('sendMessage.type.audio')}</option>
            </select>

            {msgType === 'text' ? (
                <>
                    <FieldLabel>{t('sendMessage.textLabel')}</FieldLabel>
                    <textarea
                        value={(config.text as string) || ''}
                        onChange={(e) => onChange('text', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border rounded h-24 resize-y"
                        placeholder={t('sendMessage.textPlaceholder', { example: '{{user.name}}' })}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                        {t('sendMessage.formattingHint')}
                    </p>
                    <p className="text-xs text-gray-400">
                        {t('sendMessage.variableHint.prefix')} {'{{variable}}'} {t('sendMessage.variableHint.suffix')} {'{{user.name}}'}, {'{{phone}}'}, {'{{session.varName}}'}
                    </p>
                </>
            ) : (
                <>
                    <FieldLabel>{t('sendMessage.mediaUrlLabel')}</FieldLabel>
                    <input
                        type="text"
                        value={(config.mediaUrl as string) || ''}
                        onChange={(e) => onChange('mediaUrl', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border rounded"
                        placeholder={t('sendMessage.mediaUrlPlaceholder')}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                        {t('sendMessage.mediaUrlHint.prefix')} {'{{variable}}'} {t('sendMessage.mediaUrlHint.suffix')}
                    </p>

                    {msgType !== 'audio' && (
                        <>
                            <FieldLabel>{t('sendMessage.captionLabel')}</FieldLabel>
                            <input
                                type="text"
                                value={(config.mediaCaption as string) || ''}
                                onChange={(e) => onChange('mediaCaption', e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border rounded"
                                placeholder={t('sendMessage.captionPlaceholder')}
                            />
                        </>
                    )}

                    {msgType === 'document' && (
                        <>
                            <FieldLabel>{t('common.filename')}</FieldLabel>
                            <input
                                type="text"
                                value={(config.filename as string) || ''}
                                onChange={(e) => onChange('filename', e.target.value)}
                                className="w-full px-2 py-1.5 text-sm border rounded"
                                placeholder={t('common.filenamePlaceholder')}
                            />
                        </>
                    )}
                </>
            )}

            <SectionLabel>{t('common.variableMappings')}</SectionLabel>
            <p className="text-xs text-gray-400">
                {t('sendMessage.variableMappingsHint.prefix')} {'{{placeholders}}'} {t('sendMessage.variableMappingsHint.suffix')}
            </p>
            <VariableMappingEditor
                variables={(config.variables as VariableMapping[]) || []}
                onChange={(v) => onChange('variables', v)}
            />
        </>
    );
}

// ==================== SEND_TEMPLATE (with picker) ====================
function SendTemplateConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    const [templates, setTemplates] = useState<WhatsAppTemplateInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const loadTemplates = useCallback(async () => {
        setLoading(true);
        try {
            const instituteId = getInstituteId() || '';
            const data = await fetchWhatsAppTemplates(instituteId);
            setTemplates(data);
        } catch { /* ignore */ } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadTemplates(); }, [loadTemplates]);

    const selectedTemplate = templates.find((tpl) => tpl.name === config.templateName);
    const filteredTemplates = templates.filter((tpl) =>
        tpl.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleSelectTemplate = (tmpl: WhatsAppTemplateInfo) => {
        // Build entire config update at once to avoid stale closure issues
        const bodyParams: Array<{ index: number; value: string }> = [];
        for (let i = 1; i <= tmpl.bodyParamCount; i++) {
            bodyParams.push({ index: i, value: '' });
        }

        const headerConfig = (tmpl.headerType !== 'none' && tmpl.headerType !== 'text')
            ? { type: tmpl.headerType, url: '', filename: '' }
            : { type: 'none' };

        let buttonConfig: Array<Record<string, unknown>> = [];
        if (tmpl.buttons && tmpl.buttons.length > 0) {
            buttonConfig = tmpl.buttons
                .filter((b) => b.hasDynamicUrl || b.type === 'QUICK_REPLY')
                .map((b, i) => ({
                    type: b.hasDynamicUrl ? 'url' : 'quick_reply',
                    index: i, urlSuffix: '', payload: '', text: b.text,
                }));
        }

        // Single batch update — avoids stale closure
        onChange({
            templateName: tmpl.name,
            languageCode: tmpl.language || 'en',
            bodyParams,
            headerConfig,
            buttonConfig,
        });
    };

    // Current body params
    const bodyParams = (config.bodyParams as Array<{ index: number; value: string }>) || [];
    const headerConfig = (config.headerConfig as Record<string, string>) || { type: 'none' };
    const buttonConfig = (config.buttonConfig as Array<Record<string, unknown>>) || [];

    return (
        <>
            <SectionLabel>{t('sendTemplate.sectionLabel')}</SectionLabel>

            {/* Template picker */}
            <FieldLabel>{t('sendTemplate.searchLabel')}</FieldLabel>
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('sendTemplate.searchPlaceholder')} />

            {loading ? (
                <p className="text-xs text-gray-400 py-2">{t('sendTemplate.loading')}</p>
            ) : (
                <div className="max-h-40 overflow-y-auto border rounded mt-1">
                    {filteredTemplates.length === 0 ? (
                        <p className="text-xs text-gray-400 p-2">{t('sendTemplate.noResults')}</p>
                    ) : (
                        filteredTemplates.map((tpl) => (
                            <button key={`${tpl.name}-${tpl.language}`} onClick={() => handleSelectTemplate(tpl)} className={`w-full text-left px-2 py-1.5 text-xs hover:bg-blue-50 border-b last:border-0 ${tpl.name === config.templateName ? 'bg-blue-50 font-medium' : ''}`}>
                                <div className="flex justify-between items-center">
                                    <span className="truncate">{tpl.name}</span>
                                    <span className="text-gray-400 ml-1">{tpl.language}</span>
                                </div>
                                {tpl.bodyText && <p className="text-gray-400 truncate mt-0.5">{tpl.bodyText.substring(0, 60)}...</p>}
                            </button>
                        ))
                    )}
                </div>
            )}

            <FieldLabel>{t('sendTemplate.nameLabel')}</FieldLabel>
            <input type="text" value={(config.templateName as string) || ''} onChange={(e) => onChange('templateName', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('sendTemplate.namePlaceholder')} />

            <FieldLabel>{t('sendTemplate.languageLabel')}</FieldLabel>
            <input type="text" value={(config.languageCode as string) || 'en'} onChange={(e) => onChange('languageCode', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('sendTemplate.languagePlaceholder')} />

            {/* Template preview */}
            {selectedTemplate && (
                <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
                    <p className="font-medium text-green-800">{t('sendTemplate.previewLabel')}</p>
                    {selectedTemplate.headerType !== 'none' && (
                        <p className="text-green-600">{t('sendTemplate.previewHeader', { type: selectedTemplate.headerType.toUpperCase() })}</p>
                    )}
                    {selectedTemplate.bodyText && <p className="text-green-700 mt-1 whitespace-pre-wrap">{selectedTemplate.bodyText}</p>}
                    {selectedTemplate.footerText && <p className="text-green-500 mt-1 italic">{selectedTemplate.footerText}</p>}
                    {selectedTemplate.buttons && (
                        <div className="mt-1 space-y-0.5">
                            {selectedTemplate.buttons.map((b, i) => (
                                <span key={i} className="inline-block mr-1 px-2 py-0.5 bg-green-200 rounded text-green-800">{b.text}</span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Header config */}
            {headerConfig.type !== 'none' && (
                <>
                    <SectionLabel>{t('sendTemplate.headerSectionLabel', { type: headerConfig.type })}</SectionLabel>
                    <FieldLabel>{headerConfig.type === 'document' ? t('sendTemplate.headerUrlLabelDocument') : t('sendTemplate.headerUrlLabelGeneric', { type: headerConfig.type })}</FieldLabel>
                    <input type="text" value={headerConfig.url || ''} onChange={(e) => onChange('headerConfig', { ...headerConfig, url: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('sendTemplate.headerUrlPlaceholder')} />
                    {headerConfig.type === 'document' && (
                        <>
                            <FieldLabel>{t('common.filename')}</FieldLabel>
                            <input type="text" value={headerConfig.filename || ''} onChange={(e) => onChange('headerConfig', { ...headerConfig, filename: e.target.value })} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('common.filenamePlaceholder')} />
                        </>
                    )}
                </>
            )}

            {/* Body params */}
            {bodyParams.length > 0 && (
                <>
                    <SectionLabel>{t('sendTemplate.bodyParamsLabel')}</SectionLabel>
                    <p className="text-xs text-gray-400">{t('sendTemplate.bodyParamsHint.prefix')} {'{{variable}}'} {t('sendTemplate.bodyParamsHint.suffix')}</p>
                    {bodyParams.map((p, i) => (
                        <div key={i} className="flex items-center gap-1 mt-1">
                            <span className="text-xs text-gray-500 w-8">{`{{${p.index}}}`}</span>
                            <input type="text" value={p.value} onChange={(e) => {
                                const updated = [...bodyParams];
                                updated[i] = { ...p, value: e.target.value };
                                onChange('bodyParams', updated);
                            }} className="flex-1 px-2 py-1 text-sm border rounded" placeholder={t('sendTemplate.bodyParamPlaceholder', { example: '{{user.name}}' })} />
                        </div>
                    ))}
                    <button onClick={() => onChange('bodyParams', [...bodyParams, { index: bodyParams.length + 1, value: '' }])} className="text-xs text-blue-600 hover:text-blue-800 mt-1 flex items-center gap-1">
                        <Plus size={12} /> {t('sendTemplate.addParameter')}
                    </button>
                </>
            )}

            {/* Button config */}
            {buttonConfig.length > 0 && (
                <>
                    <SectionLabel>{t('sendTemplate.buttonParamsLabel')}</SectionLabel>
                    {buttonConfig.map((btn, i) => (
                        <div key={i} className="p-2 border rounded mt-1 bg-white">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-medium">{(btn.text as string) || t('sendTemplate.buttonFallbackLabel', { index: i })}</span>
                                <span className="text-xs text-gray-400">{btn.type as string}</span>
                            </div>
                            {btn.type === 'url' && (
                                <>
                                    <FieldLabel>{t('sendTemplate.urlSuffixLabel')}</FieldLabel>
                                    <input type="text" value={(btn.urlSuffix as string) || ''} onChange={(e) => {
                                        const updated = [...buttonConfig];
                                        updated[i] = { ...btn, urlSuffix: e.target.value };
                                        onChange('buttonConfig', updated);
                                    }} className="w-full px-2 py-1 text-sm border rounded" placeholder="{{user.trackingId}}" />
                                </>
                            )}
                            {btn.type === 'quick_reply' && (
                                <>
                                    <FieldLabel>{t('sendTemplate.payloadLabel')}</FieldLabel>
                                    <input type="text" value={(btn.payload as string) || ''} onChange={(e) => {
                                        const updated = [...buttonConfig];
                                        updated[i] = { ...btn, payload: e.target.value };
                                        onChange('buttonConfig', updated);
                                    }} className="w-full px-2 py-1 text-sm border rounded" placeholder="INTERESTED_YES" />
                                </>
                            )}
                        </div>
                    ))}
                </>
            )}

            <SectionLabel>{t('common.variableMappings')}</SectionLabel>
            <p className="text-xs text-gray-400">
                {t('sendTemplate.variableMappingsHint.prefix')} {'{{placeholders}}'} {t('sendTemplate.variableMappingsHint.suffix')}
            </p>
            <VariableMappingEditor
                variables={(config.variables as VariableMapping[]) || []}
                onChange={(v) => onChange('variables', v)}
            />
        </>
    );
}

// ==================== SEND_INTERACTIVE ====================
function SendInteractiveConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    const interactiveType = (config.interactiveType as string) || 'button';
    const buttons = (config.buttons as Array<{ id: string; title: string }>) || [];
    const sections = (config.sections as Array<{ title: string; rows: Array<{ id: string; title: string; description: string }> }>) || [];

    return (
        <>
            <SectionLabel>{t('sendInteractive.sectionLabel')}</SectionLabel>
            <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-700">
                {t('sendInteractive.sessionNotice')}
            </div>

            <FieldLabel>{t('sendInteractive.typeLabel')}</FieldLabel>
            <select value={interactiveType} onChange={(e) => onChange('interactiveType', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded">
                <option value="button">{t('sendInteractive.type.button')}</option>
                <option value="list">{t('sendInteractive.type.list')}</option>
            </select>

            <FieldLabel>{t('sendInteractive.bodyLabel')}</FieldLabel>
            <textarea value={(config.body as string) || ''} onChange={(e) => onChange('body', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded h-16 resize-none" placeholder={t('sendInteractive.bodyPlaceholder')} />

            <FieldLabel>{t('sendInteractive.footerLabel')}</FieldLabel>
            <input type="text" value={(config.footer as string) || ''} onChange={(e) => onChange('footer', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('sendInteractive.footerPlaceholder')} />

            {interactiveType === 'button' && (
                <>
                    <SectionLabel>{t('sendInteractive.buttonsLabel')}</SectionLabel>
                    {buttons.map((btn, i) => (
                        <div key={i} className="flex items-center gap-1 mt-1">
                            <input type="text" value={btn.id} onChange={(e) => {
                                const updated = [...buttons];
                                updated[i] = { ...btn, id: e.target.value };
                                onChange('buttons', updated);
                            }} className="w-20 px-2 py-1 text-xs border rounded" placeholder="btn_id" />
                            <input type="text" value={btn.title} onChange={(e) => {
                                const updated = [...buttons];
                                updated[i] = { ...btn, title: e.target.value };
                                onChange('buttons', updated);
                            }} className="flex-1 px-2 py-1 text-xs border rounded" placeholder={t('sendInteractive.buttonTitlePlaceholder')} />
                            <button onClick={() => onChange('buttons', buttons.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600"><Trash size={14} /></button>
                        </div>
                    ))}
                    {buttons.length < 3 && (
                        <button onClick={() => onChange('buttons', [...buttons, { id: `btn_${buttons.length + 1}`, title: '' }])} className="text-xs text-blue-600 hover:text-blue-800 mt-1 flex items-center gap-1">
                            <Plus size={12} /> {t('sendInteractive.addButton')}
                        </button>
                    )}
                </>
            )}

            {interactiveType === 'list' && (
                <>
                    <FieldLabel>{t('sendInteractive.listButtonLabel')}</FieldLabel>
                    <input type="text" value={(config.listButtonText as string) || 'Select'} onChange={(e) => onChange('listButtonText', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('sendInteractive.listButtonPlaceholder')} />

                    <SectionLabel>{t('sendInteractive.sectionsLabel')}</SectionLabel>
                    {sections.map((section, si) => (
                        <div key={si} className="border rounded p-2 mt-1 bg-white">
                            <div className="flex justify-between items-center">
                                <input type="text" value={section.title} onChange={(e) => {
                                    const updated = [...sections];
                                    updated[si] = { ...section, title: e.target.value };
                                    onChange('sections', updated);
                                }} className="flex-1 px-2 py-1 text-xs font-medium border rounded" placeholder={t('sendInteractive.sectionTitlePlaceholder')} />
                                <button onClick={() => onChange('sections', sections.filter((_, j) => j !== si))} className="ml-1 text-red-400 hover:text-red-600"><Trash size={14} /></button>
                            </div>
                            {section.rows.map((row, ri) => (
                                <div key={ri} className="mt-1 ml-2 space-y-0.5">
                                    <div className="flex items-center gap-1">
                                        <input type="text" value={row.title} onChange={(e) => {
                                            const updatedSections = [...sections];
                                            const updatedRows = [...section.rows];
                                            updatedRows[ri] = { ...row, title: e.target.value };
                                            updatedSections[si] = { ...section, rows: updatedRows };
                                            onChange('sections', updatedSections);
                                        }} className="flex-1 px-2 py-0.5 text-xs border rounded" placeholder={t('sendInteractive.rowTitlePlaceholder')} />
                                        <button onClick={() => {
                                            const updatedSections = [...sections];
                                            updatedSections[si] = { ...section, rows: section.rows.filter((_, j) => j !== ri) };
                                            onChange('sections', updatedSections);
                                        }} className="text-red-400"><Trash size={12} /></button>
                                    </div>
                                    <input type="text" value={row.id} onChange={(e) => {
                                        const updatedSections = [...sections];
                                        const updatedRows = [...section.rows];
                                        updatedRows[ri] = { ...row, id: e.target.value };
                                        updatedSections[si] = { ...section, rows: updatedRows };
                                        onChange('sections', updatedSections);
                                    }} className="w-full px-2 py-0.5 text-xs border rounded text-gray-500 bg-gray-50" placeholder={t('sendInteractive.rowIdPlaceholder')} />
                                    <input type="text" value={row.description || ''} onChange={(e) => {
                                        const updatedSections = [...sections];
                                        const updatedRows = [...section.rows];
                                        updatedRows[ri] = { ...row, description: e.target.value };
                                        updatedSections[si] = { ...section, rows: updatedRows };
                                        onChange('sections', updatedSections);
                                    }} className="w-full px-2 py-0.5 text-xs border rounded text-gray-400" placeholder={t('sendInteractive.rowDescriptionPlaceholder')} />
                                </div>
                            ))}
                            <button onClick={() => {
                                const updatedSections = [...sections];
                                updatedSections[si] = { ...section, rows: [...section.rows, { id: `row_${Date.now()}`, title: '', description: '' }] };
                                onChange('sections', updatedSections);
                            }} className="text-xs text-blue-600 mt-1 ml-2 flex items-center gap-1">
                                <Plus size={10} /> {t('sendInteractive.addRow')}
                            </button>
                        </div>
                    ))}
                    <button onClick={() => onChange('sections', [...sections, { title: '', rows: [] }])} className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                        <Plus size={12} /> {t('sendInteractive.addSection')}
                    </button>
                </>
            )}

            <FieldLabel>{t('sendInteractive.fallbackTemplateLabel')}</FieldLabel>
            <input type="text" value={(config.fallbackTemplateName as string) || ''} onChange={(e) => onChange('fallbackTemplateName', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder="fallback_template_name" />
        </>
    );
}

// ==================== CONDITION ====================
function ConditionConfig({ config, onChange, nodeId }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void; nodeId: string }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    const branches = (config.branches as Array<{ id: string; label: string; matchType: string; matchValue: string; isDefault?: boolean }>) || [];
    const nodes = useChatbotFlowStore((s) => s.nodes);
    const edges = useChatbotFlowStore((s) => s.edges);

    // Find the upstream SEND_INTERACTIVE node (parent that connects to this node)
    const upstreamInteractive = (() => {
        const incomingEdge = edges.find((e) => e.target === nodeId);
        if (!incomingEdge) return null;
        const parentNode = nodes.find((n) => n.id === incomingEdge.source);
        if (!parentNode || parentNode.data.nodeType !== 'SEND_INTERACTIVE') return null;
        return parentNode.data.config as Record<string, unknown>;
    })();

    // Extract buttons or list rows from upstream interactive
    const interactiveOptions: Array<{ id: string; title: string }> = (() => {
        if (!upstreamInteractive) return [];
        const type = upstreamInteractive.interactiveType as string;
        if (type === 'button') {
            return (upstreamInteractive.buttons as Array<{ id: string; title: string }>) || [];
        }
        if (type === 'list') {
            const sections = (upstreamInteractive.sections as Array<{ rows: Array<{ id: string; title: string }> }>) || [];
            return sections.flatMap((s) => s.rows || []);
        }
        return [];
    })();

    const importFromInteractive = () => {
        if (!upstreamInteractive || interactiveOptions.length === 0) return;
        const type = upstreamInteractive.interactiveType as string;
        const matchType = type === 'list' ? 'list_id' : 'button_id';
        const conditionType = type === 'list' ? 'LIST_REPLY' : 'BUTTON_REPLY';
        const newBranches = interactiveOptions.map((opt) => ({
            id: `branch_${opt.id}`,
            label: opt.title,
            // Use title as matchValue — WATI returns positional IDs like "0-0" instead of
            // our row IDs, so matching by title is the only reliable cross-provider approach
            matchType: type === 'list' ? 'list_id' : 'button_id',
            matchValue: opt.title,
            isDefault: false,
        }));
        // Add a default fallback branch
        newBranches.push({ id: `branch_default_${Date.now()}`, label: t('condition.defaultBranchLabel'), matchType: 'contains', matchValue: '', isDefault: true });
        onChange({ branches: newBranches, conditionType });
    };

    const addBranch = () => {
        const newBranch = { id: `branch_${Date.now()}`, label: '', matchType: 'contains', matchValue: '', isDefault: false };
        onChange('branches', [...branches, newBranch]);
    };

    const updateBranch = (index: number, field: string, value: unknown) => {
        const updated = [...branches];
        updated[index] = { ...updated[index], [field]: value } as any;
        onChange('branches', updated);
    };

    const removeBranch = (index: number) => {
        onChange('branches', branches.filter((_, i) => i !== index));
    };

    const moveBranch = (index: number, direction: -1 | 1) => {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= branches.length) return;
        const updated = [...branches];
        const temp = updated[index]!;
        updated[index] = updated[newIndex]!;
        updated[newIndex] = temp;
        onChange('branches', updated);
    };

    return (
        <>
            <SectionLabel>{t('condition.sectionLabel')}</SectionLabel>
            <p className="text-xs text-gray-400">{t('condition.hint')}</p>

            <FieldLabel>{t('condition.typeLabel')}</FieldLabel>
            <select value={(config.conditionType as string) || 'USER_RESPONSE'} onChange={(e) => onChange('conditionType', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded">
                <option value="USER_RESPONSE">{t('condition.type.userResponse')}</option>
                <option value="BUTTON_REPLY">{t('condition.type.buttonReply')}</option>
                <option value="LIST_REPLY">{t('condition.type.listReply')}</option>
            </select>

            {interactiveOptions.length > 0 && (
                <button onClick={importFromInteractive} className="mt-2 w-full px-2 py-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded hover:bg-blue-100">
                    {t('condition.importButton', { count: interactiveOptions.length })}
                </button>
            )}

            <div className="space-y-2 mt-2">
                {branches.map((branch, i) => (
                    <div key={branch.id} className={`p-2 border rounded ${branch.isDefault ? 'border-yellow-300 bg-yellow-50' : 'bg-white'}`}>
                        <div className="flex justify-between items-center mb-1">
                            <input type="text" value={branch.label} onChange={(e) => updateBranch(i, 'label', e.target.value)} className="flex-1 px-2 py-0.5 text-xs font-medium border rounded" placeholder={t('condition.branchLabelPlaceholder')} />
                            <div className="flex items-center gap-0.5 ml-1">
                                <button onClick={() => moveBranch(i, -1)} className="text-gray-400 hover:text-gray-600"><CaretUp size={12} /></button>
                                <button onClick={() => moveBranch(i, 1)} className="text-gray-400 hover:text-gray-600"><CaretDown size={12} /></button>
                                <button onClick={() => removeBranch(i)} className="text-red-400 hover:text-red-600"><Trash size={12} /></button>
                            </div>
                        </div>

                        <label className="flex items-center gap-1 text-xs mb-1">
                            <input type="checkbox" checked={branch.isDefault || false} onChange={(e) => updateBranch(i, 'isDefault', e.target.checked)} />
                            {t('condition.defaultCheckboxLabel')}
                        </label>

                        {!branch.isDefault && (
                            <div className="flex gap-1">
                                <select value={branch.matchType || 'contains'} onChange={(e) => updateBranch(i, 'matchType', e.target.value)} className="w-24 px-1 py-0.5 text-xs border rounded">
                                    <option value="exact">{t('condition.matchType.exact')}</option>
                                    <option value="contains">{t('condition.matchType.contains')}</option>
                                    <option value="regex">{t('condition.matchType.regex')}</option>
                                    <option value="button_id">{t('condition.matchType.buttonId')}</option>
                                    <option value="list_id">{t('condition.matchType.listId')}</option>
                                    <option value="payload">{t('condition.matchType.payload')}</option>
                                </select>
                                <input type="text" value={branch.matchValue || ''} onChange={(e) => updateBranch(i, 'matchValue', e.target.value)} className="flex-1 px-2 py-0.5 text-xs border rounded" placeholder={t('condition.matchValuePlaceholder')} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <button onClick={addBranch} className="text-xs text-blue-600 hover:text-blue-800 mt-2 flex items-center gap-1">
                <Plus size={12} /> {t('condition.addBranch')}
            </button>
        </>
    );
}

// ==================== DELAY ====================
function DelayConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    return (
        <>
            <SectionLabel>{t('delay.sectionLabel')}</SectionLabel>
            <FieldLabel>{t('delay.durationLabel')}</FieldLabel>
            <div className="flex gap-2">
                <input type="number" value={(config.delayValue as number) || 5} onChange={(e) => onChange('delayValue', parseInt(e.target.value) || 1)} className="w-20 px-2 py-1.5 text-sm border rounded" min={1} />
                <select value={(config.delayUnit as string) || 'MINUTES'} onChange={(e) => onChange('delayUnit', e.target.value)} className="flex-1 px-2 py-1.5 text-sm border rounded">
                    <option value="SECONDS">{t('delay.unit.seconds')}</option>
                    <option value="MINUTES">{t('delay.unit.minutes')}</option>
                    <option value="HOURS">{t('delay.unit.hours')}</option>
                    <option value="DAYS">{t('delay.unit.days')}</option>
                </select>
            </div>
        </>
    );
}

// ==================== WORKFLOW ====================
function WorkflowConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    return (
        <>
            <SectionLabel>{t('workflow.sectionLabel')}</SectionLabel>
            <FieldLabel>{t('workflow.idLabel')}</FieldLabel>
            <input type="text" value={(config.workflowId as string) || ''} onChange={(e) => onChange('workflowId', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder="workflow-id" />
            <p className="text-xs text-gray-400 mt-1">{t('workflow.contextHint')}</p>
        </>
    );
}

// ==================== HTTP WEBHOOK ====================
function WebhookConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    return (
        <>
            <SectionLabel>{t('webhook.sectionLabel')}</SectionLabel>
            <FieldLabel>{t('webhook.urlLabel')}</FieldLabel>
            <input type="text" value={(config.url as string) || ''} onChange={(e) => onChange('url', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder="https://example.com/webhook" />
            <FieldLabel>{t('webhook.methodLabel')}</FieldLabel>
            <select value={(config.method as string) || 'POST'} onChange={(e) => onChange('method', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
            </select>
            <FieldLabel>{t('webhook.resultVariableLabel')}</FieldLabel>
            <input type="text" value={(config.successVariable as string) || 'webhookResult'} onChange={(e) => onChange('successVariable', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder="webhookResult" />
            <p className="text-xs text-gray-400 mt-1">{t('webhook.resultHint.prefix')} {'{{session.webhookResult}}'} {t('webhook.resultHint.suffix')}</p>
        </>
    );
}

// ==================== AI RESPONSE ====================
/**
 * Every reply this step generates is charged to the institute's AI credits, and the
 * engine refuses to call the model once they run out — so the author needs to see the
 * funding state here, next to the step that spends it, not only on the flows list.
 */
function AiCreditsNotice() {
    const { t } = useTranslation('automationNodeConfigPanel');
    const [state, setState] = useState<{ enabled: boolean; balance: number | null } | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchChatbotFlowAiUsage()
            .then((usage) => {
                if (!cancelled) setState({ enabled: usage.aiEnabled, balance: usage.currentBalance });
            })
            // Unknown funding state renders nothing: a false alarm here would send admins
            // hunting a billing problem they don't have.
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    if (!state) return null;

    if (!state.enabled) {
        return (
            <div className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                <span className="font-medium">{t('aiCredits.outOfCreditsTitle')}</span> {t('aiCredits.outOfCreditsBody')}
            </div>
        );
    }

    return (
        <p className="mb-2 text-xs text-gray-500">
            {t('aiCredits.spendNotice')}
            {state.balance != null && <> {t('aiCredits.balance', { balance: state.balance.toFixed(2) })}</>}
        </p>
    );
}

function AiResponseConfig({ config, onChange }: { config: Record<string, unknown>; onChange: (keyOrBatch: string | Record<string, unknown>, value?: unknown) => void }) {
    const { t } = useTranslation('automationNodeConfigPanel');
    return (
        <>
            <SectionLabel>{t('aiResponse.sectionLabel')}</SectionLabel>
            <AiCreditsNotice />
            <FieldLabel>{t('aiResponse.modelLabel')}</FieldLabel>
            {/* No model = the platform default: admin-core resolves the 'chatbot_flow' use case
                (GLM 5.3 Flash unless a super admin changes it). An explicit pick still wins. */}
            <select value={(config.modelId as string) || ''} onChange={(e) => onChange('modelId', e.target.value || undefined)} className="w-full px-2 py-1.5 text-sm border rounded">
                <option value="">{t('aiResponse.model.platformDefault')}</option>
                <option value="google/gemini-2.0-flash">{t('aiResponse.model.gemini20Flash')}</option>
                <option value="google/gemini-2.5-flash">{t('aiResponse.model.gemini25Flash')}</option>
                <option value="google/gemini-2.5-pro">{t('aiResponse.model.gemini25Pro')}</option>
                <option value="anthropic/claude-3.5-sonnet">{t('aiResponse.model.claude35Sonnet')}</option>
                <option value="openai/gpt-4o-mini">{t('aiResponse.model.gpt4oMini')}</option>
                <option value="deepseek/deepseek-v3.2">{t('aiResponse.model.deepseekV32')}</option>
            </select>

            <FieldLabel>{t('aiResponse.systemPromptLabel')}</FieldLabel>
            <textarea value={(config.systemPrompt as string) || ''} onChange={(e) => onChange('systemPrompt', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded h-24 resize-y" placeholder={t('aiResponse.systemPromptPlaceholder', { example: '{{institute.name}}' })} />

            <div className="flex gap-2 mt-2">
                <div className="flex-1">
                    <FieldLabel>{t('aiResponse.maxTokensLabel')}</FieldLabel>
                    <input type="number" value={(config.maxTokens as number) || 500} onChange={(e) => onChange('maxTokens', parseInt(e.target.value) || 500)} className="w-full px-2 py-1.5 text-sm border rounded" min={50} max={4096} />
                </div>
                <div className="flex-1">
                    <FieldLabel>{t('aiResponse.maxTurnsLabel')}</FieldLabel>
                    <input type="number" value={(config.maxTurns as number) || 10} onChange={(e) => onChange('maxTurns', parseInt(e.target.value) || 10)} className="w-full px-2 py-1.5 text-sm border rounded" min={1} max={50} />
                </div>
            </div>

            <FieldLabel>{t('aiResponse.temperatureLabel')}</FieldLabel>
            <input type="range" min={0} max={1} step={0.1} value={(config.temperature as number) || 0.7} onChange={(e) => onChange('temperature', parseFloat(e.target.value))} className="w-full" />
            <span className="text-xs text-gray-500">{(config.temperature as number) || 0.7}</span>

            <FieldLabel>{t('aiResponse.exitKeywordsLabel')}</FieldLabel>
            <input type="text" value={((config.exitKeywords as string[]) || []).join(', ')} onChange={(e) => onChange('exitKeywords', e.target.value.split(',').map((k) => k.trim()).filter(Boolean))} className="w-full px-2 py-1.5 text-sm border rounded" placeholder="agent, human, stop" />

            <FieldLabel>{t('aiResponse.fallbackMessageLabel')}</FieldLabel>
            <input type="text" value={(config.fallbackMessage as string) || ''} onChange={(e) => onChange('fallbackMessage', e.target.value)} className="w-full px-2 py-1.5 text-sm border rounded" placeholder={t('aiResponse.fallbackMessagePlaceholder')} />

            <SectionLabel>{t('aiResponse.unsureSectionLabel')}</SectionLabel>
            <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={config.escalateWhenUnsure !== false} onChange={(e) => onChange('escalateWhenUnsure', e.target.checked)} className="rounded" />
                <span className="text-sm">{t('aiResponse.escalateCheckboxLabel')}</span>
            </label>
            {config.escalateWhenUnsure !== false && (
                <>
                    <FieldLabel>{t('aiResponse.handoverMessageLabel')}</FieldLabel>
                    <textarea
                        value={(config.escalationMessage as string) || ''}
                        onChange={(e) => onChange('escalationMessage', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border rounded h-16 resize-y"
                        placeholder={t('aiResponse.handoverMessagePlaceholder')}
                    />
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 mt-1">
                        {t('aiResponse.escalationNotice.prefix')}{' '}
                        <b>{t('aiResponse.escalationNotice.unanswered')}</b>{' '}
                        {t('aiResponse.escalationNotice.middle')}{' '}
                        <b>{t('aiResponse.escalationNotice.flowSettings')}</b>{' '}
                        {t('aiResponse.escalationNotice.suffix')}
                    </div>
                </>
            )}

            <SectionLabel>{t('aiResponse.interactiveSectionLabel')}</SectionLabel>
            <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={(config.enableInteractive as boolean) || false} onChange={(e) => onChange('enableInteractive', e.target.checked)} className="rounded" />
                <span className="text-sm">{t('aiResponse.interactiveCheckboxLabel')}</span>
            </label>
            {config.enableInteractive && (
                <div className="p-2 bg-teal-50 border border-teal-200 rounded text-xs text-teal-700 mt-1">
                    {t('aiResponse.interactiveNotice')}
                </div>
            )}
        </>
    );
}
