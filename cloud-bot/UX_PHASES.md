# Cloud Bot UX Roadmap

This roadmap is designed for WhatsApp's UI constraints: short messages, reply
buttons, list messages, and minimal free typing.

## Phase 1 — Flow Compression + Clarity

Status: shipped

Goal: reduce taps, reduce message noise, and make the flow feel guided.

- Shorter welcome and less media/sticker spam
- Explicit progress cues like `Step 1 of 4`
- Better quote summary with clearer review options
- Immediate payment details after order creation
- Better prompts after receipt upload

## Phase 2 — Durable Memory + Recovery

Status: shipped

Goal: make the experience survive restarts and interrupted conversations.

- Move session state from in-memory map to Redis
- Persist drafts, active quote, selected recipient, and latest order context
- Add resume prompts like `Continue your last transfer?`
- Add idempotency protection for key actions beyond last message ID

## Phase 3 — Returning Customer Shortcuts

Status: shipped

Goal: make repeat customers feel known and fast-tracked.

- Welcome back flow
- Repeat last transfer shortcut
- Recent corridor shortcut
- Saved recipient picker
- Faster reorder for frequent users

## Phase 4 — Recipient Intelligence

Status: shipped

Goal: collect less information and ask smarter questions.

- Corridor-specific recipient forms
- Payment-rail-specific flows: bank, wallet, cash pickup
- Better validation and inline examples
- Recipient summary before final order creation
- Edit specific field instead of restarting the whole form

## Phase 5 — Status + Support Experience

Goal: make the bot feel proactive, reliable, and human-aware.

- Better order timeline messages
- Push updates when order state changes
- Smart support handoff with conversation context
- SLA copy like `Support replies within X minutes`
- Better issue recovery when quote/order creation fails

## Phase 6 — Premium WhatsApp Experience Layer

Goal: make the bot feel like a high-quality business channel, not just a script.

- Template-driven re-engagement and reminders
- Brand-consistent copy system
- Media strategy that feels intentional instead of noisy
- Optional catalog/product-style flows where relevant
- Funnel analytics for drop-off by step and corridor

## Recommended order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
