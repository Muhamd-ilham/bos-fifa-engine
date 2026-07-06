import { useEffect, useState, useRef, useMemo } from 'react';
import MatchEngine from './MatchEngine';
import './App.css';

// === HELPER KLASEMEN === (Tetap sama seperti sebelumnya)
function pointsFor(myScore, oppScore) {
  if (myScore > oppScore) return 3;
  if (myScore === oppScore) return 1;
  return 0;
}
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
function computePositionDeltas(prevOrderIds, currentStandings) {
  const prevIndexById = new Map(prevOrderIds.map((id, idx) => [id, idx]));
  const deltas = {};
  currentStandings.forEach((row, idx) => {
    const prevIdx = prevIndexById.get(row.club_id);
    if (prevIdx === undefined) deltas[row.club_id] = 'same';
    else if (idx < prevIdx) deltas[row.club_id] = 'up';
    else if (idx > prevIdx) deltas[row.club_id] = 'down';
    else deltas[row.club_id] = 'same';
  });
  return deltas;
}
function computeRecentForm(allMatches) {
  const finished = allMatches.filter((m) => m.status === 'FINISHED').slice().sort((a, b) => Number(a.matchday) - Number(b.matchday));
  const formByClub = new Map();
  const pushEntry = (clubId, entry) => {
    if (clubId == null) return;
    if (!formByClub.has(clubId)) formByClub.set(clubId, []);
    const arr = formByClub.get(clubId);
    arr.push(entry);
    if (arr.length > 5) arr.shift();
  };
  finished.forEach((m) => {
    const homePts = pointsFor(Number(m.home_score), Number(m.away_score));
    const awayPts = pointsFor(Number(m.away_score), Number(m.home_score));
    pushEntry(m.home_team_id, { matchId: m.id, result: homePts === 3 ? 'W' : homePts === 1 ? 'D' : 'L', opponent: m.away_team, scoreLine: `${m.home_score}-${m.away_score}` });
    pushEntry(m.away_team_id, { matchId: m.id, result: awayPts === 3 ? 'W' : awayPts === 1 ? 'D' : 'L', opponent: m.home_team, scoreLine: `${m.away_score}-${m.home_score}` });
  });
  return formByClub;
}

// === SVG ICONS ===
const IconTrophy = ({ size = 16 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M7 4h10v4a5 5 0 01-5 5 5 5 0 01-5-5V4z" fill="#E5C26A" /><path d="M7 5H4a3 3 0 003 3" stroke="#E5C26A" strokeWidth="1.5" strokeLinecap="round" /><path d="M17 5h3a3 3 0 01-3 3" stroke="#E5C26A" strokeWidth="1.5" strokeLinecap="round" /><rect x="10.5" y="13" width="3" height="3" fill="#E5C26A" /><path d="M8 20h8" stroke="#E5C26A" strokeWidth="1.5" strokeLinecap="round" /><path d="M9 20v-2.5a3 3 0 016 0V20" stroke="#E5C26A" strokeWidth="1.5" fill="none" /></svg>);
const IconCalendar = ({ size = 16 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="16" rx="2" stroke="#E5C26A" strokeWidth="1.6" /><path d="M3.5 9.5h17" stroke="#E5C26A" strokeWidth="1.6" /><path d="M8 3v4M16 3v4" stroke="#E5C26A" strokeWidth="1.6" strokeLinecap="round" /></svg>);
const IconRefresh = ({ size = 14 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path d="M18 3v4h-4M6 21v-4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>);
const IconPlayers = ({ size = 16 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="17" cy="7.5" r="2.2" stroke="currentColor" strokeWidth="1.4" opacity="0.7" /><path d="M15 19c.2-2.2 1.7-3.8 3.7-4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" /></svg>);
const IconStats = ({ size = 16 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 20V10M10 20V4M16 20v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M3 20h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>);
const IconGoal = ({ size = 15 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#34D399" strokeWidth="1.6" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="#34D399" strokeWidth="1.4" strokeLinecap="round" /><path d="M12 8.5l3 2.2-1.1 3.5H10.1L9 10.7l3-2.2z" fill="#34D399" /></svg>);
const IconAssist = ({ size = 15 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#E5C26A" strokeWidth="1.6" /><path d="M8 13.5l3-3.5 2.2 2 2.8-4" stroke="#E5C26A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /><path d="M13.5 7.7h3.5v3.5" stroke="#E5C26A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>);
const IconCards = ({ size = 15 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="10" height="14" rx="1.5" fill="#FBBF24" transform="rotate(-8 8 12)" /><rect x="11" y="6" width="10" height="14" rx="1.5" fill="#F87171" transform="rotate(8 16 13)" /></svg>);

const IconRankArrow = ({ delta, size = 13 }) => {
  if (delta === 'up') return (<svg width={size} height={size} viewBox="0 0 12 12" className="rank-arrow rank-up"><path d="M6 1.5l4.5 6.8H1.5L6 1.5z" fill="#34D399" /></svg>);
  if (delta === 'down') return (<svg width={size} height={size} viewBox="0 0 12 12" className="rank-arrow rank-down"><path d="M6 10.5L1.5 3.7h9L6 10.5z" fill="#F87171" /></svg>);
  return (<svg width={size} height={size} viewBox="0 0 12 12" className="rank-arrow rank-same"><rect x="1.5" y="5.2" width="9" height="1.6" rx="0.8" fill="#9CB0A4" /></svg>);
};

const FormBadge = ({ entry }) => {
  const cls = entry.result === 'W' ? 'form-badge form-win' : entry.result === 'L' ? 'form-badge form-loss' : 'form-badge form-draw';
  const label = entry.result === 'W' ? 'Menang' : entry.result === 'L' ? 'Kalah' : 'Seri';
  return (<span className={cls} title={`${label} vs ${entry.opponent} (${entry.scoreLine})`}>{entry.result}</span>);
};

const API_BASE = "https://bos-fifa-engine.vercel.app";

function App() {
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState('');
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [baseStandings, setBaseStandings] = useState([]);

  const [topScorers, setTopScorers] = useState([]);
  const [topAssists, setTopAssists] = useState([]);
  const [cardStats, setCardStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(false);

  const [liveMatches, setLiveMatches] = useState({});
  const [activeMatchIds, setActiveMatchIds] = useState([]);

  const prevOrderRef = useRef([]);
  const [positionDeltas, setPositionDeltas] = useState({});

  const [currentMatchday, setCurrentMatchday] = useState(1);
  const [activePage, setActivePage] = useState('dashboard'); // dashboard | players | stats | clubProfile

  // === STATE KHUSUS PROFIL KLUB ===
  const [selectedClubId, setSelectedClubId] = useState(null);
  const [clubInfo, setClubInfo] = useState({ name: '', logo_url: '', formation: '4-3-3' });
  const [clubTab, setClubTab] = useState('squad'); // squad | calendar | strategy

  // State untuk Modal Tambah/Edit Pemain
  const [isPlayerModalOpen, setIsPlayerModalOpen] = useState(false);
  const [playerForm, setPlayerForm] = useState({ id: null, name: '', position: 'CM', overall_rating: 70 });

  const openAddPlayerModal = () => {
    setPlayerForm({ id: null, name: '', position: 'CM', overall_rating: 70 });
    setIsPlayerModalOpen(true);
  };

  const openEditPlayerModal = (player) => {
    setPlayerForm({ id: player.id, name: player.name, position: player.position, overall_rating: player.overall_rating });
    setIsPlayerModalOpen(true);
  };

  const savePlayer = async () => {
    if (!playerForm.name) return alert('Nama pemain tidak boleh kosong!');
    
    if (playerForm.id) {
      // MODE EDIT
      await fetch(`${API_BASE}/api/players/${playerForm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playerForm)
      });
    } else {
      // MODE TAMBAH BARU
      await fetch(`${API_BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...playerForm, club_id: selectedClubId })
      });
    }
    
    setIsPlayerModalOpen(false);
    fetchData(selectedLeague); // Refresh data dari DB
  };

  const deletePlayer = async (id, name) => {
    if (window.confirm(`Yakin ingin memecat ${name} dari klub ini?`)) {
      await fetch(`${API_BASE}/api/players/${id}`, { method: 'DELETE' });
      fetchData(selectedLeague); // Refresh data dari DB
    }
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/leagues`)
      .then(res => res.json())
      .then(data => {
        setLeagues(data);
        if (data.length > 0) setSelectedLeague(data[0].id);
      });
  }, []);

  const fetchData = (leagueId) => {
    if (!leagueId) return;
    fetch(`${API_BASE}/api/players/${leagueId}`).then(res => res.json()).then(data => setPlayers(data));
    fetch(`${API_BASE}/api/matches/${leagueId}`).then(res => res.json()).then(data => setMatches(data));
    fetch(`${API_BASE}/api/standings/${leagueId}`).then(res => res.json()).then(data => {
      setBaseStandings(data);
      prevOrderRef.current = data.slice().sort((a, b) => b.points - a.points).map((row) => row.club_id);
      setPositionDeltas({});
    });
    fetchStats(leagueId);
  };

  const fetchStats = (leagueId) => {
    if (!leagueId) return;
    setStatsLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/stats/topscorers/${leagueId}`).then(res => res.json()),
      fetch(`${API_BASE}/api/stats/topassists/${leagueId}`).then(res => res.json()),
      fetch(`${API_BASE}/api/stats/cards/${leagueId}`).then(res => res.json()),
    ])
      .then(([scorers, assists, cards]) => {
        setTopScorers(scorers); setTopAssists(assists); setCardStats(cards);
      })
      .finally(() => setStatsLoading(false));
  };

  useEffect(() => {
    fetchData(selectedLeague);
    setCurrentMatchday(1);
    setActiveMatchIds([]);
    setLiveMatches({});
    if(activePage === 'clubProfile') setActivePage('dashboard');
  }, [selectedLeague]);

  const handleLiveUpdate = ({ matchId, homeTeamId, awayTeamId, homeScore, awayScore, isFinal }) => {
    if (isFinal) {
      setLiveMatches((prev) => { const next = { ...prev }; delete next[matchId]; return next; });
      fetchData(selectedLeague);
      return;
    }
    setLiveMatches((prev) => ({ ...prev, [matchId]: { homeTeamId, awayTeamId, homeScore, awayScore } }));
  };

  const handleMatchFinished = (finishedMatchId) => {
    setActiveMatchIds((prev) => prev.filter((id) => id !== finishedMatchId));
    fetchData(selectedLeague);
  };

  const liveStandings = useMemo(() => applyLiveOverlay(baseStandings, liveMatches), [baseStandings, liveMatches]);
  const recentFormByClub = useMemo(() => computeRecentForm(matches), [matches]);

  useEffect(() => {
    if (liveStandings.length === 0) return;
    const currentOrderIds = liveStandings.map((row) => row.club_id);
    const deltas = computePositionDeltas(prevOrderRef.current, liveStandings);
    setPositionDeltas(deltas);
    prevOrderRef.current = currentOrderIds;
  }, [liveStandings]);

  const handlePlayMatch = (matchId) => {
    setActiveMatchIds((prev) => (prev.includes(matchId) ? prev : [...prev, matchId]));
  };

  const handleGenerateSchedule = () => {
    if (window.confirm("Buat jadwal semusim Home-Away? Jadwal lama akan terhapus!")) {
      fetch(`${API_BASE}/api/schedule/generate/${selectedLeague}`, { method: 'POST' })
        .then(res => res.json())
        .then(data => { alert(data.message); setActiveMatchIds([]); setLiveMatches({}); fetchData(selectedLeague); });
    }
  };

  const maxMatchday = matches.length > 0 ? Math.max(...matches.map(m => Number(m.matchday) || 1)) : 1;
  const displayedMatches = matches.filter(m => m.matchday === currentMatchday);
  const liveClubIds = useMemo(() => {
    const ids = new Set();
    Object.values(liveMatches).forEach((l) => { if (l.homeTeamId != null) ids.add(l.homeTeamId); if (l.awayTeamId != null) ids.add(l.awayTeamId); });
    return ids;
  }, [liveMatches]);

  // === FUNGSI PROFIL KLUB ===
  const openClubProfile = (clubId, clubName) => {
    setSelectedClubId(clubId);
    setClubInfo({ name: clubName, logo_url: '', formation: '4-3-3' }); // default sementara
    setActivePage('clubProfile');
    setClubTab('squad');
    
    // Ambil data detail klub dari DB
    fetch(`${API_BASE}/api/clubs/${clubId}`)
      .then(res => res.json())
      .then(data => {
        if(data) setClubInfo({ name: data.name, logo_url: data.logo_url, formation: data.formation || '4-3-3' });
      });
  };

  const updateClubInfo = (field, value) => {
    const newData = { ...clubInfo, [field]: value };
    setClubInfo(newData);
    
    // Simpan ke DB
    fetch(`${API_BASE}/api/clubs/${selectedClubId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newData)
    });
  };

  const handleEditLogo = () => {
    const url = prompt("Masukkan Link/URL Gambar Logo Klub (Berakhir dengan .png / .jpg):", clubInfo.logo_url);
    if (url !== null) updateClubInfo('logo_url', url);
  };


  const renderDashboard = () => (
    <>
    {activeMatchIds.map((id) => (
      <MatchEngine key={id} matchId={id} apiBaseUrl={API_BASE} onLiveUpdate={handleLiveUpdate} onFinished={handleMatchFinished} />
    ))}

    <div className="dashboard-grid">
      <div className="main-col">
        <div className="card">
          <div className="card-h"><span className="g-name"><IconTrophy /> Klasemen Liga</span></div>
          <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
            <table className="player-table">
              <thead>
                <tr>
                  <th style={{ width: '24px' }}></th><th style={{ width: '30px' }}>Pos</th>
                  <th>Klub</th><th>Main</th><th>M</th><th>S</th><th>K</th>
                  <th style={{ textAlign: 'center' }}>GM</th><th style={{ textAlign: 'center' }}>GK</th><th style={{ textAlign: 'center' }}>Poin</th>
                  <th className="form-col-header">Form</th>
                </tr>
              </thead>
              <tbody>
                {liveStandings.map((team, index) => {
                  const isLive = liveClubIds.has(team.club_id);
                  const delta = positionDeltas[team.club_id] || 'same';
                  const form = recentFormByClub.get(team.club_id) || [];
                  return (
                    <tr key={team.club_id} className={`${index < 4 ? 'top-tier' : ''} ${isLive ? 'row-live-active' : ''}`}>
                      <td style={{ textAlign: 'center' }}><IconRankArrow delta={delta} /></td>
                      <td className="pos" style={{ color: index === 0 ? '#E5C26A' : 'inherit' }}>{index + 1}</td>
                     <td className="club-name-col clickable" onClick={() => openClubProfile(team.club_id, team.club)}>
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    {team.logo_url ? (
      <img src={team.logo_url} alt="logo" style={{ width: '20px', height: '20px', objectFit: 'contain' }} />
    ) : (
      <span style={{ width: '20px' }}></span> /* Spasi kosong kalau belum ada logo */
    )}
    {team.club}
    {isLive && <span className="live-dot" title="Sedang bertanding">●</span>}
  </div>
</td>
                      <td>{team.played}</td><td>{team.won}</td><td>{team.drawn}</td><td>{team.lost}</td>
                      <td style={{ textAlign: 'center', color: '#34D399' }}>{team.goals_for}</td>
                      <td style={{ textAlign: 'center', color: '#F87171' }}>{team.goals_against}</td>
                      <td className="pts">{team.points}{isLive && <span className="pts-live-badge">LIVE</span>}</td>
                      <td className="form-col">{form.length === 0 ? <span className="form-empty">—</span> : form.map((entry) => <FormBadge key={entry.matchId} entry={entry} />)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="side-col">
        <div className="card">
          <div className="card-h sidebar-header">
            <span className="g-name" style={{ fontSize: '15px' }}><IconCalendar /> Jadwal</span>
            <button className="btn-generate" onClick={handleGenerateSchedule}><IconRefresh /> Baru</button>
          </div>
          {matches.length > 0 && (
            <div className="matchday-nav mini-nav">
              <button onClick={() => setCurrentMatchday(prev => Math.max(1, prev - 1))} disabled={currentMatchday === 1} className={`btn-nav-mini ${currentMatchday === 1 ? 'dim' : ''}`}>◀</button>
              <h3 className="pekan-title-mini">Pekan {currentMatchday} <span className="pekan-sub">/{maxMatchday}</span></h3>
              <button onClick={() => setCurrentMatchday(prev => Math.min(maxMatchday, prev + 1))} disabled={currentMatchday === maxMatchday} className={`btn-nav-mini ${currentMatchday === maxMatchday ? 'dim' : ''}`}>▶</button>
            </div>
          )}
          <div className="match-list" style={{ padding: '0 12px 12px' }}>
            {displayedMatches.map((match) => {
              const isActive = activeMatchIds.includes(match.id);
              return (
                <div key={match.id} className="match-card-sidebar">
                  <div className="match-teams-sidebar">
                   <span className="home-team clickable" onClick={() => openClubProfile(match.home_team_id, match.home_team)} style={{ display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end' }}>
  {match.home_team}
  {match.home_logo && <img src={match.home_logo} alt="logo" style={{ width: '16px', height: '16px', objectFit: 'contain' }} />}
</span>

{match.status === 'FINISHED' ? <span className="score-mini">{match.home_score} - {match.away_score}</span> : <span className="vs-mini">VS</span>}

<span className="away-team clickable" onClick={() => openClubProfile(match.away_team_id, match.away_team)} style={{ display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-start' }}>
  {match.away_logo && <img src={match.away_logo} alt="logo" style={{ width: '16px', height: '16px', objectFit: 'contain' }} />}
  {match.away_team}
</span>
                  </div>
                  {match.status === 'SCHEDULED' ? (
                    <button className="btn-simulate-sidebar" onClick={() => handlePlayMatch(match.id)} disabled={isActive}>{isActive ? 'Playing...' : 'Play'}</button>
                  ) : <span className="badge-finished-sidebar">FT</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    </>
  );

  const renderPlayers = () => (
    <div className="card">
      <div className="card-h"><span className="g-name"><IconPlayers /> Data Pemain Liga</span></div>
      <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
        <table className="player-table">
          <thead><tr><th>Nama Pemain</th><th>Posisi</th><th style={{ textAlign: 'center' }}>OVR</th><th>Klub</th></tr></thead>
          <tbody>
            {players.map((p, index) => (
              <tr key={index}>
                <td className="club-name-col">{p.name}</td><td><span className="badge">{p.position}</span></td>
                <td className="pts" style={{ color: '#E5C26A' }}>{p.overall_rating}</td>
                <td>{p.club}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderStats = () => {
    const isEmpty = topScorers.length === 0 && topAssists.length === 0 && cardStats.length === 0;
    return (
      <div className="stats-grid">
        {isEmpty && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-h"><span className="g-name"><IconStats /> Statistik Pemain</span></div>
            <div style={{ padding: '0 15px 15px', color: '#9CB0A4', fontSize: '13px' }}>Belum ada statistik. Mainkan beberapa pertandingan dulu.</div>
          </div>
        )}
        {/* TOP SCORER */}
        <div className="card">
          <div className="card-h"><span className="g-name"><IconGoal /> Top Scorer</span></div>
          <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
            <table className="player-table">
              <thead><tr><th style={{ width: '30px' }}>#</th><th>Nama</th><th>Klub</th><th style={{ textAlign: 'center' }}>Gol</th><th style={{ textAlign: 'center' }}>Assist</th></tr></thead>
              <tbody>
                {topScorers.map((p, index) => (
                  <tr key={p.id} className={index < 3 ? 'top-tier' : ''}>
                    <td className="pos">{index + 1}</td><td className="club-name-col">{p.name}</td><td>{p.club}</td>
                    <td className="pts" style={{ textAlign: 'center', color: '#34D399' }}>{p.goals}</td><td style={{ textAlign: 'center' }}>{p.assists}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* TOP ASSIST */}
        <div className="card">
          <div className="card-h"><span className="g-name"><IconAssist /> Top Assist</span></div>
          <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
            <table className="player-table">
              <thead><tr><th style={{ width: '30px' }}>#</th><th>Nama</th><th>Klub</th><th style={{ textAlign: 'center' }}>Assist</th><th style={{ textAlign: 'center' }}>Gol</th></tr></thead>
              <tbody>
                {topAssists.map((p, index) => (
                  <tr key={p.id} className={index < 3 ? 'top-tier' : ''}>
                    <td className="pos">{index + 1}</td><td className="club-name-col">{p.name}</td><td>{p.club}</td>
                    <td className="pts" style={{ textAlign: 'center', color: '#34D399' }}>{p.assists}</td><td style={{ textAlign: 'center' }}>{p.goals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* CARDS */}
        <div className="card">
          <div className="card-h"><span className="g-name"><IconCards /> Kartu Pemain</span></div>
          <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
            <table className="player-table">
              <thead><tr><th style={{ width: '30px' }}>#</th><th>Nama</th><th>Klub</th><th style={{ textAlign: 'center' }}>Kuning</th><th style={{ textAlign: 'center' }}>Merah</th></tr></thead>
              <tbody>
                {cardStats.map((p, index) => (
                  <tr key={p.id}>
                    <td className="pos">{index + 1}</td><td className="club-name-col">{p.name}</td><td>{p.club}</td>
                    <td className="pts" style={{ textAlign: 'center', color: '#FBBF24' }}>{p.yellow_cards}</td>
                    <td className="pts" style={{ textAlign: 'center', color: '#F87171' }}>{p.red_cards}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // === RENDER PROFIL KLUB ===
  const renderClubProfile = () => {
    const clubPlayers = players.filter(p => p.club === clubInfo.name);
    const clubMatches = matches.filter(m => m.home_team_id === selectedClubId || m.away_team_id === selectedClubId);
    
    return (
      <div className="club-profile-container">
        {/* HEADER PROFIL */}
        <div className="club-header card">
          <div className="club-logo-wrapper" onClick={handleEditLogo} title="Klik untuk edit Logo">
            {clubInfo.logo_url ? (
              <img src={clubInfo.logo_url} alt="Logo Klub" className="club-logo-img" />
            ) : (
              <div className="club-logo-placeholder">Upload Logo</div>
            )}
            <div className="edit-overlay">✎ Edit</div>
          </div>
          <div className="club-title-info">
            <h1 className="club-name-huge">{clubInfo.name}</h1>
            <span className="badge">Klub Liga</span>
          </div>
        </div>

        {/* TAB NAVIGASI */}
        <div className="club-tabs">
          <button className={`club-tab-btn ${clubTab === 'squad' ? 'active' : ''}`} onClick={() => setClubTab('squad')}>Tim & Squad</button>
          <button className={`club-tab-btn ${clubTab === 'calendar' ? 'active' : ''}`} onClick={() => setClubTab('calendar')}>Kalender Match</button>
          <button className={`club-tab-btn ${clubTab === 'strategy' ? 'active' : ''}`} onClick={() => setClubTab('strategy')}>Taktik & Formasi</button>
        </div>

        {/* ISI TAB: SQUAD */}
        {/* ISI TAB: SQUAD */}
        {clubTab === 'squad' && (
          <div className="card">
            <div className="card-h" style={{ borderBottom: 'none', paddingBottom: '0' }}>
               <span style={{ fontSize: '14px', color: '#9CB0A4' }}>Total: {clubPlayers.length} Pemain</span>
               <button className="btn-simulate" style={{ background: '#E5C26A', color: '#07110C', border: 'none' }} onClick={openAddPlayerModal}>
                  + Tambah Pemain
               </button>
            </div>
            <div className="table-responsive" style={{ padding: '12px' }}>
              <table className="player-table">
                <thead>
                  <tr>
                    <th>Nama Pemain</th>
                    <th>Posisi</th>
                    <th style={{ textAlign: 'center' }}>OVR</th>
                    <th style={{ textAlign: 'center' }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {clubPlayers.map((p, idx) => (
                    <tr key={idx}>
                      <td className="club-name-col" style={{ fontWeight: 'bold', color: '#ECEFE8' }}>{p.name}</td>
                      <td><span className="badge">{p.position}</span></td>
                      <td className="pts" style={{ color: '#E5C26A', fontSize: '15px' }}>{p.overall_rating}</td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn-action-edit" onClick={() => openEditPlayerModal(p)}>✎</button>
                        <button className="btn-action-delete" onClick={() => deletePlayer(p.id, p.name)}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ISI TAB: CALENDAR */}
        {clubTab === 'calendar' && (
          <div className="card">
            <div className="table-responsive">
              <table className="player-table">
                <thead><tr><th>Pekan</th><th>Kandang</th><th>Tandang</th><th>Skor / Status</th></tr></thead>
                <tbody>
                  {clubMatches.map((m, idx) => (
                    <tr key={idx}>
                      <td><span className="badge">Pekan {m.matchday}</span></td>
                      <td className={m.home_team_id === selectedClubId ? 'club-name-col' : ''}>{m.home_team}</td>
                      <td className={m.away_team_id === selectedClubId ? 'club-name-col' : ''}>{m.away_team}</td>
                      <td style={{ fontWeight: 'bold', color: m.status === 'FINISHED' ? '#E5C26A' : '#9CB0A4' }}>
                        {m.status === 'FINISHED' ? `${m.home_score} - ${m.away_score}` : 'Jadwal'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ISI TAB: STRATEGY */}
        {clubTab === 'strategy' && (
          <div className="card" style={{ padding: '20px' }}>
            <h3 style={{ marginBottom: '15px', color: '#ECEFE8' }}>Formasi Saat Ini:</h3>
            <select 
              value={clubInfo.formation} 
              onChange={(e) => updateClubInfo('formation', e.target.value)}
              style={{ padding: '10px', background: '#11211A', color: '#E5C26A', border: '1px solid #1B2C22', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold' }}
            >
              <option value="4-3-3">4-3-3 Attacking</option>
              <option value="4-4-2">4-4-2 Classic</option>
              <option value="3-5-2">3-5-2 Balance</option>
              <option value="5-3-2">5-3-2 Defensive</option>
              <option value="4-2-3-1">4-2-3-1 Control</option>
            </select>
            <p style={{ marginTop: '20px', fontSize: '13px', color: '#9CB0A4' }}>*Formasi otomatis tersimpan ke Database saat dipilih.</p>
          </div>
        )}

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
          <button className={`menu-btn ${activePage === 'dashboard' ? 'active' : ''}`} onClick={() => setActivePage('dashboard')}>
            <IconTrophy size={16} /> <span className="menu-text">Dashboard</span>
          </button>
          <button className={`menu-btn ${activePage === 'players' ? 'active' : ''}`} onClick={() => setActivePage('players')}>
            <IconPlayers size={16} /> <span className="menu-text">Pemain</span>
          </button>
          <button className={`menu-btn ${activePage === 'stats' ? 'active' : ''}`} onClick={() => setActivePage('stats')}>
            <IconStats size={16} /> <span className="menu-text">Statistik</span>
          </button>
        </nav>
      </aside>

      {/* AREA KONTEN UTAMA */}
      <div className="content-area">
        <header className="top-header">
          <div className="header-title-box">
            <h2>
              {activePage === 'dashboard' && 'Dashboard Turnamen'}
              {activePage === 'players' && 'Manajemen Pemain'}
              {activePage === 'stats' && 'Statistik Pemain'}
              {activePage === 'clubProfile' && 'Profil & Strategi Klub'}
            </h2>
          </div>

          <div className="league-selector-box">
            <select value={selectedLeague} onChange={(e) => setSelectedLeague(e.target.value)}>
              {leagues.map(l => <option key={l.id} value={l.id}>{l.name} ({l.total_clubs} Klub)</option>)}
            </select>
          </div>
        </header>

        <main className="main-wrapper">
          {activePage === 'dashboard' && renderDashboard()}
          {activePage === 'players' && renderPlayers()}
          {activePage === 'stats' && renderStats()}
          {activePage === 'clubProfile' && renderClubProfile()}
        </main>
      </div>

      {/* MODAL TAMBAH/EDIT PEMAIN */}
      {isPlayerModalOpen && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h3 style={{ color: '#E5C26A', marginBottom: '20px' }}>
              {playerForm.id ? 'Edit Data Pemain' : 'Rekrut Pemain Baru'}
            </h3>
            
            <div className="form-group">
              <label>Nama Lengkap</label>
              <input type="text" value={playerForm.name} onChange={(e) => setPlayerForm({...playerForm, name: e.target.value})} placeholder="Misal: L. Messi" />
            </div>
            
            <div className="form-group">
              <label>Posisi</label>
              <select value={playerForm.position} onChange={(e) => setPlayerForm({...playerForm, position: e.target.value})}>
                <option value="GK">Goal Keeper (GK)</option>
                <option value="CB">Center Back (CB)</option>
                <option value="LB">Left Back (LB)</option>
                <option value="RB">Right Back (RB)</option>
                <option value="DM">Defensive Mid (DM)</option>
                <option value="CM">Center Mid (CM)</option>
                <option value="AM">Attacking Mid (AM)</option>
                <option value="LW">Left Winger (LW)</option>
                <option value="RW">Right Winger (RW)</option>
                <option value="ST">Striker (ST)</option>
              </select>
            </div>

            <div className="form-group">
              <label>Overall Rating (OVR)</label>
              <input type="number" min="40" max="99" value={playerForm.overall_rating} onChange={(e) => setPlayerForm({...playerForm, overall_rating: e.target.value})} />
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setIsPlayerModalOpen(false)}>Batal</button>
              <button className="btn-save" onClick={savePlayer}>Simpan Data</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
    </div>
  );
}

export default App;
