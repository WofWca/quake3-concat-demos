// node test.js [demo.dm_68 [unrelated.dm_68]]
// Cuts a real demo in two the way `stoprecord; record` would and checks the join.
'use strict';
const assert = require('assert');
const fs = require('fs');
const { concat, readDemo, parseMessage, apply, Reader, Writer, SVC } = require('./concat.js');

const load = f => new Uint8Array(fs.readFileSync(f));
const parse = buf => readDemo(buf).map(m => ({ ...m, ...parseMessage(m.data) }));
const stateAfter = msgs => msgs.reduce((st, m) => (apply(st, m), st), {});
const file = msgs => Buffer.concat([...msgs.flatMap(m => {
	const h = Buffer.alloc(8);
	h.writeInt32LE(m.seq, 0);
	h.writeInt32LE(m.data.length, 4);
	return [h, m.data];
}), Buffer.alloc(8, 255)]);

// what `record` would write when started just before msgs[k]
function secondHalf(msgs, k) {
	const st = stateAfter(msgs.slice(0, k)), w = new Writer();
	w.long(0);
	w.byte(SVC.gamestate);
	w.long(st.cmdSeq);
	for (const [i, v] of st.cs) { w.byte(SVC.configstring); w.short(i); w.string(v); }
	w.rest(new Reader(st.tail.split(',').map(Number)));
	return file([{ seq: msgs[k].seq - 1, data: Uint8Array.from(w.bytes) }, ...msgs.slice(k)]);
}

const origBuf = load(process.argv[2] ?? '/mnt/hobby/baseq3-pk3/demos/four.dm_68');
const orig = parse(origBuf);
assert(Buffer.from(concat([origBuf]).data).equals(origBuf), 'single file round-trips');

// no gap: must give back the original recording exactly
let res = concat([file(orig.slice(0, 500)), secondHalf(orig, 500)]);
assert.deepEqual(res.joins, ['seamless']);
assert(Buffer.from(res.data).equals(origBuf), 'gapless join is byte-identical');

// gap swallowing a configstring change
const k = orig.findIndex((m, i) => i > 1 && m.cmds.some(c => c[1].startsWith('cs ')));
res = concat([file(orig.slice(0, k)), secondHalf(orig, k + 1)]);
assert.deepEqual(res.joins, ['seamless']);
const out = parse(res.data);
assert.equal(out.length, orig.length - 1);
assert.deepEqual(stateAfter(out).cs, stateAfter(orig).cs, 'lost configstring change is recreated');
const seqs = out.flatMap(m => m.cmds.map(c => c[0]));
assert(seqs.every((s, i) => !i || s === seqs[i - 1] + 1), 'no holes in server command sequence');
assert(!out[k].cmds.some(c => !/^(cs|bcs1) /.test(c[1])), 'only cs and no-ops injected');

// gap too long to play through: falls back to keeping the gamestate
res = concat([file(orig.slice(0, k)), secondHalf(orig, k + 100)]);
assert.match(res.joins[0], /^level reload \(\d+ ms gap\)$/);
assert.equal(parse(res.data).filter(m => m.gs).length, 2);

// wrong order
res = concat([secondHalf(orig, 500), file(orig.slice(0, 500))]);
assert.match(res.joins[0], /^level reload/);

if (process.argv[3]) {
	res = concat([origBuf, load(process.argv[3])]);
	assert.match(res.joins[0], /^level reload \(different map/);
	assert.equal(res.data.length, origBuf.length + fs.statSync(process.argv[3]).size - 8);
}
console.log('ok');
