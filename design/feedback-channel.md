# Build-Ready Spec — "First Run" Beta Feedback Channel

## UI placement
- Add a **"Feedback"** header button in the Shell (top-right, grouped with Help), label `💬 Feedback` with tooltip → opens a `FeedbackModal` (styled like HelpModal, fixed overlay, Escape to close).
- Inside the modal, below the form: **"Your submissions"** list (only the signed-in player's own).
- **First-Run nudge:** after a new account's first successful login, show a one-time dismissible banner: *"This is the first world — tell us what broke."* Persist `dismissedNotice`.

## Form fields
- **Category** — radio: `bug | flow_issue | feature_suggestion`. Default `bug`. Required.
- **Severity** — shown only when `bug`: `low | medium | high | critical`. Required when bug.
- **Title** — text, required, max 80.
- **Description** — textarea, required, min 10, max 2000.
- **Player/colony name** — optional, prefill `playerName`.
- No screenshots for MVP (future).

## Data model & storage
New file `data/feedback.json` (mirror store.ts pattern):
```ts
interface FeedbackRecord {
  id: string; accountId: string; createdAt: number;
  category: "bug" | "flow_issue" | "feature_suggestion";
  title: string; description: string;
  playerName?: string; severity?: "low"|"medium"|"high"|"critical";
  status: "new"|"read"|"triaged"|"done";
}
interface FeedbackFile { version: 1; submissions: FeedbackRecord[]; }
```
- Player sees only own records; team reads the whole file list directly.

## API
- `submitFeedbackFn({token, category, title, description, playerName?, severity?})` → validates, appends, writes.
- `listMyFeedbackFn({token})` → own records.
- Spam guard: min 30s between submissions, cap 50/account.

## Files
`game/types.ts`, `game/store.ts`, `game/api.ts`, `routes/play.tsx`.
