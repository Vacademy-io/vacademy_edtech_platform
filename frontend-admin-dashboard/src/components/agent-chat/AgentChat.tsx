import React, { useState, useRef, useEffect } from 'react';
import { useAgent } from '@/hooks/useAgent';
import { AgentMessage, ConfirmationOption } from '@/types/agent';
import { useAIModelsList } from '@/hooks/useAiModels'; // Added import
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    PaperPlaneRight,
    ArrowClockwise,
    Robot,
    User,
    Wrench,
    SpinnerGap,
    Warning,
    CheckCircle,
    XCircle,
    ChatCircleDots,
} from '@phosphor-icons/react';

/**
 * Select value for "no pick": the request then carries no model and admin-core uses the
 * 'admin_agent' row in ai_model_defaults (GLM 5.3 Flash by default). Radix Select does not
 * allow an empty-string item value, hence the sentinel.
 */
const PLATFORM_DEFAULT_MODEL = '__platform_default__';

interface AgentChatProps {
    instituteId: string;
    authToken: string;
}

export function AgentChat({ instituteId, authToken }: AgentChatProps) {
    const { sessionId, status, messages, error, sendMessage, respond, reset, setAuthToken } =
        useAgent(instituteId);

    const { data: modelsList } = useAIModelsList({ category: 'general' });
    const [input, setInput] = useState('');
    const [selectedModel, setSelectedModel] = useState<string>(PLATFORM_DEFAULT_MODEL);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Set auth token on mount
    useEffect(() => {
        setAuthToken(authToken);
    }, [authToken, setAuthToken]);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || status === 'processing' || status === 'connecting') return;

        // Only an explicit pick is sent; otherwise the platform default decides.
        sendMessage(
            input.trim(),
            selectedModel === PLATFORM_DEFAULT_MODEL ? undefined : selectedModel
        );
        setInput('');
    };

    const handleConfirmation = (option: ConfirmationOption) => {
        respond(option.label, option.id);
    };

    const handleTextResponse = () => {
        if (!input.trim()) return;
        respond(input.trim());
        setInput('');
    };

    const isInputDisabled = status === 'processing' || status === 'connecting';

    return (
        <Card className="flex h-[calc(100vh-180px)] min-h-[500px] flex-col overflow-hidden border-none shadow-lg">
            {/* Header */}
            <CardHeader className="shrink-0 border-b bg-gradient-to-r from-primary-500 to-primary-600 px-4 py-3 text-white sm:px-6 sm:py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                            <Robot size={24} weight="duotone" />
                        </div>
                        <div>
                            <CardTitle className="text-lg font-semibold text-white">
                                AI Assistant
                            </CardTitle>
                            <p className="text-xs text-white/80">
                                {status === 'idle' && 'Ready to help'}
                                {status === 'connecting' && 'Connecting...'}
                                {status === 'processing' && 'Thinking...'}
                                {status === 'awaiting_input' && 'Awaiting your response'}
                                {status === 'complete' && 'Completed'}
                                {status === 'error' && 'Error occurred'}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                        <Select
                            value={selectedModel}
                            onValueChange={setSelectedModel}
                            disabled={isInputDisabled}
                        >
                            <SelectTrigger className="h-9 w-[180px] border-white/30 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20">
                                <SelectValue placeholder="Select model" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={PLATFORM_DEFAULT_MODEL}>
                                    <div className="flex flex-col">
                                        <span className="font-medium">Platform default</span>
                                        <span className="text-xs text-muted-foreground">
                                            GLM 5.3 Flash
                                        </span>
                                    </div>
                                </SelectItem>
                                {modelsList?.models.map((model) => (
                                    <SelectItem key={model.model_id} value={model.model_id}>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{model.name}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {model.description || model.provider}
                                            </span>
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {sessionId && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={reset}
                                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
                            >
                                <ArrowClockwise size={16} className="mr-1" />
                                New Chat
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>

            {/* Messages Area */}
            <CardContent className="flex-1 overflow-hidden p-0">
                <ScrollArea className="h-full p-4">
                    <div className="flex flex-col gap-4">
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-16 text-center">
                                <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-primary-50">
                                    <ChatCircleDots
                                        size={32}
                                        weight="duotone"
                                        className="text-primary-500"
                                    />
                                </div>
                                <h3 className="mb-2 text-lg font-semibold text-neutral-700">
                                    👋 Hi! I&apos;m your AI assistant
                                </h3>
                                <p className="max-w-sm text-sm text-neutral-500">
                                    Ask me anything about your institute. I can help with learner
                                    data, reports, and more.
                                </p>
                                <div className="mt-6 flex flex-wrap justify-center gap-2">
                                    <Badge
                                        variant="secondary"
                                        className="cursor-pointer hover:bg-primary-100"
                                        onClick={() => setInput('Show me learner enrollment stats')}
                                    >
                                        Show me learner enrollment stats
                                    </Badge>
                                    <Badge
                                        variant="secondary"
                                        className="cursor-pointer hover:bg-primary-100"
                                        onClick={() => setInput('Get course progress report')}
                                    >
                                        Get course progress report
                                    </Badge>
                                </div>
                            </div>
                        )}

                        {messages.map((msg) => (
                            <MessageBubble
                                key={msg.id}
                                message={msg}
                                onConfirm={handleConfirmation}
                            />
                        ))}

                        {/* Status Indicators */}
                        {(status === 'connecting' || status === 'processing') && (
                            <div className="flex items-center justify-center gap-2 py-4">
                                <SpinnerGap size={20} className="animate-spin text-primary-500" />
                                <span className="text-sm text-neutral-500">
                                    {status === 'connecting'
                                        ? 'Connecting...'
                                        : 'Agent is thinking...'}
                                </span>
                            </div>
                        )}

                        {error && (
                            <div className="mx-auto flex max-w-md items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3">
                                <Warning size={20} className="text-danger-500" />
                                <span className="text-sm text-danger-700">{error}</span>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                </ScrollArea>
            </CardContent>

            {/* Input Area */}
            <div className="shrink-0 border-t bg-white p-4">
                <form
                    onSubmit={
                        status === 'awaiting_input'
                            ? (e) => {
                                  e.preventDefault();
                                  handleTextResponse();
                              }
                            : handleSubmit
                    }
                    className="flex gap-3"
                >
                    <Input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={
                            status === 'awaiting_input'
                                ? 'Type your response...'
                                : 'Ask me anything...'
                        }
                        disabled={isInputDisabled}
                        className="flex-1"
                    />
                    <Button
                        type="submit"
                        disabled={!input.trim() || isInputDisabled}
                        className="bg-primary-500 hover:bg-primary-600"
                    >
                        <PaperPlaneRight size={20} weight="fill" />
                        <span className="ml-2 hidden sm:inline">
                            {status === 'awaiting_input' ? 'Respond' : 'Send'}
                        </span>
                    </Button>
                </form>
            </div>
        </Card>
    );
}

// Message Bubble Component
interface MessageBubbleProps {
    message: AgentMessage;
    onConfirm: (option: ConfirmationOption) => void;
}

function MessageBubble({ message, onConfirm }: MessageBubbleProps) {
    const { role, content, eventType, toolCall, confirmationOptions } = message;

    return (
        <div className={cn('flex gap-3', role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
            {/* Avatar */}
            <div
                className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                    role === 'user'
                        ? 'bg-primary-500 text-white'
                        : role === 'assistant'
                          ? 'bg-gradient-to-br from-primary-100 to-primary-200 text-primary-600'
                          : 'bg-neutral-100 text-neutral-500'
                )}
            >
                {role === 'user' ? (
                    <User size={16} weight="bold" />
                ) : role === 'assistant' ? (
                    <Robot size={16} weight="duotone" />
                ) : (
                    <Wrench size={14} />
                )}
            </div>

            {/* Message Content */}
            <div
                className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-3',
                    role === 'user'
                        ? 'rounded-br-md bg-primary-500 text-white'
                        : role === 'assistant'
                          ? 'rounded-bl-md border border-neutral-200 bg-white shadow-sm'
                          : 'rounded-lg bg-neutral-100'
                )}
            >
                {/* Tool Call Indicator */}
                {eventType === 'TOOL_CALL' && toolCall && (
                    <div className="mb-2 flex items-center gap-2 rounded-md bg-white/10 px-2 py-1 text-xs">
                        <Wrench size={14} />
                        <span className="font-medium">{toolCall.name}</span>
                        {toolCall.success !== undefined && (
                            <span className="ml-auto">
                                {toolCall.success ? (
                                    <CheckCircle
                                        size={16}
                                        weight="fill"
                                        className="text-success-500"
                                    />
                                ) : (
                                    <XCircle size={16} weight="fill" className="text-danger-500" />
                                )}
                            </span>
                        )}
                    </div>
                )}

                {/* Message Text */}
                <div
                    className={cn(
                        'text-sm leading-relaxed',
                        role === 'user' ? 'text-white' : 'text-neutral-700'
                    )}
                >
                    {content.split('\n').map((line, i) => (
                        <p key={i} className={i > 0 ? 'mt-2' : ''}>
                            {line}
                        </p>
                    ))}
                </div>

                {/* Confirmation Options */}
                {eventType === 'AWAITING_INPUT' && confirmationOptions && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {confirmationOptions.map((option) => (
                            <Button
                                key={option.id}
                                size="sm"
                                variant={option.id === 'yes' ? 'default' : 'outline'}
                                onClick={() => onConfirm(option)}
                                className={
                                    option.id === 'yes' ? 'bg-success-500 hover:bg-success-600' : ''
                                }
                            >
                                {option.label}
                            </Button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
