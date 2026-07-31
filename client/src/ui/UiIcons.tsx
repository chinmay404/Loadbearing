// Interface icons, drawn rather than typed — emoji in a drafting tool reads wrong.
// Kept deliberately separate from canvas/icons.tsx, which draws components.

interface P {
  size?: number;
}

const S = ({ children, size = 18 }: P & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const IconSheets = ({ size }: P) => (
  <S size={size}>
    <path d="M4 5h11l5 5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    <path d="M15 5v5h5" />
    <path d="M7 13h8M7 16.5h5" />
  </S>
);

/** A folder holding several sheets: one system, several views of it. */
export const IconFolder = ({ size }: P) => (
  <S size={size}>
    <path d="M3 7.5a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z" />
    <path d="M7 13h10M7 16h6" />
  </S>
);

export const IconCompose = ({ size }: P) => (
  <S size={size}>
    <path d="M4 6h9M4 10.5h6M4 15h8" />
    <path d="M15 15.5 18.5 12l2 2-3.5 3.5-2.5.6Z" />
    <path d="M13.5 19.5H20" />
  </S>
);

export const IconDrafting = ({ size }: P) => (
  <S size={size}>
    <path d="M4 20 12 4l8 16" />
    <path d="M7.5 13.5h9" />
    <circle cx="12" cy="4" r="1.2" />
  </S>
);

export const IconGauge = ({ size }: P) => (
  <S size={size}>
    <path d="M4 17a8 8 0 1 1 16 0" />
    <path d="M12 17 16 10" />
    <circle cx="12" cy="17" r="1.3" />
  </S>
);

export const IconManual = ({ size }: P) => (
  <S size={size}>
    <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
    <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H11v16h7.5a1.5 1.5 0 0 0 1.5-1.5Z" />
    <path d="M14 9h3.5M14 12.5h3.5" />
  </S>
);

export const IconInstrument = ({ size }: P) => (
  <S size={size}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
    <path d="M12 12l3.5-3" />
  </S>
);

export const IconTarget = ({ size }: P) => (
  <S size={size}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </S>
);

export const IconPlus = ({ size }: P) => (
  <S size={size}>
    <path d="M12 5v14M5 12h14" />
  </S>
);

export const IconTwist = ({ size }: P) => (
  <S size={size}>
    <path d="M4 8h9a4 4 0 0 1 0 8H8" />
    <path d="M10.5 13 8 16l2.5 3" />
    <path d="M17 5.5 20 8l-3 2.5" />
  </S>
);

export const IconArchive = ({ size }: P) => (
  <S size={size}>
    <path d="M4 8h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
    <path d="M3 5h18v3H3z" />
    <path d="M10 12h4" />
  </S>
);

export const IconPlay = ({ size }: P) => (
  <S size={size}>
    <path d="M8 5.5 18.5 12 8 18.5Z" />
  </S>
);

export const IconStop = ({ size }: P) => (
  <S size={size}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="1" />
  </S>
);

export const IconSelect = ({ size }: P) => (
  <S size={size}>
    <path d="M6 4l12 7-5.5 1.5L11 19Z" />
  </S>
);

export const IconNote = ({ size }: P) => (
  <S size={size}>
    <path d="M5 4h14v10l-5 5H5Z" />
    <path d="M19 14h-5v5" />
  </S>
);

export const IconPen = ({ size }: P) => (
  <S size={size}>
    <path d="M4 20l1-4.5L15.5 5A2.1 2.1 0 0 1 18.5 8L8 18.5Z" />
    <path d="M14 6.5 17 9.5" />
  </S>
);

export const IconErase = ({ size }: P) => (
  <S size={size}>
    <path d="M8 19h11" />
    <path d="M5.5 16.5 13 9l4.5 4.5-6 6H8Z" />
  </S>
);

export const IconUndo = ({ size }: P) => (
  <S size={size}>
    <path d="M4 9h9.5a4.5 4.5 0 0 1 0 9H8" />
    <path d="M7 5.5 3.5 9 7 12.5" />
  </S>
);

export const IconRedo = ({ size }: P) => (
  <S size={size}>
    <path d="M20 9h-9.5a4.5 4.5 0 0 0 0 9H16" />
    <path d="M17 5.5 20.5 9 17 12.5" />
  </S>
);

export const IconSkull = ({ size }: P) => (
  <S size={size}>
    <path d="M12 3.5c4 0 6.5 2.7 6.5 6.3 0 2.2-1 3.3-1.6 4.2-.4.6-.4 1.4-.4 2.3 0 .9-.7 1.2-1.5 1.2H9c-.8 0-1.5-.3-1.5-1.2 0-.9 0-1.7-.4-2.3-.6-.9-1.6-2-1.6-4.2C5.5 6.2 8 3.5 12 3.5Z" />
    <circle cx="9.5" cy="10.5" r="1.2" />
    <circle cx="14.5" cy="10.5" r="1.2" />
  </S>
);

export const IconClose = ({ size }: P) => (
  <S size={size}>
    <path d="M6 6l12 12M18 6 6 18" />
  </S>
);

export const IconBack = ({ size }: P) => (
  <S size={size}>
    <path d="M10 5.5 3.5 12l6.5 6.5" />
    <path d="M3.5 12H20" />
  </S>
);
