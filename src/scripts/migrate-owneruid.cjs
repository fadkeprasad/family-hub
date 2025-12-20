/* eslint-disable no-console */
const admin = require("firebase-admin");

async function backfillCollection(db, collectionName, ownerUid) {
  const snap = await db.collection(collectionName).get();
  console.log(`\n${collectionName}: ${snap.size} docs`);

  let batch = db.batch();
  let pending = 0;
  let updated = 0;

  async function commit() {
    if (pending === 0) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (data && data.ownerUid) continue;

    batch.set(
      docSnap.ref,
      { ownerUid, migratedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
    pending += 1;
    updated += 1;

    if (pending >= 450) await commit();
  }

  await commit();
  console.log(`${collectionName}: updated ${updated}`);
}

async function backfillThreads(db, ownerUid) {
  const threadsSnap = await db.collection("threads").get();
  console.log(`\nthreads: ${threadsSnap.size} docs`);

  for (const t of threadsSnap.docs) {
    const tData = t.data();
    if (!tData.ownerUid) {
      await t.ref.set(
        { ownerUid, migratedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
    }

    const messagesSnap = await t.ref.collection("messages").get();
    let batch = db.batch();
    let pending = 0;

    for (const m of messagesSnap.docs) {
      const mData = m.data();
      if (mData.ownerUid) continue;

      batch.set(
        m.ref,
        { ownerUid, migratedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      pending += 1;

      if (pending >= 450) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (pending > 0) await batch.commit();
    console.log(`threads/${t.id}/messages: checked ${messagesSnap.size}`);
  }
}

async function main() {
  const ownerUid = process.argv[2];
  if (!ownerUid) {
    console.error("Usage: node scripts/migrate-owneruid.js <ANJALI_GOOGLE_UID>");
    process.exit(1);
  }

  // Use Application Default Credentials
  // Set env var: GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccountKey.json"
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  const db = admin.firestore();

  await backfillCollection(db, "todos", ownerUid);
  await backfillCollection(db, "todoSeries", ownerUid);
  await backfillCollection(db, "todoSeriesCompletions", ownerUid);
  await backfillCollection(db, "reminders", ownerUid);
  await backfillCollection(db, "journals", ownerUid);

  // Optional (only if you still care about threads/messages)
  await backfillThreads(db, ownerUid);

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
