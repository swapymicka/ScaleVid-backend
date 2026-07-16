// Découpage vidéo réel côté serveur avec ffmpeg.
// Nécessite que le binaire "ffmpeg" soit installé sur la machine/le conteneur
// qui exécute ce code (apt-get install ffmpeg, ou une image Docker qui l'inclut).

const ffmpeg = require('fluent-ffmpeg');

function getDurationSec(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format.duration);
    });
  });
}

// Échappe un chemin de fichier pour l'utiliser à l'intérieur du filtre
// ffmpeg "subtitles=...", qui a sa propre syntaxe d'échappement (héritée de
// libass) : les ':' et "'" doivent être protégés, et les '\' remplacés.
function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// Découpe [start, end] depuis sourcePath, reformate en 9:16 (1080x1920, recadrage
// centré), incruste les sous-titres fournis (si subtitlesPath est défini) et
// écrit le résultat dans outputPath.
function cutAndReformat({ sourcePath, outputPath, start, end, subtitlesPath }) {
  return new Promise((resolve, reject) => {
    const filters = [
      // Recadrage centré en 9:16 puis mise à l'échelle 1080x1920.
      'crop=ih*9/16:ih',
      'scale=1080:1920',
    ];

    if (subtitlesPath) {
      // Style pensé pour un short vertical : texte large, centré, contour noir
      // épais pour rester lisible sur n'importe quel fond, calé vers le bas.
      const style =
        'FontName=Arial,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,' +
        'BorderStyle=3,Outline=2,Shadow=0,Alignment=2,MarginV=140,Bold=1';
      filters.push(`subtitles='${escapeFilterPath(subtitlesPath)}':force_style='${style}'`);
    }

    ffmpeg(sourcePath)
      .setStartTime(start)
      .setDuration(Math.max(1, end - start))
      .videoFilters(filters)
      .outputOptions(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-movflags', '+faststart'])
      .on('error', reject)
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

module.exports = { getDurationSec, cutAndReformat };
