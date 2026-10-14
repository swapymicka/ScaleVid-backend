const axios = require('axios');
const fs = require('fs');
const config = require('../config');

const AUTH_BASE = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const USERINFO_URL = 'https://open.tiktokapis.com/v2/user/info/';
const POST_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
const POST_STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

const SCOPES = ['user.info.basic', 'video.publish', 'video.upload'];

// Étape 1 : URL d'autorisation TikTok (Login Kit).
function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    response_type: 'code',
    scope: SCOPES.join(','),
    redirect_uri: config.tiktok.redirectUri,
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

// Étape 2 : échange le code contre un access_token + refresh_token.
async function exchangeCodeForTokens(code) {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.tiktok.redirectUri,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  // res.data = { access_token, refresh_token, expires_in, open_id, scope, ... }
  return res.data;
}

async function getUserInfo(accessToken) {
  const res = await axios.get(USERINFO_URL, {
    params: { fields: 'open_id,display_name' },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = res.data?.data?.user;
  if (!data) throw new Error("Impossible de récupérer le profil TikTok.");
  return { externalId: data.open_id, handle: data.display_name };
}

// Upload réel d'une vidéo via la Content Posting API (Direct Post).
// IMPORTANT : TikTok exige que ton app passe par une revue ("App Review")
// avant d'autoriser le mode "Direct Post" sur de vrais comptes utilisateurs.
// Tant que l'app n'est pas validée, seul le mode "draft" (l'utilisateur doit
// finaliser la publication dans l'app TikTok) est disponible.
async function uploadVideo({ accessToken, filePath, title }) {
  const stat = fs.statSync(filePath);

  // 1) Initialiser l'upload : on déclare la taille du fichier, TikTok renvoie
  //    une URL d'upload + un publish_id.
  const initRes = await axios.post(
    POST_INIT_URL,
    {
      post_info: {
        title,
        privacy_level: 'SELF_ONLY', // passe à "PUBLIC_TO_EVERYONE" une fois l'app validée
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: stat.size,
        chunk_size: stat.size,
        total_chunk_count: 1,
      },
    },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );

  const { publish_id, upload_url } = initRes.data.data;

  // 2) Envoyer les octets de la vidéo vers l'URL d'upload fournie.
  await axios.put(upload_url, fs.createReadStream(filePath), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Range': `bytes 0-${stat.size - 1}/${stat.size}`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return { platformPostId: publish_id };
}

async function getPublishStatus(accessToken, publishId) {
  const res = await axios.post(
    POST_STATUS_URL,
    { publish_id: publishId },
    { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
  );
  return res.data.data; // { status: "PROCESSING_DOWNLOAD" | "PUBLISH_COMPLETE" | "FAILED", ... }
}

module.exports = { getAuthUrl, exchangeCodeForTokens, getUserInfo, uploadVideo, getPublishStatus };
