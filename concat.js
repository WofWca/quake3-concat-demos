// Concatenate Quake III demos (.dm_6x).
// Format reference: Quake3e code/client/cl_main.c (demo writing), cl_parse.c, qcommon/msg.c.
'use strict';

// HuffmanEncoderTable from Quake3e qcommon/huffman_static.c: bit count in the low 4 bits, code above
const ENC = [
	34, 437, 1159, 1735, 2584, 280, 263, 1014, 341, 839, 1687, 183, 311, 726, 920, 2761, 599, 1417, 7945, 8073,
	7642, 16186, 8890, 12858, 3913, 6362, 2746, 13882, 7866, 1080, 1273, 3400, 886, 3386, 1097, 11482, 15450,
	16282, 12506, 15578, 2377, 6858, 826, 330, 10010, 12042, 8009, 1928, 631, 3128, 3832, 6521, 1336, 2840, 217,
	5657, 121, 3865, 6553, 6426, 4666, 3017, 5193, 7994, 3320, 1287, 1991, 71, 536, 1304, 2057, 1801, 5081, 1594,
	11642, 14106, 6617, 10938, 7290, 13114, 4809, 2522, 5818, 14010, 7482, 5914, 7738, 9018, 3450, 11450, 5897,
	2697, 3193, 4185, 3769, 3464, 3897, 968, 6841, 6393, 2425, 775, 1048, 5369, 454, 648, 3033, 3145, 2440, 2297,
	200, 2872, 2136, 2248, 1144, 1944, 1431, 1031, 376, 408, 1208, 3608, 2616, 1848, 1784, 1671, 135, 1623, 502,
	663, 1223, 2007, 248, 2104, 24, 2168, 1656, 3704, 1400, 1864, 7353, 7241, 2073, 1241, 4889, 5690, 6153,
	15738, 698, 5210, 1722, 986, 12986, 3994, 3642, 9306, 4794, 794, 16058, 7066, 4425, 8090, 4922, 714, 11738,
	7194, 12762, 7450, 5001, 1562, 11834, 13402, 9914, 3290, 3258, 5338, 905, 15386, 9178, 15306, 3162, 15050,
	15930, 10650, 15674, 8522, 8250, 7114, 10714, 14362, 9786, 2266, 1352, 4153, 1496, 518, 151, 15482, 12410,
	2952, 7961, 8906, 1114, 58, 4570, 7258, 13530, 474, 9, 15258, 3546, 6170, 4314, 2970, 7386, 14666, 7130,
	6474, 14554, 5514, 15322, 3098, 15834, 3978, 3353, 2329, 2458, 12170, 570, 1818, 11578, 14618, 1175, 8986,
	4218, 9754, 8762, 392, 8282, 11290, 7546, 3850, 11354, 12298, 15642, 14986, 8666, 20491, 90, 13706, 12186,
	6794, 11162, 10458, 759, 582
];
const DEC = new Map(ENC.map((e, sym) => [(e & 15) << 11 | e >> 4, sym]));

const SVC = { nop: 1, gamestate: 2, configstring: 3, serverCommand: 5, snapshot: 7 };
const MAX_MSGLEN = 16384, MAX_RELIABLE_COMMANDS = 64;
// Playback freezes for as long as the server-time gap between two snapshots,
// so parts further apart than this get joined with a level reload instead.
const MAX_GAP_MS = 3000;

class Reader {
	constructor(data) { this.data = data; this.pos = 0; }
	bit() {
		if (this.pos >= this.data.length * 8) throw new Error('read past end of message');
		return this.data[this.pos >> 3] >> (this.pos++ & 7) & 1;
	}
	byte() {
		for (let len = 1, code = 0; len <= 11; len++) {
			code |= this.bit() << (len - 1);
			const sym = DEC.get(len << 11 | code);
			if (sym !== undefined) return sym;
		}
		throw new Error('bad Huffman code');
	}
	short() { return this.byte() | this.byte() << 8; }
	long() { return this.short() | this.short() << 16; }
	string() {
		let s = '';
		// same translation as MSG_ReadString
		for (let c; (c = this.byte());) s += c === 37 || c > 127 ? '.' : String.fromCharCode(c);
		return s;
	}
}

class Writer {
	constructor() { this.bytes = []; this.n = 0; }
	bit(b) {
		if (!(this.n & 7)) this.bytes.push(0);
		this.bytes[this.n >> 3] |= b << (this.n++ & 7);
	}
	byte(sym) { const e = ENC[sym]; for (let i = 0; i < (e & 15); i++) this.bit(e >> (4 + i) & 1); }
	short(v) { this.byte(v & 255); this.byte(v >> 8 & 255); }
	long(v) { this.short(v); this.short(v >> 16); }
	string(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); this.byte(0); }
	rest(r) { while (r.pos < r.data.length * 8) this.bit(r.bit()); }
}

function readDemo(buf) {
	const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), msgs = [];
	for (let p = 0; p + 8 <= buf.length;) {
		const seq = dv.getInt32(p, true), len = dv.getInt32(p + 4, true);
		if (len < 0 || p + 8 + len > buf.length) break; // terminator, or truncated file
		msgs.push({ seq, data: buf.subarray(p + 8, p + 8 + len) });
		p += 8 + len;
	}
	return msgs;
}

// Only what's needed to splice: server commands, gamestate configstrings, snapshot time.
// Baselines and snapshot contents stay opaque bits.
function parseMessage(data) {
	const r = new Reader(data), m = { cmds: [] };
	r.long(); // reliable acknowledge
	for (;;) {
		const op = r.byte();
		if (op === SVC.serverCommand) m.cmds.push([r.long(), r.string()]);
		else if (op === SVC.snapshot) { m.time = r.long(); break; }
		else if (op === SVC.gamestate) {
			const gs = m.gs = { cmdSeq: r.long(), cs: new Map() };
			let p;
			while (p = r.pos, r.byte() === SVC.configstring) setCs(gs.cs, r.short(), r.string());
			r.pos = p;
			// baselines + clientNum + checksumFeed (random per map load): identifies the game
			const w = new Writer();
			w.rest(r);
			gs.tail = w.bytes.join().replace(/(,0)+$/, '');
			break;
		} else if (op !== SVC.nop) break;
	}
	return m;
}

function setCs(cs, i, v) { v ? cs.set(i, v) : cs.delete(i); }

// Advance the client state the way playback would (CL_ParseCommandString, CL_GetServerCommand).
function apply(st, m) {
	for (const [seq, str] of m.cmds) {
		if (seq <= st.cmdSeq) continue;
		st.cmdSeq = seq;
		const a = [...str.matchAll(/"([^"]*)"?|(\S+)/g)].map(t => t[1] ?? t[2]);
		if (a[0] === 'cs') setCs(st.cs, +a[1], a.slice(2).join(' '));
		else if (a[0] === 'bcs0') st.big = a[2];
		else if (a[0] === 'bcs1') st.big += a[2];
		else if (a[0] === 'bcs2') setCs(st.cs, +a[1], st.big + a[2]);
	}
	if (m.gs) Object.assign(st, m.gs, { cs: new Map(m.gs.cs) });
	if (m.time !== undefined) st.time = m.time;
	st.msgSeq = m.seq;
}

// Try to continue from state `st` straight into the next demo's first snapshot,
// dropping its gamestate. Returns the (possibly rewritten) snapshot message,
// or a string saying why that can't be done.
function splice(st, [{ gs }, first]) {
	if (gs.tail !== st.tail) return 'different map or server session';
	if (first?.time === undefined) return 'no snapshot after the gamestate';
	if (gs.cmdSeq < st.cmdSeq || first.seq <= st.msgSeq) return 'not a later part of the same connection';
	const gap = first.time - st.time;
	if (!(gap >= 0 && gap <= MAX_GAP_MS)) return `${gap} ms gap`;

	// Server commands sent while nothing was recording are lost, and with them
	// configstring updates. Recreate those, as SV_SendConfigstring would.
	const cmds = [];
	for (const i of new Set([...st.cs.keys(), ...gs.cs.keys()])) {
		const v = gs.cs.get(i) ?? '';
		if (v === (st.cs.get(i) ?? '')) continue;
		if (v.length < 1000) cmds.push(`cs ${i} "${v}"`);
		else v.match(/[^]{1,999}/g).forEach((c, j, a) =>
			cmds.push(`bcs${j ? j < a.length - 1 ? 1 : 2 : 0} ${i} "${c}"`));
	}
	// cgame will ask for every sequence number in the gap that is still in the
	// client's ring buffer, and would get stale older commands there, so all
	// of those must be filled. `bcs1 0 ""` is swallowed by the engine: a no-op.
	const slots = Math.min(gs.cmdSeq - st.cmdSeq, MAX_RELIABLE_COMMANDS);
	if (cmds.length > slots) return 'too many configstring changes in the gap';
	if (!slots) return first;
	while (cmds.length < slots) cmds.unshift('bcs1 0 ""');

	const r = new Reader(first.data), w = new Writer();
	w.long(r.long());
	cmds.forEach((c, j) => {
		w.byte(SVC.serverCommand);
		w.long(gs.cmdSeq - slots + 1 + j);
		w.string(c);
	});
	w.rest(r);
	if (w.bytes.length > MAX_MSGLEN) return 'configstring changes too big for one message';
	const data = Uint8Array.from(w.bytes), m = { seq: first.seq, data, ...parseMessage(data) };

	const t = { ...st, cs: new Map(st.cs) };
	apply(t, m);
	if (t.cs.size !== gs.cs.size || [...gs.cs].some(([i, v]) => t.cs.get(i) !== v))
		return 'could not reproduce configstrings';
	return m;
}

// files: Uint8Array[] in playback order.
// Returns { data, joins }, joins[i] says how file i+1 was attached to file i.
function concat(files) {
	const out = [], joins = [];
	let st;
	files.forEach((file, i) => {
		let msgs = readDemo(file).map(m => ({ ...m, ...parseMessage(m.data) }));
		if (!msgs[0]?.gs) throw new Error(`file ${i + 1} is not a Quake III demo (no gamestate)`);
		if (st) {
			const res = splice(st, msgs);
			if (typeof res === 'string') joins.push(`level reload (${res})`); // gamestate kept
			else {
				joins.push('seamless');
				msgs = [res, ...msgs.slice(2)];
			}
		}
		st ??= {};
		for (const m of msgs) {
			apply(st, m);
			out.push(m);
		}
	});

	const data = new Uint8Array(out.reduce((n, m) => n + 8 + m.data.length, 8));
	const dv = new DataView(data.buffer);
	let p = 0;
	for (const m of out) {
		dv.setInt32(p, m.seq, true);
		dv.setInt32(p + 4, m.data.length, true);
		data.set(m.data, p + 8);
		p += 8 + m.data.length;
	}
	dv.setInt32(p, -1, true);
	dv.setInt32(p + 4, -1, true);
	return { data, joins };
}

if (typeof module !== 'undefined') module.exports = { concat, readDemo, parseMessage, apply, Reader, Writer, SVC };
