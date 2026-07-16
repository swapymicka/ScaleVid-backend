const { google } = require('googleapis');
const fs = require('fs');
const config = require('../config');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

function getOAuthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

// Étape 1 : construit l'URL vers laquelle rediriger l'utilisateur pour qu'il
// autorise ScaleVid à accéder à sa chaîne YouTube.
function getAuthUrl(state) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline', // nécessaire pour obtenir un refresh_token
    prompt: 'consent',      // force le renvoi du refresh_token même si déjà autorisé avant
    scope: SCOPES,
    state,
  });
}

// Étape 2 : échange le "code" renvoyé par Google contre des tokens d'accès.
async function exchangeCodeForTokens(code) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  // tokens = { access_token, refresh_token, expiry_date, scope, token_type }
  return tokens;
}

// Récupère les infos de la chaîne YouTube associée aux tokens (pour afficher
// le nom/handle du compte connecté dans le tableau de bord).
async function getChannelInfo(accessToken, refreshToken) {
  const client = getOAuthClient();
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const youtube = google.youtube({ version: 'v3', auth: client });
  const res = await youtube.channels.list({ part: ['snippet'], mine: true });
  const channel = res.data.items?.[0];
  if (!channel) throw new Error('Aucune chaîne YouTube trouvée pour ce compte Google.');
  return { externalId: channel.id, handle: channel.snippet.title };
}

// Upload réel d'un clip sur YouTube (en "Shorts" si la vidéo fait moins de 60s
// et qu'on respecte le format vertical — YouTube détecte ça automatiquement
// dès que #Shorts est dans le titre/description et que la vidéo est verticale).
async function uploadVideo({ accessToken, refreshToken, tokenExpiresAt, filePath, title, description }) {
  const client = getOAuthClient();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: tokenExpiresAt ? new Date(tokenExpiresAt).getTime() : 0,
  });
  // Force le renouvellement du token si expiré (utilise le refresh_token automatiquement)
  await client.getAccessToken();
  const youtube = google.youtube({ version: 'v3', auth: client });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description: `${description}\n\n#Shorts`,
      },
      status: {
        privacyStatus: 'public', // ou "private" / "unlisted" selon les besoins
      },
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  });

  return { platformPostId: res.data.id };
}

module.exports = { getAuthUrl, exchangeCodeForTokens, getChannelInfo, uploadVideo };
