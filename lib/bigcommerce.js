import axios from 'axios';

// Standard BigCommerce REST API (orders, customers etc)
export const bcAPI = (storeHash, accessToken) => {
  return axios.create({
    baseURL: `https://api.bigcommerce.com/stores/${storeHash}`,
    headers: {
      'X-Auth-Token': accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
};

// B2B Edition API — requires both X-Auth-Token and X-Store-Hash headers
export const b2bAPI = (storeHash, accessToken) => {
  return axios.create({
    baseURL: `https://api-b2b.bigcommerce.com/api/v3/io`,
    headers: {
      'X-Auth-Token': accessToken,
      'X-Store-Hash': storeHash,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });
};

// Get credentials from env vars — no database needed
export const getStoreCredentials = () => {
  const storeHash = process.env.BC_STORE_HASH;
  const accessToken = process.env.BC_ACCESS_TOKEN;
  if (!storeHash || !accessToken) throw new Error('BC_STORE_HASH and BC_ACCESS_TOKEN must be set in .env.local');
  return { storeHash, accessToken };
};
