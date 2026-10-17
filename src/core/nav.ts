import { useEffect, useState } from "react";

export const routeFromHash = () => location.hash.replace(/^#/, "") || "dashboard";

export function navigate(route: string) {
  location.hash = route;
}

export function useRoute() {
  const [r, setR] = useState(routeFromHash());
  useEffect(() => {
    const h = () => { setR(routeFromHash()); document.querySelector(".main")?.scrollTo?.(0, 0); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return r;
}
