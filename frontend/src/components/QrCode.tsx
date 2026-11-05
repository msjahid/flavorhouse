"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Renders a crisp SVG QR code (prints sharply at any size). */
export default function QrCode({ value, className = "" }: { value: string; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1e1612", light: "#ffffff00" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [value]);
  return <div className={`[&>svg]:h-full [&>svg]:w-full ${className}`} dangerouslySetInnerHTML={{ __html: svg }} aria-label={`QR code for ${value}`} role="img" />;
}
