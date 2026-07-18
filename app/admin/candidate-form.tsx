"use client";

import { useState, type FormEvent } from "react";

function optional(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function CandidateForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/branches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: data.get("note"),
          candidate: {
            shopId: data.get("shopId"),
            branchId: data.get("branchId"),
            slug: data.get("slug"),
            shopName: data.get("shopName"),
            branchName: optional(data.get("branchName")),
            region: data.get("region"),
            district: data.get("district"),
            address: data.get("address"),
            lat: Number(data.get("lat")),
            lng: Number(data.get("lng")),
            phone: optional(data.get("phone")),
            sourceName: data.get("sourceName"),
            sourceUrl: data.get("sourceUrl"),
            checkedAt: data.get("checkedAt"),
            evidenceNote: String(data.get("evidenceNote") ?? ""),
          },
        }),
      });
      const result = await response.json() as { branchId?: unknown; error?: unknown };
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "후보를 생성하지 못했습니다.");
      if (typeof result.branchId !== "string") throw new Error("생성된 지점 식별자를 확인하지 못했습니다.");
      window.location.assign(`/admin/branches/${encodeURIComponent(result.branchId)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "후보를 생성하지 못했습니다.");
      setBusy(false);
    }
  };

  return (
    <form className="admin-form admin-grid" onSubmit={submit}>
      <label>매장 식별자<input name="shopId" placeholder="shop:new-ramen" required /></label>
      <label>지점 식별자<input name="branchId" placeholder="branch:new-ramen" required /></label>
      <label>공개 슬러그<input name="slug" placeholder="new-ramen" required /></label>
      <label>매장명<input name="shopName" required /></label>
      <label>지점명<input name="branchName" /></label>
      <label>시·도<input name="region" required /></label>
      <label>구·시<input name="district" required /></label>
      <label className="span-2">주소<input name="address" required /></label>
      <label>위도<input name="lat" type="number" min="-90" max="90" step="any" required /></label>
      <label>경도<input name="lng" type="number" min="-180" max="180" step="any" required /></label>
      <label>전화<input name="phone" /></label>
      <label>출처명<input name="sourceName" required /></label>
      <label className="span-2">출처 URL<input name="sourceUrl" type="url" required /></label>
      <label>확인일<input name="checkedAt" type="date" required /></label>
      <label className="span-2">근거 설명<textarea name="evidenceNote" /></label>
      <label className="span-2">수집 메모<textarea name="note" required /></label>
      {message ? <p className="admin-message span-2" role="alert">{message}</p> : null}
      <button className="primary-button" disabled={busy}>{busy ? "후보 생성 중…" : "검증 후보 생성"}</button>
    </form>
  );
}
