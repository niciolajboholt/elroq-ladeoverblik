export type IconName = "car" | "bolt" | "wallet" | "home" | "pin" | "leaf" | "arrow" | "plus";

export function Icon({ name }: { name: IconName }) {
  const paths = {
    car: <><path d="M5 15.5h14l-1.4-5.1A2 2 0 0 0 15.7 9H8.3a2 2 0 0 0-1.9 1.4L5 15.5Z"/><path d="M4 15.5v3M20 15.5v3M7.5 18.5h9M8 13h.01M16 13h.01"/></>,
    bolt: <path d="m13.5 2-8 12h6l-1 8 8-12h-6l1-8Z"/>,
    wallet: <><path d="M4 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.8A2.8 2.8 0 0 1 5.8 4H17"/><path d="M15 12h5v4h-5a2 2 0 1 1 0-4Z"/></>,
    home: <><path d="m3 11 9-8 9 8"/><path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7"/></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    leaf: <><path d="M20 4C11 4 5 8 5 15c0 3 2 5 5 5 7 0 10-7 10-16Z"/><path d="M4 21c3-6 7-9 12-12"/></>,
    arrow: <><path d="M5 12h14"/><path d="m14 7 5 5-5 5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
  } satisfies Record<IconName, ReactNode>;

  return <span className="icon-glyph" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">{paths[name]}</svg></span>;
}
import type { ReactNode } from "react";
