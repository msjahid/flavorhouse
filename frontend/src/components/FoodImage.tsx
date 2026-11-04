import Image from "next/image";

/** Shows the uploaded photo, or a coloured emoji tile when no photo exists yet. */
export default function FoodImage({
  src,
  emoji,
  alt,
  className = "",
  sizes = "(max-width: 768px) 100vw, 33vw",
  priority = false,
}: {
  src: string | null;
  emoji: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-mustard/40 via-cream-dark to-flame/25 ${className}`}>
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <span aria-hidden className="absolute inset-0 grid place-items-center text-[clamp(3rem,8vw,6rem)] drop-shadow-sm">
          {emoji || "🍽️"}
        </span>
      )}
    </div>
  );
}
