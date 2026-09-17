import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
if (process.env.NODE_ENV === 'production') throw new Error('Client demo seeding is development-only.');
try {
  for (const demo of [
    { slug: 'acme', name: 'ACME Mobility', mobile: '+919100000101', primaryColor: '#176b4c', secondaryColor: '#e4f2e9', accentColor: '#27865f', loginTitle: 'ACME Fleet Operations' },
    { slug: 'bluemobility', name: 'Blue Mobility', mobile: '+919100000102', primaryColor: '#174c92', secondaryColor: '#e3edff', accentColor: '#2563eb', loginTitle: 'Welcome to Blue Mobility' },
  ]) {
    const client = await prisma.client.upsert({ where: { slug: demo.slug }, create: { slug: demo.slug, companyCode: demo.slug, name: demo.name, status: 'ACTIVE', isActive: true }, update: {} });
    // Do not change an existing client's identity or branding.
    if (client.name !== demo.name) throw new Error(`Client slug ${demo.slug} is already in use; demo was not modified.`);
    await prisma.clientBranding.upsert({ where: { clientId: client.id }, create: { clientId: client.id, primaryColor: demo.primaryColor, secondaryColor: demo.secondaryColor, accentColor: demo.accentColor, loginTitle: demo.loginTitle, loginSubtitle: 'Sign in to manage your electric fleet.' }, update: {} });
    await prisma.clientDomain.upsert({ where: { hostname: `${demo.slug}.localhost` }, create: { clientId: client.id, hostname: `${demo.slug}.localhost`, type: 'EVSEYE_SUBDOMAIN', isVerified: true, isPrimary: true }, update: {} });
    if (!await prisma.user.findFirst({ where: { clientId: client.id, role: 'CLIENT_ADMIN' } })) await prisma.user.create({ data: { clientId: client.id, mobile: demo.mobile, name: `${demo.name} Admin`, role: 'CLIENT_ADMIN', isActive: true } });
    console.info(`${demo.name}: http://${demo.slug}.localhost:3001/`);
  }
} finally { await prisma.$disconnect(); }
