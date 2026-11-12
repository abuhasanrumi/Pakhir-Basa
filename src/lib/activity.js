import { serverTimestamp } from "firebase/firestore";
import { addRecord } from "../firebase";

// Append one line to the mess change log. Never blocks or breaks the action it describes.
export function logActivity({ cycleId = "", kind, member, messId, summary }) {
  if (!member?.id || !messId || !summary) return;
  addRecord("activity", {
    messId,
    cycleId,
    kind,
    summary,
    actorId: member.id,
    actorName: member.name || "Someone",
    at: serverTimestamp(),
  }).catch((error) => console.warn("Activity log skipped", error));
}
