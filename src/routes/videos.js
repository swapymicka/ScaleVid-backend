const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const prisma = require('../db');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { enqueueVideoProcessing } = require('../queue');
const tokenCrypto = require('../services/tokenCrypto');
const youtubeService = require('../services/youtubeService');
const tiktokService = require('../services/tiktokService');

const router = express.Router();

const uploadDir = path.join(config.storageDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 Go, à adapter
});

// Upload d'une vidéo source + lancement (sync ou async) du pipeline IA.
router.post('/videos', requireAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier vidéo manquant (champ "video").' });

    const numClips = parseInt(req.body.numClips, 10) || 4;
    const targetLenSec = parseInt(req.body.targetLenSec, 10) || 30;

    const video = await prisma.video.create({
      data: { userId: req.userId, sourcePath: req.file.path, status: 'uploaded' },
    });

    // Ne bloque pas la réponse HTTP : le statut est à interroger via GET /videos/:id.
    enqueueVideoProcessing(video.id, { numClips, targetLenSec }).catch((e) =>
      console.error('Erreur pipeline vidéo', video.id, e)
    );

    res.status(202).json({ videoId: video.id, status: video.status });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/videos/:id', requireAuth, async (req, res) => {
  const video = await prisma.video.findFirst({
    where: { id: req.params.id, userId: req.userId },
    include: { clips: true },
  });
  if (!video) return res.status(404).json({ error: 'Vidéo introuvable.' });
  res.json({ video });
});

router.get('/videos', requireAuth, async (req, res) => {
  const videos = await prisma.video.findMany({
    where: { userId: req.userId },
    include: { clips: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ videos });
});

// ── Upload direct d'un short + programmation en une seule requête ──
// Le frontend envoie le fichier vidéo (déjà prêt, découpé dans le navigateur)
// avec le compte cible et la date. Aucun pipeline IA côté serveur nécessaire.
router.post('/shorts/schedule', requireAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier vidéo manquant.' });
    const { socialAccountId, scheduledAt, title, hashtags } = req.body;
    if (!socialAccountId || !scheduledAt) {
      return res.status(400).json({ error: 'socialAccountId et scheduledAt sont requis.' });
    }

    const account = await prisma.socialAccount.findFirst({
      where: { id: socialAccountId, userId: req.userId },
    });
    if (!account) return res.status(404).json({ error: 'Compte introuvable.' });

    // Créer un enregistrement Clip directement (sans passer par le pipeline IA)
    const clip = await prisma.clip.create({
      data: {
        videoId: null,   // explicitement null pour les shorts directs
        outputPath: req.file.path,
        title: title || 'Short ScaleVid',
        caption: hashtags || '#Shorts',
        startSec: 0,
        endSec: 0,
        viralScore: 0,
        status: 'ready',
      },
    });

    const post = await prisma.scheduledPost.create({
      data: {
        clipId: clip.id,
        socialAccountId: account.id,
        scheduledAt: new Date(scheduledAt),
        status: 'scheduled',
      },
    });

    res.json({ ok: true, postId: post.id, scheduledAt: post.scheduledAt });
  } catch (e) {
    console.error('shorts/schedule error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Suppression d'un post programmé
router.delete('/shorts/schedule/:id', requireAuth, async (req, res) => {
  try {
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, status: 'scheduled' },
      include: { socialAccount: { select: { userId: true } } },
    });
    if (!post || post.socialAccount.userId !== req.userId) {
      return res.status(404).json({ error: 'Post introuvable ou déjà publié.' });
    }
    await prisma.scheduledPost.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    console.error('shorts/schedule DELETE error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Modification d'un post programmé (titre, hashtags, date)
router.patch('/shorts/schedule/:id', requireAuth, async (req, res) => {
  try {
    const { title, hashtags, scheduledAt } = req.body;
    const post = await prisma.scheduledPost.findFirst({
      where: { id: req.params.id, status: 'scheduled' },
      include: { socialAccount: { select: { userId: true } }, clip: true },
    });
    if (!post || post.socialAccount.userId !== req.userId) {
      return res.status(404).json({ error: 'Post introuvable ou déjà publié.' });
    }
    // Mettre à jour le clip (titre + hashtags)
    await prisma.clip.update({
      where: { id: post.clipId },
      data: {
        ...(title    ? { title }           : {}),
        ...(hashtags ? { caption: hashtags } : {}),
      },
    });
    // Mettre à jour la date
    if (scheduledAt) {
      await prisma.scheduledPost.update({
        where: { id: req.params.id },
        data: { scheduledAt: new Date(scheduledAt) },
      });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('shorts/schedule PATCH error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Programme la publication d'un clip prêt sur un compte connecté.
router.post('/clips/:id/schedule', requireAuth, async (req, res) => {
  const { socialAccountId, scheduledAt } = req.body;
  const clip = await prisma.clip.findFirst({
    where: { id: req.params.id, status: 'ready', video: { userId: req.userId } },
  });
  if (!clip) return res.status(404).json({ error: 'Clip introuvable ou pas encore prêt.' });

  const account = await prisma.socialAccount.findFirst({ where: { id: socialAccountId, userId: req.userId } });
  if (!account) return res.status(404).json({ error: 'Compte connecté introuvable.' });

  const post = await prisma.scheduledPost.create({
    data: { clipId: clip.id, socialAccountId: account.id, scheduledAt: new Date(scheduledAt) },
  });
  res.json({ post });
});

// Publication immédiate / déclenchée par le cron de planification (voir worker.js)
// pour un post programmé dont l'heure est atteinte.
async function publishScheduledPost(postId) {
  const post = await prisma.scheduledPost.findUnique({
    where: { id: postId },
    include: { clip: true, socialAccount: true },
  });
  if (!post || post.status !== 'scheduled') return;

  await prisma.scheduledPost.update({ where: { id: postId }, data: { status: 'publishing' } });

  try {
    const accessToken = tokenCrypto.decrypt(post.socialAccount.accessToken);
    const refreshToken = tokenCrypto.decrypt(post.socialAccount.refreshToken);
    let result;

    if (post.socialAccount.provider === 'youtube') {
      console.log('[Publish] Début upload YouTube, fichier:', post.clip.outputPath);
      result = await youtubeService.uploadVideo({
        accessToken,
        refreshToken,
        tokenExpiresAt: post.socialAccount.tokenExpiresAt,
        filePath: post.clip.outputPath,
        title: post.clip.title,
        description: post.clip.caption,
      });
      console.log('[Publish] Upload réussi, videoId YouTube:', result.platformPostId);
    } else if (post.socialAccount.provider === 'tiktok') {
      result = await tiktokService.uploadVideo({
        accessToken,
        filePath: post.clip.outputPath,
        title: post.clip.title,
      });
    } else {
      throw new Error('Plateforme inconnue : ' + post.socialAccount.provider);
    }

    await prisma.scheduledPost.update({
      where: { id: postId },
      data: { status: 'published', platformPostId: result.platformPostId },
    });
  } catch (e) {
    console.error('Échec publication', postId, e);
    await prisma.scheduledPost.update({
      where: { id: postId },
      data: { status: 'failed', error: String(e.message || e) },
    });
  }
}

module.exports = router;
module.exports.publishScheduledPost = publishScheduledPost;
