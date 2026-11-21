import { Button } from '@/components/ui/button';
import { DownloadSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface DownloadButtonProps {
    onClick: () => void;
    label?: string;
    variant?: 'default' | 'outline' | 'ghost';
    size?: 'default' | 'sm' | 'lg';
    disabled?: boolean;
}

export const DownloadButton = ({
    onClick,
    label,
    variant = 'outline',
    size = 'sm',
    disabled = false,
}: DownloadButtonProps) => {
    const { t } = useTranslation('instructorCopilotDownloadButton');

    return (
        <Button
            onClick={onClick}
            variant={variant}
            size={size}
            className="gap-2"
            disabled={disabled}
        >
            <DownloadSimple size={16} />
            {label ?? t('defaultLabel')}
        </Button>
    );
};
