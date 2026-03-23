import { useState, useEffect, useCallback, useRef } from "react";

// In dev: proxy via vite config (empty string uses relative URLs)
// In production: set VITE_API_URL to your Render backend URL
const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8000" : "");

function getToken() { return localStorage.getItem("ats_token"); }
function setToken(t) { localStorage.setItem("ats_token", t); }
function clearToken() { localStorage.removeItem("ats_token"); }

// ── Top5 cache (survives page refresh — only updated when pipeline runs) ──
const TOP5_CACHE_KEY = "ats_top5_cache";
function loadTop5Cache() {
  try { return JSON.parse(localStorage.getItem(TOP5_CACHE_KEY) || "{}"); } catch { return {}; }
}
function saveTop5Cache(data) {
  try { localStorage.setItem(TOP5_CACHE_KEY, JSON.stringify(data)); } catch {}
}
function clearTop5CacheForRoles(roleNames) {
  const cache = loadTop5Cache();
  roleNames.forEach(n => delete cache[n]);
  saveTop5Cache(cache);
}

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { clearToken(); window.location.reload(); }
  if (!res.ok) { const text = await res.text(); throw new Error(text); }
  if (res.status === 204) return null;
  return res.json();
}

// ── Score bar ─────────────────────────────────────────────────────────────────
function ScoreBar({ value = 0 }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 75 ? "#22c55e" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width .4s" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 40 }}>{pct}/100</span>
    </div>
  );
}

// ── Skill pills ───────────────────────────────────────────────────────────────
function SkillPills({ skills = [], max = 6 }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? skills : skills.slice(0, max);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {visible.map(s => (
        <span key={s} style={{ background: "#eff6ff", color: "#1d4ed8", fontSize: 11, padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>{s}</span>
      ))}
      {skills.length > max && (
        <button onClick={() => setShowAll(v => !v)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 12, fontSize: 11, padding: "2px 8px", cursor: "pointer", color: "#6b7280" }}>
          {showAll ? "less" : `+${skills.length - max}`}
        </button>
      )}
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({ email: "", password: "", full_name: "" });
  const [regError, setRegError] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const form = new URLSearchParams({ username: email, password });
      const res = await fetch(`${API}/auth/token`, { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      if (!res.ok) throw new Error("Invalid credentials");
      const data = await res.json();
      setToken(data.access_token); onLogin();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const register = async (e) => {
    e.preventDefault(); setRegLoading(true); setRegError("");
    try {
      await apiFetch("/auth/register", { method: "POST", body: JSON.stringify(regForm) });
      setShowRegister(false);
      setEmail(regForm.email);
      alert("Account created! Sign in now.");
    } catch (err) { setRegError(err.message); }
    finally { setRegLoading(false); }
  };

  const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, marginBottom: 14, boxSizing: "border-box" };
  const labelStyle = { display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 4 };

  if (showRegister) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, width: 400, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>Create account</h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 24px" }}>AI-ATS Recruiter Portal</p>
        <form onSubmit={register}>
          <label style={labelStyle}>Full name</label>
          <input value={regForm.full_name} onChange={e => setRegForm(f => ({ ...f, full_name: e.target.value }))} style={inputStyle} required />
          <label style={labelStyle}>Work email</label>
          <input type="email" value={regForm.email} onChange={e => setRegForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} required />
          <label style={labelStyle}>Password</label>
          <input type="password" value={regForm.password} onChange={e => setRegForm(f => ({ ...f, password: e.target.value }))} style={{ ...inputStyle, marginBottom: 20 }} required minLength={8} />
          {regError && <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{regError}</p>}
          <button type="submit" disabled={regLoading} style={{ width: "100%", padding: 11, background: regLoading ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {regLoading ? "Creating…" : "Create account"}
          </button>
        </form>
        <p style={{ marginTop: 14, fontSize: 13, color: "#6b7280", textAlign: "center" }}>
          Already have an account? <button onClick={() => setShowRegister(false)} style={{ background: "none", border: "none", color: "#2563eb", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Sign in</button>
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, width: 400, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" }}>AI-ATS</h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 24px" }}>Recruiter Portal — sign in to continue</p>
        <form onSubmit={submit}>
          <label style={labelStyle}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={inputStyle} />
          <label style={labelStyle}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={{ ...inputStyle, marginBottom: 20 }} />
          {error && <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: "100%", padding: 11, background: loading ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p style={{ marginTop: 14, fontSize: 13, color: "#6b7280", textAlign: "center" }}>
          No account? <button onClick={() => setShowRegister(true)} style={{ background: "none", border: "none", color: "#2563eb", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Register</button>
        </p>
      </div>
    </div>
  );
}

// ── Candidate modal ───────────────────────────────────────────────────────────
function CandidateModal({ candidate: c, onClose }) {
  if (!c) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 600, maxHeight: "90vh", overflow: "auto", padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a" }}>{c.name || "Unknown"}</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>{c.email}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
          {[["Phone", c.phone], ["Experience", c.experience_years ? `${c.experience_years} yrs` : "—"], ["Education", c.education], ["Rank", `#${c.rank || "—"}`]].map(([label, val]) => (
            <div key={label} style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
              <div style={{ fontSize: 14, color: "#0f172a", marginTop: 2, fontWeight: 500 }}>{val || "—"}</div>
            </div>
          ))}
        </div>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>Match Scores (out of 100)</h3>
          {[
            ["Semantic similarity", c.semantic_score, "How closely resume matches the job description"],
            ["Skill match", c.skill_score, "Overlap between candidate skills and required skills"],
            ["Experience match", c.experience_score, "Years of experience vs minimum required"],
            ["Final score", c.final_score, "Weighted: 70% semantic + 20% skill + 10% experience"],
          ].map(([label, val, hint]) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: "#374151", fontWeight: label === "Final score" ? 600 : 400 }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: (val || 0) >= 0.75 ? "#16a34a" : (val || 0) >= 0.5 ? "#d97706" : "#dc2626" }}>
                  {Math.round((val || 0) * 100)}/100
                </span>
              </div>
              <ScoreBar value={val || 0} />
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>{hint}</div>
            </div>
          ))}
        </div>
        {c.skills?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Skills</h3>
            <SkillPills skills={c.skills} max={20} />
          </div>
        )}
        {c.certifications?.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "#374151", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Certifications</h3>
            {c.certifications.map((cert, i) => <p key={i} style={{ margin: "2px 0", fontSize: 13, color: "#374151" }}>• {cert}</p>)}
          </div>
        )}
        <button
          onClick={async () => {
            try {
              const res = await fetch(`${API}/candidates/${c.id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
              if (!res.ok) { alert("Resume file not found."); return; }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = c.file_name; a.click();
              URL.revokeObjectURL(url);
            } catch (e) { alert("Download failed: " + e.message); }
          }}
          style={{ marginTop: 8, padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          ↓ Download Resume
        </button>
      </div>
    </div>
  );
}

// ── Top 5 candidates card ─────────────────────────────────────────────────────
function Top5Card({ roleName, candidates, onViewCandidate }) {
  const medalColors = ["#f59e0b", "#9ca3af", "#b45309", "#6b7280", "#6b7280"];
  const medals = ["🥇", "🥈", "🥉", "4th", "5th"];

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      {/* Role header */}
      <div style={{ background: "#1e40af", padding: "12px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{roleName}</div>
          <div style={{ color: "#93c5fd", fontSize: 12, marginTop: 2 }}>Top {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}</div>
        </div>
        <div style={{ background: "#1d4ed8", padding: "4px 12px", borderRadius: 20, color: "#bfdbfe", fontSize: 12, fontWeight: 600 }}>
          Best: {Math.round((candidates[0]?.final_score || 0) * 100)}/100
        </div>
      </div>

      {/* Candidates list */}
      <div>
        {candidates.map((c, i) => (
          <div key={c.id} style={{
            display: "flex", alignItems: "center", padding: "12px 18px", gap: 12,
            borderBottom: i < candidates.length - 1 ? "1px solid #f3f4f6" : "none",
            background: i === 0 ? "#fffbeb" : "#fff",
          }}>
            {/* Medal / rank */}
            <div style={{ fontSize: i < 3 ? 20 : 14, minWidth: 28, textAlign: "center", color: medalColors[i], fontWeight: 700 }}>
              {medals[i]}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.name || "Unknown"}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                {c.email || "—"} {c.experience_years ? `· ${c.experience_years}y exp` : ""}
              </div>
              {c.skills?.length > 0 && (
                <div style={{ marginTop: 4 }}><SkillPills skills={c.skills} max={4} /></div>
              )}
            </div>

            {/* Score */}
            <div style={{ minWidth: 100 }}>
              <ScoreBar value={c.final_score || 0} />
            </div>

            {/* Actions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 80 }}>
              <button
                onClick={() => onViewCandidate(c)}
                style={{ padding: "4px 10px", background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600, textAlign: "center" }}>
                View
              </button>
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`${API}/candidates/${c.id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
                    if (!res.ok) {
                      alert("Resume not available on server.\n\nNote: Resume files are stored on the machine that ran the pipeline. To make downloads work after hosting, configure cloud storage (S3/Cloudinary) in your settings.");
                      return;
                    }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = c.file_name; a.click();
                    URL.revokeObjectURL(url);
                  } catch (e) { alert("Download failed: " + e.message); }
                }}
                style={{ padding: "4px 10px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 6, fontSize: 11, cursor: "pointer", fontWeight: 600, textAlign: "center" }}>
                ↓ Resume
              </button>
            </div>
          </div>
        ))}

        {candidates.length === 0 && (
          <div style={{ padding: "20px 18px", color: "#9ca3af", fontSize: 13, textAlign: "center" }}>
            No candidates processed for this role yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pipeline panel ────────────────────────────────────────────────────────────
function PipelinePanel({ roles, onRolesChange }) {
  const [pipelineStatus, setPipelineStatus]   = useState(null);
  const [loading, setLoading]                 = useState(false);
  const [top5Data, setTop5Data]               = useState(() => loadTop5Cache());
  const [loadingTop5, setLoadingTop5]         = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  // ── Step 1: JD ──────────────────────────────────────────────────────────
  const [jdText, setJdText]       = useState('');
  const [jdFile, setJdFile]       = useState(null);
  const [jdExpanded, setJdExpanded] = useState(false);

  // ── Step 2: Role ────────────────────────────────────────────────────────
  const [selectedRole, setSelectedRole] = useState('');
  const [showNewRole, setShowNewRole]   = useState(false);
  const [newRoleForm, setNewRoleForm]   = useState({ role_name: '', folder_name: '', must_have_skills: '', minimum_experience: 0 });
  const [savingRole, setSavingRole]     = useState(false);

  // ── Step 3: Folder ──────────────────────────────────────────────────────
  const [folderOverride, setFolderOverride] = useState('');

  // ── Cache: load top5 from DB on mount (shows last run results) ──────────
  const fetchTop5 = useCallback(async (roleFilter = null) => {
    if (roles.length === 0) return;
    setLoadingTop5(true);
    try {
      const rolesToFetch = roleFilter
        ? roles.filter(r => r.folder_name === roleFilter || r.role_name === roleFilter)
        : roles;

      const freshData = {};
      for (const role of rolesToFetch) {
        const params = new URLSearchParams({ limit: 5, role_id: role.id });
        const data = await apiFetch(`/candidates/?${params}`);
        if (data && data.length > 0) freshData[role.role_name] = data;
      }

      // Merge fresh data into existing cache (don't wipe other roles)
      setTop5Data(prev => {
        const merged = { ...prev, ...freshData };
        saveTop5Cache(merged);   // persist to localStorage
        return merged;
      });
    } catch (e) { console.error(e); }
    finally { setLoadingTop5(false); }
  }, [roles]);

  const fetchStatus = useCallback(async () => {
    try { setPipelineStatus(await apiFetch('/pipeline/status')); } catch {}
  }, []);

  // Load cached results on mount
  useEffect(() => { if (roles.length > 0) fetchTop5(); }, [roles.length]);

  // Poll status while running
  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 5000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  // Track which role was last run so we know what to refresh
  const lastRunRoleRef = useRef(null);

  // Auto-refresh top5 after pipeline finishes — only fetch what just ran
  useEffect(() => {
    if (pipelineStatus && !pipelineStatus.running && pipelineStatus.last_run) {
      fetchTop5(lastRunRoleRef.current || null);
    }
  }, [pipelineStatus?.running]);

  // When role selected, pre-fill folder from DB
  useEffect(() => {
    if (selectedRole) {
      const role = roles.find(r => r.folder_name === selectedRole);
      if (role && !folderOverride) {
        const path = role.folder_name.includes('\\') || role.folder_name.includes('/')
          ? role.folder_name : `Applications\\${role.folder_name}`;
        setFolderOverride(path);
      }
    } else {
      setFolderOverride('');
    }
  }, [selectedRole]);

  const saveNewRole = async () => {
    if (!newRoleForm.role_name.trim() || !newRoleForm.folder_name.trim()) {
      alert('Role name and folder path are required.'); return;
    }
    setSavingRole(true);
    try {
      const payload = {
        ...newRoleForm,
        must_have_skills: newRoleForm.must_have_skills
          ? newRoleForm.must_have_skills.split(',').map(s => s.trim()).filter(Boolean)
          : [],
        minimum_experience: parseInt(newRoleForm.minimum_experience) || 0,
        status: 'Active',
      };
      await apiFetch('/roles/', { method: 'POST', body: JSON.stringify(payload) });
      setShowNewRole(false);
      setNewRoleForm({ role_name: '', folder_name: '', must_have_skills: '', minimum_experience: 0 });
      setSelectedRole(payload.folder_name);
      if (onRolesChange) onRolesChange();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setSavingRole(false); }
  };

  const run = async () => {
    setLoading(true);
    lastRunRoleRef.current = selectedRole || null;  // remember which role we ran
    try {
      // If folder override differs from stored path, update the role first
      if (folderOverride && selectedRole) {
        const role = roles.find(r => r.folder_name === selectedRole);
        if (role) {
          const currentPath = role.folder_name.includes('\\') || role.folder_name.includes('/')
            ? role.folder_name : `Applications\\${role.folder_name}`;
          if (folderOverride !== currentPath) {
            await apiFetch(`/roles/${role.id}`, {
              method: 'PUT',
              body: JSON.stringify({ ...role, folder_name: folderOverride,
                must_have_skills: role.must_have_skills || [],
                good_to_have_skills: role.good_to_have_skills || [] })
            });
            if (onRolesChange) onRolesChange();
          }
        }
      }
      const query = selectedRole ? `?role=${selectedRole}` : '';
      await apiFetch(`/pipeline/run${query}`, { method: 'POST' });
      await fetchStatus();
    } catch (e) { alert(e.message); }
    finally { setLoading(false); }
  };

  const isRunning = loading || pipelineStatus?.running;
  const medals    = ['🥇', '🥈', '🥉', '4th', '5th'];
  // Display only the role(s) that match current selection from cache
  // If a specific role is selected, show only that role
  // If "All roles", show everything in cache sorted alphabetically
  const displayRoleNames = selectedRole
    ? Object.keys(top5Data).filter(name => {
        const role = roles.find(r => r.folder_name === selectedRole);
        return name === (role?.role_name || selectedRole);
      })
    : Object.keys(top5Data).sort();

  // ── Styles ────────────────────────────────────────────────────────────
  const stepBox = {
    background: '#fff', borderRadius: 12, padding: 20,
    border: '1px solid #e5e7eb', marginBottom: 16,
  };
  const stepLabel = {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
  };
  const badge = (n) => ({
    width: 24, height: 24, borderRadius: '50%', background: '#2563eb',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, flexShrink: 0,
  });
  const iStyle = {
    width: '100%', padding: '9px 12px', border: '1px solid #d1d5db',
    borderRadius: 8, fontSize: 13, boxSizing: 'border-box',
  };

  return (
    <div>
      {/* ── Step 1: Job Description ──────────────────────────────────── */}
      <div style={stepBox}>
        <div style={stepLabel}>
          <div style={badge(1)}>1</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Job Description</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Paste or upload the JD used for semantic matching</div>
          </div>
          <button onClick={() => setJdExpanded(v => !v)}
            style={{ marginLeft: 'auto', background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', color: '#374151' }}>
            {jdExpanded ? '▲ Collapse' : '▼ Expand'}
          </button>
        </div>

        {jdExpanded && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Upload JD document (PDF or DOCX)</label>
                <input type="file" accept=".pdf,.docx,.txt"
                  onChange={e => { setJdFile(e.target.files[0]); setJdText(''); }}
                  style={{ ...iStyle, padding: '6px 10px' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 0 }}>
                <span style={{ fontSize: 12, color: '#9ca3af', paddingBottom: 8 }}>or</span>
              </div>
            </div>
            <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>Paste JD text directly</label>
            <textarea rows={5} value={jdText}
              onChange={e => { setJdText(e.target.value); setJdFile(null); }}
              placeholder="Paste the full job description here. The AI uses this to rank candidates by relevance..."
              style={{ ...iStyle, resize: 'vertical', fontFamily: 'inherit' }} />
            {(jdFile || jdText) && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                ✓ JD set: {jdFile ? jdFile.name : `${jdText.length} characters`}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
              If left empty, the JD saved in the Job Role settings will be used for matching.
            </div>
          </div>
        )}

        {!jdExpanded && (
          <div style={{ fontSize: 12, color: jdFile || jdText ? '#16a34a' : '#9ca3af' }}>
            {jdFile
              ? `✓ File: ${jdFile.name}`
              : jdText
                ? `✓ Text: ${jdText.length} characters`
                : 'Using JD saved in role settings. Click Expand to override.'}
          </div>
        )}
      </div>

      {/* ── Step 2: Select or Add Role ───────────────────────────────── */}
      <div style={stepBox}>
        <div style={stepLabel}>
          <div style={badge(2)}>2</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Select Role</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Choose which role to process, or add a new one</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <select value={selectedRole} onChange={e => { setSelectedRole(e.target.value); setShowNewRole(false); }}
            style={{ ...iStyle, flex: 1 }}>
            <option value="">All roles</option>
            {roles.map(r => <option key={r.id} value={r.folder_name}>{r.role_name}</option>)}
          </select>
          <button onClick={() => setShowNewRole(v => !v)}
            style={{ padding: '9px 14px', background: showNewRole ? '#eff6ff' : '#f8fafc',
              border: `1px solid ${showNewRole ? '#bfdbfe' : '#e5e7eb'}`, borderRadius: 8,
              fontSize: 13, cursor: 'pointer', fontWeight: 600, color: '#2563eb', whiteSpace: 'nowrap' }}>
            + New Role
          </button>
        </div>

        {showNewRole && (
          <div style={{ marginTop: 14, padding: 16, background: '#f0f9ff', borderRadius: 10, border: '1px solid #bae6fd' }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#0369a1', marginBottom: 12 }}>Quick-add new role</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>Role name *</label>
                <input value={newRoleForm.role_name}
                  onChange={e => setNewRoleForm(f => ({ ...f, role_name: e.target.value }))}
                  style={iStyle} placeholder="e.g. AI Engineer" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>Min experience (yrs)</label>
                <input type="number" min={0} value={newRoleForm.minimum_experience}
                  onChange={e => setNewRoleForm(f => ({ ...f, minimum_experience: e.target.value }))}
                  style={iStyle} />
              </div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: '#1d4ed8', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Resume folder path *
              </label>
              <input value={newRoleForm.folder_name}
                onChange={e => setNewRoleForm(f => ({ ...f, folder_name: e.target.value }))}
                style={{ ...iStyle, fontFamily: 'monospace', background: '#fff' }}
                placeholder="C:\Users\HP\Downloads\Resumes\AI_Engineer" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#374151', fontWeight: 600, display: 'block', marginBottom: 4 }}>Must-have skills (comma-separated)</label>
              <input value={newRoleForm.must_have_skills}
                onChange={e => setNewRoleForm(f => ({ ...f, must_have_skills: e.target.value }))}
                style={iStyle} placeholder="Python, ML, FastAPI" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowNewRole(false)}
                style={{ padding: '7px 14px', background: '#f3f4f6', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveNewRole} disabled={savingRole}
                style={{ padding: '7px 14px', background: savingRole ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {savingRole ? 'Saving…' : 'Save & Select'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Step 3: Folder Path ──────────────────────────────────────── */}
      <div style={stepBox}>
        <div style={stepLabel}>
          <div style={badge(3)}>3</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Resume Folder</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Folder where Outlook saves resumes for this role (pre-filled from role settings)
            </div>
          </div>
        </div>

        <input
          value={folderOverride}
          onChange={e => setFolderOverride(e.target.value)}
          style={{ ...iStyle, fontFamily: 'monospace', fontSize: 13 }}
          placeholder="C:\Users\HP\Downloads\Resumes\AI_Engineer"
        />
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
          This is auto-filled from the selected role. Change it here to override for this run only —
          or update it permanently in the Job Roles tab.
        </div>
      </div>

      {/* ── Run Controls ─────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, border: '1px solid #e5e7eb', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={run} disabled={isRunning}
            style={{ padding: '10px 28px', background: isRunning ? '#93c5fd' : '#2563eb', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: isRunning ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRunning
              ? <><span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Running…</>
              : '▶ Run Pipeline'}
          </button>

          {pipelineStatus?.running && (
            <span style={{ background: '#fef3c7', color: '#92400e', fontSize: 12, padding: '4px 12px', borderRadius: 20, fontWeight: 600 }}>
              ● Processing resumes…
            </span>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button onClick={() => fetchTop5(selectedRole || null)}
              style={{ padding: '9px 14px', background: '#f8fafc', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ↻ Refresh Results
            </button>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${API}/reports/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
                  if (!res.ok) { alert('Report not ready. Run pipeline first.'); return; }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = 'Candidate_Ranking.xlsx'; a.click();
                  URL.revokeObjectURL(url);
                } catch (e) { alert('Download failed: ' + e.message); }
              }}
              style={{ padding: '9px 16px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              ↓ Excel Report
            </button>
          </div>
        </div>

        {/* Last run stats */}
        {pipelineStatus?.last_run && (
          <div style={{ marginTop: 14, padding: '10px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
              Last run: {new Date(pipelineStatus.last_run).toLocaleString()}
            </div>
            {pipelineStatus.last_result && typeof pipelineStatus.last_result === 'object' && (
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                {[
                  ['Roles scanned', pipelineStatus.last_result.roles, '#2563eb'],
                  ['Processed', pipelineStatus.last_result.processed, '#16a34a'],
                  ['Skipped (dup)', pipelineStatus.last_result.skipped, '#f59e0b'],
                  ['Errors', pipelineStatus.last_result.errors, '#dc2626'],
                ].map(([label, val, color]) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color }}>{val ?? 0}</div>
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Top 5 Results ────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, border: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Top 5 Candidates
              {selectedRole
                ? ` — ${roles.find(r => r.folder_name === selectedRole)?.role_name || selectedRole}`
                : sortedRoleNames.length > 0
                  ? ` — All Roles (${displayRoleNames.length})`
                  : ''}
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#9ca3af' }}>
              Showing results from last pipeline run. Click ↻ Refresh to reload.
            </p>
          </div>
          {loadingTop5 && <span style={{ fontSize: 12, color: '#6b7280' }}>Loading…</span>}
        </div>

        {displayRoleNames.length === 0 && !loadingTop5 && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14 }}>No results yet. Configure a role and run the pipeline.</div>
          </div>
        )}

        {displayRoleNames.map(roleName => {
          const candidates = top5Data[roleName] || [];
          return (
            <div key={roleName} style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
              {/* Role header */}
              <div style={{ background: '#1e40af', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{roleName}</div>
                  <div style={{ color: '#93c5fd', fontSize: 12, marginTop: 2 }}>Top {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}</div>
                </div>
                <div style={{ background: '#1d4ed8', padding: '4px 12px', borderRadius: 20, color: '#bfdbfe', fontSize: 12, fontWeight: 600 }}>
                  Best: {Math.round((candidates[0]?.final_score || 0) * 100)}/100
                </div>
              </div>

              {/* Candidates */}
              {candidates.map((c, i) => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', padding: '12px 18px', gap: 12,
                  borderBottom: i < candidates.length - 1 ? '1px solid #f3f4f6' : 'none',
                  background: i === 0 ? '#fffbeb' : '#fff',
                }}>
                  <div style={{ fontSize: i < 3 ? 20 : 13, minWidth: 28, textAlign: 'center', fontWeight: 700, color: '#6b7280' }}>
                    {medals[i]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name || 'Unknown'}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      {c.email || '—'}{c.experience_years ? ` · ${c.experience_years}y exp` : ''}
                    </div>
                    {c.skills?.length > 0 && <div style={{ marginTop: 4 }}><SkillPills skills={c.skills} max={4} /></div>}
                  </div>
                  <div style={{ minWidth: 100 }}>
                    <ScoreBar value={c.final_score || 0} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 80 }}>
                    <button onClick={() => setSelectedCandidate(c)}
                      style={{ padding: '4px 10px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      View
                    </button>
                    <button onClick={async () => {
                      try {
                        const res = await fetch(`${API}/candidates/${c.id}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
                        if (!res.ok) { alert('Resume file is stored on the local machine that ran the pipeline and is not available on the hosted server.'); return; }
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a'); a.href = url; a.download = c.file_name; a.click();
                        URL.revokeObjectURL(url);
                      } catch (e) { alert('Download failed: ' + e.message); }
                    }}
                      style={{ padding: '4px 10px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      ↓ Resume
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {selectedCandidate && <CandidateModal candidate={selectedCandidate} onClose={() => setSelectedCandidate(null)} />}
    </div>
  );
}


// ── Candidates table ──────────────────────────────────────────────────────────
function CandidatesTable({ roleId }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ minScore: 0, minExp: 0, skills: "" });
  const [selected, setSelected] = useState(null);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (roleId) params.append("role_id", roleId);
      if (filters.minScore > 0) params.append("min_score", filters.minScore);
      if (filters.minExp > 0) params.append("min_experience", filters.minExp);
      if (filters.skills) params.append("skills", filters.skills);
      setCandidates(await apiFetch(`/candidates/?${params}`) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [roleId, filters]);

  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);

  const hStyle = { padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" };
  const cStyle = { padding: "12px 14px", borderBottom: "1px solid #f3f4f6", fontSize: 13, color: "#374151", verticalAlign: "middle" };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Min score (%)</label>
          <input type="number" min={0} max={100} value={Math.round(filters.minScore * 100)} onChange={e => setFilters(f => ({ ...f, minScore: e.target.value / 100 }))}
            style={{ width: 80, padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Min exp (yrs)</label>
          <input type="number" min={0} step={0.5} value={filters.minExp} onChange={e => setFilters(f => ({ ...f, minExp: e.target.value }))}
            style={{ width: 80, padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13 }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Skills filter</label>
          <input type="text" placeholder="e.g. Python, FastAPI" value={filters.skills} onChange={e => setFilters(f => ({ ...f, skills: e.target.value }))}
            style={{ width: "100%", padding: "7px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, boxSizing: "border-box" }} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button onClick={fetchCandidates} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Apply</button>
        </div>
      </div>
      {loading ? <p style={{ textAlign: "center", color: "#6b7280", padding: 40 }}>Loading…</p>
        : candidates.length === 0 ? <p style={{ textAlign: "center", color: "#9ca3af", padding: 40 }}>No candidates found.</p>
        : (
          <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid #e5e7eb" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["#", "Name", "Email", "Skills", "Exp (yrs)", "Score /100", "Actions"].map(h => <th key={h} style={hStyle}>{h}</th>)}</tr></thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={c.id} onMouseEnter={e => e.currentTarget.style.background = "#f0f9ff"} onMouseLeave={e => e.currentTarget.style.background = ""}>
                    <td style={cStyle}>{c.rank <= 3 ? <span style={{ fontSize: 16 }}>{["🥇", "🥈", "🥉"][c.rank - 1]}</span> : <span style={{ color: "#9ca3af" }}>{c.rank || i + 1}</span>}</td>
                    <td style={{ ...cStyle, fontWeight: 600, color: "#0f172a" }}>{c.name || "—"}</td>
                    <td style={{ ...cStyle, color: "#2563eb" }}>{c.email || "—"}</td>
                    <td style={cStyle}><SkillPills skills={c.skills || []} max={3} /></td>
                    <td style={cStyle}>{c.experience_years ? `${c.experience_years}y` : "—"}</td>
                    <td style={{ ...cStyle, minWidth: 120 }}><ScoreBar value={c.final_score || 0} /></td>
                    <td style={cStyle}>
                      <button onClick={() => setSelected(c)} style={{ padding: "5px 12px", background: "#f0f9ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {selected && <CandidateModal candidate={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── JD Editor ─────────────────────────────────────────────────────────────
function JDEditor({ roles, onSave }) {
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const openCreate = () => {
    setEditingId("new");
    setForm({ role_name: "", folder_name: "", job_description: "", must_have_skills: "", good_to_have_skills: "", minimum_experience: 0, status: "Active" });
  };

  const openEdit = (role) => {
    setEditingId(role.id);
    setForm({ ...role, must_have_skills: (role.must_have_skills || []).join(", "), good_to_have_skills: (role.good_to_have_skills || []).join(", ") });
  };

  const save = async () => {
    if (!form.role_name?.trim()) { alert("Role name is required."); return; }
    if (!form.folder_name?.trim()) { alert("Resume folder path is required."); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        must_have_skills: form.must_have_skills ? form.must_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [],
        good_to_have_skills: form.good_to_have_skills ? form.good_to_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [],
        minimum_experience: parseInt(form.minimum_experience) || 0,
      };
      if (editingId === "new") await apiFetch("/roles/", { method: "POST", body: JSON.stringify(payload) });
      else await apiFetch(`/roles/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      setEditingId(null); onSave();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const deleteRole = async (role) => {
    if (!confirm(`Delete "${role.role_name}"? Candidate data will be preserved.`)) return;
    setDeleting(role.id);
    try { await apiFetch(`/roles/${role.id}`, { method: "DELETE" }); onSave(); }
    catch (e) { alert("Error: " + e.message); }
    finally { setDeleting(null); }
  };

  const iStyle = { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginBottom: 12 };
  const lStyle = { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 };

  const resolvedPath = (r) =>
    r.folder_name.includes("\\") || r.folder_name.includes("/")
      ? r.folder_name
      : `Applications\\${r.folder_name}`;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Job Roles</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>
            Set the folder path where Outlook saves resumes for each role. The pipeline reads directly from these folders.
          </p>
        </div>
        <button onClick={openCreate} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0, marginLeft: 16 }}>
          + Add Role
        </button>
      </div>

      {roles.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", background: "#f8fafc", borderRadius: 10, border: "1px dashed #e5e7eb" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
          <p style={{ color: "#374151", fontWeight: 600, marginBottom: 4 }}>No roles configured yet</p>
          <p style={{ color: "#9ca3af", fontSize: 13 }}>Add a role and point it to the folder where Outlook saves resumes for that role</p>
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {roles.map(r => (
          <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 15 }}>{r.role_name}</span>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600,
                    background: r.status === "Active" ? "#dcfce7" : "#f3f4f6",
                    color: r.status === "Active" ? "#166534" : "#6b7280" }}>
                    {r.status}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                  background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: "6px 10px" }}>
                  <span>📂</span>
                  <code style={{ fontSize: 12, color: "#0369a1", wordBreak: "break-all" }}>{resolvedPath(r)}</code>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#6b7280" }}>Must have:</span>
                  {r.must_have_skills?.length > 0
                    ? <SkillPills skills={r.must_have_skills} max={6} />
                    : <span style={{ fontSize: 11, color: "#9ca3af" }}>not set</span>}
                </div>
                {r.minimum_experience > 0 && (
                  <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Min experience: {r.minimum_experience}y</div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginLeft: 16, flexShrink: 0 }}>
                <button onClick={() => openEdit(r)} style={{ padding: "6px 14px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Edit</button>
                <button onClick={() => deleteRole(r)} disabled={deleting === r.id}
                  style={{ padding: "6px 14px", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, color: "#dc2626" }}>
                  {deleting === r.id ? "…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editingId !== null && (
        <div onClick={() => setEditingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, padding: 32, maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700 }}>
              {editingId === "new" ? "Add New Role" : `Edit: ${form.role_name}`}
            </h3>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "#6b7280" }}>
              Set the folder where Outlook saves resumes for this role. The pipeline reads directly from this path.
            </p>

            <label style={lStyle}>Role name *</label>
            <input value={form.role_name ?? ""} onChange={e => setForm(f => ({ ...f, role_name: e.target.value }))} style={iStyle} placeholder="e.g. AI Engineer" />

            <label style={{ ...lStyle, color: "#1d4ed8" }}>
              Resume folder path * <span style={{ fontWeight: 400, color: "#6b7280" }}>(where Outlook saves resumes for this role)</span>
            </label>
            <input
              value={form.folder_name ?? ""}
              onChange={e => setForm(f => ({ ...f, folder_name: e.target.value }))}
              style={{ ...iStyle, fontFamily: "monospace", fontSize: 13, border: "1.5px solid #93c5fd", background: "#f0f9ff" }}
              placeholder="C:\Users\HP\Downloads\Resumes\AI_Engineer"
            />
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: -8, marginBottom: 14, padding: "8px 10px", background: "#f8fafc", borderRadius: 6, border: "1px solid #e5e7eb", lineHeight: 1.6 }}>
              Enter the exact folder path where Outlook saves resumes for this role.<br/>
              Examples: <code>C:\Users\HP\Downloads\AI_Engineer</code> or <code>C:\Users\HP\OneDrive\Resumes\AI_Engineer</code><br/>
              Or just enter a simple name like <code>AI_Engineer</code> to use the default Applications folder.
            </div>

            <label style={lStyle}>Must-have skills <span style={{ fontWeight: 400, color: "#9ca3af" }}>(comma-separated)</span></label>
            <input value={form.must_have_skills ?? ""} onChange={e => setForm(f => ({ ...f, must_have_skills: e.target.value }))} style={iStyle} placeholder="Python, FastAPI, LLM, Docker" />

            <label style={lStyle}>Good-to-have skills <span style={{ fontWeight: 400, color: "#9ca3af" }}>(comma-separated)</span></label>
            <input value={form.good_to_have_skills ?? ""} onChange={e => setForm(f => ({ ...f, good_to_have_skills: e.target.value }))} style={iStyle} placeholder="AWS, Kubernetes, RAG" />

            <label style={lStyle}>Minimum experience (years)</label>
            <input type="number" min={0} step={0.5} value={form.minimum_experience ?? 0} onChange={e => setForm(f => ({ ...f, minimum_experience: e.target.value }))} style={iStyle} />

            <label style={lStyle}>Job description <span style={{ fontWeight: 400, color: "#9ca3af" }}>(AI uses this for semantic matching)</span></label>
            <textarea rows={5} value={form.job_description || ""} onChange={e => setForm(f => ({ ...f, job_description: e.target.value }))}
              style={{ ...iStyle, resize: "vertical", fontFamily: "inherit" }}
              placeholder="Paste the full job description here. The AI compares each resume against this to compute similarity scores." />

            <label style={lStyle}>Status</label>
            <select value={form.status || "Active"} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={{ ...iStyle }}>
              <option>Active</option><option>Inactive</option>
            </select>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={() => setEditingId(null)} style={{ padding: "10px 20px", background: "#f3f4f6", border: "none", borderRadius: 8, fontSize: 14, cursor: "pointer" }}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ padding: "10px 24px", background: saving ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {saving ? "Saving…" : editingId === "new" ? "Add Role" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [tab, setTab] = useState("pipeline");
  const [roles, setRoles] = useState([]);
  const [activeRole, setActiveRole] = useState(null);

  const fetchRoles = useCallback(async () => {
    if (!getToken()) return;
    try { setRoles(await apiFetch("/roles/") || []); } catch {}
  }, []);

  useEffect(() => { if (authed) fetchRoles(); }, [authed, fetchRoles]);

  const logout = () => { clearToken(); setAuthed(false); };

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const navBtn = (key, label) => (
    <button key={key} onClick={() => setTab(key)} style={{
      padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
      cursor: "pointer", border: "none",
      background: tab === key ? "#eff6ff" : "transparent",
      color: tab === key ? "#2563eb" : "#374151",
    }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 24px", display: "flex", alignItems: "center", height: 56, gap: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: "#0f172a", marginRight: 24 }}>🤖 AI-ATS</div>
        {[["pipeline", "Pipeline"], ["candidates", "Candidates"], ["jobs", "Job Roles"]].map(([k, l]) => navBtn(k, l))}
        <div style={{ flex: 1 }} />
        <button onClick={logout} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "transparent", color: "#ef4444" }}>Sign out</button>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        {tab === "pipeline" && <PipelinePanel roles={roles} onRolesChange={fetchRoles} />}

        {tab === "candidates" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0f172a", margin: 0 }}>Ranked Candidates</h2>
              <select value={activeRole || ""} onChange={e => setActiveRole(e.target.value || null)}
                style={{ padding: "7px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13 }}>
                <option value="">All roles</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.role_name}</option>)}
              </select>
            </div>
            <CandidatesTable roleId={activeRole} />
          </div>
        )}

        {tab === "jobs" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
            <JDEditor roles={roles} onSave={fetchRoles} />
          </div>
        )}
      </div>
    </div>
  );
}