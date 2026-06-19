# HTTP Orders - Onboarding One-Pager

## In one sentence
HTTP Orders accepts carts over HTTP, records each order, and hands fulfillment to a worker that charges payment and reserves stock.

## The request's journey
A `POST /orders` reaches `OrderController.create`, which writes a pending row to the `orders` table and publishes an `OrderPlaced` message. `FulfillmentWorker` handles that message, asks `PaymentAdapter` to charge Stripe, asks `InventoryStore` to reserve stock in `inventory`, and then updates the order row to `confirmed`.

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
- **Not here:** order status transitions span OrderController and FulfillmentWorker.
- I recommend adding an outbox before changing this flow.
