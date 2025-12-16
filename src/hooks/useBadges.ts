import useProfile from "./useProfile";
import useThreadMeta from "./useThreadMeta";
import useLatestReminderAt from "./useLatestReminderAt";

function toMillis(ts: any): number {
  return ts?.toMillis?.() ?? 0;
}

export default function useBadges() {
  const { profile } = useProfile();
  const thread = useThreadMeta();
  const latestReminderAt = useLatestReminderAt();

  const lastSeenMessages = toMillis(profile?.lastSeen?.messages);
  const lastMessageAt = toMillis(thread?.lastMessageAt);

  const lastSeenReminders = toMillis(profile?.lastSeen?.reminders);
  const lastReminderAt = toMillis(latestReminderAt);

  return {
    todos: 0,
    people: 0,
    messages: lastMessageAt > lastSeenMessages ? 1 : 0,
    reminders: lastReminderAt > lastSeenReminders ? 1 : 0,
  };
}
