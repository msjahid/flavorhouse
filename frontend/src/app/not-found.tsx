import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-24 text-center">
      <p className="text-7xl">🍗❓</p>
      <h1 className="mt-4 font-display text-4xl font-extrabold">Page not found</h1>
      <Link href="/menu" className="btn-primary mt-6">Back to the menu</Link>
    </div>
  );
}
