/**
 * The buying pages (checkout, order, track order, account) as their own lazy chunk inside the
 * shop chunk: a visitor who only browses products never downloads them.
 */
import React from 'react';
import { AccountPage } from './Account';
import { CheckoutPage } from './Checkout';
import { OrderPage } from './OrderPage';
import { TrackOrderPage } from './TrackOrder';

export type BuyingKind = 'checkout' | 'order' | 'track' | 'account';

const BuyPages: React.FC<{ kind: BuyingKind }> = ({ kind }) => {
    switch (kind) {
        case 'checkout':
            return <CheckoutPage />;
        case 'order':
            return <OrderPage />;
        case 'track':
            return <TrackOrderPage />;
        case 'account':
            return <AccountPage />;
    }
};

export default BuyPages;
