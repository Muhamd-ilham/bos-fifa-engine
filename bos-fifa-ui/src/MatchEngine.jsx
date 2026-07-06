import React, { useEffect, useRef, useState, useCallback } from 'react';

const MS_PER_MINUTE = 450;
const HALFTIME_PAUSE_MS = 4000;

function commentaryLine(event, homeName, awayName) {
  const teamName = event.team === 'HOME' ? homeName : event.team === 'AWAY' ? awayName : null;
  switch (event.type) {
    case 'KICK_OFF':
      return `Pertandingan dimulai! ${homeName} vs ${awayName}.`;
    case 'GOAL': {
      const scorer = event.playerName ? event.playerName : `pemain ${teamName}`;
      const assistPart = event.assistName ? ` (assist: ${event.assistName})` : '';
      return `⚽ GOOOL! ${scorer} mencetak gol untuk ${teamName}${assistPart}! Skor kini ${event.score}.`;
    }
    case 'PELUANG_EMAS': {
      const who = event.playerName ? event.playerName : `pemain ${teamName}`;
      return `Peluang emas untuk ${who}! Nyaris saja gol tercipta.`;
    }
    case 'TENDANGAN_MELENCENG': {
      const who = event.playerName ? event.playerName : `Tendangan ${teamName}`;
      return event.playerName ? `Tendangan ${who} melenceng jauh.` : `${who} melenceng jauh.`;
    }
    case 'KARTU_KUNING': {
      const who = event.playerName ? event.playerName : `pemain ${teamName}`;
      return `🟨 Kartu kuning untuk ${who} (${teamName}) atas pelanggaran keras.`;
    }
    case 'KARTU_MERAH': {
      const who = event.playerName ? event.playerName : `pemain ${teamName}`;
      return `🟥 KARTU MERAH! ${who} (${teamName}) harus meninggalkan lapangan.`;
    }
    case 'TACTIC_CHANGE':
      return `🧠 PERUBAHAN TAKTIK! Pelatih ${teamName} bereaksi terhadap skor dengan merombak formasi menjadi ${event.newFormation}!`;  
    }
    case 'FULL_TIME':
      return `Pertandingan selesai! Skor akhir ${event.score}.`;
    default:
      return null;
  }
}

const MatchEngine = ({ matchId, apiBaseUrl = '', onLiveUpdate, onFinished }) => {
  const [phase, setPhase] = useState('idle');
  const [matchData, setMatchData] = useState(null);
  const [currentMinute, setCurrentMinute] = useState(0);
  const [liveScore, setLiveScore] = useState({ home: 0, away: 0 });
  const [commentary, setCommentary] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  const commentaryEndRef = useRef(null);
  const timerRef = useRef(null);
  const revealedMinutesRef = useRef(new Set());
  const finishedNotifiedRef = useRef(false);
  
  // 🔥 INI GEMBOKNYA: Mencegah React menembak API 2 kali berturut-turut
  const fetchedMatchIdRef = useRef(null); 

 const [liveFormations, setLiveFormations] = useState({ home: '...', away: '...' });
  const homeFormation = matchData?.home_formation || '4-3-3';
  const awayFormation = matchData?.away_formation || '4-3-3';

  // Tambahkan parameter isRetry biar tombol "Coba Lagi" tetap berfungsi
  const fetchMatch = useCallback(async (id, isRetry = false) => {
    // Kalau ID ini sudah pernah ditembak dan bukan karena di-klik "Coba Lagi", HENTIKAN!
    if (fetchedMatchIdRef.current === id && !isRetry) return;
    fetchedMatchIdRef.current = id; // Kunci gemboknya

    setPhase('loading');
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/matches/simulate/${id}`, { method: 'POST' });
      if (!res.ok) {
        if (res.status === 409) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || 'Pertandingan ini sudah selesai.');
        }
        throw new Error(`Server membalas status ${res.status}`);
      }
      const data = await res.json();

      setMatchData(data);
      setCurrentMinute(0);
      setLiveScore({ home: 0, away: 0 });
      setCommentary([]);
      revealedMinutesRef.current = new Set();
      finishedNotifiedRef.current = false;
      setPhase('first_half');

      onLiveUpdate?.({
        matchId: id,
        homeTeamId: data.result?.home_team_id,
        awayTeamId: data.result?.away_team_id,
        homeScore: 0,
        awayScore: 0,
        isFinal: false,
      });
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Gagal mengambil data pertandingan.');
      setPhase('error');
    }
  }, [apiBaseUrl, onLiveUpdate]);

  useEffect(() => {
    if (matchId === null || matchId === undefined) {
      setPhase('idle');
      return;
    }
    fetchMatch(matchId);
  }, [matchId, fetchMatch]);

  useEffect(() => {
    if (phase !== 'first_half' && phase !== 'second_half') return undefined;

    timerRef.current = setInterval(() => {
      setCurrentMinute((prev) => {
        const next = prev + 1;
        if (next === 45 && phase === 'first_half') {
          clearInterval(timerRef.current);
          setPhase('halftime');
          return next;
        }
        if (next >= 90) {
          clearInterval(timerRef.current);
          setPhase('full_time');
          return 90;
        }
        return next;
      });
    }, MS_PER_MINUTE);

    return () => clearInterval(timerRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'halftime') return undefined;
    const t = setTimeout(() => setPhase('second_half'), HALFTIME_PAUSE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'full_time' && !finishedNotifiedRef.current) {
      finishedNotifiedRef.current = true;
      onLiveUpdate?.({
        matchId,
        homeTeamId: matchData?.result?.home_team_id,
        awayTeamId: matchData?.result?.away_team_id,
        homeScore: liveScore.home,
        awayScore: liveScore.away,
        isFinal: true,
      });
      onFinished?.(matchId);
    }
  }, [phase, matchId, matchData, liveScore, onLiveUpdate, onFinished]);

  useEffect(() => {
    if (!matchData?.timeline) return;

    matchData.timeline.forEach((event) => {
      const key = `${event.minute}-${event.type}-${event.team || ''}-${event.playerName || ''}`;
      if (event.minute > currentMinute || revealedMinutesRef.current.has(key)) return;
      revealedMinutesRef.current.add(key);

      const line = commentaryLine(event, homeName, awayName);
      if (line) {
        setCommentary((prev) => [...prev, { id: key, minute: event.minute, text: line, type: event.type }]);
      }
      
      // 🔥 UPDATE FORMASI DI PAPAN SKOR SECARA LIVE
      if (event.type === 'TACTIC_CHANGE') {
        setLiveFormations(prev => ({
          ...prev,
          [event.team === 'HOME' ? 'home' : 'away']: event.newFormation
        }));
      }
      
      if (event.type === 'GOAL') {
        const [h, a] = event.score.split('-').map(Number);
        setLiveScore({ home: h, away: a });

        onLiveUpdate?.({
          matchId,
          homeTeamId: matchData.result?.home_team_id,
          awayTeamId: matchData.result?.away_team_id,
          homeScore: h,
          awayScore: a,
          isFinal: false,
        });
      }
    });
    
    // 🔥 KODE AUTO-SCROLL SUDAH DIHAPUS DARI SINI
    // Jadi layar nggak akan narik paksa ke bawah lagi!

  }, [currentMinute, matchData, homeName, awayName, matchId, onLiveUpdate, liveScore]);

  if (matchId === null || matchId === undefined) return null;

  const displayMinute = phase === 'halftime' ? 45 : phase === 'full_time' ? 90 : currentMinute;
  const clockLabel = phase === 'halftime' ? 'JEDA' : phase === 'full_time' ? 'FT' : `${displayMinute}'`;

  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div className="card-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="g-name" style={{ fontSize: '14px' }}>
          📺 LIVE SIMULATION ENGINE
        </span>
        {phase !== 'idle' && phase !== 'loading' && phase !== 'error' && (
          <span className="live-clock-badge">{clockLabel}</span>
        )}
      </div>

      {phase === 'loading' && (
        <div style={{ padding: '0 15px 15px', color: '#9CB0A4', fontSize: '13px' }}>
          Mengevaluasi taktik & menyiapkan pertandingan...
        </div>
      )}

      {phase === 'error' && (
        <div style={{ padding: '0 15px 15px', color: '#F87171', fontSize: '13px' }}>
          {errorMsg}{' '}
          {/* 🔥 Tambahkan flag `true` saat di-klik agar gembok terbuka */}
          <button type="button" onClick={() => fetchMatch(matchId, true)} className="btn-simulate-sidebar" style={{ marginLeft: '8px' }}>
            Coba lagi
          </button>
        </div>
      )}

      {matchData && phase !== 'loading' && phase !== 'error' && (
        <div style={{ padding: '0 15px 15px' }}>
          <div className="scoreboard-wrapper">
            <div className="team-score-block home-side">
              <span className="team-name-text">{homeName}</span>
              <span className="formation-sub-badge">🤖 {homeFormation}</span>
            </div>
            
            <span className="score-box-digits">
              {liveScore.home} - {liveScore.away}
            </span>
            
            <div className="team-score-block away-side">
              <span className="team-name-text">{awayName}</span>
              <span className="formation-sub-badge">🤖 {awayFormation}</span>
            </div>
          </div>

          {phase === 'halftime' && (
            <div style={{ textAlign: 'center', color: '#9CB0A4', fontSize: '12px', marginBottom: '8px', fontWeight: 'bold' }}>
              ⏸️ Jeda Babak Pertama — Manager sedang memberikan instruksi taktik baru...
            </div>
          )}
          {phase === 'full_time' && (
            <div style={{ textAlign: 'center', color: '#34D399', fontSize: '12px', marginBottom: '8px', fontWeight: 'bold' }}>
              🏁 {matchData.message}
            </div>
          )}

          <div className="commentary-scroll-box">
            {commentary.length === 0 && <div style={{ color: '#9CB0A4' }}>Menunggu peluit kick-off...</div>}
            {commentary.map((c) => (
              <div key={c.id} style={{ color: c.type === 'GOAL' ? '#E5C26A' : c.type.includes('KARTU') ? '#F87171' : '#ECEFE8', marginBottom: '6px' }}>
                <span style={{ color: '#34D399', fontFamily: 'monospace', fontWeight: 'bold' }}>{c.minute}&apos; </span>
                {c.text}
              </div>
            ))}
           
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchEngine;
