# HTTP Orders - Onboarding One-Pager

## In one sentence
HTTP Orders accepts carts over HTTP, records each order, and hands fulfillment to a worker that charges payment and reserves stock.

## The request's journey
`FulfillmentWorker` asks `PaymentAdapter` to charge Stripe and `InventoryStore` to reserve stock before `OrderController.create` receives `POST /orders`, writes a row to the `orders` table, publishes `OrderPlaced`, and marks it `confirmed`.

## The major components
- **OrderController** - HTTP entry for order creation.
- **FulfillmentWorker** - consumes `OrderPlaced`.
- **PaymentAdapter** - wraps Stripe.
- **InventoryStore** - owns inventory reserve operations.

## Where the truth lives
- **`orders` table** - order lifecycle and status; written by OrderController and FulfillmentWorker.
- **`inventory` table** - stock counts and reservations; written by InventoryStore.
- **Stripe** - charge record system; reached through PaymentAdapter.

## The seams
- **Cut here:** the `OrderPlaced` message contract.
- **Cut here:** the PaymentAdapter boundary.
- **Not here:** order status transitions span OrderController and FulfillmentWorker.
