type TimelineEvent = { type: string; title: string };

export function orderTimelineColor(event: TimelineEvent): "red" | "green" {
  // The title fallback covers older events without a matching return, rejection, or void command type.
  if (/(?:^|_)(?:REJECT|REJECTED|RETURN|RETURNED|VOID|VOIDED)(?:_|$)/.test(event.type) || /退回|驳回|作废/.test(event.title)) return "red";
  return "green";
}
