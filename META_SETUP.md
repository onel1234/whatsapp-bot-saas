# Meta channel setup — Phase 4

Phase 4 supports owner-entered WhatsApp, Messenger and Instagram connections. Connections start paused. No account, webhook subscription, public endpoint or live send has been activated by this implementation.

The owner supplied **WhatsApp test phone-number ID `1339213065945263`** on 2026-10-12 and confirmed the Meta app is unpublished. This is an account identifier, not a phone number. No app secret, token, Page ID, Instagram account ID or app-review status has been supplied.

## Server configuration

1. Apply migrations with `pnpm db:generate` and `pnpm db:migrate`. Keep PostgreSQL and Redis running and start `pnpm worker`.
2. Set `META_APP_SECRET` to the secret for the app that owns these channel subscriptions. Choose a random `META_VERIFY_TOKEN`; this is separate from the app secret and access token. Store these in the API environment. The worker needs the encryption keys, account registry, Graph version and send switch as well.
3. Set `META_GRAPH_VERSION` to the supported version selected for your Meta app, such as the version shown in its API setup. The code requires an explicit version rather than silently choosing a moving default.
4. Generate a 32-byte AES key using `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Set `CHANNEL_ENCRYPTION_KEYS` to a JSON object containing that value under `v1`, and set `CHANNEL_ENCRYPTION_KEY_VERSION=v1`. Use the same key ring on API and worker. Do not commit this output.
5. Obtain the workspace UUID from the authenticated `/auth/me` response's `tenants` list. The server administrator must review account ownership and set `META_ACCOUNT_BINDINGS` to a JSON map of `CHANNEL:ACCOUNT_ID` to workspace UUID. For the supplied test asset:

   ```json
   { "WHATSAPP:1339213065945263": "YOUR-WORKSPACE-UUID" }
   ```

   Replace the placeholder with an actual UUID. This registry prevents another workspace owner from claiming someone else's known Meta account ID. Creating, enabling, receiving and sending all check it. Embedded signup/OAuth ownership verification is a future onboarding option; it is not implemented here.
6. Keep `META_LIVE_SEND_ENABLED=false` while reviewing. Restart API and worker after environment changes. Local fixtures use synthetic credentials and intercept every send.

## Connect the test WhatsApp account

1. Sign in as workspace owner and open **Channels**. Save the supplied test phone-number ID with its access token entered directly in the password field. Tokens are encrypted and omitted from API responses. Temporary Meta tokens need replacement when they expire.
2. Arrange an HTTPS endpoint for the API yourself when you are ready to test externally. Register `https://YOUR-API-HOST/webhooks/meta` as the callback using your verify token, and subscribe the WhatsApp account/app to message events in Meta. Localhost is not an externally reachable callback. No tunnel or deployment is created by the build.
3. Enable receiving for the saved connection. With sending still paused, a signed customer text is committed to the database, processed by the inbound worker, and produces a pending outbound delivery.
4. After authorizing test sends and confirming the Graph version, token and permitted test recipient, set `META_LIVE_SEND_ENABLED=true` on the worker. This releases **all pending deliveries** for enabled, authorized connections, subject to their current reply windows. Review the queue before enabling it. The API uses the same switch to report its status in Channels.
5. Send a customer-initiated message from the test recipient. Confirm the bot reply and delivery progression under **Recent deliveries**. The Meta development app's available assets, recipients, permissions and app roles still govern this test.

Do not send secrets in chat. An unpublished app and a test number do not establish production readiness. App review, permissions, business verification, onboarding and billing must be checked in the owner's actual Meta account before live activation.

## Messenger and Instagram

- Messenger uses the Facebook Page ID, Page access token, Page message subscriptions and the `graph.facebook.com` Send API. Standard replies use `messaging_type=RESPONSE`.
- Instagram uses a professional-account ID and Instagram-scoped recipient IDs. Choose **Instagram Login** for `graph.instagram.com`; **Facebook Login** uses `graph.facebook.com` with the professional-account ID. Use the token and permissions appropriate to that chosen flow. Authorize the corresponding `MESSENGER:PAGE_ID` or `INSTAGRAM:ACCOUNT_ID` registry key before saving it.
- Direct text messages and message-ID delivery/seen receipts are supported. Messenger read watermarks mark already accepted messages in the matching customer's thread as read. Echoes are ignored. Attachments are retained as encrypted event evidence and create a team request; files are not downloaded or interpreted. Postbacks, reactions, edits, private comment replies and special message tags are not implemented.

## Delivery and recovery

The webhook verifies HMAC-SHA256 over the exact request bytes, routes each individual event through a database-owned account lookup, and commits a tenant-only encrypted receipt with the inbound message and pending turn. Duplicate provider IDs per connection do not duplicate turns. Failed storage returns an error so Meta can retry; a partially committed multi-account envelope can be safely replayed. Unknown account IDs and non-message event types are acknowledged without processing. A paused connection records new receipts without creating turns; enabling it does not replay those paused messages.

The conversation engine creates the bot reply and outbound delivery in one transaction. Both queues recover persisted work after Redis outages. Delivery workers recheck current connection authorization, status, human mode and last customer timestamp. Customer timestamps are taken from the provider and capped at receipt time; delayed or duplicate events do not reopen the reply window. Free-form replies require a customer message within 24 hours for all three adapters. Outside the window the delivery is blocked and escalated; **no template is assumed approved or sent automatically**. Approved WhatsApp template management/sends need explicit business configuration and are not included in this phase.

Each delivery has one stable internal ID. Explicit HTTP 429 rejection can retry up to three sends with delay. Timeouts, connection errors, HTTP 5xx, an unrecognized successful response or a worker interruption after the send claim become `UNKNOWN` and require review; they are never automatically resent. The send claim commits before the network request. Unknown earlier deliveries hold later replies in that conversation. Provider message IDs correlate receipts, including receipts arriving before the send response. Confirmed delivery/read progress never regresses.

An `UNKNOWN` delivery without a provider message ID cannot be reconciled automatically. Check the provider's message history before deciding whether to send a replacement. This phase exposes status and seller notifications; it deliberately has no blind retry button. Human inbox replies and takeover controls are Phase 5.

Encrypted credentials, customer IDs and normalized event payloads use AES-256-GCM with random IVs, key versions and tenant/connection/purpose binding. To rotate, add a new key version, switch the active version on API/worker, and replace connection tokens. Retain old keys until every dependent customer/event record has been reencrypted or expired; a bulk rotation/retention operator workflow is Phase 6. This phase does not claim encryption of message bodies, database disks or all provider identifiers.

## Official references

- [Meta WhatsApp text-send collection](https://www.postman.com/meta/whatsapp-business-platform/request/8gvd47s/send-text-message).
- [Meta Messenger Platform collection](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api).
- [Meta Instagram text-send collection](https://www.postman.com/meta/instagram/request/scob1z4/text-message) and [Instagram API collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api).
- [Meta-hosted WhatsApp SDK quickstart](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/).
- [Meta Graph webhook setup](https://developers.facebook.com/docs/graph-api/webhooks/getting-started). Direct developer-document fetches were rate-limited during implementation; send contracts were checked against Meta's official Postman collections. These references and local fixtures do not establish live account permissions or successful delivery.
