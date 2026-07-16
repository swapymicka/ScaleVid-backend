// Vérifie périodiquement les publications programmées (ScheduledPost) dont
// l'heure est atteinte, et déclenche leur publication réelle sur YouTube/TikTok.
//
// Démarré automatiquement par src/index.js en mode simple (USE_QUEUE=false,
// le défaut) — donc un simple `npm run dev` suffit pour que l'auto-publication
// fonctionne. En mode file de jobs (USE_QUEUE=true), c'est le worker séparé
// (`npm run worker`) qui s'en charge à la place, pour ne pas vérifier deux fois.

const prisma = require('../db');

let started = false;

function startScheduledPostChecker({ intervalMs = 30 * 1000 } = {}) {
  if (started) return; // évite de démarrer deux fois la même boucle dans un process
  started = true;

  // Import tardif pour éviter une dépendance circulaire (videos.js a aussi
  // besoin d'autres services chargés au démarrage).
  const { publishScheduledPost } = require('../routes/videos');

  async function tick() {
    const due = await prisma.scheduledPost.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
    });
    if (due.length > 0) {
      console.log(`[Scheduler] ${due.length} post(s) à publier...`);
    }
    for (const post of due) {
      console.log(`[Scheduler] Publication post ${post.id} (scheduledAt: ${post.scheduledAt})`);
      await publishScheduledPost(post.id);
      console.log(`[Scheduler] Post ${post.id} traité.`);
    }
  }

  setInterval(() => {
    tick().catch((e) => console.error('Erreur checkScheduledPosts', e));
  }, intervalMs);

  console.log(`Vérification des publications programmées toutes les ${intervalMs / 1000}s.`);
}

module.exports = { startScheduledPostChecker };
