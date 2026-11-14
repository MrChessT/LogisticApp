"use client";

import { useParams } from "next/navigation";
import { ReceiptDetail } from "@/components/operations/receipt-detail";

export default function RecepcionPage() {
  const { id } = useParams<{ id: string }>();
  return <ReceiptDetail id={id} />;
}
