import pool from './db.ts';

const migrate = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(255) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        filepath VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        message TEXT DEFAULT 'Document is queued for processing',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Migration complete — documents table ready');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
};

migrate();