import React, { useEffect, useState, useCallback } from 'react';

// === IKON KECIL (dipakai lokal biar file ini bisa ditempel tanpa impor tambahan) ===
const IconBack = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconShirt = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 4L4 7v3h2v10h12V10h2V7l-4-3-2 2h-4L8 4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="none" />
  </svg>
);
const IconFormation = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="19" r="1.8" fill="currentColor" />
    <circle cx="6" cy="13" r="1.8" fill="currentColor" />
    <circle cx="18" cy="13" r="1.8" fill="currentColor" />
    <circle cx="9" cy="7" r="1.8" fill="currentColor" />
    <circle cx="15" cy="7" r="1.8" fill="currentColor" />
    <path d="M3 21h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.4" />
  </svg>
);
const IconImage = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="8.5" cy="9.5" r="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

const POSITION_GROUP_LABEL = { GK: 'Penjaga Gawang', DEF: 'Bek', MID: 'Gelandang', FWD: 'Penyerang' };
const POSITION_GROUP_ORDER = ['GK', 'DEF', 'MID', 'FWD'];

/**
 * ClubProfile — halaman profil satu klub: logo (+ ganti via URL manual), skuad
 * lengkap dikelompokkan per posisi (starting XI di-highlight sesuai formasi aktif),
 * dan form pilih formasi/strategi yang BENERAN dipakai backend saat klub ini
 * bertanding (memengaruhi starting XI + bobot attack/defense, lihat server.js).
 *
 * Props:
 * - clubId: id klub yang mau ditampilkan (wajib).
 * - apiBaseUrl: base url backend.
 * - onBack: dipanggil saat tombol "Kembali" ditekan, supaya parent (App.jsx) tahu
 *   harus menutup halaman profil ini dan kembali ke dashboard/liga.
 */
const ClubProfile = ({ clubId, apiBaseUrl = '', onBack }) => {
  const [club, setClub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [logoInput, setLogoInput] = useState('');
  const [savingLogo, setSavingLogo] = useState(false);
  const [logoMsg, setLogoMsg] = useState('');

  const [savingFormation, setSavingFormation] = useState(false);
  const [formationMsg, setFormationMsg] = useState('');

  const fetchClub = useCallback(async (id) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/clubs/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Server membalas status ${res.status}`);
      }
      const data = await res.json();
      setClub(data);
      setLogoInput(data.logo_url || '');
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Gagal memuat profil klub.');
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    if (clubId === null || clubId === undefined) return;
    fetchClub(clubId);
  }, [clubId, fetchClub]);

  const handleSaveLogo = async (e) => {
    e.preventDefault();
    setSavingLogo(true);
    setLogoMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/clubs/${clubId}/logo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: logoInput }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'Gagal menyimpan logo.');

      setClub((prev) => (prev ? { ...prev, logo_url: data.club.logo_url } : prev));
      setLogoMsg('Logo tersimpan.');
    } catch (err) {
      console.error(err);
      setLogoMsg(err.message || 'Gagal menyimpan logo.');
    } finally {
      setSavingLogo(false);
      setTimeout(() => setLogoMsg(''), 3000);
    }
  };

  const handleChangeFormation = async (newFormationCode) => {
    if (!club || newFormationCode === club.formation) return;
    setSavingFormation(true);
    setFormationMsg('');
    try {
      const res = await fetch(`${apiBaseUrl}/api/clubs/${clubId}/formation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formation: newFormationCode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'Gagal menyimpan formasi.');

      setFormationMsg(data.message || 'Formasi tersimpan.');
      // Formasi berubah -> starting XI (siapa yang di-highlight) ikut berubah,
      // jadi paling aman tarik ulang seluruh profil klub daripada menghitung
      // ulang starting XI sendiri di frontend (logic slot ada di backend).
      await fetchClub(clubId);
    } catch (err) {
      console.error(err);
      setFormationMsg(err.message || 'Gagal menyimpan formasi.');
    } finally {
      setSavingFormation(false);
      setTimeout(() => setFormationMsg(''), 3000);
    }
  };

  if (clubId === null || clubId === undefined) return null;

  return (
    <div className="club-profile">
      <button type="button" className="btn-back-profile" onClick={onBack}>
        <IconBack /> Kembali
      </button>

      {loading && (
        <div className="card" style={{ padding: '20px', color: '#9CB0A4', fontSize: '13px' }}>
          Memuat profil klub...
        </div>
      )}

      {!loading && errorMsg && (
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ color: '#F87171', fontSize: '13px', marginBottom: '10px' }}>{errorMsg}</div>
          <button type="button" className="btn-generate" onClick={() => fetchClub(clubId)}>Coba lagi</button>
        </div>
      )}

      {!loading && !errorMsg && club && (
        <>
          {/* === HEADER: LOGO + NAMA KLUB === */}
          <div className="card club-header-card">
            <div className="club-header-inner">
              <div className="club-logo-box">
                {club.logo_url ? (
                  <img
                    src={club.logo_url}
                    alt={`Logo ${club.name}`}
                    className="club-logo-img"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <div className="club-logo-placeholder"><IconImage size={26} /></div>
                )}
              </div>
              <div>
                <h2 className="club-header-name">{club.name}</h2>
                <span className="club-header-sub">{club.squad.length} pemain terdaftar</span>
              </div>
            </div>

            {/* Form ganti logo manual via URL */}
            <form className="logo-form" onSubmit={handleSaveLogo}>
              <label className="logo-form-label" htmlFor="logo-url-input">
                <IconImage size={13} /> URL Logo Klub
              </label>
              <div className="logo-form-row">
                <input
                  id="logo-url-input"
                  type="url"
                  placeholder="https://contoh.com/logo-klub.png"
                  value={logoInput}
                  onChange={(e) => setLogoInput(e.target.value)}
                  className="logo-url-input"
                />
                <button type="submit" className="btn-generate" disabled={savingLogo}>
                  {savingLogo ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
              {logoMsg && <div className="form-feedback-msg">{logoMsg}</div>}
            </form>
          </div>

          {/* === FORM STRATEGI / FORMASI === */}
          <div className="card">
            <div className="card-h">
              <span className="g-name"><IconFormation /> Strategi &amp; Formasi</span>
            </div>
            <div style={{ padding: '4px 20px 20px' }}>
              <p style={{ fontSize: '12.5px', color: '#9CB0A4', margin: '0 0 12px', lineHeight: 1.6 }}>
                Formasi ini dipakai AI untuk menyusun starting XI (siapa yang main)
                dan memengaruhi gaya bermain klub (lebih menyerang atau lebih
                bertahan) setiap kali <strong>{club.name}</strong> bertanding.
              </p>
              <div className="formation-options">
                {club.available_formations.map((f) => {
                  const active = f.code === club.formation;
                  return (
                    <button
                      key={f.code}
                      type="button"
                      className={`formation-chip ${active ? 'formation-chip-active' : ''}`}
                      onClick={() => handleChangeFormation(f.code)}
                      disabled={savingFormation}
                    >
                      <span className="formation-chip-code">{f.code}</span>
                      <span className="formation-chip-label">{f.label}</span>
                    </button>
                  );
                })}
              </div>
              {formationMsg && <div className="form-feedback-msg" style={{ marginTop: '10px' }}>{formationMsg}</div>}
            </div>
          </div>

          {/* === SKUAD, DIKELOMPOKKAN PER POSISI === */}
          <div className="card">
            <div className="card-h">
              <span className="g-name"><IconShirt /> Skuad</span>
              <span className="squad-legend">
                <span className="squad-legend-dot" /> Starting XI ({club.formation})
              </span>
            </div>
            <div className="table-responsive" style={{ padding: '0 12px 12px' }}>
              {POSITION_GROUP_ORDER.map((group) => {
                const playersInGroup = club.squad.filter((p) => p.positionGroup === group);
                if (playersInGroup.length === 0) return null;
                return (
                  <div key={group} className="squad-group">
                    <div className="squad-group-title">{POSITION_GROUP_LABEL[group]}</div>
                    <table className="player-table">
                      <thead>
                        <tr>
                          <th>Nama</th>
                          <th>Posisi</th>
                          <th style={{ textAlign: 'center' }}>OVR</th>
                          <th style={{ textAlign: 'center' }}>Gol</th>
                          <th style={{ textAlign: 'center' }}>Assist</th>
                          <th style={{ textAlign: 'center' }}>Kartu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {playersInGroup.map((p) => (
                          <tr key={p.id} className={p.is_starting ? 'top-tier' : ''}>
                            <td className="club-name-col">
                              {p.is_starting && <span className="squad-legend-dot inline-dot" />}
                              {p.name}
                            </td>
                            <td><span className="badge">{p.position}</span></td>
                            <td className="pts" style={{ color: '#E5C26A' }}>{p.overall_rating}</td>
                            <td style={{ textAlign: 'center', color: '#34D399' }}>{p.goals}</td>
                            <td style={{ textAlign: 'center' }}>{p.assists}</td>
                            <td style={{ textAlign: 'center' }}>
                              {p.yellow_cards > 0 && <span style={{ color: '#FBBF24' }}>{p.yellow_cards}🟨 </span>}
                              {p.red_cards > 0 && <span style={{ color: '#F87171' }}>{p.red_cards}🟥</span>}
                              {p.yellow_cards === 0 && p.red_cards === 0 && <span style={{ color: '#5F7468' }}>-</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              {club.squad.length === 0 && (
                <div style={{ color: '#9CB0A4', fontSize: '13px', padding: '12px 8px' }}>
                  Belum ada pemain terdaftar untuk klub ini.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ClubProfile;