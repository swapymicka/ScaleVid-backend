const express = require('express');
const jwt = require('jsonwebtoken');
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
    if (error) return res.redirect(`${config.frontendUrl}/dashboard?connect=error`);

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

    res.redirect(`${config.frontendUrl}/dashboard?connect=youtube_ok`);
  } catch (e) {
    console.error('YouTube OAuth callback error:', e);
    res.redirect(`${config.frontendUrl}/dashboard?connect=error`);
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
    if (error) return res.redirect(`${config.frontendUrl}/dashboard?connect=error`);

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

    res.redirect(`${config.frontendUrl}/dashboard?connect=tiktok_ok`);
  } catch (e) {
    console.error('TikTok OAuth callback error:', e);
    res.redirect(`${config.frontendUrl}/dashboard?connect=error`);
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
  await prisma.socialAccount.deleteMany({ where: { id: req.params.id, userId: req.userId } });
  res.json({ ok: true });
});

module.exports = router;
