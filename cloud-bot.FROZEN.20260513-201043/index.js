// ============================================================================
// 🚀  SAFECARE CLOUD-API BOT — MARILYN (DIRECT WHATSAPP CLOUD API)
// 🔧 CLEANED, STRUCTURED, BUT STILL SINGLE FILE – NO MODULARIZATION
// ============================================================================

require('dotenv').config();
const express   = require('express');
const axios     = require('axios').default;
const FormData  = require('form-data');
const { createClient } = require('redis');
const app = express();
app.set('trust proxy', 1);

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
const formatAmount = v => {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
};
const FLOW_TOTAL_STEPS = 6;
const STEP_ICONS = {
  1: '🌍',
  2: '💳',
  3: '🧮',
  4: '📊',
  5: '👤',
  6: '✅',
};
const DEFAULT_FOOTER = 'SafeCare • Type menu anytime';
const SUPPORT_FOOTER = 'Marilyn is here if you need help';
const stepLabel = (step, total, title) =>
  `${STEP_ICONS[step] || '✨'} Step ${step} of ${total}${title ? ` • ${title}` : ''}`;
const flowStepLabel = (step, title) => stepLabel(step, FLOW_TOTAL_STEPS, title);
const recipientStepLabel = (index, total) =>
  `${flowStepLabel(5, 'Recipient details')} (${Math.min(index + 1, total)}/${total})`;
const clipText = (value, max) => {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text || text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1).trim()}…`;
};
const safeListRows = rows => rows.map(row => ({
  ...row,
  title: clipText(row.title, 24),
  description: clipText(row.description, 72),
}));

const ENV      = k => (process.env[k] || '').trim();
const PORT     = Number(process.env.PORT || 3001);
const TOKEN    = ENV('WABA_TOKEN');
const PHONE_ID = ENV('WABA_PHONE_NUMBER_ID');
const API_VER  = ENV('WABA_API_VERSION') || 'v23.0';
const VERIFY   = ENV('WABA_VERIFY_TOKEN');
const REDIS_URL = ENV('REDIS_URL');
const SESSION_TTL_SEC = Number(ENV('SESSION_TTL_SEC') || ENV('SESS_TTL_SEC') || '10800');
const MESSAGE_DEDUPE_TTL_SEC = Number(ENV('MESSAGE_DEDUPE_TTL_SEC') || ENV('IDEM_TTL_SEC') || '86400');

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
const CELEBRATE_STICKER_URL = ENV('CELEBRATE_STICKER_URL') || ENV('CELEBRATE0_STICKER_URL');
const THINKING_STICKER_URL  = ENV('THINKING_STICKER_URL') || ENV('THINKING0_STICKER_URL');
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

async function sendButtons(to, bodyText, buttons, footer = DEFAULT_FOOTER, header = null) {
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

async function sendList(to, headerText, bodyText, buttonText, rows, footer = DEFAULT_FOOTER) {
  return safe(() => graph.post(`/${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp',
    to, type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: clipText(headerText, 60) },
      body:   { text: clipText(bodyText, 1024) },
      footer: { text: clipText(footer, 60) },
      action: {
        button: clipText(buttonText, 20),
        sections: [{ title: clipText(headerText, 24), rows: safeListRows(rows) }],
      }
    }
  }), 'sendList');
}
// ============================================================================
// 🧠 SESSION + DURABILITY
// ============================================================================
const mem = {
  sessions: new Map(),
  processedMessages: new Map(),
  profiles: new Map(),
  EXPIRY_MS: SESSION_TTL_SEC * 1000,
  PROCESSED_TTL_MS: MESSAGE_DEDUPE_TTL_SEC * 1000,
};

const persistence = {
  mode: REDIS_URL ? 'redis' : 'memory',
  redis: null,
};
const userQueues = new Map();

const sessionKey = waId => `cloud-bot:session:${waId}`;
const processedMessageKey = messageId => `cloud-bot:msg:${messageId}`;
const profileKey = waId => `cloud-bot:profile:${waId}`;

const defaultSession = () => ({
  step: 'idle',
  scratch: {},
  hasWelcomed: false,
  lastOrderId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  resumeOffered: false,
});

const defaultProfile = () => ({
  lastTransfer: null,
  recentPairs: [],
  savedRecipients: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// periodic cleanup for memory fallback
setInterval(() => {
  const now = Date.now();
  for (const [waId, s] of mem.sessions.entries()) {
    if (!s?.createdAt) continue;
    if (now - s.createdAt > mem.EXPIRY_MS) {
      mem.sessions.delete(waId);
    }
  }

  for (const [msgId, ts] of mem.processedMessages.entries()) {
    if (now - ts > mem.PROCESSED_TTL_MS) {
      mem.processedMessages.delete(msgId);
    }
  }
}, 60 * 60 * 1000); // hourly

async function initRedis() {
  if (!REDIS_URL) {
    console.log('ℹ️ Redis disabled — using in-memory sessions');
    persistence.mode = 'memory';
    return;
  }

  const client = createClient({ url: REDIS_URL });

  client.on('error', err => {
    console.error('❗[redis]', err.message || err);
  });

  try {
    await client.connect();
    persistence.redis = client;
    persistence.mode = 'redis';
    console.log(`✅ Redis connected (${REDIS_URL})`);
  } catch (err) {
    persistence.redis = null;
    persistence.mode = 'memory';
    console.error('❗[redis:init] Falling back to memory store:', err.message || err);
  }
}

function isRedisReady() {
  return persistence.mode === 'redis' && persistence.redis?.isOpen;
}

async function markMessageProcessed(messageId) {
  if (!messageId) return true;

  if (isRedisReady()) {
    const res = await persistence.redis.set(
      processedMessageKey(messageId),
      '1',
      { EX: MESSAGE_DEDUPE_TTL_SEC, NX: true }
    );
    return res === 'OK';
  }

  if (mem.processedMessages.has(messageId)) {
    return false;
  }
  mem.processedMessages.set(messageId, Date.now());
  return true;
}

async function profileFor(waId) {
  if (isRedisReady()) {
    const raw = await persistence.redis.get(profileKey(waId));
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.error('❗[profile:parse]', err.message || err);
      }
    }
    const fresh = defaultProfile();
    await saveProfile(waId, fresh);
    return fresh;
  }

  let p = mem.profiles.get(waId);
  if (!p) {
    p = defaultProfile();
    mem.profiles.set(waId, p);
  }
  return p;
}

async function saveProfile(waId, profile) {
  const now = Date.now();
  profile.createdAt = profile.createdAt || now;
  profile.updatedAt = now;

  if (isRedisReady()) {
    await persistence.redis.set(profileKey(waId), JSON.stringify(profile), {
      EX: 60 * 60 * 24 * 30,
    });
    return;
  }

  mem.profiles.set(waId, profile);
}

function pairLabelFromSnapshot(snapshot) {
  if (!snapshot) return '';
  const from = snapshot.source_country || snapshot.source_currency || 'Source';
  const to = snapshot.target_country || snapshot.target_currency || 'Target';
  return `${from} → ${to}`;
}

function summarizeRecipient(recipient) {
  if (!recipient) return 'Saved recipient';
  return [
    recipient.full_name,
    recipient.bank || recipient.destination_bank,
    recipient.account || recipient.sbp_phone || recipient.wallet_id,
  ].filter(Boolean).join(' • ');
}

function countryName(code) {
  const names = {
    NG: 'Nigeria',
    RU: 'Russia',
    GH: 'Ghana',
    KZ: 'Kazakhstan',
    TR: 'Turkey',
    US: 'United States',
    UK: 'United Kingdom',
    CN: 'China',
  };
  return names[code] || code || 'the destination country';
}

function selectedPairForSession(s) {
  return (s.options?.pairs || []).find(p => p.id === s?.scratch?.exchange_pair_id) || null;
}

function recipientSchemaForSession(s) {
  const target = s?.scratch?.target_country || selectedPairForSession(s)?.target_country || '';

  if (target === 'RU') {
    return [
      {
        key: 'full_name',
        label: 'Recipient Full Name',
        prompt: 'Send the recipient’s full name exactly as it appears on their Russian bank account.',
        validate: v => v && v.length >= 2,
      },
      {
        key: 'phone',
        label: 'Recipient Phone',
        prompt: 'Send the recipient’s phone number in international format.\nExample: +79991234567',
        validate: v => onlyDigits(v).length >= 10,
        normalize: v => onlyDigits(v),
      },
      {
        key: 'bank',
        label: 'Bank Name',
        prompt: 'Send the recipient’s bank name in Russia.\nExample: Sberbank or Alfa-Bank',
        validate: v => v && v.length >= 2,
      },
      {
        key: 'account',
        label: 'SBP Phone / Account',
        prompt: 'Send the recipient’s SBP phone, card number, or account number.\nDigits only where possible.',
        validate: v => onlyDigits(v).length >= 10,
        normalize: v => onlyDigits(v),
      },
      {
        key: 'note',
        label: 'Payment Note',
        prompt: '✍️ Add a payment note if needed, or type *none* to skip.',
        validate: () => true,
      },
    ];
  }

  if (target === 'NG') {
    return [
      {
        key: 'full_name',
        label: 'Recipient Full Name',
        prompt: 'Send the recipient’s full name exactly as it appears on their Nigerian bank account.',
        validate: v => v && v.length >= 2,
      },
      {
        key: 'phone',
        label: 'Recipient Phone',
        prompt: 'Send the recipient’s phone number in international format.\nExample: +2348012345678',
        validate: v => onlyDigits(v).length >= 11,
        normalize: v => onlyDigits(v),
      },
      {
        key: 'bank',
        label: 'Bank Name',
        prompt: 'Send the recipient’s bank name.\nExample: Access Bank',
        validate: v => v && v.length >= 2,
      },
      {
        key: 'account',
        label: 'Account Number',
        prompt: 'Send the 10-digit Nigerian account number.\nDigits only.',
        validate: v => onlyDigits(v).length === 10,
        normalize: v => onlyDigits(v),
      },
      {
        key: 'note',
        label: 'Payment Note',
        prompt: '✍️ Add a payment note if needed, or type *none* to skip.',
        validate: () => true,
      },
    ];
  }

  return [
    {
      key: 'full_name',
      label: 'Recipient Full Name',
      prompt: 'Send the recipient’s full name exactly as it appears on their account.',
      validate: v => v && v.length >= 2,
    },
    {
      key: 'phone',
      label: 'Recipient Phone',
      prompt: 'Send the recipient’s phone number in international format.\nExample: +2348012345678',
      validate: v => onlyDigits(v).length >= 7,
      normalize: v => onlyDigits(v),
    },
    {
      key: 'bank',
      label: 'Bank Name',
      prompt: 'Send the recipient’s bank name.',
      validate: v => v && v.length >= 2,
    },
    {
      key: 'account',
      label: 'Account Number',
      prompt: 'Send the recipient’s bank account number.\nDigits only.',
      validate: v => onlyDigits(v).length >= 6,
      normalize: v => onlyDigits(v),
    },
    {
      key: 'note',
      label: 'Payment Note',
      prompt: '✍️ Add a payment note if needed, or type *none* to skip.',
      validate: () => true,
    },
  ];
}

function recipientFieldForSession(s, key) {
  return recipientSchemaForSession(s).find(field => field.key === key) || null;
}

function buildRecipientAccountInfo(s) {
  const schema = recipientSchemaForSession(s);
  return schema
    .map(field => `${field.label}: ${s.scratch?.rec_answers?.[field.key] ?? ''}`)
    .join('\n');
}

function buildRecipientIntro(s) {
  return `I need a few recipient details for payout in *${countryName(s?.scratch?.target_country)}*.`;
}

function upsertRecentPair(recentPairs, entry) {
  const next = [entry, ...(recentPairs || []).filter(item =>
    !(item.exchange_pair_id === entry.exchange_pair_id && item.payment_method === entry.payment_method)
  )];
  return next.slice(0, 5);
}

function upsertSavedRecipient(savedRecipients, entry) {
  const next = [entry, ...(savedRecipients || []).filter(item =>
    !(item.exchange_pair_id === entry.exchange_pair_id &&
      item.account === entry.account &&
      item.phone === entry.phone)
  )];
  return next.slice(0, 5);
}

async function rememberTransferProfile(waId, pair, s) {
  const profile = await profileFor(waId);
  const fields = { ...(s.scratch?.rec_answers || {}) };
  const recipient = {
    full_name: fields.full_name || '',
    phone: fields.phone || '',
    bank: fields.bank || '',
    account: fields.account || '',
    note: fields.note || '',
    fields,
    label: summarizeRecipient(fields),
  };
  const now = Date.now();

  profile.lastTransfer = {
    exchange_pair_id: pair.id,
    payment_method: s.scratch.payment_method,
    mode: s.scratch.mode || 'source_to_target',
    fee_percent: s.scratch.fee_percent,
    source_country: pair.source_country,
    target_country: pair.target_country,
    source_currency: pair.source_currency,
    target_currency: pair.target_currency,
    recipient,
    updatedAt: now,
  };

  profile.recentPairs = upsertRecentPair(profile.recentPairs, {
    exchange_pair_id: pair.id,
    payment_method: s.scratch.payment_method,
    source_country: pair.source_country,
    target_country: pair.target_country,
    source_currency: pair.source_currency,
    target_currency: pair.target_currency,
    updatedAt: now,
  });

  if (recipient.full_name || recipient.account) {
    profile.savedRecipients = upsertSavedRecipient(profile.savedRecipients, {
      exchange_pair_id: pair.id,
      full_name: recipient.full_name,
      phone: recipient.phone,
      bank: recipient.bank,
      account: recipient.account,
      note: recipient.note,
      fields: recipient.fields,
      label: recipient.label,
      updatedAt: now,
    });
  }

  await saveProfile(waId, profile);
}

function mostRecentRecipientForPair(profile, pairId) {
  return (profile?.savedRecipients || []).find(item => item.exchange_pair_id === pairId) || null;
}

async function sessionFor(waId) {
  if (isRedisReady()) {
    const raw = await persistence.redis.get(sessionKey(waId));
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.error('❗[session:parse]', err.message || err);
      }
    }
    const fresh = defaultSession();
    await saveSession(waId, fresh);
    return fresh;
  }

  let s = mem.sessions.get(waId);
  if (!s) {
    s = defaultSession();
    mem.sessions.set(waId, s);
  }
  return s;
}

async function saveSession(waId, s) {
  const now = Date.now();
  s.createdAt = s.createdAt || now;
  s.updatedAt = now;

  if (isRedisReady()) {
    await persistence.redis.set(sessionKey(waId), JSON.stringify(s), {
      EX: SESSION_TTL_SEC,
    });
    return;
  }

  mem.sessions.set(waId, s);
}

async function runSerialForUser(waId, task) {
  const previous = userQueues.get(waId) || Promise.resolve();
  const safePrevious = previous.catch(() => {});
  let releaseCurrent;
  const current = new Promise(resolve => {
    releaseCurrent = resolve;
  });
  const next = safePrevious.then(() => current);
  userQueues.set(waId, next);

  await safePrevious;

  try {
    return await task();
  } finally {
    releaseCurrent();
    if (userQueues.get(waId) === next) {
      userQueues.delete(waId);
    }
  }
}

async function reset(waId) {
  const old = await sessionFor(waId);
  await saveSession(waId, {
    step: 'idle',
    scratch: {},
    hasWelcomed: old.hasWelcomed || false,
    lastOrderId: old.lastOrderId || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resumeOffered: false,
  });
}

function hasActiveFlow(s) {
  return [
    'exchange_pair',
    'exchange_method',
    'exchange_mode',
    'exchange_amount',
    'exchange_confirm',
    'recipient_choice',
    'recipient_collect',
    'recipient_edit',
    'recipient_edit_pick',
    'final_confirm',
    'await_receipt',
    'await_track',
  ].includes(s?.step);
}

async function resendPaymentReminder(waId, s) {
  if (!s?.lastOrderId) {
    return sendText(waId, 'I could not find an active order. Type *menu* to start again.');
  }

  return sendText(
    waId,
    `You still have *Order #${s.lastOrderId}* open.\n` +
    `${s.scratch?.admin_info ? `\n*Payment details*\n${s.scratch.admin_info}\n` : ''}\n` +
    `Send your *payment receipt* here as an image or PDF when ready.`
  );
}

async function resendQuoteReview(waId, s) {
  const quote = s?.scratch?.quote;
  if (!quote) {
    return sendText(waId, 'Your previous quote has expired. Type *menu* to start again.');
  }

  await sendText(
    waId,
    `${flowStepLabel(4, 'Review quote')}\n\n` +
    `*You pay*\n${formatAmount(quote.total_source_to_send)} ${s.scratch.source_currency}\n\n` +
    `*Recipient gets*\n${formatAmount(quote.converted_amount)} ${s.scratch.target_currency}\n\n` +
    `*Rate*\n1 ${s.scratch.source_currency} = ${quote.adjusted_rate} ${s.scratch.target_currency}\n\n` +
    `*Method*\n${s.scratch.payment_method} • Fee ${s.scratch.fee_percent}%`
  );

  return sendButtons(
    waId,
    'Everything looks ready. Please review the quote before we collect recipient details.',
    [
      { type: 'reply', reply: { id: 'confirm_yes', title: `${EMOJI.success} Continue` } },
      { type: 'reply', reply: { id: 'edit_amount', title: `${EMOJI.edit} Change amount` } },
      { type: 'reply', reply: { id: 'cancel', title: `${EMOJI.warn} Cancel` } },
    ]
  );
}

async function resendRecipientReview(waId, s) {
  await sendText(
    waId,
    `${flowStepLabel(6, 'Review order')}\n\n` +
    `*Recipient details*\n${s.scratch.recipient_account_info}\n\n` +
    `*Transfer summary*\n` +
    `Pay ${formatAmount(s.scratch.quote.total_source_to_send)} ${s.scratch.source_currency}\n` +
    `Recipient gets ${formatAmount(s.scratch.quote.converted_amount)} ${s.scratch.target_currency}`
  );

  return sendButtons(
    waId,
    'Please confirm the details before I create this order.',
    [
      { type: 'reply', reply: { id: 'create_order', title: `${EMOJI.success} Confirm order` } },
      { type: 'reply', reply: { id: 'edit_recipient_field', title: `${EMOJI.edit} Edit detail` } },
      { type: 'reply', reply: { id: 'cancel', title: `${EMOJI.warn} Cancel` } },
    ]
  );
}

async function sendRecipientEditList(waId, s) {
  const schema = recipientSchemaForSession(s);
  s.step = 'recipient_edit_pick';
  await saveSession(waId, s);

  return sendList(
    waId,
    flowStepLabel(6, 'Edit recipient'),
    'Choose the recipient detail you want to update.',
    'Edit detail',
    schema.map(field => ({
      id: `editf_${field.key}`,
      title: field.label,
      description: clipText(String(s.scratch?.rec_answers?.[field.key] ?? 'Not set'), 72),
    }))
  );
}

async function promptRecipientField(waId, s, index, opts = {}) {
  const schema = recipientSchemaForSession(s);
  const field = schema[index] || schema[0];
  const lines = [`${recipientStepLabel(index, schema.length)}`];

  if (opts.includeIntro) {
    lines.push(buildRecipientIntro(s));
  }

  if (opts.validationError) {
    lines.push('That detail does not look complete yet.');
  }

  lines.push(field.prompt);
  return sendText(waId, lines.join('\n'));
}

async function promptRecipientEditField(waId, s, fieldKey) {
  const field = recipientFieldForSession(s, fieldKey);
  if (!field) {
    await sendText(waId, 'That detail is not available to edit right now.');
    return resendRecipientReview(waId, s);
  }

  s.step = 'recipient_edit';
  s.scratch.edit_field = fieldKey;
  await saveSession(waId, s);

  return sendText(
    waId,
    `${flowStepLabel(6, 'Edit recipient')}\nPlease send a new value for *${field.label}*.\n${field.prompt}`
  );
}

async function resumeCurrentFlow(waId, s) {
  s.resumeOffered = false;
  await saveSession(waId, s);

  switch (s.step) {
    case 'exchange_pair':
      return startExchangeFlow(waId);
    case 'exchange_method': {
      const rows = Object.entries(s.scratch.payment_methods || {}).map(([name, fee], i) => ({
        id: `em_${i}`,
        title: name,
        description: `Fee ${fee}%`,
      }));
      return sendList(
        waId,
        flowStepLabel(2, 'Payment method'),
        `Route selected: *${s.scratch.source_currency} → ${s.scratch.target_currency}*.\nChoose how you want to pay for this transfer.`,
        'Choose method',
        rows
      );
    }
    case 'exchange_mode':
      return sendButtons(
        waId,
        `${flowStepLabel(3, 'Quote setup')}\nHow would you like to enter the transfer amount?`,
        [
          { type: 'reply', reply: { id: 'quote_mode_pay', title: `Pay-in (${s.scratch.source_currency})` } },
          { type: 'reply', reply: { id: 'quote_mode_receive', title: `Receive (${s.scratch.target_currency})` } },
        ]
      );
    case 'exchange_amount': {
      const unit = s.scratch.mode === 'target_to_source'
        ? s.scratch.target_currency
        : s.scratch.source_currency;
      return sendText(
        waId,
        `${flowStepLabel(3, 'Enter amount')}\nSend the amount in *${unit}*.\nExample: *500*`
      );
    }
    case 'exchange_confirm':
      return resendQuoteReview(waId, s);
    case 'recipient_choice':
      return sendButtons(
        waId,
        `${flowStepLabel(5, 'Recipient details')}\nI found a saved recipient for this route.\n\n${summarizeRecipient(s.scratch?.savedRecipient)}\n\nUse this recipient or enter a new one?`,
        [
          { type: 'reply', reply: { id: 'use_saved_recipient', title: '✅ Use saved' } },
          { type: 'reply', reply: { id: 'new_recipient', title: '✍️ Enter new' } },
          { type: 'reply', reply: { id: 'cancel', title: `${EMOJI.warn} Cancel` } },
        ]
      );
    case 'recipient_collect': {
      const idx = s.scratch.rec_index ?? 0;
      return promptRecipientField(waId, s, idx, { includeIntro: idx === 0 });
    }
    case 'recipient_edit_pick':
      return sendRecipientEditList(waId, s);
    case 'recipient_edit':
      return promptRecipientEditField(waId, s, s.scratch.edit_field);
    case 'final_confirm':
      return resendRecipientReview(waId, s);
    case 'await_receipt':
      return resendPaymentReminder(waId, s);
    case 'await_track':
      return sendText(waId, 'Send the order number you want to track.\nExample: *1234*');
    default:
      return sendButtonsMenu(waId);
  }
}

async function offerResumePrompt(waId, s) {
  s.resumeOffered = true;
  await saveSession(waId, s);

  return sendButtons(
    waId,
    'You have an unfinished transfer here. Continue where you stopped or start fresh?',
    [
      { type: 'reply', reply: { id: 'resume_yes', title: '▶️ Continue' } },
      { type: 'reply', reply: { id: 'resume_restart', title: '🆕 Start over' } },
    ],
    DEFAULT_FOOTER
  );
}

// ============================================================================
// 🚀 MENUS & GREETING
// ============================================================================
async function sendButtonsMenu(to, profile = null) {
  profile = profile || await profileFor(to);
  const header = BANNER_IMAGE_URL
    ? { type: 'image', image: { link: BANNER_IMAGE_URL } }
    : { type: 'text',  text: `Welcome to ${BRAND_NAME}` };

  if (profile?.lastTransfer) {
    return sendButtons(
      to,
      `Welcome back.\nYour last route was *${pairLabelFromSnapshot(profile.lastTransfer)}*.\n\nRepeat it or start a fresh transfer?`,
      [
        { type: 'reply', reply: { id: 'repeat_last', title: '🔁 Repeat last' } },
        { type: 'reply', reply: { id: 'new_transfer', title: `${EMOJI.money} New transfer` } },
        { type: 'reply', reply: { id: 'svc_track', title: `${EMOJI.track} Track order` } },
      ],
      SUPPORT_FOOTER,
      header
    );
  }

  return sendButtons(
    to,
    `I’m *${AGENT_NAME}* from *${BRAND_NAME}*.\n\nI can help you start a transfer, track an order, or reach support quickly.`,
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
  const profile = await profileFor(to);
  const now = new Date();
  const month = now.getMonth() + 1; // December = 12

  const isChristmasSeason =
    (month === 12) ||
    (ENV('SEASON_MODE') === 'christmas'); // manual override

  // 💬 Default intro
  let txt =
    `Hello, I’m *${AGENT_NAME}* from *${BRAND_NAME}*.\n` +
    `I’ll guide your transfer step by step.`;

  // 🎄 If Christmas — upgrade message
  if (isChristmasSeason) {
    txt =
      `🎄 *Season’s greetings from ${BRAND_NAME}!*` +
      `\nI’m *${AGENT_NAME}*, ready to help with fast and secure transfers.`;
  }

  // Keep the opening lightweight: one hero message, then the menu.
  if (AGENT_IMAGE_URL) {
    await sendImageLink(to, AGENT_IMAGE_URL, txt);
  } else {
    await sendText(to, txt);
  }

  // 🔽 Show menu
  return sendButtonsMenu(to, profile);
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
  const profile = await profileFor(waId);
  s.options = {};
  s.options.pairs = await apiGetOptions('exchange');

  if (!s.options.pairs?.length) {
    return sendText(waId, `${EMOJI.warn} No transfer routes are available right now.`);
  }

  const recentIds = new Map((profile?.recentPairs || []).map((item, idx) => [item.exchange_pair_id, idx]));
  s.options.pairs.sort((a, b) => {
    const ai = recentIds.has(a.id) ? recentIds.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bi = recentIds.has(b.id) ? recentIds.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.id - b.id;
  });

  s.step = 'exchange_pair';
  await saveSession(waId, s);

  const rows = s.options.pairs.map(p => ({
    id: `pair_${p.id}`,
    title: `${p.source_country} → ${p.target_country}`,
    description: `${p.source_currency} to ${p.target_currency}${recentIds.has(p.id) ? ' • Recent route' : ''}`,
  }));

  return sendList(
    waId,
    flowStepLabel(1, 'Choose route'),
    'Choose where the money is coming from and where it should arrive.',
    'Open routes',
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
    source_country: pair.source_country,
    target_country: pair.target_country,
    source_currency:  pair.source_currency,
    target_currency:  pair.target_currency,
    payment_methods:  pair.payment_methods || {},
  };
  s.step = 'exchange_method';
  await saveSession(waId, s);

  const rows = Object.entries(s.scratch.payment_methods).map(([name, fee], i) => ({
    id: `em_${i}`,
    title: name,
    description: `${fee}% fee • Pay in ${pair.source_currency}`,
  }));

  return sendList(
    waId,
    flowStepLabel(2, 'Payment method'),
    `Route selected: *${pair.source_currency} → ${pair.target_currency}*.\nChoose how you want to make this payment.`,
    'Choose method',
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
    `${flowStepLabel(3, 'Quote setup')}\nHow would you like to enter the transfer amount?`,
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

  const unit = s.scratch.mode === 'source_to_target'
    ? s.scratch.source_currency
    : s.scratch.target_currency;
  return sendText(
    waId,
    `${flowStepLabel(3, 'Enter amount')}\nSend the amount in *${unit}*.\nExample: *500*`
  );
}

// ─── AMOUNT INPUT + QUOTE CALCULATION ───────────────────────────────────────
async function exchange_amount(waId, text) {
  const s   = await sessionFor(waId);
  const amt = Number(String(text).replace(/[ ,]/g, ''));

  if (!(amt > 0)) {
    return sendText(waId, 'That amount does not look complete yet.\nPlease send a number like *500*.');
  }

  await sendText(waId, 'Calculating your quote...');

  const quote = await apiCalcExchange({
    exchange_pair_id: s.scratch.exchange_pair_id,
    amount:          amt,
    payment_method:  s.scratch.payment_method,
    mode:            s.scratch.mode,
  });

  if (!quote) {
    return sendText(waId, `${EMOJI.warn} I could not calculate that quote yet. Please try again.`);
  }

  s.scratch.amount = amt;
  s.scratch.quote  = quote;
  s.step = 'exchange_confirm';
  await saveSession(waId, s);

  await sendText(
    waId,
    `${flowStepLabel(4, 'Review quote')}\n\n` +
    `*You pay*\n${formatAmount(quote.total_source_to_send)} ${s.scratch.source_currency}\n\n` +
    `*Recipient gets*\n${formatAmount(quote.converted_amount)} ${s.scratch.target_currency}\n\n` +
    `*Rate*\n1 ${s.scratch.source_currency} = ${quote.adjusted_rate} ${s.scratch.target_currency}\n\n` +
    `*Method*\n${s.scratch.payment_method} • Fee ${s.scratch.fee_percent}%`
  );

  return sendButtons(
    waId,
    'Everything looks ready. Please review the quote before we collect recipient details.',
    [
      { type: 'reply', reply: { id: 'confirm_yes', title: `${EMOJI.success} Continue` } },
      { type: 'reply', reply: { id: 'edit_amount', title: `${EMOJI.edit} Change amount` } },
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

  if (id === 'edit_amount') {
    s.step = 'exchange_amount';
    await saveSession(waId, s);
    const unit = s.scratch.mode === 'source_to_target'
      ? s.scratch.source_currency
      : s.scratch.target_currency;
    return sendText(
      waId,
      `${flowStepLabel(3, 'Enter amount')}\nSend the new amount in *${unit}*.`
    );
  }

  const profile = await profileFor(waId);
  const savedRecipient = mostRecentRecipientForPair(profile, s.scratch.exchange_pair_id);

  if (savedRecipient) {
    s.step = 'recipient_choice';
    s.scratch.savedRecipient = savedRecipient;
    await saveSession(waId, s);

    return sendButtons(
      waId,
      `${flowStepLabel(5, 'Recipient details')}\nI found a saved recipient for this route.\n\n${summarizeRecipient(savedRecipient)}\n\nUse this recipient or enter a new one?`,
      [
        { type: 'reply', reply: { id: 'use_saved_recipient', title: '✅ Use saved' } },
        { type: 'reply', reply: { id: 'new_recipient', title: '✍️ Enter new' } },
        { type: 'reply', reply: { id: 'cancel', title: `${EMOJI.warn} Cancel` } },
      ]
    );
  }

  // move into recipient collection flow
  s.step = 'recipient_collect';
  s.scratch.rec_answers = {};
  s.scratch.rec_index   = 0;
  await saveSession(waId, s);

  return promptRecipientField(waId, s, 0, { includeIntro: true });
}

// ============================================================================
// 🧾 RECIPIENT FORM (No skip, guided form)
// ============================================================================
async function recipient_collect(waId, text) {
  const s   = await sessionFor(waId);
  const schema = recipientSchemaForSession(s);
  const idx = s.scratch.rec_index ?? 0;
  const raw = String(text || '').trim();

  const field = schema[idx];
  if (!field) {
    return sendText(waId, 'Something went wrong with the recipient form. Type *menu* to restart.');
  }

  if (!field.validate(raw)) {
    return promptRecipientField(waId, s, idx, { validationError: true, includeIntro: idx === 0 });
  }

  s.scratch.rec_answers = s.scratch.rec_answers || {};
  s.scratch.rec_answers[field.key] = field.normalize ? field.normalize(raw) : raw;
  s.scratch.rec_index = idx + 1;

  if (s.scratch.rec_index >= schema.length) {
    s.scratch.recipient_account_info = buildRecipientAccountInfo(s);

    s.step = 'final_confirm';
    await saveSession(waId, s);
    return resendRecipientReview(waId, s);
  }

  await saveSession(waId, s);

  // ask next question
  return promptRecipientField(waId, s, s.scratch.rec_index);
}

function validateRequiredEnv() {
  const required = [
    'WABA_TOKEN',
    'WABA_PHONE_NUMBER_ID',
    'WABA_VERIFY_TOKEN',
    'LARAVEL_API_URL',
    'BOT_API_KEY',
    'ADMIN_PHONE',
  ];
  const missing = required.filter(k => !ENV(k));
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function recipient_edit(waId, text) {
  const s = await sessionFor(waId);
  const field = recipientFieldForSession(s, s.scratch.edit_field);
  const raw = String(text || '').trim();

  if (!field) {
    s.step = 'final_confirm';
    await saveSession(waId, s);
    return resendRecipientReview(waId, s);
  }

  if (!field.validate(raw)) {
    return sendText(
      waId,
      `${flowStepLabel(6, 'Edit recipient')}\nThat detail does not look complete yet.\n${field.prompt}`
    );
  }

  s.scratch.rec_answers = s.scratch.rec_answers || {};
  s.scratch.rec_answers[field.key] = field.normalize ? field.normalize(raw) : raw;
  s.scratch.recipient_account_info = buildRecipientAccountInfo(s);
  s.scratch.edit_field = null;
  s.step = 'final_confirm';
  await saveSession(waId, s);

  return resendRecipientReview(waId, s);
}

// ============================================================================
// 🧾 CREATE ORDER
// ============================================================================
async function createOrder(waId) {
  const s = await sessionFor(waId);
  const q = s.scratch.quote;

  if (!q) {
    return sendText(waId, `${EMOJI.warn} I could not find a quote for this session. Please start again.`);
  }

  // Retrieve selected exchange pair
  const pair = (s.options?.pairs || []).find(p => p.id === s.scratch.exchange_pair_id);
  if (!pair) return sendText(waId, 'Transfer route not found. Please restart.');

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
    return sendText(waId, `${EMOJI.warn} I could not create the order yet. Please try again.`);
  }

  s.lastOrderId = res.order_id;
  s.step = 'await_receipt';

  // 🆕 STORE ADMIN ACCOUNT INFO IN SESSION — prevents repeated not-found errors
  s.scratch.admin_info = pair.admin_account_info?.trim() || null;

  await rememberTransferProfile(waId, pair, s);
  await saveSession(waId, s);

  if (CELEBRATE_STICKER_URL) {
    await sendImageLink(waId, CELEBRATE_STICKER_URL);
  }

  if (!s.scratch.admin_info) {
    return sendText(waId, '⚠️ Payment details are not available yet. Please contact support.');
  }

  // Show order summary and payment details immediately to remove extra taps.
  await sendText(
    waId,
    `🎉 *Order #${res.order_id} created*\n\n` +
    `${flagFrom} ➜ ${flagTo}\n` +
    `*${formatAmount(q.total_source_to_send)} ${curFrom} → ${formatAmount(q.converted_amount)} ${curTo}*\n\n` +
    `*Pay now*\n${formatAmount(q.total_source_to_send)} ${curFrom}\n\n` +
    `*Rate*\n1 ${curFrom} = ${q.adjusted_rate} ${curTo}\n\n` +
    `*Payment details*\n${s.scratch.admin_info}\n\n` +
    `After payment, send your receipt image or PDF here in this chat.`
  );

  return sendButtons(
    waId,
    'Payment details are ready. Send the receipt here after payment.',
    [
      { type: 'reply', reply: { id: 'paid_done', title: '📎 I have paid' } },
      { type: 'reply', reply: { id: 'svc_admin', title: '📞 Contact admin' } }
    ],
    'SafeCare • Receipt image or PDF'
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
    return sendText(waId, 'I could not read that file. Please send the receipt again as an image or PDF.');
  }

  // Fetch metadata
  const meta = await safe(() => graph.get(`/${media.id}`), 'graph:getMediaMeta');
  const url = meta?.data?.url;
  if (!url) {
    return sendText(waId, 'I could not fetch the media details. Please send the receipt again.');
  }

  // Download binary
  const bin = await safe(() => graphRaw.get(url), 'graphRaw:getMediaBin');
  if (!bin?.data) {
    return sendText(waId, 'I could not download that file. Please try sending it again.');
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
    `📎 Receipt uploaded for *Order #${orderId}*.\n\n` +
    `We’ll review it and update your order.\n` +
    `Type *status ${orderId}* anytime to check progress.`
  );
}

// ============================================================================
// 🌐 WEBHOOK HANDLERS
// ============================================================================

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'cloud-bot' });
});

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
    return sendText(waId, 'Please send the order number like this:\n*status 1234*');
  }

  const st = await apiOrderStatus(id);
  if (st?.status) {
    return sendText(waId, `📦 *Order #${id}*\nStatus: *${st.status}*`);
  }
  return sendText(waId, 'I could not find that order yet.');
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
    await sendText(waId, `📦 *Order #${id}*\nStatus: *${st.status}*`);
  } else {
    await sendText(waId, 'I could not find that order yet.');
  }

  s.step = 'idle';
  s.resumeOffered = false;
  await saveSession(waId, s);
}

// --- MAIN WEBHOOK ROUTE ----------------------------------------------------
// --- MAIN WEBHOOK ROUTE ----------------------------------------------------
app.post('/webhook/whatsapp', async (req, res) => {
  const entry = req.body?.entry?.[0]?.changes?.[0]?.value || {};
  const msgs  = entry.messages || [];

  for (const m of msgs) {
    const waId = m.from;

    await runSerialForUser(waId, async () => {
      if (!(await markMessageProcessed(m.id))) {
        console.log("⚠️ Duplicate message ignored:", m.id);
        return;
      }

      // Get session after dedupe succeeds
      const s = await sessionFor(waId);
      s.resumeOffered = false;
      await saveSession(waId, s);

      // Now safe to use text
      const text = m.text?.body?.trim() || '';

      // =========================================================================
      // 1️⃣ MEDIA RECEIPTS (image / document)
      // =========================================================================
      if (m.type === 'image' || m.type === 'document') {
        await handleMediaReceipt(waId, m);
        return;
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
            return;
          }

          const adminInfo = s.scratch.admin_info;
          if (!adminInfo) {
            await sendText(waId, '⚠️ Payment details are not available yet. Please contact support.');
            return;
          }

          await sendText(
            waId,
            `📋 *Payment details*\n${adminInfo}\n\n` +
            `After payment, send your receipt image or PDF here.`
          );
          return;
        }

        if (id === 'paid_done') {
          await sendText(
            waId,
            'Please send your payment receipt here as an image or PDF, and I’ll attach it to your order.'
          );
          return;
        }

        if (id === 'repeat_last') {
          const profile = await profileFor(waId);
          const last = profile?.lastTransfer;
          if (!last?.exchange_pair_id) {
            await sendText(waId, 'I could not find a previous transfer to repeat yet.');
            await startExchangeFlow(waId);
            return;
          }

          s.options = {};
          s.options.pairs = await apiGetOptions('exchange');
          const pair = (s.options.pairs || []).find(p => p.id === last.exchange_pair_id);
          if (!pair) {
            await sendText(waId, 'Your previous route is not available right now, so let’s pick a new one.');
            await startExchangeFlow(waId);
            return;
          }

          const paymentMethods = pair.payment_methods || {};
          if (!Object.prototype.hasOwnProperty.call(paymentMethods, last.payment_method)) {
            await sendText(waId, 'Your previous payment method is unavailable, so let’s pick a new one.');
            await exchange_pick_pair_by_id(waId, String(pair.id));
            return;
          }

          s.scratch = {
            exchange_pair_id: pair.id,
            source_country: pair.source_country,
            target_country: pair.target_country,
            source_currency: pair.source_currency,
            target_currency: pair.target_currency,
            payment_methods: paymentMethods,
            payment_method: last.payment_method,
            fee_percent: paymentMethods[last.payment_method],
            mode: last.mode || 'source_to_target',
            savedRecipient: mostRecentRecipientForPair(profile, pair.id),
          };
          s.step = 'exchange_amount';
          await saveSession(waId, s);

          const unit = s.scratch.mode === 'target_to_source'
            ? s.scratch.target_currency
            : s.scratch.source_currency;
          await sendText(
            waId,
            `Welcome back.\nRepeating *${pair.source_country} → ${pair.target_country}* via *${last.payment_method}*.\n${s.scratch.savedRecipient ? `\nRecipient: ${summarizeRecipient(s.scratch.savedRecipient)}\n` : ''}`
          );
          await sendText(
            waId,
            `${flowStepLabel(3, 'Enter amount')}\nSend the amount in *${unit}*.`
          );
          return;
        }

        if (id === 'new_transfer') {
          await startExchangeFlow(waId);
          return;
        }

        if (id === 'use_saved_recipient') {
          const saved = s.scratch.savedRecipient;
          if (!saved) {
            await sendText(waId, 'Saved recipient not found. Please enter a new recipient.');
            s.step = 'recipient_collect';
            s.scratch.rec_answers = {};
            s.scratch.rec_index = 0;
            await saveSession(waId, s);
            await promptRecipientField(waId, s, 0, { includeIntro: true });
            return;
          }

          s.scratch.rec_answers = {
            ...(saved.fields || {}),
            full_name: saved.full_name || saved.fields?.full_name || '',
            phone: saved.phone || saved.fields?.phone || '',
            bank: saved.bank || saved.fields?.bank || '',
            account: saved.account || saved.fields?.account || '',
            note: saved.note || saved.fields?.note || 'none',
          };
          s.scratch.recipient_account_info = buildRecipientAccountInfo(s);
          s.step = 'final_confirm';
          await saveSession(waId, s);
          await resendRecipientReview(waId, s);
          return;
        }

        if (id === 'new_recipient') {
          s.step = 'recipient_collect';
          s.scratch.rec_answers = {};
          s.scratch.rec_index = 0;
          await saveSession(waId, s);
          await promptRecipientField(waId, s, 0, { includeIntro: true });
          return;
        }

        if (id === 'edit_recipient_field') {
          await sendRecipientEditList(waId, s);
          return;
        }

      if (id === 'resume_yes') {
        await resumeCurrentFlow(waId, s);
          return;
        }

      if (id === 'resume_restart') {
        await reset(waId);
        await sendButtonsMenu(waId);
          return;
        }

      // =========================================================================
      // MAIN SERVICE BUTTONS
      // =========================================================================
        if (id === 'svc_exchange') {
          await startExchangeFlow(waId);
          return;
        }

        if (id === 'svc_track') {
          s.step = 'await_track';
          await saveSession(waId, s);
          await sendText(waId, 'Send the order number you want to track.\nExample: *1234*');
          return;
        }

        if (id === 'svc_admin') {
          await sendText(waId, `📞 Support: +${ADMIN_PHONE}`);
          return;
        }

      // Quote mode
        if (id === 'quote_mode_pay' || id === 'quote_mode_receive') {
          await exchange_mode_button(waId, id);
          return;
        }

        if (id === 'cancel') {
          await reset(waId);
          await sendHeroWelcome(waId);
          return;
        }
      // Quote confirm
        if (id === 'confirm_yes') {
          await finishConfirm(waId, id);
          return;
        }

        if (id === 'edit_amount') {
          await finishConfirm(waId, id);
          return;
        }

      // Create order
        if (id === 'create_order') {
          await createOrder(waId);
          return;
        }

      // Edit recipient
        if (id === 'edit_recipient') {
          s.step = 'recipient_collect';
          s.scratch.rec_index = 0;
          await saveSession(waId, s);
          await promptRecipientField(waId, s, 0, { includeIntro: true });
          return;
        }
      }

      // =========================================================================
      // 3️⃣ LIST REPLIES (exchange pair + payment method)
      // =========================================================================
      if (m.interactive?.type === 'list_reply') {
        const id = m.interactive.list_reply.id;

        if (id.startsWith('pair_')) {
          await exchange_pick_pair_by_id(waId, id.replace('pair_', ''));
          return;
        }

        if (id.startsWith('em_')) {
          await exchange_method_pick(waId, id);
          return;
        }

        if (id.startsWith('editf_')) {
          await promptRecipientEditField(waId, s, id.replace('editf_', ''));
          return;
        }
      }

      // =========================================================================
      // 4️⃣ BASIC COMMANDS
      // =========================================================================
      const lower = text.toLowerCase();

      if (['support', 'admin', 'help'].includes(lower)) {
        await sendText(waId, `📞 Support: +${ADMIN_PHONE}`);
        return;
      }

      if (['hi', 'hello', 'menu', 'start'].includes(lower)) {
        if (hasActiveFlow(s)) {
          await offerResumePrompt(waId, s);
          return;
        }
        await sendHeroWelcome(waId);
        s.hasWelcomed = true;
        s.resumeOffered = false;
        await saveSession(waId, s);
        return;
      }

      if (lower.startsWith('status')) {
        await handleStatusQuery(waId, text);
        return;
      }

      // =========================================================================
      // 5️⃣ FLOW STATE HANDLERS
      // =========================================================================
      if (s.step === 'exchange_amount') {
        await exchange_amount(waId, text);
        return;
      }

      if (s.step === 'recipient_collect') {
        await recipient_collect(waId, text);
        return;
      }

      if (s.step === 'recipient_edit') {
        await recipient_edit(waId, text);
        return;
      }

      if (s.step === 'await_track') {
        await handleTrackStep(waId, text, s);
        return;
      }

      // =========================================================================
      // 6️⃣ FALLBACK
      // =========================================================================
      await sendText(waId, 'Type *menu* to begin.');
    });
  }

  res.json({ ok: true });
});




// ============================================================================
// 🚀 BOOT
// ============================================================================
async function bootstrap() {
  validateRequiredEnv();
  await initRedis();
  app.listen(PORT, () => {
    console.log(`🔥 SafeCare Bot running on port ${PORT} — DIRECT Cloud API (port ${PORT})`);
  });
}

bootstrap().catch(err => {
  console.error('❗[bootstrap]', err);
  process.exit(1);
});
