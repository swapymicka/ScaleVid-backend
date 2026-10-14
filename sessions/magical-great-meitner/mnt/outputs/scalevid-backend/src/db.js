const { PrismaClient } = require('@prisma/client');

// Instance unique partagée du client Prisma (évite d'épuiser les connexions
// en dev avec le rechargement à chaud de nodemon).
const prisma = global.__scalevidPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__scalevidPrisma = prisma;

module.exports = prisma;
