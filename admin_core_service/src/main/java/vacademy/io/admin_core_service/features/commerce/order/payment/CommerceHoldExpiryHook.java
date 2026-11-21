package vacademy.io.admin_core_service.features.commerce.order.payment;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.stock_hold.repository.StockHoldRepository.StockHoldRow;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldCommerceHook;
import vacademy.io.admin_core_service.features.stock_hold.service.StockHoldService;

import java.time.Duration;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * What the hold code tells Commerce.
 *
 * <ul>
 *   <li><b>A hold expired.</b> The expiry job released the stock of an unpaid checkout. When the
 *       hold belongs to a commerce order, the order code is told once per order
 *       ({@code onHoldExpired}); it cancels the order and closes its pending plans. A hold of a
 *       course or book-store checkout belongs to no commerce order and nothing happens.</li>
 *   <li><b>The shopper released a hold</b> (closed the payment window). The stock is back on
 *       sale, so the order must not stay open: it would be offered for payment again while
 *       its stock may be sold to someone else, and it would count against the open orders of
 *       that phone. The order is cancelled (reason SHOPPER_RELEASED) on a thread of its own:
 *       this callback runs while the release request still holds its database connections,
 *       and the cancel must not need another one from the same request. A cancel that is lost
 *       (a full queue, a restart) is made up by the payable check and by the reconcile
 *       job.</li>
 *   <li><b>Payment in progress.</b> The public release call must not free the stock of an
 *       order whose payment was authorised a moment ago and is waiting for capture.</li>
 * </ul>
 * Called by {@link StockHoldService} after the release transaction has committed
 * ({@code onHoldReleased}) or inside it, read only ({@code paymentInProgress}).
 */
@Slf4j
@Component
public class CommerceHoldExpiryHook implements StockHoldCommerceHook {

    /** An authorisation older than this no longer blocks the release. */
    static final Duration AUTHORISED_WINDOW = CommercePaymentConfirmService.AUTHORISED_WINDOW;
    private static final int REMEMBERED = 500;
    private static final long REMEMBER_MILLIS = Duration.ofMinutes(2).toMillis();

    private final CommercePaymentGuard guard;
    private final CommerceGatewayOrderRepository gatewayOrders;
    private final CommerceOrderPaymentPort orders;
    /** Runs the cancel of a shopper release, away from the request that released. */
    private final Executor shopperReleases;

    @Autowired
    public CommerceHoldExpiryHook(CommercePaymentGuard guard, CommerceGatewayOrderRepository gatewayOrders,
                                  CommerceOrderPaymentPort orders) {
        this(guard, gatewayOrders, orders, singleDaemonThread());
    }

    CommerceHoldExpiryHook(CommercePaymentGuard guard, CommerceGatewayOrderRepository gatewayOrders,
                           CommerceOrderPaymentPort orders, Executor shopperReleases) {
        this.guard = guard;
        this.gatewayOrders = gatewayOrders;
        this.orders = orders;
        this.shopperReleases = shopperReleases;
    }

    /** One thread and a bounded queue; what does not fit is dropped (the reconcile job covers it). */
    private static Executor singleDaemonThread() {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(1, 1, 60L, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(REMEMBERED), runnable -> {
                    Thread thread = new Thread(runnable, "commerce-shopper-release");
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.DiscardPolicy());
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }

    /** Orders told in the last two minutes: an order of twenty lines is told once, not twenty times. */
    private final Map<String, Long> told = new LinkedHashMap<>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Long> eldest) {
            return size() > REMEMBERED;
        }
    };

    @Override
    public boolean paymentInProgress(String orderPaymentLogId) {
        String orderId = guard.orderIdOfPaymentLog(orderPaymentLogId);
        if (orderId == null) {
            return false;
        }
        Date since = new Date(System.currentTimeMillis() - AUTHORISED_WINDOW.toMillis());
        return gatewayOrders.countAuthorizedSince(orderId, since) > 0;
    }

    @Override
    public void onHoldReleased(StockHoldRow hold, String reason) {
        if (hold == null) {
            return;
        }
        boolean byShopper = StockHoldService.REASON_SHOPPER.equals(reason);
        if (!byShopper && !StockHoldService.REASON_EXPIRED.equals(reason)) {
            return;
        }
        String orderId = guard.orderIdOfPaymentLog(hold.getPaymentLogId());
        if (orderId == null || toldLately(orderId)) {
            return;
        }
        if (byShopper) {
            shopperReleases.execute(() -> {
                try {
                    orders.onShopperReleased(orderId);
                } catch (RuntimeException e) {
                    forget(orderId);
                    log.error("COMMERCE_ALERT order {} was released by its shopper and could not be cancelled",
                            orderId, e);
                }
            });
            return;
        }
        try {
            orders.onHoldExpired(orderId);
        } catch (RuntimeException e) {
            forget(orderId);
            throw e; // logged by the hold code; the reconcile job expires the order
        }
    }

    private synchronized boolean toldLately(String orderId) {
        long now = System.currentTimeMillis();
        Long at = told.get(orderId);
        if (at != null && now - at < REMEMBER_MILLIS) {
            return true;
        }
        told.put(orderId, now);
        return false;
    }

    private synchronized void forget(String orderId) {
        told.remove(orderId);
    }
}
