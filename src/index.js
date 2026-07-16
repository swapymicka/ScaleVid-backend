const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');

const authRoutes = require('./routes/auth');
const socialRoutes = require('./routes/social');
const videoRoutes = require('./routes/videos');
const aiRoutes = require('./routes/ai');
const { startScheduledPostChecker } = require('./services/scheduler');

const app = express();

app.use(cors({ origin: config.frontendUrl, credentials: true }));
app.use(cookieParser());
app.use(express.json());

// Page de test minimale (public/test.html) pour vérifier le flux OAuth dans
// un vrai navigateur sans avoir encore branché le front complet. À retirer
// une fois le vrai frontend connecté à cette API.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/', socialRoutes); // expose /auth/youtube, /auth/tiktok, /accounts
app.use('/', videoRoutes); // expose /videos, /clips/:id/schedule
app.use('/', aiRoutes);    // expose /ai/suggest-title

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur inattendue.' });
});

app.listen(config.port, () => {
  console.log(`ScaleVid backend en écoute sur http://localhost:${config.port}`);
  if (!config.useQueue) {
    console.log('Mode synchrone (USE_QUEUE=false) : le traitement vidéo se fait dans la requête HTTP.');
    // En mode simple, pas de process worker séparé : on démarre ici la
    // vérification des publications programmées, pour que l'auto-publication
    // sur YouTube/TikTok fonctionne avec un simple `npm run dev`.
    startScheduledPostChecker();
  } else {
    console.log('Mode file de jobs (USE_QUEUE=true) : lance `npm run worker` dans un autre process.');
  }
});
