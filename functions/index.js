const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { DateTime } = require("luxon");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

const APP_LINK = "https://family-hub-5a198.web.app/";

function tokenToId(token) {
  return Buffer.from(token, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function computeNextRunAt(time, timeZone, nowUtc) {
  const zone = timeZone || "UTC";
  const localNow = nowUtc.setZone(zone);
  const parts = String(time || "").split(":").map((v) => Number(v));
  const hour = Number.isFinite(parts[0]) ? parts[0] : 9;
  const minute = Number.isFinite(parts[1]) ? parts[1] : 0;

  let next = localNow.set({ hour, minute, second: 0, millisecond: 0 });
  if (next <= localNow) {
    next = next.plus({ days: 1 });
  }
  return next.toUTC();
}

async function sendToTokens(tokens, title, body) {
  if (!tokens.length) return [];

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: {
      fcmOptions: { link: APP_LINK },
    },
    data: {
      link: APP_LINK,
    },
  });

  const invalidTokens = [];
  response.responses.forEach((res, idx) => {
    if (!res.success) {
      const code = res.error?.code || "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        invalidTokens.push(tokens[idx]);
      }
    }
  });

  return invalidTokens;
}

exports.sendScheduledNotifications = functions.pubsub
  .schedule("every 1 minutes")
  .timeZone("UTC")
  .onRun(async () => {
    const nowUtc = DateTime.utc();
    const cutoff = admin.firestore.Timestamp.fromDate(nowUtc.toJSDate());

    const dueSnap = await db
      .collectionGroup("notificationSchedules")
      .where("enabled", "==", true)
      .where("nextRunAt", "<=", cutoff)
      .limit(200)
      .get();

    if (dueSnap.empty) return null;

    for (const scheduleDoc of dueSnap.docs) {
      const data = scheduleDoc.data() || {};
      const ownerUid = data.ownerUid || scheduleDoc.ref.parent.parent?.id;
      if (!ownerUid) continue;

      const time = String(data.time || "09:00");
      const timeZone = String(data.timeZone || "UTC");
      const nextRunAt = computeNextRunAt(time, timeZone, nowUtc);

      const tokensSnap = await db.collection("users").doc(ownerUid).collection("pushTokens").get();
      const tokens = tokensSnap.docs
        .map((d) => String(d.data().token || ""))
        .filter((t) => t);

      const title = "Family Hub reminder";
      const body = "Check today's to-dos and journal.";

      const invalidTokens = tokens.length ? await sendToTokens(tokens, title, body) : [];

      const update = {
        nextRunAt: admin.firestore.Timestamp.fromDate(nextRunAt.toJSDate()),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (tokens.length) {
        update.lastSentAt = admin.firestore.FieldValue.serverTimestamp();
      }
      await scheduleDoc.ref.set(update, { merge: true });

      if (invalidTokens.length > 0) {
        const batch = db.batch();
        for (const token of invalidTokens) {
          const tokenId = tokenToId(token);
          batch.delete(db.collection("users").doc(ownerUid).collection("pushTokens").doc(tokenId));
        }
        await batch.commit();
      }
    }

    return null;
  });
