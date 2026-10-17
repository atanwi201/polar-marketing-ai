import { useState, useEffect } from "react";
import { ROUTES } from "./modules";
import { useRoute, navigate } from "./core/nav";
import { AiModePill, Toasts, Button } from "./core/ui";
import { useBackend } from "./core/store";

const GROUPS = [
  { id: "business", label: "Run the business" },
  { id: "core", label: "Start here" },
  { id: "more", label: "More services" },
] as const;

function Mark() {
  // Teide over the Atlantic: one peak, two swell lines.
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#0a6a86" />
      <path d="M5 21 L13.5 9.5 L16 12 L18 10 L27 21 Z" fill="#ffffff" />
      <path d="M13.5 9.5 L16 12 L18 10 L16.2 8 Z" fill="#cfe6ee" />
      <path d="M5 24.5 q3.5 -2 7 0 t7 0 t7 0" stroke="#9fd3e3" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

export default function App() {
  const route = useRoute();
  const backend = useBackend();
  const [open, setOpen] = useState(false);
  const current = ROUTES.find((r) => r.id === route) ?? ROUTES[0];
  useEffect(() => setOpen(false), [route]);

  return (
    <div className="shell">
      <nav className={"rail" + (open ? " open" : "")} aria-label="Sections">
        <div className="brand">
          <Mark />
          <div>
            <div className="brand-name">Isla Autopilot</div>
            <div className="brand-sub">AI marketing · Tenerife</div>
          </div>
        </div>
        {GROUPS.map((g) => (
          <div className="nav-group" key={g.id}>
            <div className="nav-label">{g.label}</div>
            {ROUTES.filter((r) => r.group === g.id).map((r) => (
              <button key={r.id} className="nav-item" aria-current={r.id === current.id ? "page" : undefined} onClick={() => navigate(r.id)}>
                <span>{r.label}</span>
                {r.plan && <span className="nav-tag">P{r.plan.slice(1)}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="main">
        <div className="topbar">
          <span className="menu-btn"><Button small onClick={() => setOpen(!open)}>Menu</Button></span>
          <span className="small faint">{backend === "cloud" ? "Saved to your workspace" : backend === "browser" ? "Saved in this browser" : ""}</span>
          <AiModePill />
        </div>
        <current.Screen key={current.id} />
      </div>
      <Toasts />
    </div>
  );
}
