import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { WarningCircle } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

interface TimesUpModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onFinish: () => void
}

export function TimesUpModal({ open, onOpenChange, onFinish }: TimesUpModalProps) {
  const { t } = useTranslation('courseComponentsExtra')
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <WarningCircle className="h-5 w-5 text-primary-500" />
            {t('timesUpModal.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('timesUpModal.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            onClick={onFinish}
            className="w-full bg-primary-500 text-white"
          >
            {t('timesUpModal.finish')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

