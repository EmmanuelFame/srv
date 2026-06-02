// utils/graph.js
const axios = require('axios');

async function graphRequest(endpoint, method = 'GET', data = null) {
  const url = `https://graph.facebook.com/v23.0/${endpoint}`;
  try {
    const res = await axios({
      url,
      method,
      headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` },
      data,
    });
    return res.data;
  } catch (err) {
    console.error('[graphRequest error]', err?.response?.data || err.message);
    throw err;
  }
}

module.exports = { graphRequest };
