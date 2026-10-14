// Process séparé à lancer avec `npm run worker` :
//  - consomme la file BullMQ pour le traitement vidéo (si USE_QUEUE=true) ;
//  - déclenche les publications programmées dont l'heure est atteinte
//    (remplace le `setInterval` simulé qui existait côté navigateur dans
//    la démo : ici c'est un vrai cron côté serveur).

const config = require('./config');
const prisma = require('./db');
const { startWorker } = require('./queue');
const { publishScheduledPost } = require('./routes/videos');

startWorker();

async function checkScheduledPosts() {
  const due = await prisma.scheduledPost.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
  });
  for (const post of due) {
    await publishScheduledPost(post.id);
  }
}

setInterval(() => {
  checkScheduledPosts().catch((e) => console.error('Erreur checkScheduledPosts', e));
}, 30 * 1000);

console.log(
  `Worker ScaleVid démarré (USE_QUEUE=${config.useQueue}). Vérification des publications programmées toutes les 30s.`
);
