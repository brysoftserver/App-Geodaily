// ============================================================
// Cliente mínimo de DeepSeek (la API key la guarda el admin en
// configuracion_sistema, ver routes/ia.js)
// ============================================================

const db = require('../database');

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

async function obtenerApiKey() {
  const row = await db.queryOne('SELECT valor FROM configuracion_sistema WHERE clave = $1', ['deepseek_api_key']);
  return row?.valor || null;
}

/**
 * Devuelve el texto de la respuesta, o null si no hay key / DeepSeek falla.
 * Nunca lanza: quien llama decide cómo degradar.
 */
async function preguntar({ sistema, usuario, json = false, maxTokens = 1500, timeoutMs = 60000 }) {
  const apiKey = await obtenerApiKey().catch(() => null);
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const respuesta = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: usuario },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
        stream: false,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    });
    if (!respuesta.ok) {
      console.warn(`[DeepSeek] respondió ${respuesta.status}:`, (await respuesta.text().catch(() => '')).slice(0, 300));
      return null;
    }
    const data = await respuesta.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.warn('[DeepSeek] Error:', error.name === 'AbortError' ? 'timeout' : error.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { preguntar };
