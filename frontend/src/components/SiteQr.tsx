"use client";

import { useEffect, useState } from "react";
import { siteUrl } from "@/lib/restaurant";
import QrCode from "./QrCode";

/** QR code + URL text pointing at a path on this website (resolved in the browser). */
export default function SiteQr({ path = "/menu", className = "", showUrl = true }: { path?: string; className?: string; showUrl?: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(siteUrl() + path), [path]);
  if (!url) return <div className={className} />;
  return (
    <div className="flex flex-col items-center gap-1">
      <QrCode value={url} className={className} />
      {showUrl && <span className="text-[0.75em] break-all">{url.replace(/^https?:\/\//, "")}</span>}
    </div>
  );
}
