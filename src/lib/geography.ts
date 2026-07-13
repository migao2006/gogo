const CITY_ALIASES: Record<string, string> = {
  "臺北市": "Taipei",
  "台北市": "Taipei",
  "新北市": "NewTaipei",
  "桃園市": "Taoyuan",
  "臺中市": "Taichung",
  "台中市": "Taichung",
  "臺南市": "Tainan",
  "台南市": "Tainan",
  "高雄市": "Kaohsiung",
  "基隆市": "Keelung",
  "新竹市": "Hsinchu",
  "新竹縣": "HsinchuCounty",
  "苗栗縣": "MiaoliCounty",
  "彰化縣": "ChanghuaCounty",
  "南投縣": "NantouCounty",
  "雲林縣": "YunlinCounty",
  "嘉義市": "Chiayi",
  "嘉義縣": "ChiayiCounty",
  "屏東縣": "PingtungCounty",
  "宜蘭縣": "YilanCounty",
  "花蓮縣": "HualienCounty",
  "臺東縣": "TaitungCounty",
  "台東縣": "TaitungCounty",
  "澎湖縣": "PenghuCounty",
  "金門縣": "KinmenCounty",
  "連江縣": "LienchiangCounty"
};

export function normalizeTdxCity(input?: string | null): string | null {
  if (!input) return null;
  const value = input.trim();
  if (CITY_ALIASES[value]) return CITY_ALIASES[value];

  const matched = Object.entries(CITY_ALIASES).find(([name]) => value.includes(name));
  return matched?.[1] ?? null;
}

export function operatorsForCity(city: string | null): string[] {
  switch (city) {
    case "Taipei":
    case "Keelung":
      return ["TRTC"];
    case "NewTaipei":
      return ["TRTC", "NTMC", "NTDLRT"];
    case "Taoyuan":
      return ["TYMC"];
    case "Taichung":
      return ["TMRT"];
    case "Kaohsiung":
      return ["KRTC", "KLRT"];
    default:
      return [];
  }
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const radius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function clampRadius(value: number): number {
  if (!Number.isFinite(value)) return 500;
  return Math.min(2_000, Math.max(200, Math.round(value)));
}
