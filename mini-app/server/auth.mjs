import { createHmac, timingSafeEqual } from 'node:crypto';

// Verify Telegram Mini App initData per the WebApp spec.
// secret_key = HMAC_SHA256(key="WebAppData", msg=botToken)
// expected   = HMAC_SHA256(key=secret_key, msg=data_check_string) (hex)
export function verifyInitData(initDataRaw, botToken, maxAgeSec = 86400) {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) throw new Error('missing hash');

  const pairs = [...params.entries()]
    .filter(([k]) => k !== 'hash')
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const dataCheckString = pairs.join('\n');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid hash');

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || (Date.now() / 1000 - authDate) > maxAgeSec) throw new Error('initData expired');

  const userRaw = params.get('user');
  return { user: userRaw ? JSON.parse(userRaw) : null, authDate };
}
