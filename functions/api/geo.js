// 书库天气定位：读取 Cloudflare request.cf 的城市和经纬度，只返回非敏感字段。
// 由 _middleware 公开路由放行，无需登录。
export async function onRequest(context) {
  const cf = context.request.cf || {};
  return Response.json({
    city: cf.city || null,
    latitude: cf.latitude || null,
    longitude: cf.longitude || null,
    timezone: cf.timezone || null,
  });
}
