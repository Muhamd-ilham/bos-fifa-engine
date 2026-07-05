const { Pool } = require('pg');

const pool = new Pool({
    // 👇 Ini sudah diganti pakai jalur satelit ke Neon.tech
    connectionString: 'postgresql://neondb_owner:npg_T74cdWsOunVR@ep-floral-leaf-atar110d-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
});

// Penangkal error kalau database Neon lagi "tidur"
pool.on('error', (err) => {
    console.error('Koneksi database terputus atau Neon sedang tidur:', err.message);
});

pool.connect()
    .then(() => console.log('🔥 Sukses terhubung ke PostgreSQL (Neon Cloud)!'))
    .catch(err => console.error('Gagal koneksi ke database:', err.stack));

module.exports = pool;
