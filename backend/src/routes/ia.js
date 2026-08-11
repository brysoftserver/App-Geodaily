// ============================================================
// GEODAILY — Análisis de gráficas con IA (DeepSeek)
// ============================================================
// El admin guarda la API key de DeepSeek aquí (tabla configuracion_sistema,
// clave 'deepseek_api_key'). La app llama a /analizar-grafico por cada
// gráfica del PDF del Dashboard que el usuario decide incluir; si no hay
// key configurada o DeepSeek falla, se responde con error y el cliente
// simplemente omite el análisis de esa gráfica (el PDF se genera igual).
// ============================================================

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const db = require('../database');
const router = express.Router();

const CLAVE_DEEPSEEK = 'deepseek_api_key';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const TIMEOUT_DEEPSEEK_MS = 25000;

async function obtenerApiKey() {
  const row = await db.queryOne('SELECT valor FROM configuracion_sistema WHERE clave = $1', [CLAVE_DEEPSEEK]);
  return row?.valor || null;
}

// GET /api/ia/config — solo admin. Nunca devuelve la key completa.
router.get('/config', authenticateToken, async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ success: false, error: 'Solo administradores' });
  }
  try {
    const apiKey = await obtenerApiKey();
    res.json({
      success: true,
      configurado: !!apiKey,
      ultimosDigitos: apiKey ? apiKey.slice(-4) : null,
    });
  } catch (error) {
    console.error('[IA] Error consultando configuración:', error.message);
    res.status(500).json({ success: false, error: 'Error consultando configuración' });
  }
});

// PUT /api/ia/config — solo admin. body: { apiKey: string }
router.put('/config', authenticateToken, async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ success: false, error: 'Solo administradores' });
  }
  const { apiKey } = req.body;
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ success: false, error: 'La API key es obligatoria' });
  }
  try {
    await db.query(
      `INSERT INTO configuracion_sistema (clave, valor, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
      [CLAVE_DEEPSEEK, apiKey.trim()]
    );
    res.json({ success: true });
  } catch (error) {
    console.error('[IA] Error guardando configuración:', error.message);
    res.status(500).json({ success: false, error: 'Error guardando configuración' });
  }
});

// DELETE /api/ia/config — solo admin. Borra la key (desactiva el análisis con IA).
router.delete('/config', authenticateToken, async (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ success: false, error: 'Solo administradores' });
  }
  try {
    await db.query('DELETE FROM configuracion_sistema WHERE clave = $1', [CLAVE_DEEPSEEK]);
    res.json({ success: true });
  } catch (error) {
    console.error('[IA] Error eliminando configuración:', error.message);
    res.status(500).json({ success: false, error: 'Error eliminando configuración' });
  }
});

function construirPrompt({ titulo, tipo, seccion, datos, totalRespuestas, unidad }) {
  const lineasDatos = (datos || [])
    .map((d) => `- ${d.etiqueta}: ${d.valor}${unidad ? ` ${unidad}` : ''}`)
    .join('\n');

  return `Sección del informe: ${seccion || '—'}
Pregunta / gráfica: ${titulo}
Tipo de gráfica: ${tipo === 'pie' ? 'torta (distribución de categorías)' : 'barras (conteo por categoría)'}
Total de respuestas consideradas: ${totalRespuestas}

Datos:
${lineasDatos}`;
}

const PROMPT_SISTEMA = `Eres un analista de datos que redacta el informe técnico de un proyecto de extensión rural agroambiental (encuesta social a beneficiarios/técnicos en campo). Se te da el resultado de UNA pregunta/gráfica del informe, con sus conteos por categoría.

Escribe un análisis breve y profesional en español, de MÍNIMO 1 párrafo y MÁXIMO 3 párrafos cortos, resaltando los hallazgos más relevantes (categoría predominante, proporciones, algo llamativo si lo hay). No inventes datos que no estén en la entrada, no repitas la tabla de números tal cual, no uses markdown ni encabezados ni viñetas — solo texto plano en párrafos separados por un salto de línea en blanco.`;

// POST /api/ia/analizar-grafico — cualquier usuario autenticado.
// body: { titulo, tipo: 'pie'|'bar', seccion?, datos: [{etiqueta, valor}], totalRespuestas, unidad? }
router.post('/analizar-grafico', authenticateToken, async (req, res) => {
  const { titulo, tipo, seccion, datos, totalRespuestas, unidad } = req.body;

  if (!titulo || !Array.isArray(datos) || datos.length === 0) {
    return res.status(400).json({ success: false, error: 'Datos de la gráfica incompletos' });
  }

  const apiKey = await obtenerApiKey().catch(() => null);
  if (!apiKey) {
    return res.status(400).json({ success: false, error: 'IA no configurada' });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_DEEPSEEK_MS);

  try {
    const respuesta = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: PROMPT_SISTEMA },
          { role: 'user', content: construirPrompt({ titulo, tipo, seccion, datos, totalRespuestas, unidad }) },
        ],
        temperature: 0.5,
        max_tokens: 500,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!respuesta.ok) {
      const texto = await respuesta.text().catch(() => '');
      console.warn(`[IA] DeepSeek respondió ${respuesta.status}:`, texto.slice(0, 300));
      return res.status(502).json({ success: false, error: 'DeepSeek no respondió correctamente' });
    }

    const json = await respuesta.json();
    const analisis = json?.choices?.[0]?.message?.content?.trim();
    if (!analisis) {
      return res.status(502).json({ success: false, error: 'DeepSeek no devolvió texto' });
    }

    res.json({ success: true, analisis });
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`[IA] Timeout esperando a DeepSeek (gráfica: ${titulo})`);
      return res.status(504).json({ success: false, error: 'Tiempo de espera agotado' });
    }
    console.error('[IA] Error llamando a DeepSeek:', error.message);
    res.status(502).json({ success: false, error: 'Error llamando a DeepSeek' });
  } finally {
    clearTimeout(timeoutId);
  }
});

module.exports = router;
