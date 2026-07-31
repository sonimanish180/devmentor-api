import { PrismaClient, Level } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password';
import { reindexSearch } from '../src/modules/search/reindex';

const prisma = new PrismaClient();

/**
 * Seed sample data so a fresh database is immediately usable in dev.
 *
 * Every write is an UPSERT keyed on a unique/compound-unique field, so the seed
 * is idempotent — running it repeatedly converges to the same state instead of
 * creating duplicates. Run with: `pnpm db:seed`.
 */
async function main() {
  // A demo user with a 1:1 stats row.
  const user = await prisma.user.upsert({
    where: { email: 'demo@devmentor.dev' },
    update: {},
    create: {
      email: 'demo@devmentor.dev',
      name: 'Demo Learner',
      passwordHash: await hashPassword('password123'), // dev-only demo credentials
      stats: { create: { totalXP: 0, streak: 0 } },
    },
  });

  // A sample course.
  const course = await prisma.course.upsert({
    where: { slug: 'sample-backend' },
    update: { title: 'Sample Backend Course', description: 'Seeded example course.', published: true },
    create: {
      slug: 'sample-backend',
      title: 'Sample Backend Course',
      description: 'Seeded example course.',
      icon: '🧪',
      color: '#0ea5e9',
      order: 0,
      published: true,
    },
  });

  // A module within the course (unique by courseId + slug).
  const mod = await prisma.module.upsert({
    where: { courseId_slug: { courseId: course.id, slug: 'foundations' } },
    update: { title: 'Foundations' },
    create: { courseId: course.id, slug: 'foundations', title: 'Foundations', description: 'Getting started', order: 0 },
  });

  // Two lessons with JSONB content blocks + quiz.
  const intro = await prisma.lesson.upsert({
    where: { moduleId_slug: { moduleId: mod.id, slug: 'intro' } },
    update: {},
    create: {
      moduleId: mod.id,
      slug: 'intro',
      title: 'Introduction',
      level: Level.beginner,
      duration: '5 min',
      xp: 50,
      order: 0,
      blocks: [
        { type: 'heading', content: 'Welcome' },
        { type: 'paragraph', content: 'This is a seeded sample lesson stored as JSONB.' },
      ],
      quiz: [
        { id: 'q1', question: 'Was this lesson seeded?', options: ['Yes', 'No'], correct: 0, explanation: 'Created by prisma/seed.ts.' },
      ],
    },
  });

  const next = await prisma.lesson.upsert({
    where: { moduleId_slug: { moduleId: mod.id, slug: 'next-steps' } },
    update: {},
    create: {
      moduleId: mod.id,
      slug: 'next-steps',
      title: 'Next Steps',
      level: Level.beginner,
      duration: '6 min',
      xp: 60,
      order: 1,
      blocks: [
        { type: 'heading', content: 'Where to go next' },
        { type: 'paragraph', content: 'Keep building the backend, phase by phase.' },
      ],
      quiz: [],
    },
  });

  // Enroll the demo user and seed some progress (idempotent via composite PKs).
  await prisma.enrollment.upsert({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
    update: {},
    create: { userId: user.id, courseId: course.id },
  });

  await prisma.lessonCompletion.upsert({
    where: { userId_lessonId: { userId: user.id, lessonId: intro.id } },
    update: {},
    create: { userId: user.id, lessonId: intro.id },
  });

  await prisma.quizScore.upsert({
    where: { userId_lessonId: { userId: user.id, lessonId: intro.id } },
    update: { bestScore: 100 },
    create: { userId: user.id, lessonId: intro.id, bestScore: 100, attempts: 1 },
  });

  // Populate the search read model (Task 11.3) so a fresh dev DB is
  // immediately searchable, not just browsable.
  const indexed = await reindexSearch(prisma);

  console.log('Seed complete:', {
    user: user.email,
    course: course.slug,
    module: mod.slug,
    lessons: [intro.slug, next.slug],
    searchIndexed: indexed,
  });
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
