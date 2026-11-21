import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Copy, Eye, EyeSlash, Trash, Check } from '@phosphor-icons/react';
import { ApiKey } from '../-services/api-keys';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface ApiKeyCardProps {
    apiKey: ApiKey;
    onRevoke: (keyId: string) => void;
    isRevoking: boolean;
}

export function ApiKeyCard({ apiKey, onRevoke, isRevoking }: ApiKeyCardProps) {
    const { t } = useTranslation('videoApiStudioApiKeyCard');
    const [showKey, setShowKey] = useState(false);
    const [copied, setCopied] = useState(false);

    const maskKey = (key: string) => {
        if (key.length <= 12) return key;
        return key.substring(0, 8) + '••••••••••••' + key.substring(key.length - 4);
    };

    const copyToClipboard = async () => {
        await navigator.clipboard.writeText(apiKey.key);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    return (
        <Card className="border-border">
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-foreground truncate">{apiKey.name}</h3>
                            <Badge
                                variant={apiKey.status === 'active' ? 'default' : 'secondary'}
                                className={
                                    apiKey.status === 'active'
                                        ? 'bg-green-100 text-green-800 hover:bg-green-100'
                                        : ''
                                }
                            >
                                {apiKey.status === 'active'
                                    ? t('status.active')
                                    : t('status.revoked')}
                            </Badge>
                        </div>
                        <div className="flex items-center gap-2 mb-2">
                            <code className="text-sm bg-muted px-2 py-1 rounded font-mono">
                                {showKey ? apiKey.key : maskKey(apiKey.key)}
                            </code>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setShowKey(!showKey)}
                            >
                                {showKey ? (
                                    <EyeSlash className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={copyToClipboard}
                            >
                                {copied ? (
                                    <Check className="h-4 w-4 text-green-600" />
                                ) : (
                                    <Copy className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {t('created', { date: formatDate(apiKey.created_at) })}
                        </p>
                    </div>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                disabled={isRevoking || apiKey.status !== 'active'}
                            >
                                <Trash className="h-4 w-4" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>{t('revokeDialog.title')}</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {t('revokeDialog.description', { name: apiKey.name })}
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>{t('revokeDialog.cancel')}</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={() => onRevoke(apiKey.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    {t('revokeDialog.confirm')}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardContent>
        </Card>
    );
}
