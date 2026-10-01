// ============================================================
//  SHOP CONFIG — edit these three values to customize the shop
// ============================================================

// Displayed in the nav, hero, page titles, etc.
export const BRAND_NAME = "NextPrints";

// The one account allowed into nxp-ops-7q2.html. MUST match the email
// hardcoded in firestore.rules and storage.rules.
export const ADMIN_EMAIL = "legobele@gmail.com";

// Only emails ending in @<this domain> can place orders.
// Enforced client-side here AND server-side in firestore.rules.
export const SCHOOL_DOMAIN = "intermetro.edu";

export const CURRENCY = "$";

// Web Push (FCM) public VAPID key — generated in the Firebase console under
// Project settings → Cloud Messaging → Web Push certificates. Filled in
// after the NextPrints project migration.
export const VAPID_KEY = "__FIREBASE_VAPID_KEY__";

// Rewards program: this many non-cancelled orders in a calendar month earns
// VIP status (deal alerts go out to VIPs first + price-drop codes).
export const VIP_ORDER_THRESHOLD = 10;

// Maintenance mode: when true, every storefront page shows a maintenance
// notice instead of the shop. The admin console (nxp-ops-7q2.html) is
// exempt. Flip back to false when the maintenance window ends.
export const MAINTENANCE_MODE = true;

// Flat fee for the optional priority-delivery upgrade at checkout.
export const PRIORITY_FEE = 3;

// Nothing auto-calculates a delivery before this date (e.g. first product
// wave). Auto ETAs and auto-queued windows clamp to it.
export const FIRST_DELIVERY_DATE = "2026-10-07";
