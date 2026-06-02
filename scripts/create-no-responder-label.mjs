// One-off: create the Clipzi/No-responder Gmail label (black) via the headless
// gmail.modify OAuth client, so it's immediately available to tag threads.
import "dotenv/config";
import { ensureLabel, listLabels } from "../lib/gmail.ts";

const NAME = "Clipzi/No-responder";
const COLOR = { backgroundColor: "#000000", textColor: "#ffffff" };

const before = await listLabels();
if (before.some((l) => l.name === NAME)) {
  console.log(`already exists: ${NAME}`);
} else {
  const id = await ensureLabel(NAME, COLOR);
  console.log(`created ${NAME} -> ${id}`);
}
