/**
 * Webhook Payhip — reçoit les notifications d'achat et met à jour le plan.
 *
 * Configuration Payhip :
 *   Dashboard Payhip → Account Settings → Webhooks
 *   URL : https://www.scalevid.fr/webhook/payhip
 *   Cocher : "Payment completed"
 *
 * Variable Railway à ajouter : PAYHIP_WEBHOOK_SECRET (la valeur dans Payhip)
 */
const express = require('express');
const crypto  = require('crypto');
const prisma  = require('../db');
const config  = require('../config');

const router = express.Router();

// Payhip envoie application/x-www-form-urlencoded
router.use(express.urlencoded({ extended: true }));

// ── helper : vérifie la signature HMAC Payhip ────────────────────────────────
function verifySignature(body, receivedSig) {
  if (!config.payhip.secretKey) return true; // pas de clé configurée = on accepte (dev)
  const expected = crypto
    .createHmac('sha256', config.payhip.secretKey)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig || ''));
}

// ── POST /webhook/payhip ─────────────────────────────────────────────────────
router.post('/payhip', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    // Payhip peut envoyer JSON ou form-encoded — on parse les deux
    let data;
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
      data = JSON.parse(req.body.toString());
    } else {
      // form-encoded
      const params = new URLSearchParams(req.body.toString());
      data = Object.fromEntries(params.entries());
    }

    console.log('[webhook/payhip] reçu:', JSON.stringify(data));

    // Vérification signature (optionnel si PAYHIP_WEBHOOK_SECRET configuré)
    const sig = req.headers['x-payhip-signature'] || data.security_token;
    if (config.payhip.secretKey && !verifySignature(data, sig)) {
      console.warn('[webhook/payhip] signature invalide');
      return res.status(401).json({ error: 'Signature invalide.' });
    }

    // On ne traite que les paiements complétés
    if (data.event && data.event !== 'payment_completed') {
      return res.json({ ok: true, skipped: true });
    }

    // Récupérer l'email de l'acheteur
    const email = (data.buyer_email || data.email || '').toLowerCase().trim();
    if (!email) {
      console.warn('[webhook/payhip] pas d\'email dans le payload');
      return res.status(400).json({ error: 'Email manquant.' });
    }

    // Identifier le plan via le product_permalink (ex: "nFreq")
    const permalink = data.product_permalink || data.permalink || '';
    const planInfo = config.payhip.productPlans[permalink];
    if (!planInfo) {
      console.warn('[webhook/payhip] permalink inconnu:', permalink);
      // On continue quand même — on met creator par défaut
    }
    const newPlan     = planInfo?.plan     || 'creator';
    const newAccounts = planInfo?.accounts || 1;
    const period      = (data.product_type === 'subscription' && data.billing_cycle === 'yearly') ? 'annual' : 'monthly';

    // Trouver ou créer l'utilisateur
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name:         email.split('@')[0],
          email,
          passwordHash: 'payhip-purchase',
          plan:         newPlan,
          period,
          accountSlots: newAccounts,
        },
      });
      console.log(`[webhook/payhip] nouvel utilisateur créé: ${email} → ${newPlan}`);
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: { plan: newPlan, period, accountSlots: newAccounts },
      });
      console.log(`[webhook/payhip] plan mis à jour: ${email} → ${newPlan}`);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[webhook/payhip] erreur:', e.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
