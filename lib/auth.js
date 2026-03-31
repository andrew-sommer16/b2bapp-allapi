// ─── Env-var based auth — no database required ────────────────────────────────
// Users are defined in .env.local as:
//   USER_1_EMAIL, USER_1_PASSWORD, USER_1_ROLE, USER_1_FIRST_NAME, USER_1_LAST_NAME, USER_1_BC_REP_ID
//   USER_2_EMAIL, USER_2_PASSWORD, ...

import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'change-this-secret-in-production'
);
const JWT_EXPIRY = '7d';

// ─── Load all users from env vars ─────────────────────────────────────────────
export function getUsers() {
  const users = [];
  let i = 1;
  while (true) {
    const email = process.env[`USER_${i}_EMAIL`];
    if (!email) break;
    users.push({
      id: String(i),
      email: email.toLowerCase(),
      password: process.env[`USER_${i}_PASSWORD`] || '',
      role: process.env[`USER_${i}_ROLE`] || 'user',
      first_name: process.env[`USER_${i}_FIRST_NAME`] || '',
      last_name: process.env[`USER_${i}_LAST_NAME`] || '',
      bc_rep_id: process.env[`USER_${i}_BC_REP_ID`] || null,
      store_hash: process.env.BC_STORE_HASH || '',
    });
    i++;
  }
  return users;
}

// ─── Find user by email + password ────────────────────────────────────────────
export function findUser(email, password) {
  const users = getUsers();
  return users.find(
    u => u.email === email.toLowerCase() && u.password === password
  ) || null;
}

// ─── Sign a JWT for a user ─────────────────────────────────────────────────────
export async function signToken(user) {
  return new SignJWT({
    id: user.id,
    email: user.email,
    role: user.role,
    store_hash: user.store_hash,
    first_name: user.first_name,
    last_name: user.last_name,
    bc_rep_id: user.bc_rep_id,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

// ─── Verify a JWT and return its payload ──────────────────────────────────────
export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch {
    return null;
  }
}
