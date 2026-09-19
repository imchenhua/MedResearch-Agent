#!/usr/bin/env node
/**
 * MedResearch Agent — Account & License API
 * 零外部依赖。存储为 JSON 文件 + 原子写（Node 单线程，同步写无竞态）。
 * 认证基于 Node 内置 crypto（scrypt + HS256 JWT，手写实现）。
 *
 * 环境变量：
 *   ACCOUNT_PORT          默认 8789
 *   ACCOUNT_HOST          默认 127.0.0.1
 *   ACCOUNT_DATA_DIR      默认 <dirname>/data
 *   ACCOUNT_JWT_SECRET    可选，缺失则自动生成到 data/jwt.secret
 *   ACCOUNT_ALLOW_ORIGIN  CORS 来源，默认 *
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ACCOUNT_PORT || 8789);
const HOST = process.env.ACCOUNT_HOST || '127.0.0.1';
const DATA_DIR = process.env.ACCOUNT_DATA_DIR || path.join(__dirname, 'data');
const ALLOW_ORIGIN = process.env.ACCOUNT_ALLOW_ORIGIN || '*';
const ACCESS_TTL = 60 * 60 * 2;
const REFRESH_TTL = 60 * 60 * 24 * 30;
const MAX_BODY = 64 * 1024;
const DB_FILE = path.join(DATA_DIR, 'account.json');

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

// ---------- secret ----------
const JWT_SECRET = (() => {
	if (process.env.ACCOUNT_JWT_SECRET) return process.env.ACCOUNT_JWT_SECRET;
	const p = path.join(DATA_DIR, 'jwt.secret');
	if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
	const s = crypto.randomBytes(48).toString('base64url');
	fs.writeFileSync(p, s, { mode: 0o600 });
	console.log('[account] generated JWT secret at', p);
	return s;
})();

// ---------- store (JSON + atomic write) ----------
const store = {
	users: {},
	tokens: {},
	usage: [],
	codes: {},
};

function loadStore() {
	if (!fs.existsSync(DB_FILE)) return;
	try {
		const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
		if (raw && typeof raw === 'object') {
			Object.assign(store, {
				users: raw.users || {},
				tokens: raw.tokens || {},
				usage: Array.isArray(raw.usage) ? raw.usage : [],
				codes: raw.codes || {},
			});
		}
	} catch (e) {
		console.error('[account] failed to parse data file, starting empty:', e.message);
	}
}
function saveStore() {
	const tmp = `${DB_FILE}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
	fs.renameSync(tmp, DB_FILE);
}
loadStore();

// ---------- crypto ----------
const now = () => Date.now();
const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
function verifyPassword(pw, salt, expected) {
	const a = Buffer.from(hashPassword(pw, salt), 'hex');
	const b = Buffer.from(expected, 'hex');
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function signJwt(payload, ttlSec) {
	const t = Math.floor(now() / 1000);
	const p1 = b64({ alg: 'HS256', typ: 'JWT' });
	const p2 = b64({ ...payload, iat: t, exp: t + ttlSec });
	const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${p1}.${p2}`).digest('base64url');
	return `${p1}.${p2}.${sig}`;
}
function verifyJwt(token) {
	try {
		const [p1, p2, sig] = String(token).split('.');
		if (!p1 || !p2 || !sig) return null;
		const want = crypto.createHmac('sha256', JWT_SECRET).update(`${p1}.${p2}`).digest('base64url');
		const a = Buffer.from(sig);
		const b = Buffer.from(want);
		if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
		const body = JSON.parse(Buffer.from(p2, 'base64url').toString('utf8'));
		if (typeof body.exp !== 'number' || body.exp * 1000 < now()) return null;
		return body;
	} catch {
		return null;
	}
}

// ---------- validation / helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const validateEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);
const validatePassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128;

function publicUser(u) {
	return {
		id: u.id,
		email: u.email,
		plan: u.plan || 'free',
		planExpiresAt: u.planExpiresAt ?? null,
		createdAt: u.createdAt,
		lastLoginAt: u.lastLoginAt ?? null,
	};
}

// purge expired tokens / old usage occasionally
function gc() {
	const t = now();
	let changed = false;
	for (const [id, tk] of Object.entries(store.tokens)) {
		if (tk.revoked || tk.expiresAt < t) {
			delete store.tokens[id];
			changed = true;
		}
	}
	if (store.usage.length > 20000) {
		store.usage = store.usage.slice(-10000);
		changed = true;
	}
	if (changed) saveStore();
}
setInterval(gc, 3600_000).unref();

// ---------- rate limit ----------
const buckets = new Map();
function rateLimit(ip, key, limit, windowMs) {
	const k = `${ip}|${key}`;
	const t = now();
	let b = buckets.get(k);
	if (!b || t - b.start > windowMs) {
		b = { start: t, count: 0 };
		buckets.set(k, b);
	}
	b.count += 1;
	return b.count <= limit;
}

// ---------- http helpers ----------
function corsHeaders() {
	return {
		'Access-Control-Allow-Origin': ALLOW_ORIGIN,
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	};
}
function send(res, code, obj) {
	res.writeHead(code, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
		...corsHeaders(),
	});
	res.end(JSON.stringify(obj));
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		let buf = '';
		let size = 0;
		req.on('data', (c) => {
			size += c.length;
			if (size > MAX_BODY) {
				req.destroy();
				return reject(new Error('body_too_large'));
			}
			buf += c;
		});
		req.on('end', () => {
			if (!buf) return resolve({});
			try {
				resolve(JSON.parse(buf));
			} catch {
				reject(new Error('bad_json'));
			}
		});
		req.on('error', reject);
	});
}
function clientIp(req) {
	const xff = req.headers['x-forwarded-for'];
	if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
	return req.socket.remoteAddress || 'unknown';
}
function issueTokens(user) {
	const jti = crypto.randomUUID();
	const access = signJwt({ sub: user.id, jti, typ: 'access' }, ACCESS_TTL);
	const refresh = crypto.randomBytes(40).toString('base64url');
	store.tokens[jti] = {
		userId: user.id,
		hash: sha256(refresh),
		expiresAt: now() + REFRESH_TTL * 1000,
		createdAt: now(),
		revoked: false,
	};
	saveStore();
	return { accessToken: access, refreshToken: `${jti}.${refresh}`, expiresIn: ACCESS_TTL };
}

// ---------- routes ----------
const routes = {
	'POST /v1/auth/register': (req, res, ctx) => {
		if (!rateLimit(ctx.ip, 'register', 10, 3600_000)) return send(res, 429, { ok: false, error: 'rate_limited' });
		const { email, password } = ctx.body;
		if (!validateEmail(email)) return send(res, 400, { ok: false, error: 'invalid_email' });
		if (!validatePassword(password))
			return send(res, 400, { ok: false, error: 'weak_password', message: '密码需 8-128 位' });
		const normalized = String(email).trim().toLowerCase();
		if (Object.values(store.users).some((u) => u.email === normalized))
			return send(res, 409, { ok: false, error: 'email_taken' });

		const salt = crypto.randomBytes(16).toString('hex');
		const id = crypto.randomUUID();
		store.users[id] = {
			id,
			email: normalized,
			passwordHash: hashPassword(password, salt),
			salt,
			plan: 'free',
			planExpiresAt: null,
			createdAt: now(),
			lastLoginAt: null,
			disabled: false,
		};
		saveStore();
		const user = store.users[id];
		return send(res, 201, { ok: true, user: publicUser(user), ...issueTokens(user) });
	},

	'POST /v1/auth/login': (req, res, ctx) => {
		if (!rateLimit(ctx.ip, 'login', 20, 900_000)) return send(res, 429, { ok: false, error: 'rate_limited' });
		const { email, password } = ctx.body;
		if (!validateEmail(email) || typeof password !== 'string')
			return send(res, 401, { ok: false, error: 'invalid_credentials' });
		const normalized = String(email).trim().toLowerCase();
		const user = Object.values(store.users).find((u) => u.email === normalized);
		if (!user || user.disabled) return send(res, 401, { ok: false, error: 'invalid_credentials' });
		if (!verifyPassword(password, user.salt, user.passwordHash))
			return send(res, 401, { ok: false, error: 'invalid_credentials' });
		user.lastLoginAt = now();
		saveStore();
		return send(res, 200, { ok: true, user: publicUser(user), ...issueTokens(user) });
	},

	'POST /v1/auth/refresh': (req, res, ctx) => {
		const raw = String(ctx.body.refreshToken || '');
		const [jti, secret] = raw.split('.');
		if (!jti || !secret) return send(res, 400, { ok: false, error: 'invalid_token' });
		const rec = store.tokens[jti];
		if (!rec || rec.revoked || rec.expiresAt < now()) return send(res, 401, { ok: false, error: 'invalid_token' });
		if (rec.hash !== sha256(secret)) return send(res, 401, { ok: false, error: 'invalid_token' });
		const user = store.users[rec.userId];
		if (!user || user.disabled) return send(res, 401, { ok: false, error: 'invalid_token' });
		rec.revoked = true; // rotate
		return send(res, 200, { ok: true, ...issueTokens(user) });
	},

	'POST /v1/auth/logout': (req, res, ctx) => {
		const jti = String(ctx.body.refreshToken || '').split('.')[0];
		if (jti && store.tokens[jti]) {
			store.tokens[jti].revoked = true;
			saveStore();
		}
		return send(res, 200, { ok: true });
	},

	'GET /v1/me': (req, res, ctx) => {
		if (!ctx.user) return send(res, 401, { ok: false, error: 'unauthorized' });
		return send(res, 200, { ok: true, user: publicUser(ctx.user) });
	},

	'POST /v1/usage': (req, res, ctx) => {
		if (!ctx.user) return send(res, 401, { ok: false, error: 'unauthorized' });
		const kind = String(ctx.body.kind || '').slice(0, 64);
		if (!kind) return send(res, 400, { ok: false, error: 'missing_kind' });
		const amount = Number.isFinite(ctx.body.amount) ? Math.max(1, Math.floor(ctx.body.amount)) : 1;
		store.usage.push({ userId: ctx.user.id, kind, amount, at: now() });
		saveStore();
		return send(res, 200, { ok: true });
	},

	'GET /v1/usage/summary': (req, res, ctx) => {
		if (!ctx.user) return send(res, 401, { ok: false, error: 'unauthorized' });
		const since = now() - 30 * 24 * 3600 * 1000;
		const agg = {};
		for (const e of store.usage) {
			if (e.userId !== ctx.user.id || e.at < since) continue;
			agg[e.kind] = (agg[e.kind] || 0) + e.amount;
		}
		return send(res, 200, {
			ok: true,
			since,
			items: Object.entries(agg).map(([kind, total]) => ({ kind, total })),
		});
	},

	// 兼容原 license-api 的授权码激活
	'POST /v1/activate': (req, res, ctx) => {
		if (!rateLimit(ctx.ip, 'activate', 20, 3600_000)) return send(res, 429, { ok: false, error: 'rate_limited' });
		const code = String(ctx.body.key || '').trim();
		if (!code) return send(res, 200, { ok: false, error: 'invalid_or_used' });
		const row = store.codes[code];
		if (!row) return send(res, 200, { ok: false, error: 'invalid_or_used' });
		if (row.expiresAt && row.expiresAt < now()) return send(res, 200, { ok: false, error: 'expired' });

		const out = { ok: true, plan: row.plan || 'pro' };
		if (ctx.user) {
			const exp = row.durationDays ? now() + row.durationDays * 86400_000 : row.expiresAt || null;
			ctx.user.plan = row.plan || 'pro';
			ctx.user.planExpiresAt = exp;
			row.redeemedBy = ctx.user.id;
			row.redeemedAt = now();
			saveStore();
			out.planExpiresAt = exp;
		}
		return send(res, 200, out);
	},

	'GET /v1/health': (req, res) =>
		send(res, 200, {
			ok: true,
			service: 'medresearch-account',
			users: Object.keys(store.users).length,
			uptime: Math.floor(process.uptime()),
		}),
};

// ---------- server ----------
const server = http.createServer(async (req, res) => {
	let url;
	try {
		url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
	} catch {
		return send(res, 400, { ok: false, error: 'bad_url' });
	}

	if (req.method === 'OPTIONS') {
		res.writeHead(204, { ...corsHeaders(), 'Access-Control-Max-Age': '86400' });
		return res.end();
	}

	const handler = routes[`${req.method} ${url.pathname}`];
	if (!handler) return send(res, 404, { ok: false, error: 'not_found' });

	let body = {};
	try {
		body = await readBody(req);
	} catch (e) {
		return send(res, e.message === 'body_too_large' ? 413 : 400, { ok: false, error: e.message });
	}

	let user = null;
	const auth = req.headers.authorization;
	if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
		const payload = verifyJwt(auth.slice(7).trim());
		if (payload?.sub) {
			const u = store.users[payload.sub];
			if (u && !u.disabled) user = u;
		}
	}

	try {
		handler(req, res, { body, ip: clientIp(req), user });
	} catch (err) {
		console.error('[account] handler error:', err);
		if (!res.headersSent) send(res, 500, { ok: false, error: 'internal_error' });
	}
});

server.listen(PORT, HOST, () => {
	console.log(`[account] listening http://${HOST}:${PORT}`);
	console.log(`[account] data file: ${DB_FILE}`);
	console.log(`[account] users loaded: ${Object.keys(store.users).length}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
	process.on(sig, () => {
		console.log('[account] shutting down…');
		try {
			saveStore();
		} catch {
			/* ignore */
		}
		server.close(() => process.exit(0));
	});
}
