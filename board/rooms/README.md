# board/rooms

Live status drops from disposable rooms (planning rooms, test rooms).

Each room owns exactly ONE file here, named after its slug: `<slug>.json`. One
file per room means two rooms can never clobber each other, which is why this is
a folder instead of a shared file.

Shape:

```json
{
  "slug": "sj-email",
  "chat": "SJ EMAIL GO-LIVE",
  "state": "white",
  "one": "Waiting on the DKIM record to propagate, checked 2 of 3 in",
  "blockedBy": null,
  "at": "2026-07-26T18:40:00Z"
}
```

- `slug` must match the filename.
- `chat` must match the chat's sidebar name exactly, so the board can pair it
  with that card.
- `state` is one of Zoran's colours: `red` (his action, on his computer),
  `white` (claude working right now), `blue` (his input needed in the chat),
  `orange` (blocked, and `blockedBy` must say by what), `done`.
- `one` is a single plain-English line. No em dashes. This is what he reads.
- `at` is ISO UTC, used to show staleness.

The board polls these every 5 seconds and overlays them onto the matching chat
card, so Zoran sees a room's progress WHILE he is talking to it, instead of
waiting for the room to finish and report back to the orchestrator.

Rooms should drop a fresh file at every meaningful beat: starting, waiting on
Zoran, blocked, done. Delete nothing; the orchestrator prunes stale files when a
room is archived.
