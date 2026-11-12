import { useState } from "react";

export function Avatar({ name = "", photoURL, size = 40 }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

  if (photoURL && !failed) {
    return <img alt="" className="avatar" height={size} referrerPolicy="no-referrer" src={photoURL} width={size} onError={() => setFailed(true)} />;
  }

  return (
    <span aria-hidden="true" className="avatar avatar--initials" style={{ height: size, width: size }}>
      {initials}
    </span>
  );
}
