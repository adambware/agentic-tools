# Signup Reports - Onboarding One-Pager

## In one sentence
Signup Reports accepts signup events, stores them in SQLite, and emits a digest queue message for downstream reporting.

## The request's journey
A `POST /signup-reports` reaches `SignupController.create`, which calls `ReportStore` to append the signup into `signup_reports.sqlite`. After the write succeeds, the controller publishes `SignupRecorded` through `DigestQueue` and returns the new report id.

## The major components
- **SignupController** - HTTP entry for signup report creation and queue publishing.
- **ReportStore** - owns the SQLite append path for signup reports.
- **DigestQueue** - holds `SignupRecorded` messages for downstream digest work.

## Where the truth lives
- **`signup_reports.sqlite`** - stored signup report rows; written by ReportStore.
- **`SignupRecorded` queue** - downstream digest handoff; written by SignupController through DigestQueue.

## The seams
- **Cut here:** the `SignupRecorded` message - downstream reporting behavior can consume the event.
- **Cut here:** ReportStore - changes to the signup persistence format stay behind the store API.
- **Not here:** the controller couples the durable write and queue publish order, so changing acknowledgement behavior crosses both.
