import { useState, useEffect } from "react";
import { ROUTES, isExtraTool } from "./modules";
import { useRoute, navigate } from "./core/nav";
import { AiModePill, Toasts, Button, Icon, ThemeSelect } from "./core/ui";
import { useBackend } from "./core/store";
import { useUiPrefs } from "./screens/settings";
import { BRAND } from "./core/brand";

const GROUPS = [
  { id: "business", label: "Your business" },
  { id: "core", label: "Extra tools" },
  { id: "more", label: "More extra tools" },
] as const;

function Mark() {
  // Supplied Polar bear logo, used as-is (never redrawn). White tile via .pm-logo so it also reads in dark mode.
  return <img className="pm-logo" src="/brand/logo/polar-mark.png" alt="" width={40} height={40} />;
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
        location.replace("/login#admin"); // the sign-in page asks for the password (or creates it the first time)
      })
      .catch(() => setAuth("local"));
  }, []);
  return auth;
}

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  location.href = "/login";
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
        <div className="rail-foot"><ThemeSelect /></div>
       </div>
      </nav>
      <div className="main">
        <div className="topbar">
          <span className="menu-btn"><Button small onClick={() => setOpen(!open)}><Icon name="menu" size="sm" />Menu</Button></span>
          <span className="small faint">{backend === "cloud" ? "Saved to your workspace" : backend === "browser" ? "Saved in this browser" : ""}</span>
          <AiModePill />
          <span className="topbar-theme"><ThemeSelect compact /></span>
          {auth === "signed-in" && <Button small onClick={() => void signOut()}>Sign out</Button>}
        </div>
        <current.Screen key={route} />
      </div>
      <Toasts />
    </div>
  );
}
