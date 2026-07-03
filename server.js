const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Bos FIFA Engine API is running dengan PostgreSQL!');
});

function poissonRandom(lambda) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
        k++;
        p *= Math.random();
    } while (p > L);
    return k - 1;
}

// Simulasi per-menit: generate timeline kejadian pertandingan (90 menit + extra time)
function simulateFullMatch(home, away) {
    const BASE_GOALS = 1.35;
    const homeAttackPower = Math.pow(home.att, 1.5);
    const awayDefensePower = Math.pow(away.def, 1.5);
    const awayAttackPower = Math.pow(away.att, 1.5);
    const homeDefensePower = Math.pow(home.def, 1.5);

    const homeLambda = BASE_GOALS * (homeAttackPower / awayDefensePower) * (home.ovr / away.ovr);
    const awayLambda = BASE_GOALS * (awayAttackPower / homeDefensePower) * (away.ovr / home.ovr);

    const totalHomeGoals = poissonRandom(homeLambda);
    const totalAwayGoals = poissonRandom(awayLambda);

    const events = [];
    let homeScore = 0;
    let awayScore = 0;

    // Sebar gol home & away secara acak sepanjang menit 1-90 (+ extra time 90-95)
    const homeGoalMinutes = generateGoalMinutes(totalHomeGoals);
    const awayGoalMinutes = generateGoalMinutes(totalAwayGoals);

    // Generate kejadian tambahan biar berasa "real match": peluang, kartu, cedera
    const totalChances = Math.floor((homeLambda + awayLambda) * 3); // makin kuat serangan, makin banyak peluang
    const chanceMinutes = new Set();
    while (chanceMinutes.size < totalChances) {
        chanceMinutes.add(1 + Math.floor(Math.random() * 95));
    }

    const cardMinutes = [];
    const cardCount = Math.floor(Math.random() * 5); // 0-4 kartu per pertandingan
    for (let i = 0; i < cardCount; i++) {
        cardMinutes.push(1 + Math.floor(Math.random() * 95));
    }

    // Gabungkan semua kejadian jadi satu timeline terurut per menit
    for (let minute = 1; minute <= 95; minute++) {
        if (homeGoalMinutes.includes(minute)) {
            homeScore++;
            events.push({ minute, type: 'GOAL', team: 'HOME', score: `${homeScore}-${awayScore}` });
        }
        if (awayGoalMinutes.includes(minute)) {
            awayScore++;
            events.push({ minute, type: 'GOAL', team: 'AWAY', score: `${homeScore}-${awayScore}` });
        }
        if (chanceMinutes.has(minute) && !homeGoalMinutes.includes(minute) && !awayGoalMinutes.includes(minute)) {
            const chanceTeam = Math.random() < (homeLambda / (homeLambda + awayLambda)) ? 'HOME' : 'AWAY';
            const chanceType = Math.random() < 0.5 ? 'PELUANG_EMAS' : 'TENDANGAN_MELENCENG';
            events.push({ minute, type: chanceType, team: chanceTeam });
        }
        if (cardMinutes.includes(minute)) {
            const cardTeam = Math.random() < 0.5 ? 'HOME' : 'AWAY';
            const cardType = Math.random() < 0.85 ? 'KARTU_KUNING' : 'KARTU_MERAH';
            events.push({ minute, type: cardType, team: cardTeam });
        }
    }

    // Sisipkan kick-off dan full-time markers
    events.unshift({ minute: 0, type: 'KICK_OFF', team: null, score: '0-0' });
    events.push({ minute: 95, type: 'FULL_TIME', team: null, score: `${homeScore}-${awayScore}` });

    // Urutkan berdasarkan menit (kick-off dan full-time udah di posisi awal/akhir yang benar)
    events.sort((a, b) => a.minute - b.minute);

    return {
        finalHomeScore: homeScore,
        finalAwayScore: awayScore,
        timeline: events,
        lambdas: { home: homeLambda.toFixed(2), away: awayLambda.toFixed(2) }
    };
}

// Helper: sebar N gol ke menit-menit acak (1-95), gak boleh dobel menit yang sama
function generateGoalMinutes(count) {
    const minutes = new Set();
    while (minutes.size < count) {
        minutes.add(1 + Math.floor(Math.random() * 95));
    }
    return Array.from(minutes);
}

app.post('/api/matches/simulate/:id', async (req, res) => {
    try {
        const matchId = req.params.id;

        const matchRes = await pool.query("SELECT home_team_id, away_team_id FROM matches WHERE id = $1", [matchId]);
        const match = matchRes.rows[0];

        if (!match) return res.status(404).json({ message: "Pertandingan tidak ditemukan!" });

        const strengthQuery = `
            WITH ranked_players AS (
                SELECT 
                    club_id, 
                    overall_rating, 
                    shooting, 
                    passing, 
                    defending,
                    ROW_NUMBER() OVER(PARTITION BY club_id ORDER BY overall_rating DESC) as rn
                FROM players 
                WHERE club_id IN ($1, $2)
            )
            SELECT 
                club_id, 
                AVG(overall_rating) as team_ovr,
                AVG(shooting + passing) / 2 as team_attack,
                AVG(defending) as team_defense
            FROM ranked_players 
            WHERE rn <= 11
            GROUP BY club_id
        `;
        
        const strengthRes = await pool.query(strengthQuery, [match.home_team_id, match.away_team_id]);

        let home = { ovr: 70, att: 70, def: 70 };
        let away = { ovr: 70, att: 70, def: 70 };

        strengthRes.rows.forEach(row => {
            if (row.club_id === match.home_team_id) {
                home.ovr = parseFloat(row.team_ovr);
                home.att = parseFloat(row.team_attack);
                home.def = parseFloat(row.team_defense);
            }
            if (row.club_id === match.away_team_id) {
                away.ovr = parseFloat(row.team_ovr);
                away.att = parseFloat(row.team_attack);
                away.def = parseFloat(row.team_defense);
            }
        });

        home.att += 3;
        home.def += 2;

        // Simulasi full match dengan timeline per-menit
        const matchResult = simulateFullMatch(home, away);

        const updateQuery = `
            UPDATE matches 
            SET home_score = $1, away_score = $2, status = 'FINISHED' 
            WHERE id = $3 RETURNING *
        `;
        const result = await pool.query(updateQuery, [matchResult.finalHomeScore, matchResult.finalAwayScore, matchId]);
        
        res.json({ 
            message: `Peluit panjang! Skor akhir ${matchResult.finalHomeScore}-${matchResult.finalAwayScore}.`, 
            result: result.rows[0],
            timeline: matchResult.timeline,
            debug_stats: { 
                home_calculated: home, 
                away_calculated: away,
                home_lambda: matchResult.lambdas.home,
                away_lambda: matchResult.lambdas.away
            }
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


app.get('/api/leagues', async (req, res) => {
    try {
        const query = `
            SELECT l.id, l.name, COUNT(c.id) as total_clubs 
            FROM leagues l 
            JOIN clubs c ON l.id = c.league_id 
            GROUP BY l.id, l.name 
            HAVING COUNT(c.id) > 10 
            ORDER BY total_clubs DESC 
            LIMIT 10
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

app.get('/api/players/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const query = `
            SELECT p.name, p.position, p.overall_rating, c.name AS club 
            FROM players p
            JOIN clubs c ON p.club_id = c.id
            WHERE c.league_id = $1
            ORDER BY p.overall_rating DESC
            LIMIT 20
        `;
        const result = await pool.query(query, [leagueId]);
        res.json(result.rows);
    } catch (err) { res.status(500).send('Server Error'); }
});

app.get('/api/standings/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const query = `
            SELECT * FROM (
                SELECT 
                    c.name AS club,
                    COUNT(m.id) AS played,
                    COALESCE(SUM(CASE WHEN (m.home_team_id = c.id AND m.home_score > m.away_score) OR (m.away_team_id = c.id AND m.away_score > m.home_score) THEN 1 ELSE 0 END), 0) AS won,
                    COALESCE(SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END), 0) AS drawn,
                    COALESCE(SUM(CASE WHEN (m.home_team_id = c.id AND m.home_score < m.away_score) OR (m.away_team_id = c.id AND m.away_score < m.home_score) THEN 1 ELSE 0 END), 0) AS lost,
                    COALESCE(SUM(CASE WHEN m.home_team_id = c.id THEN m.home_score ELSE m.away_score END), 0) AS goals_for,
                    COALESCE(SUM(CASE WHEN m.home_team_id = c.id THEN m.away_score ELSE m.home_score END), 0) AS goals_against,
                    COALESCE(SUM(CASE WHEN (m.home_team_id = c.id AND m.home_score > m.away_score) OR (m.away_team_id = c.id AND m.away_score > m.home_score) THEN 3 
                             WHEN m.home_score = m.away_score THEN 1 ELSE 0 END), 0) AS points
                FROM clubs c
                LEFT JOIN matches m ON (c.id = m.home_team_id OR c.id = m.away_team_id) AND m.status = 'FINISHED'
                WHERE c.league_id = $1
                GROUP BY c.id, c.name
            ) sub
            ORDER BY points DESC, (goals_for - goals_against) DESC, goals_for DESC;
        `;
        const result = await pool.query(query, [leagueId]);
        res.json(result.rows);
    } catch (err) { 
        console.error(err.message);
        res.status(500).send('Server Error'); 
    }
});

// 1. Endpoint: Tarik Jadwal Pertandingan (Tampilkan Semua dengan Pekan)
app.get('/api/matches/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const query = `
            SELECT m.id, h.name AS home_team, a.name AS away_team, 
                   m.home_score, m.away_score, m.status, m.matchday 
            FROM matches m
            JOIN clubs h ON m.home_team_id = h.id
            JOIN clubs a ON m.away_team_id = a.id
            WHERE h.league_id = $1
            ORDER BY m.matchday ASC, m.id ASC
        `;
        // Catatan: LIMIT 50 dihapus agar semua 380 pertandingan (38 Pekan) muncul
        const result = await pool.query(query, [leagueId]);
        res.json(result.rows);
    } catch (err) { res.status(500).send('Server Error'); }
});

// 2. Endpoint: Mesin Pembuat Jadwal Home-Away Sempurna
app.post('/api/schedule/generate/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        
        // Amankan database: Tambah kolom matchday kalau belum ada
        await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS matchday INT`);

        const clubsRes = await pool.query('SELECT id FROM clubs WHERE league_id = $1', [leagueId]);
        let clubs = clubsRes.rows.map(c => c.id);

        if (clubs.length < 2) return res.status(400).json({ message: "Klub kurang dari 2!" });
        
        // Kalau ganjil (walaupun sistem kita udah genap), tambahkan tim bayangan (null)
        if (clubs.length % 2 !== 0) clubs.push(null);

        const totalRounds = clubs.length - 1;
        const matchesPerRound = clubs.length / 2;
        let fullSchedule = [];

        // Algoritma Round-Robin Sempurna
        for (let round = 0; round < totalRounds; round++) {
            for (let match = 0; match < matchesPerRound; match++) {
                const home = clubs[match];
                const away = clubs[clubs.length - 1 - match];
                
                if (home !== null && away !== null) {
                    // Masukkan Putaran Pertama (Kandang)
                    fullSchedule.push({ home, away, matchday: round + 1 });
                    
                    // Masukkan Putaran Kedua (Tandang), Pekan = Putaran 1 + Total Rounds
                    fullSchedule.push({ home: away, away: home, matchday: round + 1 + totalRounds });
                }
            }
            // Rotasi klub (Kecuali elemen pertama)
            clubs.splice(1, 0, clubs.pop());
        }

        // Hapus jadwal lama untuk liga ini saja
        await pool.query(`DELETE FROM matches WHERE home_team_id IN (SELECT id FROM clubs WHERE league_id = $1)`, [leagueId]);

        // Suntikkan 380/306 laga Home-Away ke Database
        for (let m of fullSchedule) {
            await pool.query(
                "INSERT INTO matches (home_team_id, away_team_id, status, matchday) VALUES ($1, $2, 'SCHEDULED', $3)",
                [m.home, m.away, m.matchday]
            );
        }

        const totalMatchdays = totalRounds * 2;
        res.json({ message: `Sukses! Jadwal Kandang-Tandang (${totalMatchdays} Pekan) berhasil di-generate.` });
    } catch (err) { 
        console.error(err);
        res.status(500).send('Server Error'); 
    }
});

// 🔥 MENGGUNAKAN PORT OTOMATIS DARI CLOUD & BINDING KE '0.0.0.0'
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 Server Bos FIFA ENGINE sudah LIVE di port ${PORT}`);
});