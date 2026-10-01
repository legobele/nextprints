# NextPrints — online shop (no payments)

A static storefront for the NextPrints 3D printing business. Customers create an
account with their **school email**, verify it, browse products, and place
**orders** — no online payment. They pay **cash on pickup/delivery**. An order
is a reservation.

**Stack:** plain HTML/CSS/JS + Firebase JS SDK v10 (modular, via CDN).
No build step, no npm, no frameworks. Light corporate theme.

## Pages

| File | What it is |
|---|---|
| `index.html` | Storefront: hero, how-it-works, current pre-orders, product grid, limited-time deals, delivery info, FAQ |
| `product.html?id=…` | Product detail: gallery, pre-order vs regular price tiers (auto-switch by date), spec table, estimated delivery, quantity, add to cart |
| `cart.html` | Cart, promo code, estimated delivery per item, pickup form (name + homeroom + grade on first order), place order → "pay cash on pickup" confirmation |
| `orders.html` | "My orders" — signed-in user sees their own orders with a visual status tracker (Order placed → Confirmed → Printing → Ready for pickup → Delivered), per-item batch numbers, and live status |
| `account.html` | Signup / login / logout, email verification status + resend |
| `nxp-ops-7q2.html` | Admin panel (admin email only, unlisted + noindex): Products, Deals, Promo codes, Orders |

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
   admin, click **Seed demo products**. (Or run `seedProducts(db)` from
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

`pending` → `confirmed` → `printing` → `ready` → `delivered` (or `cancelled`).
The admin updates status in the Orders tab; the buyer sees a visual tracker on
`orders.html`. Payment is always cash on pickup — the site never touches money.

## Batch numbers

Products carry a `batchNumber` (e.g. "001"), edited in the admin product form.
At checkout the batch number (and product description) is snapshotted into
each order item, so old orders keep their original batch. It is shown per line
item in both the customer's order tracker and the admin Orders table.

## Estimated delivery

Products carry a `deliveryEstimate` string (e.g. "October 7, 2026"), edited in
the admin product form. It is shown on product cards, the product detail page,
and each line of the cart/checkout summary.

## Grade gate

First-time buyers are asked "What grade are you in?" at checkout (6th–12th).
Grades 6th and 7th are blocked: no order is created and the buyer sees
"NextPrints currently serves students in grades 8–12 only."
The grade is stored on the order document and shown in the admin Orders table,
so items can be hand-delivered at school. Repeat buyers are not asked again —
their grade is taken from their most recent order.

## Reviews

After an order is marked `delivered`, the next time that customer opens the
site they are prompted (in-app modal, one product at a time) to leave a 1–5
star rating plus an optional comment. Reviews live in the `reviews` collection
(`productId`, `userId`, `email`, `rating`, `comment`, `createdAt`), are public
to read, and each product shows its average rating and review count on cards
and the product page. A customer is only prompted once per product (an existing
review by that user suppresses the prompt).
**Rules note:** the `reviews` block was added to the local `firestore.rules`
file but NOT published — paste + publish it in the Firebase console before
reviews will save.

## Notes / gotchas

- The `@intermetro.edu` check is enforced **client-side** (signup form) and
  **server-side** (security rules) — bypassing the form still can't place orders.
- Firestore `orderBy` is deliberately avoided in queries so no composite
  indexes need creating; sorting is done client-side.
- Product images: upload real photos in the admin panel (they go to
  `product-images/` in Storage). Until then, gradient SVG placeholders show.
- Prices are resolved **fresh from Firestore at checkout**, so the price a
  buyer pays always matches the current tier (preorder vs regular).
