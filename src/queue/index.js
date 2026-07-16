// File de jobs BullMQ (Redis) pour traiter les vidéos en arrière-plan, sans
// bloquer la requête HTTP d'upload. Si USE_QUEUE=false (pratique en local sans
// Redis), enqueueVideoProcessing() exécute le pipeline directement à la place.

const config = require('../config');
const { processVideo } = require('../services/videoPipeline');

let queue = null;
let worker = null;

function getQueue() {
  if (!config.useQueue) return null;
  if (queue) return queue;
  const { Queue } = require('bullmq');
  queue = new Queue('video-processing', { connection: { url: config.redisUrl } });
  return queue;
}

async function enqueueVideoProcessing(videoId, options = {}) {
  if (!config.useQueue) {
    // Mode simple : on traite immédiatement (bloque la requête courante).
    return processVideo(videoId, options);
  }
  const q = getQueue();
  return q.add('process-video', { videoId, options }, { attempts: 2, removeOnComplete: true, removeOnFail: false });
}

// À lancer dans un process séparé (`npm run worker`) quand USE_QUEUE=true.
function startWorker() {
  if (!config.useQueue) {
    console.log('USE_QUEUE=false : pas de worker à démarrer, le traitement se fait en ligne.');
    return;
  }
  const { Worker } = require('bullmq');
  worker = new Worker(
    'video-processing',
    async (job) => {
      const { videoId, options } = job.data;
      await processVideo(videoId, options);
    },
    { connection: { url: config.redisUrl } }
  );
  worker.on('completed', (job) => console.log(`Job ${job.id} terminé.`));
  worker.on('failed', (job, err) => console.error(`Job ${job?.id} échoué :`, err));
  console.log('Worker BullMQ démarré, en écoute sur la file "video-processing".');
}

module.exports = { enqueueVideoProcessing, startWorker };
