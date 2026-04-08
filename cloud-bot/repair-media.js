// repair-media.js — Upload images/stickers to Cloud API and print media IDs
require('dotenv').config();
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.WABA_TOKEN;
const PHONE_ID = process.env.WABA_PHONE_NUMBER_ID;
const API_VER = process.env.WABA_API_VERSION || "v23.0";

console.log("📌 TOKEN:", TOKEN ? "OK" : "❌ MISSING!");
console.log("📌 PHONE_ID:", PHONE_ID ? PHONE_ID : "❌ MISSING!");

if (!TOKEN || !PHONE_ID) {
  console.error("❌ ERROR: Missing TOKEN or PHONE_ID in .env");
  process.exit(1);
}

async function uploadMedia(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const isSticker = ext === ".webp"; // Auto detect stickers

  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));
  form.append("messaging_product", "whatsapp");

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/${API_VER}/${PHONE_ID}/media`,
      form,
      { headers: { Authorization: `Bearer ${TOKEN}`, ...form.getHeaders() } }
    );

    const mediaId = data.id;
    console.log(`\n✔ Uploaded: ${filePath}`);
    console.log(`   → media_id = ${mediaId}`);

    // Generate clean ENV var name
    const base = path.basename(filePath).replace(/\.[a-z]+$/i, '').toUpperCase();
    const envName = isSticker ? `${base}_STICKER_ID` : `${base}_MEDIA_ID`;

    // Output ready for copy
    console.log(`👉 Add to .env:\n${envName}=${mediaId}`);
    return { filePath, id: mediaId, envName };
  } catch (err) {
    console.error(`\n❌ FAILED to upload: ${filePath}`);
    console.error(`    →`, err?.response?.data || err?.message);
    return null;
  }
}

async function main() {
  const folder = path.resolve(__dirname, "assets");
  console.log("\n📂 Scanning:", folder);

  const files = fs.readdirSync(folder).filter(f => !f.startsWith('.'));
  console.log("📄 Files found:", files);

  const results = [];
  for (const f of files) {
    const full = path.join(folder, f);
    const res = await uploadMedia(full);
    if (res) results.push(res);
  }

  console.log("\n📌 JSON Export (if needed for API calls):");
  console.log(JSON.stringify(results, null, 2));
}

main();
