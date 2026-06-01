"use client";

import { useMemo } from "react";
import { MapPinned } from "lucide-react";
import { chinaRegions } from "@/lib/regions/china-admin";

interface RegionSelectorProps {
  province: string;
  city: string;
  district: string;
  onChange: (nextValue: { province: string; city: string; district: string }) => void;
}

export function RegionSelector({ province, city, district, onChange }: RegionSelectorProps) {
  const provinceOptions = chinaRegions;

  const cityOptions = useMemo(() => {
    return provinceOptions.find((item) => item.name === province)?.children ?? [];
  }, [province, provinceOptions]);

  const districtOptions = useMemo(() => {
    return cityOptions.find((item) => item.name === city)?.children ?? [];
  }, [city, cityOptions]);

  return (
    <div className="rounded-2xl border border-stroke-strong bg-surface/30 p-5 md:col-span-2 xl:col-span-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="label-base mb-1">地区选择</p>
          <h4 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
            <MapPinned className="h-4 w-4 text-accent" />
            选择省份 / 城市 / 城区
          </h4>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            支持三级级联选择。你可以只停在省级，也可以继续选择到城市或城区。
          </p>
        </div>
        <p className="text-xs font-mono uppercase tracking-[0.16em] text-muted">
          当前选择：{[province, city, district].filter(Boolean).join(" / ") || "未选择"}
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <label className="group relative">
          <span className="label-base group-focus-within:text-accent transition-colors">省份</span>
          <select
            className="input-base peer"
            value={province}
            onChange={(event) =>
              onChange({
                province: event.target.value,
                city: "",
                district: "",
              })
            }
          >
            <option value="">请选择省份</option>
            {provinceOptions.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-accent transition-all duration-300 peer-focus:w-full" />
        </label>

        <label className="group relative">
          <span className="label-base group-focus-within:text-accent transition-colors">城市</span>
          <select
            className="input-base peer"
            value={city}
            disabled={!province}
            onChange={(event) =>
              onChange({
                province,
                city: event.target.value,
                district: "",
              })
            }
          >
            <option value="">{province ? "请选择城市" : "请先选择省份"}</option>
            {cityOptions.map((item) => (
              <option key={`${province}-${item.name}`} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-accent transition-all duration-300 peer-focus:w-full" />
        </label>

        <label className="group relative">
          <span className="label-base group-focus-within:text-accent transition-colors">城区</span>
          <select
            className="input-base peer"
            value={district}
            disabled={!city}
            onChange={(event) =>
              onChange({
                province,
                city,
                district: event.target.value,
              })
            }
          >
            <option value="">{city ? "请选择城区" : "请先选择城市"}</option>
            {districtOptions.map((item) => (
              <option key={`${province}-${city}-${item.name}`} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          <div className="absolute bottom-0 left-0 h-[2px] w-0 bg-accent transition-all duration-300 peer-focus:w-full" />
        </label>
      </div>
    </div>
  );
}
