import { useEffect, useState, useRef, useMemo } from 'react';
import MatchEngine from './MatchEngine';
import './App.css';

// Hitung poin dari selisih skor: menang=3, seri=1, kalah=0.
function pointsFor(myScore, oppScore) {
  if (myScore > oppScore) return 3;
  if (myScore === oppScore) return 1;
  return 0;
}

/**
 * Terapkan SEMUA live update (skor sementara, bisa dari BANYAK pertandingan berjalan
 * bersamaan) ke atas base standings (data permanen dari server).
 *
 * Tidak berubah dari desain sebelumnya soal REPLACE vs ADD (lihat komentar di dalam) —
 * yang berubah hanya bahwa liveMatchesMap sekarang bisa realistis berisi banyak entri
 * sekaligus (satu per pertandingan yang sedang di-play), dan forEach di bawah ini
 * menjumlahkan kontribusi SEMUA match tersebut ke base secara bersamaan. Karena tiap
 * match punya homeTeamId/awayTeamId sendiri, tidak ada kemungkinan dua match yang berbeda
 * saling menimpa baris klub yang sama — kecuali satu klub kebetulan main dua kali
 * bersamaan, yang seharusnya tidak mungkin terjadi dalam satu liga yang jadwalnya benar.
 */
function applyLiveOverlay(baseStandings, liveMatchesMap) {
  const byId = new Map(baseStandings.map((row) => [row.club_id, { ...row }]));

  Object.values(liveMatchesMap).forEach((live) => {
    if (!live || live.homeTeamId == null || live.awayTeamId == null) return;

    const homeRow = byId.get(live.homeTeamId);
    const awayRow = byId.get(live.awayTeamId);
    if (!homeRow || !awayRow) return;

    const homePts = pointsFor(live.homeScore, live.awayScore);
    const awayPts = pointsFor(live.awayScore, live.homeScore);

    homeRow.played = Number(homeRow.played) + 1;
    awayRow.played = Number(awayRow.played) + 1;

    homeRow.won = Number(homeRow.won) + (homePts === 3 ? 1 : 0);
    homeRow.drawn = Number(homeRow.drawn) + (homePts === 1 ? 1 : 0);
    homeRow.lost = Number(homeRow.lost) + (homePts === 0 ? 1 : 0);

    awayRow.won = Number(awayRow.won) + (awayPts === 3 ? 1 : 0);
    awayRow.drawn = Number(awayRow.drawn) + (awayPts === 1 ? 1 : 0);
    awayRow.lost = Number(awayRow.lost) + (awayPts === 0 ? 1 : 0);

    homeRow.goals_for = Number(homeRow.goals_for) + live.homeScore;
    homeRow.goals_against = Number(homeRow.goals_against) + live.awayScore;
    awayRow.goals_for = Number(awayRow.goals_for) + live.awayScore;
    awayRow.goals_against = Number(awayRow.goals_against) + live.homeScore;

    homeRow.points = Number(homeRow.points) + homePts;
    awayRow.points = Number(awayRow.points) + awayPts;
  });

  return Array.from(byId.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const gdA = a.goals_for - a.goals_against;
    const gdB = b.goals_for - b.goals_against;
    if (gdB !== gdA) return gdB - gdA;
    return b.goals_for - a.goals_for;
  });
}

/**
 * Bandingkan urutan klasemen SEBELUM vs SESUDAH, hasilkan map club_id -> 'up' | 'down' | 'same'.
 * Ini logika yang dipakai tabel liga resmi (Premier League, dsb): posisi dibandingkan dengan
 * snapshot SEBELUMNYA (biasanya awal pekan/hari), bukan dihitung dari statistik sendiri.
 * Kalau club_id belum pernah muncul di snapshot sebelumnya (baru pertama kali dihitung), 'same'.
 */
function computePositionDeltas(prevOrderIds, currentStandings) {
  const prevIndexById = new Map(prevOrderIds.map((id, idx) => [id, idx]));
  const deltas = {};
  currentStandings.forEach((row, idx) => {
    const prevIdx = prevIndexById.get(row.club_id);
    if (prevIdx === undefined) {
      deltas[row.club_id] = 'same';
    } else if (idx < prevIdx) {
      deltas[row.club_id] = 'up';
    } else if (idx > prevIdx) {
      deltas[row.club_id] = 'down';
    } else {
      deltas[row.club_id] = 'same';
    }
  });
  return deltas;
}

function App() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');

  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);

  const [baseStandings, setBaseStandings] = useState([]);

  // Statistik pemain (top scorer / top assist / kartu) untuk liga yang sedang dipilih.
  // Diambil dari kolom permanen di DB (goals/assists/yellow_cards/red_cards), bukan dari
  // overlay live — karena stat pemain baru resmi tercatat SETELAH satu match FINISHED,
  // beda dengan klasemen sementara yang memang sengaja live per-menit.
  const [topScorers, setTopScorers] = useState([]);
  const [topAssists, setTopAssists] = useState([]);
  const [cardStats, setCardStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);

  // liveMatches: map { [matchId]: { homeTeamId, awayTeamId, homeScore, awayScore } }.
  // Sekarang BENAR-BENAR bisa berisi banyak entri sekaligus — satu untuk setiap
  // pertandingan yang sedang di-Play bersamaan.
  const [liveMatches, setLiveMatches] = useState({});

  // activeMatchIds: DAFTAR (bukan lagi satu nilai) match yang sedang di-play.
  // Ini pemicu utama untuk multi-match: setiap id di sini akan me-render satu
  // instance <MatchEngine /> terpisah dengan timer & state sendiri-sendiri.
  const [activeMatchIds, setActiveMatchIds] = useState([]);

  // Menyimpan urutan club_id dari render SEBELUMNYA, untuk membandingkan naik/turun peringkat.
  const prevOrderRef = useRef([]);
  const [positionDeltas, setPositionDeltas] = useState({});

  const [currentMatchday, setCurrentMatchday] = useState(1);
  const [activePage, setActivePage] = useState('dashboard');

  useEffect(() => {
    fetch('http://localhost:3000/api/leagues')
      .then(res => res.json())
      .then(data => {
        setLeagues(data);
        if (data.length > 0) {
          setSelectedLeague(data[0].id);
        }
      });
  }, []);

  const fetchData = (leagueId) => {
    if (!leagueId) return;

    fetch(`https://bos-fifa-engine.vercel.app/api/players/${leagueId}`)
      .then(res => res.json())
      .then(data => setPlayers(data));

    fetch(`https://bos-fifa-engine.vercel.app/api/matches/${leagueId}`)
      .then(res => res.json())
      .then(data => {
        setMatches(data);
      });

    fetch(`https://bos-fifa-engine.vercel.app/api/standings/${leagueId}`)
      .then(res => res.json())
      .then(data => {
        setBaseStandings(data);
        // Reset baseline pembanding naik/turun peringkat memakai urutan SERVER
        // (bukan hasil overlay live), supaya saat pindah liga/generate ulang jadwal
        // tidak ada panah "palsu" muncul akibat overlay lama yang sudah tidak relevan.
        prevOrderRef.current = data
          .slice()
          .sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            const gdA = a.goals_for - a.goals_against;
            const gdB = b.goals_for - b.goals_against;
            if (gdB !== gdA) return gdB - gdA;
            return b.goals_for - a.goals_for;
          })
          .map((row) => row.club_id);
        setPositionDeltas({});
      });

    fetchStats(leagueId);
  };

  // Fetch terpisah untuk 3 tabel statistik. Dipisah dari fetchData supaya bisa dipanggil
  // sendiri juga (misal: ganti ke halaman Statistik) tanpa perlu re-fetch matches/standings.
  const fetchStats = (leagueId) => {
    if (!leagueId) return;
    setStatsLoading(true);

    Promise.all([
      fetch(`https://bos-fifa-engine.vercel.app/api/stats/topscorers/${leagueId}`).then(res => res.json()),
      fetch(`https://bos-fifa-engine.vercel.app/api/stats/topassists/${leagueId}`).then(res => res.json()),
      fetch(`https://bos-fifa-engine.vercel.app/api/stats/cards/${leagueId}`).then(res => res.json()),
    ])
      .then(([scorers, assists, cards]) => {
        setTopScorers(scorers);
        setTopAssists(assists);
        setCardStats(cards);
      })
      .finally(() => setStatsLoading(false));
  };

  useEffect(() => {
    fetchData(selectedLeague);
    setCurrentMatchday(1);
    setActiveMatchIds([]);
    setLiveMatches({});
  }, [selectedLeague]);

  // Dipanggil oleh SETIAP instance MatchEngine (bisa banyak sekaligus) tiap kali
  // skor yang tampil di layarnya berubah.
  const handleLiveUpdate = ({ matchId, homeTeamId, awayTeamId, homeScore, awayScore, isFinal }) => {
    if (isFinal) {
      // Match ini selesai: lepas dari overlay live. Match-match LAIN yang masih berjalan
      // (kalau ada) tidak tersentuh sama sekali karena liveMatches adalah map per-matchId.
      setLiveMatches((prev) => {
        const next = { ...prev };
        delete next[matchId];
        return next;
      });
      // fetchData juga akan menarik ulang stat pemain (topScorers/topAssists/cardStats)
      // lewat fetchStats di dalamnya, supaya gol/assist/kartu dari match yang baru selesai
      // ini langsung kelihatan di halaman Statistik tanpa perlu refresh manual.
      fetchData(selectedLeague);
      return;
    }

    setLiveMatches((prev) => ({
      ...prev,
      [matchId]: { homeTeamId, awayTeamId, homeScore, awayScore },
    }));
  };

  // Dipanggil oleh satu instance MatchEngine spesifik saat FULL_TIME, membawa matchId-nya
  // sendiri. Hanya match itu yang dikeluarkan dari activeMatchIds — match lain yang masih
  // berjalan bersamaan tetap ada di daftar dan tidak terpengaruh.
  const handleMatchFinished = (finishedMatchId) => {
    setActiveMatchIds((prev) => prev.filter((id) => id !== finishedMatchId));
    fetchData(selectedLeague);
  };

  // Klasemen yang benar-benar dirender.
  const liveStandings = useMemo(
    () => applyLiveOverlay(baseStandings, liveMatches),
    [baseStandings, liveMatches]
  );

  // Setiap kali liveStandings berubah, bandingkan urutannya dengan urutan SEBELUM render
  // ini (prevOrderRef) untuk menentukan panah naik/turun/tetap per klub, lalu simpan
  // urutan baru sebagai baseline pembanding untuk perubahan SELANJUTNYA.
  useEffect(() => {
    if (liveStandings.length === 0) return;
    const currentOrderIds = liveStandings.map((row) => row.club_id);
    const deltas = computePositionDeltas(prevOrderRef.current, liveStandings);
    setPositionDeltas(deltas);
    prevOrderRef.current = currentOrderIds;
  }, [liveStandings]);

  // Klik "Play": tambahkan matchId ke daftar aktif (kalau belum ada di sana).
  // Karena ini array, banyak match bisa ditambahkan satu per satu dan berjalan
  // bersamaan — tidak ada batasan hanya-satu lagi.
  const handlePlayMatch = (matchId) => {
    setActiveMatchIds((prev) => (prev.includes(matchId) ? prev : [...prev, matchId]));
  };

  const handleGenerateSchedule = () => {
    if (window.confirm("Buat jadwal semusim Home-Away untuk liga ini? Jadwal lama akan terhapus!")) {
      fetch(`https://bos-fifa-engine.vercel.app/api/schedule/generate/${selectedLeague}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          alert(data.message);
          setActiveMatchIds([]);
          setLiveMatches({});
          fetchData(selectedLeague);
        });
    }
  };

  const maxMatchday = matches.length > 0 ? Math.max(...matches.map(m => Number(m.matchday) || 1)) : 1;
  const displayedMatches = matches.filter(m => m.matchday === currentMatchday);

  // Kecil tapi penting: club_id yang SEDANG live (masih ada di liveMatches) dipakai untuk
  // menyalakan badge "LIVE" terus-menerus di klasemen SELAMA pertandingannya berjalan —
  // bukan lagi timer singkat yang hilang setelah 2.5 detik seperti sebelumnya.
  const liveClubIds = useMemo(() => {
    const ids = new Set();
    Object.values(liveMatches).forEach((live) => {
      if (live.homeTeamId != null) ids.add(live.homeTeamId);
      if (live.awayTeamId != null) ids.add(live.awayTeamId);
    });
    return ids;
  }, [liveMatches]);

  const renderRankArrow = (delta) => {
    if (delta === 'up') return <span className="rank-arrow rank-up" title="Naik peringkat">▲</span>;
    if (delta === 'down') return <span className="rank-arrow rank-down" title="Turun peringkat">▼</span>;
    return <span className="rank-arrow rank-same" title="Tetap">▬</span>;
  };

  // === KOMPONEN HALAMAN KLASEMEN & JADWAL ===
  const renderDashboard = () => (
    <>
    {/* Satu MatchEngine per pertandingan yang sedang aktif, ditumpuk vertikal.
        key={id} memastikan React menjaga state tiap instance terpisah dan tidak
        mencampuradukkan timer satu match dengan match lain. */}
    {activeMatchIds.map((id) => (
      <MatchEngine
        key={id}
        matchId={id}
        apiBaseUrl="https://bos-fifa-engine.vercel.app"
        onLiveUpdate={handleLiveUpdate}
        onFinished={handleMatchFinished}
      />
    ))}

    <div className="dashboard-grid">
      {/* KIRI: KLASEMEN */}
      <div className="main-col">
        <div className="card">
          <div className="card-h">
            <span className="g-name">📊 Klasemen Liga</span>
          </div>
          <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
            <table className="player-table">
              <thead>
                <tr>
                  <th style={{ width: '24px' }}></th>
                  <th style={{ width: '30px' }}>Pos</th>
                  <th>Klub</th>
                  <th>Main</th><th>M</th><th>S</th><th>K</th>
                  <th style={{ textAlign: 'center' }}>GM</th>
                  <th style={{ textAlign: 'center' }}>GK</th>
                  <th style={{ textAlign: 'center' }}>Poin</th>
                </tr>
              </thead>
              <tbody>
                {liveStandings.map((team, index) => {
                  const isLive = liveClubIds.has(team.club_id);
                  const delta = positionDeltas[team.club_id] || 'same';
                  return (
                    <tr
                      key={team.club_id}
                      className={`${index < 4 ? 'top-tier' : ''} ${isLive ? 'row-live-active' : ''}`}
                    >
                      <td style={{ textAlign: 'center' }}>{renderRankArrow(delta)}</td>
                      <td className="pos" style={{ color: index === 0 ? '#E5C26A' : 'inherit' }}>{index + 1}</td>
                      <td className="club-name-col">
                        {team.club}
                        {isLive && <span className="live-dot" title="Sedang bertanding">●</span>}
                      </td>
                      <td>{team.played}</td><td>{team.won}</td><td>{team.drawn}</td><td>{team.lost}</td>
                      <td style={{ textAlign: 'center', color: '#34D399' }}>{team.goals_for}</td>
                      <td style={{ textAlign: 'center', color: '#F87171' }}>{team.goals_against}</td>
                      <td className="pts">
                        {team.points}
                        {isLive && <span className="pts-live-badge">LIVE</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>


      {/* KANAN: JADWAL PERTANDINGAN */}
      <div className="side-col">
        <div className="card">
          <div className="card-h sidebar-header">
            <span className="g-name" style={{ fontSize: '15px' }}>🗓️ Jadwal</span>
            <button className="btn-generate" onClick={handleGenerateSchedule}>
              🔄 Baru
            </button>
          </div>

          {matches.length > 0 && (
            <div className="matchday-nav mini-nav">
              <button
                onClick={() => setCurrentMatchday(prev => Math.max(1, prev - 1))}
                disabled={currentMatchday === 1}
                className={`btn-nav-mini ${currentMatchday === 1 ? 'dim' : ''}`}
              >◀</button>
              <h3 className="pekan-title-mini">Pekan {currentMatchday} <span className="pekan-sub">/{maxMatchday}</span></h3>
              <button
                onClick={() => setCurrentMatchday(prev => Math.min(maxMatchday, prev + 1))}
                disabled={currentMatchday === maxMatchday}
                className={`btn-nav-mini ${currentMatchday === maxMatchday ? 'dim' : ''}`}
              >▶</button>
            </div>
          )}

          <div className="match-list" style={{ padding: '0 12px 12px' }}>
            {displayedMatches.map((match) => {
              const isActive = activeMatchIds.includes(match.id);
              return (
                <div key={match.id} className="match-card-sidebar">
                  <div className="match-teams-sidebar">
                    <span className="home-team">{match.home_team}</span>
                    {match.status === 'FINISHED' ? <span className="score-mini">{match.home_score} - {match.away_score}</span> : <span className="vs-mini">VS</span>}
                    <span className="away-team">{match.away_team}</span>
                  </div>
                  {match.status === 'SCHEDULED' ? (
                    <button
                      className="btn-simulate-sidebar"
                      onClick={() => handlePlayMatch(match.id)}
                      disabled={isActive}
                    >
                      {isActive ? 'Playing...' : 'Play'}
                    </button>
                  ) : (
                    <span className="badge-finished-sidebar">FT</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    </>
  );

  // === KOMPONEN HALAMAN PEMAIN ===
  const renderPlayers = () => (
    <div className="card">
      <div className="card-h">
        <span className="g-name">⭐ Data Pemain Liga</span>
      </div>
      <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
        <table className="player-table">
          <thead>
            <tr>
              <th>Nama Pemain</th>
              <th>Posisi</th>
              <th style={{ textAlign: 'center' }}>OVR</th>
              <th>Klub</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, index) => (
              <tr key={index}>
                <td className="club-name-col">{p.name}</td>
                <td><span className="badge">{p.position}</span></td>
                <td className="pts" style={{ color: '#E5C26A' }}>{p.overall_rating}</td>
                <td>{p.club}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // === KOMPONEN HALAMAN STATISTIK (Top Scorer / Top Assist / Kartu) ===
  // Tiga tabel berdampingan (stack di layar sempit lewat CSS grid yang sama dipakai
  // dashboard-grid). Semua data berasal dari kolom permanen di DB, jadi hanya berubah
  // setelah sebuah match benar-benar FINISHED (bukan live per-menit seperti klasemen).
  const renderStats = () => {
    if (statsLoading && topScorers.length === 0 && topAssists.length === 0 && cardStats.length === 0) {
      return (
        <div className="card">
          <div className="card-h"><span className="g-name">📈 Statistik Pemain</span></div>
          <div style={{ padding: '0 15px 15px', color: '#9CB0A4', fontSize: '13px' }}>
            Memuat statistik...
          </div>
        </div>
      );
    }

    const isEmpty = topScorers.length === 0 && topAssists.length === 0 && cardStats.length === 0;

    return (
      <div className="stats-grid">
        {isEmpty && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-h"><span className="g-name">📈 Statistik Pemain</span></div>
            <div style={{ padding: '0 15px 15px', color: '#9CB0A4', fontSize: '13px' }}>
              Belum ada statistik. Mainkan beberapa pertandingan dulu di Dashboard, lalu kembali ke sini.
            </div>
          </div>
        )}

        {/* TOP SCORER */}
        <div className="card">
          <div className="card-h">
            <span className="g-name">⚽ Top Scorer</span>
          </div>
          <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
            <table className="player-table">
              <thead>
                <tr>
                  <th style={{ width: '30px' }}>#</th>
                  <th>Nama</th>
                  <th>Klub</th>
                  <th style={{ textAlign: 'center' }}>Gol</th>
                  <th style={{ textAlign: 'center' }}>Assist</th>
                </tr>
              </thead>
              <tbody>
                {topScorers.map((p, index) => (
                  <tr key={p.id} className={index < 3 ? 'top-tier' : ''}>
                    <td className="pos" style={{ color: index === 0 ? '#E5C26A' : 'inherit' }}>{index + 1}</td>
                    <td className="club-name-col">{p.name}</td>
                    <td>{p.club}</td>
                    <td className="pts" style={{ textAlign: 'center', color: '#34D399' }}>{p.goals}</td>
                    <td style={{ textAlign: 'center' }}>{p.assists}</td>
                  </tr>
                ))}
                {topScorers.length === 0 && (
                  <tr><td colSpan={5} style={{ color: '#9CB0A4', textAlign: 'center', padding: '12px 0' }}>Belum ada gol tercatat.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* TOP ASSIST */}
        <div className="card">
          <div className="card-h">
            <span className="g-name">🎯 Top Assist</span>
          </div>
          <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
            <table className="player-table">
              <thead>
                <tr>
                  <th style={{ width: '30px' }}>#</th>
                  <th>Nama</th>
                  <th>Klub</th>
                  <th style={{ textAlign: 'center' }}>Assist</th>
                  <th style={{ textAlign: 'center' }}>Gol</th>
                </tr>
              </thead>
              <tbody>
                {topAssists.map((p, index) => (
                  <tr key={p.id} className={index < 3 ? 'top-tier' : ''}>
                    <td className="pos" style={{ color: index === 0 ? '#E5C26A' : 'inherit' }}>{index + 1}</td>
                    <td className="club-name-col">{p.name}</td>
                    <td>{p.club}</td>
                    <td className="pts" style={{ textAlign: 'center', color: '#34D399' }}>{p.assists}</td>
                    <td style={{ textAlign: 'center' }}>{p.goals}</td>
                  </tr>
                ))}
                {topAssists.length === 0 && (
                  <tr><td colSpan={5} style={{ color: '#9CB0A4', textAlign: 'center', padding: '12px 0' }}>Belum ada assist tercatat.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* KARTU KUNING / MERAH */}
        <div className="card">
          <div className="card-h">
            <span className="g-name">🟨🟥 Kartu Pemain</span>
          </div>
          <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
            <table className="player-table">
              <thead>
                <tr>
                  <th style={{ width: '30px' }}>#</th>
                  <th>Nama</th>
                  <th>Klub</th>
                  <th style={{ textAlign: 'center' }}>🟨</th>
                  <th style={{ textAlign: 'center' }}>🟥</th>
                </tr>
              </thead>
              <tbody>
                {cardStats.map((p, index) => (
                  <tr key={p.id}>
                    <td className="pos">{index + 1}</td>
                    <td className="club-name-col">{p.name}</td>
                    <td>{p.club}</td>
                    <td className="pts" style={{ textAlign: 'center', color: '#FBBF24' }}>{p.yellow_cards}</td>
                    <td className="pts" style={{ textAlign: 'center', color: '#F87171' }}>{p.red_cards}</td>
                  </tr>
                ))}
                {cardStats.length === 0 && (
                  <tr><td colSpan={5} style={{ color: '#9CB0A4', textAlign: 'center', padding: '12px 0' }}>Belum ada kartu tercatat.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="app-layout">
      {/* SIDEBAR NAVIGASI KIRI */}
      <aside className="main-sidebar">
        <div className="sidebar-brand">
          <svg className="logo" width="40" height="40" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="30" fill="#11211A"/>
            <circle cx="32" cy="32" r="29" fill="none" stroke="#E5C26A" strokeWidth="2"/>
            <text x="32" y="42" textAnchor="middle" fontFamily="sans-serif" fontSize="22" fontWeight="800" fill="#E5C26A">BOS</text>
          </svg>
          <span className="brand-text">Bos FIFA</span>
        </div>

        <nav className="sidebar-menu">
          <button
            className={`menu-btn ${activePage === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActivePage('dashboard')}
          >
            📊 <span className="menu-text">Dashboard</span>
          </button>
          <button
            className={`menu-btn ${activePage === 'players' ? 'active' : ''}`}
            onClick={() => setActivePage('players')}
          >
            🏃‍♂️ <span className="menu-text">Pemain</span>
          </button>
          <button
            className={`menu-btn ${activePage === 'stats' ? 'active' : ''}`}
            onClick={() => setActivePage('stats')}
          >
            📈 <span className="menu-text">Statistik</span>
          </button>
        </nav>
      </aside>

      {/* AREA KONTEN UTAMA */}
      <div className="content-area">
        {/* HEADER ATAS */}
        <header className="top-header">
          <div className="header-title-box">
            <h2>
              {activePage === 'dashboard' && 'Dashboard Turnamen'}
              {activePage === 'players' && 'Manajemen Pemain'}
              {activePage === 'stats' && 'Statistik Pemain'}
            </h2>

          </div>

          <div className="league-selector-box">
            <select
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
            >
              {leagues.map(l => (
                <option key={l.id} value={l.id}>{l.name} ({l.total_clubs} Klub)</option>
              ))}
            </select>
          </div>
        </header>

        <main className="main-wrapper">
          {activePage === 'dashboard' && renderDashboard()}
          {activePage === 'players' && renderPlayers()}
          {activePage === 'stats' && renderStats()}
        </main>
      </div>
    </div>
  );
}

export default App;
