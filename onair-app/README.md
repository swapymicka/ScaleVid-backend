# Onair — démo fonctionnelle (frontend + backend)

Ce dossier contient la landing page Onair branchée sur un vrai petit backend Node.js (sans
dépendance npm — uniquement les modules natifs `http`, `crypto` et `node:sqlite`), pour que
chaque fonctionnalité du site réponde réellement.

## Ce qui est réel

- **Inscription / connexion** : comptes stockés dans une base SQLite, mots de passe hachés
  (PBKDF2 + sel), session signée (HMAC) stockée dans un cookie `httpOnly`.
- **Tarification** : calcul des prix par paliers, bascule mensuel/annuel, stepper de comptes —
  tout est recalculé côté client puis revalidé côté serveur lors du paiement.
- **Tableau de bord** : données réellement lues/écrites en base (comptes connectés, clips,
  abonnement).

## Ce qui est simulé (mock) — et pourquoi

Connecter un vrai compte YouTube/TikTok demande des identifiants d'application développeur
(OAuth client ID/secret) auprès de Google et TikTok, et un vrai paiement Stripe demande une
clé API Stripe. Je n'ai pas accès à ces identifiants ici, donc :

- **Connexion YouTube / TikTok** (`/api/connect/youtube`, `/api/connect/tiktok`) : simule une
  poignée de main OAuth (délai réseau) puis crée un compte fictif (pseudo, abonnés aléatoires).
- **Paiement** (`/api/checkout`) : simule une session Stripe Checkout en mode test — aucune
  carte n'est jamais débitée — et enregistre l'abonnement choisi.
- **Détection IA des clips** (`/api/clips`) : génère des clips fictifs avec un score viral
  aléatoire, pour illustrer le pipeline de découpe automatique.

Chaque réponse simulée contient un champ `"note"` qui l'indique explicitement.

Pour passer en production réelle, il suffirait de remplacer ces trois mocks par :
Google OAuth + YouTube Data API, TikTok for Developers OAuth, Stripe Checkout (clé secrète
+ webhook), et un vrai modèle de détection de moments forts (ex: analyse audio/visuelle).

## Lancer le projet

Nécessite Node.js ≥ 22.5 (pour `node:sqlite`).

```bash
cd onair-app
npm start
# ou : node server.js
```

Puis ouvrez http://localhost:3000 dans votre navigateur.

La base de données est créée automatiquement dans un dossier de données local au démarrage
(par défaut le répertoire temporaire du système ; personnalisable via la variable d'env
`DB_DIR`).

## Structure

```
onair-app/
├── server.js     # serveur HTTP + toutes les routes API
├── db.js         # schéma SQLite (users, accounts, subscriptions, clips)
├── package.json
└── public/
    ├── index.html      # landing page (modale connexion/inscription + checkout branchés)
    └── dashboard.html   # tableau de bord (comptes, clips, abonnement)
```
