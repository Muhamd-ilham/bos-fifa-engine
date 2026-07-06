const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { FORMATIONS, DEFAULT_FORMATION, isValidFormation, getFormation } = require('./formations');

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

// Pilih satu pemain dari lineup berdasarkan bobot posisi (dipakai untuk gol/assist/kartu).
// weights: object positionGroup -> bobot relatif. Makin besar bobot, makin sering terpilih.
function pickWeightedPlayer(lineup, weights) {
    if (!lineup || lineup.length === 0) return null;
    const pool = lineup.map((p) => ({ player: p, weight: weights[p.positionGroup] ?? 1 }));
    const totalWeight = pool.reduce((sum, x) => sum + x.weight, 0);
    if (totalWeight <= 0) return lineup[Math.floor(Math.random() * lineup.length)];

    let roll = Math.random() * totalWeight;
    for (const x of pool) {
        roll -= x.weight;
        if (roll <= 0) return x.player;
    }
    return pool[pool.length - 1].player;
}

// Bobot kemungkinan mencetak gol per posisi (FWD paling sering, GK nyaris tak pernah)
const GOAL_WEIGHTS = { FWD: 6, MID: 3, DEF: 1, GK: 0.05 };
// Bobot assist: MID paling sering assist, lalu DEF (crossing), FWD (assist antar-striker), GK jarang
const ASSIST_WEIGHTS = { MID: 5, DEF: 2, FWD: 2, GK: 0.02 };
// Bobot kartu: DEF & MID lebih rawan kena kartu (tekel keras), FWD & GK lebih jarang
const CARD_WEIGHTS = { DEF: 4, MID: 3, FWD: 1.5, GK: 0.3 };

// Simulasi per-menit: generate timeline kejadian pertandingan (90 menit + extra time),
// SEKARANG setiap GOAL/KARTU_KUNING/KARTU_MERAH juga membawa nama & id pemain spesifik
// (diambil dari starting XI tim terkait), supaya bisa: (1) disebut di commentary, dan
// (2) diakumulasikan ke stat permanen pemain (goals/assists/cards) setelah match selesai.
function simulateFullMatch(home, away, homeLineup, awayLineup) {
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

    // Akumulator stat per pemain untuk match ini saja (nanti dijumlahkan ke DB oleh caller).
    // Key = player name (unik dalam satu lineup 11 pemain, cukup sebagai identifier lokal).
    const statsThisMatch = new Map(); // name -> { goals, assists, yellow_cards, red_cards, positionGroup, team }

    function ensureStat(player, team) {
        if (!statsThisMatch.has(player.name)) {
            statsThisMatch.set(player.name, {
                name: player.name,
                team,
                positionGroup: player.positionGroup,
                goals: 0,
                assists: 0,
                yellow_cards: 0,
                red_cards: 0,
            });
        }
        return statsThisMatch.get(player.name);
    }

    // Pilih pencetak gol + (opsional) assister untuk satu tim, kembalikan info buat event & akumulasi.
    function resolveGoal(team, lineup) {
        const scorer = pickWeightedPlayer(lineup, GOAL_WEIGHTS);
        if (!scorer) return { scorerName: null, assisterName: null };

        ensureStat(scorer, team).goals += 1;

        // 75% gol punya assist (sisanya solo run / sundulan tanpa assist tercatat)
        let assisterName = null;
        if (Math.random() < 0.75) {
            const candidates = lineup.filter((p) => p.name !== scorer.name);
            const assister = pickWeightedPlayer(candidates, ASSIST_WEIGHTS);
            if (assister) {
                ensureStat(assister, team).assists += 1;
                assisterName = assister.name;
            }
        }
        return { scorerName: scorer.name, assisterName };
    }

    function resolveCard(team, lineup) {
        const player = pickWeightedPlayer(lineup, CARD_WEIGHTS);
        if (!player) return { playerName: null, cardType: null };
        const isRed = Math.random() < 0.15;
        const stat = ensureStat(player, team);
        if (isRed) stat.red_cards += 1;
        else stat.yellow_cards += 1;
        return { playerName: player.name, cardType: isRed ? 'KARTU_MERAH' : 'KARTU_KUNING' };
    }

    // Gabungkan semua kejadian jadi satu timeline terurut per menit
    for (let minute = 1; minute <= 95; minute++) {
        if (homeGoalMinutes.includes(minute)) {
            homeScore++;
            const { scorerName, assisterName } = resolveGoal('HOME', homeLineup);
            events.push({
                minute,
                type: 'GOAL',
                team: 'HOME',
                score: `${homeScore}-${awayScore}`,
                playerName: scorerName,
                assistName: assisterName,
            });
        }
        if (awayGoalMinutes.includes(minute)) {
            awayScore++;
            const { scorerName, assisterName } = resolveGoal('AWAY', awayLineup);
            events.push({
                minute,
                type: 'GOAL',
                team: 'AWAY',
                score: `${homeScore}-${awayScore}`,
                playerName: scorerName,
                assistName: assisterName,
            });
        }
        if (chanceMinutes.has(minute) && !homeGoalMinutes.includes(minute) && !awayGoalMinutes.includes(minute)) {
            const chanceTeam = Math.random() < (homeLambda / (homeLambda + awayLambda)) ? 'HOME' : 'AWAY';
            const chanceLineup = chanceTeam === 'HOME' ? homeLineup : awayLineup;
            const chancePlayer = pickWeightedPlayer(chanceLineup, GOAL_WEIGHTS);
            const chanceType = Math.random() < 0.5 ? 'PELUANG_EMAS' : 'TENDANGAN_MELENCENG';
            events.push({
                minute,
                type: chanceType,
                team: chanceTeam,
                playerName: chancePlayer ? chancePlayer.name : null,
            });
        }
        if (cardMinutes.includes(minute)) {
            const cardTeam = Math.random() < 0.5 ? 'HOME' : 'AWAY';
            const cardLineup = cardTeam === 'HOME' ? homeLineup : awayLineup;
            const { playerName, cardType } = resolveCard(cardTeam, cardLineup);
            if (cardType) {
                events.push({ minute, type: cardType, team: cardTeam, playerName });
            }
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
        playerStats: Array.from(statsThisMatch.values()),
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

// Helper: klasifikasi posisi mentah dari DB ke grup formasi (GK/DEF/MID/FWD)
function normalizePositionGroup(rawPosition) {
    if (!rawPosition) return 'MID';
    const pos = rawPosition.toUpperCase();
    if (pos.includes('GK')) return 'GK';
    if (pos.includes('CB') || pos.includes('LB') || pos.includes('RB') || pos.includes('WB') || pos.includes('DEF')) return 'DEF';
    if (pos.includes('ST') || pos.includes('CF') || pos.includes('LW') || pos.includes('RW') || pos.includes('FWD')) return 'FWD';
    return 'MID';
}

// Ambil SEMUA pemain satu klub (bukan cuma 11), dipetakan + positionGroup, terurut
// GK -> DEF -> MID -> FWD lalu overall_rating menurun. Dipakai oleh getStartingLineup
// (ambil sub-set sesuai formasi) DAN oleh endpoint profil klub (tampilkan skuad penuh).
async function getFullSquad(clubId) {
    const query = `
        SELECT id, name, position, overall_rating, goals, assists, yellow_cards, red_cards
        FROM players
        WHERE club_id = $1
        ORDER BY overall_rating DESC
    `;
    const result = await pool.query(query, [clubId]);
    const groupOrder = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

    return result.rows
        .map(p => ({
            id: p.id,
            name: p.name,
            position: p.position,
            positionGroup: normalizePositionGroup(p.position),
            overall_rating: p.overall_rating,
            goals: p.goals,
            assists: p.assists,
            yellow_cards: p.yellow_cards,
            red_cards: p.red_cards,
        }))
        .sort((a, b) => {
            if (groupOrder[a.positionGroup] !== groupOrder[b.positionGroup]) {
                return groupOrder[a.positionGroup] - groupOrder[b.positionGroup];
            }
            return b.overall_rating - a.overall_rating;
        });
}

// Helper: ambil starting XI satu klub SESUAI FORMASI klub tersebut (+ id pemain,
// dibutuhkan untuk update stat ke DB). Untuk tiap grup posisi (GK/DEF/MID/FWD),
// ambil N pemain terbaik (overall_rating tertinggi) sejumlah slot yang diminta
// formasi. Kalau grup tertentu kekurangan pemain (skuad tipis), sisa slot yang
// tidak terisi akan ditambal dari pemain grup lain yang overall_rating-nya
// tertinggi (belum terpakai) supaya starting XI tetap genap 11 orang dan
// simulasi/commentary tidak pernah menerima lineup < 11.
// Urutan hasil akhir tetap GK -> DEF -> MID -> FWD biar gampang dipetakan ke formasi.
async function getStartingLineup(clubId, formationCode) {
    const squad = await getFullSquad(clubId);
    const formation = getFormation(formationCode);
    const groupOrder = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

    const byGroup = { GK: [], DEF: [], MID: [], FWD: [] };
    squad.forEach((p) => byGroup[p.positionGroup].push(p));

    const chosen = [];
    const chosenIds = new Set();

    ['GK', 'DEF', 'MID', 'FWD'].forEach((group) => {
        const need = formation.slots[group] || 0;
        const picks = byGroup[group].slice(0, need);
        picks.forEach((p) => {
            chosen.push(p);
            chosenIds.add(p.id);
        });
    });

    // Tambal kalau skuad kekurangan pemain di grup tertentu (mis. cuma 3 DEF padahal
    // formasi butuh 5): ambil pemain terbaik yang belum terpilih, dari grup manapun.
    const stillNeeded = 11 - chosen.length;
    if (stillNeeded > 0) {
        const remaining = squad
            .filter((p) => !chosenIds.has(p.id))
            .sort((a, b) => b.overall_rating - a.overall_rating);
        remaining.slice(0, stillNeeded).forEach((p) => {
            chosen.push(p);
            chosenIds.add(p.id);
        });
    }

    return chosen.sort((a, b) => groupOrder[a.positionGroup] - groupOrder[b.positionGroup]);
}

// Simpan akumulasi stat pemain (goals/assists/cards) hasil satu match ke DB secara permanen.
// Dipanggil TEPAT SEKALI per match (saat status baru berubah ke FINISHED), lookup player id
// berdasarkan name+club supaya cocok dengan baris di homeLineup/awayLineup.
async function persistPlayerStats(playerStats, homeLineup, awayLineup) {
    if (!playerStats || playerStats.length === 0) return;

    const idByName = new Map();
    [...homeLineup, ...awayLineup].forEach((p) => idByName.set(p.name, p.id));

    for (const stat of playerStats) {
        const playerId = idByName.get(stat.name);
        if (!playerId) continue;
        await pool.query(
            `UPDATE players
             SET goals = goals + $1,
                 assists = assists + $2,
                 yellow_cards = yellow_cards + $3,
                 red_cards = red_cards + $4
             WHERE id = $5`,
            [stat.goals, stat.assists, stat.yellow_cards, stat.red_cards, playerId]
        );
    }
}

app.post('/api/matches/simulate/:id', async (req, res) => {
    try {
        const matchId = req.params.id;

        const matchRes = await pool.query("SELECT home_team_id, away_team_id, status FROM matches WHERE id = $1", [matchId]);
        const match = matchRes.rows[0];

        if (!match) return res.status(404).json({ message: "Pertandingan tidak ditemukan!" });

        // Cegah simulasi dobel: kalau match ini SUDAH FINISHED, jangan hitung ulang & jangan
        // tambah stat pemain lagi (kalau tidak, refresh/replay akan menggandakan gol di DB).
        if (match.status === 'FINISHED') {
            return res.status(409).json({ message: "Pertandingan ini sudah selesai dan tidak bisa disimulasikan ulang." });
        }

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

        // Ambil formasi tersimpan tiap klub (default '4-3-3' kalau klub belum pernah
        // mengatur formasi / kolom formation NULL), lalu terapkan attackMod/defenseMod
        // formasi tersebut ke team_attack/team_defense SEBELUM dipakai simulateFullMatch.
        // Ini yang membuat formasi "beneran" berpengaruh ke hasil, bukan cuma kosmetik.
        const clubFormationRes = await pool.query(
            'SELECT id, formation FROM clubs WHERE id IN ($1, $2)',
            [match.home_team_id, match.away_team_id]
        );
        const formationByClubId = {};
        clubFormationRes.rows.forEach((c) => {
            formationByClubId[c.id] = isValidFormation(c.formation) ? c.formation : DEFAULT_FORMATION;
        });
        const homeFormationCode = formationByClubId[match.home_team_id] || DEFAULT_FORMATION;
        const awayFormationCode = formationByClubId[match.away_team_id] || DEFAULT_FORMATION;
        const homeFormation = getFormation(homeFormationCode);
        const awayFormation = getFormation(awayFormationCode);

        home.att *= homeFormation.attackMod;
        home.def *= homeFormation.defenseMod;
        away.att *= awayFormation.attackMod;
        away.def *= awayFormation.defenseMod;

        // Ambil starting XI (sekarang sesuai slot formasi masing-masing klub) + nama klub
        // kedua tim (untuk render 11v11, commentary, dan assign gol/assist/kartu ke pemain
        // spesifik).
        const [homeLineup, awayLineup, clubNamesRes] = await Promise.all([
            getStartingLineup(match.home_team_id, homeFormationCode),
            getStartingLineup(match.away_team_id, awayFormationCode),
            pool.query('SELECT id, name FROM clubs WHERE id IN ($1, $2)', [match.home_team_id, match.away_team_id])
        ]);

        const clubNameById = {};
        clubNamesRes.rows.forEach(c => { clubNameById[c.id] = c.name; });

        // Simulasi full match dengan timeline per-menit (sekarang termasuk nama pemain per event)
        const matchResult = simulateFullMatch(home, away, homeLineup, awayLineup);

        const updateQuery = `
            UPDATE matches 
            SET home_score = $1, away_score = $2, status = 'FINISHED' 
            WHERE id = $3 RETURNING *
        `;
        const result = await pool.query(updateQuery, [matchResult.finalHomeScore, matchResult.finalAwayScore, matchId]);

        // Simpan akumulasi gol/assist/kartu pemain ke DB SEKALI di sini, tepat setelah status
        // match resmi FINISHED — bukan di frontend, supaya tidak mungkin dobel-hitung akibat
        // multiple onFinished callback atau reconnect.
        await persistPlayerStats(matchResult.playerStats, homeLineup, awayLineup);
        
        res.json({ 
            message: `Peluit panjang! Skor akhir ${matchResult.finalHomeScore}-${matchResult.finalAwayScore}.`, 
            result: {
                ...result.rows[0],
                home_team_name: clubNameById[match.home_team_id] || 'Tim Kandang',
                away_team_name: clubNameById[match.away_team_id] || 'Tim Tandang'
            },
            timeline: matchResult.timeline,
            home_lineup: homeLineup,
            away_lineup: awayLineup,
            home_formation: homeFormationCode,
            away_formation: awayFormationCode,
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
                    c.id AS club_id,
                    c.name AS club,
                    c.logo_url AS logo_url,
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
                GROUP BY c.id, c.name, c.logo_url
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

// === ENDPOINT PROFIL KLUB (Skuad Lengkap + Logo + Formasi) ===
// GET: detail satu klub -> dipakai halaman ClubProfile (skuad penuh, logo, formasi aktif).
app.get('/api/clubs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const clubRes = await pool.query(
            'SELECT id, name, logo_url, formation, league_id FROM clubs WHERE id = $1',
            [id]
        );
        const club = clubRes.rows[0];
        if (!club) return res.status(404).json({ message: 'Klub tidak ditemukan!' });

        const squad = await getFullSquad(id);
        const formationCode = isValidFormation(club.formation) ? club.formation : DEFAULT_FORMATION;

        // Sertakan starting XI hasil formasi saat ini juga, supaya halaman profil bisa
        // menyorot 11 pemain yang akan diturunkan tanpa perlu hitung ulang di frontend.
        const startingXI = await getStartingLineup(id, formationCode);
        const startingIds = new Set(startingXI.map((p) => p.id));

        res.json({
            id: club.id,
            name: club.name,
            logo_url: club.logo_url,
            league_id: club.league_id,
            formation: formationCode,
            available_formations: Object.entries(FORMATIONS).map(([code, f]) => ({ code, label: f.label, slots: f.slots })),
            squad: squad.map((p) => ({ ...p, is_starting: startingIds.has(p.id) })),
            starting_xi: startingXI,
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT: update logo_url klub. Logo dimasukkan manual oleh user lewat URL (tidak ada upload
// file di sisi backend), jadi endpoint ini cuma nyimpen string URL apa adanya.
app.put('/api/clubs/:id/logo', async (req, res) => {
    try {
        const { id } = req.params;
        const { logo_url } = req.body;

        if (typeof logo_url !== 'string') {
            return res.status(400).json({ message: 'logo_url wajib berupa string.' });
        }

        const result = await pool.query(
            'UPDATE clubs SET logo_url = $1 WHERE id = $2 RETURNING id, name, logo_url',
            [logo_url.trim(), id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Klub tidak ditemukan!' });

        res.json({ message: 'Logo klub berhasil diperbarui.', club: result.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// PUT: update formasi klub. Formasi ini yang dipakai getStartingLineup() setiap kali
// klub ini bertanding (baik jadi home maupun away) sampai diganti lagi lewat endpoint ini.
app.put('/api/clubs/:id/formation', async (req, res) => {
    try {
        const { id } = req.params;
        const { formation } = req.body;

        if (!isValidFormation(formation)) {
            return res.status(400).json({
                message: `Formasi tidak valid. Pilihan: ${Object.keys(FORMATIONS).join(', ')}`,
            });
        }

        const result = await pool.query(
            'UPDATE clubs SET formation = $1 WHERE id = $2 RETURNING id, name, formation',
            [formation, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Klub tidak ditemukan!' });

        res.json({ message: `Formasi berhasil diubah ke ${formation}.`, club: result.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// === ENDPOINT STATISTIK PEMAIN (Top Scorer / Top Assist / Kartu) ===
// Semua diambil dari kolom permanen di tabel players (goals, assists, yellow_cards,
// red_cards) yang terus terakumulasi tiap kali match disimulasikan sampai FINISHED.
// Difilter per liga lewat join ke clubs, dan hanya pemain dengan stat > 0 yang muncul
// (biar tidak kebanjiran baris pemain yang belum pernah main sama sekali).

app.get('/api/stats/topscorers/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const query = `
            SELECT p.id, p.name, p.position, c.name AS club, p.goals, p.assists
            FROM players p
            JOIN clubs c ON p.club_id = c.id
            WHERE c.league_id = $1 AND p.goals > 0
            ORDER BY p.goals DESC, p.assists DESC
            LIMIT 20
        `;
        const result = await pool.query(query, [leagueId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

app.get('/api/stats/topassists/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const query = `
            SELECT p.id, p.name, p.position, c.name AS club, p.assists, p.goals
            FROM players p
            JOIN clubs c ON p.club_id = c.id
            WHERE c.league_id = $1 AND p.assists > 0
            ORDER BY p.assists DESC, p.goals DESC
            LIMIT 20
        `;
        const result = await pool.query(query, [leagueId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

app.get('/api/stats/cards/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const query = `
            SELECT p.id, p.name, p.position, c.name AS club, p.yellow_cards, p.red_cards
            FROM players p
            JOIN clubs c ON p.club_id = c.id
            WHERE c.league_id = $1 AND (p.yellow_cards > 0 OR p.red_cards > 0)
            ORDER BY p.red_cards DESC, p.yellow_cards DESC
            LIMIT 20
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
            SELECT m.id, m.home_team_id, m.away_team_id, h.name AS home_team, a.name AS away_team, 
                   m.home_score, m.away_score, m.status, m.matchday 
            FROM matches m
            JOIN clubs h ON m.home_team_id = h.id
            JOIN clubs a ON m.away_team_id = a.id
            WHERE h.league_id = $1
            ORDER BY m.matchday ASC, m.id ASC
        `;
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

        // Reset stat pemain (goals/assists/kartu) untuk liga ini juga, supaya musim baru
        // dimulai dari 0, konsisten dengan jadwal & klasemen yang ikut di-reset.
        await pool.query(
            `UPDATE players SET goals = 0, assists = 0, yellow_cards = 0, red_cards = 0
             WHERE club_id IN (SELECT id FROM clubs WHERE league_id = $1)`,
            [leagueId]
        );

        const totalMatchdays = totalRounds * 2;
        res.json({ message: `Sukses! Jadwal Kandang-Tandang (${totalMatchdays} Pekan) berhasil di-generate.` });
    } catch (err) { 
        console.error(err);
        res.status(500).send('Server Error'); 
    }
});

// Amankan skema: pastikan kolom logo_url & formation ada di tabel clubs saat server start,
// jadi tidak perlu migration manual terpisah. Aman dijalankan berkali-kali (IF NOT EXISTS).
async function ensureSchema() {
    try {
        await pool.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS logo_url TEXT`);
        await pool.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS formation VARCHAR(10) DEFAULT '${DEFAULT_FORMATION}'`);
        console.log('✅ Skema clubs (logo_url, formation) siap.');
    } catch (err) {
        console.error('Gagal memastikan skema clubs:', err.message);
    }
}

// 🔥 MENGGUNAKAN PORT OTOMATIS DARI CLOUD & BINDING KE '0.0.0.0'
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    await ensureSchema();
    console.log(`🔥 Server Bos FIFA ENGINE sudah LIVE di port ${PORT}`);
});
