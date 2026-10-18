// Small Lucide-style inline icons for module screens (stroke 2, round caps, currentColor).
const base = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;

export const IconCheck = () => <svg {...base} className="pm-icon"><path d="M20 6 9 17l-5-5" /></svg>;
export const IconX = () => <svg {...base} className="pm-icon"><path d="M18 6 6 18M6 6l12 12" /></svg>;

const STAR = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";
/** Five stars, `n` filled. */
export function StarRow(props: { n: number }) {
  return (
    <span className="pm-stars" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} {...base} width={12} height={12} className="pm-icon" fill={i <= props.n ? "currentColor" : "none"}><path d={STAR} /></svg>
      ))}
    </span>
  );
}
