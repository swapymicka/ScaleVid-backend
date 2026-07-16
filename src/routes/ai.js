const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');

const router = express.Router();

// POST /ai/suggest-title
// Reçoit des frames base64 + métadonnées, retourne titre + hashtags générés par Claude Vision.
// Si ANTHROPIC_API_KEY n'est pas configuré, retourne { error: 'no_api_key' }.
router.post('/ai/suggest-title', requireAuth, async (req, res) => {
  const { frames, duration, score, fileName } = req.body;

  if (!config.anthropic?.apiKey) {
    return res.json({ error: 'no_api_key' });
  }
  if (!frames || !Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: 'Aucune frame fournie.' });
  }

  try {
    const client = new Anthropic.default({ apiKey: config.anthropic.apiKey });

    const imageContent = frames.slice(0, 4).map(frame => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame },
    }));

    const prompt = `Tu es un expert en création de contenu viral pour YouTube Shorts et TikTok.
Voici ${frames.length} captures d'écran prises à intervalles réguliers d'une vidéo courte.
Durée : ${Math.round(duration)}s | Score viral détecté : ${score}/100${fileName ? ` | Nom du fichier : ${fileName}` : ''}

En te basant UNIQUEMENT sur ce que tu vois visuellement dans ces images :
1. Identifie le sujet principal / le contenu de la vidéo
2. Génère un titre YouTube/TikTok accrocheur en français (max 60 caractères, avec emoji approprié)
3. Génère des hashtags pertinents (8 à 12 tags, mix français/anglais, commençant par #Shorts)

Réponds UNIQUEMENT avec ce JSON (sans markdown, sans explication) :
{"title":"...","hashtags":"..."}`;

    const message = await client.messages.create({
      model: config.anthropic.model || 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: prompt }, ...imageContent],
      }],
    });

    const raw = message.content[0]?.text?.trim() || '{}';
    // Extrait le JSON même si Claude a ajouté du texte autour
    const match = raw.match(/\{[\s\S]*\}/);
    const json = match ? JSON.parse(match[0]) : {};

    res.json({
      title: json.title || null,
      hashtags: json.hashtags || null,
    });
  } catch (e) {
    console.error('[AI] suggest-title error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
