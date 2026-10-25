/**
 * Met à jour le compte admin (ADMIN_EMAIL) en plan Agency au démarrage.
 * Sans effet si ADMIN_EMAIL n'est pas défini ou si l'utilisateur n'existe pas encore.
 */
const { PrismaClient } = require('@prisma/client');

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) return;

  const prisma = new PrismaClient();
  try {
    const result = await prisma.user.updateMany({
      where: { email },
      data: { plan: 'agency', accountSlots: 4, period: 'annual' },
    });
    if (result.count > 0) {
      console.log(`[seed-admin] Compte admin mis à jour : ${email} → agency (4 slots)`);
    }
  } catch (e) {
    console.warn('[seed-admin] Impossible de mettre à jour le compte admin:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

seedAdmin();
