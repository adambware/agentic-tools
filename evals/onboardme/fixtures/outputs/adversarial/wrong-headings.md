# HTTP Orders - Onboarding One-Pager

## Summary
HTTP Orders accepts carts.

## Journey
A `POST /orders` reaches `OrderController.create`.

## Components
- **OrderController** - HTTP entry.

## Storage
- **`orders` table** - written by OrderController and FulfillmentWorker.

## Seams
- **Cut here:** the queue.
