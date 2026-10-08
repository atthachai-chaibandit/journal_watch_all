export const GOOGLE_CLIENT_ID = '1063137162810-shg6ei3t1rdur18vfmc5il0ip4jseu60.apps.googleusercontent.com';

// Cloudflare Turnstile (site key เป็นค่าสาธารณะ ใส่ฝั่ง frontend ได้ — secret key อยู่ที่ backend เท่านั้น)
// ผูก hostname ไว้ที่ dashboard ของ Cloudflare ตอนนี้มี localhost แล้ว — deploy โดเมนจริงต้องเพิ่ม hostname ที่นั่นด้วย
// Test key (ผ่านเสมอ ใช้ทดสอบ): '1x00000000000000000000AA'
export const TURNSTILE_SITE_KEY = '0x4AAAAAACG1gENgXRjyMNW2';
