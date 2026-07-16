// Process séparé à lancer avec `npm run worker` :
//  - consomme la file BullMQ pour le traitement vidéo (si USE_QUEUE=true) ;
//  - déclenche les publications programmées dont l'heure est atteinte
//    (remplace le `setInterval` simulé qui existait côté navigateur dans
//    la démo : ici c'est un vrai cron côté serveur).

const config = require('./config');
const { startWorker } = require('./queue');
const { startScheduledPostChecker } = require('./services/scheduler');

startWorker();
startScheduledPostChecker();

console.log(`Worker ScaleVid démarré (USE_QUEUE=${config.useQueue}).`);
