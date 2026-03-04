import pg from 'pg';

const { Pool } = pg;

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      }
    : {
        host: 'localhost',
        port: 5432,
        database: 'docmind',
        user: 'postgres',
        password: 'docmind',
      }
);

export const query = async (text: string, params?: any[]) => {
  const result = await pool.query(text, params);
  return result;
};

export default pool;