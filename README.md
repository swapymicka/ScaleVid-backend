# ScaleVid backend

Squelette de vrai backend pour ScaleVid : OAuth2 YouTube/TikTok, pipeline IA
(transcription + Claude pour repérer les meilleurs moments) et découpage
vidéo réel via ffmpeg. Ce projet est séparé du fichier `onair-standalone.html`
(la démo 100% navigateur) — il faudra à terme remplacer les appels simulés du
front par de vrais appels à cette API.

## 1. Installer

```bash
cd scalevid-backend
npm install
cp .env.example .env
```

Il faut aussi **ffmpeg installé sur la machine**, avec le support **libass** (nécessaire
pour incruster les sous-titres dans les clips — c'est inclus par défaut dans les builds
ci-dessous, pas besoin d'option spéciale) :
- macOS : `brew install ffmpeg`
- Ubuntu/Debian : `sudo apt-get install ffmpeg`
- Windows : https://ffmpeg.org/download.html

Vérifie que libass est bien présent : `ffmpeg -filters | grep subtitles` doit afficher une ligne.

## 2. Configurer Google / YouTube

1. https://console.cloud.google.com/ → créer un projet.
2. Menu "API & services" → activer **YouTube Data API v3**.
3. "Écran de consentement OAuth" → renseigner le nom de l'app, démarrer en mode **Test**
   (tu peux ajouter ton propre compte Google comme "testeur" pour développer sans
   attendre la validation Google).
4. "Identifiants" → créer un identifiant OAuth 2.0 de type **Application Web**.
   - URI de redirection autorisée : `http://localhost:4000/auth/youtube/callback`
5. Copier le Client ID / Client Secret dans `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

⚠️ Pour publier en mode "public" (n'importe qui peut connecter sa chaîne), Google exige
une **vérification OAuth** (audit de sécurité) une fois le scope `youtube.upload` utilisé
en production. En mode "Test", seuls les comptes que tu ajoutes explicitement peuvent
se connecter — largement suffisant pour développer et tester.

## 3. Configurer TikTok

1. https://developers.tiktok.com/ → créer une app.
2. Demander l'accès aux produits **Login Kit** et **Content Posting API**.
3. URI de redirection : `http://localhost:4000/auth/tiktok/callback`.
4. Copier Client Key / Client Secret dans `.env`.

⚠️ Le mode "Direct Post" (publication directe sur de vrais comptes utilisateurs) demande
une **revue de l'app par TikTok** avant la mise en production — ça peut prendre plusieurs
jours/semaines. En attendant la validation, le code utilise `privacy_level: "SELF_ONLY"`
(brouillon visible seulement par le compte connecté) pour pouvoir tester quand même.

## 4. Configurer l'IA

- **Anthropic** (sélection des meilleurs moments, titres, sous-titres) :
  clé sur https://console.anthropic.com/ → `ANTHROPIC_API_KEY` dans `.env`.
- **OpenAI Whisper** (transcription audio, étape préalable nécessaire avant Claude) :
  clé sur https://platform.openai.com/ → `OPENAI_API_KEY` dans `.env`.
  Tu peux remplacer ce fournisseur par un autre (AssemblyAI, Deepgram, whisper.cpp
  en local) en éditant `src/services/transcriptionService.js` uniquement —
  le reste du pipeline n'a pas besoin de changer.

Pipeline complet une fois les deux clés renseignées (`src/services/videoPipeline.js`) :
1. **Transcription** (`transcriptionService.js`, Whisper) → texte horodaté de toute la vidéo.
2. **Détection des meilleurs moments** (`aiService.js`, Claude) → 3 à 6 passages avec titre,
   légende et score viral.
3. **Sous-titres** (`subtitleService.js`) → génère un `.srt` par clip à partir des segments
   de transcription qui tombent dans sa fenêtre de temps, recalés sur le début du clip.
4. **Découpage + incrustation** (`ffmpegService.js`) → recadrage 9:16, puis incrustation
   du `.srt` directement dans la vidéo (texte blanc, contour noir, bas de l'écran).

Tout se fait automatiquement à l'upload (`POST /videos`) : pas d'action manuelle entre
la transcription et le clip final sous-titré.

## 5. Base de données

SQLite par défaut, zéro configuration :

```bash
npm run prisma:migrate
```

Pour passer en production sur Postgres, remplace `DATABASE_URL` dans `.env` par une
URL Postgres et `provider = "sqlite"` par `provider = "postgresql"` dans
`prisma/schema.prisma`, puis relance `npm run prisma:migrate`.

## 6. Lancer le serveur

```bash
npm run dev
```

Le serveur écoute sur `http://localhost:4000`. Routes principales :

| Route | Méthode | Description |
|---|---|---|
| `/auth/signup`, `/auth/login` | POST | Création de compte / connexion (JWT) |
| `/auth/youtube`, `/auth/tiktok` | GET | Démarre le flux OAuth (redirige vers Google/TikTok) |
| `/auth/youtube/callback`, `/auth/tiktok/callback` | GET | Callback OAuth, enregistre le compte connecté |
| `/accounts` | GET | Liste des comptes connectés de l'utilisateur |
| `/videos` | POST (multipart, champ `video`) | Upload d'une vidéo source + lancement du pipeline IA |
| `/videos/:id` | GET | Statut + clips générés pour une vidéo |
| `/clips/:id/schedule` | POST `{ socialAccountId, scheduledAt }` | Programme la publication d'un clip |

## 7. Traitement vidéo : synchrone ou file de jobs ?

Par défaut `USE_QUEUE=false` : le pipeline (transcription → IA → découpage) tourne
directement dans la requête `POST /videos`, ce qui bloque la réponse jusqu'à la fin
(pratique pour tester, mauvais en production avec plusieurs utilisateurs simultanés).

Pour la production, passe à `USE_QUEUE=true`, lance un Redis (`docker run -p 6379:6379 redis`
ou un Redis managé type Upstash), puis démarre le worker dans un process séparé :

```bash
npm run worker
```

Le worker consomme aussi les publications programmées (`ScheduledPost`) toutes les 30s —
c'est l'équivalent réel du `setInterval` simulé qui existait côté navigateur dans la démo.

## 8. Ce qu'il reste à faire avant une vraie mise en production

- Chiffrement des tokens : déjà fait (AES-256-GCM, voir `tokenCrypto.js`), mais change
  `TOKEN_ENCRYPTION_KEY` pour une vraie valeur secrète et gère sa rotation.
- Rafraîchissement automatique des access tokens YouTube/TikTok expirés (actuellement,
  seul le refresh_token est stocké ; il faut l'utiliser pour regénérer un access_token
  quand il expire — `googleapis` le fait automatiquement si tu passes par `oauth2Client`,
  pour TikTok il faut appeler explicitement l'endpoint de refresh).
- Stockage des vidéos sur S3/Cloudflare R2 plutôt que sur disque local (`STORAGE_DIR`),
  pour pouvoir scaler horizontalement.
- Limites d'upload, scan antivirus/modération de contenu avant analyse.
- Vraie intégration de paiement (Stripe) branchée sur les webhooks d'abonnement.
- Tests automatisés, logs structurés, monitoring des erreurs (Sentry ou équivalent).
- Conformité RGPD côté backend : suppression de compte en cascade, export des données,
  journalisation des consentements (le front gère déjà la bannière cookies/CGV/mentions
  légales côté `onair-standalone.html`).
