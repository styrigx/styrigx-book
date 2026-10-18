// 测试用的「鉴权网关」替身：实现 env.AUTH 的 RPC 接口（session / appPass / appEpoch），
// 规则与真网关（styrigx-space 仓库 workers/auth-gateway/src/verifier.js）一致：
//   会话 sgx-verified = by.role.epoch.exp.sig（Ed25519，by ∈ root|owner，role ∈ owner|visitor，未过期，epoch 不低于当前）
//   通行证 sgx-app = owner.epoch.appEpoch.iat.exp.aud.scope.sig（验签 + aud/scope + 未过期 + epoch/appEpoch 不低于当前）
// 当前 epoch / appEpoch 从 globalThis.fetch 桩读（沿用各测试原来对主站 /api/session-epoch 的桩），
// 桩抛错或缺值 → 一律拒绝（fail closed），与真网关读 KV 出错时一致。
// 用法：env 字面量里写 `get AUTH() { return fakeGateway(this); }`，公钥取 env.SGX_LOCK_PUBLIC / env.SGX_APP_PUBLIC。
import { createPublicKey, verify } from 'node:crypto';

function keyFrom(pemOrB64) {
  const b64 = String(pemOrB64 || '')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
}

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function ok(pub, payload, sig) {
  try {
    const raw = b64urlToBuf(sig);
    if (raw.length !== 64) return false;
    return verify(null, Buffer.from(payload), keyFrom(pub), raw);
  } catch (e) {
    return false;
  }
}

function cookies(header, name) {
  const out = [];
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) out.push(decodeURIComponent(part.slice(i + 1).trim()));
  }
  return out;
}

async function epochs() {
  const r = await globalThis.fetch('https://styrigx.com/api/session-epoch');
  if (!r || !r.ok) throw new Error('epoch');
  const d = await r.json();
  if (!d || !Number.isFinite(d.epoch)) throw new Error('epoch');
  return { epoch: d.epoch, app: (d.app && d.app.book) };
}

/** @param {{ SGX_LOCK_PUBLIC?: string, SGX_APP_PUBLIC?: string }} env */
export function fakeGateway(env) {
  return {
    calls: [],
    async session(cookieHeader) {
      const vals = cookies(cookieHeader, 'sgx-verified');
      if (!vals.length) return { ok: false, reason: 'no-cookie' };
      let cur;
      try { cur = (await epochs()).epoch; } catch (e) { return { ok: false, reason: 'kv-error' }; }
      for (const v of vals) {
        const p = v.split('.');
        if (p.length !== 5) continue;
        const [by, role, ep, exp, sig] = p;
        if (by !== 'root' && by !== 'owner') continue;
        if (role !== 'owner' && role !== 'visitor') continue;
        if (!(Number(exp) > Date.now())) continue;
        if (!ok(env.SGX_LOCK_PUBLIC, [by, role, ep, exp].join('.'), sig)) continue;
        if (Number(ep) < cur) continue;
        return { ok: true, role };
      }
      return { ok: false, reason: 'bad-sig' };
    },
    async appPass(cookieHeader, aud, scope) {
      const vals = cookies(cookieHeader, 'sgx-app');
      if (!vals.length) return { ok: false, reason: 'no-pass' };
      let e;
      try { e = await epochs(); } catch (err) { return { ok: false, reason: 'kv-error' }; }
      if (!Number.isFinite(e.app)) return { ok: false, reason: 'kv-error' };
      for (const v of vals) {
        const p = v.split('.');
        if (p.length !== 8 || p[0] !== 'owner') continue;
        const [, ep, appEp, , exp, a, s, sig] = p;
        if (a !== aud || s !== scope) continue;
        if (!(Number(exp) > Date.now())) continue;
        if (!ok(env.SGX_APP_PUBLIC, p.slice(0, 7).join('.'), sig)) continue;
        if (Number(ep) < e.epoch || Number(appEp) < e.app) continue;
        return { ok: true, appEpoch: Number(appEp), exp: Number(exp) };
      }
      return { ok: false, reason: 'bad-sig' };
    },
    async appEpoch(aud) {
      if (aud !== 'book') return { ok: false, reason: 'bad-request' };
      try {
        const e = await epochs();
        return Number.isFinite(e.app) ? { ok: true, appEpoch: e.app } : { ok: false, reason: 'kv-error' };
      } catch (err) {
        return { ok: false, reason: 'kv-error' };
      }
    },
  };
}
