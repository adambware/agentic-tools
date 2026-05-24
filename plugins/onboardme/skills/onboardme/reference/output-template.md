# Output Template

Emit exactly these five sections, in order. Keep it to one page (~3 minutes to read).
Every line must be load-bearing. State **facts** plainly; do not editorialize. If you
must note an inference, mark it `(inferred)`; if you cannot confirm something, mark it
`unclear`. Nothing else belongs in the artifact — no citations, source lists,
appendices, diagrams, risk ratings, TODOs, or recommendations.

```markdown
# <System> — Onboarding One-Pager

## In one sentence
<What the system does, in plain language. No jargon, no acronyms unexpanded.>

## The request's journey
<Trace one real operation end to end as a short narrative — the order of events,
not a box diagram. Name the real endpoint, services, queues, workers, and tables.
Behavior and ordering teach more than structure.>

## The major components
- **<Component>** — <its one job, in a sentence.>
- **<Component>** — <its one job.>
<3–5 total. Each is a box and what that box is for.>

## Where the truth lives
- **<Store / system of record>** — <what it holds; the component allowed to write to it.>
- **<Store>** — <what it holds; its sole writer.>
<List every data store and external system of record, and who owns writes to each.>

## The seams
- **Cut here:** <boundaries where a change slots in cleanly — interface, queue
  contract, plugin point — and what kind of change belongs there.>
- **Not here:** <load-bearing internals where a change ripples; what makes them rigid.>
```

## Filled example

```markdown
# Checkout Service — Onboarding One-Pager

## In one sentence
An HTTP service that takes shopping carts, places orders, and hands fulfillment off to
a background worker that reserves inventory and charges payment.

## The request's journey
A `POST /orders` hits `OrderController.create`, which validates the cart and writes a
row to `orders` with `status=pending`, then publishes an `OrderPlaced` message to the
`orders` topic. The `FulfillmentWorker` consumes it, calls the Stripe adapter to charge
the card, reserves stock by decrementing `inventory` rows in a transaction, and flips
the order row to `status=confirmed`. On a payment failure it sets `status=failed` and
emits `OrderFailed`; nothing else writes to `orders`.

## The major components
- **OrderController** — HTTP entry; validates carts and records intent as a pending order.
- **FulfillmentWorker** — consumes `OrderPlaced`, drives payment + inventory, finalizes state.
- **PaymentAdapter** — wraps Stripe; the only code that talks to the payment provider.
- **InventoryStore** — owns stock counts and the reserve/release logic.

## Where the truth lives
- **`orders` table (Postgres)** — order lifecycle and status; written only by OrderController (create) and FulfillmentWorker (finalize).
- **`inventory` table (Postgres)** — stock on hand; written only by InventoryStore.
- **Stripe** — system of record for charges and refunds; reached only via PaymentAdapter.

## The seams
- **Cut here:** the `OrderPlaced` / `OrderFailed` message contract — new post-order
  behavior (notifications, analytics) slots in as a new consumer without touching checkout.
- **Cut here:** the PaymentAdapter interface — swapping or adding a payment provider is
  contained behind it.
- **Not here:** the `orders` status transitions are split across the controller and the
  worker; changing the lifecycle means editing both in lockstep.
```
