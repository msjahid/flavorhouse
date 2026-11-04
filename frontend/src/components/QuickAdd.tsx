"use client";

import { useState } from "react";
import { useCart } from "@/context/CartContext";
import type { MenuItem } from "@/lib/types";

export default function QuickAdd({ item }: { item: MenuItem }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);

  return (
    <button
      className="btn-primary !px-4 !py-2 text-sm"
      onClick={() => {
        add({
          itemId: item.id,
          slug: item.slug,
          name: item.name,
          image: item.image,
          emoji: item.emoji,
          unitPrice: parseFloat(item.price),
          quantity: 1,
          optionIds: [],
          optionLabels: [],
        });
        setAdded(true);
        setTimeout(() => setAdded(false), 1200);
      }}
    >
      {added ? "✓ Added" : "+ Add"}
    </button>
  );
}
