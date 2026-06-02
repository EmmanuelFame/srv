// /srv/cloud-bot/helpers/media.js  🚀 FINAL & SAFE

const axios = require('axios');
const FormData = require('form-data');
const mime = require('mime-types');

const API_VER  = process.env.WABA_API_VERSION;
const WA_TOKEN = process.env.WABA_TOKEN;
const PHONE_ID = process.env.WABA_PHONE_NUMBER_ID;

// OPTIONAL: If you want fallback template
// const { sendTemplate } = require('./templates'); // Uncomment if templates exist

// 1️⃣ DOWNLOAD + UPLOAD TO META
async function uploadMediaFromURL(url) {
  console.log('[uploadMediaFromURL] Fetching from Laravel:', url);

  const fileRes = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'WhatsAppBot/1.0' },
  });

  const guessedMime = mime.lookup(url) || 'application/octet-stream';
  const filename    = url.split('/').pop() || 'file';

  console.log('[uploadMediaFromURL] MIME:', guessedMime, 'File:', filename);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', fileRes.data, { filename, contentType: guessedMime });
  form.append('type', guessedMime.startsWith('image/') ? 'image' : 'document');

  const res = await axios.post(
    `https://graph.facebook.com/${API_VER}/${PHONE_ID}/media`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${WA_TOKEN}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    }
  );

  console.log('[uploadMediaFromURL] Uploaded OK → media_id:', res.data.id);
  return res.data.id;
}


// 2️⃣ SEND MEDIA TO USER
async function sendMediaWithUpload(to, url, caption = '') {
  try {
    const mediaId = await uploadMediaFromURL(url);
    if (!mediaId) throw new Error('No media ID returned from Meta.');

    const guessedMime = mime.lookup(url) || '';
    const isImage     = guessedMime.startsWith('image/');

    console.log('[sendMediaWithUpload] Sending to', to, 'mediaId:', mediaId);

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: isImage ? 'image' : 'document',
        [isImage ? "image" : "document"]: {
      id: mediaId,
      caption: caption || undefined,
      ...(isImage ? {} : { filename: url.split('/').pop() })
      // images MUST NOT have filename!
  },
    };

    const sendRes = await axios.post(
      `https://graph.facebook.com/${API_VER}/${PHONE_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${WA_TOKEN}` } }
    );

    console.log('[sendMediaWithUpload] /messages OK:', sendRes.data);
    return sendRes;

  } catch (err) {
    const meta = err.response?.data || err.message;
    console.error('[sendMediaWithUpload ERROR]:', meta);

    // 🛠 HANDLE 24-HOUR RULE CLEANLY
    const details = err.response?.data?.error?.error_data?.details || '';
    const code    = err.response?.data?.error?.code || null;

    if (code === 131047 || details.includes('24 hours')) {
      console.warn('[sendMediaWithUpload] ❗ 24h window exceeded for', to);

      // OPTIONAL: if you want template fallback:
      // try {
      //   return await sendTemplate(to, 'final_receipt', []);
      // } catch (tplErr) {
      //   console.error('[template fallback failed]', tplErr.response?.data || tplErr.message);
      // }

      throw new Error('Cannot send: 24-hour limit exceeded for this number.');
    }

    throw err; // rethrow for /send-media route
  }
}

module.exports = { uploadMediaFromURL, sendMediaWithUpload };
