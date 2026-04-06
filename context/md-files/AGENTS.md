\# AGENTS.md

\#\# Purpose  
This repository powers Maibel / Evren, a stateful Telegram AI companion product for women's wellness.

The system is launch-stage and user trust is fragile. Work like a pragmatic senior technical lead supporting a lean zero-to-one team. Optimize for safety, correctness, speed of learning, and low blast radius.

\#\# Repository Shape  
\- \`langgraph-agents/\`: backend, orchestration, agents, prompts, services, schedulers, API handlers  
\- \`database-scripts/\`: SQL and database-related scripts  
\- repo root: Dockerfiles, environment setup, deployment-adjacent files, and top-level docs

Before proposing changes, identify the smallest subsystem likely responsible.

\#\# Default Working Rules  
\- Plan briefly before patching.  
\- Prefer the smallest safe change over redesign.  
\- Do not broaden scope without a clear reason.  
\- Do not mix bug fixes with cleanup unless cleanup is required for correctness.  
\- Treat production behavior, state continuity, safety, and scheduler correctness as high risk.  
\- Separate facts, hypotheses, risks, and unknowns when diagnosing issues.  
\- If evidence is missing, say exactly what is missing.

\#\# Launch-Stage Priorities  
Prioritize in this order:  
1\. Safety and trust failures  
2\. Behavioral correctness and emotional consistency  
3\. Core loop reliability and continuity  
4\. Onboarding and first-use experience  
5\. Scheduler and proactive messaging correctness  
6\. Internal cleanup only when it materially reduces launch risk

Do not recommend broad refactors during launch stabilization unless the current path is clearly unsafe.

\#\# Environment Discipline  
Always identify the environment first before diagnosing or recommending action:  
\- \`main\`: production  
\- \`staging\`: integration and manual validation  
\- \`auto-eval\`: evaluation-only lane, if used

Do not assume staging or eval behavior reflects production.  
Do not recommend direct experimentation on production.

\#\# Change Discipline  
For any non-trivial code change, include:  
\- intended behavior  
\- likely subsystem or files  
\- smallest safe fix shape  
\- validation steps  
\- rollback path  
\- regression risks

If touching deployment, CI, scheduler behavior, webhook handling, environment config, or database-impacting logic, explicitly call out rollout risk.

\#\# Context Files  
If present, check \`context/index.md\` first for the current command-centre entry point.

Use the split docs in \`context/\` as current operating context on:  
\- launch decisions  
\- incident handling  
\- evaluation flow  
\- release discipline  
\- team handoff norms

Use \`context/v2\_technical\_command\_centre(20.03).md\` as the consolidated source when needed.

Treat these docs as current operating context, not permanent product spec.  
If they conflict with older assumptions, prefer the current \`context/\` docs for the task at hand.

Do not copy fast-changing launch state into this file.

\#\# Project / Checkout Preflight  
Before making changes on tasks that depend on local docs, branch context, or worktree-specific state, confirm:  
\- current project root  
\- current git branch  
\- required context files are visible in the current checkout

If expected context files are missing, stop and report that the thread may be attached to the wrong checkout.

\#\# Lane Discipline  
When diagnosing or proposing work, first determine whether the issue is primarily:  
\- system truth / runtime truth  
\- experience truth / behavior quality

Default operating split:  
\- Mabel: prioritization, final behavior direction, release-risk judgment  
\- Chloe: system truth, implementation safety, blast radius, rollback shape  
\- Michelle: experience truth, behavior investigation, rule definition, eval interpretation

Do not blur behavior diagnosis and implementation ownership by default.

\#\# Communication  
Be concise, direct, and operational.

For investigations, favor:  
\- What we know  
\- What we do not know  
\- Top hypotheses  
\- Immediate next checks  
\- Recommended smallest next step

For implementation proposals, favor:  
\- Plan  
\- Scope  
\- Risk  
\- Smallest safe change  
\- Validation  
\- Rollback

\#\# When To Ask vs Assume  
Make reasonable assumptions when risk is low and local context is sufficient.

Ask before proceeding if:  
\- the change has meaningful product-risk tradeoffs  
\- production behavior could be affected  
\- intended behavior is ambiguous  
\- there are multiple plausible fixes with different blast radius

\#\# What Not To Do  
\- Do not treat Codex as product owner.  
\- Do not invent requirements not grounded in code or provided context.  
\- Do not recommend architecture rewrites by default.  
\- Do not treat "probably" as "validated".  
\- Do not hide uncertainty.

\#\# Canary Brain rules  
\- Keep Canary Brain work local-only unless explicitly told otherwise.  
\- For Phase 2a, do not implement scheduler integration, send behavior, or DB writes.  
\- Prefer contract-first planning before code.  
\- Treat weak data as weak; do not present inferred state as confirmed truth.  
\- Keep diffs small and isolated.  
