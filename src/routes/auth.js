const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../db');
const config = require('../config');
const { sendWelcomeEmail } = require('../services/emailService');

const router = express.Router();

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: '30d' });
}

// On pose aussi le token dans un cookie httpOnly : c'est ce qui permet au
// navigateur de rester authentifié quand on le redirige vers GET /auth/youtube
// (une redirection de navigateur ne peut pas porter un header Authorization).
function setAuthCookie(res, token) {
  res.cookie('scalevid_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Nom, email et mot de passe (6+ caractères) requis.' });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { name, email, passwordHash } });
    const token = signToken(user);
    setAuthCookie(res, token);

    // Email de bienvenue envoyé en arrière-plan : on ne fait pas attendre la
    // réponse de l'inscription et un échec d'envoi ne doit jamais bloquer l'utilisateur.
    sendWelcomeEmail(user).catch((e) => console.error('[email] échec envoi email de bienvenue:', e.message));

    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
