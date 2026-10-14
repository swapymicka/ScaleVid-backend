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

// Découpe [start, end] depuis sourcePath, reformate en 9:16 (1080x1920, recadrage
// centré) et écrit le résultat dans outputPath.
function cutAndReformat({ sourcePath, outputPath, start, end }) {
  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .setStartTime(start)
      .setDuration(Math.max(1, end - start))
      .videoFilters([
        // Recadrage centré en 9:16 puis mise à l'échelle 1080x1920.
        'crop=ih*9/16:ih',
        'scale=1080:1920',
      ])
      .outputOptions(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-movflags', '+faststart'])
      .on('error', reject)
      .on('end', () => resolve(outputPath))
      .save(outputPath);
  });
}

module.exports = { getDurationSec, cutAndReformat };
