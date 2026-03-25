import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:8000" : "");

function getToken() { return localStorage.getItem("ats_token"); }
function setToken(t) { localStorage.setItem("ats_token", t); }
function clearToken() { localStorage.removeItem("ats_token"); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) { clearToken(); window.location.reload(); }
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  if (res.status === 204) return null;
  return res.json();
}

// ── Score bar ──────────────────────────────────────────────────────────────
function ScoreBar({ value = 0 }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 75 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width .4s" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 38 }}>{pct}/100</span>
    </div>
  );
}

// ── Skill pills ────────────────────────────────────────────────────────────
function SkillPills({ skills = [], max = 5 }) {
  const [all, setAll] = useState(false);
  const show = all ? skills : skills.slice(0, max);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {show.map(s => (
        <span key={s} style={{ background: "#eff6ff", color: "#1d4ed8", fontSize: 11, padding: "2px 8px", borderRadius: 12, fontWeight: 500 }}>{s}</span>
      ))}
      {skills.length > max && (
        <button onClick={() => setAll(v => !v)} style={{ background: "none", border: "1px solid #d1d5db", borderRadius: 12, fontSize: 11, padding: "2px 8px", cursor: "pointer", color: "#6b7280" }}>
          {all ? "less" : `+${skills.length - max}`}
        </button>
      )}
    </div>
  );
}

// ── Login ──────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [mode, setMode]         = useState("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]         = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      if (mode === "login") {
        const form = new URLSearchParams({ username: email, password });
        const res = await fetch(`${API}/auth/token`, { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        if (!res.ok) throw new Error("Invalid credentials");
        setToken((await res.json()).access_token); onLogin();
      } else {
        await apiFetch("/auth/register", { method: "POST", body: JSON.stringify({ email, password, full_name: name }) });
        setMode("login"); setError("Account created — sign in now.");
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const inp = { width: "100%", padding: "10px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, marginBottom: 14, boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 4 };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f8fafc" }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 40, width: 400, boxShadow: "0 4px 24px rgba(0,0,0,.08)" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "0 0 4px" }}>🤖 AI-ATS</h1>
        <p style={{ color: "#64748b", fontSize: 13, margin: "0 0 24px" }}>{mode === "login" ? "Sign in to your workspace" : "Create your recruiter account"}</p>
        <form onSubmit={submit}>
          {mode === "register" && <>
            <label style={lbl}>Full name</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inp} required />
          </>}
          <label style={lbl}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={inp} required />
          <label style={lbl}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={{ ...inp, marginBottom: 20 }} required />
          {error && <p style={{ color: mode === "register" && error.includes("created") ? "#16a34a" : "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: "100%", padding: 11, background: loading ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p style={{ marginTop: 14, fontSize: 13, color: "#6b7280", textAlign: "center" }}>
          {mode === "login" ? "No account? " : "Already have an account? "}
          <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
            style={{ background: "none", border: "none", color: "#2563eb", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ── Candidate detail modal ─────────────────────────────────────────────────
function CandidateModal({ c, onClose }) {
  if (!c) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 580, maxHeight: "90vh", overflow: "auto", padding: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{c.name || "Unknown"}</h2>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 14 }}>{c.email}</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#9ca3af" }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[["Phone", c.phone], ["Experience", c.experience_years ? `${c.experience_years} yrs` : "—"], ["Education", c.education], ["Rank", `#${c.rank || "—"}`]].map(([l, v]) => (
            <div key={l} style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" }}>{l}</div>
              <div style={{ fontSize: 14, color: "#0f172a", marginTop: 2, fontWeight: 500 }}>{v || "—"}</div>
            </div>
          ))}
        </div>

        <h3 style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>Match Scores</h3>
        {[["Semantic match", c.semantic_score, "How well resume matches the JD"], ["Skill match", c.skill_score, "Required skills overlap"], ["Experience match", c.experience_score, "Years of experience vs minimum"], ["Final score", c.final_score, "70% semantic + 20% skill + 10% experience"]].map(([l, v, h]) => (
          <div key={l} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: "#374151", fontWeight: l === "Final score" ? 700 : 400 }}>{l}</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{Math.round((v || 0) * 100)}/100</span>
            </div>
            <ScoreBar value={v || 0} />
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>{h}</div>
          </div>
        ))}

        {c.skills?.length > 0 && <>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 16, marginBottom: 8 }}>Skills</h3>
          <SkillPills skills={c.skills} max={20} />
        </>}

        {c.certifications?.length > 0 && <>
          <h3 style={{ fontSize: 12, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 16, marginBottom: 8 }}>Certifications</h3>
          {c.certifications.map((cert, i) => <p key={i} style={{ margin: "2px 0", fontSize: 13 }}>• {cert}</p>)}
        </>}
      </div>
    </div>
  );
}

// ── Top 5 role block ───────────────────────────────────────────────────────
function Top5Block({ roleName, candidates, onView }) {
  const medals = ["🥇", "🥈", "🥉", "4th", "5th"];
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ background: "#1e40af", padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{roleName}</div>
          <div style={{ color: "#93c5fd", fontSize: 12 }}>Top {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}</div>
        </div>
        <div style={{ background: "#1d4ed8", padding: "3px 12px", borderRadius: 20, color: "#bfdbfe", fontSize: 12, fontWeight: 600 }}>
          Best: {Math.round((candidates[0]?.final_score || 0) * 100)}/100
        </div>
      </div>
      {candidates.map((c, i) => (
        <div key={c.id} style={{ display: "flex", alignItems: "center", padding: "12px 18px", gap: 12, borderBottom: i < candidates.length - 1 ? "1px solid #f3f4f6" : "none", background: i === 0 ? "#fffbeb" : "#fff" }}>
          <div style={{ fontSize: i < 3 ? 20 : 13, minWidth: 28, textAlign: "center", fontWeight: 700, color: "#6b7280" }}>{medals[i]}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{c.name || "Unknown"}</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>{c.email}{c.experience_years ? ` · ${c.experience_years}y exp` : ""}</div>
            {c.skills?.length > 0 && <div style={{ marginTop: 4 }}><SkillPills skills={c.skills} max={4} /></div>}
          </div>
          <div style={{ minWidth: 110 }}><ScoreBar value={c.final_score || 0} /></div>
          <button onClick={() => onView(c)} style={{ padding: "5px 14px", background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap" }}>
            View
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Pipeline page ──────────────────────────────────────────────────────────
function PipelinePage({ roles, onRolesChange }) {
  const [selectedRole, setSelectedRole]     = useState("");
  const [jdText, setJdText]                 = useState("");
  const [jdFile, setJdFile]                 = useState(null);
  const [folderPath, setFolderPath]         = useState("");
  const [running, setRunning]               = useState(false);
  const [status, setStatus]                 = useState(null);
  const [top5, setTop5]                     = useState({});
  const [viewCandidate, setViewCandidate]   = useState(null);
  const [showNewRole, setShowNewRole]       = useState(false);
  const [newRole, setNewRole]               = useState({ role_name: "", folder_name: "", must_have_skills: "", minimum_experience: 0 });
  const [savingRole, setSavingRole]         = useState(false);
  const pollRef = useRef(null);

  // Load cached top5 on mount
  useEffect(() => {
    try { setTop5(JSON.parse(localStorage.getItem("ats_top5") || "{}")); } catch {}
  }, []);

  // Pre-fill folder when role selected
  useEffect(() => {
    if (selectedRole) {
      const r = roles.find(r => r.folder_name === selectedRole);
      if (r) {
        setFolderPath(
          r.folder_name.includes("\\") || r.folder_name.includes("/")
            ? r.folder_name : `Applications\\${r.folder_name}`
        );
        if (r.job_description) setJdText(r.job_description);
      }
    } else {
      setFolderPath(""); setJdText("");
    }
  }, [selectedRole, roles]);

  const fetchTop5 = useCallback(async (roleFilter) => {
    const rolesToFetch = roleFilter
      ? roles.filter(r => r.folder_name === roleFilter)
      : roles;
    const result = {};
    for (const r of rolesToFetch) {
      const data = await apiFetch(`/candidates/?limit=5&role_id=${r.id}`);
      if (data?.length) result[r.role_name] = data;
    }
    setTop5(prev => {
      const merged = { ...prev, ...result };
      try { localStorage.setItem("ats_top5", JSON.stringify(merged)); } catch {}
      return merged;
    });
  }, [roles]);

  const pollStatus = useCallback(async () => {
    try {
      const s = await apiFetch("/pipeline/status");
      setStatus(s);
      if (!s.running) {
        clearInterval(pollRef.current);
        setRunning(false);
        await fetchTop5(selectedRole || null);
      }
    } catch {}
  }, [selectedRole, fetchTop5]);

  const run = async () => {
    if (!selectedRole && roles.length === 0) { alert("Add at least one role first."); return; }
    setRunning(true);
    try {
      // If JD text/file provided, update the role's JD first
      if (selectedRole && (jdText || jdFile)) {
        const role = roles.find(r => r.folder_name === selectedRole);
        if (role) {
          let jd = jdText;
          if (jdFile) {
            // Read file as text
            jd = await new Promise((res, rej) => {
              const reader = new FileReader();
              reader.onload = e => res(e.target.result);
              reader.onerror = rej;
              reader.readAsText(jdFile);
            });
          }
          await apiFetch(`/roles/${role.id}`, {
            method: "PUT",
            body: JSON.stringify({
              ...role,
              job_description: jd,
              must_have_skills: role.must_have_skills || [],
              good_to_have_skills: role.good_to_have_skills || [],
            })
          });
          if (onRolesChange) onRolesChange();
        }
      }

      // Also update folder path if changed
      if (selectedRole && folderPath) {
        const role = roles.find(r => r.folder_name === selectedRole);
        if (role) {
          const currentPath = role.folder_name.includes("\\") || role.folder_name.includes("/")
            ? role.folder_name : `Applications\\${role.folder_name}`;
          if (folderPath !== currentPath) {
            await apiFetch(`/roles/${role.id}`, {
              method: "PUT",
              body: JSON.stringify({
                ...role,
                folder_name: folderPath,
                must_have_skills: role.must_have_skills || [],
                good_to_have_skills: role.good_to_have_skills || [],
              })
            });
            if (onRolesChange) onRolesChange();
          }
        }
      }

      const q = selectedRole ? `?role=${selectedRole}` : "";
      await apiFetch(`/pipeline/run${q}`, { method: "POST" });
      pollRef.current = setInterval(pollStatus, 3000);
    } catch (e) {
      alert(e.message);
      setRunning(false);
    }
  };

  const saveNewRole = async () => {
    if (!newRole.role_name.trim() || !newRole.folder_name.trim()) { alert("Role name and folder path are required."); return; }
    setSavingRole(true);
    try {
      const payload = {
        ...newRole,
        job_description: jdText || "",
        must_have_skills: newRole.must_have_skills ? newRole.must_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [],
        good_to_have_skills: [],
        minimum_experience: parseInt(newRole.minimum_experience) || 0,
        status: "Active",
      };
      await apiFetch("/roles/", { method: "POST", body: JSON.stringify(payload) });
      setSelectedRole(newRole.folder_name);
      setShowNewRole(false);
      setNewRole({ role_name: "", folder_name: "", must_have_skills: "", minimum_experience: 0 });
      if (onRolesChange) onRolesChange();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSavingRole(false); }
  };

  const displayRoles = selectedRole
    ? Object.keys(top5).filter(name => roles.find(r => r.folder_name === selectedRole)?.role_name === name)
    : Object.keys(top5).sort();

  const box = { background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb", marginBottom: 16 };
  const badge = n => ({ width: 26, height: 26, borderRadius: "50%", background: "#2563eb", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 });
  const iStyle = { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13, boxSizing: "border-box" };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>

      {/* ── Step 1: Role ─────────────────────────────────────────── */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={badge(1)}>1</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Select Role</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Choose an existing role or add a new one</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <select value={selectedRole} onChange={e => { setSelectedRole(e.target.value); setShowNewRole(false); }} style={{ ...iStyle, flex: 1 }}>
            <option value="">— All roles —</option>
            {roles.map(r => <option key={r.id} value={r.folder_name}>{r.role_name}</option>)}
          </select>
          <button onClick={() => setShowNewRole(v => !v)}
            style={{ padding: "9px 16px", background: showNewRole ? "#eff6ff" : "#f8fafc", border: `1px solid ${showNewRole ? "#bfdbfe" : "#e5e7eb"}`, borderRadius: 8, fontSize: 13, cursor: "pointer", fontWeight: 600, color: "#2563eb", whiteSpace: "nowrap" }}>
            + New Role
          </button>
        </div>

        {showNewRole && (
          <div style={{ marginTop: 14, padding: 16, background: "#f0f9ff", borderRadius: 10, border: "1px solid #bae6fd" }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: "#0369a1", marginBottom: 12 }}>Add New Role</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Role name *</label>
                <input value={newRole.role_name} onChange={e => setNewRole(f => ({ ...f, role_name: e.target.value }))} style={iStyle} placeholder="e.g. AI Engineer" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Min experience (yrs)</label>
                <input type="number" min={0} value={newRole.minimum_experience} onChange={e => setNewRole(f => ({ ...f, minimum_experience: e.target.value }))} style={iStyle} />
              </div>
            </div>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#1d4ed8", display: "block", marginBottom: 4 }}>Resume folder path * (where Outlook saves resumes)</label>
            <input value={newRole.folder_name} onChange={e => setNewRole(f => ({ ...f, folder_name: e.target.value }))} style={{ ...iStyle, fontFamily: "monospace", marginBottom: 10 }} placeholder="C:\Users\HP\Downloads\Resumes\AI_Engineer" />
            <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 }}>Must-have skills (comma-separated)</label>
            <input value={newRole.must_have_skills} onChange={e => setNewRole(f => ({ ...f, must_have_skills: e.target.value }))} style={{ ...iStyle, marginBottom: 12 }} placeholder="Python, FastAPI, LLM" />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowNewRole(false)} style={{ padding: "7px 14px", background: "#f3f4f6", border: "none", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveNewRole} disabled={savingRole} style={{ padding: "7px 16px", background: savingRole ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {savingRole ? "Saving…" : "Save Role"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Step 2: JD ───────────────────────────────────────────── */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={badge(2)}>2</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Job Description</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Upload a JD document or paste the text — used for AI matching</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Upload JD (PDF, DOCX, or TXT)</label>
            <input type="file" accept=".pdf,.docx,.txt"
              onChange={e => { setJdFile(e.target.files[0]); setJdText(""); }}
              style={{ ...iStyle, padding: "7px 10px" }} />
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 1 }}>
            <span style={{ fontSize: 12, color: "#9ca3af", paddingBottom: 10 }}>or</span>
          </div>
        </div>

        <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Paste JD text</label>
        <textarea rows={5} value={jdText} onChange={e => { setJdText(e.target.value); setJdFile(null); }}
          placeholder="Paste the full job description here. The AI uses this to rank candidates by relevance..."
          style={{ ...iStyle, resize: "vertical", fontFamily: "inherit" }} />

        {(jdFile || jdText) && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#16a34a", fontWeight: 600 }}>
            ✓ {jdFile ? `File: ${jdFile.name}` : `Text: ${jdText.length} characters`}
          </div>
        )}
        {!jdFile && !jdText && selectedRole && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#9ca3af" }}>
            No JD provided — will use the JD saved in role settings if available.
          </div>
        )}
      </div>

      {/* ── Step 3: Folder ───────────────────────────────────────── */}
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <div style={badge(3)}>3</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Resume Folder</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Local folder where Outlook saves resumes — auto-filled from selected role</div>
          </div>
        </div>

        <input value={folderPath} onChange={e => setFolderPath(e.target.value)}
          style={{ ...iStyle, fontFamily: "monospace", fontSize: 13 }}
          placeholder="C:\Users\HP\Downloads\Resumes\AI_Engineer" />
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
          Auto-filled from the selected role. Edit here to override for this run only.
        </div>
      </div>

      {/* ── Run button ───────────────────────────────────────────── */}
      <div style={{ ...box, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <button onClick={run} disabled={running}
          style={{ padding: "12px 32px", background: running ? "#93c5fd" : "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: running ? "not-allowed" : "pointer" }}>
          {running ? "⟳ Running pipeline…" : "▶ Run Pipeline"}
        </button>

        {running && <span style={{ fontSize: 13, color: "#6b7280" }}>Processing resumes… this may take a minute.</span>}

        {status?.last_run && !running && (
          <div style={{ display: "flex", gap: 20, marginLeft: "auto" }}>
            {[["Processed", status.last_result?.processed, "#16a34a"], ["Skipped", status.last_result?.skipped, "#d97706"], ["Errors", status.last_result?.errors, "#dc2626"]].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{v ?? 0}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{l}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginLeft: running ? 0 : "auto" }}>
          <button onClick={async () => {
            try {
              const res = await fetch(`${API}/reports/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
              if (!res.ok) { alert("No report yet. Run pipeline first."); return; }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = "Candidate_Ranking.xlsx"; a.click();
              URL.revokeObjectURL(url);
            } catch (e) { alert("Download failed: " + e.message); }
          }} style={{ padding: "9px 16px", background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            ↓ Excel Report
          </button>
        </div>
      </div>

      {/* ── Top 5 results ────────────────────────────────────────── */}
      {displayRoles.length > 0 && (
        <div style={box}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                Top 5 Candidates {selectedRole ? `— ${roles.find(r => r.folder_name === selectedRole)?.role_name}` : `— All Roles (${displayRoles.length})`}
              </h2>
              <p style={{ margin: "3px 0 0", fontSize: 12, color: "#9ca3af" }}>Results from last pipeline run</p>
            </div>
            <button onClick={() => fetchTop5(selectedRole || null)}
              style={{ padding: "7px 14px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#374151" }}>
              ↻ Refresh
            </button>
          </div>

          {displayRoles.map(roleName => (
            <Top5Block key={roleName} roleName={roleName} candidates={top5[roleName] || []} onView={setViewCandidate} />
          ))}
        </div>
      )}

      {displayRoles.length === 0 && !running && (
        <div style={{ ...box, textAlign: "center", padding: "40px 0", color: "#9ca3af" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>No results yet</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Set up a role, add a JD, and click Run Pipeline</div>
        </div>
      )}

      {viewCandidate && <CandidateModal c={viewCandidate} onClose={() => setViewCandidate(null)} />}
    </div>
  );
}

// ── Job Roles page ─────────────────────────────────────────────────────────
function JobRolesPage({ roles, onSave }) {
  const [editingId, setEditingId] = useState(null);
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(null);

  const openCreate = () => { setEditingId("new"); setForm({ role_name: "", folder_name: "", job_description: "", must_have_skills: "", good_to_have_skills: "", minimum_experience: 0, status: "Active" }); };
  const openEdit   = r => { setEditingId(r.id); setForm({ ...r, must_have_skills: (r.must_have_skills || []).join(", "), good_to_have_skills: (r.good_to_have_skills || []).join(", ") }); };

  const save = async () => {
    if (!form.role_name?.trim() || !form.folder_name?.trim()) { alert("Role name and folder path are required."); return; }
    setSaving(true);
    try {
      const p = { ...form, must_have_skills: form.must_have_skills ? form.must_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [], good_to_have_skills: form.good_to_have_skills ? form.good_to_have_skills.split(",").map(s => s.trim()).filter(Boolean) : [], minimum_experience: parseInt(form.minimum_experience) || 0 };
      if (editingId === "new") await apiFetch("/roles/", { method: "POST", body: JSON.stringify(p) });
      else await apiFetch(`/roles/${editingId}`, { method: "PUT", body: JSON.stringify(p) });
      setEditingId(null); onSave();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  };

  const del = async r => {
    if (!confirm(`Delete "${r.role_name}"? Candidates are preserved.`)) return;
    setDeleting(r.id);
    try { await apiFetch(`/roles/${r.id}`, { method: "DELETE" }); onSave(); }
    catch (e) { alert(e.message); }
    finally { setDeleting(null); }
  };

  const iS = { width: "100%", padding: "9px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, boxSizing: "border-box", marginBottom: 12 };
  const lS = { fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Job Roles</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6b7280" }}>Manage roles and their resume folder paths</p>
        </div>
        <button onClick={openCreate} style={{ padding: "8px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>+ Add Role</button>
      </div>

      {roles.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", background: "#f8fafc", borderRadius: 10, border: "1px dashed #e5e7eb" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
          <p style={{ color: "#374151", fontWeight: 600, marginBottom: 4 }}>No roles yet</p>
          <p style={{ color: "#9ca3af", fontSize: 13 }}>Click "+ Add Role" to configure your first job role</p>
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {roles.map(r => {
          const path = r.folder_name.includes("\\") || r.folder_name.includes("/") ? r.folder_name : `Applications\\${r.folder_name}`;
          return (
            <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{r.role_name}</span>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600, background: r.status === "Active" ? "#dcfce7" : "#f3f4f6", color: r.status === "Active" ? "#166534" : "#6b7280" }}>{r.status}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 6, padding: "5px 10px" }}>
                    <span>📂</span>
                    <code style={{ fontSize: 12, color: "#0369a1", wordBreak: "break-all" }}>{path}</code>
                  </div>
                  {r.must_have_skills?.length > 0 && <SkillPills skills={r.must_have_skills} max={6} />}
                  {r.minimum_experience > 0 && <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>Min exp: {r.minimum_experience}y</div>}
                </div>
                <div style={{ display: "flex", gap: 8, marginLeft: 16, flexShrink: 0 }}>
                  <button onClick={() => openEdit(r)} style={{ padding: "6px 14px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Edit</button>
                  <button onClick={() => del(r)} disabled={deleting === r.id} style={{ padding: "6px 14px", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600, color: "#dc2626" }}>
                    {deleting === r.id ? "…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editingId !== null && (
        <div onClick={() => setEditingId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 560, padding: 32, maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 20px", fontSize: 18, fontWeight: 700 }}>{editingId === "new" ? "Add New Role" : `Edit: ${form.role_name}`}</h3>

            <label style={lS}>Role name *</label>
            <input value={form.role_name ?? ""} onChange={e => setForm(f => ({ ...f, role_name: e.target.value }))} style={iS} placeholder="e.g. AI Engineer" />

            <label style={{ ...lS, color: "#1d4ed8" }}>Resume folder path * <span style={{ fontWeight: 400, color: "#6b7280" }}>(where Outlook saves resumes)</span></label>
            <input value={form.folder_name ?? ""} onChange={e => setForm(f => ({ ...f, folder_name: e.target.value }))} style={{ ...iS, fontFamily: "monospace", fontSize: 13, border: "1.5px solid #93c5fd", background: "#f0f9ff" }} placeholder="C:\Users\HP\Downloads\Resumes\AI_Engineer" />
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: -8, marginBottom: 14, lineHeight: 1.6 }}>
              Enter the folder where Outlook saves resumes for this role.<br/>
              E.g. <code>C:\Users\HP\Downloads\AI_Engineer</code> or just <code>AI_Engineer</code>
            </div>

            <label style={lS}>Must-have skills <span style={{ fontWeight: 400, color: "#9ca3af" }}>(comma-separated)</span></label>
            <input value={form.must_have_skills ?? ""} onChange={e => setForm(f => ({ ...f, must_have_skills: e.target.value }))} style={iS} placeholder="Python, FastAPI, LLM, Docker" />

            <label style={lS}>Good-to-have skills <span style={{ fontWeight: 400, color: "#9ca3af" }}>(comma-separated)</span></label>
            <input value={form.good_to_have_skills ?? ""} onChange={e => setForm(f => ({ ...f, good_to_have_skills: e.target.value }))} style={iS} placeholder="AWS, Kubernetes, RAG" />

            <label style={lS}>Minimum experience (years)</label>
            <input type="number" min={0} step={0.5} value={form.minimum_experience ?? 0} onChange={e => setForm(f => ({ ...f, minimum_experience: e.target.value }))} style={iS} />

            <label style={lS}>Job description <span style={{ fontWeight: 400, color: "#9ca3af" }}>(AI semantic matching)</span></label>
            <textarea rows={5} value={form.job_description || ""} onChange={e => setForm(f => ({ ...f, job_description: e.target.value }))} style={{ ...iS, resize: "vertical", fontFamily: "inherit" }} placeholder="Paste the full job description here." />

            <label style={lS}>Status</label>
            <select value={form.status || "Active"} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} style={{ ...iS }}>
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

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed]   = useState(!!getToken());
  const [tab, setTab]         = useState("pipeline");
  const [roles, setRoles]     = useState([]);

  const fetchRoles = useCallback(async () => {
    if (!getToken()) return;
    try { setRoles(await apiFetch("/roles/") || []); } catch {}
  }, []);

  useEffect(() => { if (authed) fetchRoles(); }, [authed, fetchRoles]);

  const logout = () => { clearToken(); setAuthed(false); };

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  const navBtn = (key, label) => (
    <button key={key} onClick={() => setTab(key)} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: tab === key ? "#eff6ff" : "transparent", color: tab === key ? "#2563eb" : "#374151" }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 24px", display: "flex", alignItems: "center", height: 56, gap: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: "#0f172a", marginRight: 20 }}>🤖 AI-ATS</div>
        {[["pipeline", "Pipeline"], ["jobs", "Job Roles"]].map(([k, l]) => navBtn(k, l))}
        <div style={{ flex: 1 }} />
        <button onClick={logout} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "transparent", color: "#ef4444" }}>Sign out</button>
      </div>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        {tab === "pipeline" && <PipelinePage roles={roles} onRolesChange={fetchRoles} />}
        {tab === "jobs" && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, border: "1px solid #e5e7eb" }}>
            <JobRolesPage roles={roles} onSave={fetchRoles} />
          </div>
        )}
      </div>
    </div>
  );
}