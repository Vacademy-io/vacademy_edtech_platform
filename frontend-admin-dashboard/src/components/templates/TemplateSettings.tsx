import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Mail } from 'lucide-react';
import { WhatsAppIcon } from '@/components/ui/whatsapp-icon';
import { EmailTemplatesTab } from './email';
import { EmailBrandKit } from './email/EmailBrandKit';
import { WhatsAppTemplatesTab } from './whatsapp';

export default function TemplateSettings() {
    const [activeTab, setActiveTab] = useState<'email' | 'whatsapp'>('email');

    return (
        <div className="w-full space-y-4 sm:space-y-6">
            {/* Header */}
            <div className="space-y-1 px-2 sm:px-0">
                <h1 className="flex items-center gap-2 text-base sm:text-lg font-bold">
                    <FileText className="size-5 sm:size-6" />
                    Template Settings
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground">
                    Create and manage email and WhatsApp message templates for bulk actions
                </p>
            </div>

            {/* Tabbed Interface */}
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'email' | 'whatsapp')} className="w-full">
                <TabsList className="grid w-full grid-cols-2 h-auto">
                    <TabsTrigger value="email" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4 py-2 sm:py-3">
                        <Mail className="size-3 sm:size-4" />
                        <span className="hidden xs:inline">Email Templates</span>
                        <span className="xs:hidden">Email</span>
                    </TabsTrigger>
                    <TabsTrigger value="whatsapp" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4 py-2 sm:py-3">
                        <WhatsAppIcon className="size-3 sm:size-4 text-green-600" />
                        <span className="hidden xs:inline">WhatsApp Templates</span>
                        <span className="xs:hidden">WhatsApp</span>
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="email" className="mt-4 sm:mt-6 w-full space-y-4 sm:space-y-6">
                    <EmailBrandKit />
                    <EmailTemplatesTab />
                </TabsContent>

                <TabsContent value="whatsapp" className="mt-4 sm:mt-6 w-full">
                    <WhatsAppTemplatesTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}
