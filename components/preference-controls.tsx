import type { BrothBase, BrothStyle, RamenType } from "../domain/ramen";

const ramenTypeOptions: Array<{ value: RamenType; label: string }> = [
  { value: "shoyu", label: "쇼유" },
  { value: "shio", label: "시오" },
  { value: "miso", label: "미소" },
  { value: "tonkotsu", label: "돈코츠" },
  { value: "tsukemen", label: "츠케멘" },
  { value: "mazesoba", label: "마제소바" },
];

const brothStyleOptions: Array<{ value: BrothStyle; label: string }> = [
  { value: "chintan", label: "청탕" },
  { value: "paitan", label: "백탕" },
  { value: "dry", label: "국물 없음" },
  { value: "dipping", label: "찍어 먹는 국물" },
];

const brothBaseOptions: Array<{ value: BrothBase; label: string }> = [
  { value: "닭", label: "닭" },
  { value: "돼지", label: "돼지" },
  { value: "소", label: "소" },
  { value: "해산물", label: "해산물" },
  { value: "채소", label: "채소" },
];

const bodyOptions = [1, 2, 3, 4, 5] as const;
const spicinessOptions = [0, 1, 2, 3, 4, 5] as const;

export type BodyTarget = (typeof bodyOptions)[number];
export type SpicinessTarget = (typeof spicinessOptions)[number];

export interface PreferenceControlsProps {
  ramenTypes: RamenType[];
  onRamenTypesChange: (value: RamenType[]) => void;
  brothStyles: BrothStyle[];
  onBrothStylesChange: (value: BrothStyle[]) => void;
  brothBases: BrothBase[];
  onBrothBasesChange: (value: BrothBase[]) => void;
  bodyTarget: BodyTarget | null;
  onBodyTargetChange: (value: BodyTarget | null) => void;
  spicinessTarget: SpicinessTarget | null;
  onSpicinessTargetChange: (value: SpicinessTarget | null) => void;
  text: string;
  onTextChange: (value: string) => void;
}

function toggleValue<T extends string>(current: T[], value: T): T[] {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}

export function PreferenceControls({
  ramenTypes,
  onRamenTypesChange,
  brothStyles,
  onBrothStylesChange,
  brothBases,
  onBrothBasesChange,
  bodyTarget,
  onBodyTargetChange,
  spicinessTarget,
  onSpicinessTargetChange,
  text,
  onTextChange,
}: PreferenceControlsProps) {
  return (
    <div className="preference-controls">
      <fieldset>
        <legend>라멘 종류 <small>여러 개 선택 가능</small></legend>
        <div className="preference-chips">
          {ramenTypeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={ramenTypes.includes(option.value)}
              onClick={() => onRamenTypesChange(toggleValue(ramenTypes, option.value))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>국물 스타일 <small>여러 개 선택 가능</small></legend>
        <div className="preference-chips">
          {brothStyleOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={brothStyles.includes(option.value)}
              onClick={() => onBrothStylesChange(toggleValue(brothStyles, option.value))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>육수 베이스 <small>여러 개 선택 가능</small></legend>
        <div className="preference-chips">
          {brothBaseOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={brothBases.includes(option.value)}
              onClick={() => onBrothBasesChange(toggleValue(brothBases, option.value))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>진한 정도 <small>하나만 선택</small></legend>
        <div className="level-buttons" aria-label="진한 정도 선택">
          {bodyOptions.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={bodyTarget === level}
              onClick={() => onBodyTargetChange(bodyTarget === level ? null : level)}
            >
              {level}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>매운 정도 <small>하나만 선택 · 0은 맵지 않음</small></legend>
        <div className="level-buttons" aria-label="매운 정도 선택">
          {spicinessOptions.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={spicinessTarget === level}
              onClick={() => onSpicinessTargetChange(spicinessTarget === level ? null : level)}
            >
              {level}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="explore-text-label" htmlFor="explore-preference-text">
        추가로 원하는 맛을 말해보세요
        <textarea
          id="explore-preference-text"
          maxLength={500}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="예: 느끼하지 않고 닭 향이 또렷한 라멘"
        />
      </label>
      <p className="privacy-note">입력한 문장은 추천에만 사용하며 분석 이벤트로 보내지 않아요.</p>
    </div>
  );
}
