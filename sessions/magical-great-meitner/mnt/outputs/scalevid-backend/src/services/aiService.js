// Cœur du moteur "IA" de ScaleVid : à partir de la transcription horodatée
// d'une vidéo, on demande à Claude de repérer les N meilleurs passages pour
// en faire des shorts, avec un titre, des sous-titres reformulés et un score.

const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config');

const anthropic = config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

function buildPrompt({ segments, durationSec, numClips, targetLenSec }) {
  const transcriptBlock = segments
    .map((s) => `[${s.start.toFixed(1)}s -> ${s.end.toFixed(1)}s] ${s.text}`)
    .join('\n');

  return `Tu es un monteur vidéo expert en contenus courts viraux (TikTok/YouTube Shorts).
Voici la transcription horodatée d'une vidéo de ${durationSec.toFixed(0)} secondes :

---
${transcriptBlock}
---

Choisis les ${numClips} meilleurs passages à découper en clips courts (~${targetLenSec} secondes chacun),
en te basant sur : une accroche forte en début de passage, une idée autonome et compréhensible hors contexte,
une tension ou une émotion claire, et un potentiel de rétention élevé.

Réponds UNIQUEMENT avec un tableau JSON valide (pas de texte autour), au format exact :
[
  {
    "start": 12.4,
    "end": 41.8,
    "title": "Titre court et accrocheur (max 60 caractères)",
    "caption": "Légende prête à publier, avec 2-3 hashtags pertinents",
    "viralScore": 78,
    "reasoning": "Une phrase expliquant pourquoi ce passage fonctionne"
  }
]

Contraintes : "start" et "end" doivent être des timestamps réels présents dans la transcription ci-dessus,
"viralScore" est un entier de 0 à 100, et les clips ne doivent pas se chevaucher.`;
}

// Retourne un tableau de highlights : [{ start, end, title, caption, viralScore, reasoning }]
async function detectHighlights({ segments, durationSec, numClips = 4, targetLenSec = 30 }) {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY manquante : nécessaire pour la détection des meilleurs moments.');
  }

  const message = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: 2000,
    messages: [{ role: 'user', content: buildPrompt({ segments, durationSec, numClips, targetLenSec }) }],
  });

  const raw = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Réponse IA inattendue (pas de JSON trouvé) : ' + raw.slice(0, 200));

  const highlights = JSON.parse(jsonMatch[0]);

  // Garde-fous basiques : timestamps cohérents et dans la durée de la vidéo.
  return highlights
    .filter((h) => typeof h.start === 'number' && typeof h.end === 'number' && h.end > h.start)
    .map((h) => ({
      start: Math.max(0, h.start),
      end: Math.min(durationSec, h.end),
      title: String(h.title || 'Clip sans titre').slice(0, 80),
      caption: String(h.caption || ''),
      viralScore: Math.max(0, Math.min(100, Math.round(h.viralScore ?? 50))),
      reasoning: h.reasoning || '',
    }));
}

module.exports = { detectHighlights };
