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
