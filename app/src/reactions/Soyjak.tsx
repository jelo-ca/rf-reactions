// A hand-drawn soyjak homage (inline SVG, drawn for this app — no downloaded meme images), pointing
// to the right: wide open mouth, glasses, raised eyebrows, stubble, one arm up with a pointing finger.
// Mirror it with CSS (scaleX(-1)) to point left.

const STUBBLE: [number, number][] = [];
for (let i = 0; i < 46; i++) {
  const a = Math.PI * (0.12 + (0.76 * i) / 45);
  const r = 58 + ((i * 7) % 5);
  STUBBLE.push([100 + Math.cos(a) * r * 0.95, 118 + Math.sin(a) * r * 0.95]);
}

export function Soyjak({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 260 260" aria-hidden="true">
      <g stroke="#111" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        {/* body + shirt */}
        <path d="M30 262 Q34 200 100 196 Q166 200 172 262 Z" fill="#6b8fb3" />
        {/* pointing arm: shoulder → forearm up and out → hand */}
        <path d="M150 214 Q196 200 214 150 L232 156 Q216 214 160 238 Z" fill="#6b8fb3" />
        <path d="M212 152 Q210 136 222 132 L250 126 Q258 126 256 133 Q252 138 232 140 Q240 146 236 156 Q228 162 214 158 Z" fill="#f4efe6" />
        {/* head */}
        <path d="M44 88 Q42 22 100 18 Q158 22 158 88 L160 128 Q156 186 100 194 Q44 186 40 128 Z" fill="#f4efe6" />
        {/* ears */}
        <path d="M44 96 Q28 96 32 116 Q36 128 46 126" fill="#f4efe6" />
        <path d="M156 96 Q172 96 168 116 Q164 128 154 126" fill="#f4efe6" />
        {/* thin hair on top */}
        <path d="M70 30 Q74 22 80 28 M92 22 Q96 14 102 22 M114 24 Q120 18 124 28 M132 32 Q138 26 140 36" fill="none" strokeWidth="2.5" />
        {/* raised worried eyebrows */}
        <path d="M58 64 Q72 50 90 60" fill="none" />
        <path d="M112 60 Q128 50 142 64" fill="none" />
        {/* glasses */}
        <rect x="54" y="68" width="40" height="30" rx="9" fill="rgba(190,225,255,0.35)" />
        <rect x="106" y="68" width="40" height="30" rx="9" fill="rgba(190,225,255,0.35)" />
        <path d="M94 80 Q100 76 106 80" fill="none" />
        <circle cx="75" cy="84" r="3.5" fill="#111" />
        <circle cx="125" cy="84" r="3.5" fill="#111" />
        {/* nose */}
        <path d="M100 96 Q94 112 102 116" fill="none" strokeWidth="2.5" />
        {/* huge open mouth */}
        <ellipse cx="100" cy="150" rx="34" ry="30" fill="#3b0f12" />
        <path d="M70 138 Q100 124 130 138 L128 144 Q100 132 72 144 Z" fill="#fff" strokeWidth="2" />
        <ellipse cx="100" cy="166" rx="18" ry="9" fill="#e0707a" strokeWidth="2" />
      </g>
      {/* stubble / neckbeard */}
      <g fill="#333">
        {STUBBLE.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.6" />
        ))}
      </g>
    </svg>
  );
}
