"use client";

import { useState, type FormEvent } from "react";
import type { AdminBranchDetail, WeeklyHoursInput } from "../../../../features/admin/admin-service";

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const verificationLabels = { verified: "검증 완료", candidate: "검증 후보", stale: "재검증 필요", rejected: "제외" };
const publicLabels = { active: "공개", hidden: "숨김", closed: "폐점", moved: "이전" };

function list(value: string | undefined) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function commaList(value: FormDataEntryValue | null) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function nullableNumber(value: FormDataEntryValue | null) {
  return value === null || value === "" ? null : Number(value);
}

export function AdminBranchEditor({ branch }: { branch: AdminBranchDetail }) {
  const initialHours = new Map(branch.weeklyHours.map((item) => [item.weekday, item]));
  const [hours, setHours] = useState<WeeklyHoursInput[]>(weekdays.map((_, weekday) => {
    const item = initialHours.get(weekday);
    return {
      weekday,
      opensAt: item?.opens_at ?? null,
      closesAt: item?.closes_at ?? null,
      breakStartsAt: item?.break_starts_at ?? null,
      breakEndsAt: item?.break_ends_at ?? null,
      lastOrderAt: item?.last_order_at ?? null,
      isClosed: item?.is_closed === 1,
    };
  }));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (payload: unknown) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/branches/${encodeURIComponent(branch.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "저장하지 못했습니다.");
      setMessage("저장했습니다. 최신 데이터를 불러옵니다.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
      setBusy(false);
    }
  };

  const updateHour = (weekday: number, key: keyof WeeklyHoursInput, value: string | boolean | null) => {
    setHours((current) => current.map((item) => item.weekday === weekday ? { ...item, [key]: value } : item));
  };

  const saveFacts = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void send({
      action: "updateBranch",
      note: data.get("note"),
      branch: {
        branchName: String(data.get("branchName") ?? "") || null,
        region: data.get("region"), district: data.get("district"), address: data.get("address"),
        lat: nullableNumber(data.get("lat")), lng: nullableNumber(data.get("lng")),
        phone: String(data.get("phone") ?? "") || null,
        hoursText: String(data.get("hoursText") ?? "") || null,
        weeklyHours: hours,
      },
    });
  };

  const saveMenu = (event: FormEvent<HTMLFormElement>, id?: string) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void send({
      action: id ? "updateMenu" : "createMenu", menuId: id, note: data.get("note"),
      menu: {
        id, name: data.get("name"), price: nullableNumber(data.get("price")),
        availabilityStatus: data.get("availabilityStatus"), verificationStatus: data.get("verificationStatus"),
        ramenTypes: commaList(data.get("ramenTypes")), brothStyle: String(data.get("brothStyle") ?? "") || null,
        bodyLevel: nullableNumber(data.get("bodyLevel")), spicinessLevel: nullableNumber(data.get("spicinessLevel")),
        brothBases: commaList(data.get("brothBases")), tags: commaList(data.get("tags")),
      },
    });
  };

  return (
    <div className="admin-editor">
      {message && <p className="admin-message" role="status">{message}</p>}
      <section className="admin-panel">
        <div className="admin-section-heading"><div><h2>지점 사실</h2><p>주소·좌표·연락처와 구조화된 주간 영업시간</p></div></div>
        <form className="admin-form admin-grid" onSubmit={saveFacts}>
          <label>지점명<input name="branchName" defaultValue={branch.branch_name ?? ""} /></label>
          <label>시·도<input name="region" defaultValue={branch.region} required /></label>
          <label>구·시<input name="district" defaultValue={branch.district} required /></label>
          <label className="span-2">주소<input name="address" defaultValue={branch.address} required /></label>
          <label>위도<input name="lat" type="number" step="any" defaultValue={branch.lat ?? ""} /></label>
          <label>경도<input name="lng" type="number" step="any" defaultValue={branch.lng ?? ""} /></label>
          <label>전화<input name="phone" defaultValue={branch.phone ?? ""} /></label>
          <label>표시용 영업시간<input name="hoursText" defaultValue={branch.hours_text ?? ""} /></label>
          <div className="admin-hours span-2">
            <h3>주간 영업시간</h3>
            {hours.map((item) => <div className="admin-hours-row" key={item.weekday}>
              <strong>{weekdays[item.weekday]}</strong>
              <label><span>휴무</span><input type="checkbox" checked={item.isClosed} onChange={(event) => updateHour(item.weekday, "isClosed", event.target.checked)} /></label>
              <label><span>오픈</span><input type="time" disabled={item.isClosed} value={item.opensAt ?? ""} onChange={(event) => updateHour(item.weekday, "opensAt", event.target.value || null)} /></label>
              <label><span>마감</span><input type="time" disabled={item.isClosed} value={item.closesAt ?? ""} onChange={(event) => updateHour(item.weekday, "closesAt", event.target.value || null)} /></label>
              <label><span>브레이크 시작</span><input type="time" disabled={item.isClosed} value={item.breakStartsAt ?? ""} onChange={(event) => updateHour(item.weekday, "breakStartsAt", event.target.value || null)} /></label>
              <label><span>브레이크 종료</span><input type="time" disabled={item.isClosed} value={item.breakEndsAt ?? ""} onChange={(event) => updateHour(item.weekday, "breakEndsAt", event.target.value || null)} /></label>
              <label><span>라스트 오더</span><input type="time" disabled={item.isClosed} value={item.lastOrderAt ?? ""} onChange={(event) => updateHour(item.weekday, "lastOrderAt", event.target.value || null)} /></label>
            </div>)}
          </div>
          <label className="span-2">변경 메모<textarea name="note" required /></label>
          <button className="primary-button" disabled={busy}>지점 사실 저장</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading"><div><h2>메뉴와 프로필</h2><p>메뉴마다 가격·상태·라멘 분류를 별도로 관리합니다.</p></div></div>
        <div className="admin-card-list">
          {[...branch.menus, null].map((menu, index) => {
            const profile = menu?.profile;
            return <form className="admin-subpanel admin-form admin-grid" onSubmit={(event) => saveMenu(event, menu?.id)} key={menu?.id ?? "new"}>
              <h3 className="span-2">{menu ? menu.name : "새 메뉴"}</h3>
              <label>메뉴명<input name="name" defaultValue={menu?.name ?? ""} required /></label>
              <label>가격<input name="price" type="number" min="0" defaultValue={menu?.price ?? ""} /></label>
              <label>판매 상태<select name="availabilityStatus" defaultValue={menu?.availability_status ?? "unknown"}><option value="available">판매</option><option value="seasonal">시즌</option><option value="sold_out">품절</option><option value="unknown">미확인</option></select></label>
              <label>검증 상태<select name="verificationStatus" defaultValue={menu?.verification_status ?? "candidate"}>{Object.entries(verificationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>라멘 유형 (쉼표)<input name="ramenTypes" defaultValue={list(profile?.ramen_types).join(", ")} placeholder="shoyu, tsukemen" /></label>
              <label>국물 스타일<input name="brothStyle" defaultValue={profile?.broth_style ?? ""} placeholder="chintan" /></label>
              <label>농도 1–5<input name="bodyLevel" type="number" min="1" max="5" defaultValue={profile?.body_level ?? ""} /></label>
              <label>맵기 0–5<input name="spicinessLevel" type="number" min="0" max="5" defaultValue={profile?.spiciness_level ?? ""} /></label>
              <label>육수 베이스 (쉼표)<input name="brothBases" defaultValue={list(profile?.broth_bases).join(", ")} /></label>
              <label>태그 (쉼표)<input name="tags" defaultValue={list(profile?.tags).join(", ")} /></label>
              <label className="span-2">변경 메모<textarea name="note" required /></label>
              <button className="primary-button" disabled={busy}>{index === branch.menus.length ? "메뉴 추가" : "메뉴 저장"}</button>
            </form>;
          })}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading"><div><h2>출처 근거</h2><p>지점 또는 메뉴에 새 근거를 추가합니다.</p></div></div>
        <form className="admin-form admin-grid" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget); const entityId = String(data.get("entityId"));
          void send({ action: "appendEvidence", note: data.get("reviewerNote"), evidence: {
            entityType: entityId === branch.id ? "branch" : "menu", entityId, fieldName: data.get("fieldName"),
            sourceName: data.get("sourceName"), sourceUrl: data.get("sourceUrl"), checkedAt: data.get("checkedAt"), note: data.get("evidenceNote"),
          } });
        }}>
          <label>대상<select name="entityId"><option value={branch.id}>지점</option>{branch.menus.map((menu) => <option value={menu.id} key={menu.id}>{menu.name}</option>)}</select></label>
          <label>필드<input name="fieldName" defaultValue="general" required /></label>
          <label>출처명<input name="sourceName" required /></label><label>확인일<input name="checkedAt" type="date" required /></label>
          <label className="span-2">출처 URL<input name="sourceUrl" type="url" required /></label>
          <label className="span-2">근거 설명<textarea name="evidenceNote" /></label>
          <label className="span-2">변경 메모<textarea name="reviewerNote" required /></label>
          <button className="primary-button" disabled={busy}>근거 추가</button>
        </form>
        <ul className="admin-record-list">{branch.evidence.map((item) => <li key={item.id}><strong>{item.source_name}</strong><a href={item.source_url} target="_blank" rel="noreferrer">출처 열기</a><span>{item.checked_at} · {item.note || "설명 없음"}</span></li>)}</ul>
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading"><div><h2>상태 전환</h2><p>검증 또는 공개 상태 변경에는 검토 메모가 필수입니다.</p></div></div>
        <form className="admin-form admin-grid" onSubmit={(event) => {
          event.preventDefault(); const data = new FormData(event.currentTarget);
          void send({ action: "transitionState", transition: { entityType: "branch", verificationStatus: data.get("verificationStatus"), publicStatus: data.get("publicStatus"), note: data.get("note") } });
        }}>
          <label>검증 상태<select name="verificationStatus" defaultValue={branch.verification_status}>{Object.entries(verificationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>공개 상태<select name="publicStatus" defaultValue={branch.public_status}>{Object.entries(publicLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="span-2">검토 메모<textarea name="note" required /></label>
          <button className="primary-button" disabled={busy}>상태 전환</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="admin-section-heading"><div><h2>이벤트 이력</h2><p>모든 변경은 동일한 D1 batch에서 감사 이벤트로 남습니다.</p></div></div>
        <ol className="admin-record-list">{branch.history.map((item) => <li key={item.id}><strong>{item.action}</strong><span>{item.created_at} · {item.actor}</span><p>{item.note}</p></li>)}</ol>
      </section>
    </div>
  );
}
