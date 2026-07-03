const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_T74cdWsOunVR@ep-floral-leaf-atar110d.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require'
});

// 🔥 TAMBAHAN BARU: Penangkal Error saat Neon "Tidur"
pool.on('error', (err) => {
    console.error('Koneksi database terputus atau Neon sedang tidur:', err.message);
});

pool.connect()
    .then(() => console.log('Sukses terhubung ke PostgreSQL!'))
    .catch(err => console.error('Gagal koneksi ke database:', err.stack));

module.exports = pool;