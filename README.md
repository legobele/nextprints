# 🌀 Fidget Lab — online shop (no payments)

A tiny static storefront for the 3D-printed fidget business. Customers create an
account with their **school email**, verify it, browse products, and place
**orders** — no online payment. They pay **cash on pickup/delivery**. An order
is a reservation.

**Stack:** plain HTML/CSS/JS + Firebase JS SDK v10 (modular, via CDN).
No build step, no npm, no frameworks. Mobile-first dark theme.

## Pages

| File | What it is |
|---|---|
| `index.html` | Storefront: hero, 🔥 live preorders, product grid, ⚡ limited deals |
| `product.html?id=…` | Product detail: gallery, preorder vs regular price tiers (auto-switch by date), quantity, add to cart |
| `cart.html` | Cart, promo code, pickup form (name + homeroom), place order → "pay cash on pickup" confirmation |
| `orders.html` | "My orders" — signed-in user sees their own orders + live status |
| `account.html` | Signup / login / logout, email verification status + resend |
| `nxp-ops-7q2.html` | Admin panel (admin email only): Products, Deals, Promo codes, Orders |

## One-time Firebase setup

1. **Create the project** at [console.firebase.google.com](https://console.firebase.google.com)
   → Add project (Spark/free plan is fine).
2. **Add a Web app** (`</>`): Project settings → "Your apps" → copy the
   `firebaseConfig` values → paste them into **`js/firebase-config.js`**
   (replacing every `PASTE_*`). That's the only file that holds your keys.
3. **Authentication:** Build → Authentication → Get started → Sign-in method →
   enable **Email/Password**. (Verification emails are sent automatically by
   the signup flow — no extra config.)
4. **Firestore:** Build → Firestore Database → Create database (production
   mode, pick a region). Then open the **Rules** tab, paste the contents of
   **`firestore.rules`**, Publish.
5. **Storage:** Build → Storage → Get started. Then **Rules** tab, paste
   **`storage.rules`**, Publish.
6. **Seed products:** open `nxp-ops-7q2.html` in the deployed site, sign in as the
   admin, click **🌱 Seed demo products**. (Or run `seedProducts(db)` from
   `seed/seed-products.js` in the console on any shop page.)
7. **Deploy the files** to any static host: GitHub Pages, Netlify, Vercel,
   Firebase Hosting — just upload the whole folder.

## Change the admin email

It's in **3 places** — keep them in sync:

1. `js/config.js` → `ADMIN_EMAIL`
2. `firestore.rules` → `isAdmin()`
3. `storage.rules` → the `allow write` line

## Rename the shop

One place: `BRAND_NAME` at the top of `js/config.js`.

## How the rules work

- **Products / deals / promo codes:** public read, admin-only write.
- **Orders:** can only be *created* by a signed-in user whose email is
  **verified** AND ends in `@intermetro.edu`, and the order must belong to
  them (`userId`/`email` match the token) and start as `pending`.
  Owners can read their own orders and cancel them; everything else is admin-only.
- **Promo `usedCount`:** verified students may increment it by exactly 1
  (the checkout does this inside the same transaction that creates the order,
  so a code can't be double-spent).
- **Storage:** product images are public to view, admin-only to upload.

## Promo codes

Codes are the document ID in the `promoCodes` collection (uppercased).
Fields: `type` (`"percent"` | `"fixed"`), `value`, `maxUses`, `usedCount`,
`expiresAt`, `active`. Manage them in the admin panel.

## Order flow

`pending` → `confirmed` → `ready` → `delivered` (or `cancelled`).
The admin updates status in the Orders tab; the buyer sees it live on
`orders.html`. Payment is always cash on pickup — the site never touches money.

## Notes / gotchas

- The `@intermetro.edu` check is enforced **client-side** (signup form) and
  **server-side** (security rules) — bypassing the form still can't place orders.
- Firestore `orderBy` is deliberately avoided in queries so no composite
  indexes need creating; sorting is done client-side.
- Product images: upload real photos in the admin panel (they go to
  `product-images/` in Storage). Until then, gradient SVG placeholders show.
- Prices are resolved **fresh from Firestore at checkout**, so the price a
  buyer pays always matches the current tier (preorder vs regular).
