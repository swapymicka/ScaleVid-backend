/**
 * Routes /reports — statistiques de performance et exports.
 * Tableau de bord multi-comptes + export CSV/PDF.
 * Rapport marque blanche réservé au plan agence.
 */
const express = require('express');
const prisma = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function requirePlan(...plans) {
  return async (req, res, next) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user || !plans.includes(user.plan)) {
      return res.status(403).json({ error: 'Cette fonctionnalité nécessite un plan supérieur.' });
    }
    req.currentUser = user;
    next();
  };
}

async function buildStats(userId) {
  const accounts = await prisma.socialAccount.findMany({
    where: { userId },
    select: { id: true, provider: true, handle: true, createdAt: true },
  });

  const result = [];
  for (const acc of accounts) {
    const posts = await prisma.scheduledPost.findMany({
      where: { socialAccountId: acc.id },
      select: { status: true, scheduledAt: true, createdAt: true },
    });
    const published = posts.filter(p => p.status === 'published').length;
    const failed    = posts.filter(p => p.status === 'failed').length;
    const scheduled = posts.filter(p => p.status === 'scheduled').length;
    const total     = posts.length;
    result.push({
      accountId: acc.id,
      provider:  acc.provider,
      handle:    acc.handle,
      connectedAt: acc.createdAt,
      stats: { total, published, failed, scheduled, successRate: total ? Math.round(published / total * 100) : 0 },
    });
  }
  return result;
}

// ── GET /reports/performance ─────────────────────────────────────────────────

router.get('/performance', requireAuth, async (req, res) => {
  try {
    const stats = await buildStats(req.userId);
    const totals = stats.reduce(
      (acc, a) => {
        acc.total     += a.stats.total;
        acc.published += a.stats.published;
        acc.failed    += a.stats.failed;
        acc.scheduled += a.stats.scheduled;
        return acc;
      },
      { total: 0, published: 0, failed: 0, scheduled: 0 }
    );
    totals.successRate = totals.total ? Math.round(totals.published / totals.total * 100) : 0;
    res.json({ accounts: stats, totals });
  } catch (e) {
    console.error('reports/performance error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── GET /reports/export?format=csv ───────────────────────────────────────────

router.get('/export', requireAuth, requirePlan('creator_pro', 'agency'), async (req, res) => {
  try {
    const format = (req.query.format || 'csv').toLowerCase();
    const whitelabel = req.query.whitelabel === '1';

    // Vérifier que seul le plan agence peut utiliser le mode marque blanche
    if (whitelabel) {
      const user = req.currentUser || await prisma.user.findUnique({ where: { id: req.userId } });
      if (user.plan !== 'agency') {
        return res.status(403).json({ error: 'La marque blanche est réservée au plan Agence.' });
      }
    }

    const stats = await buildStats(req.userId);

    // ── CSV ──
    if (format === 'csv') {
      const header = 'Plateforme,Compte,Publications totales,Publiées,Échecs,Planifiées,Taux de réussite\n';
      const rows = stats.map(a =>
        `${a.provider},${a.handle},${a.stats.total},${a.stats.published},${a.stats.failed},${a.stats.scheduled},${a.stats.successRate}%`
      ).join('\n');

      const brand = whitelabel ? '' : '\n# Rapport généré par ScaleVid — www.scalevid.fr\n';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="rapport-scalevid.csv"');
      return res.send('﻿' + header + rows + brand);
    }

    // ── PDF ──
    if (format === 'pdf') {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 50 });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="rapport-scalevid.pdf"');
      doc.pipe(res);

      // En-tête
      if (!whitelabel) {
        doc.fontSize(20).fillColor('#f97316').text('ScaleVid', { continued: true });
        doc.fontSize(14).fillColor('#111').text(' — Rapport de performance', { lineGap: 4 });
        doc.moveDown(0.5);
      }

      doc.fontSize(16).fillColor('#111').text('Rapport de performance', { lineGap: 4 });
      doc.fontSize(10).fillColor('#666').text(`Généré le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`);
      doc.moveDown(1);

      // Tableau par compte
      for (const a of stats) {
        doc.fontSize(13).fillColor('#f97316').text(`${a.provider === 'youtube' ? '▶ YouTube' : '♪ TikTok'} — ${a.handle}`);
        doc.fontSize(10).fillColor('#333');
        doc.text(`  Publications : ${a.stats.total}  |  Publiées : ${a.stats.published}  |  Échecs : ${a.stats.failed}  |  Planifiées : ${a.stats.scheduled}  |  Taux : ${a.stats.successRate}%`);
        doc.moveDown(0.8);
      }

      // Totaux
      const totals = stats.reduce(
        (acc, a) => { acc.total += a.stats.total; acc.published += a.stats.published; acc.failed += a.stats.failed; return acc; },
        { total: 0, published: 0, failed: 0 }
      );
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor('#111').text(`Total : ${totals.total} publications — ${totals.published} publiées — ${totals.failed} échecs`);

      if (!whitelabel) {
        doc.moveDown(2);
        doc.fontSize(8).fillColor('#aaa').text('Rapport généré par ScaleVid — www.scalevid.fr', { align: 'center' });
      }

      doc.end();
      return;
    }

    res.status(400).json({ error: 'Format non supporté. Utilisez csv ou pdf.' });
  } catch (e) {
    console.error('reports/export error:', e);
    res.status(500).json({ error: 'Erreur lors de la génération du rapport.' });
  }
});

module.exports = router;
