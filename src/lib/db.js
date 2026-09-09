'use strict';
const { Pool } = require('pg');

// Single shared connection pool for the whole app.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10,
});

// Simple query helper.
async function query(text, params) {
  return pool.query(text, params);
}

// Run a function inside a DB transaction. Used for atomic wallet-style deducts
// and for the "verify + mark paid" step so partial writes can never happen.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
