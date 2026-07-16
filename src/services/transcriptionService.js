// Transcription audio -> texte horodaté.
// Claude n'écoute pas l'audio directement : il faut d'abord transcrire la vidéo,
// puis envoyer ce texte (avec les timestamps) à Claude pour qu'il repère les
// meilleurs moments. Ce module utilise l'API Whisper d'OpenAI par défaut.
//
// Pour t'en passer, deux alternatives :
//  - whisper.cpp ou faster-whisper en local (gratuit, mais demande du calcul) ;
//  - un service comme AssemblyAI ou Deepgram (API similaire à remplacer ici).

const fs = require('fs');
const OpenAI = require('openai');
const config = require('../config');

const openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;

// Retourne { text, segments: [{ start, end, text }] }
async function transcribe(filePath) {
  if (!openai) {
    throw new Error(
      'OPENAI_API_KEY manquante : nécessaire pour la transcription (voir transcriptionService.js pour la remplacer par un autre fournisseur).'
    );
  }

  const response = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
    response_format: 'verbose_json', // renvoie les segments avec timestamps
    timestamp_granularities: ['segment'],
  });

  return {
    text: response.text,
    segments: (response.segments || []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    })),
  };
}

module.exports = { transcribe };
