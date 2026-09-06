/**
 * Seeds a ready-to-test quiz so you can exercise the whole app before deploying.
 *
 * Creates ONE session with a fixed join code + host token and 5 questions (correct
 * answers already marked, so scoring works end-to-end). Re-running wipes and recreates
 * that demo session only.
 *
 *   npm run db:seed  -w @sigunu/server
 */
import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';

const prisma = new PrismaClient();

const DEMO_JOIN_CODE = 'TESTQZ';
const DEMO_HOST_TOKEN = 'demo-host-token-change-me';

function opt(text: string) {
  return { id: nanoid(8), text };
}

async function main() {
  // Reset the demo session (cascade removes its questions/teams/participants/answers).
  await prisma.session.deleteMany({ where: { joinCode: DEMO_JOIN_CODE } });

  const session = await prisma.session.create({
    data: {
      joinCode: DEMO_JOIN_CODE,
      hostToken: DEMO_HOST_TOKEN,
      roomName: `sigunu-${DEMO_JOIN_CODE}`,
      phase: 'lobby',
      defaultCorrectPoints: 10,
      defaultWrongPenalty: 5, // wrong answers cost 5; 'zero' policy means no-answer costs nothing
      unansweredPolicy: 'zero',
    },
  });

  const questions = [
    {
      text: 'Which planet is known as the Red Planet?',
      opts: ['Venus', 'Mars', 'Jupiter', 'Saturn'],
      correct: 1,
    },
    {
      text: 'What is the capital of Japan?',
      opts: ['Seoul', 'Beijing', 'Tokyo', 'Bangkok'],
      correct: 2,
    },
    {
      text: 'How many continents are there on Earth?',
      opts: ['5', '6', '7', '8'],
      correct: 2,
      // Per-question scoring override: this one is worth more, no penalty.
      correctPoints: 20,
      wrongPenalty: 0,
    },
    {
      text: 'Who wrote the play "Romeo and Juliet"?',
      opts: ['Charles Dickens', 'William Shakespeare', 'Mark Twain'],
      correct: 1,
    },
    {
      text: 'What is the chemical symbol for water?',
      opts: ['O2', 'CO2', 'H2O', 'NaCl'],
      correct: 2,
      timeLimitSec: 20,
    },
  ];

  let order = 0;
  for (const q of questions) {
    order += 1;
    const options = q.opts.map(opt);
    await prisma.question.create({
      data: {
        sessionId: session.id,
        order,
        text: q.text,
        media: [],
        options,
        correctOptionId: options[q.correct].id,
        correctPoints: (q as any).correctPoints ?? null,
        wrongPenalty: (q as any).wrongPenalty ?? null,
        timeLimitSec: (q as any).timeLimitSec ?? null,
        source: 'manual',
      },
    });
  }

  console.log('\n✅ Seeded demo quiz "Sigunu Test Quiz" (5 questions)\n');
  console.log(`   Session id : ${session.id}`);
  console.log(`   Join code  : ${DEMO_JOIN_CODE}   (players enter this)`);
  console.log(`   Host token : ${DEMO_HOST_TOKEN}   (quiz master control token)\n`);
  console.log('   Open the web app, host with the token above, and have players join with the code.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
