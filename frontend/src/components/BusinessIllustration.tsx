export function BusinessIllustration({ kind, className = "" }: { kind: "attendance" | "payroll"; className?: string }) {
  return (
    <svg className={`business-art business-art-${kind} ${className}`} viewBox="0 0 240 120" aria-hidden="true" focusable="false">
      {kind === "attendance" ? <>
        <rect className="business-art-soft" x="8" y="21" width="151" height="92" rx="12" />
        <rect className="business-art-sheet" x="17" y="13" width="132" height="91" rx="9" />
        <path className="business-art-soft" d="M26 14h114a8 8 0 0 1 8 8v17H18V22a8 8 0 0 1 8-8Z" />
        <path className="business-art-line" d="M17 39h132M44 7v16m76-16v16M36 55h16m18 0h16m18 0h16M36 72h16m18 0h16m18 0h16M36 89h16m18 0h16" />
        <g transform="rotate(-8 134 83)">
          <rect className="business-art-sheet" x="112" y="57" width="43" height="54" rx="6" />
          <path className="business-art-accent-line" d="M126 57v-5h15v5M121 101h25" />
          <circle className="business-art-accent-fill" cx="134" cy="76" r="6" />
          <path className="business-art-accent-line" d="M123 93c0-12 22-12 22 0" />
        </g>
        <circle className="business-art-accent-fill" cx="192" cy="78" r="31" />
        <circle className="business-art-sheet" cx="192" cy="78" r="25" />
        <path className="business-art-accent-line" d="M192 60v18l12 8m-12-35v3m0 48v3m-27-27h3m48 0h3" />
        <circle className="business-art-accent-fill" cx="204" cy="23" r="14" />
        <path className="business-art-accent-line" d="m198 23 4 4 8-9" />
      </> : <>
        <rect className="business-art-soft" x="12" y="18" width="139" height="96" rx="10" />
        <path className="business-art-sheet" d="M29 8h88l28 27v66a8 8 0 0 1-8 8H29a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8Z" />
        <path className="business-art-soft" d="M117 9v26h27Z" />
        <path className="business-art-line" d="M117 9v26h27M36 28h55M36 46h91M36 58h56m20 0h15M36 71h46m30 0h15M100 86h27m-27 12h27" />
        <circle className="business-art-accent-fill" cx="63" cy="88" r="20" />
        <text className="business-art-currency" x="63" y="96">₫</text>
        <rect className="business-art-sheet business-art-calculator" x="153" y="36" width="69" height="77" rx="9" />
        <rect className="business-art-accent-fill" x="163" y="46" width="49" height="18" rx="3" />
        <path className="business-art-accent-line" d="M198 56h7m-37 19h5m12 0h5m12 0h5m-39 12h5m12 0h5m12 0h5m-39 12h5m12 0h5m12-5v10" />
      </>}
    </svg>
  );
}
