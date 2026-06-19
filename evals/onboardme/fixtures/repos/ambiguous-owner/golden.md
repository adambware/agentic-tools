# Audit Export - Onboarding One-Pager

## In one sentence
Audit Export creates CSV exports from a CLI command and records audit rows through the shared audit writer.

## The request's journey
An `export-audit` CLI run calls `CsvExporter` to create the export id, then calls `AuditWriter` to append a `manual-export` row to the `audit-log` stream. A separate PartnerWebhook path also calls `AuditWriter`, so the stream has one observed writer module but its sole owner is unclear.

## The major components
- **CLI** - command entry for manual audit exports.
- **CsvExporter** - creates the export id for the selected account.
- **AuditWriter** - appends audit rows to the external audit stream.
- **PartnerWebhook** - receives partner callbacks and records partner audit rows.

## Where the truth lives
- **`audit-log` stream** - audit events for exports and partner callbacks; written through AuditWriter, with sole owner unclear.

## The seams
- **Cut here:** AuditWriter - both observed paths reach the audit stream through the same module.
- **Not here:** the CLI command mixes export creation with audit emission, so changing the command result touches both steps.
