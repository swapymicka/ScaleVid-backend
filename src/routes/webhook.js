/**
 * Webhook Stripe — reçoit les événements de paiement et met à jour le plan.
 *
 * Configuration Stripe :
 *   Dashboard Stripe → Développeurs → Webhooks → Ajouter un endpoint
 *   URL : https://www.scalevid.fr/webhook/stripe
 *   Événements à écouter :
 *     - checkout.session.completed
 *     - customer.subscription.updated
 *     - customer.subscription.deleted
 *
 * Variable Railway à ajouter : STRIPE_WEBHOOK_SECRET (whsec_...)
 */
const express = require('express');
const Stripe   = require('stripe');
const prisma   = require('../db');
const config   = require('../config');

const router = express.Router();
const stripe = Stripe(config.stripe.secretKey);

// Mapping Payment Link ID → plan interne
// Ces IDs correspondent aux payment_link.id dans les objets Stripe
const PAYMENT_LINK_PLANS = {
  // Créateur mensuel
  '9B69ATd3YaB01Dd9vm93y00': { plan: 'creator',     accounts: 1, period: 'monthly' },
  // Créateur annuel
  'eVqfZh7JE38y95FdLC93y01':  { plan: 'creator',     accounts: 1, period: 'annual'  },
  // Créateur Pro mensuel
  '4gMaEX6FA38y1Dd36Y93y02':  { plan: 'creator_pro', accounts: 2, period: 'monthly' },
  // Créateur Pro annuel
  'fZudR95Bw8sS5Tt9vm93y03':  { plan: 'creator_pro', accounts: 2, period: 'annual'  },
  // Agence mensuel
  'dRm00j8NIbF481BePG93y04':  { plan: 'agency',      accounts: 4, period: 'monthly' },
  // Agence annuel
  '9B6bJ13tofVkdlVcHy93y05':  { plan: 'agency',      accounts: 4, period: 'annual'  },
};

// Mapping via price ID (plus fiable que le payment link slug)
const PRICE_ID_PLANS = {
  [process.env.STRIPE_PRICE_CREATOR_MONTHLY]:     { plan: 'creator',     accounts: 1, period: 'monthly' },
  [process.env.STRIPE_PRICE_CREATOR_ANNUAL]:      { plan: 'creator',     accounts: 1, period: 'annual'  },
  [process.env.STRIPE_PRICE_CREATOR_PRO_MONTHLY]: { plan: 'creator_pro', accounts: 2, period: 'monthly' },
  [process.env.STRIPE_PRICE_CREATOR_PRO_ANNUAL]:  { plan: 'creator_pro', accounts: 2, period: 'annual'  },
  [process.env.STRIPE_PRICE_AGENCY_MONTHLY]:      { plan: 'agency',      accounts: 4, period: 'monthly' },
  [process.env.STRIPE_PRICE_AGENCY_ANNUAL]:       { plan: 'agency',      accounts: 4, period: 'annual'  },
};

// Helper : déduire le plan à partir d'une session checkout
function getPlanFromSession(session) {
  // 1. Via metadata (si configuré dans le Payment Link)
  if (session.metadata?.plan) {
    return {
      plan:     session.metadata.plan,
      accounts: parseInt(session.metadata.accounts || '1', 10),
      period:   session.metadata.period || 'monthly',
    };
  }
  // 2. Via payment_link slug dans l'URL
  if (session.payment_link) {
    const info = PAYMENT_LINK_PLANS[session.payment_link];
    if (info) return info;
  }
  return null;
}

// Helper : déduire le plan à partir des line items (price_id)
async function getPlanFromLineItems(sessionId) {
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 5 });
    for (const item of lineItems.data) {
      const info = PRICE_ID_PLANS[item.price?.id];
      if (info) return info;
    }
  } catch (e) {
    console.warn('[webhook/stripe] impossible de récupérer les line items:', e.message);
  }
  return null;
}

// ── POST /webhook/stripe ─────────────────────────────────────────────────────
// IMPORTANT : raw body requis pour la vérification de signature Stripe
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    if (config.stripe.webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
    } else {
      // Dev sans clé webhook : on parse directement (non sécurisé)
      event = JSON.parse(req.body.toString());
      console.warn('[webhook/stripe] ⚠️  STRIPE_WEBHOOK_SECRET non configuré — vérification ignorée');
    }
  } catch (err) {
    console.error('[webhook/stripe] signature invalide:', err.message);
    return res.status(400).json({ error: `Signature invalide: ${err.message}` });
  }

  console.log(`[webhook/stripe] événement: ${event.type}`);

  try {
    switch (event.type) {

      // ── Paiement complété (Payment Link ou Checkout) ─────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const email   = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim();

        if (!email) {
          console.warn('[webhook/stripe] email absent dans la session');
          break;
        }

        // Déterminer le plan
        let planInfo = getPlanFromSession(session);
        if (!planInfo) {
          planInfo = await getPlanFromLineItems(session.id);
        }
        if (!planInfo) {
          console.warn('[webhook/stripe] impossible de déterminer le plan pour:', session.id);
          planInfo = { plan: 'creator', accounts: 1, period: 'monthly' }; // fallback
        }

        const stripeCustomerId = session.customer || null;

        // Upsert utilisateur
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          user = await prisma.user.create({
            data: {
              name:             email.split('@')[0],
              email,
              passwordHash:     'stripe-purchase',
              plan:             planInfo.plan,
              period:           planInfo.period,
              accountSlots:     planInfo.accounts,
              stripeCustomerId,
            },
          });
          console.log(`[webhook/stripe] nouvel utilisateur: ${email} → ${planInfo.plan} (${planInfo.period})`);
        } else {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              plan:             planInfo.plan,
              period:           planInfo.period,
              accountSlots:     planInfo.accounts,
              ...(stripeCustomerId ? { stripeCustomerId } : {}),
            },
          });
          console.log(`[webhook/stripe] plan mis à jour: ${email} → ${planInfo.plan} (${planInfo.period})`);
        }
        break;
      }

      // ── Abonnement mis à jour ─────────────────────────────────────────────
      case 'customer.subscription.updated': {
        const sub      = event.data.object;
        const custId   = sub.customer;
        const priceId  = sub.items?.data?.[0]?.price?.id;
        const planInfo = PRICE_ID_PLANS[priceId];

        if (!custId) break;

        const user = await prisma.user.findFirst({ where: { stripeCustomerId: custId } });
        if (!user) {
          console.warn('[webhook/stripe] customer introuvable:', custId);
          break;
        }

        if (planInfo) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              plan:         planInfo.plan,
              period:       planInfo.period,
              accountSlots: planInfo.accounts,
            },
          });
          console.log(`[webhook/stripe] abonnement mis à jour: ${user.email} → ${planInfo.plan}`);
        }

        // Si annulé/impayé → repasser en free
        if (['canceled', 'unpaid', 'past_due'].includes(sub.status)) {
          await prisma.user.update({
            where: { id: user.id },
            data: { plan: 'free', accountSlots: 0 },
          });
          console.log(`[webhook/stripe] abonnement suspendu: ${user.email} → free`);
        }
        break;
      }

      // ── Abonnement annulé ─────────────────────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub    = event.data.object;
        const custId = sub.customer;
        if (!custId) break;

        const user = await prisma.user.findFirst({ where: { stripeCustomerId: custId } });
        if (user) {
          await prisma.user.update({
            where: { id: user.id },
            data: { plan: 'free', accountSlots: 0 },
          });
          console.log(`[webhook/stripe] abonnement annulé: ${user.email} → free`);
        }
        break;
      }

      default:
        // Événement non géré — OK
        console.log(`[webhook/stripe] événement ignoré: ${event.type}`);
    }
  } catch (e) {
    console.error('[webhook/stripe] erreur traitement:', e.message);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }

  res.json({ received: true });
});

module.exports = router;
