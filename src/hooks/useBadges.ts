import useProfile from "./useProfile";
import useLatestReminderAt from "./useLatestReminderAt";
import useTodoTodayRemaining from "./useTodoTodayRemaining";

function toMillis(ts: any): number {
  return ts?.toMillis?.() ?? 0;
}

export default function useBadges() {
  const { profile } = useProfile();
  const latestReminderAt = useLatestReminderAt();
  const todosRemaining = useTodoTodayRemaining();

  const lastSeenReminders = toMillis(profile?.lastSeen?.reminders);
  const lastReminderAt = toMillis(latestReminderAt);

  return {
    todos: todosRemaining, // number of unchecked today
    reminders: lastReminderAt > lastSeenReminders ? 1 : 0, // dot style
    journal: 0,
  };
}
