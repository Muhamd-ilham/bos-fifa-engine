const express = require('express');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Bos FIFA Engine API is running dengan PostgreSQL!');
});

// ==========================================
// 1. FUNGSI PEMBANTU (HELPERS) MESIN AI
// ==========================================
function poissonRandom(lambda) {
    const L = Math.exp(-lambda);
    let k = 0; let p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
}

const GOAL_WEIGHTS = { FWD: 6, MID: 3, DEF: 1, GK: 0.05 };
const ASSIST_WEIGHTS = { MID: 5, DEF: 2, FWD: 2, GK: 0.02 };
const CARD_WEIGHTS = { DEF: 4, MID: 3, FWD: 1.5, GK: 0.3 };

function pickWeightedPlayer(lineup, weights) {
    if (!lineup || lineup.length === 0) return null;
    const poolData = lineup.map((p) => ({ player: p, weight: weights[p.positionGroup] ?? 1 }));
    const totalWeight = poolData.reduce((sum, x) => sum + x.weight, 0);
    if (totalWeight <= 0) return lineup[Math.floor(Math.random() * lineup.length)];

    let roll = Math.random() * totalWeight;
    for (const x of poolData) {
        roll -= x.weight;
        if (roll <= 0) return x.player;
    }
    return poolData[poolData.length - 1].player;
}

function generateGoalMinutes(count) {
    const minutes = new Set();
    while (minutes.size < count) {
        minutes.add(1 + Math.floor(Math.random() * 95));
    }
    return Array.from(minutes);
}

function normalizePositionGroup(rawPosition) {
    if (!rawPosition) return 'MID';
    const pos = rawPosition.toUpperCase();
    if (pos.includes('GK')) return 'GK';
    if (pos.includes('CB') || pos.includes('LB') || pos.includes('RB') || pos.includes('WB') || pos.includes('DEF')) return 'DEF';
    if (pos.includes('ST') || pos.includes('CF') || pos.includes('LW') || pos.includes('RW') || pos.includes('FWD')) return 'FWD';
    return 'MID';
}

async function getStartingLineup(clubId) {
    const query = `
        SELECT id, name, position, overall_rating, shooting, passing, defending
        FROM players
        WHERE club_id = $1
        ORDER BY overall_rating DESC
    `;
    const result = await pool.query(query, [clubId]);

    const allPlayers = result.rows.map(p => ({
        id: p.id,
        name: p.name,
        position: p.position,
        positionGroup: normalizePositionGroup(p.position),
        overall_rating: p.overall_rating,
        shooting: p.shooting,
        passing: p.passing,
        defending: p.defending
    }));

    const lineup = [];
    const quotas = { GK: 1, DEF: 4, MID: 4, FWD: 2 };
    
    for (const pos of ['GK', 'DEF', 'MID', 'FWD']) {
        const posPlayers = allPlayers.filter(p => p.positionGroup === pos);
        lineup.push(...posPlayers.slice(0, quotas[pos]));
    }

    if (lineup.length < 11) {
        const pickedIds = new Set(lineup.map(p => p.id));
        const remainingPlayers = allPlayers.filter(p => !pickedIds.has(p.id));
        const needed = 11 - lineup.length;
        lineup.push(...remainingPlayers.slice(0, needed));
    }

    const groupOrder = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
    return lineup.sort((a, b) => groupOrder[a.positionGroup] - groupOrder[b.positionGroup]);
}

async function persistPlayerStats(playerStats, homeLineup, awayLineup) {
    if (!playerStats || playerStats.length === 0) return;
    const idByName = new Map();
    [...homeLineup, ...awayLineup].forEach((p) => idByName.set(p.name, p.id));

    for (const stat of playerStats) {
        const playerId = idByName.get(stat.name);
        if (!playerId) continue;
        await pool.query(
            `UPDATE players
             SET goals = goals + $1, assists = assists + $2, yellow_cards = yellow_cards + $3, red_cards = red_cards + $4
             WHERE id = $5`,
            [stat.goals, stat.assists, stat.yellow_cards, stat.red_cards, playerId]
        );
    }
}


// ==========================================
// 2. OTAK MANAJER AI (KECERDASAN BUATAN)
// ==========================================
function autoPickFormation(lineup) {
    if (!lineup || lineup.length === 0) return '4-4-2';
    let defScore = 0, midScore = 0, fwdScore = 0;
    lineup.forEach(p => {
        if (p.positionGroup === 'DEF') defScore += p.overall_rating;
        else if (p.positionGroup === 'MID') midScore += p.overall_rating;
        else if (p.positionGroup === 'FWD') fwdScore += p.overall_rating;
    });
    
    if (fwdScore > defScore && fwdScore > midScore) return ['4-3-3', '4-2-4', '3-4-3'][Math.floor(Math.random()*3)];
    if (defScore > midScore && defScore > fwdScore) return ['5-3-2', '5-4-1', '4-5-1'][Math.floor(Math.random()*3)];
    return ['4-2-3-1', '3-5-2', '4-1-4-1', '4-4-2'][Math.floor(Math.random()*4)];
}

function simulateFullMatch(home, away, homeLineup, awayLineup) {
    const BASE_GOALS = 1.35;
    const EXP = 1.15;
   const homeLambda = BASE_GOALS * (Math.pow(home.att, EXP) / Math.pow(away.def, EXP)) * (home.ovr / away.ovr);
    const awayLambda = BASE_GOALS * (Math.pow(away.att, EXP) / Math.pow(home.def, EXP)) * (away.ovr / home.ovr);

    const totalHomeGoals = poissonRandom(homeLambda);
    const totalAwayGoals = poissonRandom(awayLambda);

    const events = [];
    let homeScore = 0; let awayScore = 0;

    const homeGoalMinutes = generateGoalMinutes(totalHomeGoals);
    const awayGoalMinutes = generateGoalMinutes(totalAwayGoals);

    const totalChances = Math.floor((homeLambda + awayLambda) * 3);
    const chanceMinutes = new Set();
    while (chanceMinutes.size < totalChances) chanceMinutes.add(1 + Math.floor(Math.random() * 95));

    const cardMinutes = [];
    const cardCount = Math.floor(Math.random() * 5);
    for (let i = 0; i < cardCount; i++) cardMinutes.push(1 + Math.floor(Math.random() * 95));

    const statsThisMatch = new Map();
    function ensureStat(player, team) {
        if (!statsThisMatch.has(player.name)) {
            statsThisMatch.set(player.name, { name: player.name, team, positionGroup: player.positionGroup, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0 });
        }
        return statsThisMatch.get(player.name);
    }

    function resolveGoal(team, lineup) {
        const scorer = pickWeightedPlayer(lineup, GOAL_WEIGHTS);
        if (!scorer) return { scorerName: null, assisterName: null };
        ensureStat(scorer, team).goals += 1;
        let assisterName = null;
        if (Math.random() < 0.75) {
            const candidates = lineup.filter((p) => p.name !== scorer.name);
            const assister = pickWeightedPlayer(candidates, ASSIST_WEIGHTS);
            if (assister) { ensureStat(assister, team).assists += 1; assisterName = assister.name; }
        }
        return { scorerName: scorer.name, assisterName };
    }

    function resolveCard(team, lineup) {
        const player = pickWeightedPlayer(lineup, CARD_WEIGHTS);
        if (!player) return { playerName: null, cardType: null };
        const isRed = Math.random() < 0.15;
        const stat = ensureStat(player, team);
        if (isRed) stat.red_cards += 1; else stat.yellow_cards += 1;
        return { playerName: player.name, cardType: isRed ? 'KARTU_MERAH' : 'KARTU_KUNING' };
    }

    for (let minute = 1; minute <= 95; minute++) {
        if (homeGoalMinutes.includes(minute)) {
            homeScore++;
            const { scorerName, assisterName } = resolveGoal('HOME', homeLineup);
            events.push({ minute, type: 'GOAL', team: 'HOME', score: `${homeScore}-${awayScore}`, playerName: scorerName, assistName: assisterName });
        }
        if (awayGoalMinutes.includes(minute)) {
            awayScore++;
            const { scorerName, assisterName } = resolveGoal('AWAY', awayLineup);
            events.push({ minute, type: 'GOAL', team: 'AWAY', score: `${homeScore}-${awayScore}`, playerName: scorerName, assistName: assisterName });
        }
        if (chanceMinutes.has(minute) && !homeGoalMinutes.includes(minute) && !awayGoalMinutes.includes(minute)) {
            const chanceTeam = Math.random() < (homeLambda / (homeLambda + awayLambda)) ? 'HOME' : 'AWAY';
            const chanceLineup = chanceTeam === 'HOME' ? homeLineup : awayLineup;
            const chancePlayer = pickWeightedPlayer(chanceLineup, GOAL_WEIGHTS);
            events.push({ minute, type: Math.random() < 0.5 ? 'PELUANG_EMAS' : 'TENDANGAN_MELENCENG', team: chanceTeam, playerName: chancePlayer ? chancePlayer.name : null });
        }
        if (cardMinutes.includes(minute)) {
            const cardTeam = Math.random() < 0.5 ? 'HOME' : 'AWAY';
            const cardLineup = cardTeam === 'HOME' ? homeLineup : awayLineup;
            const { playerName, cardType } = resolveCard(cardTeam, cardLineup);
            if (cardType) events.push({ minute, type: cardType, team: cardTeam, playerName });
        }

        // 🔥 KECERDASAN PELATIH AI DI TENGAH LAGA 🔥
        if (minute === 45) {
            if (homeScore < awayScore) events.push({ minute: 45, type: 'TACTIC_CHANGE', team: 'HOME', newFormation: '3-4-3' });
            if (awayScore < homeScore) events.push({ minute: 45, type: 'TACTIC_CHANGE', team: 'AWAY', newFormation: '3-4-3' });
        }
        if (minute === 75) {
            if (homeScore > awayScore) events.push({ minute: 75, type: 'TACTIC_CHANGE', team: 'HOME', newFormation: '5-4-1' });
            if (awayScore > homeScore) events.push({ minute: 75, type: 'TACTIC_CHANGE', team: 'AWAY', newFormation: '5-4-1' });
        }
    }

    events.unshift({ minute: 0, type: 'KICK_OFF', team: null, score: '0-0' });
    events.push({ minute: 95, type: 'FULL_TIME', team: null, score: `${homeScore}-${awayScore}` });
    events.sort((a, b) => a.minute - b.minute);

    return { finalHomeScore: homeScore, finalAwayScore: awayScore, timeline: events, playerStats: Array.from(statsThisMatch.values()), lambdas: { home: homeLambda.toFixed(2), away: awayLambda.toFixed(2) } };
}


// ==========================================
// 3. API ROUTES (ENDPOINT)
// ==========================================
app.post('/api/matches/simulate/:id', async (req, res) => {
    try {
        const matchId = req.params.id;
        const matchRes = await pool.query("SELECT home_team_id, away_team_id, status FROM matches WHERE id = $1", [matchId]);
        const match = matchRes.rows[0];

        if (!match) return res.status(404).json({ message: "Pertandingan tidak ditemukan!" });
        if (match.status === 'FINISHED') return res.status(409).json({ message: "Pertandingan ini sudah selesai." });

        const clubNamesRes = await pool.query('SELECT id, name FROM clubs WHERE id IN ($1, $2)', [match.home_team_id, match.away_team_id]);
        const clubDataMap = {}; clubNamesRes.rows.forEach(c => { clubDataMap[c.id] = c; });

        const [homeLineup, awayLineup] = await Promise.all([
            getStartingLineup(match.home_team_id),
            getStartingLineup(match.away_team_id)
        ]);

        const startFormationHome = autoPickFormation(homeLineup);
        const startFormationAway = autoPickFormation(awayLineup);

        const strengthQuery = `
            WITH ranked_players AS (
                SELECT club_id, overall_rating, shooting, passing, defending, ROW_NUMBER() OVER(PARTITION BY club_id ORDER BY overall_rating DESC) as rn
                FROM players WHERE club_id IN ($1, $2)
            )
            SELECT club_id, AVG(overall_rating) as team_ovr, AVG(shooting + passing) / 2 as team_attack, AVG(defending) as team_defense
            FROM ranked_players WHERE rn <= 11 GROUP BY club_id
        `;
        const strengthRes = await pool.query(strengthQuery, [match.home_team_id, match.away_team_id]);

        let home = { ovr: 70, att: 70, def: 70, formation: startFormationHome };
        let away = { ovr: 70, att: 70, def: 70, formation: startFormationAway };

        strengthRes.rows.forEach(row => {
            if (row.club_id === match.home_team_id) { home.ovr = parseFloat(row.team_ovr); home.att = parseFloat(row.team_attack); home.def = parseFloat(row.team_defense); }
            if (row.club_id === match.away_team_id) { away.ovr = parseFloat(row.team_ovr); away.att = parseFloat(row.team_attack); away.def = parseFloat(row.team_defense); }
        });

        // ------------------ PERBAIKAN BUFF FORMASI (PAKAI PERSENTASE) ------------------
        const applyFormationBuffs = (stats) => {
            const f = stats.formation;
            // Bukannya ditambah flat, tapi dikali persentase supaya proporsional dengan rating asli
            if (['4-3-3', '4-2-4', '3-4-3'].includes(f)) { 
                stats.att *= 1.04; // Attack naik 4%
                stats.def *= 0.98; // Defense turun 2%
            }
            else if (['5-3-2', '5-4-1', '4-5-1'].includes(f)) { 
                stats.att *= 0.98; // Attack turun 2%
                stats.def *= 1.05; // Defense naik 5%
            }
            else { 
                stats.att *= 1.02; 
                stats.def *= 1.02; // Formasi seimbang dapat buff merata 2%
            }
        };
        
        applyFormationBuffs(home); 
        applyFormationBuffs(away);
        
        // Home Advantage (Keuntungan Tuan Rumah): Naik 3% ATT dan 2% DEF
        home.att *= 1.03; 
        home.def *= 1.02;

        const checkCounter = (f1, f2) => {
            const attacking = ['4-3-3', '4-2-4', '3-4-3'];
            const defensive = ['5-3-2', '5-4-1', '4-5-1'];
            const control = ['4-2-3-1', '3-5-2', '4-1-4-1', '4-4-2'];
            if (attacking.includes(f1) && defensive.includes(f2)) return true;
            if (defensive.includes(f1) && control.includes(f2)) return true;
            if (control.includes(f1) && attacking.includes(f2)) return true;
            return false;
        };

        // Buff Counter Formasi: Naik 5% OVR dan 5% ATT (tidak lagi statis +5)
        if (checkCounter(home.formation, away.formation)) { 
            home.ovr *= 1.05; home.att *= 1.05; 
        } else if (checkCounter(away.formation, home.formation)) { 
            away.ovr *= 1.05; away.att *= 1.05; 
        }

        const matchResult = simulateFullMatch(home, away, homeLineup, awayLineup);
        // -------------------------------------------------------------------------------

        const updateQuery = `UPDATE matches SET home_score = $1, away_score = $2, status = 'FINISHED' WHERE id = $3 RETURNING *`;
        const result = await pool.query(updateQuery, [matchResult.finalHomeScore, matchResult.finalAwayScore, matchId]);
        await persistPlayerStats(matchResult.playerStats, homeLineup, awayLineup);
        
        res.json({ 
            message: `Peluit panjang! Skor akhir ${matchResult.finalHomeScore}-${matchResult.finalAwayScore}.`, 
            result: { ...result.rows[0], home_team_name: clubDataMap[match.home_team_id]?.name, away_team_name: clubDataMap[match.away_team_id]?.name },
            timeline: matchResult.timeline,
            home_formation: startFormationHome,
            away_formation: startFormationAway
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
    } catch (err) { res.status(500).send('Server Error'); }
});

app.get('/api/players/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const query = `
            SELECT p.id, p.name, p.position, p.overall_rating, p.shooting, p.passing, p.defending, p.club_id, c.name AS club 
            FROM players p
            JOIN clubs c ON p.club_id = c.id
            WHERE c.league_id = $1
            ORDER BY p.overall_rating DESC
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
                    c.logo_url,
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
    } catch (err) { res.status(500).send('Server Error'); }
});

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
    } catch (err) { res.status(500).send('Server Error'); }
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
    } catch (err) { res.status(500).send('Server Error'); }
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
    } catch (err) { res.status(500).send('Server Error'); }
});

app.get('/api/matches/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        const query = `
            SELECT m.id, m.home_team_id, m.away_team_id, 
                   h.name AS home_team, a.name AS away_team, 
                   h.logo_url AS home_logo, a.logo_url AS away_logo, 
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

app.post('/api/schedule/generate/:leagueId', async (req, res) => {
    try {
        const { leagueId } = req.params;
        await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS matchday INT`);
        const clubsRes = await pool.query('SELECT id FROM clubs WHERE league_id = $1', [leagueId]);
        let clubs = clubsRes.rows.map(c => c.id);

        if (clubs.length < 2) return res.status(400).json({ message: "Klub kurang dari 2!" });
        if (clubs.length % 2 !== 0) clubs.push(null);

        const totalRounds = clubs.length - 1;
        const matchesPerRound = clubs.length / 2;
        let fullSchedule = [];

        for (let round = 0; round < totalRounds; round++) {
            for (let match = 0; match < matchesPerRound; match++) {
                const home = clubs[match];
                const away = clubs[clubs.length - 1 - match];
                if (home !== null && away !== null) {
                    fullSchedule.push({ home, away, matchday: round + 1 });
                    fullSchedule.push({ home: away, away: home, matchday: round + 1 + totalRounds });
                }
            }
            clubs.splice(1, 0, clubs.pop());
        }

        await pool.query(`DELETE FROM matches WHERE home_team_id IN (SELECT id FROM clubs WHERE league_id = $1)`, [leagueId]);
        for (let m of fullSchedule) {
            await pool.query("INSERT INTO matches (home_team_id, away_team_id, status, matchday) VALUES ($1, $2, 'SCHEDULED', $3)", [m.home, m.away, m.matchday]);
        }

        await pool.query(`UPDATE players SET goals = 0, assists = 0, yellow_cards = 0, red_cards = 0 WHERE club_id IN (SELECT id FROM clubs WHERE league_id = $1)`, [leagueId]);

        const totalMatchdays = totalRounds * 2;
        res.json({ message: `Sukses! Jadwal Kandang-Tandang (${totalMatchdays} Pekan) berhasil di-generate.` });
    } catch (err) { 
        console.error(err);
        res.status(500).send('Server Error'); 
    }
});

app.get('/api/clubs/:id', async (req, res) => {
    try {
        await pool.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT ''`);
        await pool.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS formation VARCHAR(50) DEFAULT '4-3-3'`);
        const result = await pool.query('SELECT * FROM clubs WHERE id = $1', [req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).send('Server Error'); }
});

app.put('/api/clubs/:id', async (req, res) => {
    try {
        const { logo_url, formation } = req.body;
        await pool.query('UPDATE clubs SET logo_url = $1, formation = $2 WHERE id = $3', [logo_url, formation, req.params.id]);
        res.json({ message: 'Profil Klub Berhasil Diperbarui!' });
    } catch (err) { res.status(500).send('Server Error'); }
});

app.post('/api/players', async (req, res) => {
    try {
        const { name, position, overall_rating, club_id, shooting, passing, defending } = req.body;
        
        // PENGAMANAN: Otomatis bikin kolom kalau di DB belum ada
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS shooting INT DEFAULT 70`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS passing INT DEFAULT 70`);
        await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS defending INT DEFAULT 70`);

        await pool.query(
            'INSERT INTO players (name, position, overall_rating, club_id, shooting, passing, defending, goals, assists, yellow_cards, red_cards) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, 0)',
            [name, position, overall_rating, club_id, shooting || 70, passing || 70, defending || 70]
        );
        res.json({ message: 'Pemain berhasil ditambahkan!' });
    } catch (err) { 
        console.error(err);
        res.status(500).send('Server Error'); 
    }
});

app.put('/api/players/:id', async (req, res) => {
    try {
        const { name, position, overall_rating, shooting, passing, defending } = req.body;
        await pool.query(
            'UPDATE players SET name = $1, position = $2, overall_rating = $3, shooting = $4, passing = $5, defending = $6 WHERE id = $7',
            [name, position, overall_rating, shooting || 70, passing || 70, defending || 70, req.params.id]
        );
        res.json({ message: 'Data pemain berhasil diupdate!' });
    } catch (err) { res.status(500).send('Server Error'); }
});

app.delete('/api/players/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM players WHERE id = $1', [req.params.id]);
        res.json({ message: 'Pemain berhasil dihapus!' });
    } catch (err) { res.status(500).send('Server Error'); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 Server Bos FIFA ENGINE sudah LIVE di port ${PORT}`);
});
