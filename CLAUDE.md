# CLAUDE.md

This is a multi-tenant real-time notification microservice. Its scope is broader than push
notifications alone — it also (a) prefills and attaches payment-mandate PDFs to notifications,
and (b) pushes non-notification real-time UI invalidation events (finance ledger updates) to the
CRM over the same Socket.IO connection.

The two things most worth knowing up front: this service currently assumes a single instance
(Socket.IO has no Redis adapter wired, see the socket-io topic), and it owns Save-View grid
template storage for the correspondence/notification-admin grids specifically (see the
save-view-templates topic and `TEMPLATE_IMPLEMENTATION_PLAYBOOK.md` at the repo root).

## Commands and dev environment
@.claude/rules/dev-commands.md

## Core notification flow and RabbitMQ consumption
@.claude/rules/dispatch-and-events.md

## Real-time finance invalidation (not a notification)
@.claude/rules/finance-realtime.md

## Payment-mandate PDF generation
@.claude/rules/payment-mandate-pdf.md

## Socket.IO
@.claude/rules/socket-io.md

## CRM admin list + Save View templates
@.claude/rules/save-view-templates.md

## Authentication
@.claude/rules/auth.md

## Data models, external dependencies, and env vars
@.claude/rules/data-models-and-external-deps.md
