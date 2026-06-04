/* Daloop seed data — emulates what streams from Firestore.
   Humans never author this; agents report it via the API. */
(function () {
  const now = Date.now();
  const m = (min) => new Date(now - min * 60000);
  const h = (hr) => new Date(now - hr * 3600000);
  const d = (day) => new Date(now - day * 86400000);

  const ME = { uid: "u_rav3f9", email: "rav@openloopagentics.com", name: "Ravikant Cherukuri", admin: true };

  // ---- people ----
  const P = {
    rav:  { uid: "u_rav3f9", email: "rav@openloopagentics.com",   name: "Ravikant Cherukuri" },
    mira: { uid: "u_mira21", email: "mira@openloopagentics.com",  name: "Mira Okafor" },
    dev:  { uid: "u_dev88x", email: "devon@openloopagentics.com", name: "Devon Reyes" },
    sun:  { uid: "u_sun14k", email: "sun@openloopagentics.com",   name: "Sun-Hee Park" },
    bao:  { uid: "u_bao77p", email: "bao@openloopagentics.com",   name: "Bao Tran" },
    eli:  { uid: "u_eli05r", email: "eli@contractor.dev",         name: "Eli Marsh" },
  };

  // ---- commit helpers ----
  let shaSeed = 0xa31f08;
  const sha = () => { shaSeed = (shaSeed * 1103515245 + 12345) & 0xffffff; return shaSeed.toString(16).padStart(6, "0") + "e1"; };
  const C = (message, author, at) => ({ sha: sha(), message, author, at });

  // ---- phase factory ----
  const phase = (name, order, status, startedAt, endedAt, commits) =>
    ({ id: "ph_" + name.toLowerCase() + "_" + order, name, order, status, startedAt, endedAt, commits: commits || [] });

  // ===================================================================
  // PROJECTS
  // ===================================================================
  const projects = [
    {
      id: "pr_atlas", teamId: "t_core", title: "Atlas retrieval rewrite", slug: "atlas-retrieval",
      status: "running", updatedAt: m(2), currentPhaseId: "ph_build_2",
      design: { type: "markdown", content: "## Goal\nReplace the v1 dense retriever with a **hybrid** BM25 + embedding pipeline, cut p95 latency below **180ms**, and keep recall@10 above 0.9.\n\n### Constraints\n- No new infra; reuse the existing vector store.\n- Migration must be online — zero downtime.\n\n### Done when\n- [x] Benchmark harness lands\n- [ ] Hybrid scorer behind a flag\n- [ ] Shadow traffic at 10%" },
      phases: [
        phase("Research", 1, "completed", d(6), d(4), [
          C("research: survey hybrid scoring approaches", P.rav.name, d(6)),
          C("docs: write up tradeoffs of rrf vs weighted-sum", P.rav.name, d(5)),
          C("bench: baseline recall@10 = 0.871, p95 = 244ms", P.mira.name, d(4)),
        ]),
        phase("Build", 2, "running", d(4), null, [
          C("feat: scaffold hybrid scorer module", P.mira.name, h(20)),
          C("feat: BM25 index builder + incremental updates", P.mira.name, h(11)),
          C("feat: reciprocal rank fusion behind DALOOP flag", P.dev.name, h(4)),
          C("perf: cache embedding lookups, p95 244 -> 191ms", P.dev.name, m(54)),
          C("test: add fusion golden tests (12 cases)", P.mira.name, m(2)),
        ]),
        phase("Test", 3, "queued", null, null, []),
        phase("Ship", 4, "queued", null, null, []),
      ],
    },
    {
      id: "pr_ledger", teamId: "t_core", title: "Billing ledger migration", slug: "billing-ledger",
      status: "blocked", updatedAt: m(38), currentPhaseId: "ph_build_2",
      design: { type: "url", content: "https://notion.so/openloop/ledger-migration-rfc" },
      phases: [
        phase("Research", 1, "completed", d(12), d(10), [
          C("docs: ledger schema RFC + double-entry model", P.dev.name, d(11)),
        ]),
        phase("Build", 2, "blocked", d(9), null, [
          C("feat: append-only ledger table + writer", P.dev.name, d(7)),
          C("feat: backfill job for historical invoices", P.dev.name, d(3)),
          C("chore: blocked — waiting on finance sign-off for tax rules", P.dev.name, m(38)),
        ]),
        phase("Test", 3, "queued", null, null, []),
        phase("Ship", 4, "queued", null, null, []),
      ],
    },
    {
      id: "pr_voice", teamId: "t_core", title: "Voice agent latency pass", slug: "voice-latency",
      status: "completed", updatedAt: h(9), currentPhaseId: "ph_ship_4",
      design: { type: "markdown", content: "## Goal\nGet round-trip voice latency under **700ms** end to end. Streaming TTS + speculative ASR." },
      phases: [
        phase("Research", 1, "completed", d(20), d(18), [ C("research: profile the voice pipeline hot path", P.sun.name, d(19)) ]),
        phase("Build", 2, "completed", d(18), d(12), [
          C("feat: streaming TTS with sentence chunking", P.sun.name, d(16)),
          C("feat: speculative ASR decode", P.sun.name, d(13)),
        ]),
        phase("Test", 3, "completed", d(12), d(10), [ C("test: latency suite green, p95 = 642ms", P.sun.name, d(11)) ]),
        phase("Ship", 4, "completed", d(10), h(9), [ C("release: voice v2 rolled to 100%", P.sun.name, h(9)) ]),
      ],
    },
    {
      id: "pr_sched", teamId: "t_infra", title: "Agent scheduler v3", slug: "scheduler-v3",
      status: "running", updatedAt: m(1), currentPhaseId: "ph_test_3",
      design: { type: "markdown", content: "## Goal\nPreemptive, fair-share scheduling across agent fleets with **priority lanes** and backpressure." },
      phases: [
        phase("Research", 1, "completed", d(15), d(13), [ C("docs: fair-share vs strict-priority writeup", P.bao.name, d(14)) ]),
        phase("Build", 2, "completed", d(13), d(5), [
          C("feat: priority lanes + weighted queue", P.bao.name, d(11)),
          C("feat: backpressure signal from worker pool", P.bao.name, d(6)),
        ]),
        phase("Test", 3, "running", d(5), null, [
          C("test: soak test at 2k concurrent agents", P.bao.name, h(30)),
          C("fix: starvation under burst load", P.bao.name, h(6)),
          C("test: fairness index 0.94 across lanes", P.bao.name, m(1)),
        ]),
        phase("Ship", 4, "queued", null, null, []),
      ],
    },
    {
      id: "pr_obs", teamId: "t_infra", title: "Observability pipeline", slug: "observability",
      status: "failed", updatedAt: h(3), currentPhaseId: "ph_build_2",
      design: { type: "markdown", content: "## Goal\nUnified trace + metric ingestion for all agent runs. OTel everywhere." },
      phases: [
        phase("Research", 1, "completed", d(8), d(7), [ C("research: OTel collector topology options", P.eli.name, d(8)) ]),
        phase("Build", 2, "failed", d(7), h(3), [
          C("feat: OTel collector deploy + sampling", P.eli.name, d(5)),
          C("feat: trace -> span store writer", P.eli.name, d(2)),
          C("fix: collector OOM under fan-out — reverted", P.eli.name, h(3)),
        ]),
        phase("Test", 3, "cancelled", null, null, []),
        phase("Ship", 4, "cancelled", null, null, []),
      ],
    },
    {
      id: "pr_eval", teamId: "t_infra", title: "Eval harness 2.0", slug: "eval-harness",
      status: "paused", updatedAt: d(2), currentPhaseId: "ph_build_2",
      design: { type: "markdown", content: "## Goal\nDeterministic, replayable evals with cached LLM responses and graded rubrics." },
      phases: [
        phase("Research", 1, "completed", d(14), d(12), [ C("docs: rubric grading spec", P.mira.name, d(13)) ]),
        phase("Build", 2, "paused", d(12), null, [
          C("feat: response cache keyed on prompt hash", P.mira.name, d(6)),
          C("chore: paused for Q3 planning", P.mira.name, d(2)),
        ]),
        phase("Test", 3, "queued", null, null, []),
      ],
    },
    {
      id: "pr_docs", teamId: "t_labs", title: "Self-writing docs", slug: "self-writing-docs",
      status: "queued", updatedAt: d(1), currentPhaseId: "ph_research_1",
      design: { type: "markdown", content: "## Goal\nAgents that keep API docs in sync with the codebase on every merge." },
      phases: [
        phase("Research", 1, "queued", null, null, []),
        phase("Build", 2, "queued", null, null, []),
      ],
    },
    {
      id: "pr_sandbox", teamId: "t_labs", title: "Sandbox escape hardening", slug: "sandbox-hardening",
      status: "cancelled", updatedAt: d(5), currentPhaseId: "ph_research_1",
      design: { type: "markdown", content: "## Goal\nSuperseded by the platform-wide gVisor rollout. Kept for history." },
      phases: [
        phase("Research", 1, "cancelled", d(9), d(5), [ C("research: threat model draft", P.bao.name, d(9)) ]),
      ],
    },
  ];

  // ===================================================================
  // TEAMS
  // ===================================================================
  const teams = [
    {
      id: "t_core", name: "OpenLoop Core", myRole: "owner",
      members: [
        { ...P.rav, role: "owner" }, { ...P.mira, role: "admin" },
        { ...P.dev, role: "member" }, { ...P.sun, role: "member" },
      ],
      sentInvites: [ { id: "iv_1", email: "noah@openloopagentics.com", role: "member", sentAt: d(1) } ],
    },
    {
      id: "t_infra", name: "Agent Infra", myRole: "admin",
      members: [
        { ...P.bao, role: "owner" }, { ...P.rav, role: "admin" },
        { ...P.eli, role: "member" },
      ],
      sentInvites: [],
    },
    {
      id: "t_labs", name: "Labs", myRole: "member",
      members: [ { ...P.sun, role: "owner" }, { ...P.rav, role: "member" }, { ...P.mira, role: "member" } ],
      sentInvites: [],
    },
  ];

  const myInvites = [
    { id: "in_a", teamName: "Growth Experiments", fromEmail: "mira@openloopagentics.com", role: "member" },
    { id: "in_b", teamName: "Security", fromEmail: "bao@openloopagentics.com", role: "admin" },
  ];

  // ===================================================================
  // API KEYS
  // ===================================================================
  const apiKeys = [
    { id: "k_1", label: "atlas-ci",        prefix: "dlp_live_7Qx", createdAt: d(22), lastUsedAt: m(2) },
    { id: "k_2", label: "laptop-dev",      prefix: "dlp_live_a0F", createdAt: d(9),  lastUsedAt: h(5) },
    { id: "k_3", label: "scheduler-agent", prefix: "dlp_live_M3z", createdAt: d(40), lastUsedAt: m(1) },
    { id: "k_4", label: "old-prototype",   prefix: "dlp_live_kP8", createdAt: d(120), lastUsedAt: d(60) },
  ];

  // ===================================================================
  // ALLOWLIST (admin area)
  // ===================================================================
  const allowlist = [
    { ...P.rav,  allowed: true,  admin: true },
    { ...P.mira, allowed: true,  admin: true },
    { ...P.dev,  allowed: true,  admin: false },
    { ...P.sun,  allowed: true,  admin: false },
    { ...P.bao,  allowed: true,  admin: false },
    { ...P.eli,  allowed: true,  admin: false },
    { uid: "u_pend01", email: "jordan@openloopagentics.com", name: "Jordan Vale", allowed: false, admin: false },
    { uid: "u_pend02", email: "kai@partner.io",              name: "Kai Lund",    allowed: false, admin: false },
  ];

  window.SEED = { ME, P, teams, projects, myInvites, apiKeys, allowlist };
})();
