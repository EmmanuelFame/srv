// ============================================================================
// 🚀  SAFECARE CLOUD-API BOT — MARILYN (DIRECT WHATSAPP CLOUD API)
// 🔧 CLEANED, STRUCTURED, BUT STILL SINGLE FILE – NO MODULARIZATION
// ============================================================================

require('dotenv').config();
const express   = require('express');
const axios     = require('axios').default;
const FormData  = require('form-data');
const app = express();

// ============================================================================
// ⚙️ BASIC MIDDLEWARE + DEBUG
// ============================================================================
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false }));

if (process.env.DEBUG_HTTP === '1') {
  app.use((req, _res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
  });
}

if (process.env.DEBUG_WEBHOOK === '1') {
  app.use((req, _res, next) => {
    if (req.method === 'POST' && req.path === '/webhook/whatsapp') {
      try { console.log('[WEBHOOK BODY]', JSON.stringify(req.body)); } catch {}
    }
    next();
  });
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    console.warn('⚠ JSON parsing failed on', req.path);
    return res.status(400).json({ ok: false, error: 'bad_json' });
  }
  next(err);
});

// ============================================================================
// 📌 ENV + BASIC UTILS
// ============================================================================
const onlyDigits = v => String(v || '').replace(/\D/g,'');
const j = v => { try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return '[obj]'; } };

const ENV      = k => (process.env[k] || '').trim();
const PORT     = Number(process.env.PORT || 3001);
const TOKEN    = ENV('WABA_TOKEN');
const PHONE_ID = ENV('WABA_PHONE_NUMBER_ID');
const API_VER  = ENV('WABA_API_VERSION') || 'v23.0';
const VERIFY   = ENV('WABA_VERIFY_TOKEN');

// Backend API
const API_BASE = (ENV('LARAVEL_API_URL') || '').replace(/\/+$/, '');
const API_KEY  = ENV('BOT_API_KEY');
const MEDIA_BASE = ENV('MEDIA_BASE_URL') || '';

// Branding / Contact
const ADMIN_PHONE      = ENV('ADMIN_PHONE');
const BRAND_NAME       = ENV('BRAND_NAME') || 'SafeCare Organisation';
const AGENT_NAME       = ENV('AGENT_NAME') || 'Marilyn';
const AGENT_IMAGE_URL  = ENV('MARILYN_IMAGE_URL');
const BANNER_IMAGE_URL = ENV('BANNER_IMAGE_URL');

// Media Stickers
const HELLO_STICKER_URL     = ENV('HELLO_STICKER_URL');
const CELEBRATE_STICKER_URL = ENV('CELEBRATE_STICKER_URL');
const THINKING_STICKER_URL  = ENV('THINKING_STICKER_URL');
const MARILYN_STICKER_ID   = ENV('MARILYN_STICKER_ID');
const CHRISTMAS_STICKER_ID = ENV('CHRISTMAS_STICKER_ID');


// Emoji Shelf
const EMOJI = {
  money: '💱', success: '✅', warn: '⚠️', track: '📦', edit: '✏️', doc: '📎',
};

// ============================================================================
// 🌐 AXIOS HTTP CLIENTS
// ============================================================================
const graph = axios.create({
  baseURL: `https://graph.facebook.com/${API_VER}`,
  timeout: 20000,
  headers: { Authorization: `Bearer ${TOKEN}` }
});

const graphRaw = axios.create({
  timeout: 60000,
  responseType: 'arraybuffer',
  headers: { Authorization: `Bearer ${TOKEN}` }
});

const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
  headers: { 'X-API-KEY': API_KEY, 'Accept': 'application/json' }
});

// ============================================================================
// 🛡 SAFE WRAPPER — Prevent Bot Crash on API Failure
// ============================================================================
async function safe(fn, tag = 'error') {
  try { return await fn(); }
  catch (err) {
    console.error(`❗[${tag}]`, err.response?.data || err.message || err);
    return null;
  }
}

// ============================================================================
// 💬 MESSAGE SENDER HELPERS
// ============================================================================
async function sendText(to, body) {
  return safe(() => graph.post(`/${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to, type: 'text',
    text: { body }
  }), 'sendText');
}

// 🧭 FLAG HELPER  (put this above createOrder)
function getFlag(country) {
  const map = {
    NG: '🇳🇬',
    RU: '🇷🇺',
    GH: '🇬🇭',
    KZ: '🇰🇿',
    TR: '🇹🇷',
    US: '🇺🇸',
    UK: '🇬🇧',
    CN: '🇨🇳'
  };
  return map[country] || '🌍';
}


async function sendImageLink(to, link, caption = '') {
  return safe(() => graph.post(`/${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to, type: 'image',
    image: { link, caption }
  }), 'sendImageLink');
}

async function sendButtons(to, bodyText, buttons, footer = 'Type "menu" anytime', header = null) {
  const interactive = {
    type: 'button',
    body: { text: bodyText },
    footer: { text: footer },
    action: { buttons },
  };
  if (header) interactive.header = header;

  return safe(() => graph.post(`/${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to, type: 'interactive', interactive
  }), 'sendButtons');
}

async function sendList(to, headerText, bodyText, buttonText, rows, footer='Type "menu" anytime') {
  return safe(() => graph.post(`/${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to, type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: headerText },
      body:   { text: bodyText },
      footer: { text: footer },
      action: { button: buttonText, sections: [{ title: headerText, rows }] }
    }
  }), 'sendList');
}
// ============================================================================
// 🧠 SESSION (in-memory)
// ============================================================================
const mem = {
  sessions: new Map(),
  EXPIRY_MS: 3 * 60 * 60 * 1000, // 3 hours
};

// periodic cleanup of stale sessions (basic hygiene)
setInterval(() => {
  const now = Date.now();
  for (const [waId, s] of mem.sessions.entries()) {
    if (!s?.createdAt) continue;
    if (now - s.createdAt > mem.EXPIRY_MS) {
      mem.sessions.delete(waId);
    }
  }
}, 60 * 60 * 1000); // hourly

async function sessionFor(waId) {
  let s = mem.sessions.get(waId);
  if (!s) {
    s = {
      step: 'idle',
      scratch: {},
      hasWelcomed: false,
      lastOrderId: null,
      createdAt: Date.now(),
    };
    mem.sessions.set(waId, s);
  }
  return s;
}

async function saveSession(waId, s) {
  s.createdAt = s.createdAt || Date.now();
  mem.sessions.set(waId, s);
}

async function reset(waId) {
  const old = mem.sessions.get(waId) || {};
  mem.sessions.set(waId, {
    step: 'idle',
    scratch: {},
    hasWelcomed: old.hasWelcomed || false,
    lastOrderId: old.lastOrderId || null,
    createdAt: Date.now(),
  });
}

// ============================================================================
// 🚀 MENUS & GREETING
// ============================================================================
async function sendButtonsMenu(to) {
  const header = BANNER_IMAGE_URL
    ? { type: 'image', image: { link: BANNER_IMAGE_URL } }
    : { type: 'text',  text: `Welcome to ${BRAND_NAME}` };

  return sendButtons(
    to,
    `Hey! I'm *${AGENT_NAME}* from *${BRAND_NAME}* 💚\nFast, secure *international transfers*.`,
    [
      { type: 'reply', reply: { id: 'svc_exchange', title: `${EMOJI.money} Start transfer` } },
      { type: 'reply', reply: { id: 'svc_track',    title: `${EMOJI.track} Track order` } },
      { type: 'reply', reply: { id: 'svc_admin',    title: '📞 Contact admin' } },
    ]
  );
}

// ============================================================================
// 🎄 SEASONAL GREETING + HERO WELCOME
// ============================================================================
// ===== NEW: helper for sending STICKER by ID ==========
async function sendSticker(to, stickerId) {
  return safe(() => graph.post(`/${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to,
    type: 'sticker',
    sticker: { id: stickerId }
  }), 'sendSticker');
}

// ===== UPDATED sendHeroWelcome() =======================
async function sendHeroWelcome(to) {
  const now = new Date();
  const month = now.getMonth() + 1; // December = 12

  const isChristmasSeason =
    (month === 12) ||
    (ENV('SEASON_MODE') === 'christmas'); // manual override

  // 💬 Default intro
  let txt =
    `Hello 🙋🏽‍♀️ I'm *${AGENT_NAME}* from *${BRAND_NAME}*.\n` +
    `I help you send money internationally.`;

  // 🎄 If Christmas — upgrade message
  if (isChristmasSeason) {
    txt =
      `🎄 *Festive Greetings from ${BRAND_NAME}!* 🎄\n\n` +
      `I'm *${AGENT_NAME}* — your transfer assistant.\n` +
      `This season, enjoy *fast & secure international payments* 🔥\n\n` +
      `✨ *Merry Christmas Season & Happy Holidays!* ✨`;
  }

  // 📸 Send hero image OR plain text
  if (AGENT_IMAGE_URL) {
    await sendImageLink(to, AGENT_IMAGE_URL, txt);
  } else {
    await sendText(to, txt);
  }

  // 🤖 Send Marilyn sticker (always)
  if (MARILYN_STICKER_ID) {
    await sendSticker(to, MARILYN_STICKER_ID);
  }

  // 🎄 Extra Christmas sticker (only in season)
  if (isChristmasSeason && CHRISTMAS_STICKER_ID) {
    await sendSticker(to, CHRISTMAS_STICKER_ID);
  }

  // 🔽 Show menu
  return sendButtonsMenu(to);
}


// ============================================================================
// 🔁 EXCHANGE FLOW — API HELPERS
// ============================================================================
const apiGetOptions = async t => {
  const res = await safe(
    () => api.get(`/bot/services/${t}/options`),
    `apiGetOptions:${t}`
  );
  return res?.data?.options || [];
};

const apiCalcExchange = async p => {
  const res = await safe(
    () => api.post(`/bot/exchange/calculate`, p),
    'apiCalcExchange'
  );
  return res?.data;
};

const apiCreateOrder = async p => {
  const res = await safe(
    () => api.post('/bot/orders', p),
    'apiCreateOrder'
  );
  return res?.data;
};

const apiOrderStatus = async id => {
  const res = await safe(
    () => api.get(`/bot/orders/${id}/status`),
    `apiOrderStatus:${id}`
  );
  return res?.data;
};

// ============================================================================
// 🔁 EXCHANGE FLOW — STEPS
// ============================================================================
async function startExchangeFlow(waId) {
  const s = await sessionFor(waId);
  s.options = {};
  s.options.pairs = await apiGetOptions('exchange');

  if (!s.options.pairs?.length) {
    return sendText(waId, `${EMOJI.warn} No transfer pairs available.`);
  }

  s.step = 'exchange_pair';
  await saveSession(waId, s);

  const rows = s.options.pairs.map(p => ({
    id: `pair_${p.id}`,
    title: `${p.source_country} → ${p.target_country}`,
    description: `${p.source_currency} → ${p.target_currency}`,
  }));

  return sendList(
    waId,
    'Transfer Options',
    'Choose a transfer pair:',
    'View options',
    rows
  );
}

async function exchange_pick_pair_by_id(waId, pairId) {
  const s    = await sessionFor(waId);
  const list = s.options?.pairs || [];
  const pair = list.find(p => p.id === Number(pairId));

  if (!pair) {
    return sendText(waId, 'Invalid pair selected. Please try again.');
  }

  s.scratch = {
    exchange_pair_id: pair.id,
    source_currency:  pair.source_currency,
    target_currency:  pair.target_currency,
    payment_methods:  pair.payment_methods || {},
  };
  s.step = 'exchange_method';
  await saveSession(waId, s);

  const rows = Object.entries(s.scratch.payment_methods).map(([name, fee], i) => ({
    id: `em_${i}`,
    title: name,
    description: `Fee ${fee}%`,
  }));

  return sendList(
    waId,
    'Payment Method',
    'Select a payment method:',
    'Select',
    rows
  );
}

// ─── PAYMENT METHOD PICKER (list → then buttons for quote mode) ─────────────
async function exchange_method_pick(waId, id) {
  const s = await sessionFor(waId);
  const indexStr = id.replace('em_', '');
  const i = Number(indexStr);

  const methods = Object.entries(s.scratch.payment_methods || {});
  if (!(i >= 0 && i < methods.length)) {
    return sendText(waId, 'Invalid payment method. Please pick again from the list.');
  }

  const [methodName, fee] = methods[i];

  s.scratch.payment_method = methodName;
  s.scratch.fee_percent    = fee;
  s.step = 'exchange_mode';
  await saveSession(waId, s);

  return sendButtons(
    waId,
    '⚖️ *How would you like to quote?*',
    [
      { type: 'reply', reply: { id: 'quote_mode_pay',     title: `Pay-in (${s.scratch.source_currency})` } },
      { type: 'reply', reply: { id: 'quote_mode_receive', title: `Receive (${s.scratch.target_currency})` } },
    ]
  );
}

// ─── QUOTE MODE (buttons only) ──────────────────────────────────────────────
async function exchange_mode_button(waId, id) {
  const s = await sessionFor(waId);

  if (id === 'quote_mode_pay') {
    s.scratch.mode = 'source_to_target';
  } else if (id === 'quote_mode_receive') {
    s.scratch.mode = 'target_to_source';
  } else {
    return sendText(waId, 'Please tap one of the buttons.');
  }

  s.step = 'exchange_amount';
  await saveSession(waId, s);

  return sendText(waId, '💰 *Enter amount to calculate:*');
}

// ─── AMOUNT INPUT + QUOTE CALCULATION ───────────────────────────────────────
async function exchange_amount(waId, text) {
  const s   = await sessionFor(waId);
  const amt = Number(String(text).replace(/[ ,]/g, ''));

  if (!(amt > 0)) {
    return sendText(waId, 'Please enter a valid number for amount.');
  }

  if (THINKING_STICKER_URL) {
    await sendImageLink(waId, THINKING_STICKER_URL);
  }
  await sendText(waId, 'Calculating...');

  const quote = await apiCalcExchange({
    exchange_pair_id: s.scratch.exchange_pair_id,
    amount:          amt,
    payment_method:  s.scratch.payment_method,
    mode:            s.scratch.mode,
  });

  if (!quote) {
    return sendText(waId, `${EMOJI.warn} Could not calculate quote. Please try again.`);
  }

  s.scratch.amount = amt;
  s.scratch.quote  = quote;
  s.step = 'exchange_confirm';
  await saveSession(waId, s);

  await sendText(
    waId,
    `🔍 *Quote*\n` +
    `Pay: ${quote.total_source_to_send} ${s.scratch.source_currency}\n` +
    `Receive: ${quote.converted_amount} ${s.scratch.target_currency}\n\n` +
    `Rate: ${quote.adjusted_rate}`
  );

  return sendButtons(
    waId,
    'Proceed with this quote?',
    [
      { type: 'reply', reply: { id: 'confirm_yes', title: `${EMOJI.success} Yes` } },
      { type: 'reply', reply: { id: 'cancel',      title: `${EMOJI.warn} Cancel` } },
    ]
  );
}

// ─── CONFIRM OR CANCEL QUOTE ────────────────────────────────────────────────
async function finishConfirm(waId, id) {
  const s = await sessionFor(waId);

  if (id === 'cancel') {
    await reset(waId);
    return sendHeroWelcome(waId);
  }

  // move into recipient collection flow
  s.step = 'recipient_collect';
  s.scratch.rec_answers = {};
  s.scratch.rec_index   = 0;
  await saveSession(waId, s);

  return sendText(waId, '👤 Recipient Full Name?');
}

// ============================================================================
// 🧾 RECIPIENT FORM (No skip, guided form)
// ============================================================================
const RECIPIENT_SCHEMA = [
  {
    key: 'full_name',
    label: 'Full Name',
    prompt: '👤 Recipient Full Name?',
    validate: v => v && v.length >= 2,
  },
  {
    key: 'phone',
    label: 'Phone',
    prompt: '📞 Phone (+234)',
    validate: v => onlyDigits(v).length >= 7,
    normalize: v => onlyDigits(v),
  },
  {
    key: 'bank',
    label: 'Bank Name',
    prompt: '🏦 Bank Name?',
    validate: v => v && v.length >= 2,
  },
  {
    key: 'account',
    label: 'Account No.',
    prompt: '🔢 Account Number?',
    validate: v => onlyDigits(v).length >= 6,
    normalize: v => onlyDigits(v),
  },
  {
    key: 'note',
    label: 'Note',
    prompt: '✍️ Any note? (write "none" if not)',
    validate: () => true,
  },
];

async function recipient_collect(waId, text) {
  const s   = await sessionFor(waId);
  const idx = s.scratch.rec_index ?? 0;
  const raw = String(text || '').trim();

  const field = RECIPIENT_SCHEMA[idx];
  if (!field) {
    return sendText(waId, 'Something went wrong with recipient form.');
  }

  if (!field.validate(raw)) {
    return sendText(waId, field.prompt);
  }

  s.scratch.rec_answers = s.scratch.rec_answers || {};
  s.scratch.rec_answers[field.key] = field.normalize ? field.normalize(raw) : raw;
  s.scratch.rec_index = idx + 1;

  if (s.scratch.rec_index >= RECIPIENT_SCHEMA.length) {
    s.scratch.recipient_account_info =
      RECIPIENT_SCHEMA
        .map(f => `${f.label}: ${s.scratch.rec_answers[f.key]}`)
        .join('\n');

    s.step = 'final_confirm';
    await saveSession(waId, s);

    return sendButtons(
      waId,
      'All set — confirm order?',
      [
        { type: 'reply', reply: { id: 'create_order',   title: `${EMOJI.success} Confirm Order` } },
        { type: 'reply', reply: { id: 'edit_recipient', title: `${EMOJI.edit} Edit` } },
      ]
    );
  }

  // ask next question
  const nextField = RECIPIENT_SCHEMA[s.scratch.rec_index];
  return sendText(waId, nextField.prompt);
}

// ============================================================================
// 🧾 CREATE ORDER
// ============================================================================
async function createOrder(waId) {
  const s = await sessionFor(waId);
  const q = s.scratch.quote;

  if (!q) {
    return sendText(waId, `${EMOJI.warn} No quote found for this session. Please start again.`);
  }

  // Retrieve selected exchange pair
  const pair = (s.options?.pairs || []).find(p => p.id === s.scratch.exchange_pair_id);
  if (!pair) return sendText(waId, 'Transfer pair not found — please restart.');

  const flagFrom = getFlag(pair.source_country);
  const flagTo   = getFlag(pair.target_country);
  const curFrom  = pair.source_currency;
  const curTo    = pair.target_currency;

  // API order payload
  const payload = {
    user_phone: onlyDigits(waId),
    service_type: 'exchange',
    exchange_pair_id: pair.id,
    amount: s.scratch.amount,
    payment_method: s.scratch.payment_method,
    converted_amount: q.converted_amount,
    total_to_pay: q.total_source_to_send,
    recipient_account_info: s.scratch.recipient_account_info,
  };

  const res = await apiCreateOrder(payload);
  if (!res?.order_id) {
    return sendText(waId, `${EMOJI.warn} Could not create order. Please try again.`);
  }

  s.lastOrderId = res.order_id;
  s.step = 'await_receipt';

  // 🆕 STORE ADMIN ACCOUNT INFO IN SESSION — prevents repeated not-found errors
  s.scratch.admin_info = pair.admin_account_info?.trim() || null;

  await saveSession(waId, s);

  if (CELEBRATE_STICKER_URL) {
    await sendImageLink(waId, CELEBRATE_STICKER_URL);
  }

  if (!s.scratch.admin_info) {
    return sendText(waId, '⚠️ No admin payment info found. Contact support.');
  }

  // Show order summary
  await sendText(
    waId,
    `🎉 *Order #${res.order_id} Created!*\n\n` +
    `${flagFrom} ➜ ${flagTo} *${q.total_source_to_send} ${curFrom} → ${q.converted_amount} ${curTo}*\n\n` +
    `💵 *Pay Now (${curFrom}):* ${q.total_source_to_send}\n` +
    `📈 Rate: 1 ${curFrom} = ${q.adjusted_rate} ${curTo}\n\n` +
    `👇 Tap below to view payment details:`
  );

  return sendButtons(
    waId,
    `Payment details for *${s.scratch.payment_method}*:`,
    [
      { type: 'reply', reply: { id: 'copy_acc', title: '📋 View payment info' } }
    ],
    'Send receipt here after payment'
  );
}




// ============================================================================
// 📎 RECEIPT UPLOAD (Laravel API)
// ============================================================================
async function apiUploadReceipt(orderId, filename, buffer, contentType) {
  const form = new FormData();
  form.append('receipt_image', buffer, {
    filename,
    contentType,
  });

  const res = await safe(
    () => api.post(`/bot/orders/${orderId}/receipt`, form, {
      headers: {
        ...form.getHeaders(),
        'X-API-KEY': API_KEY,
        Accept: 'application/json',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }),
    `apiUploadReceipt:${orderId}`
  );

  return res?.data;
}

// ============================================================================
// 📎 HANDLE RECEIPT (MEDIA)
// ============================================================================
async function handleMediaReceipt(waId, msg) {
  const s = await sessionFor(waId);

  // Ignore if not in receipt stage (prevents phantom triggers)
  if (s.step !== 'await_receipt') {
    console.log("⚠️ Ignored media event — not awaiting receipt.");
    return;
  }

  const type  = msg.type;
  const media = msg[type] || {};
  if (!media.id) {
    return sendText(waId, 'Could not read the file you sent.');
  }

  // Fetch metadata
  const meta = await safe(() => graph.get(`/${media.id}`), 'graph:getMediaMeta');
  const url = meta?.data?.url;
  if (!url) {
    return sendText(waId, 'Could not fetch media details, please send again.');
  }

  // Download binary
  const bin = await safe(() => graphRaw.get(url), 'graphRaw:getMediaBin');
  if (!bin?.data) {
    return sendText(waId, 'Could not download file, please try again.');
  }

  const buffer = Buffer.from(bin.data);

  // Upload receipt
  await apiUploadReceipt(
    s.lastOrderId,
    `receipt_${s.lastOrderId}`,
    buffer,
    media.mime_type
  );

    const orderId = s.lastOrderId;

// Prevent further copy_acc until new order
    s.step = 'idle';
    await saveSession(waId, s);

    // Then full reset
    await reset(waId);


  return sendText(
    waId,
    `📎 Receipt uploaded!\n` +
    `👉 Type *status ${orderId}* anytime to check progress.`
  );
}

// ============================================================================
// 🌐 WEBHOOK HANDLERS
// ============================================================================

// --- VERIFY ENDPOINT (Facebook Webhook Setup) -------------------------------
app.get('/webhook/whatsapp', (req, res) => {
  const mode   = req.query['hub.mode'];
  const token  = req.query['hub.verify_token'];
  const chal   = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY) {
    return res.status(200).send(chal);
  }
  return res.sendStatus(403);
});

// helper for status checking from plain text (e.g. "status 123")
async function handleStatusQuery(waId, text) {
  const id = text.replace(/\D/g, '');
  if (!id) {
    return sendText(waId, 'Please send order number like: status 1234');
  }

  const st = await apiOrderStatus(id);
  if (st?.status) {
    return sendText(waId, `Status for #${id}: ${st.status}`);
  }
  return sendText(waId, 'Order not found or not accessible.');
}

// helper for status when user is in "await_track" mode
async function handleTrackStep(waId, text, s) {
  const id = text.replace(/\D/g, '');
  if (!id) {
    await sendText(waId, 'Please send a valid order number.');
    return;
  }

  const st = await apiOrderStatus(id);
  if (st?.status) {
    await sendText(waId, `Status for #${id}: ${st.status}`);
  } else {
    await sendText(waId, 'Order not found or not accessible.');
  }

  s.step = 'idle';
  await saveSession(waId, s);
}

// --- MAIN WEBHOOK ROUTE ----------------------------------------------------
// --- MAIN WEBHOOK ROUTE ----------------------------------------------------
app.post('/webhook/whatsapp', async (req, res) => {
  const entry = req.body?.entry?.[0]?.changes?.[0]?.value || {};
  const msgs  = entry.messages || [];

  for (const m of msgs) {
    const waId = m.from;

    // Get session FIRST
    const s = await sessionFor(waId);

    // Now apply dedupe
    s.lastMsgId = s.lastMsgId || null;
    if (m.id === s.lastMsgId) {
        console.log("⚠️ Duplicate message ignored:", m.id);
        continue;
    }
    s.lastMsgId = m.id;
    await saveSession(waId, s);

    // Now safe to use text
    const text = m.text?.body?.trim() || '';

    

    // =========================================================================
    // 1️⃣ MEDIA RECEIPTS (image / document)
    // =========================================================================
    if (m.type === 'image' || m.type === 'document') {
      await handleMediaReceipt(waId, m);
      continue;
    }

    // =========================================================================
    // 2️⃣ INTERACTIVE BUTTONS
    // =========================================================================
    if (m.interactive?.type === 'button_reply') {
      const id = m.interactive.button_reply.id;

      // --------------------------------------------------------------
      // 🆕 FIXED: COPY ACCOUNT BUTTON — USE STORED ADMIN INFO ONLY
      // --------------------------------------------------------------
      if (id === 'copy_acc') {

        // Ignore repeated cloud callbacks + prevent loops
        if (s.step !== 'await_receipt') {
          console.log("⚠️ Ignored stale copy_acc event");
          continue;
        }

        const adminInfo = s.scratch.admin_info;
        if (!adminInfo) {
          return await sendText(waId, '⚠️ Payment info not available. Contact admin.');
        }

        return await sendText(
          waId,
          `📋 *Payment Details:*\n${adminInfo}\n\n` +
          `After payment, send your *receipt (image/pdf)* here 👇`
        );

      }

      // =========================================================================
      // MAIN SERVICE BUTTONS
      // =========================================================================
      if (id === 'svc_exchange') {
        await startExchangeFlow(waId);
        continue;
      }

      if (id === 'svc_track') {
        s.step = 'await_track';
        await saveSession(waId, s);
        await sendText(waId, 'Send order number (e.g. 1234)');
        continue;
      }

      if (id === 'svc_admin') {
        await sendText(waId, `Admin: +${ADMIN_PHONE}`);
        continue;
      }

      // Quote mode
      if (id === 'quote_mode_pay' || id === 'quote_mode_receive') {
        await exchange_mode_button(waId, id);
        continue;
      }

      if (id === 'cancel') {
        await reset(waId);
        await sendHeroWelcome(waId);
        continue;
      }
      // Quote confirm
      if (id === 'confirm_yes') {
        await finishConfirm(waId, id);
        continue;
      }

      // Create order
      if (id === 'create_order') {
        await createOrder(waId);
        continue;
      }

      // Edit recipient
      if (id === 'edit_recipient') {
        s.step = 'recipient_collect';
        s.scratch.rec_index = 0;
        await saveSession(waId, s);
        await sendText(waId, '👤 Recipient Full Name?');
        continue;
      }
    }

    // =========================================================================
    // 3️⃣ LIST REPLIES (exchange pair + payment method)
    // =========================================================================
    if (m.interactive?.type === 'list_reply') {
      const id = m.interactive.list_reply.id;

      if (id.startsWith('pair_')) {
        await exchange_pick_pair_by_id(waId, id.replace('pair_', ''));
        continue;
      }

      if (id.startsWith('em_')) {
        await exchange_method_pick(waId, id);
        continue;
      }
    }

    // =========================================================================
    // 4️⃣ BASIC COMMANDS
    // =========================================================================
    const lower = text.toLowerCase();

    if (['hi', 'hello', 'menu', 'start'].includes(lower)) {
      await sendHeroWelcome(waId);
      s.hasWelcomed = true;
      await saveSession(waId, s);
      continue;
    }

    if (lower.startsWith('status')) {
      await handleStatusQuery(waId, text);
      continue;
    }

    // =========================================================================
    // 5️⃣ FLOW STATE HANDLERS
    // =========================================================================
    if (s.step === 'exchange_amount') {
      await exchange_amount(waId, text);
      continue;
    }

    if (s.step === 'recipient_collect') {
      await recipient_collect(waId, text);
      continue;
    }

    if (s.step === 'await_track') {
      await handleTrackStep(waId, text, s);
      continue;
    }

    // =========================================================================
    // 6️⃣ FALLBACK
    // =========================================================================
    await sendText(waId, 'Type *menu* to begin.');
  }

  res.json({ ok: true });
});




// ============================================================================
// 🚀 BOOT
// ============================================================================
app.listen(PORT, () => {
  console.log(`🔥 SafeCare Bot running on port ${PORT} — DIRECT Cloud API (port ${PORT})`);
});
