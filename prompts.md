> Make a web tool to concatenate Quake III replays. I believe it's possible at least when the replays are actually the same game, just split into two.

---

The tool is built: open `index.html` in a browser, pick the demo parts, reorder if needed, hit Concatenate, download. It has not been played back in the engine or clicked through in a browser — there's no display in this session — so the evidence so far is the node self-check only.

`node test.js` passes against `four.dm_68`, cut in two the way `stoprecord; record` would:

- **No gap:** the joined file is byte-identical to the original recording.
- **Gap that swallows a score update:** joined seamlessly, the lost configstring change is recreated, and the server command sequence has no holes.
- **5 s gap, wrong order, unrelated demo:** each falls back to a level reload.

How each join is decided:

- **Seamless:** the second file's gamestate is dropped and its snapshots continue straight on. This happens when both parts have the same baselines, client number and checksum feed (i.e. same map load on the same connection), the second is later, and the server-time gap is at most 3 s.
- **Level reload:** anything else keeps the second gamestate, so playback reloads the level at the join. The page shows which one happened and why for each pair.

The 3 s limit exists because demo playback freezes for the length of any server-time gap. It is the `MAX_GAP_MS` constant in `concat.js` if you want a different trade-off.

Things to know:

- `./quake3e` doesn't exist in this directory; I read the source from `/mnt/hobby/clones/Quake3e` instead.
- The test demos are synthetic cuts of one real demo. A real pair of back-to-back recordings from your client is the test worth doing next.
- Files are sorted by name on selection (the default `demo-YYYYMMDD-HHMMSS` names sort chronologically); the ↑ buttons fix the order otherwise.
- All inputs must share one extension. I only exercised `.dm_68`; other protocols of the same family should work but are untested.

Skipped: drag-and-drop reordering and a gap-length setting in the UI — add them if the ↑ buttons and the constant get annoying.