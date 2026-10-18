import { useState, useEffect } from "react";
import { ROUTES, isExtraTool } from "./modules";
import { useRoute, navigate } from "./core/nav";
import { AiModePill, Toasts, Button } from "./core/ui";
import { useBackend } from "./core/store";
import { useUiPrefs } from "./screens/settings";
import { BRAND } from "./core/brand";

const GROUPS = [
  { id: "business", label: "Your business" },
  { id: "core", label: "Extra tools" },
  { id: "more", label: "More extra tools" },
] as const;

function Mark() {
  // Crier mark (brand/logo/crier-mark-dark.svg): two signal arcs forming a C around a sun dot.
  return (
    <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="15" fill="#1c2a2e" />
      <g fill="none" stroke="#3dd6d0" strokeWidth="5.6" strokeLinecap="round">
        <path d="M44.77 23.33A11 11 0 1 0 44.77 40.67" />
        <path d="M53.11 17.41A21 21 0 1 0 53.11 46.59" />
      </g>
      <circle cx="38" cy="32" r="5.2" fill="#ffc53d" />
    </svg>
  );
}

type Auth = "checking" | "signed-in" | "local";

/** Ask the server whether we're signed in; without a server (artifact / offline) the app runs locally. */
function useAdminAuth(): Auth {
  const [auth, setAuth] = useState<Auth>("checking");
  useEffect(() => {
    fetch("/api/auth", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d: { admin?: boolean; setup?: boolean }) => {
        if (typeof d?.setup !== "boolean") return setAuth("local");
        if (d.admin) return setAuth("signed-in");
        location.replace("/#admin"); // the landing page asks for the password (or creates it the first time)
      })
      .catch(() => setAuth("local"));
  }, []);
  return auth;
}

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  location.href = "/";
}

export default function App() {
  const auth = useAdminAuth();
  const route = useRoute();
  const backend = useBackend();
  const [open, setOpen] = useState(false);
  const { showTools } = useUiPrefs();
  const visible = ROUTES.filter((r) => !r.hidden && (showTools || !isExtraTool(r)));
  // A hidden tool still opens from a direct link, so nothing is lost. "business/<id>" opens one business.
  const current = ROUTES.find((r) => r.id === route.split("/")[0]) ?? ROUTES[0];
  const navId = current.navAs ?? current.id;
  useEffect(() => setOpen(false), [route]);
  useEffect(() => { document.title = BRAND; }, []);
  if (auth === "checking") return null;

  return (
    <div className="shell">
      <nav className={"rail" + (open ? " open" : "")} aria-label="Sections">
       <div className="rail-in">
        <div className="brand">
          <Mark />
          <div>
            <div className="brand-name">{BRAND}</div>
            <div className="brand-sub">AI marketing · Tenerife</div>
          </div>
        </div>
        {GROUPS.filter((g) => visible.some((r) => r.group === g.id)).map((g) => (
          <div className="nav-group" key={g.id}>
            <div className="nav-label">{g.label}</div>
            {visible.filter((r) => r.group === g.id).map((r) => (
              <button key={r.id} className="nav-item" aria-current={r.id === navId ? "page" : undefined} onClick={() => navigate(r.id)}>
                <span>{r.label}</span>

              </button>
            ))}
          </div>
        ))}
       </div>
      </nav>
      <div className="main">
        <div className="topbar">
          <span className="menu-btn"><Button small onClick={() => setOpen(!open)}>Menu</Button></span>
          <span className="small faint">{backend === "cloud" ? "Saved to your workspace" : backend === "browser" ? "Saved in this browser" : ""}</span>
          <AiModePill />
          {auth === "signed-in" && <Button small onClick={() => void signOut()}>Sign out</Button>}
        </div>
        <current.Screen key={route} />
      </div>
      <Toasts />
    </div>
  );
}
