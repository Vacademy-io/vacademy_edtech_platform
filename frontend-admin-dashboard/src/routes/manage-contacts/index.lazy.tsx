import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ContactsListSection } from './-components/contacts-list-section';
import { ContactsEnhancedHeader } from './-components/ContactsEnhancedHeader';
import { Helmet } from 'react-helmet';

export const Route = createLazyFileRoute('/manage-contacts/')({
    component: ContactsList,
});

function ContactsList() {
    return (
        <LayoutContainer>
            <Helmet>
                <title>Contacts</title>
                <meta
                    name="description"
                    content="This page shows all the contacts of the institute."
                />
            </Helmet>
            <ContactsEnhancedHeader />
            <ContactsListSection />
        </LayoutContainer>
    );
}
