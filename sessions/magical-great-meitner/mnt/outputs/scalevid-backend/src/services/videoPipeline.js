// Orchestration du pipeline complet pour une vidéo importée :
// transcription -> détection des meilleurs moments (Claude) -> découpage ffmpeg.
// Appelé soit directement (mode USE_QUEUE=false), soit depuis le worker BullMQ.

const path = require('path');
const fs = require('fs');
const prisma = require('../db');
const config = require('../config');
const transcriptionService = require('./transcriptionService');
const aiService = require('./aiService');
const ffmpegService = require('./ffmpegService');

async function processVideo(videoId, { numClips = 4, targetLenSec = 30 } = {}) {
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video) throw new Error('Vidéo introuvable : ' + videoId);

  try {
    await prisma.video.update({ where: { id: videoId }, data: { status: 'transcribing' } });
    const durationSec = await ffmpegService.getDurationSec(video.sourcePath);
    const { segments } = await transcriptionService.transcribe(video.sourcePath);

    await prisma.video.update({
      where: { id: videoId },
      data: { status: 'analyzing', durationSec },
    });
    const highlights = await aiService.detectHighlights({ segments, durationSec, numClips, targetLenSec });

    await prisma.video.update({ where: { id: videoId }, data: { status: 'cutting' } });

    const outDir = path.join(config.storageDir, 'clips', videoId);
    fs.mkdirSync(outDir, { recursive: true });

    for (const h of highlights) {
      const clip = await prisma.clip.create({
        data: {
          videoId,
          startSec: h.start,
          endSec: h.end,
          title: h.title,
          caption: h.caption,
          viralScore: h.viralScore,
          reasoning: h.reasoning,
          status: 'rendering',
        },
      });

      const outputPath = path.join(outDir, `${clip.id}.mp4`);
      await ffmpegService.cutAndReformat({
        sourcePath: video.sourcePath,
        outputPath,
        start: h.start,
        end: h.end,
      });

      await prisma.clip.update({ where: { id: clip.id }, data: { status: 'ready', outputPath } });
    }

    await prisma.video.update({ where: { id: videoId }, data: { status: 'done' } });
  } catch (e) {
    console.error('Pipeline error for video', videoId, e);
    await prisma.video.update({ where: { id: videoId }, data: { status: 'failed', error: String(e.message || e) } });
    throw e;
  }
}

module.exports = { processVideo };
