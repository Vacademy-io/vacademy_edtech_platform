import { create } from 'zustand';
import { preferencesGet, preferencesSet } from '../../../utils/preferences-storage';

export interface CartItem {
  id: string;
  title: string;
  price: number;
  /** Strike-through MRP shown alongside the offer price. Optional. */
  elevatedPrice?: number;
  /** Currency code (e.g. INR). When absent, callers fall back to the rupee symbol. */
  currency?: string;
  quantity: number;
  image?: string;
  level?: string;
  packageSessionId?: string;
  enrollInviteId?: string;
  levelId?: string;
  /** Store/session id (the academic session, e.g. "store 1") this item was added from. */
  sessionId?: string;
  sessionName?: string;
  courseId?: string;
  [key: string]: any; // Allow additional fields
}

export interface MembershipPlan {
  id: string; // This will store the enrollInviteId
  title: string;
  price: number;
  numberOfBooks?: number;
  maxSeats?: number;
  packageSessionId?: string;
  enrollInviteId?: string;
}

interface CartStore {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>) => Promise<void>;
  removeItem: (enrollInviteId: string) => Promise<void>;
  updateQuantity: (enrollInviteId: string, quantity: number) => Promise<void>;
  /** Empties the current mode's cart (and the rent plan in rent mode); resolves once storage has the change. */
  clearCart: () => Promise<void>;
  getTotal: () => number;
  getItemCount: () => number;
  getItemCountByMode: (mode: 'buy' | 'rent') => Promise<number>; // Get count for specific mode
  getItemByEnrollInviteId: (enrollInviteId: string) => CartItem | undefined;
  membershipPlan: MembershipPlan | null;
  setMembershipPlan: (plan: MembershipPlan | null) => void;
  syncCart: () => Promise<void>; // Sync cart with current mode
  getCartMode: () => 'buy' | 'rent';
}


const STORAGE_KEY_BUY = 'cart_items_buy';
const STORAGE_KEY_RENT = 'cart_items_rent';
const PLAN_STORAGE_KEY = 'cart_plan';

/**
 * localStorage keys the storefront checkout leaves behind while a payment is
 * unsettled: the order to verify, the credentials/tokens used to sign the
 * learner in afterwards, and when the order was started (so an order that
 * never settles can be given up on).
 */
export const PENDING_CHECKOUT_KEYS = [
  'pendingOrderId',
  'pendingOrderCreatedAt',
  'pendingUsername',
  'pendingUserPassword',
  'pendingAccessToken',
  'pendingRefreshToken',
  'pendingInstituteId',
] as const;

/** Forgets the unsettled checkout: call once the payment is paid, failed, or given up on. */
export const clearPendingCheckout = (): void => {
  if (typeof window === 'undefined') return;
  for (const key of PENDING_CHECKOUT_KEYS) {
    localStorage.removeItem(key);
  }
};

// Get current cart mode based on levelFilter
const getCartMode = (): 'buy' | 'rent' => {
  if (typeof window === 'undefined') return 'buy';
  const levelFilter = sessionStorage.getItem('levelFilter') || '';
  return levelFilter.toLowerCase().includes('rent') ? 'rent' : 'buy';
};

// Get storage key based on mode
const getStorageKey = (mode?: 'buy' | 'rent'): string => {
  const currentMode = mode || getCartMode();
  return currentMode === 'rent' ? STORAGE_KEY_RENT : STORAGE_KEY_BUY;
};

// Load cart from storage
const loadCartFromStorage = async (mode?: 'buy' | 'rent'): Promise<CartItem[]> => {
  try {
    const storageKey = getStorageKey(mode);
    const stored = await preferencesGet(storageKey);
    if (stored.value) {
      return JSON.parse(stored.value);
    }
  } catch (error) {
    console.error('[CartStore] Error loading cart from storage:', error);
  }
  return [];
};

const loadPlanFromStorage = async (): Promise<MembershipPlan | null> => {
  try {
    const stored = await preferencesGet(PLAN_STORAGE_KEY);
    if (stored.value) {
      return JSON.parse(stored.value);
    }
  } catch (error) {
    console.error('[CartStore] Error loading plan from storage:', error);
  }
  return null;
};

// Save cart to storage
const saveCartToStorage = async (items: CartItem[], mode?: 'buy' | 'rent') => {
  try {
    const storageKey = getStorageKey(mode);
    await preferencesSet(storageKey, JSON.stringify(items));
  } catch (error) {
    console.error('[CartStore] Error saving cart to storage:', error);
  }
}

// Sync cart based on current mode
const syncCartWithMode = async () => {
  const mode = getCartMode();
  const items = await loadCartFromStorage(mode);

  // Only update if items have actually changed to avoid unnecessary re-renders
  const currentItems = useCartStore.getState().items;
  if (JSON.stringify(items) !== JSON.stringify(currentItems)) {
    useCartStore.setState({ items });
  }
};


const savePlanToStorage = async (plan: MembershipPlan | null) => {
  try {
    await preferencesSet(PLAN_STORAGE_KEY, JSON.stringify(plan));
  } catch (error) {
    console.error('[CartStore] Error saving plan to storage:', error);
  }
};

export const useCartStore = create<CartStore>((set, get) => ({
  items: [],
  membershipPlan: null,

  getCartMode: () => getCartMode(),

  syncCart: async () => {
    await syncCartWithMode();
    // Dispatch event to notify components
    window.dispatchEvent(new CustomEvent('cartSynced'));
  },

  addItem: async (item) => {
    // Use enrollInviteId as the unique identifier
    if (!item.enrollInviteId) {
      console.error('[CartStore] Cannot add item without enrollInviteId');
      return;
    }

    const mode = getCartMode();

    // IMPORTANT: Load the correct cart for the current mode to ensure separation
    const currentItemsForMode = await loadCartFromStorage(mode);

    const existingItem = currentItemsForMode.find((i) => i.enrollInviteId === item.enrollInviteId);

    if (existingItem) {
      // For Buy mode: Update quantity if item already exists
      // For Rent mode: Don't allow duplicates (current behavior)
      if (mode === 'buy') {
        const updatedItems: CartItem[] = currentItemsForMode.map((i) =>
          i.enrollInviteId === item.enrollInviteId ? { ...i, quantity: i.quantity + 1 } : i
        );
        set({ items: updatedItems });
        await saveCartToStorage(updatedItems, mode);
      }
      // For Rent mode, if item exists, do nothing (no duplicate items)
    } else {
      // Add new item with quantity 1
      const newItem: CartItem = {
        id: item.id,
        title: item.title,
        price: item.price,
        quantity: 1,
        image: item.image,
        level: item.level,
        packageSessionId: item.packageSessionId,
        enrollInviteId: item.enrollInviteId,
        levelId: item.levelId,
        courseId: item.courseId,
        ...item, // Include any additional fields
      };
      const newItems: CartItem[] = [...currentItemsForMode, newItem];
      set({ items: newItems });
      await saveCartToStorage(newItems, mode);
    }
  },

  removeItem: async (enrollInviteId) => {
    const mode = getCartMode();
    // Load the correct cart for the current mode
    const currentItemsForMode = await loadCartFromStorage(mode);
    const updatedItems = currentItemsForMode.filter((item) => item.enrollInviteId !== enrollInviteId);
    set({ items: updatedItems });
    await saveCartToStorage(updatedItems, mode);
  },

  updateQuantity: async (enrollInviteId, quantity) => {
    const mode = getCartMode();
    if (quantity <= 0) {
      await get().removeItem(enrollInviteId);
      return;
    }
    // Load the correct cart for the current mode
    const currentItemsForMode = await loadCartFromStorage(mode);
    const updatedItems = currentItemsForMode.map((item) =>
      item.enrollInviteId === enrollInviteId ? { ...item, quantity } : item
    );
    set({ items: updatedItems });
    await saveCartToStorage(updatedItems, mode);
  },

  clearCart: async () => {
    const mode = getCartMode();
    // The rent plan is only part of the rent cart; a bought-books checkout
    // must not wipe the plan someone picked for their rent cart.
    const clearsPlan = mode === 'rent';
    set(clearsPlan ? { items: [], membershipPlan: null } : { items: [] });
    // Native storage (Capacitor Preferences) is async: wait for it, or a
    // reload straight after (the redirect to the dashboard) restores the cart.
    await Promise.all([
      saveCartToStorage([], mode),
      clearsPlan ? savePlanToStorage(null) : Promise.resolve(),
    ]);
    if (typeof window !== 'undefined') {
      // Header badges and the other cart views listen for this.
      window.dispatchEvent(new CustomEvent('cartUpdated'));
    }
  },

  setMembershipPlan: (plan) => {
    set({ membershipPlan: plan });
    savePlanToStorage(plan);
  },

  getTotal: () => {
    const mode = getCartMode();

    if (mode === 'rent') {
      return get().membershipPlan?.price || 0;
    }

    // Default to 'buy' mode logic: sum of items
    const itemTotal = get().items.reduce(
      (total, item) => total + item.price * item.quantity,
      0
    );
    return itemTotal;
  },

  getItemCount: () => {
    // Get count from current store state (for current mode)
    return get().items.reduce((count, item) => count + item.quantity, 0);
  },

  getItemCountByMode: async (mode: 'buy' | 'rent') => {
    // Get count from storage for specific mode
    const items = await loadCartFromStorage(mode);
    return items.reduce((count, item) => count + item.quantity, 0);
  },

  getItemCountForCurrentMode: () => {
    // Get count from current store state (reactive, for current mode)
    // If store items match current mode, use them; otherwise return 0 (will be updated by sync)
    return get().items.reduce((count, item) => count + item.quantity, 0);
  },

  getItemByEnrollInviteId: (enrollInviteId) => {
    return get().items.find((item) => item.enrollInviteId === enrollInviteId);
  },
}));

// Initialize cart from storage on load
if (typeof window !== 'undefined') {
  syncCartWithMode().catch((error) => {
    console.error('[CartStore] Error syncing cart on init:', error);
  });
  loadPlanFromStorage()
    .then((plan) => {
      useCartStore.setState({ membershipPlan: plan });
    })
    .catch((error) => {
      console.error('[CartStore] Error loading plan on init:', error);
    });

  // Listen for levelFilter changes to sync cart
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === 'levelFilter') {
      syncCartWithMode().catch((error) => {
        console.error('[CartStore] Error syncing cart on storage change:', error);
      });
    }
  };
  window.addEventListener('storage', handleStorageChange);

  // Also listen for custom events (for same-tab changes)
  window.addEventListener('levelFilterChanged', () => {
    syncCartWithMode().catch((error) => {
      console.error('[CartStore] Error syncing cart on levelFilterChanged:', error);
    });
  });
}
