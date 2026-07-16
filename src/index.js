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

app.get('/legal/terms', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Conditions d'utilisation — ScaleVid</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#222}h1{color:#f97316}</style></head><body><h1>Conditions d'utilisation</h1><p>Dernière mise à jour : juillet 2026</p><p>En utilisant ScaleVid, vous acceptez les présentes conditions. ScaleVid est un service d'automatisation de publication de vidéos courtes sur YouTube et TikTok.</p><h2>Utilisation du service</h2><p>Vous devez avoir au moins 18 ans pour utiliser ScaleVid. Vous êtes responsable du contenu que vous publiez via notre plateforme.</p><h2>Propriété intellectuelle</h2><p>Vous conservez tous les droits sur vos vidéos. ScaleVid ne revendique aucun droit sur votre contenu.</p><h2>Contact</h2><p>scalevid.app@gmail.com</p></body></html>`);
});

app.get('/legal/privacy', (_req, res) => {
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Politique de confidentialité — ScaleVid</title><style>body{font-family:sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#222}h1{color:#f97316}</style></head><body><h1>Politique de confidentialité</h1><p>Dernière mise à jour : juillet 2026</p><p>ScaleVid collecte uniquement les informations nécessaires au fonctionnement du service : votre adresse e-mail, et les tokens d'accès OAuth à vos comptes YouTube et TikTok.</p><h2>Données collectées</h2><p>Adresse e-mail, tokens OAuth YouTube/TikTok, métadonnées de vos vidéos.</p><h2>Utilisation des données</h2><p>Vos données sont utilisées exclusivement pour publier vos vidéos selon votre planning. Elles ne sont jamais vendues à des tiers.</p><h2>Suppression des données</h2><p>Vous pouvez demander la suppression de votre compte et de toutes vos données à tout moment en contactant scalevid.app@gmail.com.</p><h2>Contact</h2><p>scalevid.app@gmail.com</p></body></html>`);
});

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
