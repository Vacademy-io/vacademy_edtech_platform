/** Quick add in a card, by where the card sits (ProductCard.tsx, QuickAdd.tsx, CartRecommendations.tsx). */
import { createContext } from 'react';

/**
 * How quick add behaves where a card sits. Unset (everywhere else), an add opens the cart drawer;
 * the cart's own "You may also like" row adds in place instead, and its cards say when their
 * product is already in the cart.
 */
export interface CardAddMode {
    /** Called right after the add, before the page redraws (the row keeps its place on screen). */
    onAdded(productId: string): void;
}

export const CardAddContext = createContext<CardAddMode | null>(null);
