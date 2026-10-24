# Messaging setup and integration contract

The transport lives in `src/backend/app/messaging`; approval and durable dispatch integration live in `services/workflow.py` and `services/delivery.py`. Telegram sends real **customer invoice reminders only**. Internal alerts and approval requests remain in the app. WhatsApp and Email are enabled for demo use only: approval and simulated delivery are saved without any external message request. Their historical records are preserved.

## Application setup and journey

1. Apply migrations from `src/backend`: `.venv\Scripts\python.exe -m alembic upgrade head`. Revision 0007 adds customer Telegram chat IDs, a durable delivery-attempt table and provider IDs. It preserves existing preferences, drafts, approvals and send history; it does not invent recipient mappings. New seed profiles retain their original Email/WhatsApp demo preferences, and historical seed receipts retain their original channels.
2. Configure `TELEGRAM_BOT_TOKEN` in the repository-root `.env`, then restart the backend. Never expose the token through `VITE_*` variables. No token or real customer message is required for automated tests.
3. As Finance or Owner, open **Customer Profiles → Edit preferences → Telegram** and save the customer's numeric **Telegram chat ID**. Ask the customer to start the bot first. Names, email and phone remain Orbyte-owned. The manual test chat ID is never used as a fallback customer destination.
4. Prepare an eligible reminder, save edits and submit. Finance approval is required; balances strictly above MYR 20,000 also require a distinct Owner. Recipient or preference changes invalidate outstanding versions and require fresh approval.
5. Inspect **Approved preview – real Telegram delivery**, then explicitly choose **Send via Telegram**. WhatsApp and Email use **Simulate send**. The exact approved text and recipient are sent; Telegram length is checked before review.
6. Open **Follow-ups → Sent → View saved receipt** to see Telegram acceptance and the provider message ID after reload. Acceptance does not mean the customer read the message. Failed/unknown attempts remain on the reminder, outside successful Sent receipts.

The existing `POST /api/drafts/{id}/send` endpoint now dispatches Telegram or simulates WhatsApp/Email according to the saved approved channel. Draft responses include `delivery` with status, timestamps, provider message ID, redacted error code and optional retry delay. Outbox responses include `provider_message_id`. Profile GET/POST includes optional `telegram_chat_id`; it is required when choosing Telegram. WhatsApp preferences require the customer's saved phone number and are explicitly labelled demo only.

Before Telegram I/O, the company lock revalidates company, user, version, approvals, facts and eligibility, then commits a unique attempt for that draft. The external request runs after that commit. Duplicate/concurrent send requests return the existing attempt without another request. Completion creates a successful send log and a **System** audit event linked to the initiating user; the original request is a **User** event. Successful Telegram sends participate in per-invoice reminder spacing.

`failed` permits correction followed by a fresh saved version and new approvals. There is no automatic retry. `unknown` and `sending` block further dispatch and new journeys for that invoice, including after a payment or preference change. Refresh converts an interrupted claim older than two minutes to `unknown`. Such outcomes require operator investigation/reconciliation; this milestone does not provide a manual resolution UI. A database transaction cannot guarantee exactly-once delivery across Telegram; the app prevents automatic duplicate attempts and retains ambiguous claims instead of resending.

## Set up and test Telegram

1. Create a test bot using [@BotFather](https://t.me/BotFather). Set `TELEGRAM_BOT_TOKEN` in the repository-root `.env`. Never commit it or expose it through a `VITE_*` variable.
2. Open your bot in Telegram and send `/start`. A bot cannot start a private conversation with a user before that user contacts it.
3. Obtain your numeric test chat ID from `message.chat.id` in the bot's incoming [`getUpdates`](https://core.telegram.org/bots/api#getupdates) response, using a local API client with the token kept private. Do not paste token-bearing URLs in shared logs. Updates cannot be polled while a webhook is configured; use a separate test bot if another teammate operates a webhook. This module does not consume updates or configure webhooks.
4. Set `TELEGRAM_TEST_CHAT_ID` in `.env`. It is exclusively the manual test destination, not a default customer recipient.
5. From `src/backend`, run:

```PowerShell
uv run pytest tests/test_messaging.py -q
uv run python -m app.messaging --send-test
```

The first command uses mocked HTTP: no messages are sent. The second explicitly sends one real, synthetic reminder to your test chat. No database, frontend or API server is required. Its JSON output contains status and provider ID, not token, recipient or body. Exit code is zero only for `sent`. Check Telegram to confirm arrival. Live delivery has not been verified using project credentials.

## Backend interface

Call from trusted backend workflow code only after verifying persisted approvals and the recipient mapping. A browser-supplied `approved=true` flag is not authorization.

```Python
from app.messaging import Message, MessagingService

# Values below come from server-validated records.
result = MessagingService.from_env().send(Message(
    channel="Telegram",
    recipient=customer_chat_id,
    body=approved_draft.body,
))
# Persist result.model_dump() against the delivery attempt.
```

Inputs:

| Field       | Contract                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `channel`   | Exactly `Telegram`, `WhatsApp` or `Email`                                                                                              |
| `recipient` | Trimmed nonempty string; Telegram requires a numeric chat ID, including negative group IDs. Usernames/phone numbers are not supported. |
| `body`      | Exact approved text, nonblank, 1–4096 characters. No formatting, splitting or rewriting is performed.                                  |

Validate Telegram length before approval; an oversized draft must be edited and approved again. Sending is synchronous with a bounded HTTP timeout: use a sync FastAPI route or worker, not a blocking call inside an async event loop. Configure the token before constructing the service. Link previews are disabled and text is sent without `parse_mode`.

Results:

| Field                 | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `channel`             | Requested channel                                                       |
| `status`              | `sent`, `simulated`, `failed` or `unknown`                              |
| `provider_message_id` | Telegram message ID as a string on acceptance, otherwise null           |
| `error_code`          | Redacted machine code, otherwise null                                   |
| `retry_after_seconds` | Provider retry delay, when supplied; not an automatic retry instruction |

`sent` means Telegram accepted the message, not read confirmation or device delivery. `simulated` means no external request. `failed` means missing configuration, a connection could not be established, or explicit provider rejection. `unknown` means acceptance cannot be determined (read/write failure, malformed response, server error).

Error codes include `not_configured`, `connection_failed`, `telegram_400`, `telegram_401`, `telegram_403`, `telegram_429`, `transport_uncertain`, `invalid_response` and `provider_uncertain`. Provider descriptions and exception strings are excluded to avoid leaking secrets.

**No automatic retries.** Telegram `sendMessage` has no application idempotency key; a request can succeed while its response is lost. Never automatically retry `unknown`. A crash after sending but before persisting the result must also be treated as uncertain. A database transaction cannot make a Telegram request atomic.

## Team ownership

| Owner                          | Integration responsibilities                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messaging developer            | Transport, configuration, normalized results, mocked tests and smoke-test command (implemented)                                                                                          |
| Backend workflow team          | Verify role, tenant, customer mapping, outstanding balance, do-not-contact, spacing, snooze and all required approvals before dispatch                                                   |
| Database team                  | New Alembic migration for Telegram channels, per-customer chat IDs, delivery attempts/results and provider message IDs                                                                   |
| Backend workflow/database team | Atomically claim each draft to prevent concurrent duplicate sends; persist intent before sending and result afterward; audit results; recover interrupted attempts without blind retries |
| Frontend team                  | Load durable drafts and results; connect approvals; show recipient setup, sending/sent/failed/unknown and clearly label simulated channels                                               |
| AI team                        | Generate wording before approval; transport sends the exact approved wording and never calls AI                                                                                          |

Revision 0007 expands persisted channel constraints to retain Email/WhatsApp history and support Telegram. `SendLog` accepts `sent` only for Telegram and `simulated` only for Email/WhatsApp. `delivery_attempt` records each claimed Telegram version and its eventual result. Migration downgrade refuses to discard Telegram mappings or delivery history.

The bot token stays on the server. Avoid HTTP debug/access logs containing Telegram URLs: the API embeds the token in the request URL. Store customer mappings and message data with tenant isolation and appropriate retention. No real customer data is needed for testing.

## Workflow acceptance checks

* Approve a synthetic invoice reminder and send it to its mapped Telegram test chat.
* Save the provider ID and show the same state after reload.
* Reject duplicate/concurrent sends and dispatch without all approvals.
* Exercise blocked-bot rejection, rate limiting and ambiguous timeouts.
* Confirm WhatsApp and Email remain simulated, never call a real sender, and preserve their saved approval/receipt history.

Sources: [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage), [Bot FAQ](https://core.telegram.org/bots/faq).
