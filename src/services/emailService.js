const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;
function getTransporter() {
  if (!config.email.user || !config.email.appPassword) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: config.email.user, pass: config.email.appPassword },
    });
  }
  return transporter;
}

async function sendWelcomeEmail(user) {
  const t = getTransporter();
  if (!t) {
    console.warn('[email] GMAIL_USER / GMAIL_APP_PASSWORD non configurés — email de bienvenue non envoyé.');
    return;
  }

  const firstName = (user.name || '').split(' ')[0] || 'là';
  const creatorUrl    = 'https://buy.stripe.com/9B69ATd3YaB01Dd9vm93y00'; // Créateur mensuel
  const creatorProUrl = 'https://buy.stripe.com/9B6bJ11lg5gG3Ll4b293y06'; // Créateur Pro mensuel
  const agencyUrl     = 'https://buy.stripe.com/dRm00j8NIbF481BePG93y04'; // Agence mensuel
  const appUrl        = config.appBaseUrl || 'http://localhost:4000';

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,Segoe UI,Helvetica,sans-serif;">
  <div style="max-width:580px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#0d0d1a;padding:32px 40px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Scale<span style="color:#ff3b5c;">Vid</span></div>
      <div style="font-size:13px;color:#888;margin-top:4px;font-family:monospace;">Automatise ta croissance sur les réseaux</div>
    </div>

    <!-- Body -->
    <div style="padding:36px 40px;">
      <h1 style="font-size:22px;color:#0d0d1a;margin:0 0 12px;">Bienvenue ${firstName} 👋</h1>
      <p style="color:#444;line-height:1.7;margin:0 0 20px;">
        Ton compte ScaleVid est créé. Tu bénéficies d'un <strong>essai gratuit</strong> qui te permet de connecter un compte YouTube ou TikTok et de publier <strong>une vidéo</strong> pour voir la magie à l'œuvre.
      </p>
      <p style="color:#444;line-height:1.7;margin:0 0 28px;">
        Prêt à automatiser entièrement ta stratégie courte durée ? Voici ce que ScaleVid peut faire pour toi :
      </p>

      <!-- Features -->
      <div style="background:#f8f8fc;border-radius:12px;padding:20px 24px;margin-bottom:32px;">
        <div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start;">
          <span style="font-size:20px;">🎬</span>
          <div><strong style="color:#0d0d1a;">Découpage automatique par IA</strong><br><span style="color:#666;font-size:13px;">ScaleVid analyse tes vidéos longues et extrait automatiquement les moments les plus viraux.</span></div>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start;">
          <span style="font-size:20px;">⏰</span>
          <div><strong style="color:#0d0d1a;">Publication programmée</strong><br><span style="color:#666;font-size:13px;">Planifie tes shorts à l'heure optimale — ScaleVid publie automatiquement sur YouTube et TikTok.</span></div>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:12px;align-items:flex-start;">
          <span style="font-size:20px;">✍️</span>
          <div><strong style="color:#0d0d1a;">Titres & hashtags générés par IA</strong><br><span style="color:#666;font-size:13px;">Des titres accrocheurs et des hashtags optimisés créés automatiquement pour chaque short.</span></div>
        </div>
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <span style="font-size:20px;">📈</span>
          <div><strong style="color:#0d0d1a;">Score viral & conseils</strong><br><span style="color:#666;font-size:13px;">Chaque clip reçoit un score de potentiel viral et des recommandations pour maximiser l'engagement.</span></div>
        </div>
      </div>

      <!-- Plans -->
      <h2 style="font-size:17px;color:#0d0d1a;margin:0 0 16px;">Nos abonnements</h2>
      <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:32px;">

        <!-- Créateur -->
        <div style="border:1px solid #e5e5e5;border-radius:12px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:12px;color:#888;font-family:monospace;text-transform:uppercase;margin-bottom:4px;">Créateur solo</div>
            <div style="font-size:22px;font-weight:800;color:#0d0d1a;">7,99€<span style="font-size:12px;color:#888;font-weight:400;">/mois</span></div>
            <div style="color:#555;font-size:12px;margin-top:4px;">1 compte · Publications illimitées · Score viral</div>
          </div>
          <a href="${creatorUrl}" style="background:#0d0d1a;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap;">Choisir →</a>
        </div>

        <!-- Créateur Pro -->
        <div style="border:2px solid #7c3aed;border-radius:12px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;position:relative;">
          <div style="position:absolute;top:-10px;left:16px;background:#7c3aed;color:#fff;font-size:10px;font-family:monospace;padding:2px 10px;border-radius:20px;">⭐ Recommandé</div>
          <div>
            <div style="font-size:12px;color:#888;font-family:monospace;text-transform:uppercase;margin-bottom:4px;">Créateur Pro</div>
            <div style="font-size:22px;font-weight:800;color:#0d0d1a;">13,99€<span style="font-size:12px;color:#888;font-weight:400;">/mois</span></div>
            <div style="color:#555;font-size:12px;margin-top:4px;">2 comptes · YouTube + TikTok simultanés</div>
          </div>
          <a href="${creatorProUrl}" style="background:#7c3aed;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap;">Choisir →</a>
        </div>

        <!-- Agence -->
        <div style="border:2px solid #ff3b5c;border-radius:12px;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:12px;color:#888;font-family:monospace;text-transform:uppercase;margin-bottom:4px;">Agence</div>
            <div style="font-size:22px;font-weight:800;color:#0d0d1a;">28,99€<span style="font-size:12px;color:#888;font-weight:400;">/mois</span></div>
            <div style="color:#555;font-size:12px;margin-top:4px;">4 comptes · Dashboard multi-clients · Support prioritaire</div>
          </div>
          <a href="${agencyUrl}" style="background:#ff3b5c;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;white-space:nowrap;">Choisir →</a>
        </div>

      </div>

      <!-- CTA principal -->
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${appUrl}" style="display:inline-block;background:#ff3b5c;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px;font-weight:700;">
          Accéder à mon tableau de bord →
        </a>
      </div>

      <p style="color:#999;font-size:12px;text-align:center;line-height:1.6;margin:0;">
        Une question ? Réponds directement à cet email, je suis là pour t'aider.<br>
        <strong style="color:#555;">L'équipe ScaleVid</strong>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8f8fc;padding:16px 40px;text-align:center;border-top:1px solid #e5e5e5;">
      <p style="color:#bbb;font-size:11px;margin:0;">
        Tu reçois cet email car tu viens de créer un compte sur ScaleVid.<br>
        © ${new Date().getFullYear()} ScaleVid — Tous droits réservés.
      </p>
    </div>

  </div>
</body>
</html>`;

  await t.sendMail({
    from: `"${config.email.fromName || 'ScaleVid'}" <${config.email.user}>`,
    to: user.email,
    subject: `${firstName}, bienvenue sur ScaleVid 🎬 — ton essai gratuit t'attend`,
    html,
  });
  console.log(`[email] Email de bienvenue envoyé à ${user.email}`);
}

module.exports = { sendWelcomeEmail };
