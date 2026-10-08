// functions/api/_access.js
// Cloudflare Access JWT 校验：请求头 Cf-Access-Jwt-Assertion，RS256 / WebCrypto。
// 每个 /api/private/* 与 /api/admin/* 的 handler 入口先调 requireAccess(context)。
// 下划线开头，不会被 Pages 当作路由。

import { err } from './_lib.js';

const JWKS_TTL_MS = 10 * 60 * 1000; // JWKS 缓存 10 分钟（模块级变量）
let jwksCache = { keys: [], fetchedAt: 0 };

function b64urlToBytes(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
}

async function getJwks(teamDomain) {
  const now = Date.now();
  if (jwksCache.keys.length && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('jwks fetch failed');
  const data = await res.json();
  jwksCache = {
    keys: Array.isArray(data.keys) ? data.keys : [],
    fetchedAt: now,
  };
  return jwksCache.keys;
}

function unauthorized(message = 'unauthorized') {
  const e = new Error(message);
  e.status = 401;
  return e;
}

// 校验成功返回 claims（含 email）；失败抛出带 status 的 Error。
// 注：这里只验证签名 + exp。aud（Access 应用的 audience tag）不强校验——
// audience 限定应在 Access policy 层面完成（policy 只放行本应用）。
// 如需更严，可在此对比 claims.aud 与应用的 audience tag。
export async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw unauthorized();

  const teamDomain = env.ACCESS_TEAM_DOMAIN;
  if (!teamDomain) {
    const e = new Error('access team domain not configured');
    e.status = 500;
    throw e;
  }

  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('malformed token');

  let header;
  let claims;
  try {
    header = b64urlToJson(parts[0]);
    claims = b64urlToJson(parts[1]);
  } catch {
    throw unauthorized('malformed token');
  }

  const keys = await getJwks(teamDomain);
  const jwk = keys.find((k) => k.kid && k.kid === header.kid);
  if (!jwk) throw unauthorized('unknown kid');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const signature = b64urlToBytes(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  if (!valid) throw unauthorized('bad signature');

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp < nowSec) {
    throw unauthorized('token expired');
  }

  return claims;
}

// handler 入口包装：成功返回 { claims }，失败返回 { response }（handler 直接 return response 即可）
export async function requireAccess(context) {
  try {
    const claims = await verifyAccess(context.request, context.env);
    return { claims };
  } catch (e) {
    return { response: err(e.message || 'unauthorized', e.status || 401) };
  }
}
