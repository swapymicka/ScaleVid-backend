// Génère un fichier .srt pour un clip donné, à partir des segments de
// transcription de la vidéo source (timestamps absolus). Les timestamps sont
// recalés sur le début du clip (0 = début du clip) pour que ffmpeg les
// incruste au bon moment dans la vidéo découpée.

function pad(n, len) {
  return String(Math.trunc(n)).padStart(len, '0');
}

function formatTimestamp(t) {
  const totalMs = Math.max(0, Math.round(t * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

// Découpe un texte long en lignes courtes (max ~42 caractères), comme des
// sous-titres lisibles sur un écran de téléphone en format vertical.
function wrapText(text, maxLen = 42) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxLen && current) {
      lines.push(current.trim());
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines.join('\n');
}

// segments : [{ start, end, text }] avec timestamps absolus (par rapport à la vidéo source)
// Retourne le contenu d'un fichier .srt avec timestamps relatifs au clip [clipStart, clipEnd].
function buildSrtForClip(segments, clipStart, clipEnd) {
  let idx = 1;
  const blocks = [];

  for (const seg of segments) {
    if (seg.end <= clipStart || seg.start >= clipEnd) continue;
    const start = Math.max(seg.start, clipStart) - clipStart;
    const end = Math.min(seg.end, clipEnd) - clipStart;
    if (end <= start) continue;
    const text = wrapText(seg.text || '');
    if (!text) continue;

    blocks.push(`${idx}\n${formatTimestamp(start)} --> ${formatTimestamp(end)}\n${text}\n`);
    idx++;
  }

  return blocks.join('\n');
}

module.exports = { buildSrtForClip };
