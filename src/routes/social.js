const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { google } = require('googleapis');
const prisma = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const tokenCrypto = require('../services/tokenCrypto');
const youtubeService = require('../services/youtubeService');
const tiktokService = require('../services/tiktokService');

const router = express.Router();

// On encode l'utilisateur courant dans le paramètre "state" de l'OAuth (signé,
// pas juste en clair) pour retrouver à qui appartient le callback, sans avoir
// besoin d'une session serveur classique.
function buildState(userId) {
  return jwt.sign({ uid: userId }, config.jwtSecret, { expiresIn: '15m' });
}
function readState(state) {
  const { uid } = jwt.verify(state, config.jwtSecret);
  return uid;
}

/* ---------------------- RECHERCHE DE CHAÎNES (publique) ---------------------- */

// Recherche une chaîne YouTube par nom ou @handle.
// Pas d'authentification requise : données publiques.
// CORS ouvert pour permettre l'appel depuis n'importe quel front (y compris GitHub Pages).
router.get('/search/youtube', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ channels: [] });

  // — Avec YOUTUBE_API_KEY : vraie recherche par nom —
  if (config.google.apiKey) {
    try {
      const yt = google.youtube({ version: 'v3', auth: config.google.apiKey });
      const r = await yt.search.list({ part: ['snippet'], q, type: ['channel'], maxResults: 5 });
      const channels = (r.data.items || []).map(item => ({
        id: item.snippet.channelId,
        name: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.default?.url || null,
      }));
      return res.json({ channels });
    } catch (e) {
      console.error('YouTube search error:', e.message);
      return res.json({ channels: [], error: 'Erreur YouTube API.' });
    }
  }

  // — Sans YOUTUBE_API_KEY : lookup par @handle via oEmbed (aucune clé requise) —
  const handle = q.startsWith('@') ? q : '@' + q.replace(/\s+/g, '');
  try {
    const oembedUrl = 'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent('https://www.youtube.com/' + handle);
    const r = await axios.get(oembedUrl, { timeout: 6000 });
    return res.json({
      channels: [{ id: null, name: r.data.author_name, thumbnail: r.data.thumbnail_url || null, handle }],
      hint: 'no_api_key', // indique au front qu'on est en mode @handle uniquement
    });
  } catch {
    return res.json({ channels: [], hint: 'no_api_key' });
  }
});

/* ------------------------------- YOUTUBE ------------------------------- */

// Démarre le flux : le front redirige le navigateur vers cette route,
// qui redirige elle-même vers Google.
router.get('/auth/youtube', requireAuth, (req, res) => {
  const url = youtubeService.getAuthUrl(buildState(req.userId));
  res.redirect(url);
});

// Callback appelé par Google après que l'utilisateur a autorisé l'accès.
router.get('/auth/youtube/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${config.frontendUrl}/onair-standalone.html?connect=error`);

    const userId = readState(state);
    const tokens = await youtubeService.exchangeCodeForTokens(code);
    const channel = await youtubeService.getChannelInfo(tokens.access_token, tokens.refresh_token);

    await prisma.socialAccount.upsert({
      where: { provider_externalId: { provider: 'youtube', externalId: channel.externalId } },
      update: {
        userId,
        handle: channel.handle,
        accessToken: tokenCrypto.encrypt(tokens.access_token),
        refreshToken: tokenCrypto.encrypt(tokens.refresh_token),
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
      create: {
        userId,
        provider: 'youtube',
        externalId: channel.externalId,
        handle: channel.handle,
        accessToken: tokenCrypto.encrypt(tokens.access_token),
        refreshToken: tokenCrypto.encrypt(tokens.refresh_token),
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });

    res.redirect(`${config.frontendUrl}/onair-standalone.html?connect=youtube_ok`);
  } catch (e) {
    console.error('YouTube OAuth callback error:', e);
    res.redirect(`${config.frontendUrl}/onair-standalone.html?connect=error`);
  }
});

/* -------------------------------- TIKTOK -------------------------------- */

router.get('/auth/tiktok', requireAuth, (req, res) => {
  const url = tiktokService.getAuthUrl(buildState(req.userId));
  res.redirect(url);
});

router.get('/auth/tiktok/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${config.frontendUrl}/onair-standalone.html?connect=error`);

    const userId = readState(state);
    const tokens = await tiktokService.exchangeCodeForTokens(code);
    const profile = await tiktokService.getUserInfo(tokens.access_token);

    await prisma.socialAccount.upsert({
      where: { provider_externalId: { provider: 'tiktok', externalId: profile.externalId } },
      update: {
        userId,
        handle: profile.handle,
        accessToken: tokenCrypto.encrypt(tokens.access_token),
        refreshToken: tokenCrypto.encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
      create: {
        userId,
        provider: 'tiktok',
        externalId: profile.externalId,
        handle: profile.handle,
        accessToken: tokenCrypto.encrypt(tokens.access_token),
        refreshToken: tokenCrypto.encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });

    res.redirect(`${config.frontendUrl}/onair-standalone.html?connect=tiktok_ok`);
  } catch (e) {
    console.error('TikTok OAuth callback error:', e);
    res.redirect(`${config.frontendUrl}/onair-standalone.html?connect=error`);
  }
});

/* ------------------------------- COMMUN ------------------------------- */

router.get('/accounts', requireAuth, async (req, res) => {
  const accounts = await prisma.socialAccount.findMany({
    where: { userId: req.userId },
    select: { id: true, provider: true, handle: true, createdAt: true },
  });
  res.json({ accounts });
});

router.delete('/accounts/:id', requireAuth, async (req, res) => {
  try {
    // Supprimer d'abord les posts programmés liés (contrainte FK)
    await prisma.scheduledPost.deleteMany({ where: { socialAccountId: req.params.id } });
    await prisma.socialAccount.deleteMany({ where: { id: req.params.id, userId: req.userId } });
    res.json({ ok: true });
  } catch (e) {
    console.error('Erreur suppression compte:', e);
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

module.exports = router;
