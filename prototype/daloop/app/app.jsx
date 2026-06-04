/* app.jsx — auth state machine, router, live simulation, Tweaks. */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "surface": "dark",
  "intensity": "balanced",
  "density": "compact",
  "motion": true,
  "cardStyle": "detailed",
  "authStage": "app",
  "admin": true
}/*EDITMODE-END*/;

// pool of plausible agent commit messages for the live sim
const SIM_MSGS = [
  "feat: wire retry with jittered backoff",
  "test: add property tests for fusion ranker",
  "perf: batch embedding calls, -14% p95",
  "fix: handle empty candidate set",
  "refactor: extract scorer into its own module",
  "chore: bump tokenizer to 2.3.1",
  "feat: stream partial results to client",
  "docs: note the shadow-traffic rollout plan",
  "fix: off-by-one in lane weighting",
  "test: soak test stable at 2k agents",
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem("daloop-route")) || { name: "home" }; } catch { return { name: "home" }; }
  });
  const [, bump] = React.useState(0);
  const user = SEED.ME;

  const go = (r) => setRoute(r);
  React.useEffect(() => { localStorage.setItem("daloop-route", JSON.stringify(route)); }, [route]);

  // apply surface/density/intensity/motion to the document root
  React.useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-surface", t.surface);
    el.setAttribute("data-density", t.density);
    el.setAttribute("data-intensity", t.intensity);
    el.setAttribute("data-motion", t.motion ? "on" : "off");
  }, [t.surface, t.density, t.intensity, t.motion]);

  // broadcast card style for the dashboard
  React.useEffect(() => { window.__daloopCardStyle = t.cardStyle; window.dispatchEvent(new Event("daloop-tweak")); }, [t.cardStyle]);

  // transient loading auto-advance
  React.useEffect(() => {
    if (t.authStage === "loading") { const id = setTimeout(() => setTweak("authStage", "app"), 1200); return () => clearTimeout(id); }
  }, [t.authStage]);

  // ---- live simulation: agents reporting commits ----
  React.useEffect(() => {
    if (t.authStage !== "app") return;
    const tick = () => {
      const running = SEED.projects.filter(p => p.status === "running");
      if (!running.length) return;
      const proj = running[Math.floor(Math.random() * running.length)];
      const ph = currentPhase(proj);
      if (!ph) return;
      const msg = SIM_MSGS[Math.floor(Math.random() * SIM_MSGS.length)];
      const sha = (Math.floor(Math.random() * 0xffffff)).toString(16).padStart(6, "0") + "e1";
      const author = proj.phases.flatMap(p => p.commits).slice(-1)[0]?.author || "agent";
      ph.commits.push({ sha, message: msg, author, at: new Date() });
      proj.updatedAt = new Date();
      bump(n => n + 1);
    };
    const id = setInterval(tick, 7000);
    return () => clearInterval(id);
  }, [t.authStage]);

  const signIn = () => { setTweak("authStage", "loading"); };
  const signOut = () => { setTweak("authStage", "signedout"); };

  const panel = (
    <TweaksPanel>
      <TweakSection label="Surface" />
      <TweakRadio label="Theme" value={t.surface} options={["dark", "light"]} onChange={v => setTweak("surface", v)} />
      <TweakSection label="Status & density" />
      <TweakRadio label="Status color" value={t.intensity} options={["muted", "balanced", "vivid"]} onChange={v => setTweak("intensity", v)} />
      <TweakRadio label="Density" value={t.density} options={["airy", "regular", "compact"]} onChange={v => setTweak("density", v)} />
      <TweakToggle label="Motion" value={t.motion} onChange={v => setTweak("motion", v)} />
      <TweakSection label="Cards" />
      <TweakRadio label="Project card" value={t.cardStyle} options={["detailed", "compact"]} onChange={v => setTweak("cardStyle", v)} />
      <TweakSection label="Prototype state" />
      <TweakSelect label="Auth screen" value={t.authStage}
        options={[{ value: "app", label: "In the app" }, { value: "loading", label: "Loading" }, { value: "signedout", label: "Signed out" }, { value: "pending", label: "Request access" }]}
        onChange={v => setTweak("authStage", v)} />
      <TweakToggle label="Platform admin" value={t.admin} onChange={v => setTweak("admin", v)} />
    </TweaksPanel>
  );

  // ---- auth gate ----
  if (t.authStage === "loading") return <>{<LoadingScreen />}{panel}</>;
  if (t.authStage === "signedout") return <>{<SignInScreen onSignIn={signIn} error={null} />}{panel}</>;
  if (t.authStage === "pending") return <>{<RequestAccessScreen user={user} onSignOut={signOut} />}{panel}</>;

  const u = { ...user, admin: t.admin };
  let screen = null;
  if (route.name === "home") screen = <HomeScreen user={u} go={go} />;
  else if (route.name === "dashboard") screen = <DashboardScreen user={u} go={go} />;
  else if (route.name === "project") screen = <ProjectScreen route={route} go={go} />;
  else if (route.name === "teams") screen = <TeamsScreen />;
  else if (route.name === "keys") screen = <KeysScreen />;
  else if (route.name === "admin") screen = u.admin ? <AdminScreen /> : <HomeScreen user={u} go={go} />;
  else screen = <HomeScreen user={u} go={go} />;

  return (
    <div className="app">
      <Header route={route} go={go} user={u} onSignOut={signOut} />
      {screen}
      {panel}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
